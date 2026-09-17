import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { PreviewUpdate } from '@throng/core';
import {
  createPreviewPush,
  registerPreviewIpc,
  type PreviewIpcMain,
  type PreviewIpcService,
} from '../../src/main/preview-ipc.js';

/**
 * Contract (044 T060): the `throng:preview:*` surface of contracts/preview-ipc.md §1–§2.
 *
 * Driven through the handlers `registerPreviewIpc` actually registers, on a fake `ipcMain`, over a fake
 * service that records what reached it — so what is pinned is the WIRE: which channels exist and of
 * which kind, what each handler forwards, that the subscriber is `event.sender` and never the payload,
 * and that a failure comes back as a value rather than a rejection across the bridge.
 *
 * The service's behaviour behind the wire is the integration suites' (T057–T059).
 */

type Listener = (event: unknown, payload: unknown) => unknown;

function fakeIpc(): PreviewIpcMain & { handles: Map<string, Listener>; ons: Map<string, Listener> } {
  const handles = new Map<string, Listener>();
  const ons = new Map<string, Listener>();
  return {
    handles,
    ons,
    handle: (channel, listener) => void handles.set(channel, listener as Listener),
    on: (channel, listener) => void ons.set(channel, listener as Listener),
  };
}

const event = (id: number) => ({ sender: { id } });

const UPDATE: PreviewUpdate = {
  panelId: 'v1',
  revision: 3,
  filePath: 'D:/p/a.md',
  providerId: 'markdown',
  content: { kind: 'text', text: '# A' },
  dirty: false,
  parent: null,
  notice: null,
};

function recordingService(overrides: Partial<PreviewIpcService> = {}): PreviewIpcService & {
  calls: Array<[string, ...unknown[]]>;
} {
  const calls: Array<[string, ...unknown[]]> = [];
  return {
    calls,
    open: async (from, req) => {
      calls.push(['open', from, req]);
      return { kind: 'placeLocally', reservation: 'r1', besidePanelId: null };
    },
    attach: async (from, req) => {
      calls.push(['attach', from, req]);
      return { ok: true, update: UPDATE };
    },
    detach: (from, panelId) => void calls.push(['detach', from, panelId]),
    destroyed: (panelId) => void calls.push(['destroyed', panelId]),
    navigate: async (from, req) => {
      calls.push(['navigate', from, req]);
      return { kind: 'shown', update: UPDATE };
    },
    refresh: async (panelId) => {
      calls.push(['refresh', panelId]);
      return { update: UPDATE };
    },
    isOpen: (absPath) => {
      calls.push(['isOpen', absPath]);
      return true;
    },
    openPaths: () => {
      calls.push(['openPaths']);
      return ['d:/p/a.md'];
    },
    publishEditorTitle: (panelId, title) => void calls.push(['publishEditorTitle', panelId, title]),
    placeDeclined: (requestId) => void calls.push(['placeDeclined', requestId]),
    ...overrides,
  };
}

const boom = (): never => {
  throw new Error('service exploded');
};

function source(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');
}

