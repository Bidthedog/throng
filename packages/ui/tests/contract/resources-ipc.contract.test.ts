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

function wire() {
  const ipc = fakeIpc();
  const { host, calls } = recordingHost();
  let opened = 0;
  const sent: Array<{ windowId: number; channel: string; payload: unknown }> = [];
  registerResourcesIpc(ipc, {
    host,
    windowIdOf: (sender) => (sender as unknown as { id: number }).id,
    osPidOf: (sender) => 9_000 + (sender as unknown as { id: number }).id,
    sendTo: (windowId, channel, payload) => (sent.push({ windowId, channel, payload }), true),
    openInMainWindow: () => void opened++,
  });
  return { ipc, calls, sent, opened: () => opened };
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
    ]);
    expect([...ipc.ons.keys()].sort()).toEqual(['throng:resources:open', 'throng:resources:panels']);
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

  it('asks the main window to open the monitor', () => {
    const w = wire();
    w.ipc.ons.get('throng:resources:open')!(from(5));
    expect(w.opened()).toBe(1);
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
      'throng:resources:open-request',
      'throng:resources:detail-demand:get',
      'throng:resources:detail-demand',
      'throng:resources:action:route',
      'throng:resources:action',
    ]) {
      expect(preload, channel).toContain(`'${channel}'`);
    }
  });
});
