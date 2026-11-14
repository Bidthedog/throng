import { describe, expect, it, vi } from 'vitest';
import type { NotificationEntryInput } from '@throng/core';
import {
  NOTIFICATIONS_CHANNELS,
  createNotificationsEvents,
  registerNotificationsIpc,
  type NotificationsIpcMain,
  type NotificationsIpcService,
} from '../../src/main/notifications-ipc.js';
import type { NotificationsSnapshot } from '../../src/main/notification-store.js';

/**
 * 068 US3 T038 — contracts/ipc.md "Main ↔ renderer: notifications".
 *
 * Driven through the handlers `registerNotificationsIpc` registers on a fake `ipcMain`, over a fake
 * service that records what reached it, so what is pinned is the WIRE: which channels exist and of
 * which kind, that a malformed payload changes nothing, that an add from ANY window reaches the
 * store, and that `changed` is a broadcast to every window. The rules behind the wire are
 * `notification-entries.test.ts` and `notification-store.integration.test.ts`.
 */

type Listener = (event: unknown, ...args: unknown[]) => unknown;

function fakeIpc(): NotificationsIpcMain & { handles: Map<string, Listener>; ons: Map<string, Listener> } {
  const handles = new Map<string, Listener>();
  const ons = new Map<string, Listener>();
  return {
    handles,
    ons,
    handle: (channel, listener) => void handles.set(channel, listener as Listener),
    on: (channel, listener) => void ons.set(channel, listener as Listener),
  };
}

const SNAPSHOT: NotificationsSnapshot = { entries: [], order: 'oldest', pendingCount: 0, pendingSeverity: null, limit: 100 };

function recordingService(): NotificationsIpcService & { calls: Array<[string, ...unknown[]]> } {
  const calls: Array<[string, ...unknown[]]> = [];
  const record =
    <T>(name: string, answer: T) =>
    (...args: unknown[]): Promise<T> => {
      calls.push([name, ...args]);
      return Promise.resolve(answer);
    };
  return {
    calls,
    add: record('add', { outcome: 'added' as const, id: 'n1' }),
    list: record('list', SNAPSHOT),
    dismiss: record('dismiss', undefined),
    dismissAll: record('dismissAll', undefined),
    setOrder: record('setOrder', undefined),
    dismissLimitWarning: record('dismissLimitWarning', undefined),
    followLimitWarning: record('followLimitWarning', undefined),
  };
}

const event = (id: number) => ({ sender: { id } });
const VALID: NotificationEntryInput = {
  severity: 'error',
  message: 'It failed.',
  details: [],
  copyText: 'It failed.',
  affected: [],
  actions: [{ kind: 'goToPanel', panelId: 'p1', label: 'Go to panel' }],
};

function wired() {
  const ipc = fakeIpc();
  const service = recordingService();
  registerNotificationsIpc(ipc, service);
  return { ipc, service };
}

describe('throng:notifications:* — channels and kinds', () => {
  it('registers every request as a handle and every notification as a one-way listener', () => {
    const { ipc } = wired();
    for (const channel of ['add', 'list', 'dismiss', 'dismissAll', 'setOrder'] as const) {
      expect(ipc.handles.has(NOTIFICATIONS_CHANNELS[channel]), channel).toBe(true);
    }
    for (const channel of ['dismissLimitWarning', 'followLimitWarning'] as const) {
      expect(ipc.ons.has(NOTIFICATIONS_CHANNELS[channel]), channel).toBe(true);
    }
    expect(Object.values(NOTIFICATIONS_CHANNELS).every((c) => c.startsWith('throng:notifications:'))).toBe(true);
  });

  it('no longer carries the pending-mode channels (FR-059 retired them)', () => {
    const { ipc } = wired();
    expect(Object.keys(NOTIFICATIONS_CHANNELS)).not.toContain('clearPending');
    expect(Object.keys(NOTIFICATIONS_CHANNELS)).not.toContain('setPendingMode');
    expect(ipc.handles.has('throng:notifications:clearPending')).toBe(false);
    expect(ipc.ons.has('throng:notifications:setPendingMode')).toBe(false);
  });

  it('answers a snapshot from list, dismiss, dismissAll and setOrder', async () => {
    const { ipc } = wired();
    const call = (name: keyof typeof NOTIFICATIONS_CHANNELS, ...args: unknown[]) =>
      ipc.handles.get(NOTIFICATIONS_CHANNELS[name])!(event(1), ...args);
    expect(await call('list')).toEqual(SNAPSHOT);
    expect(await call('dismiss', { id: 'n1' })).toEqual(SNAPSHOT);
    expect(await call('dismissAll')).toEqual(SNAPSHOT);
    expect(await call('setOrder', { order: 'newest' })).toEqual(SNAPSHOT);
  });
});

describe('an add from any window reaches the store', () => {
  it('forwards a well-formed entry from each window, and answers the outcome', async () => {
    const { ipc, service } = wired();
    const add = ipc.handles.get(NOTIFICATIONS_CHANNELS.add)!;
    expect(await add(event(1), VALID)).toEqual({ outcome: 'added', id: 'n1' });
    expect(await add(event(7), { ...VALID, message: 'again' })).toEqual({ outcome: 'added', id: 'n1' });
    expect(service.calls.filter(([name]) => name === 'add')).toHaveLength(2);
    expect(service.calls[0]![1]).toMatchObject({ severity: 'error', actions: [{ kind: 'goToPanel', panelId: 'p1' }] });
  });
});

