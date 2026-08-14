/**
 * 029 FR-019 — one cause, one notice.
 *
 * Kept as a plain module rather than living inside {@link NotificationProvider} so the rule is
 * unit-testable without a DOM (every vitest project here runs `environment: 'node'`). Same shape as
 * `terminal/exit-store.ts`, for the same reason.
 *
 * ══ WHAT THIS COLLAPSES, AND WHAT IT MUST NOT ══
 *
 * Measured on master: a missing project root raises TWO notices for ONE absent folder — an
 * `ENOENT: … realpath` from the file tree and an `Internal error: Cannot lock …` from a terminal
 * trying to attach. One problem, told twice, in two vocabularies, neither naming the folder.
 *
 * But `notice-stacking.e2e.ts` proves two DIFFERENT failures must still be two notices — that was
 * itself a fix (#178), where the model dropped any live notice sharing a test id and silently chose
 * which of the user's two problems to report. So the key must be exactly as coarse as "the same
 * underlying cause" and no coarser: kind + subject, never the surface and never the message text.
 */

/**
 * Is this cause already on screen?
 *
 * `liveKeys` are the cause keys of the notices currently displayed — which is what bounds
 * suppression to the notice's own lifetime (FR-019c). A dismissed notice is simply not in the list,
 * so the cause re-arms with no timer and no correlation id to maintain.
 */
export function shouldSuppressForCause(liveKeys: readonly string[], incomingKey: string | undefined): boolean {
  // FR-011b: a failure matching none of the five kinds has NO cause, and must keep today's
  // behaviour. Suppressing on a falsy key would silently collapse unrelated raw errors into one —
  // the opposite of the requirement, and invisible when it happened.
  if (!incomingKey) return false;
  return liveKeys.includes(incomingKey);
}

/* ════════════════════════════════════════════════════════════════════════════════════════════════
 * 030 FR-029 / FR-034a — a CONSOLIDATED notice supersedes the surface-level one it shares a cause
 * with, and inherits the raw error it was carrying.
 * ════════════════════════════════════════════════════════════════════════════════════════════════ */

/** The identity-bearing parts of a live notice, as the supersede rule needs them. */
export interface SupersedableNotice {
  causeKey?: string;
  /** Present on a CONSOLIDATED notice — the panels one cause defeated. */
  affected?: readonly unknown[];
  /** The raw system error, copied and logged but never rendered (FR-034). */
  copyDetail?: string;
}

export interface SupersedeResult<T> {
  /** The notices that stand, in order. */
  keep: readonly T[];
  /** The raw errors the superseded notices were carrying — the survivor must keep them. */
  carried: readonly string[];
}

/**
 * Which live notices does an incoming raise displace, and what must the survivor inherit?
 *
 * 029 collapses two notices that share a cause, and 030 exempts the consolidated one from being the
 * one dropped: it says which PANELS the cause defeated, which the surface-level notice cannot know.
 * This is the other half of that exemption — without it the pair is two notices whenever the file
 * tree reports first, which is the storm FR-029 exists to end, reduced from twelve to two rather
 * than to one.
 *
 * ══ WHY IT LIVES HERE ══
 *
 * It was an inline filter in the provider. That put it out of reach of every test except an E2E,
 * and the one E2E that asserts it drives a TERMINAL — so when the editor path turned out to report
 * without a cause, and could therefore never supersede anything, nothing failed. A user found it:
 * rename a project's root, reopen it, and get two notices for one absent folder.
 *
 * ══ CARRIED ══
 *
 * The superseded notice is usually the only thing naming the FOLDER whose disappearance defeated
 * everything; the consolidated notice's rows name each missing FILE. Dropping the notice without its
 * raw error would fix the duplicate by discarding the one fact it held — invisibly, because the raw
 * error is never on screen. So it comes out here and the caller folds it into the survivor's copy.
 */
