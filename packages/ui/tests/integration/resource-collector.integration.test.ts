/**
 * 055 T031 — the resource collector as a real process, driven over its Node IPC channel.
 *
 * Layer: integration — cadence, liveness and the channel itself (a tick that overruns, a parent that
 * disconnects, the first frame's latency) are properties of a separate process; no in-process fake
 * can show them. The OS is faked through the collector's composition root (THRONG_COLLECTOR_FAKE),
 * so the figures are deterministic; WindowsProcessMetrics has its own integration test.
 *
 * Needs `npm run build` first: it forks the built entry, as UI main does.
 */
import { fork, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { CollectorToMain, DetailFrame, ResourceRoster, ResourceSummary } from '@throng/ipc-contract';
import type { ProcessReading, ResourceNode } from '@throng/core';

const ENTRY = fileURLToPath(new URL('../../dist/collector/resource-collector-entry.js', import.meta.url));

const reading = (pid: number, ppid: number, cpuTime = 0, imageName = 'node.exe'): ProcessReading => ({
  pid,
  ppid,
  createTime: pid,
  imageName,
  cpuTime,
  privateWorkingSet: 1_000,
  ioReadBytes: 0,
  ioWriteBytes: 0,
});

/** UI main at 100, the daemon at 200, `terminals` shells each with `perShell` descendants. */
function machine(terminals: number, perShell: number, cpuTime = 0): { readings: ProcessReading[]; roster: ResourceRoster } {
  const readings = [reading(100, 1, cpuTime, 'throng.exe'), reading(200, 1, cpuTime)];
  const rosterTerminals: ResourceRoster['terminals'][number][] = [];
  for (let t = 0; t < terminals; t++) {
    const shell = 1_000 + t * 100;
    readings.push(reading(shell, 200, cpuTime, 'pwsh.exe'));
    for (let c = 1; c <= perShell; c++) readings.push(reading(shell + c, c === 1 ? shell : shell + c - 1, cpuTime));
    rosterTerminals.push({ panelId: `n${t}`, projectId: 'p1', osPid: shell, conhostPid: null, attached: [], scrollbackChars: 0 });
  }
  return {
    readings,
    roster: { daemonPid: 200, agentPid: null, terminals: rosterTerminals, locks: [], ui: [{ pid: 100, role: 'main', label: 'Application' }] },
  };
}

interface Harness {
  child: ChildProcess;
  messages: CollectorToMain[];
  next<T extends CollectorToMain['type']>(type: T, timeoutMs?: number): Promise<Extract<CollectorToMain, { type: T }>>;
  send(msg: object): void;
}

let harness: Harness | undefined;

function start(roster: ResourceRoster, readings: ProcessReading[], intervalSeconds = 0.2): Harness {
  const child = fork(ENTRY, [], { env: { ...process.env, THRONG_COLLECTOR_FAKE: '1' }, serialization: 'json', stdio: 'pipe' });
  const messages: CollectorToMain[] = [];
  const waiters: Array<{ type: string; resolve: (m: CollectorToMain) => void }> = [];
  child.on('message', (raw) => {
    const m = raw as CollectorToMain;
    messages.push(m);
    if (m.type === 'needRoster') child.send({ type: 'roster', roster });
    const i = waiters.findIndex((w) => w.type === m.type);
    if (i >= 0) waiters.splice(i, 1)[0]!.resolve(m);
  });
  const send = (msg: object) => child.send(msg);
  send({ type: 'test:readings', readings });
  send({ type: 'configure', intervalSeconds, historyMinutes: 5 });
  const h: Harness = {
    child,
    messages,
    send,
    // Generous by default: the first wait covers the fork's start-up, which a loaded hosted runner took over
    // 5 s to finish. Every latency the tests CLAIM (SC-002) passes its own bound and checks it by the clock.
    next: (type, timeoutMs = 15_000) =>
      new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`no ${type} within ${timeoutMs} ms`)), timeoutMs);
        waiters.push({ type, resolve: (m) => (clearTimeout(timer), resolve(m as never)) });
      }),
  };
  harness = h;
  return h;
}

const ids = (n: ResourceNode): string[] => [n.id, ...n.children.flatMap(ids)];
const find = (n: ResourceNode, id: string): ResourceNode | undefined =>
  n.id === id ? n : n.children.map((c) => find(c, id)).find((x) => x !== undefined);

beforeAll(() => {
  if (!existsSync(ENTRY)) throw new Error(`${ENTRY} is missing — run npm run build first`);
});

