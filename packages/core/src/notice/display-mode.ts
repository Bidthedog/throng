/**
 * 030 (#224), reshaped by 068 US3 — whether a notice is displayed at all, and whether it is kept.
 *
 * Every toast now leaves after ONE global duration (`toastDurationMs`), paused while the pointer is
 * over it or keyboard focus is inside it (FR-021). What a type chooses is two independent things
 * (FR-092): whether its notices toast, and whether they are kept in the Notifications panel until the
 * user dismisses them. Neither is *Never display*; both is the old *Toast and keep in panel*.
 *
 * `DisplayMode` survives as the vocabulary of ONE notice's own override — the Find in Files replace
 * summary (043 FR-082), which keeps its drop-down — and as the stored form of a pre-FR-092 type row,
 * which {@link upgradeNotificationDocument} maps forward along with the pre-068 `timed` / `dismiss`
 * modes and the per-type `timeoutMs`.
 */

/**
 * How a severity's notices behave.
 *
 * `never` still writes the log record (FR-005/FR-006) — silence in the UI is not silence in the
 * record, which is the whole basis on which a user can be asked to turn a severity off.
 */
export type DisplayMode = 'never' | 'toast' | 'panel';

/** The set, so the parse and the Preferences enum agree without either re-listing it. */
export const DISPLAY_MODES: readonly DisplayMode[] = ['never', 'toast', 'panel'];

/**
 * What each mode is CALLED (FR-001) — the three names the specification, the FR-008 confirmation
 * and every issue comment on #224 use.
 *
 * The stored values stay the machine tokens above; this is display only. It exists because the
 * Preferences form's generic fallback Title-Cases the token, which yields "Never", "Timed" and
 * "Dismiss" — a set of words the requirement never uses, and in which "Dismiss" reads as a button
 * rather than a mode.
 *
 * Beside `DISPLAY_MODES` on purpose: a fourth mode added above without a name here is a dropdown
 * row rendered in a different register from its neighbours, and the completeness assertion in
 * `settings-metadata.test.ts` fails the build rather than letting it ship.
 */
export const DISPLAY_MODE_LABELS: Readonly<Record<DisplayMode, string>> = {
  never: 'Never display',
  toast: 'Toast only',
  panel: 'Toast and keep in panel',
};

/**
 * The bounds on the global toast duration (FR-021c, FR-091). One second is the shortest the maintainer
 * allows, for a user who keeps notices in the panel and wants toasts barely there; above thirty seconds
 * a toast is a panel entry in all but name. The slider's 500 ms
 * step is the control's affordance only: any integer in the closed range is a valid setting.
 */
export const TOAST_DURATION_MIN_MS = 1000;
export const TOAST_DURATION_MAX_MS = 30000;
export const TOAST_DURATION_DEFAULT_MS = 3000;

/** The Notifications panel's entry limit (FR-031d); reaching it drops the oldest and warns once. */
export const PANEL_LIMIT_MIN = 20;
export const PANEL_LIMIT_MAX = 500;
export const PANEL_LIMIT_DEFAULT = 100;

/** 068 FR-076, FR-081, FR-090: the width of every toast, in pixels. The default is what the toast was before the setting existed. */
export const TOAST_WIDTH_MIN_PX = 300;
export const TOAST_WIDTH_MAX_PX = 800;
export const TOAST_WIDTH_DEFAULT_PX = 520;

/**
 * Where a notice is shown (068 FR-092). The two are independent: `panel` without `toast` keeps the
 * notice in the Notifications panel with no toast, and neither shows it nowhere in throng — the log
 * record is still filed (FR-005/FR-006).
 */
export interface SeverityNotificationSettings {
  toast: boolean;
  panel: boolean;
}

/** A display mode as the two switches it stands for — the Find in Files summary's override, and an old type row. */
export function displayOf(mode: DisplayMode): SeverityNotificationSettings {
  return { toast: mode !== 'never', panel: mode === 'panel' };
}

