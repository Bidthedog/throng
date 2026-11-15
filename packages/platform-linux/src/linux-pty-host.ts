import { createRequire } from 'node:module';
import { PosixPtyHost, type NodePtyModule, type PosixProcessTable } from '@throng/platform-node';
import { isLiveRow, readCommandLine, readExecutablePath, readProcRow, readProcTable, trySignal, type ProcRow } from './proc-table.js';

export type { NodePtyModule };

export interface LinuxPtyHostDeps {
  readonly pty?: NodePtyModule;
  readonly timeoutMs?: number;
  /** How long a polite hang-up gets before the tree is killed outright. */
  readonly graceMs?: number;
}

/** `/proc`, as the shared host reads a process table. Each call goes through this module's import, as before. */
const PROC: PosixProcessTable<ProcRow> = {
  readTable: () => readProcTable(),
  readRow: (pid) => readProcRow(pid),
  isLive: (row) => isLiveRow(row),
  commandLine: (pid) => readCommandLine(pid),
  executablePath: (pid) => readExecutablePath(pid),
  signal: (pid, signal) => trySignal(pid, signal),
};

/**
 * `IPtyHost` over node-pty on Linux (062 FR-010, FR-018): the shared POSIX host (070 R1) over `/proc`. There is no
 * conhost and no elevation; a job has its own process group, so the tree is read from `/proc` before any signal.
 */
export class LinuxPtyHost extends PosixPtyHost<ProcRow> {
  constructor(deps: LinuxPtyHostDeps = {}) {
    super(
      PROC,
      { ...deps, pty: deps.pty ?? (createRequire(import.meta.url)('node-pty') as NodePtyModule) },
      'linux-pty-host',
    );
  }
}
