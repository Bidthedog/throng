/**
 * Node code every platform implementation shares (062 R4). A leaf: it knows core and nothing else, so
 * `platform-windows` and `platform-linux` can both use it without ever seeing each other.
 */
export { NodeUserContext } from './node-user-context.js';
// Durable diagnostics (#123): the file sink both boundaries log through, and crash reports.
export { CRASH_DIR_NAME, createFileLog, writeCrashReport } from './node-file-log.js';
export type { DiagnosticLog, FileLogOptions } from './node-file-log.js';
export { execFileOffLoop } from './off-loop-exec.js';
export { clearStaleSocket } from './stale-socket.js';