/** One notification type's row (057 FR-108; FR-092): Toast, Panel, and whether it also reaches the OS (FR-110). */
export interface NotificationTypeSettings extends SeverityNotificationSettings {
  /** Also raise an OS notification while no throng window is focused. Independent of `toast` and `panel`. */
  os: boolean;
}

/** The notification types, in the order Preferences lists them (057 FR-108). */
export const NOTIFICATION_TYPES = ['error', 'warning', 'info', 'success', 'attention'] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export interface NotificationSettings {
  /** 057 FR-109: while off, nothing reaches the OS, whatever each type says. */
  os: boolean;
  error: NotificationTypeSettings;
  warning: NotificationTypeSettings;
  info: NotificationTypeSettings;
  success: NotificationTypeSettings;
  /** 057 FR-111: attention marks, both kinds. */
  attention: NotificationTypeSettings;
  /** FR-021c: how long every toast stays, before the pointer or focus pauses it. */
  toastDurationMs: number;
  /** FR-076: how wide every toast is, in pixels; never wider than half the window. */
  toastWidthPx: number;
  /** FR-026c: whether Dismiss all asks first. */
  confirmDismissAll: boolean;
  /** FR-031d: the most entries the Notifications panel holds. */
  panelLimit: number;
}

/**
 * The shipped defaults (FR-021b to FR-021d, FR-026c, FR-031d).
 *
 * Every type toasts and is kept in the panel (FR-062 and FR-092, over FR-021c's toast alone for `info`, `success` and `attention`): a
 * toast leaves after the toast duration, so the panel is where a notice the user did not see waits —
 * the bug #224 reports for failures, which the maintainer extended to every type on 2026-11-13.
 *
 * `DEFAULT_APP_SETTINGS.notifications` is this object — the defaults live beside the parse that
 * falls back to them, because `parseNotificationSettings` takes no defaults argument and a second
 * copy in the settings file would be a table nobody remembers to keep in step.
 *
 * 057 FR-110/FR-111: the four severities ship with the OS off, so nothing changes on upgrade; attention ships
 * with it on, as its marks did before they had a row here.
 */
export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  os: true,
  error: { toast: true, panel: true, os: false },
  warning: { toast: true, panel: true, os: false },
  info: { toast: true, panel: true, os: false },
  success: { toast: true, panel: true, os: false },
  attention: { toast: true, panel: true, os: true },
  toastDurationMs: TOAST_DURATION_DEFAULT_MS,
  toastWidthPx: TOAST_WIDTH_DEFAULT_PX,
  confirmDismissAll: true,
  panelLimit: PANEL_LIMIT_DEFAULT,
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function boundedInt(raw: unknown, min: number, max: number, fallback: number): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return fallback;
  if (raw < min || raw > max) return fallback;
  return Math.round(raw);
}

/**
 * Resolve the persisted `notifications` section. TOTAL — it never throws, for any value at all.
 *
 * That is a requirement, not a nicety (FR-015). `settings.json` is a file a user edits by hand, and
 * a section that threw would take the Preferences window with it — leaving the only route to
 * repairing the mistake behind the mistake. So each value resolves independently: an unrecognised
 * switch does not discard a perfectly good one beside it, an unknown severity key is ignored
 * rather than fatal, and an absent section is simply the defaults.
 */
export function parseNotificationSettings(raw: unknown): NotificationSettings {
  const section = isRecord(raw) ? raw : {};
  const resolved = { os: typeof section.os === 'boolean' ? section.os : DEFAULT_NOTIFICATION_SETTINGS.os } as NotificationSettings;
  for (const type of NOTIFICATION_TYPES) {
    const fallback = DEFAULT_NOTIFICATION_SETTINGS[type];
    const v = isRecord(section[type]) ? section[type] : {};
    resolved[type] = { ...severitySettings(v, fallback), os: typeof v.os === 'boolean' ? v.os : fallback.os };
  }
  resolved.toastDurationMs = boundedInt(
    section.toastDurationMs,
    TOAST_DURATION_MIN_MS,
    TOAST_DURATION_MAX_MS,
    DEFAULT_NOTIFICATION_SETTINGS.toastDurationMs,
  );
  resolved.toastWidthPx = boundedInt(
    section.toastWidthPx,
    TOAST_WIDTH_MIN_PX,
    TOAST_WIDTH_MAX_PX,
    DEFAULT_NOTIFICATION_SETTINGS.toastWidthPx,
  );
  resolved.confirmDismissAll =
    typeof section.confirmDismissAll === 'boolean' ? section.confirmDismissAll : DEFAULT_NOTIFICATION_SETTINGS.confirmDismissAll;
  resolved.panelLimit = boundedInt(section.panelLimit, PANEL_LIMIT_MIN, PANEL_LIMIT_MAX, DEFAULT_NOTIFICATION_SETTINGS.panelLimit);
  return resolved;
}

