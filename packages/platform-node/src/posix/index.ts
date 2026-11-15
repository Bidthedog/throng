/**
 * POSIX code Linux and macOS share as-is (070 R1, contracts/platform-services-macos.md *Shared POSIX code*). Neutral
 * names; `platform-linux` re-exports each under its old `Linux*` name, so nothing Linux imports moved.
 */
export { ensureOwnerOnlyDir } from './owner-only-dir.js';
export {
  NoDeElevatedLauncher,
  PosixDirectoryLock,
  PosixElevation,
  posixLookupHolder,
  posixStartupRefusal,
} from './posix-simple-services.js';
export { PosixPathForms } from './posix-path-forms.js';
export {
  MACOS_SHELL_SEARCH_DIRS,
  PosixShellDetection,
  type PosixShellDetectionDeps,
} from './posix-shell-detection.js';
export { RelevantProcesses, type ParentedRow, type RelevantProcessesDeps } from './relevant-processes.js';
export {
  DEFAULT_PTY_END_GRACE_MS,
  PosixPtyHost,
  type NodePty,
  type NodePtyModule,
  type PosixProcRow,
  type PosixProcessTable,
  type PosixPtyHostDeps,
} from './posix-pty-host.js';