describe('throng:preview:* — channels and kinds (§1)', () => {
  it('registers the six invokes and the four sends, and nothing else', () => {
    const ipc = fakeIpc();
    registerPreviewIpc(ipc, recordingService());

    expect([...ipc.handles.keys()].sort()).toEqual([
      'throng:preview:attach',
      'throng:preview:isOpen',
      'throng:preview:navigate',
      'throng:preview:open',
      'throng:preview:openPaths',
      'throng:preview:refresh',
    ]);
    expect([...ipc.ons.keys()].sort()).toEqual([
      'throng:preview:destroyed',
      'throng:preview:detach',
      'throng:preview:placeDeclined',
      'throng:preview:publishEditorTitle',
    ]);
  });

  it('the preload and the renderer declaration name every channel', () => {
    const preload = source('../../src/preload/preload.cts');
    const globals = source('../../src/renderer/global.d.ts');
    for (const channel of ['open', 'attach', 'navigate', 'refresh', 'isOpen', 'openPaths']) {
      expect(preload).toContain(`ipcRenderer.invoke('throng:preview:${channel}'`);
    }
    for (const channel of ['detach', 'destroyed', 'publishEditorTitle', 'placeDeclined']) {
      expect(preload).toContain(`ipcRenderer.send('throng:preview:${channel}'`);
    }
    for (const channel of ['update', 'openChanged', 'pathChanged', 'focus', 'place']) {
      expect(preload).toContain(`ipcRenderer.on('throng:preview:${channel}'`);
      expect(preload).toContain(`removeListener('throng:preview:${channel}'`);
    }
    expect(globals).toContain('preview?: {');
    for (const member of [
      'open:',
      'attach:',
      'detach:',
      'destroyed:',
      'navigate:',
      'refresh:',
      'isOpen:',
      'openPaths:',
      'publishEditorTitle:',
      'placeDeclined:',
      'onUpdate:',
      'onOpenChanged:',
      'onPathChanged:',
      'onFocus:',
      'onPlace:',
    ]) {
      expect(globals).toContain(member);
    }
  });
});

