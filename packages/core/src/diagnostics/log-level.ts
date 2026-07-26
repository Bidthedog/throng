/**
 * Diagnostic log levels (#123).
 *
 * Four, deliberately: `error` and `warn` are what a user is asked to send in, `info` is the
 * narrative that makes them make sense (what started, what it connected to, what it decided), and
 * `debug` is the detail nobody wants until they need all of it. A fifth level would only ever be
 * argued about.
 *
 * The THRESHOLD is injected configuration, never a constant read at the point of logging
 * (Constitution Principle X): an installed build a user cannot rebuild must be able to turn the
 * detail up, and the only way that is true is if the level arrives from settings.
 */
export type LogLevel = 'error' | 'warn' | 'info' | 'debug';

/** Most severe first. Index IS severity, which is what {@link passesThreshold} compares. */
export const LOG_LEVELS: readonly LogLevel[] = ['error', 'warn', 'info', 'debug'];

/** What an installed build logs unless told otherwise: the narrative, without the detail. */
export const DEFAULT_LOG_LEVEL: LogLevel = 'info';

export function isLogLevel(value: unknown): value is LogLevel {
  return typeof value === 'string' && (LOG_LEVELS as readonly string[]).includes(value);
}

/** Read a level from configuration, falling back rather than throwing — a bad level in a settings
 *  file must not stop the application starting, least of all the part that would report why. */
export function parseLogLevel(value: unknown, fallback: LogLevel = DEFAULT_LOG_LEVEL): LogLevel {
  return isLogLevel(value) ? value : fallback;
}

/** True when a record at `level` should be written under `threshold`. */
export function passesThreshold(threshold: LogLevel, level: LogLevel): boolean {
  return LOG_LEVELS.indexOf(level) <= LOG_LEVELS.indexOf(threshold);
}
