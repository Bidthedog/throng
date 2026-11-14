/**
 * 068 US3 — the Notifications panel's entries, as pure transitions (data-model "Notification entry";
 * FR-024 to FR-031g, FR-059).
 *
 * Main persists the document this module describes (`notifications.json`) and every window renders
 * it; neither decides anything about it. Everything that is a RULE — what makes two raises one entry,
 * what a limit drops, when the limit warning fires, how entries are ordered, what the badge counts —
 * lives here, where it is provable without a file, a window or a clock.
 *
 * Every function is total and pure: it returns a new document and never mutates its input. A caller
 * supplies the id and the time, because an id generator and a clock are I/O.
 */

import { normalisePlace, type NoticeOrigin, type NoticePlace } from './place.js';

/** The five notification types an entry can carry (FR-024), in priority order, most severe first. */
export const ENTRY_SEVERITIES = ['error', 'warning', 'attention', 'info', 'success'] as const;
export type EntrySeverity = (typeof ENTRY_SEVERITIES)[number];

/** How the panel lists its entries (FR-028). */
export const NOTIFICATION_ORDERS = ['oldest', 'newest', 'priority-oldest', 'priority-newest'] as const;
export type NotificationOrder = (typeof NOTIFICATION_ORDERS)[number];
export const DEFAULT_NOTIFICATION_ORDER: NotificationOrder = 'oldest';

/**
 * An action an entry can offer, as DATA (a toast's closures cannot be stored). A descriptor whose
 * target no longer exists is hidden by the panel (FR-031a).
 */
export type NotificationActionDescriptor =
  /** `projectId`: the panel's project, when known — set on a link built from an entry's origin, never stored. */
  | { kind: 'goToPanel'; panelId: string; label: string; projectId?: string }
  | { kind: 'openFile'; projectId: string; relPath: string; label: string }
  | { kind: 'openPreferences'; section: string; label: string };

export interface NotificationAffected {
  panelId?: string;
  label: string;
}

/** What a window sends to add an entry; main assigns the id and the bookkeeping. */
export interface NotificationEntryInput {
  /** The group key, when the notice has one; otherwise the content key is derived (FR-029). */
  groupKey?: string;
  severity: EntrySeverity;
  title?: string;
  message?: string;
  action?: string;
  /** The subject, already formatted. */
  subject?: string;
  /** The raising surface and instance — part of the duplicate rule the toast uses (B11). Not stored. */
  testId?: string;
  instanceKey?: string;
  details: string[];
  /** What Copy puts on the clipboard; equals the toast's copy text. */
  copyText: string;
  affected: NotificationAffected[];
  actions: NotificationActionDescriptor[];
  /** What the notice relates to (FR-061); a `panelId` makes the entry a link to that panel (FR-063). */
  origin?: NoticeOrigin;
  /** The names shown for it when it was raised, as `Project › Tab › Panel` (FR-061). A snapshot. */
  place?: NoticePlace;
}

export interface NotificationEntry {
  id: string;
  /** The dedupe key: {@link entryKey}. */
  key: string;
  severity: EntrySeverity;
  title?: string;
  message?: string;
  action?: string;
  subject?: string;
  details: string[];
  copyText: string;
  affected: NotificationAffected[];
  actions: NotificationActionDescriptor[];
  /** See {@link NotificationEntryInput.origin}. */
  origin?: NoticeOrigin;
  /** See {@link NotificationEntryInput.place}: kept as first raised, across a repeat and a restart. */
  place?: NoticePlace;
  /** First raise, ms since the epoch; a repeat does not change it. */
  raisedAt: number;
  /** Bumped on a repeat. */
  repeatCount: number;
}

export interface NotificationsDocument {
  version: 1;
  order: NotificationOrder;
  /** The user closed the limit warning's X: never warn again (FR-031g). */
  limitWarningDismissed: boolean;
  /** The warning has been raised for the current stretch at the limit (FR-031f). */
  limitWarningShown: boolean;
  entries: NotificationEntry[];
}

export function emptyNotificationsDocument(): NotificationsDocument {
  return { version: 1, order: DEFAULT_NOTIFICATION_ORDER, limitWarningDismissed: false, limitWarningShown: false, entries: [] };
}

