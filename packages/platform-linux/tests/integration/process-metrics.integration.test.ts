import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { skipUnlessLinux } from '@throng/core/testing';
import { LinuxGpuUsage, LinuxProcessMetrics, LINUX_NETWORK_UNAVAILABLE } from '@throng/platform-linux';

/**
 * Layer: integration. A real busy child and a real `/proc`: the figures are only as true as the kernel's units, which
 * no fixture can check (062 FR-037, SC-009).
 */
describe.skipIf(skipUnlessLinux('reads /proc'))('LinuxProcessMetrics against a busy child', () => {
  const metrics = new LinuxProcessMetrics(new LinuxGpuUsage(async () => []));

  it('reports CPU a busy child burned, in 100 ns units, and some memory', { timeout: 20_000 }, async () => {
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
      // A spinning thread on a contended runner: most of one core, never several.
      expect(burnedSeconds).toBeGreaterThan(elapsedSeconds * 0.3);
      expect(burnedSeconds).toBeLessThan(elapsedSeconds * 2.5);
      expect(second?.privateWorkingSet).toBeGreaterThan(1024 * 1024);
      expect(second?.imageName).toMatch(/node/);
    } finally {
      child.kill('SIGKILL');
    }
  });

  it('reports memory the process holds itself, not the shared files it has mapped (055 FR-030)', { timeout: 20_000 }, async () => {
    const child = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore' });
    try {
      await new Promise((resolve) => child.once('spawn', resolve));
      await new Promise((resolve) => setTimeout(resolve, 500));
      const reading = (await metrics.snapshot()).readings.find((r) => r.pid === child.pid)!;
      const figure = reading.privateWorkingSet;
      // The kernel's own full accounting, which is too costly to read every tick but is the truth to compare with.
      const rollup = readFileSync(`/proc/${child.pid}/smaps_rollup`, 'utf8');
      const kb = (name: string): number => Number(new RegExp(`^${name}:\\s+(\\d+) kB`, 'm').exec(rollup)?.[1]) * 1024;
      expect(Math.abs(figure - kb('Anonymous'))).toBeLessThan(8 * 1024 * 1024);
      expect(figure).toBeLessThan(kb('Rss') - 5 * 1024 * 1024);
    } finally {
      child.kill('SIGKILL');
    }
  });

  it('holds a reading\'s I/O counters at the tick that first asked, so the next tick\'s difference is a rate', { timeout: 20_000 }, async () => {
    const writer = "const fs=require('fs');setInterval(()=>fs.writeFileSync('/dev/null',Buffer.alloc(65536)),20)";
    const child = spawn(process.execPath, ['-e', writer], { stdio: 'ignore' });
    try {
      await new Promise((resolve) => child.once('spawn', resolve));
      await new Promise((resolve) => setTimeout(resolve, 300));
      const first = (await metrics.snapshot()).readings.find((r) => r.pid === child.pid)!;
      const written = first.ioWriteBytes;
      await new Promise((resolve) => setTimeout(resolve, 500));
      expect(first.ioWriteBytes).toBe(written);
      const second = (await metrics.snapshot()).readings.find((r) => r.pid === child.pid)!;
      expect(second.ioWriteBytes).toBeGreaterThan(written);
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

  it('says why there is no network figure, and why there may be no GPU one', async () => {
    expect(await metrics.network()).toEqual({ kind: 'unavailable', reason: LINUX_NETWORK_UNAVAILABLE });
    expect(await metrics.gpu()).toMatchObject({ kind: 'unavailable' });
  });
});
