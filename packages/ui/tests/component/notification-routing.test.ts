/**
 * 068 US3 T040 (FR-024, FR-025, FR-029, FR-030, FR-031b) — which notices reach the Notifications
 * panel, and how.
 *
 * Layer: component — the real `ConfigProvider`, `NotificationProvider`, `AttentionToasts` and the
 * `useNotifications` hook over a fake `window.throng.notifications`. Whether main stores, dedupes and
 * broadcasts is the store's and the IPC's (T036, T038); this proves what the renderer SENDS and what it
 * does with what comes back.
 *
 * ANTI-VACUITY: every "adds" assertion has a sibling mode that must NOT add, driven the same way.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NotificationEntryInput } from '@throng/core';
import { AttentionToasts } from '../../src/renderer/attention/attention-toasts.js';
import { NotificationProvider, useNotify, type NoticeInput } from '../../src/renderer/common/notification.js';
import { ConfigProvider, useConfigLoaded } from '../../src/renderer/config/config-store.js';
import { useNotifications } from '../../src/renderer/notifications/use-notifications.js';
import type { AttentionToastEvent, NotificationsSnapshot } from '../../src/renderer/global.js';
import { flushUntil } from './helpers/flush-until.js';

let settingsPayload: Record<string, unknown> = { version: 1 };
let added: NotificationEntryInput[] = [];
let clipboardWrites: string[] = [];
let dismissed: string[] = [];
let snapshot: NotificationsSnapshot;
// Several components subscribe (the provider for its pending count, the hook for the panel): a listener LIST.
const changedListeners: ((s: NotificationsSnapshot) => void)[] = [];
const repeatListeners: ((r: { id: string }) => void)[] = [];
const emitChanged = (s: NotificationsSnapshot): void => changedListeners.forEach((cb) => cb(s));
const emitRepeat = (r: { id: string }): void => repeatListeners.forEach((cb) => cb(r));
let emitMarks: (e: { marks: { panelId: string }[] }) => void;
let pushToast: (e: AttentionToastEvent) => void;

const EMPTY: NotificationsSnapshot = { entries: [], order: 'oldest', pendingCount: 0, pendingSeverity: null, limit: 100 };

beforeEach(() => {
  settingsPayload = { version: 1 };
  added = [];
  clipboardWrites = [];
  dismissed = [];
  snapshot = EMPTY;
  // A callback left from the previous test would still reach the live `window.throng` mock.
  emitMarks = () => {};
  changedListeners.length = 0;
  repeatListeners.length = 0;
  Reflect.set(window, 'throng', {
    notices: { log: () => {} },
    config: { get: () => Promise.resolve({ settings: settingsPayload }) },
    clipboard: { write: (entry: { text: string }) => { clipboardWrites.push(entry.text); return Promise.resolve(); } },
    notifications: {
      add: (entry: NotificationEntryInput) => {
        added.push(entry);
        return Promise.resolve({ outcome: 'added', id: `e${added.length}` });
      },
      list: () => Promise.resolve(snapshot),
      dismiss: (id: string) => {
        dismissed.push(id);
        return Promise.resolve(snapshot);
      },
      dismissAll: () => Promise.resolve(snapshot),
      setOrder: () => Promise.resolve(snapshot),
      dismissLimitWarning: () => {},
      onChanged: (cb: (s: NotificationsSnapshot) => void) => {
        changedListeners.push(cb);
        return () => {};
      },
      onRepeat: (cb: (r: { id: string }) => void) => {
        repeatListeners.push(cb);
        return () => {};
      },
      onLimitReached: () => () => {},
    },
    attention: {
      onToast: (cb: (e: AttentionToastEvent) => void) => {
        pushToast = cb;
        return () => {};
      },
      onChanged: (cb: (e: { marks: { panelId: string }[] }) => void) => {
        emitMarks = cb;
        return () => {};
      },
      goTo: () => {},
    },
  });
});

afterEach(() => {
  Reflect.deleteProperty(window, 'throng');
  vi.useRealTimers();
  window.history.replaceState(null, '', '/');
});

interface Probe {
  notify?: (input: NoticeInput) => string;
  loaded?: boolean;
  flashing?: string | null;
  entries?: readonly { id: string }[];
}

function ProbeView({ into }: { into: Probe }): ReactElement | null {
  into.notify = useNotify().notify;
  into.loaded = useConfigLoaded();
  const panel = useNotifications();
  into.flashing = panel.flashingId;
  into.entries = panel.entries;
  return null;
}

async function mount(reconcile = false): Promise<Probe> {
  const probe: Probe = {};
  render(
    createElement(
      ConfigProvider,
      null,
      createElement(
        NotificationProvider,
        null,
        createElement(AttentionToasts, { reconcile }),
        createElement(ProbeView, { into: probe, key: 'probe' }),
      ),
    ),
  );
  await flushUntil(() => probe.loaded === true);
  return probe;
}

const RAISE: Omit<NoticeInput, 'severity'> = {
  title: 'Rename failed',
  message: 'A file with that name exists.',
  subject: { kind: 'folder', name: 'docs' },
  details: ['a.md', 'b.md'],
  testId: 'probe-notice',
  panelActions: [{ kind: 'goToPanel', panelId: 'p9', label: 'Go to panel' }],
};

describe('a notice of mode panel (FR-024)', () => {
  it('toasts AND adds a serialisable entry whose copy text equals the toast’s', async () => {
    const probe = await mount(); // error defaults to panel
    act(() => void probe.notify!({ severity: 'error', ...RAISE }));
    expect(screen.getByTestId('probe-notice')).toBeVisible();

    await waitFor(() => expect(added).toHaveLength(1));
    const entry = added[0]!;
    // Serialisable: survives a structured clone / JSON round trip unchanged.
    expect(JSON.parse(JSON.stringify(entry))).toEqual(entry);
    expect(entry).toMatchObject({
      severity: 'error',
      message: 'A file with that name exists.',
      details: ['a.md', 'b.md'],
      actions: [{ kind: 'goToPanel', panelId: 'p9', label: 'Go to panel' }],
    });
    // The same text Copy puts on the clipboard from the toast.
    fireEvent.click(screen.getByTestId('probe-notice-copy'));
    await waitFor(() => expect(clipboardWrites).toHaveLength(1));
    expect(entry.copyText).toBe(clipboardWrites[0]);
  });

  it('a notice raised in the Preferences window adds too (FR-030)', async () => {
    window.history.replaceState(null, '', '/?prefs=settings');
    const probe = await mount();
    act(() => void probe.notify!({ severity: 'warning', ...RAISE }));
    await waitFor(() => expect(added).toHaveLength(1));
  });

  it('adds again when the same condition is raised after its toast has left; the store dedupes (FR-029)', async () => {
    const probe = await mount();
    vi.useFakeTimers();
    act(() => void probe.notify!({ severity: 'error', ...RAISE }));
    act(() => {
      vi.advanceTimersByTime(3100);
    });
    expect(screen.queryByTestId('probe-notice')).toBeNull();
    act(() => void probe.notify!({ severity: 'error', ...RAISE }));
    expect(screen.getByTestId('probe-notice')).toBeVisible();
    await vi.waitFor(() => expect(added).toHaveLength(2));
    expect(added[0]).toEqual(added[1]);
  });

  it('adds nothing for a toast-only or never notice', async () => {
    settingsPayload = { version: 1, notifications: { info: { mode: 'toast' }, success: { mode: 'never' } } };
    const probe = await mount();
    act(() => void probe.notify!({ severity: 'info', ...RAISE }));
    act(() => void probe.notify!({ severity: 'success', ...RAISE, testId: 'other' }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(added).toEqual([]);
    // …while the same raise at the default error mode does add.
    act(() => void probe.notify!({ severity: 'error', ...RAISE, testId: 'third' }));
    await waitFor(() => expect(added).toHaveLength(1));
  });

  it('adds the entry with no toast when Panel is ticked alone (FR-092)', async () => {
    settingsPayload = { version: 1, notifications: { info: { toast: false, panel: true } } };
    const probe = await mount();
    let id = 'unset';
    act(() => {
      id = probe.notify!({ severity: 'info', ...RAISE });
    });
    await waitFor(() => expect(added).toHaveLength(1));
    expect(added[0]).toMatchObject({ severity: 'info', message: 'A file with that name exists.' });
    expect(screen.queryByTestId('probe-notice')).toBeNull();
    expect(id).toBe('');
  });

  it('sends a repeat of a Panel-alone notice to the store again, which groups it (FR-029, FR-092)', async () => {
    settingsPayload = { version: 1, notifications: { info: { toast: false, panel: true } } };
    const probe = await mount();
    act(() => void probe.notify!({ severity: 'info', ...RAISE }));
    act(() => void probe.notify!({ severity: 'info', ...RAISE }));
    await waitFor(() => expect(added).toHaveLength(2));
    expect(added[0]).toEqual(added[1]);
    expect(screen.queryByTestId('probe-notice')).toBeNull();
  });

  it('adds nothing and shows nothing with Toast and Panel both clear, and toasts without an entry with Toast alone (FR-092)', async () => {
    settingsPayload = { version: 1, notifications: { info: { toast: false, panel: false }, warning: { toast: true, panel: false } } };
    const probe = await mount();
    act(() => void probe.notify!({ severity: 'info', ...RAISE }));
    expect(screen.queryByTestId('probe-notice')).toBeNull();
    act(() => void probe.notify!({ severity: 'warning', ...RAISE, testId: 'warned' }));
    expect(screen.getByTestId('warned')).toBeVisible();
    await act(async () => {
      await Promise.resolve();
    });
    expect(added).toEqual([]);
  });

  it('adds nothing for a notice that was suppressed as a duplicate of a live card', async () => {
    const probe = await mount();
    act(() => void probe.notify!({ severity: 'error', ...RAISE }));
    await waitFor(() => expect(added).toHaveLength(1));
    act(() => void probe.notify!({ severity: 'error', ...RAISE }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(added).toHaveLength(1);
  });
});

describe('a grown notice updates its entry (FR-029, 030 FR-037)', () => {
  const refused = (name: string) => ({ subject: name, reason: 'too-large', displayPath: name, detail: name });
  const grouping: Omit<NoticeInput, 'severity' | 'affected'> = {
    message: 'That file is too large to open in an editor.',
    subject: { kind: 'project', name: 'Proj' },
    testId: 'probe-notice',
    groupKey: 'op:too-large',
  };

  it('sends the new casualty to the store while the toast is still live, so the entry and its Copy name it', async () => {
    const probe = await mount();
    act(() => void probe.notify!({ severity: 'error', ...grouping, affected: [refused('a.ts')] }));
    await waitFor(() => expect(added).toHaveLength(1));
    act(() => void probe.notify!({ severity: 'error', ...grouping, affected: [refused('b.ts')] }));
    await waitFor(() => expect(added).toHaveLength(2));
    expect(added[1]!.groupKey).toBe('op:too-large');
    expect(added[1]!.affected.map((a) => a.label).join(' ')).toContain('b.ts');
  });

  it('a casualty already named adds nothing to send', async () => {
    const probe = await mount();
    act(() => void probe.notify!({ severity: 'error', ...grouping, affected: [refused('a.ts')] }));
    await waitFor(() => expect(added).toHaveLength(1));
    act(() => void probe.notify!({ severity: 'error', ...grouping, affected: [refused('a.ts')] }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(added).toHaveLength(1);
  });

  it('a toast-only notice grows without touching the store', async () => {
    settingsPayload = { version: 1, notifications: { error: { mode: 'toast' } } };
    const probe = await mount();
    act(() => void probe.notify!({ severity: 'error', ...grouping, affected: [refused('a.ts')] }));
    act(() => void probe.notify!({ severity: 'error', ...grouping, affected: [refused('b.ts')] }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(added).toEqual([]);
  });
});

describe('a repeat of a stored condition (FR-031b)', () => {
  it('flashes the existing entry when main says repeat, and adds no second one', async () => {
    const probe = await mount();
    emitChanged({ ...EMPTY, entries: [{ id: 'e1' }] as never });
    await waitFor(() => expect(probe.entries).toHaveLength(1));
    expect(probe.flashing).toBeNull();
    act(() => emitRepeat({ id: 'e1' }));
    await waitFor(() => expect(probe.flashing).toBe('e1'));
    expect(probe.entries).toHaveLength(1);
    // The flash is brief: it ends on its own.
    await waitFor(() => expect(probe.flashing).toBeNull(), { timeout: 2000 });
  });
});

describe('an attention mark’s entry (FR-025)', () => {
  const raise = (panelId: string): void =>
    act(() => pushToast({ op: 'raise', panelId, kind: 'attention', title: 'Build', projectName: 'Alpha', reason: 'Needs you' }));

  it('is added with a key naming its panel when attention is panel mode', async () => {
    settingsPayload = { version: 1, notifications: { attention: { mode: 'panel' } } };
    await mount(true);
    raise('p1');
    await waitFor(() => expect(added).toHaveLength(1));
    expect(added[0]).toMatchObject({ severity: 'attention', groupKey: 'attention:p1' });
  });

  it('is removed in the main window when its mark clears', async () => {
    settingsPayload = { version: 1, notifications: { attention: { mode: 'panel' } } };
    snapshot = { ...EMPTY, entries: [{ id: 'e7', key: 'group:attention:p1' }, { id: 'e8', key: 'group:attention:p2' }, { id: 'e9', key: 'other' }] as never };
    await mount(true);
    // p2 is still marked, p1 is not: only p1's entry goes. An unrelated entry is never touched.
    act(() => emitMarks({ marks: [{ panelId: 'p2' }] }));
    await waitFor(() => expect(dismissed).toEqual(['e7']));
  });

  it('is left alone by a window that is not the main window', async () => {
    snapshot = { ...EMPTY, entries: [{ id: 'e7', key: 'group:attention:p1' }] as never };
    await mount(false);
    act(() => emitMarks({ marks: [] }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(dismissed).toEqual([]);
  });
});
