import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_APP_SETTINGS, editorMainBytes, previewMainBytes, terminalDaemonBytes } from '@throng/core';
import type { CollectorToMain, DaemonRoster, MainToCollector, ResourceSummary } from '@throng/ipc-contract';
import { COLLECTOR_EXIT_GRACE_MS, ResourceMonitorHost, type CollectorChild, type ResourceMonitorHostDeps } from '../../src/main/resource-monitor-host.js';

/** 055 T033 — UI main's side of the collector: fork, roster, relays, subscriptions, estimates. */

class FakeChild extends EventEmitter implements CollectorChild {
  readonly sent: MainToCollector[] = [];
  connected = true;
  send(msg: MainToCollector): boolean {
    this.sent.push(msg);
    return true;
  }
  killed = false;
  disconnected = false;
  kill(): boolean {
    this.connected = false;
    this.killed = true;
    return true;
  }
  disconnect(): void {
    this.connected = false;
    this.disconnected = true;
  }
  /** The collector speaks. */
  say(msg: CollectorToMain): void {
    this.emit('message', msg);
  }
  last<T extends MainToCollector['type']>(type: T): Extract<MainToCollector, { type: T }> | undefined {
    return [...this.sent].reverse().find((m) => m.type === type) as never;
  }
}

const ROSTER: DaemonRoster = {
  daemonPid: 200,
  agentPid: null,
  terminals: [{ panelId: 'n1', projectId: 'p1', osPid: 300, conhostPid: null, attached: [], scrollbackChars: 1_000 }],
  locks: [],
};

const summary = (tick: number): ResourceSummary => ({
  tick,
  at: tick,
  stale: false,
  total: { cpu: 1, memory: 2, gpu: 0, ioRead: 0, ioWrite: 0 },
  components: [],
  machine: { logicalProcessors: 4, installedRamBytes: 8 },
});

