import { describe, expect, it } from 'vitest';
import { NETWORK_ELEVATION_REQUIRED, type ProcessReading, type ResourceNode } from '@throng/core';
import { FakeProcessMetrics } from '@throng/core/testing';
import type { CollectorToMain, MainToCollector, ResourceRoster } from '@throng/ipc-contract';
import { ResourceCollector } from '../../src/collector/collector.js';

/**
 * Contract (055 T024, contracts/collector-protocol.md §2): every message, both directions, in the
 * shapes the contract tables give. The collector runs in-process here over a fake OS; the real
 * process and its timing are `resource-collector.integration.test.ts`.
 */

const r = (pid: number, ppid: number, imageName = 'node.exe'): ProcessReading => ({
  pid, ppid, createTime: pid, imageName, cpuTime: pid * 10, privateWorkingSet: 100, ioReadBytes: 0, ioWriteBytes: 0,
});

const ROSTER: ResourceRoster = {
  daemonPid: 200,
  agentPid: null,
  terminals: [{ panelId: 'n1', projectId: 'p1', osPid: 300, conhostPid: null, attached: [], scrollbackChars: 0 }],
  locks: [{ path: 'C:/p', projectId: 'p1', pid: null, panelIds: ['n1'] }],
  ui: [{ pid: 100, role: 'main', label: 'Application' }],
};

const isMetrics = (m: unknown) =>
  typeof m === 'object' && m !== null && ['cpu', 'memory', 'gpu', 'ioRead', 'ioWrite', 'network'].every((k) => k in (m as object));

const nodes = (n: ResourceNode): ResourceNode[] => [n, ...n.children.flatMap(nodes)];

function run(opts: { osCallLimitMs?: number; roster?: ResourceRoster } = {}) {
  const out: CollectorToMain[] = [];
  const metrics = new FakeProcessMetrics([r(100, 1, 'throng.exe'), r(200, 1), r(300, 200, 'pwsh.exe'), r(301, 300)]);
  const roster = opts.roster ?? ROSTER;
  const collector: ResourceCollector = new ResourceCollector({
    metrics,
    collectorPid: 999,
    ...(opts.osCallLimitMs !== undefined ? { osCallLimitMs: opts.osCallLimitMs } : {}),
    send: (m) => {
      out.push(m);
      if (m.type === 'needRoster') queueMicrotask(() => collector.handle({ type: 'roster', roster, requestId: m.requestId }));
    },
  });
  const send = (m: MainToCollector) => collector.handle(m);
  const next = async (type: CollectorToMain['type']) => {
    for (let i = 0; i < 200; i++) {
      const found = out.find((m) => m.type === type);
      if (found) return found;
      await new Promise((res) => setTimeout(res, 10));
    }
    throw new Error(`no ${type}`);
  };
  return { collector, metrics, out, send, next };
}