function severitySettings(raw: unknown, fallback: SeverityNotificationSettings): SeverityNotificationSettings {
  const v = isRecord(raw) ? raw : {};
  return {
    toast: typeof v.toast === 'boolean' ? v.toast : fallback.toast,
    panel: typeof v.panel === 'boolean' ? v.panel : fallback.panel,
  };
}

/** The pre-068 mode a stored token is mapped to; anything else is left for the parse to resolve. */
function upgradedMode(mode: unknown): unknown {
  if (mode === 'dismiss') return 'panel';
  if (mode === 'timed') return 'toast';
  return mode;
}

/**
 * A type row's stored `mode` as FR-092's two switches, for whichever of them the row does not state
 * itself: a switch the user has set since wins over the mode it replaced. An unrecognised mode adds
 * nothing, and the parse then falls back to the defaults.
 */
function switchesFromMode(row: Record<string, unknown>): Record<string, unknown> {
  const { mode, ...rest } = row;
  const upgraded = upgradedMode(mode);
  if (!DISPLAY_MODES.includes(upgraded as DisplayMode)) return rest;
  const switches = displayOf(upgraded as DisplayMode);
  return {
    ...rest,
    ...(typeof rest.toast === 'boolean' ? {} : { toast: switches.toast }),
    ...(typeof rest.panel === 'boolean' ? {} : { panel: switches.panel }),
  };
}

/**
 * Upgrade a RAW settings document from the earlier notification shapes (data-model "Notification
 * settings", research D4; FR-092): a type row's `mode` becomes its `toast` and `panel` switches —
 * `never` neither, `toast` toast alone, `panel` both, with the pre-068 `dismiss` read as `panel` and
 * `timed` as `toast` — every `notifications.<type>.timeoutMs` and
 * `search.inFiles.summaryNoticeTimeoutMs` is dropped, and `search.inFiles.summaryNoticeMode` keeps its
 * mode, mapped from `dismiss` / `timed` the same way.
 *
 * It must run on the raw document BEFORE the declared-bounds guard: the guard would otherwise reset a
 * stored `dismiss` to the new default before it could be mapped. Pure and idempotent: an upgraded
 * document comes back deeply equal, and the input is never mutated. A non-object is returned as is.
 */
export function upgradeNotificationDocument(raw: unknown): unknown {
  if (!isRecord(raw)) return raw;
  let out: Record<string, unknown> = raw;
  const notifications = raw.notifications;
  if (isRecord(notifications)) {
    const next: Record<string, unknown> = { ...notifications };
    for (const type of NOTIFICATION_TYPES) {
      const row = notifications[type];
      if (!isRecord(row)) continue;
      const { timeoutMs: _dropped, ...rest } = row;
      next[type] = 'mode' in rest ? switchesFromMode(rest) : rest;
    }
    out = { ...out, notifications: next };
  }
  const search = raw.search;
  if (isRecord(search) && isRecord(search.inFiles)) {
    const { summaryNoticeTimeoutMs: _dropped, ...rest } = search.inFiles;
    const inFiles = 'summaryNoticeMode' in rest ? { ...rest, summaryNoticeMode: upgradedMode(rest.summaryNoticeMode) } : rest;
    out = { ...out, search: { ...search, inFiles } };
  }
  return out;
}
