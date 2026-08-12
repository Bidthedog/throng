import {
  LOG_LEVELS,
  NOTICE_SEVERITIES,
  noticeLogLevel,
  type LogLevel,
  type NoticeAffectedDetail,
  type NoticeLogRecord,
  type NoticeSeverity,
} from '@throng/core';

/**
 * 030 FR-006 — the renderer→main notice log channel.
 *
 * Every accepted notice is written here, whatever its display mode, so that turning a severity off
 * costs the user visibility and never the record. That is the whole basis on which "Never display"
 * is offered at all (FR-008), which makes two properties of this module load-bearing:
 *
 *   • it writes through `logAlways`, NOT `log`. Every ordinary write is gated on
 *     `passesThreshold`, so under `diagnostics.logLevel: 'error'` an `info` or `warning` notice
 *     would reach nowhere whatever — not the screen, because the user silenced it, and not the
 *     file, because the threshold ate it. Silently. That is precisely FR-006b;
 *   • it applies NO policy of its own. It does not filter by severity, does not re-derive the level
 *     (core derived it once, where the renderer and Preferences can agree with it), and does not
 *     validate the message — which is already the rendered prose the user would have read.
 *
 * ══ WHY THE MESSAGE IS A SET OF LABELLED FIELDS ══
 *
 * `formatLogLine` renders `<iso> <LEVEL> [<component>] <message>` and nothing else, so the SEVERITY
 * is not recoverable from a written line: `info` and `success` are two severities and one level, and
 * FR-007 asks for the severity. The subject has the same problem for a different reason — appended
 * into the prose it is unfindable, and a reader with four projects open is left asking the same
 * question the subject exists to answer. So both become explicit fields ahead of a `|`, after which
 * everything is prose and may contain any punctuation at all.
 */

/** The channel. One-way: a diagnostics write that failed must never become a user-facing failure. */
export const NOTICE_LOG_CHANNEL = 'throng:notices:log';

/**
 * The component these records carry, in place of `ui-main`.
 *
 * One file holds main's own timeline and the renderer's notices, and a reader who cannot tell them
 * apart has to guess which process was speaking.
 */
export const NOTICE_LOG_COMPONENT = 'renderer-notice';

/** The write seam — `UiDiagnostics` satisfies it, and a test can satisfy it with an array. */
export interface NoticeLogSink {
  logAlways(level: LogLevel, message: string, component?: string): void;
}

/**
 * The subset of `ipcMain` this needs, declared structurally.
 *
 * Electron is not imported here at all: that keeps the module unit-testable with a plain fake, which
 * matters because the line layout is the part of this feature a later test can only observe through
 * a real log file (T015).
 */
export interface NoticeLogIpc {
  on(channel: string, listener: (event: unknown, payload: unknown) => void): void;
}

/**
 * Quote a field value so one containing spaces stays one field.
 *
 * The inner quote is escaped rather than stripped: a subject is a real name from a real filesystem,
 * and a value allowed to close its own field would put the rest of it where a reader expects the
 * next label.
 *
 * The BACKSLASH is deliberately not escaped. Doubling it would be the tidier grammar and the worse
 * log: nearly every subject here contains a Windows path, so the file would fill with `D:\\work\\…`
 * that matches nothing a user pastes from their address bar — bought against an ambiguity that
 * needs a literal `\"` inside a name, and Windows forbids `"` in one.
 */
function quoted(value: string): string {
  return `"${value.replace(/"/g, '\\"')}"`;
}

/**
 * Render one record as the messages to write — the head line first, then one line per raw error.
 *
 * A log line is a line. Everything a record has to say that would need a second line gets a second
 * RECORD, so the file stays greppable and one notice never has to be reassembled from a fragment
 * that happened to wrap.
 */
export function noticeLogLines(record: NoticeLogRecord): string[] {
  const fields = [`severity=${record.severity}`];
  if (record.subject) fields.push(`subject=${quoted(record.subject)}`);
  // Quoted like the subject, and for the same reason: a cause key is `kind:subject`, and that
  // subject is routinely a path or a project name with spaces in it.
  if (record.causeKey) fields.push(`cause=${quoted(record.causeKey)}`);
  if (record.affectedCount !== undefined) fields.push(`affected=${record.affectedCount}`);

  const lines = [`${fields.join(' ')} | ${record.message}`];
  // The raw system error (FR-034). For a silenced severity this is its ONLY route to the user —
  // there is no toast to copy it from.
  if (record.detail) lines.push(`detail | ${record.detail}`);
  // And each affected panel's own error (FR-048a), on its own line, naming the panel it belongs to.
  for (const entry of record.affectedDetails ?? []) {
    lines.push(`panel=${quoted(entry.panel)} detail | ${entry.detail}`);
  }
  return lines;
}

function isSeverity(value: unknown): value is NoticeSeverity {
  return typeof value === 'string' && (NOTICE_SEVERITIES as readonly string[]).includes(value);
}

function optionalText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

function affectedDetailsOf(value: unknown): NoticeAffectedDetail[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const entries: NoticeAffectedDetail[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue;
    const entry = raw as { panel?: unknown; detail?: unknown };
    const detail = optionalText(entry.detail);
    if (!detail) continue;
    entries.push({ panel: typeof entry.panel === 'string' ? entry.panel : '', detail });
  }
  return entries.length > 0 ? entries : undefined;
}

/**
 * Read the payload defensively.
 *
 * It arrives from the renderer, so it is only ever malformed because of a bug on our side — and the
 * right answer to that is a salvaged record, not a dropped one. A record we cannot fully read is
 * still evidence that something happened, and it is filed at `error` so the bug is visible.
 */
function recordFrom(payload: unknown): NoticeLogRecord {
  const raw = (payload ?? {}) as Partial<Record<keyof NoticeLogRecord, unknown>>;
  const severity = isSeverity(raw.severity) ? raw.severity : 'error';
  const level =
    typeof raw.level === 'string' && (LOG_LEVELS as readonly string[]).includes(raw.level)
      ? (raw.level as LogLevel)
      : // Salvage only. Main is not the authority on the mapping (contract): a valid level is used
        // exactly as sent, and this branch is reached only when there is nothing to use.
        noticeLogLevel(severity);
  return {
    level,
    severity,
    message: typeof raw.message === 'string' ? raw.message : '',
    subject: typeof raw.subject === 'string' ? raw.subject : '',
    causeKey: optionalText(raw.causeKey),
    affectedCount: typeof raw.affectedCount === 'number' ? raw.affectedCount : undefined,
    detail: optionalText(raw.detail),
    affectedDetails: affectedDetailsOf(raw.affectedDetails),
  };
}

/**
 * Wire the channel onto `ipcMain` (once per app run, from the composition root).
 *
 * Nothing here may throw: an uncaught throw inside an `ipcMain` listener takes the whole main
 * process down, which would turn "we could not log a notice" into "the application closed".
 */
export function registerNoticeLogIpc(sink: NoticeLogSink, ipc: NoticeLogIpc): void {
  ipc.on(NOTICE_LOG_CHANNEL, (_event, payload) => {
    try {
      const record = recordFrom(payload);
      for (const line of noticeLogLines(record)) {
        sink.logAlways(record.level, line, NOTICE_LOG_COMPONENT);
      }
    } catch {
      /* see above: the log is an observer, and an observer may not kill what it observes */
    }
  });
}