describe('renderer → main: request shapes and forwarding (§1)', () => {
  it('open forwards event.sender and the request, and returns the service’s decision', async () => {
    const ipc = fakeIpc();
    const service = recordingService();
    registerPreviewIpc(ipc, service);
    const req = { absPath: 'D:/p/a.md', projectId: 'P', requesterPanelId: 'ed1', hasParentLocally: true };

    const res = await ipc.handles.get('throng:preview:open')!(event(4), { ...req, webContentsId: 99 });

    expect(res).toEqual({ kind: 'placeLocally', reservation: 'r1', besidePanelId: null });
    expect(service.calls).toEqual([['open', 4, req]]);
  });

  it('open refuses a malformed request without asking the service', async () => {
    const ipc = fakeIpc();
    const service = recordingService();
    registerPreviewIpc(ipc, service);

    for (const bad of [null, 42, {}, { absPath: 7, projectId: 'P' }, { absPath: 'D:/p/a.md' }]) {
      expect(await ipc.handles.get('throng:preview:open')!(event(4), bad)).toEqual({
        kind: 'refused',
        reason: 'no-file',
      });
    }
    expect(service.calls).toEqual([]);
  });

  it('attach forwards panel, project, path, reservation and history; a bad history is dropped', async () => {
    const ipc = fakeIpc();
    const service = recordingService();
    registerPreviewIpc(ipc, service);
    const history = { v: 1, entries: [{ filePath: 'D:/p/a.md' }], index: 0 };

    const ok = await ipc.handles.get('throng:preview:attach')!(event(5), {
      panelId: 'v1',
      projectId: 'P',
      filePath: 'D:/p/a.md',
      reservation: 'r1',
      history,
    });
    await ipc.handles.get('throng:preview:attach')!(event(5), {
      panelId: 'v1',
      projectId: 'P',
      filePath: 'D:/p/a.md',
      history: 'nonsense',
    });

    expect(ok).toEqual({ ok: true, update: UPDATE });
    expect(service.calls).toEqual([
      ['attach', 5, { panelId: 'v1', projectId: 'P', filePath: 'D:/p/a.md', reservation: 'r1', history }],
      ['attach', 5, { panelId: 'v1', projectId: 'P', filePath: 'D:/p/a.md' }],
    ]);
  });

  it('attach refuses a malformed request as no-provider, which clears the panel (FR-067)', async () => {
    const ipc = fakeIpc();
    const service = recordingService();
    registerPreviewIpc(ipc, service);

    expect(await ipc.handles.get('throng:preview:attach')!(event(5), { panelId: 'v1' })).toEqual({
      ok: false,
      reason: 'no-provider',
    });
    expect(service.calls).toEqual([]);
  });

  it('navigate forwards a link or history intent, and refuses any other intent', async () => {
    const ipc = fakeIpc();
    const service = recordingService();
    registerPreviewIpc(ipc, service);
    const link = { panelId: 'v1', target: { absPath: 'D:/p/b.md', fragment: 'top' }, intent: { kind: 'link' } };
    const back = {
      panelId: 'v1',
      target: { absPath: 'D:/p/a.md' },
      intent: { kind: 'history', index: 0 },
      leavingViewState: { scrollTop: 12 },
    };

    expect(await ipc.handles.get('throng:preview:navigate')!(event(6), link)).toEqual({ kind: 'shown', update: UPDATE });
    await ipc.handles.get('throng:preview:navigate')!(event(6), back);
    const refused = await ipc.handles.get('throng:preview:navigate')!(event(6), {
      panelId: 'v1',
      target: { absPath: 'D:/p/b.md' },
      intent: { kind: 'teleport' },
    });

    expect(service.calls).toEqual([
      ['navigate', 6, link],
      ['navigate', 6, back],
    ]);
    expect(refused).toMatchObject({ kind: 'refused', notice: { kind: 'link-missing-file', target: 'D:/p/b.md' } });
  });

  it('navigate forwards a HEADING intent with both view states; arrivingViewState reaches no other intent (FR-115)', async () => {
    const ipc = fakeIpc();
    const service = recordingService();
    registerPreviewIpc(ipc, service);
    const jump = {
      panelId: 'v1',
      target: { absPath: 'D:/p/a.md', fragment: 'install' },
      intent: { kind: 'heading' },
      leavingViewState: { line: 0, offsetRatio: 0 },
      arrivingViewState: { line: 14, offsetRatio: 0 },
    };

    expect(await ipc.handles.get('throng:preview:navigate')!(event(6), { ...jump, intent: { kind: 'heading', index: 3 } })).toEqual({
      kind: 'shown',
      update: UPDATE,
    });
    await ipc.handles.get('throng:preview:navigate')!(event(6), {
      panelId: 'v1',
      target: { absPath: 'D:/p/b.md' },
      intent: { kind: 'link' },
      arrivingViewState: { line: 14, offsetRatio: 0 },
    });

    expect(service.calls).toEqual([
      // The intent is rebuilt from its kind: nothing else a renderer put on it crosses.
      ['navigate', 6, jump],
      ['navigate', 6, { panelId: 'v1', target: { absPath: 'D:/p/b.md' }, intent: { kind: 'link' } }],
    ]);
  });

  it('refresh and isOpen forward their one field', async () => {
    const ipc = fakeIpc();
    const service = recordingService();
    registerPreviewIpc(ipc, service);

    expect(await ipc.handles.get('throng:preview:refresh')!(event(1), { panelId: 'v1' })).toEqual({ update: UPDATE });
    expect(await ipc.handles.get('throng:preview:isOpen')!(event(1), { absPath: 'D:/p/a.md' })).toBe(true);
    expect(await ipc.handles.get('throng:preview:isOpen')!(event(1), { absPath: 3 })).toBe(false);
    expect(service.calls).toEqual([
      ['refresh', 'v1'],
      ['isOpen', 'D:/p/a.md'],
    ]);
  });

  it('openPaths takes no payload and returns the service’s compare-form paths (§1 amended)', async () => {
    const ipc = fakeIpc();
    const service = recordingService();
    registerPreviewIpc(ipc, service);

    expect(await ipc.handles.get('throng:preview:openPaths')!(event(2), undefined)).toEqual(['d:/p/a.md']);
    expect(service.calls).toEqual([['openPaths']]);
  });

  it('openPaths answers an empty seed, never a throw, when the service fails', async () => {
    const ipc = fakeIpc();
    registerPreviewIpc(ipc, recordingService({ openPaths: boom }));
    // `ipcMain.handle` resolves a plain return value exactly as it resolves a promise.
    expect(await ipc.handles.get('throng:preview:openPaths')!(event(2), undefined)).toEqual([]);
  });

  it('the four sends forward event.sender where it matters and ignore malformed payloads', () => {
    const ipc = fakeIpc();
    const service = recordingService();
    registerPreviewIpc(ipc, service);

    ipc.ons.get('throng:preview:detach')!(event(8), { panelId: 'v1' });
    ipc.ons.get('throng:preview:destroyed')!(event(8), { panelId: 'v1' });
    ipc.ons.get('throng:preview:publishEditorTitle')!(event(8), { panelId: 'ed1', title: 'Notes' });
    ipc.ons.get('throng:preview:placeDeclined')!(event(8), { requestId: 'q1' });
    for (const channel of ['detach', 'destroyed', 'publishEditorTitle', 'placeDeclined']) {
      ipc.ons.get(`throng:preview:${channel}`)!(event(8), null);
      ipc.ons.get(`throng:preview:${channel}`)!(event(8), { panelId: 5, title: 5, requestId: 5 });
    }

    expect(service.calls).toEqual([
      ['detach', 8, 'v1'],
      ['destroyed', 'v1'],
      ['publishEditorTitle', 'ed1', 'Notes'],
      ['placeDeclined', 'q1'],
    ]);
  });
});

