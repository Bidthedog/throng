/**
 * Layer: integration — the figures come from Windows itself; only a real process table and real
 * processes can show they agree with an independent reading (055 FR-012, T020).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runProcessMetricsContract } from '@throng/core/testing';
import { WindowsProcessMetrics } from '../../src/windows-process-metrics.js';

const require = createRequire(import.meta.url);
const koffi = require('koffi');
const kernel32 = koffi.load('kernel32.dll');
const psapi = koffi.load('psapi.dll');
const OpenProcess = kernel32.func('OpenProcess', 'void *', ['uint32', 'bool', 'uint32']);
const CloseHandle = kernel32.func('CloseHandle', 'bool', ['void *']);
const GetProcessTimes = kernel32.func('GetProcessTimes', 'bool', ['void *', 'void *', 'void *', 'void *', 'void *']);
const GetProcessMemoryInfo = psapi.func('GetProcessMemoryInfo', 'bool', ['void *', 'void *', 'uint32']);
const QUERY = 0x1000 | 0x0400; // limited information | query information

/** An independent reading of the same counters, straight from the documented Win32 calls. */
function independent(pid: number): { cpuTicks: number; privateWorkingSet: number } {
  const h = OpenProcess(QUERY, false, pid);
  try {
    const c = Buffer.alloc(8), e = Buffer.alloc(8), k = Buffer.alloc(8), u = Buffer.alloc(8);
    GetProcessTimes(h, c, e, k, u);
    // PROCESS_MEMORY_COUNTERS_EX2: PrivateWorkingSetSize at 80 — the figure Task Manager shows.
    const pmc = Buffer.alloc(96);
    pmc.writeUInt32LE(96, 0);
    GetProcessMemoryInfo(h, pmc, 96);
    return {
      cpuTicks: Number(k.readBigInt64LE(0)) + Number(u.readBigInt64LE(0)),
      privateWorkingSet: Number(pmc.readBigUInt64LE(80)),
    };
  } finally {
    CloseHandle(h);
  }
}

const node = (script: string): ChildProcess => spawn(process.execPath, ['-e', script], { stdio: ['ignore', 'pipe', 'pipe'] });
const ready = (cp: ChildProcess) => new Promise<void>((r) => cp.stdout!.once('data', () => r()));

describe('WindowsProcessMetrics (055 T020, R2)', () => {
  const metrics = new WindowsProcessMetrics();
  const dir = mkdtempSync(join(tmpdir(), 'throng-055-'));
  let busy: ChildProcess;
  let big: ChildProcess;

  beforeAll(async () => {
    busy = node('process.stdout.write("go");for(;;){}');
    big = node('globalThis.b=Buffer.alloc(200*1024*1024,1);process.stdout.write("go");setInterval(()=>{},1e3)');
    await Promise.all([ready(busy), ready(big)]);
  });

  afterAll(() => {
    busy.kill();
    big.kill();
    rmSync(dir, { recursive: true, force: true });
  });

  it('satisfies the shared IProcessMetrics contract', async () => {
    await runProcessMetricsContract({ make: () => metrics, selfPid: process.pid });
  });

  it("agrees with GetProcessTimes on a busy child's CPU over 2 s, within 2 points", async () => {
    const pid = busy.pid!;
    const s1 = await metrics.snapshot();
    const i1 = independent(pid);
    await new Promise((r) => setTimeout(r, 2_000));
    const s2 = await metrics.snapshot();
    const i2 = independent(pid);
    const ours = (s: typeof s1) => s.readings.find((r) => r.pid === pid)!.cpuTime;
    const pct = (ticks: number, ms: number) => (ticks / 10_000 / ms) * 100;
    const elapsed = s2.wallTimeMs - s1.wallTimeMs;
    expect(Math.abs(pct(ours(s2) - ours(s1), elapsed) - pct(i2.cpuTicks - i1.cpuTicks, elapsed))).toBeLessThan(2);
  });

  it('reports a 200 MB child’s private working set within 5% of GetProcessMemoryInfo', async () => {
    const pid = big.pid!;
    const ours = (await metrics.snapshot()).readings.find((r) => r.pid === pid)!.privateWorkingSet;
    const theirs = independent(pid).privateWorkingSet;
    expect(ours).toBeGreaterThan(200 * 1024 * 1024);
    expect(Math.abs(ours - theirs) / theirs).toBeLessThan(0.05);
  });

  it('counts 10 MB written by a child in its I/O write bytes', async () => {
    const file = join(dir, 'out.bin').replace(/\\/g, '/');
    const writer = node(
      `process.stdout.write("go");process.stdin;setTimeout(()=>{require("fs").writeFileSync("${file}",Buffer.alloc(10*1024*1024,7));process.stdout.write("done")},300);setInterval(()=>{},1e3)`,
    );
    try {
      await ready(writer);
      const before = (await metrics.snapshot()).readings.find((r) => r.pid === writer.pid)!.ioWriteBytes;
      await new Promise<void>((r) => writer.stdout!.on('data', (d) => String(d).includes('done') && r()));
      const after = (await metrics.snapshot()).readings.find((r) => r.pid === writer.pid)!.ioWriteBytes;
      expect(after - before).toBeGreaterThanOrEqual(10 * 1024 * 1024);
    } finally {
      writer.kill();
    }
  });

  it('describes a child by its command line and executable path', async () => {
    const r = (await metrics.snapshot()).readings.find((x) => x.pid === busy.pid)!;
    const d = await metrics.describe(r.pid, r.createTime);
    expect(d).toMatchObject({ executablePath: process.execPath });
    expect((d as { commandLine?: string }).commandLine).toContain('for(;;){}');
  });

  it("never holds up the caller's event loop for more than 20 ms", async () => {
    let last = performance.now();
    let worst = 0;
    const t = setInterval(() => {
      const now = performance.now();
      worst = Math.max(worst, now - last - 10);
      last = now;
    }, 10);
    for (let i = 0; i < 10; i++) await metrics.snapshot();
    clearInterval(t);
    expect(worst).toBeLessThan(20);
  });
});
