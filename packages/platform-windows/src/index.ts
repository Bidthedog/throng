export { WindowsPlatformInfo } from './windows-platform-info.js';
export { NodeUserContext } from '@throng/platform-node';
export { WindowsShellDetection } from './windows-shell-detection.js';
export { NodePtyHost } from './node-pty-host.js';
export { WindowsDirectoryLock } from './windows-directory-lock.js';
export { WindowsElevation } from './windows-elevation.js';
export { WindowsProcessCwd } from './windows-process-cwd.js';
export { WindowsProcessMetrics, type GpuReader, type NetworkReader } from './windows-process-metrics.js';
export { WindowsNetworkTrace } from './windows-network-trace.js';
export { WindowsGpuCounters } from './windows-gpu-counters.js';
// #199: AllowSetForegroundWindow, so a window a terminal command opens can raise itself.
export { WindowsForegroundHandoff } from './windows-foreground-handoff.js';
export { WindowsDeElevatedLauncher } from './windows-de-elevated-launcher.js';
export { WindowsFontEnumeration } from './windows-font-enumeration.js';
// 045 (#394): the path spellings and the executable extensions core refuses to know.
export { WindowsPathForms } from './windows-path-forms.js';
export { WindowsExecutableExtensions } from './windows-executable-extensions.js';
// 045 FR-159: the protocols whose Windows handlers no allowlist may reach (research R27).
export { WindowsRefusedUriSchemes } from './windows-refused-uri-schemes.js';
// 029 FR-012/FR-014: who else is holding a path. Deferred, and deliberately present — see the file.
export { lookupHolder } from './holder-lookup.js';
// 062 FR-049: the seams that gained a second platform.
export { WindowsOrphanProcesses, WindowsTrashRestore, WindowsUserDirectories, WindowsVolumeRoots } from './windows-seams.js';
// Durable diagnostics (#123): the file sink both boundaries log through, and crash reports.
export { CRASH_DIR_NAME, createFileLog, writeCrashReport } from '@throng/platform-node';
export type { DiagnosticLog, FileLogOptions } from '@throng/platform-node';
