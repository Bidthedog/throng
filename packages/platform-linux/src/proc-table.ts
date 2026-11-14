import { basename } from 'node:path';
import { readlinkSync } from 'node:fs';
import { readFile, readdir, readlink } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { logExpected } from '@throng/core';
import { logChildFailure } from '@throng/platform-node';

/** One process, from `/proc/<pid>/stat`. */
export interface ProcRow {
  readonly pid: number;
  readonly ppid: number;
  readonly pgrp: number;
  /** The kernel's short name, at most 15 characters. */
  readonly comm: string;
  readonly state: string;
  /** Epoch ms, derived from boot time and the kernel's start ticks. Stable for the process's life. */
  readonly startedAt: number;
  /** User plus system time, in clock ticks. */
  readonly cpuTicks: number;
  /** Resident pages. */
  readonly rssPages: number;
}

interface KernelUnits {
  readonly ticksPerSecond: number;
  readonly pageSize: number;
  readonly bootTimeMs: number;
}

function getconf(name: string, fallback: number): Promise<number> {
  return new Promise((resolve) => {
    execFile('getconf', [name], { timeout: 2000, encoding: 'utf8' }, (error, stdout, stderr) => {
      if (error) logChildFailure(`getconf ${name}`, error, stderr);
      const value = Number(String(stdout).trim());
      resolve(!error && value > 0 ? value : fallback);
    });
  });
}

async function readBootTimeMs(): Promise<number> {
  const stat = await readFile('/proc/stat', 'utf8');
  const seconds = /^btime (\d+)$/m.exec(stat)?.[1];
  return Number(seconds ?? 0) * 1000;
}

let units: Promise<KernelUnits> | null = null;

/** Read once per process: none of the three changes while the machine is up. */
export function kernelUnits(): Promise<KernelUnits> {
  units ??= (async () => {
    const [ticksPerSecond, pageSize, bootTimeMs] = await Promise.all([
      getconf('CLK_TCK', 100),
      getconf('PAGESIZE', 4096),
      readBootTimeMs(),
    ]);
    return { ticksPerSecond, pageSize, bootTimeMs };
  })();
  return units;
}

/**
 * Parse a `/proc/<pid>/stat` line. The name is in parentheses and may itself hold spaces and parentheses, so the
 * fields are counted from the LAST `)`. Returns null for anything that is not that shape.
 */
export function parseStat(text: string, u: KernelUnits): ProcRow | null {
  const open = text.indexOf('(');
  const close = text.lastIndexOf(')');
  if (open < 0 || close < open) return null;
  const pid = Number(text.slice(0, open).trim());
  const rest = text.slice(close + 2).split(' ');
  // `rest[0]` is field 3 of proc(5), so field N is rest[N - 3].
  const field = (n: number): number => Number(rest[n - 3]);
  if (!Number.isInteger(pid) || rest.length < 22) return null;
  return {
    pid,
    ppid: field(4),
    pgrp: field(5),
    comm: text.slice(open + 1, close),
    state: rest[0] ?? '?',
    startedAt: u.bootTimeMs + Math.round((field(22) * 1000) / u.ticksPerSecond),
    cpuTicks: field(14) + field(15),
    rssPages: field(24),
  };
}

export async function readProcRow(pid: number): Promise<ProcRow | null> {
  try {
    const [text, u] = await Promise.all([readFile(`/proc/${pid}/stat`, 'utf8'), kernelUnits()]);
    return parseStat(text, u);
  } catch (error) {
    logExpected('proc-table: read stat', 'a process can exit between the /proc listing and this read', error);
    return null;
  }
}

/**
 * How many `/proc` reads start in one turn of the event loop. Starting them all at once held the daemon's loop for
 * 9 – 15 ms on a machine with 523 processes, and this runs every command poll, so a keystroke waited behind it
 * (061 SC-002). 16 at a time held it for about 1 ms and finished sooner.
 */
const TABLE_READS_PER_TURN = 16;

const nextLoopTurn = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

/** Every process on the machine this user may see. A process that exits mid-read is simply absent. */
export async function readProcTable(): Promise<ProcRow[]> {
  const pids = (await readdir('/proc')).filter((n) => /^\d+$/.test(n)).map(Number);
  const rows: ProcRow[] = [];
  for (let at = 0; at < pids.length; at += TABLE_READS_PER_TURN) {
    if (at > 0) await nextLoopTurn();
    const read = await Promise.all(pids.slice(at, at + TABLE_READS_PER_TURN).map((pid) => readProcRow(pid)));
    rows.push(...read.filter((r): r is ProcRow => r !== null));
  }
  return rows;
}

/** The command line, arguments joined by spaces. Empty for a kernel thread, a zombie, or a process gone. */
export async function readCommandLine(pid: number): Promise<string> {
  try {
    const raw = await readFile(`/proc/${pid}/cmdline`, 'utf8');
    const nul = String.fromCharCode(0);
    return raw.split(nul).filter((part) => part.length > 0).join(' ');
  } catch (error) {
    logExpected('proc-table: read cmdline', 'a process can exit before its command line is read', error);
    return '';
  }
}

/** The real argument vector: `/proc/<pid>/cmdline` split on NUL. Absent for a kernel thread or a process gone. */
export async function readArgv(pid: number): Promise<string[] | undefined> {
  try {
    const raw = await readFile(`/proc/${pid}/cmdline`, 'utf8');
    if (raw.length === 0) return undefined;
    const parts = raw.split(String.fromCharCode(0));
    if (parts[parts.length - 1] === '') parts.pop();
    return parts;
  } catch (error) {
    logExpected('proc-table: read argv', 'a process can exit before its argument vector is read', error);
    return undefined;
  }
}

/** The kernel's start marker (field 22 of `/proc/<pid>/stat`, clock ticks since boot), as Claude Code records it. */
export async function readStartTicks(pid: number): Promise<string | undefined> {
  try {
    const text = await readFile(`/proc/${pid}/stat`, 'utf8');
    const rest = text.slice(text.lastIndexOf(')') + 2).split(' ');
    return rest.length >= 20 ? rest[19] : undefined;
  } catch (error) {
    logExpected('proc-table: read start ticks', 'a process can exit before its start time is read', error);
    return undefined;
  }
}

export async function readExecutablePath(pid: number): Promise<string | undefined> {
  try {
    return await readlink(`/proc/${pid}/exe`);
  } catch (error) {
    logExpected('proc-table: read exe link', "another user's process, or one that has exited, has no readable executable link", error);
    return undefined;
  }
}

/**
 * The program a row is. The kernel's name is its main THREAD's, and Node 24 names that thread `MainThread`, so every
 * Node process would read as that (measured on CI). Only then is the executable asked, to keep a tick cheap.
 */
export function programName(row: ProcRow): string {
  if (row.comm !== 'MainThread') return row.comm;
  try {
    return basename(readlinkSync(`/proc/${row.pid}/exe`));
  } catch (error) {
    logExpected('proc-table: name a MainThread row', "another user's process, or one that has exited, keeps its kernel name", error);
    return row.comm;
  }
}

/** A zombie has exited: nothing more can be done to it but wait for its parent to collect it. */
export const isLiveRow = (row: ProcRow): boolean => row.state !== 'Z' && row.state !== 'X';

/** `signal` to `pid`, reporting whether it could be delivered. Never throws. */
export function trySignal(pid: number, signal: NodeJS.Signals | 0): boolean {
  try {
    process.kill(pid, signal);
    return true;
  } catch (error) {
    logExpected('proc-table: signal', 'the process may have exited or be another user\'s; the caller acts on the false it gets', error);
    return false;
  }
}