/**
 * The key two raises share when they are one condition: the group key, else what the notice says — the same
 * fields the toast's duplicate rule compares (043 T237): severity, message, title, action, raiser, instance,
 * subject AND the detail lines. Two summaries with equal headlines but different file lists are two events.
 */
export function entryKey(
  input: Pick<NotificationEntryInput, 'groupKey' | 'severity' | 'message' | 'title' | 'subject' | 'action' | 'testId' | 'instanceKey' | 'details'>,
): string {
  if (input.groupKey) return `group:${input.groupKey}`;
  return [
    'content',
    input.severity,
    input.message ?? '',
    input.title ?? '',
    input.action ?? '',
    input.testId ?? '',
    input.instanceKey ?? '',
    input.subject ?? '',
    input.details.join('␞'),
  ].join('␟');
}

export interface AddOptions {
  id: string;
  now: number;
  limit: number;
}

export interface AddResult {
  doc: NotificationsDocument;
  outcome: 'added' | 'repeat';
  /** The new entry's id, or the existing one's on a repeat. */
  id: string;
  /** Oldest entries trimmed to hold the limit — the store logs each one (FR-031e). */
  dropped: NotificationEntry[];
  /** True exactly once per stretch at the limit, unless the warning was dismissed for good. */
  limitReached: boolean;
}

const sameCasualty = (a: { panelId?: string; label: string }, b: { panelId?: string; label: string }): boolean =>
  a.panelId !== undefined && b.panelId !== undefined ? a.panelId === b.panelId : a.label === b.label;

/**
 * A grown notice (030 FR-037) reports the same condition again naming more casualties: fold the new ones,
 * and any new detail line, into the stored entry (FR-029 "update its entry in place"). A casualty or detail
 * already held adds nothing. The copy text gains one line per new casualty or detail, so Copy names what the
 * entry names without this pure model knowing how a notice is worded.
 */
function growEntry(entry: NotificationEntry, input: NotificationEntryInput): NotificationEntry {
  const newCasualties = input.affected.filter((a) => !entry.affected.some((held) => sameCasualty(held, a)));
  const newDetails = input.details.filter((d) => !entry.details.includes(d));
  if (newCasualties.length === 0 && newDetails.length === 0) return entry;
  return {
    ...entry,
    affected: [...entry.affected, ...newCasualties.map((a) => ({ ...a }))],
    details: [...entry.details, ...newDetails],
    copyText: [entry.copyText, ...newCasualties.map((a) => a.label), ...newDetails].join('\n'),
  };
}

/**
 * Add an entry, or fold a repeat into the one that exists (FR-029): a repeat bumps `repeatCount`,
 * keeps `raisedAt` and the id, and nothing else.
 * Past the limit the oldest are dropped; reaching it reports `limitReached` once (FR-031f).
 */
export function addEntry(doc: NotificationsDocument, input: NotificationEntryInput, options: AddOptions): AddResult {
  const key = entryKey(input);
  const existing = doc.entries.find((e) => e.key === key);
  if (existing) {
    const entries = doc.entries.map((e) =>
      e.id === existing.id ? { ...growEntry(e, input), repeatCount: e.repeatCount + 1 } : e,
    );
    return { doc: { ...doc, entries }, outcome: 'repeat', id: existing.id, dropped: [], limitReached: false };
  }
  const entry: NotificationEntry = {
    id: options.id,
    key,
    severity: input.severity,
    ...(input.title !== undefined ? { title: input.title } : {}),
    ...(input.message !== undefined ? { message: input.message } : {}),
    ...(input.action !== undefined ? { action: input.action } : {}),
    ...(input.subject !== undefined ? { subject: input.subject } : {}),
    details: [...input.details],
    copyText: input.copyText,
    affected: input.affected.map((a) => ({ ...a })),
    actions: input.actions.map((a) => ({ ...a })),
    ...originOf(input.origin),
    ...placeOf(input.place),
    raisedAt: options.now,
    repeatCount: 1,
  };
  const appended = { ...doc, entries: [...doc.entries, entry] };
  const { doc: trimmed, dropped } = applyLimit(appended, options.limit);
  const reached =
    !trimmed.limitWarningDismissed && !trimmed.limitWarningShown && trimmed.entries.length >= options.limit;
  return {
    doc: reached ? { ...trimmed, limitWarningShown: true } : trimmed,
    outcome: 'added',
    id: options.id,
    dropped,
    limitReached: reached,
  };
}