afterEach(() => {
  if (harness && harness.child.exitCode === null) harness.child.kill();
  harness = undefined;
});

describe('the resource collector process (055 T031, contracts/collector-protocol.md)', () => {
  it('asks for the roster at the start of every tick and sends a summary every interval', async () => {
    const { readings, roster } = machine(1, 1);
    const h = start(roster, readings, 0.2);
    const first = await h.next('summary');
    const second = await h.next('summary');
    expect(second.summary.tick).toBe(first.summary.tick + 1);
    expect(second.summary.at - first.summary.at).toBeGreaterThanOrEqual(150);
    const needs = h.messages.filter((m) => m.type === 'needRoster').length;
    const summaries = h.messages.filter((m) => m.type === 'summary').length;
    expect(needs).toBeGreaterThanOrEqual(summaries);
    expect(second.summary.components.map((c) => c.id)).toEqual(['ui', 'daemon', 'helpers', 'projects']);
  });

  it('never overlaps ticks: one that overruns the interval delays the next', async () => {
    const { readings, roster } = machine(1, 1);
    const h = start(roster, readings, 0.1);
    await h.next('summary');
    h.send({ type: 'test:delayMs', ms: 400 });
    const a = await h.next('summary');
    const b = await h.next('summary');
    expect(b.summary.at - a.summary.at).toBeGreaterThanOrEqual(390);
  });

  it('runs a tick AT ONCE on detail {on}, with rates already in the first frame, and stops on {off}', async () => {
    const { readings, roster } = machine(10, 20);
    const h = start(roster, readings, 30); // an interval long enough that only `detail` can explain a prompt frame
    await h.next('summary'); // the first reading: summary mode keeps it for the rates
    h.send({ type: 'test:readings', readings: machine(10, 20, 5_000_000).readings });
    const asked = Date.now();
    h.send({ type: 'detail', on: true });
    const { frame } = await h.next('detailFrame', 2_000);
    expect(Date.now() - asked).toBeLessThan(2_000); // SC-002
    const shell = find(frame.hierarchy, `x:1000:1000`)!;
    expect(typeof shell.own.cpu).toBe('number'); // a rate, not "not measured"
    expect(ids(frame.hierarchy).filter((id) => id.startsWith('x:')).length).toBe(2 + 10 * 21);

    h.send({ type: 'detail', on: false });
    h.send({ type: 'configure', intervalSeconds: 0.1, historyMinutes: 5 });
    await h.next('summary');
    const before = h.messages.filter((m) => m.type === 'detailFrame').length;
    await h.next('summary');
    await h.next('summary');
    expect(h.messages.filter((m) => m.type === 'detailFrame').length).toBe(before);
  });

  it('puts a descendant that appears in the next frame (SC-008)', async () => {
    const { readings, roster } = machine(1, 1);
    const h = start(roster, readings, 0.2);
    h.send({ type: 'detail', on: true });
    await h.next('detailFrame');
    h.send({ type: 'test:readings', readings: [...readings, reading(1_050, 1_001, 0, 'git.exe')] });
    let frame: DetailFrame | undefined;
    for (let i = 0; i < 3 && !frame?.hierarchy; i++) {
      const f = (await h.next('detailFrame')).frame;
      if (find(f.hierarchy, 'x:1050:1050')) frame = f;
    }
    expect(frame).toBeDefined();
    expect(find(find(frame!.hierarchy, 'n:n0')!, 'x:1050:1050')).toBeDefined();
  });

  it('reports a failed reading as an error and keeps the previous figures, marked stale', async () => {
    const { readings, roster } = machine(1, 1);
    const h = start(roster, readings, 0.2);
    const good: ResourceSummary = (await h.next('summary')).summary;
    h.send({ type: 'test:failNext' });
    const err = await h.next('error');
    expect(err.cause.length).toBeGreaterThan(0);
    const stale = (await h.next('summary')).summary;
    expect(stale.stale).toBe(true);
    expect(stale.total).toEqual(good.total);
  });

  it('exits within 1 s of the parent disconnecting', async () => {
    const { readings, roster } = machine(1, 1);
    const h = start(roster, readings, 0.2);
    await h.next('summary');
    const exited = new Promise<number>((resolve) => h.child.once('exit', () => resolve(Date.now())));
    const at = Date.now();
    h.child.disconnect();
    expect((await exited) - at).toBeLessThan(1_000);
  });
});
