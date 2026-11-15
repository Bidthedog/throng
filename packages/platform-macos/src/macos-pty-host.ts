import { createRequire } from 'node:module';
import { PosixPtyHost, type NodePtyModule, type PosixProcessTable } from '@throng/platform-node';
import {
  isLiveMacosRow,
  readMacosCommandLine,
  readMacosExecutablePath,
  readMacosProcRow,
  readMacosProcTable,
  trySignal,
  type MacosProcRow,
} from './macos-proc-table.js';

export interface MacosPtyHostDeps {
  readonly pty?: NodePtyModule;
  readonly timeoutMs?: number;
  /** How long a polite hang-up gets before the tree is killed outright. */
  readonly graceMs?: number;
}

/** libproc, as the shared host reads a process table (070 R2). Each read is one syscall, so none waits on the disk. */
const LIBPROC: PosixProcessTable<MacosProcRow> = {
  readTable: () => readMacosProcTable(),
  readRow: (pid) => Promise.resolve(readMacosProcRow(pid)),
  isLive: (row) => isLiveMacosRow(row),
  commandLine: (pid) => Promise.resolve(readMacosCommandLine(pid)),
  executablePath: (pid) => Promise.resolve(readMacosExecutablePath(pid)),
  signal: (pid, signal) => trySignal(pid, signal),
};

/**
 * `IPtyHost` over node-pty on macOS (070 FR-015, FR-018, R9): the shared POSIX host over the libproc table. Ending a
 * terminal reads its tree first, then SIGHUP and SIGCONT, a 400 ms grace, then SIGKILL, each signal only to a pid whose
 * start time still matches, exactly as on Linux.
 */
export class MacosPtyHost extends PosixPtyHost<MacosProcRow> {
  constructor(deps: MacosPtyHostDeps = {}) {
    super(
      LIBPROC,
      { ...deps, pty: deps.pty ?? (createRequire(import.meta.url)('node-pty') as NodePtyModule) },
      'macos-pty-host',
    );
  }
}