describe('collector protocol (055 contract §2)', () => {
  it('accepts every main → collector message and answers in the contract’s shapes', async () => {
    const c = run();
    c.send({ type: 'configure', intervalSeconds: 0.05, historyMinutes: 5 });
    c.collector.start();

    const need = await c.next('needRoster');
    expect(need).toEqual({ type: 'needRoster', requestId: expect.any(Number) });

    const { summary } = (await c.next('summary')) as Extract<CollectorToMain, { type: 'summary' }>;
    expect(typeof summary.tick).toBe('number');
    expect(typeof summary.at).toBe('number');
    expect(summary.stale).toBe(false);
    expect(isMetrics(summary.total)).toBe(true);
    expect(summary.components.map((x) => x.id)).toEqual(['ui', 'daemon', 'helpers', 'projects']);
    expect(summary.components.every((x) => isMetrics(x.rolled))).toBe(true);
    expect(summary.machine).toEqual({ logicalProcessors: 4, installedRamBytes: 16 * 1024 ** 3 });

    c.send({
      type: 'context',
      context: {
        projects: [{ id: 'p1', name: 'P', state: 'active', listOrder: 0 }],
        tabs: [{ id: 't1', projectId: 'p1', name: 'T', subWorkspaceName: null, mounted: true }],
        panels: [{ id: 'n1', tabId: 't1', projectId: 'p1', name: 'pwsh', kind: 'terminal', mounted: true }],
      },
    });
    c.send({ type: 'estimates', estimates: [{ panelId: 'n1', target: 'buffers', source: 'daemon', pid: 200, memoryBytes: 10 }] });
    c.send({ type: 'detail', on: true });
    const { frame } = (await c.next('detailFrame')) as Extract<CollectorToMain, { type: 'detailFrame' }>;
    expect(frame.hierarchy.id).toBe('root');
    expect(nodes(frame.hierarchy).every((n) => isMetrics(n.own) && isMetrics(n.rolled))).toBe(true);
    expect(frame.held).toEqual([{ path: 'C:/p', projectId: 'p1', panels: [{ panelId: 'n1', tabName: 'T', panelName: 'pwsh' }] }]);

    c.send({ type: 'kill', requestId: 9, mode: 'process', nodeId: 'x:301:301', targets: ['301:301'] });
    const kill = (await c.next('killResult')) as Extract<CollectorToMain, { type: 'killResult' }>;
    expect(kill).toEqual({ type: 'killResult', requestId: 9, results: [{ key: '301:301', outcome: 'ended' }] });

    c.metrics.failNextSnapshot = new Error('readFailed');
    const err = (await c.next('error')) as Extract<CollectorToMain, { type: 'error' }>;
    expect(err).toEqual({ type: 'error', cause: 'readFailed' });
    c.collector.stop();
  });

  it('waits for the roster it asked for: a late answer to an earlier request does not end the wait (review #1)', async () => {
    const out: CollectorToMain[] = [];
    const metrics = new FakeProcessMetrics([r(100, 1, 'throng.exe'), r(200, 1), r(300, 200, 'pwsh.exe')]);
    const asks: number[] = [];
    const c: ResourceCollector = new ResourceCollector({
      metrics,
      collectorPid: 999,
      send: (m) => {
        out.push(m);
        if (m.type === 'needRoster') asks.push(m.requestId!);
      },
    });
    c.handle({ type: 'configure', intervalSeconds: 60, historyMinutes: 5 });
    c.start();
    for (let i = 0; i < 100 && asks.length === 0; i++) await new Promise((res) => setTimeout(res, 5));
    c.handle({ type: 'roster', roster: ROSTER, requestId: asks[0]! - 1 });
    await new Promise((res) => setTimeout(res, 50));
    expect(out.some((m) => m.type === 'summary')).toBe(false);
    c.handle({ type: 'roster', roster: ROSTER, requestId: asks[0]! });
    for (let i = 0; i < 100 && !out.some((m) => m.type === 'summary'); i++) await new Promise((res) => setTimeout(res, 5));
    expect(out.some((m) => m.type === 'summary')).toBe(true);
    c.stop();
  });

  it('a configure arriving before the first tick does not postpone it by a whole interval', async () => {
    // UI main configures the collector the moment it forks it; on a slow machine that message lands
    // before start()'s immediate tick has run, and used to push the first reading a full interval out.
    const c = run();
    c.collector.start();
    c.send({ type: 'configure', intervalSeconds: 60, historyMinutes: 5 });
    await c.next('summary');
    c.collector.stop();
  });

  it('marks figures stale, keeps their time, and keeps the open monitor fed when a tick fails (convergence T095)', async () => {
    const c = run();
    c.send({ type: 'configure', intervalSeconds: 0.05, historyMinutes: 5 });
    c.send({ type: 'detail', on: true });
    c.collector.start();
    const first = ((await c.next('detailFrame')) as Extract<CollectorToMain, { type: 'detailFrame' }>).frame;
    c.out.length = 0;
    c.metrics.failNextSnapshot = new Error('readFailed');
    const stale = ((await c.next('detailFrame')) as Extract<CollectorToMain, { type: 'detailFrame' }>).frame;
    const summary = ((await c.next('summary')) as Extract<CollectorToMain, { type: 'summary' }>).summary;
    expect(stale.stale).toBe(true);
    expect(stale.staleSince).toBe(first.at);
    expect(stale.tick).toBeGreaterThan(first.tick);
    expect(summary.stale).toBe(true);
    expect(summary.staleSince).toBe(first.at);
    c.collector.stop();
  });

  it('never stalls on a hung OS call: the tick times out, reports stale, and the loop carries on (convergence T091)', async () => {
    const c = run({ osCallLimitMs: 30 });
    c.send({ type: 'configure', intervalSeconds: 0.02, historyMinutes: 5 });
    c.collector.start();
    await c.next('summary');
    c.metrics.hangNextSnapshot = true;
    c.out.length = 0;
    const err = (await c.next('error')) as Extract<CollectorToMain, { type: 'error' }>;
    expect(err.cause).toBe('timedOut');
    c.out.length = 0;
    const fresh = ((await c.next('summary')) as Extract<CollectorToMain, { type: 'summary' }>).summary;
    expect(fresh.stale).toBe(false);
    c.collector.stop();
  });

  it('marks figures stale from the last good roster when the daemon cannot be read (convergence T094)', async () => {
    const c = run({ roster: { ...ROSTER, daemonStaleSince: 1234 } });
    c.send({ type: 'configure', intervalSeconds: 0.05, historyMinutes: 5 });
    c.collector.start();
    const { summary } = (await c.next('summary')) as Extract<CollectorToMain, { type: 'summary' }>;
    expect(summary.stale).toBe(true);
    expect(summary.staleSince).toBe(1234);
    c.collector.stop();
  });

  it('applies estimates in summary mode, where their panel can be placed (convergence T102)', async () => {
    const c = run();
    c.send({ type: 'configure', intervalSeconds: 0.05, historyMinutes: 5 });
    c.send({ type: 'estimates', estimates: [{ panelId: 'n1', target: 'buffers', source: 'daemon', pid: 200, memoryBytes: 60 }] });
    c.collector.start();
    const { summary } = (await c.next('summary')) as Extract<CollectorToMain, { type: 'summary' }>;
    const memory = (id: string) => summary.components.find((x) => x.id === id)!.rolled.memory;
    expect(memory('daemon')).toBe(40);
    expect(memory('projects')).toBe(260);
    c.collector.stop();
  });

  it('reads network on detail ticks only, and ships each process figure or its reason in the detail frame (FR-113)', async () => {
    const c = run();
    let reads = 0;
    const network = c.metrics.network.bind(c.metrics);
    c.metrics.network = () => {
      reads += 1;
      return network();
    };
    c.send({ type: 'configure', intervalSeconds: 0.05, historyMinutes: 5 });
    c.collector.start();
    await c.next('summary');
    await new Promise((res) => setTimeout(res, 150));
    expect(reads, 'summary-only ticks never read the network').toBe(0);

    c.metrics.networkReading = new Map([[301, 2_048]]);
    c.send({ type: 'detail', on: true });
    const { frame } = (await c.next('detailFrame')) as Extract<CollectorToMain, { type: 'detailFrame' }>;
    const proc = (pid: number) => nodes(frame.hierarchy).find((n) => n.process?.pid === pid)!;
    expect(proc(301).own.network).toBe(2_048);
    expect(proc(300).own.network, 'a process the trace did not see moved nothing').toBe(0);
    expect(reads).toBeGreaterThan(0);

    c.metrics.networkReading = { kind: 'unavailable', reason: NETWORK_ELEVATION_REQUIRED };
    c.out.length = 0;
    const next = (await c.next('detailFrame')) as Extract<CollectorToMain, { type: 'detailFrame' }>;
    const again = nodes(next.frame.hierarchy).find((n) => n.process?.pid === 301)!;
    expect(again.own.network).toEqual({ kind: 'unavailable', reason: NETWORK_ELEVATION_REQUIRED });
    c.collector.stop();
  });

  it('denies a kill of anything outside Projects, without touching it (FR-062)', async () => {
    const c = run();
    c.send({ type: 'configure', intervalSeconds: 0.05, historyMinutes: 5 });
    c.collector.start();
    await c.next('summary');
    c.send({ type: 'kill', requestId: 1, mode: 'process', nodeId: 'x:200:200', targets: ['200:200'] });
    const kill = (await c.next('killResult')) as Extract<CollectorToMain, { type: 'killResult' }>;
    expect(kill.results).toEqual([{ key: '200:200', outcome: 'denied', cause: 'notUsersProcess' }]);
    expect(c.metrics.terminated).toEqual([]);
    c.collector.stop();
  });
});
