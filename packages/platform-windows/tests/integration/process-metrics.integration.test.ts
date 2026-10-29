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
const OpenProcess = kernel32.func('OpenProcess', 'void *', ['uint32', 'bool', 'uint32']);
const CloseHandle = kernel32.func('CloseHandle', 'bool', ['void *']);
const GetProcessTimes = kernel32.func('GetProcessTimes', 'bool', ['void *', 'void *', 'void *', 'void *', 'void *']);
const pdh = koffi.load('pdh.dll');
const PdhOpenQueryW = pdh.func('PdhOpenQueryW', 'uint32', ['void *', 'uintptr_t', '_Out_ void **']);
const PdhAddEnglishCounterW = pdh.func('PdhAddEnglishCounterW', 'uint32', ['void *', 'str16', 'uintptr_t', '_Out_ void **']);
const PdhCollectQueryData = pdh.func('PdhCollectQueryData', 'uint32', ['void *']);
const PdhGetFormattedCounterArrayW = pdh.func('PdhGetFormattedCounterArrayW', 'uint32', ['void *', 'uint32', '_Inout_ uint32 *', '_Out_ uint32 *', 'void *']);
const PdhCloseQuery = pdh.func('PdhCloseQuery', 'uint32', ['void *']);
const QUERY = 0x1000 | 0x0400; // limited information | query information
const PDH_FMT_LARGE = 0x400;
/** PDH_FMT_COUNTERVALUE_ITEM_W on x64: name pointer, then {CStatus, pad, int64}. */
const ITEM_SIZE = 24;

/** An independent reading of the same CPU counters, straight from the documented Win32 call. */
function independent(pid: number): { cpuTicks: number } {
  const h = OpenProcess(QUERY, false, pid);
  try {
    const c = Buffer.alloc(8), e = Buffer.alloc(8), k = Buffer.alloc(8), u = Buffer.alloc(8);
    GetProcessTimes(h, c, e, k, u);
    return { cpuTicks: Number(k.readBigInt64LE(0)) + Number(u.readBigInt64LE(0)) };
  } finally {
    CloseHandle(h);
  }
}

/** One counter of every \Process instance, by instance name. */
function counterByInstance(counter: unknown): Map<string, number> {
  const size = [0];
  const count = [0];
  PdhGetFormattedCounterArrayW(counter, PDH_FMT_LARGE, size, count, null);
  const buf = Buffer.alloc(size[0]!);
  PdhGetFormattedCounterArrayW(counter, PDH_FMT_LARGE, size, count, buf);
  const out = new Map<string, number>();
  for (let i = 0; i < count[0]!; i++) {
    const name = koffi.decode(buf, i * ITEM_SIZE, 'str16');
    out.set(name, Number(buf.readBigInt64LE(i * ITEM_SIZE + 16)));
  }
  return out;
}

/**
 * The process's private working set — the figure Task Manager shows — from the performance counter
 * \Process(*)\Working Set - Private, matched to the pid through ID Process. Not GetProcessMemoryInfo:
 * its PrivateWorkingSetSize needs PROCESS_MEMORY_COUNTERS_EX2, which Windows Server 2022 (the CI
 * runner) does not have, so it reads 0 there.
 */
function privateWorkingSetOf(pid: number): number {
  const q = [null];
  const ws = [null];
  const id = [null];
  expect(PdhOpenQueryW(null, 0, q)).toBe(0);
  try {
    expect(PdhAddEnglishCounterW(q[0], '\\Process(*)\\Working Set - Private', 0, ws)).toBe(0);
    expect(PdhAddEnglishCounterW(q[0], '\\Process(*)\\ID Process', 0, id)).toBe(0);
    PdhCollectQueryData(q[0]);
    const ids = counterByInstance(id[0]);
    const sizes = counterByInstance(ws[0]);
    const instance = [...ids].find(([, p]) => p === pid)?.[0];
    expect(instance, `no \\Process instance has ID Process ${pid}`).toBeDefined();
    return sizes.get(instance!)!;
  } finally {
    PdhCloseQuery(q[0]);
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

  it('reports a 200 MB child’s private working set within 5% of the Working Set - Private counter', async () => {
    const pid = big.pid!;
    const ours = (await metrics.snapshot()).readings.find((r) => r.pid === pid)!.privateWorkingSet;
    const theirs = privateWorkingSetOf(pid);
    expect(theirs).toBeGreaterThan(0);
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
