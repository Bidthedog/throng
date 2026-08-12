/**
 * 030 (#224) — whether a notice is displayed at all, and for how long.
 *
 * Before this, severity decided persistence: an `error` stayed until dismissed and everything else
 * vanished after a hardcoded `AUTO_DISMISS_MS`. That is the defect — the user, not the raiser,
 * decides how long they need to read something, and a notice that vanished before it was read was
 * indistinguishable from one that never happened (Principle X).
 *
 * The three modes are exhaustive by design: never display it, display it for a bounded time, or
 * leave it until it is dismissed. There is no fourth, and no severity is exempt.
 */
import { NOTICE_SEVERITIES } from './severity.js';

/**
 * How a severity's notices behave.
 *
 * `never` still writes the log record (FR-005/FR-006) — silence in the UI is not silence in the
 * record, which is the whole basis on which a user can be asked to turn a severity off.
 */
export type DisplayMode = 'never' | 'timed' | 'dismiss';

/** The set, so the parse and the Preferences enum agree without either re-listing it. */
export const DISPLAY_MODES: readonly DisplayMode[] = ['never', 'timed', 'dismiss'];

/**
 * The bounds on a timed notice (FR-010), matching the six existing `*Ms` settings.
 *
 * Below 1500 ms nothing longer than a few words can be read, so the notice would be technically
 * displayed and practically silent — the failure mode the whole feature exists to remove. Above a
 * minute it is indistinguishable from *Dismiss only*, which is the setting to use instead.
 */
export const TIMEOUT_MIN_MS = 1500;
export const TIMEOUT_MAX_MS = 60000;

export interface SeverityNotificationSettings {
  mode: DisplayMode;
  /** Only consulted when mode is 'timed'. Bounded 1500–60000 (FR-010). */
  timeoutMs: number;
}

export interface NotificationSettings {
  error: SeverityNotificationSettings;
  warning: SeverityNotificationSettings;
  info: SeverityNotificationSettings;
  success: SeverityNotificationSettings;
}

/**
 * The shipped defaults (FR-013).
 *
 * `error` and `warning` are *Dismiss only* because a failure the user has not seen is the bug
 * #224 reports; `info` and `success` are timed because a confirmation that has to be dismissed is
 * an interruption.
 *
 * Every severity carries a `timeoutMs` whatever its mode: switching one to *Display for* in
 * Preferences must not present an empty control, and the silenced-notice shadow (FR-005b) expires
 * its entries after that dwell even when nothing is ever rendered.
 *
 * `DEFAULT_APP_SETTINGS.notifications` is this object — the defaults live beside the parse that
 * falls back to them, because `parseNotificationSettings` takes no defaults argument and a second
 * copy in the settings file would be a table nobody remembers to keep in step.
 */
export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  error: { mode: 'dismiss', timeoutMs: 5000 },
  warning: { mode: 'dismiss', timeoutMs: 5000 },
  info: { mode: 'timed', timeoutMs: 10000 },
  success: { mode: 'timed', timeoutMs: 5000 },
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function displayMode(raw: unknown, fallback: DisplayMode): DisplayMode {
  return DISPLAY_MODES.includes(raw as DisplayMode) ? (raw as DisplayMode) : fallback;
}

function timeoutMs(raw: unknown, fallback: number): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return fallback;
  if (raw < TIMEOUT_MIN_MS || raw > TIMEOUT_MAX_MS) return fallback;
  return Math.round(raw);
}

/**
 * Resolve the persisted `notifications` section. TOTAL — it never throws, for any value at all.
 *
 * That is a requirement, not a nicety (FR-015). `settings.json` is a file a user edits by hand, and
 * a section that threw would take the Preferences window with it — leaving the only route to
 * repairing the mistake behind the mistake. So each value resolves independently: an unrecognised
 * mode does not discard a perfectly good timeout beside it, an unknown severity key is ignored
 * rather than fatal, and an absent section is simply the defaults.
 */
export function parseNotificationSettings(raw: unknown): NotificationSettings {
  const section = isRecord(raw) ? raw : {};
  const resolved = {} as NotificationSettings;
  for (const severity of NOTICE_SEVERITIES) {
    resolved[severity] = severitySettings(section[severity], DEFAULT_NOTIFICATION_SETTINGS[severity]);
  }
  return resolved;
}

function severitySettings(
  raw: unknown,
  fallback: SeverityNotificationSettings,
): SeverityNotificationSettings {
  const v = isRecord(raw) ? raw : {};
  return {
    mode: displayMode(v.mode, fallback.mode),
    timeoutMs: timeoutMs(v.timeoutMs, fallback.timeoutMs),
  };
}