function make(over: Partial<ResourceMonitorHostDeps> = {}) {
  const children: FakeChild[] = [];
  const forks: Array<{ entry: string; execPath: string }> = [];
  const pushes: Array<{ windowId: number; channel: string; payload: unknown }> = [];
  let now = 0;
  let settings = structuredClone(DEFAULT_APP_SETTINGS);
  const deps: ResourceMonitorHostDeps = {
    collectorEntry: 'C:/dist/collector/resource-collector-entry.js',
    nodeExe: 'C:/runtime/node.exe',
    fork: (entry, execPath) => {
      forks.push({ entry, execPath });
      const c = new FakeChild();
      children.push(c);
      return c;
    },
    daemonRoster: async () => ROSTER,
    uiProcesses: () => [{ pid: 100, role: 'main', label: 'Application' }],
    documentEstimates: () => [
      { panelId: 'e1', chars: 500, lines: 10 },
      { panelId: 'e2', chars: 0, lines: 0, sharedWith: 'e1' },
    ],
    previewEstimates: () => [],
    settings: () => settings,
    send: (windowId, channel, payload) => pushes.push({ windowId, channel, payload }),
    mainWindowId: () => 1,
    broadcast: (channel, payload) => pushes.push({ windowId: -1, channel, payload }),
    now: () => now,
    ...over,
  };
  const host = new ResourceMonitorHost(deps);
  return {
    host,
    children,
    forks,
    pushes,
    child: () => children[children.length - 1]!,
    advance: (ms: number) => (now += ms),
    setSettings: (s: typeof settings) => (settings = s),
  };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('ResourceMonitorHost (055 T033, R1, R7)', () => {
  it('stops the collector by disconnecting, so it exits normally and stops its network trace; kills only one that does not exit (FR-113, R20)', () => {
    vi.useFakeTimers();
    try {
      const s = make();
      s.host.start();
      const c = s.child();
      s.host.stop();
      expect(c.disconnected).toBe(true);
      expect(c.killed, 'a kill is TerminateProcess: no exit handler runs').toBe(false);
      vi.advanceTimersByTime(COLLECTOR_EXIT_GRACE_MS);
      expect(c.killed, 'a collector that never exited is killed').toBe(true);

      s.host.start();
      const d = s.child();
      s.host.stop();
      d.emit('exit', 0);
      vi.advanceTimersByTime(COLLECTOR_EXIT_GRACE_MS);
      expect(d.killed, 'one that exited is left alone').toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('forks the collector with the bundled runtime and configures it with resolved settings', () => {
    const s = make();
    s.host.start();
    expect(s.forks).toEqual([{ entry: 'C:/dist/collector/resource-collector-entry.js', execPath: 'C:/runtime/node.exe' }]);
    expect(s.child().last('configure')).toEqual({ type: 'configure', intervalSeconds: 2, historyMinutes: 5 });
  });

  it('reconfigures on a settings change, with the cross-field rules applied', () => {
    const s = make();
    s.host.start();
    const next = structuredClone(DEFAULT_APP_SETTINGS);
    next.resourceMonitor.historyMinutes = 12;
    s.setSettings(next);
    s.host.settingsChanged();
    expect(s.child().last('configure')).toEqual({ type: 'configure', intervalSeconds: 15, historyMinutes: 12 });
  });

  it('answers needRoster with the daemon roster merged with the UI processes', async () => {
    const s = make();
    s.host.start();
    s.child().say({ type: 'needRoster' });
    await flush();
    expect(s.child().last('roster')!.roster).toEqual({ ...ROSTER, ui: [{ pid: 100, role: 'main', label: 'Application' }] });
  });

  it('reads the UI processes once, until told they changed — never per tick', async () => {
    let reads = 0;
    const s = make({ uiProcesses: () => (reads++, []) });
    s.host.start();
    for (let i = 0; i < 3; i++) {
      s.child().say({ type: 'needRoster' });
      await flush();
    }
    expect(reads).toBe(1);
    s.host.uiChanged();
    s.child().say({ type: 'needRoster' });
    await flush();
    expect(reads).toBe(2);
  });

  it('keeps the last good daemon roster, marked with its time, when the daemon cannot be read (convergence T094)', async () => {
    let fail = false;
    const s = make({ daemonRoster: async () => (fail ? Promise.reject(new Error('daemon-unreachable')) : ROSTER) });
    s.host.start();
    s.advance(5_000);
    s.child().say({ type: 'needRoster' });
    await flush();
    fail = true;
    s.advance(2_000);
    s.child().say({ type: 'needRoster' });
    await flush();
    expect(s.child().last('roster')!.roster).toMatchObject({ daemonPid: 200, terminals: ROSTER.terminals, daemonStaleSince: 5_000 });
  });

  it('sends UI main and daemon estimates in summary mode too (convergence T102)', async () => {
    const s = make();
    s.host.start();
    s.child().say({ type: 'needRoster' });
    await flush();
    expect(s.child().last('estimates')!.estimates).toContainEqual({
      panelId: 'n1', target: 'buffers', source: 'daemon', pid: 200, memoryBytes: terminalDaemonBytes(1_000),
    });
  });

  it('keeps tick numbers increasing across a collector restart (convergence T096)', () => {
    const s = make();
    s.host.start();
    s.child().say({ type: 'summary', summary: summary(40) });
    s.child().emit('exit', 1);
    s.child().say({ type: 'summary', summary: summary(1) });
    const ticks = s.pushes.filter((p) => p.channel === 'throng:resources:summary').map((p) => (p.payload as ResourceSummary).tick);
    expect(ticks[ticks.length - 1]).toBeGreaterThan(40);
    expect(s.host.latestSummary()!.tick).toBeGreaterThan(40);
  });

  it('fails a pending kill as collectorUnavailable when the collector exits (convergence T103)', async () => {
    const s = make();
    s.host.start();
    const p = s.host.kill({ mode: 'process', nodeId: 'x:1:1', targets: ['1:1'] });
    s.child().emit('exit', 1);
    expect(await p).toEqual({ results: [{ key: '1:1', outcome: 'failed', cause: 'collectorUnavailable' }] });
  });

  it('reports an unreachable daemon as daemonPid null rather than failing the tick', async () => {
    const s = make({ daemonRoster: async () => Promise.reject(new Error('daemon-unreachable')) });
    s.host.start();
    s.child().say({ type: 'needRoster' });
    await flush();
    expect(s.child().last('roster')!.roster).toMatchObject({ daemonPid: null, terminals: [], locks: [] });
  });

  it('caches the latest summary and pushes it to the main window only', () => {
    const s = make();
    s.host.start();
    expect(s.host.latestSummary()).toBeNull();
    s.child().say({ type: 'summary', summary: summary(1) });
    expect(s.host.latestSummary()).toEqual(summary(1));
    expect(s.pushes).toEqual([{ windowId: 1, channel: 'throng:resources:summary', payload: summary(1) }]);
  });

  it('turns detail on with the first subscriber, sends frames only to subscribers, and off with the last', () => {
    const s = make();
    s.host.start();
    const a = s.host.subscribe(7);
    const b = s.host.subscribe(8);
    expect(s.child().sent.filter((m) => m.type === 'detail')).toEqual([{ type: 'detail', on: true }]);
    const frame = { tick: 1, at: 1, stale: false, hierarchy: {} as never, held: [], machine: summary(1).machine };
    s.child().say({ type: 'detailFrame', frame });
    expect(s.pushes.filter((p) => p.channel === 'throng:resources:detail').map((p) => p.windowId)).toEqual([7, 8]);
    s.host.unsubscribe(a);
    s.host.unsubscribe(b);
    expect(s.child().last('detail')).toEqual({ type: 'detail', on: false });
    expect(s.pushes.filter((p) => p.channel === 'throng:resources:detail-demand').map((p) => p.payload)).toEqual([true, false]);
    expect(s.host.detailDemand()).toBe(false);
  });

  it('releases a closed window’s subscription', () => {
    const s = make();
    s.host.start();
    s.host.subscribe(7);
    s.host.windowClosed(7);
    expect(s.child().last('detail')).toEqual({ type: 'detail', on: false });
  });

  it("adds main's per-document and the daemon's scrollback estimates to the renderer's, while detail is on", async () => {
    const s = make();
    s.host.start();
    s.host.subscribe(1);
    s.host.reportPanels(1, null, [{ panelId: 'e1', target: 'panel', source: 'renderer', pid: 101, memoryBytes: 10 }]);
    s.child().say({ type: 'needRoster' });
    await flush();
    const estimates = s.child().last('estimates')!.estimates;
    expect(estimates).toContainEqual({ panelId: 'e1', target: 'panel', source: 'renderer', pid: 101, memoryBytes: 10 });
    expect(estimates).toContainEqual({ panelId: 'e1', target: 'panel', source: 'main', pid: process.pid, memoryBytes: editorMainBytes(500, 10, { linked: false }) });
    expect(estimates).toContainEqual({ panelId: 'e2', target: 'panel', source: 'main', pid: process.pid, memoryBytes: 0, sharedWith: 'e1' });
    expect(estimates).toContainEqual({ panelId: 'n1', target: 'buffers', source: 'daemon', pid: 200, memoryBytes: terminalDaemonBytes(1_000) });
  });

  it("adds main's copy of each preview's text to the preview panel", async () => {
    const s = make({ previewEstimates: () => [{ panelId: 'v1', chars: 2_000 }] });
    s.host.start();
    s.host.subscribe(1);
    s.child().say({ type: 'needRoster' });
    await flush();
    expect(s.child().last('estimates')!.estimates).toContainEqual({ panelId: 'v1', target: 'panel', source: 'main', pid: process.pid, memoryBytes: previewMainBytes(2_000) });
  });

  it('names the window holding a mounted tab or panel, from what windows reported', () => {
    const s = make();
    s.host.start();
    s.host.subscribe(1);
    s.host.reportPanels(4, {
      projects: [],
      tabs: [{ id: 't', projectId: 'p', name: 'T', subWorkspaceName: 'S', mounted: true }],
      panels: [{ id: 'n', tabId: 't', projectId: 'p', name: 'N', kind: 'editor', mounted: false }],
    }, []);
    expect(s.host.windowHolding('tab', 't')).toBe(4);
    expect(s.host.windowHolding('panel', 'n')).toBeNull();
  });

  it('restarts a collector that exits unexpectedly, at most once a minute', () => {
    const s = make();
    s.host.start();
    s.child().emit('exit', 1);
    expect(s.forks).toHaveLength(2);
    s.advance(10_000);
    s.child().emit('exit', 1);
    expect(s.forks).toHaveLength(2);
    s.advance(60_000);
    s.host.tickRestart();
    expect(s.forks).toHaveLength(3);
  });

  it('survives an error from the collector process: a failed spawn or a dying pipe never throws in main', () => {
    const s = make();
    s.host.start();
    expect(() => s.child().emit('error', new Error('spawn node ENOENT'))).not.toThrow();
  });

  it('builds the kill message from its own fields, so a request cannot pass itself off as another message', () => {
    const s = make();
    s.host.start();
    const forged = { mode: 'process', nodeId: 'x:1:1', targets: ['1:1'], type: 'configure', requestId: 99, intervalSeconds: 0 };
    void s.host.kill(forged as never);
    const sent = s.child().sent[s.child().sent.length - 1]!;
    expect(sent).toEqual({ type: 'kill', requestId: expect.any(Number), mode: 'process', nodeId: 'x:1:1', targets: ['1:1'] });
    expect((sent as { requestId: number }).requestId).not.toBe(99);
  });

  it('echoes the collector’s roster request id', async () => {
    const s = make();
    s.host.start();
    s.child().say({ type: 'needRoster', requestId: 7 });
    await flush();
    expect(s.child().last('roster')!.requestId).toBe(7);
  });

  it('relays a kill and resolves with its result; a stopped collector fails it without rejecting', async () => {
    const s = make();
    s.host.start();
    const p = s.host.kill({ mode: 'process', nodeId: 'x:1:1', targets: ['1:1'] });
    const req = s.child().last('kill')!;
    s.child().say({ type: 'killResult', requestId: req.requestId, results: [{ key: '1:1', outcome: 'ended' }] });
    expect(await p).toEqual({ results: [{ key: '1:1', outcome: 'ended' }] });
    s.host.stop();
    expect(await s.host.kill({ mode: 'process', nodeId: 'x:1:1', targets: ['1:1'] })).toEqual({
      results: [{ key: '1:1', outcome: 'failed', cause: 'collectorUnavailable' }],
    });
  });
});
