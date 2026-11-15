import { logCaught, logExpected } from '@throng/core';
import {
  CTL_KERN,
  KERN_ARGMAX,
  KERN_PROCARGS2,
  MAXCOMLEN,
  MAXPATHLEN,
  PROC_BSDINFO,
  PROC_PIDPATHINFO_MAXSIZE,
  PROC_PIDTASKINFO,
  PROC_PIDTBSDINFO,
  PROC_PIDVNODEPATHINFO,
  PROC_TASKINFO,
  PROC_VNODEPATHINFO,
  RUSAGE_INFO_V4,
  RUSAGE_INFO_V4_LAYOUT,
  SZOMB,
  cString,
  libSystem,
  type LibSystem,
} from './libsystem.js';

/**
 * One process, from `proc_pidinfo(PROC_PIDTBSDINFO)` (070 data-model.md *ProcRow (macOS)*, research R2). The same shape
 * Linux's `/proc` row has where the pty host and the orphan rule read it; argv, the executable and the cwd are read
 * lazily, by pid. A row is the same process only when `pid` AND `startedAt` match (the pid-reuse rule).
 */
export interface MacosProcRow {
  readonly pid: number;
  readonly ppid: number;
  readonly uid: number;
  readonly pgid: number;
  /** The kernel's short name, at most 16 bytes (`pbi_comm`). */
  readonly comm: string;
  /** Epoch ms, from `pbi_start_tvsec`/`usec`. Stable for the process's life. */
  readonly startedAt: number;
  /** Exited and waiting for its parent to collect it. */
  readonly zombie: boolean;
}

/** A process's resource figures (070 data-model.md: metrics add these to the row). */
export interface MacosProcMetrics {
  /** User plus system CPU time, ms. */
  readonly cpuMs: number;
  /** `ri_phys_footprint`: what Activity Monitor shows as Memory. */
  readonly privateBytes: number;
  readonly residentBytes: number;
  readonly readBytes: number;
  readonly writeBytes: number;
}

/** A layout that disagrees with the kernel's is reported once, not on every row (Principle XIII without a flood). */
const reportedLayouts = new Set<string>();
function layoutMismatch(what: string, declared: number, returned: number): void {
  if (reportedLayouts.has(what)) return;
  reportedLayouts.add(what);
  logCaught('macos-proc-table: struct layout', new Error(`${what}: the kernel wrote ${returned} bytes, the declared layout is ${declared}`));
}

/** `struct proc_bsdinfo` as a row. Null for a buffer that is not one. */
export function parseBsdInfo(buf: Buffer): MacosProcRow | null {
  if (buf.length < PROC_BSDINFO.size) return null;
  const comm = cString(buf, PROC_BSDINFO.comm, MAXCOMLEN);
  const name = cString(buf, PROC_BSDINFO.name, 2 * MAXCOMLEN);
  const sec = Number(buf.readBigUInt64LE(PROC_BSDINFO.startSec));
  const usec = Number(buf.readBigUInt64LE(PROC_BSDINFO.startUsec));
  return {
    pid: buf.readUInt32LE(PROC_BSDINFO.pid),
    ppid: buf.readUInt32LE(PROC_BSDINFO.ppid),
    uid: buf.readUInt32LE(PROC_BSDINFO.uid),
    pgid: buf.readUInt32LE(PROC_BSDINFO.pgid),
    // `pbi_name` is the longer name a process may register; `pbi_comm` is truncated at 16 bytes.
    comm: name.length > comm.length && name.startsWith(comm) ? name : comm,
    startedAt: sec * 1000 + Math.floor(usec / 1000),
    zombie: buf.readUInt32LE(PROC_BSDINFO.status) === SZOMB,
  };
}

/** The row for `pid`, or null once it has gone or when it is another user's that the kernel will not describe. */
export function readMacosProcRow(pid: number, lib: LibSystem | null = libSystem()): MacosProcRow | null {
  if (lib === null || !Number.isInteger(pid) || pid <= 0) return null;
  const buf = Buffer.alloc(PROC_BSDINFO.size);
  const written = lib.procPidInfo(pid, PROC_PIDTBSDINFO, 0, buf);
  if (written <= 0) return null; // Gone, a zombie the kernel no longer describes, or not ours to see.
  if (written !== PROC_BSDINFO.size) {
    layoutMismatch('proc_bsdinfo', PROC_BSDINFO.size, written);
    return null;
  }
  return parseBsdInfo(buf);
}