describe('failures are returned, never thrown across the bridge', () => {
  it('every invoke resolves to a failure value when the service throws or rejects', async () => {
    const ipc = fakeIpc();
    registerPreviewIpc(
      ipc,
      recordingService({
        open: boom,
        attach: async () => boom(),
        navigate: boom,
        refresh: async () => boom(),
        isOpen: boom,
      }),
    );

    await expect(
      ipc.handles.get('throng:preview:open')!(event(1), { absPath: 'D:/p/a.md', projectId: 'P', hasParentLocally: false }),
    ).resolves.toEqual({ kind: 'refused', reason: 'no-file' });
    await expect(
      ipc.handles.get('throng:preview:attach')!(event(1), { panelId: 'v1', projectId: 'P', filePath: 'D:/p/a.md' }),
    ).resolves.toEqual({ ok: false, reason: 'failed' }); // not a verdict: the renderer keeps the panel
    await expect(
      ipc.handles.get('throng:preview:navigate')!(event(1), {
        panelId: 'v1',
        target: { absPath: 'D:/p/b.md' },
        intent: { kind: 'link' },
      }),
    ).resolves.toMatchObject({ kind: 'refused', notice: { kind: 'link-missing-file', target: 'D:/p/b.md' } });
    await expect(ipc.handles.get('throng:preview:refresh')!(event(1), { panelId: 'v1' })).resolves.toEqual({
      update: null,
    });
    // `ipcMain.handle` wraps a plain return in a promise, so a synchronous handler is a valid invoke.
    expect(await ipc.handles.get('throng:preview:isOpen')!(event(1), { absPath: 'D:/p/a.md' })).toBe(false);
  });

  /*
   * Adversarial review (main hardening) — a navigate that throws answers in the vocabulary of the INTENT it
   * carried. Back or Forward is not a link: `link-missing-file` would tell the reader a link was broken when
   * they pressed Back, so a history intent is `history-refused` naming its target, and the position stays.
   */
  it('a throwing navigate with a HISTORY intent answers history-refused, and a link intent link-missing-file', async () => {
    const ipc = fakeIpc();
    registerPreviewIpc(ipc, recordingService({ navigate: async () => boom() }));

    await expect(
      ipc.handles.get('throng:preview:navigate')!(event(1), {
        panelId: 'v1',
        target: { absPath: 'D:/p/a.md' },
        intent: { kind: 'history', index: 0 },
      }),
    ).resolves.toEqual({ kind: 'refused', notice: { kind: 'history-refused', target: 'D:/p/a.md', reason: 'unavailable' } });
    await expect(
      ipc.handles.get('throng:preview:navigate')!(event(1), {
        panelId: 'v1',
        target: { absPath: 'D:/p/b.md' },
        intent: { kind: 'link' },
      }),
    ).resolves.toEqual({ kind: 'refused', notice: { kind: 'link-missing-file', target: 'D:/p/b.md' } });
  });

  it('a send whose service call throws does not throw into ipcMain', () => {
    const ipc = fakeIpc();
    registerPreviewIpc(
      ipc,
      recordingService({ detach: boom, destroyed: boom, publishEditorTitle: boom, placeDeclined: boom }),
    );

    expect(() => ipc.ons.get('throng:preview:detach')!(event(1), { panelId: 'v1' })).not.toThrow();
    expect(() => ipc.ons.get('throng:preview:destroyed')!(event(1), { panelId: 'v1' })).not.toThrow();
    expect(() =>
      ipc.ons.get('throng:preview:publishEditorTitle')!(event(1), { panelId: 'ed1', title: 't' }),
    ).not.toThrow();
    expect(() => ipc.ons.get('throng:preview:placeDeclined')!(event(1), { requestId: 'q' })).not.toThrow();
  });
});

