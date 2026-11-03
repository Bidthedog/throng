import { basename } from 'node:path';
import { readlinkSync } from 'node:fs';
import { readFile, readdir, readlink } from 'node:fs/promises';
import { execFile } from 'node:child_process';

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
    execFile('getconf', [name], { timeout: 2000, encoding: 'utf8' }, (error, stdout) => {
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
  } catch {
    return null; // gone, which is an ordinary answer here
  }
}

/** Every process on the machine this user may see. A process that exits mid-read is simply absent. */
export async function readProcTable(): Promise<ProcRow[]> {
  const names = await readdir('/proc');
  const rows = await Promise.all(names.filter((n) => /^\d+$/.test(n)).map((n) => readProcRow(Number(n))));
  return rows.filter((r): r is ProcRow => r !== null);
}

/** The command line, arguments joined by spaces. Empty for a kernel thread, a zombie, or a process gone. */
export async function readCommandLine(pid: number): Promise<string> {
  try {
    const raw = await readFile(`/proc/${pid}/cmdline`, 'utf8');
    const nul = String.fromCharCode(0);
    return raw.split(nul).filter((part) => part.length > 0).join(' ');
  } catch {
    return '';
  }
}

export async function readExecutablePath(pid: number): Promise<string | undefined> {
  try {
    return await readlink(`/proc/${pid}/exe`);
  } catch {
    return undefined; // another user's, or gone
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
  } catch {
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
  } catch {
    return false;
  }
}
