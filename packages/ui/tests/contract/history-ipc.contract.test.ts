import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { NavigationHistory } from '@throng/core';
import {
  createHistoryPush,
  editorLoadHistoryFields,
  registerNavigationHistoryIpc,
  type HistoryIpcMain,
  type HistoryIpcService,
} from '../../src/main/navigation-history-ipc.js';

/**
 * Contract (044 T153): the `throng:history:*` surface and the `throng:files:moved` broadcast of
 * contracts/navigation-history.md §2 and §3 (*Path changes*).
 *
 * Driven through the handlers `registerNavigationHistoryIpc` actually registers, on a fake `ipcMain`,
 * over a fake service that records what reached it — so what is pinned is the WIRE: which channels
 * exist and of which kind, what each forwards, and that a failure is a value rather than a rejection.
 *
 * The one property this layer owns that no other can: `changed` is a BROADCAST. There is no viewer set
 * for a history and no per-window send — a window holding the panel in a background tab has detached
 * from it and must still mirror a Save-As rewrite or a purge into its layout (§2).
 *
 * The service's behaviour behind the wire is `navigation-history-service.integration.test.ts` (T137).
 */

type Listener = (event: unknown, payload: unknown) => unknown;

function fakeIpc(): HistoryIpcMain & { handles: Map<string, Listener>; ons: Map<string, Listener> } {
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

const HISTORY: NavigationHistory = { entries: [{ filePath: 'D:/p/a.md' }, { filePath: 'D:/p/b.md' }], index: 1 };
const EMPTY = { entries: [], index: -1 };

function recordingService(overrides: Partial<HistoryIpcService> = {}): HistoryIpcService & {
  calls: Array<[string, ...unknown[]]>;
} {
  const calls: Array<[string, ...unknown[]]> = [];
  return {
    calls,
    attach: (panelId, panelKind, persisted) => {
      calls.push(['attach', panelId, panelKind, persisted]);
      return HISTORY;
    },
    purge: (panelId) => void calls.push(['purge', panelId]),
    setCurrentViewState: (panelId, viewState) => void calls.push(['setCurrentViewState', panelId, viewState]),
    ...overrides,
  };
}

const boom = (): never => {
  throw new Error('service exploded');
};

function source(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');
}

describe('throng:history:* — channels and kinds (§2)', () => {
  it('registers one invoke and two sends, and nothing else — recording and moving have no channel', () => {
    const ipc = fakeIpc();
    registerNavigationHistoryIpc(ipc, recordingService());

    expect([...ipc.handles.keys()]).toEqual(['throng:history:attach']);
    expect([...ipc.ons.keys()].sort()).toEqual(['throng:history:purge', 'throng:history:setViewState']);
  });

  it('the preload and the renderer declaration name every channel, and files.onMoved', () => {
    const preload = source('../../src/preload/preload.cts');
    const globals = source('../../src/renderer/global.d.ts');
    expect(preload).toContain(`ipcRenderer.invoke('throng:history:attach'`);
    for (const channel of ['purge', 'setViewState']) {
      expect(preload).toContain(`ipcRenderer.send('throng:history:${channel}'`);
    }
    expect(preload).toContain(`ipcRenderer.on('throng:history:changed'`);
    expect(preload).toContain(`removeListener('throng:history:changed'`);
    expect(preload).toContain(`ipcRenderer.on('throng:files:moved'`);
    expect(preload).toContain(`removeListener('throng:files:moved'`);

    expect(globals).toContain('history?: {');
    for (const member of ['attach:', 'purge:', 'setViewState:', 'onChanged:', 'onMoved?:']) {
      expect(globals).toContain(member);
    }
    // `changed` can say "purged" (§2, amended): a renderer typed against the declaration must handle it.
    expect(globals).toContain(`history: import('@throng/core').NavigationHistory | null`);
  });
});

describe('renderer → main: request shapes and forwarding (§2)', () => {
  it('attach forwards panel id, kind and persisted history, and answers the record', async () => {
    const ipc = fakeIpc();
    const service = recordingService();
    registerNavigationHistoryIpc(ipc, service);
    const persisted = { v: 1, entries: [{ filePath: 'D:/p/a.md' }], index: 0 };

    const withHistory = await ipc.handles.get('throng:history:attach')!(event(3), {
      panelId: 'ed1',
      panelKind: 'editor',
      persisted,
    });
    await ipc.handles.get('throng:history:attach')!(event(3), { panelId: 'pv1', panelKind: 'preview' });

    expect(withHistory).toEqual(HISTORY);
    expect(service.calls).toEqual([
      ['attach', 'ed1', 'editor', persisted],
      ['attach', 'pv1', 'preview', undefined],
    ]);
  });

  it('attach drops a persisted value that is not a v1 history, rather than refusing the attach', async () => {
    const ipc = fakeIpc();
    const service = recordingService();
    registerNavigationHistoryIpc(ipc, service);

    for (const persisted of ['nonsense', 42, { v: 2, entries: [], index: 0 }, { v: 1, entries: 'x', index: 0 }]) {
      await ipc.handles.get('throng:history:attach')!(event(3), { panelId: 'ed1', panelKind: 'editor', persisted });
    }

    expect(service.calls.map((c) => c[3])).toEqual([undefined, undefined, undefined, undefined]);
  });

  it('attach refuses a malformed request with an empty history, without asking the service', async () => {
    const ipc = fakeIpc();
    const service = recordingService();
    registerNavigationHistoryIpc(ipc, service);

    for (const bad of [null, 7, {}, { panelId: 'ed1' }, { panelId: 'ed1', panelKind: 'terminal' }, { panelId: 5, panelKind: 'editor' }]) {
      expect(await ipc.handles.get('throng:history:attach')!(event(3), bad)).toEqual(EMPTY);
    }
    expect(service.calls).toEqual([]);
  });

  it('purge and setViewState forward their fields and ignore malformed payloads', () => {
    const ipc = fakeIpc();
    const service = recordingService();
    registerNavigationHistoryIpc(ipc, service);

    ipc.ons.get('throng:history:purge')!(event(2), { panelId: 'ed1' });
    ipc.ons.get('throng:history:setViewState')!(event(2), { panelId: 'pv1', viewState: { line: 4 } });
    for (const channel of ['purge', 'setViewState']) {
      ipc.ons.get(`throng:history:${channel}`)!(event(2), null);
      ipc.ons.get(`throng:history:${channel}`)!(event(2), { panelId: 9 });
    }
    // A viewState of `undefined` is a real value here: it clears the entry's (FR-107).
    ipc.ons.get('throng:history:setViewState')!(event(2), { panelId: 'pv1' });

    expect(service.calls).toEqual([
      ['purge', 'ed1'],
      ['setCurrentViewState', 'pv1', { line: 4 }],
      ['setCurrentViewState', 'pv1', undefined],
    ]);
  });
});

describe('throng:editor:load — its history fields (§3, §6 amended)', () => {
  it('carries a well-formed navigation intent and a v1 persisted history through', () => {
    const history = { v: 1, entries: [{ filePath: 'D:/p/a.md' }], index: 0 };
    expect(
      editorLoadHistoryFields({
        panelId: 'ed1',
        absPath: 'D:/p/a.md',
        navigation: { kind: 'history', index: 0, filePath: 'D:/p/a.md' },
        history,
      }),
    ).toEqual({ navigation: { kind: 'history', index: 0, filePath: 'D:/p/a.md' }, history });
  });

  it('a plain load carries neither field at all', () => {
    expect(editorLoadHistoryFields({ panelId: 'ed1', absPath: 'D:/p/a.md' })).toEqual({});
  });

  it('drops a malformed intent or history rather than refusing the load', () => {
    for (const navigation of [
      { kind: 'link', index: 0, filePath: 'D:/p/a.md' },
      { kind: 'history', index: 1.5, filePath: 'D:/p/a.md' },
      { kind: 'history', index: 0, filePath: '' },
      'back',
    ]) {
      expect(editorLoadHistoryFields({ navigation })).toEqual({});
    }
    for (const history of ['nonsense', { v: 2, entries: [], index: 0 }, { v: 1, entries: {}, index: 0 }, null]) {
      expect(editorLoadHistoryFields({ history })).toEqual({});
    }
  });
});

describe('failures are returned, never thrown across the bridge', () => {
  it('attach answers an empty history when the service throws', async () => {
    const ipc = fakeIpc();
    registerNavigationHistoryIpc(ipc, recordingService({ attach: boom }));
    expect(await ipc.handles.get('throng:history:attach')!(event(1), { panelId: 'ed1', panelKind: 'editor' })).toEqual(
      EMPTY,
    );
  });

  it('a send whose service call throws does not throw into ipcMain', () => {
    const ipc = fakeIpc();
    registerNavigationHistoryIpc(ipc, recordingService({ purge: boom, setCurrentViewState: boom }));
    expect(() => ipc.ons.get('throng:history:purge')!(event(1), { panelId: 'ed1' })).not.toThrow();
    expect(() => ipc.ons.get('throng:history:setViewState')!(event(1), { panelId: 'pv1', viewState: 1 })).not.toThrow();
  });
});

describe('main → renderer: changed and files:moved are broadcasts (§2, §3)', () => {
  function fakeWindow(id: number, opts: { destroyed?: boolean } = {}) {
    const sent: Array<[string, unknown]> = [];
    const contents = {
      id,
      isDestroyed: () => opts.destroyed === true,
      send: (channel: string, payload: unknown) => void sent.push([channel, payload]),
    };
    return { sent, window: { isDestroyed: () => false, webContents: contents } };
  }

  it('changed reaches EVERY live window — there is no per-window or viewer-set send at all', () => {
    const w1 = fakeWindow(1);
    const w2 = fakeWindow(2);
    const gone = fakeWindow(3, { destroyed: true });
    const push = createHistoryPush({ all: () => [w1.window, w2.window, gone.window] });

    push.broadcastChanged({ panelId: 'pv1', history: HISTORY });

    // A purge is `history: null` (§2, amended) — distinct from an empty history a first attach can send.
    push.broadcastChanged({ panelId: 'pv2', history: null });

    for (const w of [w1, w2]) {
      expect(w.sent).toEqual([
        ['throng:history:changed', { panelId: 'pv1', history: HISTORY }],
        ['throng:history:changed', { panelId: 'pv2', history: null }],
      ]);
    }
    expect(gone.sent).toEqual([]);
    // The push has no way to name a window: a broadcast is the only thing it can do.
    expect(Object.keys(push).sort()).toEqual(['broadcastChanged', 'broadcastFilesMoved']);
  });

  it('files:moved reaches every live window carrying the moves and nothing else', () => {
    const w1 = fakeWindow(1);
    const w2 = fakeWindow(2);
    const push = createHistoryPush({ all: () => [w1.window, w2.window] });
    const moves = [{ from: 'D:/p/a.md', to: 'D:/p/docs/a.md' }];

    push.broadcastFilesMoved(moves);

    for (const w of [w1, w2]) expect(w.sent).toEqual([['throng:files:moved', { moves }]]);
  });

  it('a window that throws on send does not stop the broadcast reaching the next', () => {
    const bad = {
      isDestroyed: () => false,
      webContents: { id: 1, isDestroyed: () => false, send: boom },
    };
    const good = fakeWindow(2);
    const push = createHistoryPush({ all: () => [bad, good.window] });
    expect(() => push.broadcastChanged({ panelId: 'ed1', history: HISTORY })).not.toThrow();
    expect(good.sent).toHaveLength(1);
  });
});
