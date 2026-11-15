import process from 'node:process';
import type { IOrphanProcesses, IProcessCwd, IProcessIdentity, OrphanCandidate } from '@throng/core';
import { libSystem, type LibSystem } from './libsystem.js';
import {
  readMacosArgv,
  readMacosCommandLine,
  readMacosCwd,
  readMacosProcTable,
  trySignal,
} from './macos-proc-table.js';

const isPid = (pid: number): boolean => Number.isInteger(pid) && pid > 0 && pid < 2 ** 31;

/**
 * A shell's working directory, read from the operating system through `PROC_PIDVNODEPATHINFO` (070 FR-018, R2). A
 * process gone, or another user's, is absent, as the interface says.
 */
export class MacosProcessCwd implements IProcessCwd {
  async read(pids: readonly number[]): Promise<Map<number, string>> {
    const found = new Map<number, string>();
    for (const pid of new Set(pids)) {
      if (!isPid(pid)) continue;
      const cwd = readMacosCwd(pid);
      if (cwd !== undefined) found.set(pid, cwd);
    }
    return found;
  }
}

/**
 * The argument vector of a process, from `sysctl(KERN_PROCARGS2)` (068 FR-043, 070 R2). No start marker: Claude Code
 * records its start on macOS as epoch ms, which the resolver compares with the process table's start time, so a
 * marker in another unit would only make every lookup a mismatch.
 */
export class MacosProcessIdentity implements IProcessIdentity {
  async argv(pid: number): Promise<readonly string[] | undefined> {
    return isPid(pid) ? readMacosArgv(pid) : undefined;
  }

  async startMarker(_pid: number): Promise<string | undefined> {
    return undefined;
  }
}

/** launchd is pid 1, and every process whose parent dies is adopted by it (070 R10). */
const LAUNCHD_PID = 1;

/** The process names the daemon's `isThrongOwned` can accept; it judges every other name without its command line. */
const SWEEP_NAMES: ReadonlySet<string> = new Set(['node', 'node.exe', 'conhost.exe']);

/**
 * The process table for the orphan sweep (062 FR-018, 070 FR-018, R10). A process launchd has adopted reports "no
 * parent" (-1), as one init or the user's systemd adopted does on Linux, so the one orphan rule serves every platform.
 * Only processes `isThrongOwned` accepts are ever signalled.
 */
export class MacosOrphanProcesses implements IOrphanProcesses {
  private readonly lib: LibSystem | null;
  private readonly uid: number;

  constructor(deps: { readonly lib?: LibSystem | null; readonly uid?: number } = {}) {
    this.lib = deps.lib === undefined ? libSystem() : deps.lib;
    this.uid = deps.uid ?? process.getuid?.() ?? 0;
  }

  async snapshot(): Promise<OrphanCandidate[]> {
    const rows = await readMacosProcTable(this.lib);
    return rows.map((row) => ({
      pid: row.pid,
      ppid: row.ppid === LAUNCHD_PID ? -1 : row.ppid,
      name: row.comm,
      createdMs: row.startedAt,
      // A command line costs a KERN_PROCARGS2 read, which another user's process refuses; only a row the sweep could
      // accept is worth one, and every other row is judged by its name alone.
      commandLine: row.uid === this.uid && SWEEP_NAMES.has(row.comm.toLowerCase()) ? readMacosCommandLine(row.pid, this.lib) : '',
    }));
  }

  kill(pid: number): boolean {
    return isPid(pid) && trySignal(pid, 'SIGKILL');
  }
}
