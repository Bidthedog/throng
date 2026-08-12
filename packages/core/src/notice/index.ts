/**
 * 030 — how a failure is PRESENTED, as pure domain logic.
 *
 * Everything a notice decides before it is a DOM node lives here: whether it is displayed at all and
 * for how long (`display-mode`), what level it reaches the diagnostic log at (`log-level`), what it
 * is about and how that reads (`subject`), whether two failures are one notice (`grouping`), and the
 * record it becomes on its way to that log (`log-record`).
 *
 * It is in core, not in the renderer, for the reason 029's cause is: main writes the log record, the
 * renderer renders the toast, and Preferences edits the settings — three consumers of one set of
 * rules, and a second copy of any of them would drift.
 *
 * Pure — no OS, no DOM, no I/O.
 */
export { NOTICE_SEVERITIES, type NoticeSeverity } from './severity.js';
export {
  DISPLAY_MODES,
  DEFAULT_NOTIFICATION_SETTINGS,
  TIMEOUT_MIN_MS,
  TIMEOUT_MAX_MS,
  parseNotificationSettings,
  type DisplayMode,
  type SeverityNotificationSettings,
  type NotificationSettings,
} from './display-mode.js';
export { noticeLogLevel } from './log-level.js';
export {
  SUBJECT_KINDS,
  SUBJECT_NAME_MAX,
  SUBJECT_SEPARATOR,
  formatSubject,
  type NoticeSubject,
  type SubjectContext,
} from './subject.js';
export { groupKey, type GroupInput } from './grouping.js';
export {
  affectedDetails,
  groupAffected,
  joinedPanels,
  mergeAffected,
  type AffectedContext,
  type AffectedPanel,
  type AffectedRow,
  type AffectedTabGroup,
} from './affected.js';
export {
  noticeLogRecord,
  type NoticeAffectedDetail,
  type NoticeLogInput,
  type NoticeLogRecord,
} from './log-record.js';