/** Every pid on the machine. Empty when libSystem cannot be reached (logged where it was bound). */
export function listAllPids(lib: LibSystem | null = libSystem()): number[] {
  if (lib === null) return [];
  for (let capacity = 4096; capacity <= 1 << 20; capacity *= 4) {
    const buf = Buffer.alloc(capacity * 4);
    const count = lib.procListAllPids(buf);
    if (count <= 0) {
      logCaught('macos-proc-table: proc_listallpids', new Error(`proc_listallpids gave ${count}`));
      return [];
    }
    // A full buffer may have been cut short: ask again with more room.
    if (count < capacity) {
      const pids: number[] = [];
      for (let i = 0; i < count; i++) {
        const pid = buf.readInt32LE(i * 4);
        if (pid > 0) pids.push(pid);
      }
      return pids;
    }
  }
  return [];
}

/** How many rows are read in one turn of the event loop: each is one syscall, so this holds the loop well under 1 ms. */
const ROWS_PER_TURN = 64;
const nextLoopTurn = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

/** Every process this user may see. A process that exits mid-read is simply absent. */
export async function readMacosProcTable(lib: LibSystem | null = libSystem()): Promise<MacosProcRow[]> {
  const pids = listAllPids(lib);
  const rows: MacosProcRow[] = [];
  for (let at = 0; at < pids.length; at += ROWS_PER_TURN) {
    if (at > 0) await nextLoopTurn();
    for (const pid of pids.slice(at, at + ROWS_PER_TURN)) {
      const row = readMacosProcRow(pid, lib);
      if (row) rows.push(row);
    }
  }
  return rows;
}

/** A zombie has exited: nothing more can be done to it but wait for its parent to collect it. */
export const isLiveMacosRow = (row: MacosProcRow): boolean => !row.zombie;

let argMax: number | undefined;
let argvBuf: Buffer | undefined;

function kernArgMax(lib: LibSystem): number {
  if (argMax !== undefined) return argMax;
  const mib = Buffer.alloc(8);
  mib.writeInt32LE(CTL_KERN, 0);
  mib.writeInt32LE(KERN_ARGMAX, 4);
  const out = Buffer.alloc(4);
  const size = Buffer.alloc(8);
  size.writeBigUInt64LE(4n);
  const ok = lib.sysctl(mib, 2, out, size) === 0;
  // 1 MiB is macOS's ARG_MAX on every release throng supports; the answer only sizes a buffer.
  argMax = ok ? out.readInt32LE(0) : 1024 * 1024;
  if (!ok) logCaught('macos-proc-table: sysctl KERN_ARGMAX', new Error('sysctl KERN_ARGMAX failed'));
  return argMax;
}

/**
 * The argument vector from a `KERN_PROCARGS2` buffer: `int argc`, the executable path, NUL padding, then `argc`
 * NUL-terminated strings (and the environment after them, which is never read). Undefined for anything else.
 */
export function parseProcArgs2(buf: Buffer, length: number): string[] | undefined {
  if (length < 4) return undefined;
  const argc = buf.readInt32LE(0);
  if (argc <= 0) return undefined;
  let at = buf.indexOf(0, 4);
  if (at < 0 || at >= length) return undefined;
  while (at < length && buf[at] === 0) at++;
  const argv: string[] = [];
  while (argv.length < argc && at < length) {
    const end = buf.indexOf(0, at);
    const stop = end < 0 || end > length ? length : end;
    argv.push(buf.toString('utf8', at, stop));
    at = stop + 1;
  }
  return argv.length === argc ? argv : undefined;
}