/** Drop the oldest entries (by `raisedAt`, then by position) down to `limit`. */
export function applyLimit(doc: NotificationsDocument, limit: number): { doc: NotificationsDocument; dropped: NotificationEntry[] } {
  const excess = doc.entries.length - Math.max(0, Math.floor(limit));
  if (excess <= 0) return { doc, dropped: [] };
  const oldest = [...doc.entries]
    .map((e, index) => ({ e, index }))
    .sort((a, b) => a.e.raisedAt - b.e.raisedAt || a.index - b.index)
    .slice(0, excess)
    .map((x) => x.e);
  const gone = new Set(oldest.map((e) => e.id));
  return { doc: { ...doc, entries: doc.entries.filter((e) => !gone.has(e.id)) }, dropped: oldest };
}

/** The warning arms again once the count falls below the limit (unless it was dismissed for good). */
export function rearm(doc: NotificationsDocument, limit: number): NotificationsDocument {
  if (doc.limitWarningShown && !doc.limitWarningDismissed && doc.entries.length < limit) {
    return { ...doc, limitWarningShown: false };
  }
  return doc;
}

export function dismissEntry(doc: NotificationsDocument, id: string, limit: number): NotificationsDocument {
  if (!doc.entries.some((e) => e.id === id)) return doc;
  return rearm({ ...doc, entries: doc.entries.filter((e) => e.id !== id) }, limit);
}

export function dismissAllEntries(doc: NotificationsDocument): NotificationsDocument {
  return { ...doc, entries: [], limitWarningShown: doc.limitWarningDismissed ? doc.limitWarningShown : false };
}

export function setOrder(doc: NotificationsDocument, order: NotificationOrder): NotificationsDocument {
  return { ...doc, order: isOrder(order) ? order : DEFAULT_NOTIFICATION_ORDER };
}

/**
 * Following the warning's link is NOT a refusal (FR-031g): the card closes, and the warning is armed again, so
 * the user who raised the limit is warned when they fill the new one. Only {@link dismissLimitWarning} is permanent.
 */
export function followLimitWarning(doc: NotificationsDocument): NotificationsDocument {
  return doc.limitWarningShown ? { ...doc, limitWarningShown: false } : doc;
}

/** The warning is on screen, or was when the app last ran, and the user has neither dismissed nor followed it (FR-031f). */
export function limitWarningActive(doc: NotificationsDocument): boolean {
  return doc.limitWarningShown && !doc.limitWarningDismissed;
}

/** The X on the limit warning: never warn again (FR-031g). */
export function dismissLimitWarning(doc: NotificationsDocument): NotificationsDocument {
  return { ...doc, limitWarningDismissed: true };
}

const RANK: Record<EntrySeverity, number> = { error: 0, warning: 1, attention: 2, info: 3, success: 4 };

/** The entries in the panel's order (FR-028). Never mutates its input. */
export function orderEntries(entries: readonly NotificationEntry[], order: NotificationOrder): NotificationEntry[] {
  const indexed = entries.map((e, index) => ({ e, index }));
  const byTime = (a: { e: NotificationEntry; index: number }, b: { e: NotificationEntry; index: number }): number =>
    a.e.raisedAt - b.e.raisedAt || a.index - b.index;
  const newestFirst = order === 'newest' || order === 'priority-newest';
  const prioritised = order === 'priority-oldest' || order === 'priority-newest';
  indexed.sort((a, b) => {
    if (prioritised) {
      const rank = RANK[a.e.severity] - RANK[b.e.severity];
      if (rank !== 0) return rank;
    }
    return newestFirst ? byTime(b, a) : byTime(a, b);
  });
  return indexed.map((x) => x.e);
}

/**
 * The badge's count and colour: every entry not yet dismissed, and the most severe of them (FR-059). Nothing about
 * the panel's visibility enters it, so minimising, restoring, hiding or showing change neither.
 */
export function pendingSummary(entries: readonly NotificationEntry[]): { count: number; severity: EntrySeverity | null } {
  let count = 0;
  let severity: EntrySeverity | null = null;
  for (const e of entries) {
    count += 1;
    if (severity === null || RANK[e.severity] < RANK[severity]) severity = e.severity;
  }
  return { count, severity };
}

