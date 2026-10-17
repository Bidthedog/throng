/**
 * 055 T073, FR-062 – FR-063a, R8 — the collector ends real processes, and only the user's.
 *
 * Layer: integration — ending a process by its identity, leaves first, and refusing anything outside
 * Projects are claims about real processes in the real process table. The collector runs in-process
 * over the real `WindowsProcessMetrics`; its process boundary is `resource-collector.integration.test.ts`.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import { killOrder, type ResourceNode } from '@throng/core';
import type { CollectorToMain, DetailFrame, KillResult, ResourceRoster } from '@throng/ipc-contract';
import { WindowsProcessMetrics } from '@throng/platform-windows';
import { ResourceCollector } from '../../src/collector/collector.js';

/** A parent that starts a child that starts a grandchild; prints the three pids, then idles. */
const TREE = `
const { spawn } = require('child_process');
const idle = 'setInterval(()=>{},1e3)';
const grand = "const c=require('child_process').spawn(process.execPath,['-e',\\"" + idle + "\\"],{stdio:'ignore'});process.stdout.write(String(c.pid));" + idle;
const child = spawn(process.execPath, ['-e', grand], { stdio: ['ignore', 'pipe', 'ignore'] });
child.stdout.once('data', (d) => process.stdout.write(JSON.stringify([process.pid, child.pid, Number(String(d))])));
${'setInterval(()=>{},1e3)'};
`;

let parent: ChildProcess | undefined;
let collector: ResourceCollector | undefined;

afterEach(() => {
  collector?.stop();
  parent?.kill();
});

async function setUp() {
  parent = spawn(process.execPath, ['-e', TREE], { stdio: ['ignore', 'pipe', 'ignore'] });
  const pids = await new Promise<number[]>((resolve) => parent!.stdout!.once('data', (d) => resolve(JSON.parse(String(d)))));
  const roster: ResourceRoster = {
    daemonPid: null,
    agentPid: null,
    terminals: [{ panelId: 'n1', projectId: 'p1', osPid: pids[0]!, conhostPid: null, attached: [], scrollbackChars: 0 }],
    locks: [],
    ui: [{ pid: process.pid, role: 'main', label: 'Application' }],
  };
  const frames: DetailFrame[] = [];
  const kills = new Map<number, (r: KillResult) => void>();
  const metrics = new WindowsProcessMetrics();
  const c: ResourceCollector = new ResourceCollector({
    metrics,
    collectorPid: process.pid,
    send: (m: CollectorToMain) => {
      if (m.type === 'needRoster') queueMicrotask(() => c.handle({ type: 'roster', roster }));
      if (m.type === 'detailFrame') frames.push(m.frame);
      if (m.type === 'killResult') kills.get(m.requestId)?.({ results: m.results });
    },
  });
  collector = c;
  c.handle({ type: 'configure', intervalSeconds: 0.25, historyMinutes: 5 });
  c.handle({ type: 'detail', on: true });
  c.start();
  const frame = async (): Promise<DetailFrame> => {
    const n = frames.length;
    for (let i = 0; i < 100 && frames.length === n; i++) await new Promise((r) => setTimeout(r, 25));
    return frames[frames.length - 1]!;
  };
  let requestId = 0;
  const kill = (mode: 'process' | 'below', nodeId: string, targets: string[]) =>
    new Promise<KillResult>((resolve) => {
      kills.set(++requestId, resolve);
      c.handle({ type: 'kill', requestId, mode, nodeId, targets });
    });
  const alive = async (pid: number) => (await metrics.snapshot()).readings.some((r) => r.pid === pid);
  // A terminated process stays in the table while anything holds its handle — node's own ChildProcess
  // does until it observes the exit — so wait for it to leave, bounded.
  const gone = async (pid: number) => {
    for (let i = 0; i < 40; i++) {
      if (!(await alive(pid))) return true;
      await new Promise((r) => setTimeout(r, 50));
    }
    return false;
  };
  return { pids, frame, kill, alive, gone };
}

const find = (n: ResourceNode, pred: (n: ResourceNode) => boolean): ResourceNode | undefined =>
  pred(n) ? n : n.children.map((c) => find(c, pred)).find((x) => x !== undefined);

describe('killing from the collector (055 T073)', () => {
  it('Kill All Below a process ends the whole tree, leaves first', async () => {
    const s = await setUp();
    const f = await s.frame();
    const top = find(f.hierarchy, (n) => n.process?.pid === s.pids[0])!;
    const order = killOrder(top, { isEnded: () => false });
    const res = await s.kill('below', top.id, order);
    expect(res.results.map((r) => r.outcome)).toEqual(['ended', 'ended', 'ended']);
    expect(res.results.map((r) => Number(r.key.split(':')[0]))).toEqual([s.pids[2], s.pids[1], s.pids[0]]);
    for (const pid of s.pids) expect(await s.gone(pid)).toBe(true);
  });

  it('Kill Process ends only its target; its parent lives', async () => {
    const s = await setUp();
    const f = await s.frame();
    const mid = find(f.hierarchy, (n) => n.process?.pid === s.pids[1])!;
    const res = await s.kill('process', mid.id, [mid.process!.key]);
    expect(res.results).toEqual([{ key: mid.process!.key, outcome: 'ended' }]);
    expect(await s.gone(s.pids[1]!)).toBe(true);
    expect(await s.alive(s.pids[0]!)).toBe(true);
  });

  it('denies a target outside Projects and leaves it running (FR-062)', async () => {
    const s = await setUp();
    const f = await s.frame();
    const ui = find(f.hierarchy, (n) => n.process?.pid === process.pid)!;
    const res = await s.kill('process', ui.id, [ui.process!.key]);
    expect(res.results).toEqual([{ key: ui.process!.key, outcome: 'denied', cause: 'notUsersProcess' }]);
    expect(await s.alive(process.pid)).toBe(true);
  });

  it('never ends a process whose identity no longer matches (a reused pid)', async () => {
    const s = await setUp();
    const f = await s.frame();
    const top = find(f.hierarchy, (n) => n.process?.pid === s.pids[0])!;
    const stale = `${s.pids[0]}:${top.process!.createTime + 1}`;
    const res = await s.kill('process', top.id, [stale]);
    expect(res.results[0]!.outcome).not.toBe('ended');
    expect(await s.alive(s.pids[0]!)).toBe(true);
  });
});
