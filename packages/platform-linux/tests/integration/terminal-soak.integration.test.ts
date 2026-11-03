import { readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { skipUnlessLinux } from '@throng/core/testing';
import { LinuxPtyHost } from '@throng/platform-linux';

/**
 * Layer: integration. Tagged `regression`: a leak only shows after many cycles, so this runs in the gate, not on every
 * pull request (062 T053). Real shells, and the kernel's own count of what this process holds open.
 */
const openDescriptors = (): number => readdirSync('/proc/self/fd').length;

const liveChildren = (): number => {
  let count = 0;
  for (const name of readdirSync('/proc')) {
    if (!/^\d+$/.test(name)) continue;
    try {
      const stat = readFileSync(`/proc/${name}/stat`, 'utf8');
      const [state, ppid] = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
      if (Number(ppid) === process.pid && state !== 'Z') count += 1;
    } catch {
      // Gone while being read.
    }
  }
  return count;
};

describe.skipIf(skipUnlessLinux('real shells'))('echo latency with 10 terminals open (062 SC-006)', () => {
  it('is printed on every run, and recorded rather than judged off reference hardware', { tags: ['regression'], timeout: 60_000 }, async () => {
    const host = new LinuxPtyHost({ graceMs: 100 });
    const handles = Array.from({ length: 10 }, () =>
      host.start({ file: '/bin/bash', args: ['--norc', '--noprofile', '-i'], cwd: tmpdir(), cols: 80, rows: 24 }),
    );
    const samples: number[] = [];
    try {
      for (let i = 0; i < 30; i += 1) {
        const handle = handles[i % handles.length]!;
        const marker = `M${i}Z`;
        const echoed = new Promise<void>((resolve) => {
          const stop = host.onData(handle, (chunk) => {
            if (chunk.includes(marker)) {
              stop();
              resolve();
            }
          });
        });
        const at = performance.now();
        host.write(handle, marker);
        await echoed;
        samples.push(performance.now() - at);
        host.write(handle, '\u0015');
      }
    } finally {
      await host.dispose();
    }
    samples.sort((a, b) => a - b);
    const p95 = samples[Math.floor(samples.length * 0.95)] ?? 0;
    process.stdout.write(`[sla] echo latency, 10 terminals: median ${samples[15]?.toFixed(1)} ms, p95 ${p95.toFixed(1)} ms\n`);
    expect(samples).toHaveLength(30);
  });
});

describe.skipIf(skipUnlessLinux('counts /proc'))('20 terminals started and ended (062 SC-006)', () => {
  it('leave no process and no descriptor behind', { tags: ['regression'], timeout: 120_000 }, async () => {
    const host = new LinuxPtyHost({ graceMs: 100 });
    const beforeChildren = liveChildren();
    // One cycle first: node-pty opens what it keeps for its own lifetime on first use.
    const warm = host.start({ file: '/bin/bash', args: ['--norc', '--noprofile', '-i'], cwd: tmpdir(), cols: 80, rows: 24 });
    await host.end(warm, 8000);
    const beforeDescriptors = openDescriptors();

    for (let i = 0; i < 20; i += 1) {
      const handle = host.start({ file: '/bin/bash', args: ['--norc', '--noprofile', '-i'], cwd: tmpdir(), cols: 80, rows: 24 });
      host.write(handle, 'sleep 300 &\r');
      await new Promise((r) => setTimeout(r, 50));
      await host.end(handle, 8000);
    }
    await host.dispose();

    const deadline = Date.now() + 5000;
    while (liveChildren() > beforeChildren && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
    expect(liveChildren()).toBe(beforeChildren);
    // A little slack: node-pty closes its ends on the next tick of its own read loop.
    expect(openDescriptors()).toBeLessThanOrEqual(beforeDescriptors + 2);
  });
});