export function supersede<T extends SupersedableNotice>(
  live: readonly T[],
  incoming: SupersedableNotice,
): SupersedeResult<T> {
  // Only a consolidated notice displaces anything, and only on a real cause. An empty key is not a
  // cause (FR-011b) — treating it as one would collapse every unclassified failure into the next
  // consolidated notice to arrive.
  if (!incoming.affected?.length || !incoming.causeKey) return { keep: live, carried: [] };

  const keep: T[] = [];
  const carried: string[] = [];
  for (const notice of live) {
    // Never another CONSOLIDATED notice: each holds its own panel list, and dropping one would
    // silently discard the casualties only it was speaking for.
    const displaced = notice.causeKey === incoming.causeKey && !notice.affected?.length;
    if (!displaced) {
      keep.push(notice);
      continue;
    }
    if (notice.copyDetail && !carried.includes(notice.copyDetail)) carried.push(notice.copyDetail);
  }
  return { keep, carried };
}

/* ════════════════════════════════════════════════════════════════════════════════════════════════
 * 030 FR-005b/FR-005c — the SHADOW, for notices the user chose never to see.
 *
 * Both rules above are bounded by the LIVE list, and that is deliberate: a notice on screen is what
 * makes a repeat redundant, and dismissing it re-arms the cause with no timer to tune. But a notice
 * whose severity is set to *Never display* never joins that list, so for such a severity both checks
 * compare against nothing — and a watcher re-reporting one unchanged failure would write one log
 * record per repeat, while the same event displayed writes exactly one. SC-003 says those two counts
 * are the same, and it would be false in the direction nobody looks at.
 *
 * So a silenced notice leaves a trace that is not a notice: no id, never rendered, never dismissible,
 * expiring after the dwell the notice WOULD have had (its severity's `timeoutMs`, which every
 * severity carries whatever its mode, precisely for this). Entries are pruned on the next raise, so
 * the map is bounded by the number of distinct silenced events inside one window and owns no timer.
 * ════════════════════════════════════════════════════════════════════════════════════════════════ */

/** One silenced event, remembered for as long as its notice would have stood. */
export interface SilencedEntry {
  /** Epoch ms after which this entry says nothing — the dwell the notice would have had. */
  expiresAt: number;
  /** The cause it reported, so the cause rule sees it too (FR-019 parity). */
  causeKey?: string;
  /**
   * The panels already reported under this key — what makes FR-005c decidable.
   *
   * The duplicate tuple is `severity + message + title + action + testId + subject`, and not one of those
   * changes when a cause that keeps claiming panels reports newly discovered ones. Without this set
   * the shadow would swallow exactly the records the displayed path emits as a notice GROWS.
   */
  reported: Set<string>;
}

/** key → entry. Deliberately a plain `Map` the provider owns; there is no store here. */
export type SilencedNotices = Map<string, SilencedEntry>;

/** The identity-bearing parts of a notice, as the shadow needs them. */
export interface SilencedKeyParts {
  severity: string;
  message: string;
  title?: string;
  action?: string;
  testId?: string;
  /**
   * The notice's subject, ALREADY RENDERED (030 US2).
   *
   * A string rather than a `NoticeSubject`, so this module stays free of the subject model and the
   * provider formats it exactly once for the duplicate rule, the shadow and the log record alike.
   * It is part of the tuple for the reason it is part of the duplicate rule: two files refused for
   * the same reason produce identical text and differ only here, and a shadow blind to that would
   * silence the second event in the only record a silenced severity has.
   */
  subject?: string;
  /** Present when the notice consolidates — then it, and not the tuple, is the identity. */
  groupKey?: string;
}

/**
 * What a silenced notice is remembered under.
 *
 * **The group key wins where there is one**, and the duplicate tuple is used only where there is
 * not. Keying purely on the tuple breaks parity for unclassified failures: two different operations
 * producing identical message text — reopening the same broken project twice inside one window —
 * carry different group keys, so the DISPLAYED path raises a second notice (FR-037a) while a
 * tuple-keyed shadow would silently suppress it. And keying on `causeKey` alone would be worse
 * still: it drops the project and operation dimensions the group key exists to carry, collapsing one
 * cause across every project open at once.
 *
 * `\u0000` joins the tuple because it cannot occur in any of the parts — a message containing the
 * separator would otherwise let two different notices share one key.
 */
export function silencedNoticeKey(parts: SilencedKeyParts): string {
  if (parts.groupKey) return `group\u0000${parts.groupKey}`;
  return [
    'tuple',
    parts.severity,
    parts.message,
    parts.title ?? '',
    parts.action ?? '',
    parts.testId ?? '',
    parts.subject ?? '',
  ].join('\u0000');
}

