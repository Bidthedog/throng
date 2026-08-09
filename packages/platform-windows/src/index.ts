export { WindowsPlatformInfo } from './windows-platform-info.js';
export { NodeUserContext } from './node-user-context.js';
export { WindowsShellDetection } from './windows-shell-detection.js';
export { NodePtyHost } from './node-pty-host.js';
export { WindowsDirectoryLock } from './windows-directory-lock.js';
export { WindowsElevation } from './windows-elevation.js';
export { WindowsProcessCwd } from './windows-process-cwd.js';
export { WindowsDeElevatedLauncher } from './windows-de-elevated-launcher.js';
export { WindowsFontEnumeration } from './windows-font-enumeration.js';
// 029 FR-012/FR-014: who else is holding a path. Deferred, and deliberately present — see the file.
export { lookupHolder } from './holder-lookup.js';
// Durable diagnostics (#123): the file sink both boundaries log through, and crash reports.
export { CRASH_DIR_NAME, createFileLog, writeCrashReport } from './node-file-log.js';
export type { DiagnosticLog, FileLogOptions } from './node-file-log.js';
