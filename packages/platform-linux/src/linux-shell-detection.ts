/**
 * The shells installed on a Linux machine: the shared POSIX detection, under the names Linux has always imported
 * (070 R1). Linux searches `/etc/shells` and `PATH` only, as before.
 */
export {
  PosixShellDetection as LinuxShellDetection,
  type PosixShellDetectionDeps as LinuxShellDetectionDeps,
} from '@throng/platform-node';
