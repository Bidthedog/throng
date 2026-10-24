import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { KillRequest, KillResult, PanelEstimate, ResourceSummary, WorkspaceContext } from '@throng/ipc-contract';
import { registerResourcesIpc, type ResourcesIpcHost, type ResourcesIpcMain } from '../../src/main/resources-ipc.js';

/**
 * Contract (055 T035): the `throng:resources:*` surface of contracts/resources-ipc-055.md, driven
 * through the handlers `registerResourcesIpc` registers on a fake `ipcMain`, over a host that records
 * what reached it. Pinned: which channels exist and of which kind, what each forwards, and that every
 * invoke resolves — a malformed request is answered, never thrown back to the renderer (FR-064).
 */

type Listener = (event: unknown, ...args: unknown[]) => unknown;

function fakeIpc(): ResourcesIpcMain & { handles: Map<string, Listener>; ons: Map<string, Listener> } {
  const handles = new Map<string, Listener>();
  const ons = new Map<string, Listener>();
  return {
    handles,
    ons,
    handle: (channel, listener) => void handles.set(channel, listener as Listener),
    on: (channel, listener) => void ons.set(channel, listener as Listener),
  };
}

const SUMMARY: ResourceSummary = {
  tick: 1,
  at: 1,
  stale: false,
  total: { cpu: 1, memory: 2, gpu: 0, ioRead: 0, ioWrite: 0 },
  components: [],
  machine: { logicalProcessors: 1, installedRamBytes: 1 },
};

function recordingHost() {
  const calls: Array<[string, ...unknown[]]> = [];
  const host: ResourcesIpcHost = {
    latestSummary: () => SUMMARY,
    detailDemand: () => true,
    windowHolding: (kind, id) => (kind === 'tab' && id === 't-sub' ? 4 : null),
    subscribe: (windowId) => (calls.push(['subscribe', windowId]), 41),
    unsubscribe: (id) => void calls.push(['unsubscribe', id]),
    reportPanels: (windowId, ctx, est) => void calls.push(['reportPanels', windowId, ctx, est]),
    kill: async (req: KillRequest): Promise<KillResult> => (calls.push(['kill', req]), { results: [{ key: req.targets[0]!, outcome: 'ended' }] }),
  };
  return { host, calls };
}

function wire(opts: { mainWindowId?: number | null; statusRectTimeoutMs?: number } = {}) {
  const ipc = fakeIpc();
  const { host, calls } = recordingHost();
  let opened = 0;
  const minimised: unknown[] = [];
  let view: unknown = null;
  const sent: Array<{ windowId: number; channel: string; payload: unknown }> = [];
  const toMain: Array<{ channel: string; payload: unknown }> = [];
  const surface = registerResourcesIpc(ipc, {
    host,
    windowIdOf: (sender) => (sender as unknown as { id: number }).id,
    osPidOf: (sender) => 9_000 + (sender as unknown as { id: number }).id,
    sendTo: (windowId, channel, payload) => (sent.push({ windowId, channel, payload }), true),
    mainWindowId: () => (opts.mainWindowId === undefined ? 1 : opts.mainWindowId),
    postToMainWindow: (channel, payload) => (toMain.push({ channel, payload }), true),
    monitor: {
      open: () => void opened++,
      minimise: (o) => void minimised.push(o),
      viewState: () => view,
      saveViewState: (v) => void (view = v),
    },
    ...(opts.statusRectTimeoutMs !== undefined ? { statusRectTimeoutMs: opts.statusRectTimeoutMs } : {}),
  });
  return { ipc, calls, sent, toMain, minimised, surface, opened: () => opened };
}

const from = (id: number) => ({ sender: { id } });

