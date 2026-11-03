import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runPtyHostContract, skipUnlessLinux } from '@throng/core/testing';
import { LinuxPtyHost } from '@throng/platform-linux';

/** Layer: contract. Only a real PTY and a real process tree can show a shell starting and its whole tree ending. */
const alive = (pid: number): boolean => {
  try {
    return !/^\d+ \(.*\) [ZX] /.test(readFileSync(`/proc/${pid}/stat`, 'utf8'));
  } catch {
    return false;
  }
};

const waitFor = async (check: () => boolean, ms: number, what: string): Promise<void> => {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (check()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`timed out waiting for ${what}`);
};

describe.skipIf(skipUnlessLinux('drives a real PTY and reads /proc'))('LinuxPtyHost (062 FR-010, FR-018, FR-044)', () => {
  const shell = { file: '/bin/bash', args: ['--norc', '--noprofile', '-i'] };

  it('satisfies the IPtyHost contract against a real shell', { timeout: 120_000 }, async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'throng-pty-'));
    try {
      await runPtyHostContract({
        make: () => new LinuxPtyHost(),
        cwd,
        interactiveShell: shell,
        selfExitingShell: { file: '/bin/sh', args: ['-c', 'exit 3'] },
        echoLine: (marker) => `echo ${marker}\r`,
        startChildLine: () => 'sleep 39\r',
      });
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('ends a job the shell put in its own process group, and a program that ignores hang-ups', { timeout: 30_000 }, async () => {
    const host = new LinuxPtyHost({ graceMs: 200 });
    const handle = host.start({ ...shell, cwd: tmpdir(), cols: 80, rows: 24 });
    let output = '';
    host.onData(handle, (chunk) => (output += chunk));
    host.write(handle, `(trap '' HUP TERM; sleep 300) & echo CHILD=$!\r`);
    await waitFor(() => /CHILD=\d+/.test(output), 8000, 'the background job');
    const child = Number(/CHILD=(\d+)/.exec(output)![1]);
    expect(alive(child)).toBe(true);
    await host.end(handle, 8000);
    await waitFor(() => !alive(child), 3000, 'the job to end');
  });

  it('touches nothing it did not start', { timeout: 30_000 }, async () => {
    const stranger = spawn('sleep', ['120'], { stdio: 'ignore' });
    try {
      await new Promise((resolve) => stranger.once('spawn', resolve));
      const host = new LinuxPtyHost({ graceMs: 100 });
      const handle = host.start({ ...shell, cwd: tmpdir(), cols: 80, rows: 24 });
      await new Promise((r) => setTimeout(r, 200));
      await host.end(handle, 8000);
      expect(alive(stranger.pid!)).toBe(true);
    } finally {
      stranger.kill('SIGKILL');
    }
  });

  it('forced end reports no survivors for a tree it could kill', { timeout: 30_000 }, async () => {
    const host = new LinuxPtyHost();
    const handle = host.start({ ...shell, cwd: tmpdir(), cols: 80, rows: 24 });
    await new Promise((r) => setTimeout(r, 200));
    expect((await host.forceEnd(handle, 5000)).survivors).toEqual([]);
    expect(host.rosterEntries()).toEqual([]);
  });

  it('reports no console host, because Linux has none (FR-008)', async () => {
    const host = new LinuxPtyHost();
    const handle = host.start({ ...shell, cwd: tmpdir(), cols: 80, rows: 24 });
    try {
      expect(await host.conhostOf(handle.pid)).toBeNull();
      expect(host.rosterEntries()[0]).toMatchObject({ handlePid: handle.pid, osPid: handle.pid, conhostPid: null });
    } finally {
      await host.end(handle, 8000);
    }
  });

  it('dispose leaves no shell running', { timeout: 30_000 }, async () => {
    const host = new LinuxPtyHost({ graceMs: 100 });
    const a = host.start({ ...shell, cwd: tmpdir(), cols: 80, rows: 24 });
    const b = host.start({ ...shell, cwd: tmpdir(), cols: 80, rows: 24 });
    await host.dispose();
    await waitFor(() => !alive(a.pid) && !alive(b.pid), 3000, 'both shells to end');
    expect(execFileSync('sh', ['-c', 'echo ok'], { encoding: 'utf8' }).trim()).toBe('ok');
  });
});