describe('a malformed payload changes nothing', () => {
  it.each([
    ['add', undefined],
    ['add', null],
    ['add', 'x'],
    ['add', { severity: 'fatal', message: 'x', copyText: 'x' }],
    ['add', { severity: 'error', message: 'x' }],
    ['add', { severity: 'error', message: 5, copyText: 'x' }],
    ['dismiss', undefined],
    ['dismiss', { id: 5 }],
    ['dismiss', {}],
    ['setOrder', { order: 'sideways' }],
    ['setOrder', undefined],
  ] as const)('%s with %j reaches no service method that mutates', async (name, payload) => {
    const { ipc, service } = wired();
    await ipc.handles.get(NOTIFICATIONS_CHANNELS[name])!(event(1), payload);
    expect(service.calls.filter(([n]) => n === name)).toEqual([]);
  });

  it('answers a malformed add with null rather than rejecting', async () => {
    const { ipc } = wired();
    expect(await ipc.handles.get(NOTIFICATIONS_CHANNELS.add)!(event(1), 12)).toBeNull();
  });

  it('strips an action descriptor it does not know, keeping the entry', async () => {
    const { ipc, service } = wired();
    await ipc.handles.get(NOTIFICATIONS_CHANNELS.add)!(event(1), {
      ...VALID,
      actions: [{ kind: 'runCommand', command: 'rm -rf' }, { kind: 'goToPanel', panelId: 'p2', label: 'Go' }],
    });
    expect((service.calls[0]![1] as NotificationEntryInput).actions).toEqual([{ kind: 'goToPanel', panelId: 'p2', label: 'Go' }]);
  });

  it('forwards an origin and the place it was raised with, and drops blanks and malformed ones (FR-061, FR-063)', async () => {
    const { ipc, service } = wired();
    const add = ipc.handles.get(NOTIFICATIONS_CHANNELS.add)!;
    await add(event(1), { ...VALID, origin: { panelId: 'p1', projectId: 'pr1' }, place: { project: 'Alpha', tab: 'Build', panel: 'Shell' } });
    expect(service.calls[0]![1]).toMatchObject({
      origin: { panelId: 'p1', projectId: 'pr1' },
      place: { project: 'Alpha', tab: 'Build', panel: 'Shell' },
    });
    await add(event(1), { ...VALID, origin: 'p1', place: [1, 2] });
    await add(event(1), { ...VALID, origin: { panelId: '' }, place: { project: ' ' } });
    for (const call of service.calls.slice(1)) {
      expect(call[1]).not.toHaveProperty('origin');
      expect(call[1]).not.toHaveProperty('place');
    }
    expect(service.calls).toHaveLength(3);
  });

  it('never throws out of a listener when the service rejects', async () => {
    const { ipc, service } = wired();
    service.dismissAll = () => Promise.reject(new Error('disk full'));
    await expect(Promise.resolve(ipc.handles.get(NOTIFICATIONS_CHANNELS.dismissAll)!(event(1)))).resolves.toBeNull();
  });
});

describe('the events main raises', () => {
  const window = (id: number) => ({ isDestroyed: () => false, webContents: { id, isDestroyed: () => false, send: vi.fn() } });

  it('broadcasts changed to EVERY window', () => {
    const windows = [window(1), window(2), window(3)];
    const events = createNotificationsEvents(() => windows, () => windows[0]);
    events.changed(SNAPSHOT);
    for (const w of windows) expect(w.webContents.send).toHaveBeenCalledWith(NOTIFICATIONS_CHANNELS.changed, SNAPSHOT);
  });

  it('sends repeat and limitReached to the MAIN window only', () => {
    const windows = [window(1), window(2)];
    const events = createNotificationsEvents(() => windows, () => windows[0]);
    events.repeat('n1');
    events.limitReached();
    expect(windows[0]!.webContents.send).toHaveBeenCalledWith(NOTIFICATIONS_CHANNELS.repeat, { id: 'n1' });
    expect(windows[0]!.webContents.send).toHaveBeenCalledWith(NOTIFICATIONS_CHANNELS.limitReached, undefined);
    expect(windows[1]!.webContents.send).not.toHaveBeenCalled();
  });

  it('sends nothing when there is no main window, and does not throw', () => {
    const events = createNotificationsEvents(() => [], () => undefined);
    expect(() => {
      events.repeat('n1');
      events.limitReached();
    }).not.toThrow();
  });
});

describe('a kept notice added from a window with no Notifications panel flashes in the main window (FR-030)', () => {
  const MAIN = 1;
  const wiredWithFlash = () => {
    const ipc = fakeIpc();
    const service = recordingService();
    const flash = vi.fn();
    registerNotificationsIpc(ipc, service, { isMainSender: (e) => (e as { sender: { id: number } }).sender.id === MAIN, flash });
    return { ipc, flash };
  };

  it('flashes the NEW entry when a window other than main adds it', async () => {
    const { ipc, flash } = wiredWithFlash();
    await ipc.handles.get(NOTIFICATIONS_CHANNELS.add)!(event(2), VALID);
    expect(flash).toHaveBeenCalledExactlyOnceWith('n1');
  });

  it('does not flash for an add from the main window — its own toast and panel already show it', async () => {
    const { ipc, flash } = wiredWithFlash();
    await ipc.handles.get(NOTIFICATIONS_CHANNELS.add)!(event(MAIN), VALID);
    expect(flash).not.toHaveBeenCalled();
  });
});
