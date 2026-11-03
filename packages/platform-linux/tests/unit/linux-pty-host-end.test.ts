import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProcRow } from '../../src/proc-table.js';

const proc = vi.hoisted(() => ({
  table: [] as ProcRow[],
  rowReads: 0,
  signals: [] as Array<[number, string]>,
  onSignal: (() => {}) as () => void,
}));

vi.mock('../../src/proc-table.js', () => ({
  isLiveRow: (row: ProcRow) => row.state !== 'Z',
  readCommandLine: () => Promise.resolve(''),
  readExecutablePath: () => Promise.resolve(undefined),
  readProcTable: () => Promise.resolve(proc.table),
  readProcRow: (pid: number) => {
    proc.rowReads++;
    return Promise.resolve(proc.table.find((row) => row.pid === pid) ?? null);
  },
  trySignal: (pid: number, signal: string) => {
    proc.signals.push([pid, signal]);
    proc.onSignal();
    return true;
  },
}));

const { LinuxPtyHost } = await import('../../src/linux-pty-host.js');

const SHELL = 4000;
const CHILD = 4001;
const STARTED = 1_000_000;

const row = (pid: number, ppid: number): ProcRow => ({
  pid,
  ppid,
  pgrp: pid,
  comm: 'x',
  state: 'S',
  startedAt: STARTED,
  cpuTicks: 0,
  rssPages: 1,
});

function hostWithShell(): { host: InstanceType<typeof LinuxPtyHost>; shellExits: () => void } {
  let onExit: (e: { exitCode: number }) => void = () => {};
  const pty = {
    spawn: () => ({
      pid: SHELL,
      write: () => {},
      resize: () => {},
      onData: () => ({ dispose: () => {} }),
      onExit: (cb: (e: { exitCode: number }) => void) => {
        onExit = cb;
        return { dispose: () => {} };
      },
    }),
  };
  return { host: new LinuxPtyHost({ pty, graceMs: 10 }), shellExits: () => onExit({ exitCode: 0 }) };
}

const START = { file: '/bin/sh', args: [], cwd: '/', cols: 80, rows: 24 };

describe('ending a terminal (062 FR-018)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    proc.table = [];
    proc.rowReads = 0;
    proc.signals = [];
    proc.onSignal = () => {};
  });

  it('still finds the children when the clock moved between starting the shell and ending it', async () => {
    const realNow = Date.now.bind(Date);
    // The clock read at start is an hour ahead of what the kernel's start times say.
    const stepped = vi.spyOn(Date, 'now').mockImplementation(() => realNow() + 3_600_000);
    const { host } = hostWithShell();
    const handle = host.start(START);
    stepped.mockRestore();
    proc.table = [row(SHELL, 1), row(CHILD, SHELL)];
    await host.forceEnd(handle, 10);
    expect(proc.signals).toContainEqual([CHILD, 'SIGKILL']);
  });

  it('stops watching a process that survives SIGKILL once the limit has passed', async () => {
    const { host, shellExits } = hostWithShell();
    const handle = host.start(START);
    proc.table = [row(SHELL, 1), row(CHILD, SHELL)];
    proc.onSignal = shellExits;
    const { survivors } = await host.forceEnd(handle, 30);
    expect(survivors.map((s) => s.pid)).toContain(CHILD);
    await new Promise((resolve) => setTimeout(resolve, 60));
    const reads = proc.rowReads;
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(proc.rowReads).toBe(reads);
  });
});
