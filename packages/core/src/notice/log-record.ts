/**
 * 030 FR-006/FR-007 — what a notice looks like on its way to the diagnostic log.
 *
 * Every accepted notice becomes one of these, whatever its display mode, so that turning a severity
 * off costs the user visibility and never the record (FR-006). The record crosses an IPC boundary:
 * the renderer raises the notice, the Electron main process owns the file. That is why it is a plain
 * structured-cloneable object and why it is built HERE — a record composed at the call site would
 * pick its own level (drifting from `noticeLogLevel`, filing records under a level nobody thinks to
 * filter for) and its own spelling of the subject, which is the ambiguity #195 exists to end.
 *
 * Pure. It formats and normalises; it does not write, and it knows nothing about the line format —
 * that belongs to whoever owns the file, since only they know what a line is.
 */
import type { LogLevel } from '../diagnostics/log-level.js';
import { noticeLogLevel } from './log-level.js';
import { formatSubject, type NoticeSubject } from './subject.js';
import type { NoticeSeverity } from './severity.js';

/** One affected panel's own raw error, for a notice that consolidates several failures (FR-048a). */
export interface NoticeAffectedDetail {
  /** The panel, already rendered — `Tab 1 — one.txt`. */
  panel: string;
  /** What the system said about THAT panel, verbatim. */
  detail: string;
}

/**
 * The record itself.
 *
 * `severity` rides alongside `level` rather than being recovered from it, because it cannot be:
 * `info` and `success` are one level and two severities, and FR-007 asks for the severity. `subject`
 * is pre-formatted — main does not re-derive it, so there is exactly one formatter for a subject in
 * the whole application.
 */
export interface NoticeLogRecord {
  /** Derived from the severity, never chosen (FR-006). */
  readonly level: LogLevel;
  readonly severity: NoticeSeverity;
  readonly message: string;
  /** The rendered subject; empty when the notice genuinely has none. */
  readonly subject: string;
  /**
   * WHAT WAS ATTEMPTED, and the heading that named the event — the notice's other two spoken parts.
   *
   * FR-007 asks for enough to identify the event without the screen, and the message alone is not
   * that. `A fresh workspace was opened instead.` is a real record this feature wrote: severity,
   * message, nothing said about what failed. On screen the notice reads `An error occurred when you
   * tried to restore your previous layout` above that sentence (`notice-text.ts`, FR-020) — the half
   * that identifies the event is the half the record dropped.
   *
   * Carried as the notice's own two fields rather than as the composed heading, because the log has
   * no heading to compose FOR: a reader greps `action=` to find every failed rename, and a
   * pre-composed sentence would make that a substring search over prose.
   */
  readonly title?: string;
  readonly action?: string;
  /** The failure cause's stable key, where the notice has one. */
  readonly causeKey?: string;
  /** How many panels this one notice speaks for, when it speaks for more than itself. */
  readonly affectedCount?: number;
  /** The raw system error (FR-034) — for a silenced severity this is its only route to the user. */
  readonly detail?: string;
  /** Per-panel raw errors (FR-048a); each becomes its own line in the file. */
  readonly affectedDetails?: readonly NoticeAffectedDetail[];
}

/** What a caller supplies. The level is absent on purpose: it is derived, not offered. */
export interface NoticeLogInput {
  severity: NoticeSeverity;
  /** The rendered message — whatever the user would have read. */
  message: string;
  /** The notice's subject; `{ kind: 'none' }` or omitted when it genuinely has none. */
  subject?: NoticeSubject;
  /** The notice's heading, where it states one of its own. */
  title?: string;
  /** What the user was trying to do — `rename`, `restore your previous layout` (FR-007). */
  action?: string;
  causeKey?: string;
  affectedCount?: number;
  detail?: string;
  affectedDetails?: readonly NoticeAffectedDetail[];
}

function trimmed(value: string | undefined): string | undefined {
  const text = value?.trim();
  return text ? text : undefined;
}

/**
 * Build the record for one notice.
 *
 * The subject is formatted with NO context (`formatSubject(subject)`), which is the one decision
 * here worth stating: a toast may leave the project out because its heading already names it, but a
 * log line has no heading and no surroundings. A record reading `one.txt` with four projects open
 * asks the reader exactly the question the subject was introduced to answer.
 *
 * Empty optional fields are dropped rather than carried as blanks, so the writer never has to
 * decide whether `cause=` with nothing after it means "no cause" or "a cause we lost".
 */
export function noticeLogRecord(input: NoticeLogInput): NoticeLogRecord {
  const affected = (input.affectedDetails ?? [])
    .map((entry) => ({ panel: entry.panel.trim(), detail: entry.detail.trim() }))
    // The error is what the entry exists to carry (FR-048a). An entry without one buys a line that
    // names a panel and then says nothing about it, which reads as a record we lost rather than a
    // panel that had nothing to report.
    .filter((entry) => entry.detail !== '');

  const count =
    typeof input.affectedCount === 'number' &&
    Number.isFinite(input.affectedCount) &&
    input.affectedCount > 0
      ? Math.trunc(input.affectedCount)
      : undefined;

  return {
    level: noticeLogLevel(input.severity),
    severity: input.severity,
    message: input.message,
    subject: input.subject ? formatSubject(input.subject) : '',
    ...(trimmed(input.title) ? { title: trimmed(input.title) } : {}),
    ...(trimmed(input.action) ? { action: trimmed(input.action) } : {}),
    ...(trimmed(input.causeKey) ? { causeKey: trimmed(input.causeKey) } : {}),
    ...(count === undefined ? {} : { affectedCount: count }),
    ...(trimmed(input.detail) ? { detail: trimmed(input.detail) } : {}),
    ...(affected.length > 0 ? { affectedDetails: affected } : {}),
  };
}
