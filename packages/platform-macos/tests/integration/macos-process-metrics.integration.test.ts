/**
 * Layer: integration. A real busy child and the real libproc: the figures are only as true as the kernel's units and
 * the Mach time base, which no fixture can check (070 FR-032, SC-006, research R2). `ps` is the independent witness.
 */
import { execFileSync, spawn } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { skipUnlessMacos } from '@throng/core/testing';
import { MACOS_GPU_UNAVAILABLE, MacosProcessMetrics } from '../../src/macos-process-metrics.js';

const ps = (pid: number, field: string): number => Number(execFileSync('ps', ['-o', `${field}=`, '-p', String(pid)], { encoding: 'utf8' }).trim());

describe.skipIf(skipUnlessMacos('reads libproc and proc_pid_rusage'))('MacosProcessMetrics against a busy child', () => {
  const metrics = new MacosProcessMetrics();

  it('reports the CPU a busy child burned in 100 ns units, agreeing with ps', { timeout: 20_000 }, async () => {
    const child = spawn(process.execPath, ['-e', 'for(;;){}'], { stdio: 'ignore' });
    try {
      await new Promise((resolve) => child.once('spawn', resolve));
      const reading = async () => (await metrics.snapshot()).readings.find((r) => r.pid === child.pid);
      await new Promise((resolve) => setTimeout(resolve, 200));
      const first = await reading();
      const firstAt = performance.now();
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const second = await reading();
      const elapsedSeconds = (performance.now() - firstAt) / 1000;
      const burnedSeconds = ((second?.cpuTime ?? 0) - (first?.cpuTime ?? 0)) / 10_000_000;
      // A spinning thread on a contended runner: most of one core, never several. A wrong time base is 41x off.
      expect(burnedSeconds).toBeGreaterThan(elapsedSeconds * 0.3);
      expect(burnedSeconds).toBeLessThan(elapsedSeconds * 2.5);
      // ps's cumulative CPU time, as `[[dd-]hh:]mm:ss.ss`, against ours for the same process.
      const psTime = execFileSync('ps', ['-o', 'time=', '-p', String(child.pid)], { encoding: 'utf8' }).trim();
      const [mm, ss] = psTime.split(':').slice(-2).map(Number);
      const ours = (second?.cpuTime ?? 0) / 10_000_000;
      expect(Math.abs(ours - ((mm ?? 0) * 60 + (ss ?? 0)))).toBeLessThan(1);
      expect(second?.imageName).toMatch(/node/);
    } finally {
      child.kill('SIGKILL');
    }
  });

  it('reports memory near what ps reports resident, and never more than several times it', { timeout: 20_000 }, async () => {
    const child = spawn(process.execPath, ['-e', 'const keep=Buffer.alloc(64*1024*1024,1);setInterval(()=>keep[0]++,1000)'], { stdio: 'ignore' });
    try {
      await new Promise((resolve) => child.once('spawn', resolve));
      await new Promise((resolve) => setTimeout(resolve, 800));
      const reading = (await metrics.snapshot()).readings.find((r) => r.pid === child.pid)!;
      const rssBytes = ps(child.pid!, 'rss') * 1024;
      // The footprint counts the 64 MiB the child wrote; resident counts it too, plus shared pages.
      expect(reading.privateWorkingSet).toBeGreaterThan(60 * 1024 * 1024);
      expect(reading.privateWorkingSet).toBeLessThan(rssBytes * 2);
    } finally {
      child.kill('SIGKILL');
    }
  });

  it('ends a process it started, and calls a stranger with the same pid gone', { timeout: 20_000 }, async () => {
    const child = spawn('sleep', ['60'], { stdio: 'ignore' });
    await new Promise((resolve) => child.once('spawn', resolve));
    const row = (await metrics.snapshot()).readings.find((r) => r.pid === child.pid);
    expect(row).toBeDefined();
    expect(await metrics.terminate(child.pid!, row!.createTime + 1)).toEqual({ outcome: 'gone' });
    expect(child.exitCode).toBeNull();
    expect(await metrics.terminate(child.pid!, row!.createTime)).toEqual({ outcome: 'ended' });
  });

  it('says why there is no GPU or network figure', async () => {
    expect(await metrics.gpu()).toEqual({ kind: 'unavailable', reason: MACOS_GPU_UNAVAILABLE });
    expect(await metrics.network()).toMatchObject({ kind: 'unavailable' });
  });
});