/** Drop what has expired. Called on every raise, which is the only clock this needs. */
export function pruneSilenced(map: SilencedNotices, now: number): void {
  for (const [key, entry] of map) {
    if (entry.expiresAt <= now) map.delete(key);
  }
}

/**
 * The panel ids this raise names that its key has not already reported (FR-005c).
 *
 * A notice naming no panels at all — which is every notice until US3 gives `NoticeInput` its
 * `affected` list — reports nothing new by definition, so the ordinary duplicate rule applies to it
 * unchanged.
 */
export function unreportedPanels(
  map: SilencedNotices,
  key: string,
  panelIds: readonly string[],
): string[] {
  const entry = map.get(key);
  if (!entry) return [...panelIds];
  return panelIds.filter((id) => !entry.reported.has(id));
}

/**
 * What a silenced raise ADDS to what its key already holds.
 *
 * FR-005c does not stop at "the second casualty is not swallowed". It requires the record the
 * silenced path writes to match the displayed path's growth record (FR-006a) **in content as well as
 * in count** — so the shadow has to be able to answer the two questions the live notice answers from
 * its `affected` list: what is NEW, and how big is the whole thing now.
 *
 * It can, and only just: `reported` is the set the displayed path keeps as an array. Without this
 * the silenced log said `affected=1` twice for a cause holding two panels, and named the same panel
 * in both records — a reader could not tell one cause claiming two panels from two unrelated
 * failures, which is the distinction the count exists to draw.
 */
export interface SilencedGrowth {
  /** The ids this raise names that the key has not seen — what the record must name (FR-006a). */
  readonly unreported: readonly string[];
  /** How many panels the key holds once this raise is remembered — the displayed notice's count. */
  readonly total: number;
  /**
   * Whether the key ALREADY held panels, i.e. this raise is a growth rather than a first report.
   *
   * The distinction is the same one `mergeAffected`'s identity return draws for the displayed path:
   * a first report states the cause, a growth states what joined it.
   */
  readonly grew: boolean;
}

export function silencedGrowth(
  map: SilencedNotices,
  key: string,
  panelIds: readonly string[],
  now: number,
): SilencedGrowth {
  const entry = map.get(key);
  const live = entry && entry.expiresAt > now ? entry : undefined;
  const unreported = live ? panelIds.filter((id) => !live.reported.has(id)) : [...panelIds];
  return {
    unreported,
    total: (live?.reported.size ?? 0) + unreported.length,
    grew: (live?.reported.size ?? 0) > 0,
  };
}

/**
 * Is this raise saying nothing the shadow has not already recorded?
 *
 * True only when an unexpired entry exists for the key AND the raise names no panel absent from it.
 * That second clause is the whole of FR-005c, and it is the mirror of FR-006a's growth record: a
 * notice that has grown is a further event and must reach the log as one.
 */
export function shouldSuppressSilenced(
  map: SilencedNotices,
  key: string,
  panelIds: readonly string[],
  now: number,
): boolean {
  const entry = map.get(key);
  if (!entry || entry.expiresAt <= now) return false;
  return unreportedPanels(map, key, panelIds).length === 0;
}

/**
 * The causes silenced notices are still speaking for.
 *
 * Fed to {@link shouldSuppressForCause} alongside the live notices' keys, so "one cause, one notice"
 * means the same thing whether or not the user can see it. Empty keys are dropped for the reason
 * that rule refuses them: an unclassified failure is not a cause.
 */
export function silencedCauseKeys(map: SilencedNotices, now: number): string[] {
  const keys: string[] = [];
  for (const entry of map.values()) {
    if (entry.expiresAt <= now) continue;
    if (entry.causeKey) keys.push(entry.causeKey);
  }
  return keys;
}

/** Record a silenced raise, merging its panels into whatever the key already reported. */
export function rememberSilenced(
  map: SilencedNotices,
  key: string,
  raise: { expiresAt: number; causeKey?: string; panelIds?: readonly string[] },
): void {
  const existing = map.get(key);
  const reported = existing?.reported ?? new Set<string>();
  for (const id of raise.panelIds ?? []) reported.add(id);
  map.set(key, {
    // The dwell restarts on each accepted raise, exactly as a re-displayed notice's would.
    expiresAt: raise.expiresAt,
    causeKey: raise.causeKey ?? existing?.causeKey,
    reported,
  });
}
