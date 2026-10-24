/**
 * 055 T040, SC-004 — the collector in summary mode costs under 1% of one core on average.
 *
 * Layer: integration — the claim is about a real process reading the real process table and the real
 * GPU counters; its cost is its own CPU time as Windows reports it, which nothing in-process can stand
 * in for.
 *
 * Duration: 60 s, as SC-004 defines it: a shorter window over-weights a freshly forked collector's
 * unoptimised first ticks.
 *
 * Measured on the development machine, ~420 processes: 1.02% before the collector read only its own
 * session's processes, took GPU every other summary tick and computed figures only for throng's
 * processes; 0.52% after. Most of what is left is the kernel's process-table read, which grows with
 * everything running in the session, so the margin is real but not unlimited.
 *
 * Elevated, a second case opens the monitor once first, so the network trace (FR-113, research R20) is
 * running for the whole window: it is started on the first detail tick and kept, and SC-011 requires the
 * collector to stay inside SC-004 with it.
 */
import { fork } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { CollectorToMain, ResourceRoster } from '@throng/ipc-contract';
import { WindowsElevation, WindowsProcessMetrics } from '@throng/platform-windows';

const ENTRY = fileURLToPath(new URL('../../dist/collector/resource-collector-entry.js', import.meta.url));
const WINDOW_MS = 60_000;

/** Ten terminals' worth of roster, naming processes that may or may not exist — the attribution runs either way. */
const ROSTER: ResourceRoster = {
  daemonPid: process.pid,
  agentPid: null,
  terminals: Array.from({ length: 10 }, (_, i) => ({
    panelId: `n${i}`,
    projectId: 'p1',
    osPid: 900_000 + i,
    conhostPid: null,
    attached: [],
    scrollbackChars: 0,
  })),
  locks: [],
  ui: [{ pid: process.pid, role: 'main', label: 'Application' }],
};

const until = (done: () => boolean) =>
  new Promise<void>((resolve) => {
    const t = setInterval(() => done() && (clearInterval(t), resolve()), 50);
  });

async function measure(withTrace: boolean): Promise<void> {
  expect(existsSync(ENTRY), 'run npm run build first').toBe(true);
  const child = fork(ENTRY, [], { serialization: 'json', stdio: 'ignore' });
  try {
    let summaries = 0;
    let frames = 0;
    child.on('message', (raw) => {
      const m = raw as CollectorToMain;
      if (m.type === 'needRoster') child.send({ type: 'roster', roster: ROSTER });
      if (m.type === 'summary') summaries++;
      if (m.type === 'detailFrame') frames++;
    });
    child.send({ type: 'configure', intervalSeconds: 2, historyMinutes: 5 });
    if (withTrace) {
      // One detail tick starts the trace; it keeps running once the monitor closes.
      child.send({ type: 'detail', on: true });
      await until(() => frames > 1);
      child.send({ type: 'detail', on: false });
    }
    // Start measuring after the first tick, so process start-up is not counted as running cost.
    await until(() => summaries > 0);
    summaries = 0;
    const metrics = new WindowsProcessMetrics();
    const cpu = async () => (await metrics.snapshot()).readings.find((r) => r.pid === child.pid)!.cpuTime;
    const c0 = await cpu();
    const t0 = performance.now();
    await new Promise((r) => setTimeout(r, WINDOW_MS));
    const c1 = await cpu();
    const elapsedMs = performance.now() - t0;
    const percentOfOneCore = ((c1 - c0) / 10_000 / elapsedMs) * 100;
    expect(summaries).toBeGreaterThanOrEqual(WINDOW_MS / 2_000 - 1);
    expect(percentOfOneCore).toBeLessThan(1);
  } finally {
    // Disconnect, as main does: the collector then exits normally and stops its trace session. A kill is
    // TerminateProcess here, which runs no exit handler and would leave the session to the next collector.
    const exited = new Promise((r) => child.once('exit', r));
    if (child.connected) child.disconnect();
    await Promise.race([exited, new Promise((r) => setTimeout(r, 5_000))]);
    child.kill();
  }
}

describe('the collector’s own cost (055 SC-004)', () => {
  it('averages under 1% of one core in summary mode at the default 2 s interval', () => measure(false), WINDOW_MS + 15_000);

  it.skipIf(!new WindowsElevation().isElevated())(
    'stays under 1% of one core with the network trace running (SC-011)',
    () => measure(true),
    WINDOW_MS + 30_000,
  );
});
