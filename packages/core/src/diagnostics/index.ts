/**
 * Durable diagnostics (#123): levels, formatting, rotation and the file sink the Electron main
 * process, the daemon and the de-elevated PTY agent all write through.
 *
 * The DECISIONS live here; the disk does not. The sink that applies them is
 * `@throng/platform-windows` (node-file-log.ts), because core imports no Node builtin.
 */
export {
  DEFAULT_LOG_LEVEL,
  LOG_LEVELS,
  isLogLevel,
  parseLogLevel,
  passesThreshold,
  type LogLevel,
} from './log-level.js';
export {
  createAnonymiser,
  sensitive,
  type AnonKind,
  type Anonymiser,
  type AnonymiserOptions,
} from './anonymise.js';
export { FATAL_CONSOLE_PREFIX, describeError, logAt, logCaught, logExpected, logFatal } from './caught.js';
export {
  crashFileName,
  formatCrashReport,
  formatLogLine,
  type CrashDetails,
  type LogRecord,
} from './log-format.js';
export {
  DEFAULT_RETENTION,
  FIXED_LOG_NAMES,
  RETENTION_BOUNDS,
  logDayOf,
  logFilePid,
  nextRotatedName,
  normaliseRetention,
  retentionPlan,
  rotatedName,
  sessionFileName,
  shouldRotate,
  type LogFileInfo,
  type RetentionPlan,
  type RetentionPolicy,
} from './rotation.js';
