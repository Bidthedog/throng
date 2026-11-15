import { describe, expect, it } from 'vitest';
import { runProcessMetricsContract } from '@throng/core/testing';
import { MACOS_GPU_UNAVAILABLE, MacosProcessMetrics } from '../../src/macos-process-metrics.js';
import { macosRelevantProcesses } from '../../src/macos-relevant-processes.js';
import { fakeLibSystem, type FakeProcess } from '../support/fake-libsystem.js';

const ME = 501;
const ROOT = 0;
const proc = (pid: number, ppid: number, uid: number, extra: Partial<FakeProcess> = {}): FakeProcess => ({
  pid,
  ppid,
  uid,
  comm: `p${pid}`,
  startedAt: 1_700_000_000_000 + pid,
  cpuUnits: 5_000_000n,
  ...extra,
});

/** launchd, a system daemon, this user's shell with a child, and a root `sudo` started beneath the shell. */
const machine = (): FakeProcess[] => [
  proc(1, 0, ROOT, { comm: 'launchd' }),
  proc(90, 1, ROOT, { comm: 'syslogd' }),
  proc(500, 1, ME, { comm: 'zsh' }),
  proc(501, 500, ME, { comm: 'node' }),
  proc(502, 500, ROOT, { comm: 'sudo', cpuUnits: undefined }),
];

describe('the macOS collector scope (070 FR-033)', () => {
  it('reads the user’s processes and those started beneath them, never the system’s', () => {
    const scope = macosRelevantProcesses(fakeLibSystem(machine()), ME);
    expect(scope.read().map((r) => r.pid).sort((a, b) => a - b)).toEqual([500, 501, 502]);
  });
});

describe('MacosProcessMetrics (070 FR-032, FR-034, research R2, R3)', () => {
  it('passes the shared process-metrics contract', async () => {
    const lib = fakeLibSystem([...machine(), proc(process.pid, 500, ME, { comm: 'node' })]);
    await runProcessMetricsContract({ make: () => new MacosProcessMetrics({ lib, scope: macosRelevantProcesses(lib, ME) }), selfPid: process.pid });
  });

  it('reports CPU in 100 ns ticks, memory as the physical footprint, and leaves out what it may not read', async () => {
    const lib = fakeLibSystem(machine().map((p) => (p.pid === 501 ? { ...p, cpuUnits: 2_000_000_000n, footprint: 7_000_000 } : p)));
    const metrics = new MacosProcessMetrics({ lib, scope: macosRelevantProcesses(lib, ME) });
    const snap = await metrics.snapshot();
    const node = snap.readings.find((r) => r.pid === 501)!;
    // 2,000,000,000 ns = 2 s = 20,000,000 ticks of 100 ns.
    expect(node).toMatchObject({ cpuTime: 20_000_000, privateWorkingSet: 7_000_000, imageName: 'node', ioReadBytes: 10, ioWriteBytes: 20 });
    expect(snap.readings.map((r) => r.pid)).not.toContain(502);
  });

  it('says why GPU and network are unavailable', async () => {
    const metrics = new MacosProcessMetrics({ lib: fakeLibSystem([]) });
    expect(await metrics.gpu()).toEqual({ kind: 'unavailable', reason: MACOS_GPU_UNAVAILABLE });
    expect(await metrics.network()).toMatchObject({ kind: 'unavailable', reason: expect.stringMatching(/network/) });
  });

  it('describes a process by its start time, and an ended one as ended', async () => {
    const lib = fakeLibSystem(machine());
    const metrics = new MacosProcessMetrics({ lib });
    expect(await metrics.describe(501, 1_700_000_000_501)).toMatchObject({ executablePath: '/bin/node' });
    expect(await metrics.describe(501, 1)).toEqual({ kind: 'unavailable', reason: 'The process has ended.' });
  });
});
