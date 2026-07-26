import type { LogLevel } from './log-level.js';

/**
 * How a diagnostic record and a crash report are written (#123).
 *
 * Pure string work, separated from the file that receives it, because the format is the part a
 * human reads in a bug report and the part a test can pin. The sink's job is durability; this one's
 * is legibility.
 */

export interface LogRecord {
  /** When it happened. An ISO string is accepted so a caller need not construct a Date. */
  at: Date | string;
  level: LogLevel;
  /** Which process wrote it — `ui-main`, `daemon`, `pty-agent`. */
  component: string;
  message: string;
}

/** ISO-8601 in UTC, whatever the caller passed. */
function isoOf(at: Date | string): string {
  return typeof at === 'string' ? at : at.toISOString();
}

/**
 * ONE RECORD IS ONE LINE.
 *
 * A log a user grep's, tails, or pastes into an issue is only usable if a record cannot be mistaken
 * for several — and messages routinely carry newlines (a stack trace, a multi-line shell error). So
 * embedded newlines are escaped rather than written through: the record stays whole, and the reader
 * can still see where the breaks were.
 */
export function formatLogLine(record: LogRecord): string {
  const message = record.message.replace(/\r?\n/g, '\\n');
  return `${isoOf(record.at)} ${record.level.toUpperCase().padEnd(5)} [${record.component}] ${message}`;
}

export interface CrashDetails {
  /** The process or child that died — `ui-main`, `renderer`, `gpu`, `daemon`. */
  component: string;
  at: Date | string;
  /** Why, in whatever terms the platform gave: `crashed`, `oom`, `uncaughtException`. */
  reason: string;
  exitCode?: number | null;
  /** The failure output — a stack, the last stderr, whatever was to hand. */
  output?: string;
  /** Which build this was, so a report is actionable rather than merely alarming (FR-006). */
  version: string;
  buildId: string;
  pid?: number;
  /** Anything else worth carrying — elevation, the pipe, the data directory. */
  context?: Readonly<Record<string, string | number | boolean | undefined>>;
}

/**
 * A crash report, as a file a user can attach without editing it first.
 *
 * Deliberately plain text with a header of named fields rather than JSON: the person who reads it
 * first is the user deciding whether to send it, and they must be able to see that it contains a
 * version, an exit code and a stack — and nothing about them.
 */
export function formatCrashReport(details: CrashDetails): string {
  const lines = [
    'throng crash report',
    '===================',
    `when:      ${isoOf(details.at)}`,
    `component: ${details.component}`,
    `reason:    ${details.reason}`,
    `version:   ${details.version}`,
    `build:     ${details.buildId}`,
  ];
  if (details.exitCode !== undefined && details.exitCode !== null) {
    lines.push(`exit code: ${details.exitCode}`);
  }
  if (details.pid !== undefined) lines.push(`pid:       ${details.pid}`);
  for (const [key, value] of Object.entries(details.context ?? {})) {
    if (value !== undefined) lines.push(`${`${key}:`.padEnd(10)} ${String(value)}`);
  }
  lines.push('');
  lines.push(details.output && details.output.length > 0 ? details.output : '(no output captured)');
  lines.push('');
  return lines.join('\n');
}

/**
 * The file a crash report goes in: one file PER CRASH.
 *
 * Not appended to a shared crash log, because the unit a user attaches to a bug report is one
 * crash — appending would make them find and cut the relevant part out of a file that also
 * contains every unrelated failure they have ever had.
 */
export function crashFileName(component: string, at: Date | string): string {
  const stamp = isoOf(at).replace(/[:.]/g, '-');
  const safe = component.replace(/[^A-Za-z0-9._-]+/g, '-');
  return `crash-${safe}-${stamp}.log`;
}
