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
  crashFileName,
  formatCrashReport,
  formatLogLine,
  type CrashDetails,
  type LogRecord,
} from './log-format.js';
export {
  DEFAULT_ROTATION,
  normaliseRotation,
  rotatedName,
  rotationPlan,
  shouldRotate,
  type RotationPlan,
  type RotationPolicy,
} from './rotation.js';