/** The real argument vector, through `sysctl(KERN_PROCARGS2)`. Absent for a process gone or another user's. */
export function readMacosArgv(pid: number, lib: LibSystem | null = libSystem()): string[] | undefined {
  if (lib === null) return undefined;
  const mib = Buffer.alloc(12);
  mib.writeInt32LE(CTL_KERN, 0);
  mib.writeInt32LE(KERN_PROCARGS2, 4);
  mib.writeInt32LE(pid, 8);
  // One buffer for every read: the read is synchronous and the strings are copied out before it returns. Unzeroed: the
  // kernel writes the first `size` bytes and nothing past them is read.
  argvBuf ??= Buffer.allocUnsafe(kernArgMax(lib));
  const buf = argvBuf;
  const size = Buffer.alloc(8);
  size.writeBigUInt64LE(BigInt(buf.length));
  if (lib.sysctl(mib, 3, buf, size) !== 0) {
    logExpected('macos-proc-table: read argv', "a process can exit before its arguments are read, and another user's are refused", new Error(`KERN_PROCARGS2 refused for ${pid}`));
    return undefined;
  }
  return parseProcArgs2(buf, Number(size.readBigUInt64LE(0)));
}

/** The command line, arguments joined by spaces. Empty for a process gone. */
export function readMacosCommandLine(pid: number, lib: LibSystem | null = libSystem()): string {
  return readMacosArgv(pid, lib)?.join(' ') ?? '';
}

export function readMacosExecutablePath(pid: number, lib: LibSystem | null = libSystem()): string | undefined {
  if (lib === null) return undefined;
  const buf = Buffer.alloc(PROC_PIDPATHINFO_MAXSIZE);
  const length = lib.procPidPath(pid, buf);
  return length > 0 ? buf.toString('utf8', 0, length) : undefined;
}

/** The working directory, from `PROC_PIDVNODEPATHINFO`. Absent for a process gone or another user's. */
export function readMacosCwd(pid: number, lib: LibSystem | null = libSystem()): string | undefined {
  if (lib === null) return undefined;
  const buf = Buffer.alloc(PROC_VNODEPATHINFO.size);
  const written = lib.procPidInfo(pid, PROC_PIDVNODEPATHINFO, 0, buf);
  if (written <= 0) return undefined;
  if (written !== PROC_VNODEPATHINFO.size) {
    layoutMismatch('proc_vnodepathinfo', PROC_VNODEPATHINFO.size, written);
    return undefined;
  }
  const cwd = cString(buf, PROC_VNODEPATHINFO.cdirPath, MAXPATHLEN);
  return cwd.startsWith('/') ? cwd : undefined;
}

/**
 * CPU time from `PROC_PIDTASKINFO`, in Mach absolute units scaled by the time base; memory and I/O from
 * `proc_pid_rusage(RUSAGE_INFO_V4)`. Null for a process gone or another user's.
 */
export function readMacosMetrics(pid: number, lib: LibSystem | null = libSystem()): MacosProcMetrics | null {
  if (lib === null) return null;
  const task = Buffer.alloc(PROC_TASKINFO.size);
  const written = lib.procPidInfo(pid, PROC_PIDTASKINFO, 0, task);
  if (written <= 0) return null;
  if (written !== PROC_TASKINFO.size) {
    layoutMismatch('proc_taskinfo', PROC_TASKINFO.size, written);
    return null;
  }
  const usage = Buffer.alloc(RUSAGE_INFO_V4_LAYOUT.size);
  if (lib.procPidRusage(pid, RUSAGE_INFO_V4, usage) !== 0) return null;
  const [numer, denom] = lib.machTimebase();
  const machToMs = (units: bigint): number => (Number(units) * numer) / denom / 1e6;
  return {
    cpuMs: machToMs(task.readBigUInt64LE(PROC_TASKINFO.totalUser) + task.readBigUInt64LE(PROC_TASKINFO.totalSystem)),
    residentBytes: Number(task.readBigUInt64LE(PROC_TASKINFO.residentSize)),
    privateBytes: Number(usage.readBigUInt64LE(RUSAGE_INFO_V4_LAYOUT.physFootprint)),
    readBytes: Number(usage.readBigUInt64LE(RUSAGE_INFO_V4_LAYOUT.diskioBytesRead)),
    writeBytes: Number(usage.readBigUInt64LE(RUSAGE_INFO_V4_LAYOUT.diskioBytesWritten)),
  };
}

/** `signal` to `pid`, reporting whether it could be delivered. Never throws. */
export function trySignal(pid: number, signal: NodeJS.Signals | 0): boolean {
  try {
    process.kill(pid, signal);
    return true;
  } catch (error) {
    logExpected('macos-proc-table: signal', "the process may have exited or be another user's; the caller acts on the false it gets", error);
    return false;
  }
}
