import { describe, expect, it } from 'vitest';
import { execFileOffLoop } from '../../src/off-loop-exec.js';

/**
 * 051 FR-010 — the runner every terminal-service process start goes through, against real processes.
 *
 * What the host relies on: stdout as text, the exit code on the error (`taskkill`'s 128 means "already gone"), and —
 * the reason it exists — the caller's event loop staying free while processes start. On the caller's thread each
 * start held it 60-230 ms while terminals ended (051 MT-02).
 */

const run = (file: string, args: string[]) =>
  new Promise<{ error: (Error & { code?: unknown }) | null; stdout: string }>((resolve) =>
    execFileOffLoop(file, args, { windowsHide: true, timeout: 10_000 }, (error, stdout) => resolve({ error, stdout })),
  );

describe('execFileOffLoop', () => {
  it('returns the process output as text', async () => {
    const { error, stdout } = await run('cmd.exe', ['/d', '/c', 'echo off-loop-41']);
    expect(error).toBeNull();
    expect(stdout).toContain('off-loop-41');
  });

  it('carries the exit code on the error, as execFile does', async () => {
    const { error } = await run('cmd.exe', ['/d', '/c', 'exit 7']);
    expect(error?.code).toBe(7);
  });

  it('a missing program is an error, never a hang', async () => {
    const { error } = await run('throng-no-such-program-41.exe', []);
    expect(error).not.toBeNull();
  });

  it('keeps the caller’s event loop turning while ten processes start', async () => {
    let longest = 0;
    let last = Date.now();
    const ticker = setInterval(() => {
      const now = Date.now();
      longest = Math.max(longest, now - last);
      last = now;
    }, 5);
    try {
      await Promise.all(Array.from({ length: 10 }, (_, i) => run('cmd.exe', ['/d', '/c', `echo start-${i}`])));
    } finally {
      clearInterval(ticker);
    }
    // A 5 ms tick; on the caller's thread a single start held it 60-230 ms on a developer machine.
    expect(longest, `the caller's loop stalled for ${longest} ms`).toBeLessThan(50);
  });
});