/** An origin with nothing in it is no origin. */
export function originOf(origin: NoticeOrigin | undefined): { origin?: NoticeOrigin } {
  const panelId = origin?.panelId || undefined;
  const projectId = origin?.projectId || undefined;
  if (panelId === undefined && projectId === undefined) return {};
  return { origin: { ...(panelId !== undefined ? { panelId } : {}), ...(projectId !== undefined ? { projectId } : {}) } };
}

function placeOf(place: NoticePlace | undefined): { place?: NoticePlace } {
  const normal = normalisePlace(place);
  return normal ? { place: normal } : {};
}

function isOrder(v: unknown): v is NotificationOrder {
  return NOTIFICATION_ORDERS.includes(v as NotificationOrder);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

function parseAction(raw: unknown): NotificationActionDescriptor | undefined {
  if (!isRecord(raw)) return undefined;
  const label = str(raw.label);
  if (label === undefined) return undefined;
  if (raw.kind === 'goToPanel' && typeof raw.panelId === 'string') return { kind: 'goToPanel', panelId: raw.panelId, label };
  if (raw.kind === 'openFile' && typeof raw.projectId === 'string' && typeof raw.relPath === 'string') {
    return { kind: 'openFile', projectId: raw.projectId, relPath: raw.relPath, label };
  }
  if (raw.kind === 'openPreferences' && typeof raw.section === 'string') return { kind: 'openPreferences', section: raw.section, label };
  return undefined;
}

function parseEntry(raw: unknown): NotificationEntry | undefined {
  if (!isRecord(raw)) return undefined;
  const id = str(raw.id);
  const key = str(raw.key);
  const copyText = str(raw.copyText);
  if (id === undefined || key === undefined || copyText === undefined) return undefined;
  if (!ENTRY_SEVERITIES.includes(raw.severity as EntrySeverity)) return undefined;
  if (typeof raw.raisedAt !== 'number' || !Number.isFinite(raw.raisedAt)) return undefined;
  const list = <T>(v: unknown, f: (x: unknown) => T | undefined): T[] =>
    Array.isArray(v) ? v.map(f).filter((x): x is T => x !== undefined) : [];
  const title = str(raw.title);
  const message = str(raw.message);
  const action = str(raw.action);
  const subject = str(raw.subject);
  return {
    id,
    key,
    severity: raw.severity as EntrySeverity,
    ...(title !== undefined ? { title } : {}),
    ...(message !== undefined ? { message } : {}),
    ...(action !== undefined ? { action } : {}),
    ...(subject !== undefined ? { subject } : {}),
    details: list(raw.details, str),
    copyText,
    affected: list(raw.affected, (a) => {
      if (!isRecord(a)) return undefined;
      const label = str(a.label);
      if (label === undefined) return undefined;
      const panelId = str(a.panelId);
      return panelId === undefined ? { label } : { panelId, label };
    }),
    actions: list(raw.actions, parseAction),
    ...originOf(isRecord(raw.origin) ? { panelId: str(raw.origin.panelId), projectId: str(raw.origin.projectId) } : undefined),
    ...placeOf(isRecord(raw.place) ? { project: str(raw.place.project), tab: str(raw.place.tab), panel: str(raw.place.panel) } : undefined),
    raisedAt: raw.raisedAt,
    repeatCount: typeof raw.repeatCount === 'number' && raw.repeatCount >= 1 ? Math.floor(raw.repeatCount) : 1,
  };
}

/**
 * Read a stored document. TOTAL: anything that is not a version-1 document is an empty one, and an
 * entry that is malformed is dropped on its own, so one bad row costs one entry rather than the file
 * (FR-031c). The store sets a document with another version aside before it gets here.
 */
export function parseNotificationsDocument(raw: unknown): NotificationsDocument {
  if (!isRecord(raw) || raw.version !== 1 || !Array.isArray(raw.entries)) return emptyNotificationsDocument();
  return {
    version: 1,
    order: isOrder(raw.order) ? raw.order : DEFAULT_NOTIFICATION_ORDER,
    limitWarningDismissed: raw.limitWarningDismissed === true,
    limitWarningShown: raw.limitWarningShown === true,
    entries: raw.entries.map(parseEntry).filter((e): e is NotificationEntry => e !== undefined),
  };
}