describe('main → renderer: push shapes and recipients (§2)', () => {
  function fakeWindow(id: number, opts: { destroyed?: boolean } = {}) {
    const sent: Array<[string, unknown]> = [];
    const contents = {
      id,
      isDestroyed: () => opts.destroyed === true,
      send: (channel: string, payload: unknown) => void sent.push([channel, payload]),
    };
    return { sent, contents, window: { isDestroyed: () => false, webContents: contents } };
  }

  function wiring() {
    const w1 = fakeWindow(1);
    const w2 = fakeWindow(2);
    const gone = fakeWindow(3, { destroyed: true });
    const all = [w1, w2, gone];
    const push = createPreviewPush({
      fromId: (id) => all.find((w) => w.contents.id === id)?.contents,
      all: () => all.map((w) => w.window),
    });
    return { w1, w2, gone, push };
  }

  it('update goes to the named viewer only', () => {
    const { w1, w2, push } = wiring();
    push.update(2, UPDATE);
    expect(w1.sent).toEqual([]);
    expect(w2.sent).toEqual([['throng:preview:update', UPDATE]]);
  });

  it('openChanged and pathChanged go to every live window and carry only their fields', () => {
    const { w1, w2, gone, push } = wiring();
    push.broadcastOpenChanged({ path: 'd:/p/a.md', open: true });
    push.broadcastPathChanged({ panelId: 'v1', filePath: 'D:/p/b.md' });
    for (const w of [w1, w2]) {
      expect(w.sent).toEqual([
        ['throng:preview:openChanged', { path: 'd:/p/a.md', open: true }],
        ['throng:preview:pathChanged', { panelId: 'v1', filePath: 'D:/p/b.md' }],
      ]);
    }
    expect(gone.sent).toEqual([]);
  });

  it('focus and place go to one window; a destroyed or unknown window is skipped', () => {
    const { w1, gone, push } = wiring();
    const place = { requestId: 'q1', absPath: 'D:/p/a.md', projectId: 'P', besidePanelId: 'ed1', reservation: 'r1' };
    push.sendFocus(1, { panelId: 'v1', fragment: 'intro' });
    push.sendPlace(1, place);
    expect(() => push.sendPlace(3, place)).not.toThrow();
    expect(() => push.update(42, UPDATE)).not.toThrow();
    expect(w1.sent).toEqual([
      ['throng:preview:focus', { panelId: 'v1', fragment: 'intro' }],
      ['throng:preview:place', place],
    ]);
    expect(gone.sent).toEqual([]);
  });

  /*
   * Adversarial review (main item 4, ruling) — `place` says whether it reached a window, so `PreviewService`
   * can treat a dead one as an immediate decline instead of holding the reservation for 10 s.
   */
  it('place answers whether it was delivered: false for a destroyed, unknown or throwing window', () => {
    const { push } = wiring();
    const place = { requestId: 'q1', absPath: 'D:/p/a.md', projectId: 'P', besidePanelId: 'ed1', reservation: 'r1' };
    const throwing = createPreviewPush({
      fromId: () => ({
        isDestroyed: () => false,
        send: () => {
          throw new Error('Object has been destroyed');
        },
      }),
      all: () => [],
    });

    expect(push.sendPlace(1, place)).toBe(true);
    expect(push.sendPlace(3, place)).toBe(false);
    expect(push.sendPlace(42, place)).toBe(false);
    expect(throwing.sendPlace(1, place)).toBe(false);
  });
});