describe('throng:resources:* (055 contracts/resources-ipc-055.md)', () => {
  it('registers exactly the contract’s channels, each of its kind', () => {
    const { ipc } = wire();
    expect([...ipc.handles.keys()].sort()).toEqual([
      'throng:resources:action:route',
      'throng:resources:detail-demand:get',
      'throng:resources:detail:subscribe',
      'throng:resources:detail:unsubscribe',
      'throng:resources:kill',
      'throng:resources:summary:get',
      'throng:resources:view:get',
    ]);
    expect([...ipc.ons.keys()].sort()).toEqual([
      'throng:resources:minimise',
      'throng:resources:open',
      'throng:resources:panels',
      'throng:resources:status-rect:reply',
      'throng:resources:view:set',
    ]);
  });

  it('answers summary() with the cached summary', async () => {
    const { ipc } = wire();
    expect(await ipc.handles.get('throng:resources:summary:get')!(from(1))).toEqual(SUMMARY);
    expect(await ipc.handles.get('throng:resources:detail-demand:get')!(from(1))).toBe(true);
  });

  it('subscribes the asking window, and unsubscribes by id', async () => {
    const { ipc, calls } = wire();
    expect(await ipc.handles.get('throng:resources:detail:subscribe')!(from(7))).toEqual({ subscriptionId: 41 });
    await ipc.handles.get('throng:resources:detail:unsubscribe')!(from(7), 41);
    expect(calls).toEqual([['subscribe', 7], ['unsubscribe', 41]]);
  });

  it("forwards a window's panels: its context and its estimates", () => {
    const { ipc, calls } = wire();
    const context: WorkspaceContext = { projects: [], tabs: [], panels: [] };
    const estimates: PanelEstimate[] = [{ panelId: 'e', target: 'panel', source: 'renderer', pid: 0, memoryBytes: 1 }];
    ipc.ons.get('throng:resources:panels')!(from(3), { context, estimates });
    ipc.ons.get('throng:resources:panels')!(from(3), { context: null, estimates: [] });
    expect(calls).toEqual([
      // A renderer cannot learn its own OS pid: main stamps it, or the memory could not be moved.
      ['reportPanels', 3, context, [{ ...estimates[0], pid: 9_003 }]],
      ['reportPanels', 3, null, []],
    ]);
  });

  it('relays a kill and resolves with its result; a malformed one resolves empty, never rejects', async () => {
    const { ipc, calls } = wire();
    const req: KillRequest = { mode: 'below', nodeId: 'n:1', targets: ['5:1'] };
    expect(await ipc.handles.get('throng:resources:kill')!(from(1), req)).toEqual({ results: [{ key: '5:1', outcome: 'ended' }] });
    expect(await ipc.handles.get('throng:resources:kill')!(from(1), { mode: 'everything' })).toEqual({ results: [] });
    expect(calls.filter((c) => c[0] === 'kill')).toHaveLength(1);
  });

  it('routes a Destroy to the window holding the tab, and answers false when none does (R12)', async () => {
    const w = wire();
    const route = w.ipc.handles.get('throng:resources:action:route')!;
    expect(await route(from(1), { action: 'destroyTab', id: 't-sub' })).toBe(true);
    expect(w.sent).toEqual([{ windowId: 4, channel: 'throng:resources:action', payload: { action: 'destroyTab', id: 't-sub' } }]);
    expect(await route(from(1), { action: 'destroyPanel', id: 'nowhere' })).toBe(false);
    expect(await route(from(1), { action: 'deleteEverything', id: 'x' })).toBe(false);
  });

  it('routes Unload Project to the main window, which comes forward to confirm it (R14, FR-086)', async () => {
    const w = wire({ mainWindowId: 2 });
    const route = w.ipc.handles.get('throng:resources:action:route')!;
    const req = { action: 'unloadProject', id: 'p1', name: 'Alpha', variant: 'endTerminals' };
    expect(await route(from(9), req)).toBe(true);
    expect(w.sent).toEqual([{ windowId: 2, channel: 'throng:resources:action', payload: req }]);
    expect(await route(from(9), { action: 'unloadProject', id: 'p1', name: 'Alpha', variant: 'everything' })).toBe(false);
    expect(await route(from(9), { action: 'unloadProject', id: 'p1' })).toBe(false);
    expect(await wire({ mainWindowId: null }).ipc.handles.get('throng:resources:action:route')!(from(9), req)).toBe(false);
  });

  it('routes Activate to the window holding the tab, which comes forward (FR-110)', async () => {
    const w = wire({ mainWindowId: 2 });
    const route = w.ipc.handles.get('throng:resources:action:route')!;
    const req = { action: 'activate', projectId: 'p1', tabId: 't-sub', panelId: 'n1' };
    expect(await route(from(9), req)).toBe(true);
    expect(w.sent).toEqual([{ windowId: 4, channel: 'throng:resources:action', payload: req }]);
  });

  it('routes Activate to the main window when no window holds the tab, or for a project: it switches project first (FR-110)', async () => {
    const w = wire({ mainWindowId: 2 });
    const route = w.ipc.handles.get('throng:resources:action:route')!;
    expect(await route(from(9), { action: 'activate', projectId: 'p2', tabId: 't-other' })).toBe(true);
    expect(await route(from(9), { action: 'activate', projectId: 'p2' })).toBe(true);
    expect(w.sent).toEqual([
      { windowId: 2, channel: 'throng:resources:action', payload: { action: 'activate', projectId: 'p2', tabId: 't-other' } },
      { windowId: 2, channel: 'throng:resources:action', payload: { action: 'activate', projectId: 'p2' } },
    ]);
  });

  it('answers false for a malformed Activate, or with no main window to take it', async () => {
    const route = wire({ mainWindowId: 2 }).ipc.handles.get('throng:resources:action:route')!;
    expect(await route(from(9), { action: 'activate' })).toBe(false);
    expect(await route(from(9), { action: 'activate', projectId: 'p1', tabId: 5 })).toBe(false);
    expect(await route(from(9), { action: 'activate', projectId: 'p1', panelId: 'n1' })).toBe(false);
    const none = wire({ mainWindowId: null }).ipc.handles.get('throng:resources:action:route')!;
    expect(await none(from(9), { action: 'activate', projectId: 'p1' })).toBe(false);
  });

  it('opens the monitor window from any window (R14, FR-086)', () => {
    const w = wire();
    w.ipc.ons.get('throng:resources:open')!(from(5));
    expect(w.opened()).toBe(1);
  });

  it('minimises with the renderer’s reduced-motion answer, and ignores a malformed request (FR-085)', () => {
    const w = wire();
    w.ipc.ons.get('throng:resources:minimise')!(from(9), { reducedMotion: true });
    w.ipc.ons.get('throng:resources:minimise')!(from(9), 'nonsense');
    expect(w.minimised).toEqual([{ reducedMotion: true }, { reducedMotion: false }]);
  });

  it('holds the view between openings (FR-087)', async () => {
    const w = wire();
    expect(await w.ipc.handles.get('throng:resources:view:get')!(from(9))).toBeNull();
    w.ipc.ons.get('throng:resources:view:set')!(from(9), { metric: 'memory' });
    expect(await w.ipc.handles.get('throng:resources:view:get')!(from(9))).toEqual({ metric: 'memory' });
  });

  it('asks the main window for the status-bar rectangle and takes its matching reply (FR-085)', async () => {
    const w = wire();
    const pending = w.surface.requestStatusRect();
    expect(w.toMain).toHaveLength(1);
    const { channel, payload: requestId } = w.toMain[0]!;
    expect(channel).toBe('throng:resources:status-rect:request');
    const reply = w.ipc.ons.get('throng:resources:status-rect:reply')!;
    reply(from(1), { requestId: (requestId as number) + 100, rect: { x: 9, y: 9, width: 9, height: 9 } });
    reply(from(1), { requestId, rect: { x: 1, y: 2, width: 3, height: 4 } });
    expect(await pending).toEqual({ x: 1, y: 2, width: 3, height: 4 });
  });

  it('answers null for no reply, a malformed reply, or no main window', async () => {
    const silent = wire({ statusRectTimeoutMs: 5 });
    expect(await silent.surface.requestStatusRect()).toBeNull();

    const malformed = wire();
    const pending = malformed.surface.requestStatusRect();
    malformed.ipc.ons.get('throng:resources:status-rect:reply')!(from(1), { requestId: malformed.toMain[0]!.payload, rect: { x: 'a' } });
    expect(await pending).toBeNull();
  });

  it('is what the preload exposes, member for channel', () => {
    const preload = readFileSync(fileURLToPath(new URL('../../src/preload/preload.cts', import.meta.url)), 'utf8');
    for (const channel of [
      'throng:resources:summary:get',
      'throng:resources:summary',
      'throng:resources:detail:subscribe',
      'throng:resources:detail:unsubscribe',
      'throng:resources:detail',
      'throng:resources:panels',
      'throng:resources:kill',
      'throng:resources:open',
      'throng:resources:minimise',
      'throng:resources:view:get',
      'throng:resources:view:set',
      'throng:resources:status-rect:request',
      'throng:resources:status-rect:reply',
      'throng:resources:detail-demand:get',
      'throng:resources:detail-demand',
      'throng:resources:action:route',
      'throng:resources:action',
    ]) {
      expect(preload, channel).toContain(`'${channel}'`);
    }
    expect(preload, 'open-request is retired with the modal (R14)').not.toContain('throng:resources:open-request');
  });
});
