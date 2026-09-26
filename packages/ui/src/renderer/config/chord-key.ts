// `sameBindingSymbolOfCode` and `tier1PhysicalKey` are `@throng/core`'s own copy of these two rules
// (packages/core/src/config/chord-capture.ts, shared with the capture modal's `captureToken`) —
// reused here rather than re-derived, so the renderer and core cannot drift apart on either rule
// again the way they did (review fix round CRITICAL/MINOR): a duplicated Ctrl+Alt same-binding match
// shipped here without core's AltGr guard, folding a German AltGr+ß or an AZERTY AltGr+= onto
// panel.zoomOut/panel.zoomIn and eating the keystroke.
import { keypadHidesShift, sameBindingSymbolOfCode, tier1PhysicalKey } from '@throng/core';

/**
 * The layout-independent key segment for a keyboard chord.
 *
 * throng's key bindings are matched on the produced character (`e.key`), which is
 * friendly for most keys but wrong for the **backtick** key: on a US layout
 * Shift+backtick is `~`, but on a UK (and other) layout it is `¬`, and `~` sits on
 * an entirely different physical key. So a chord meant as "Ctrl+Shift+backtick"
 * (focus cycle-back, 012) cannot be expressed as a produced character portably.
 *
 * We normalise just that one physical key — `e.code === 'Backquote'` → `` ` `` —
 * so a default like `Ctrl+Shift+`` works on every layout; the Shift modifier then
 * distinguishes cycle from cycle-back. Every other key keeps its produced-character
 * behaviour unchanged.
 */
export function chordKey(e: { code: string; key: string }): string {
  return e.code === 'Backquote' ? '`' : e.key;
}

/** Whether the event is the physical backtick key (whose Shift state is meaningful). */
export function isBackquote(e: { code: string }): boolean {
  return e.code === 'Backquote';
}

/** The subset of a native `KeyboardEvent` {@link chordCandidates} reads. */
export interface ChordEventLike {
  code: string;
  key: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  /**
   * 046 iterate round 1 (FR-104) — optional so a caller that never holds Meta (most of the unit
   * suite's hand-built events) need not spell it out; read as `false` when absent.
   */
  metaKey?: boolean;
  /** A real event's own; read only for `'NumLock'` (046 FR-120). Absent → no NumLock correction. */
  getModifierState?: (key: 'NumLock') => boolean;
}

/**
 * The event with the Shift Windows hid under NumLock restored (046 FR-120, core's
 * `keypadHidesShift`): NumLock-ON Ctrl+Shift+Alt+Numpad0 reports `shiftKey` false and `key` `Insert`.
 * Copies the fields by name — a DOM event's `code`/`key` are prototype getters a spread would lose.
 */
function withKeypadShift(e: ChordEventLike): ChordEventLike {
  const numLock = e.getModifierState ? e.getModifierState('NumLock') : undefined;
  if (!keypadHidesShift(e.code, e.key, e.shiftKey, numLock)) return e;
  return { code: e.code, key: e.key, ctrlKey: e.ctrlKey, altKey: e.altKey, shiftKey: true, metaKey: e.metaKey };
}

/** Whether Shift was held, counting a Shift Windows hid from a NumLock-ON keypad press (FR-120). */
export function effectiveShift(e: ChordEventLike): boolean {
  return withKeypadShift(e).shiftKey;
}

/**
 * Rule 1 + rule 1b: the ONE physical candidate the tier-1 rule or the Ctrl+Alt same-binding rule
 * matches, or `undefined` when neither applies. Both are early-return rules (contracts §4 rule 1,
 * FR-104, FR-105): when either fires, it is the ONLY candidate — the produced token is not also
 * emitted. `e.code` truthiness guards both: a real keydown always carries one, but an event built
 * without it (a hand-rolled `KeyboardEventInit` that names only `key`) falls through instead of
 * matching on an empty physical key.
 */
function samePhysicalCandidate(e: ChordEventLike): string | undefined {
  if (e.metaKey) return undefined;

  // Rule 1: Ctrl+Shift+Alt, matched on the PHYSICAL code — the whole navigation/application tier.
  if (e.ctrlKey && e.shiftKey && e.altKey && e.code) {
    return `Ctrl+Shift+Alt+${tier1PhysicalKey(e.code, e.key)}`;
  }

  // Rule 1b: the `+`/`-` key, matched physically for Ctrl+Alt without Shift — the shape
  // `panel.zoomIn` / `panel.zoomOut` ship (`Ctrl+Alt++` / `Ctrl+Alt+-`), so the unshifted `=` key and
  // the keypad `+` both reach it. Guarded by `sameBindingSymbolOfCode` on the PRODUCED key, not the
  // code alone (review fix round CRITICAL): on Windows, AltGr is reported as Ctrl+Alt together (R22),
  // so an unguarded code match would fold a German AltGr+ß (physical Minus, produces `\`) or an
  // AZERTY AltGr+= (physical Equal, produces `}`) onto this same-binding rule and eat the keystroke.
  if (e.ctrlKey && e.altKey && !e.shiftKey && e.code) {
    const symbol = sameBindingSymbolOfCode(e.code, e.key);
    if (symbol) return `Ctrl+Alt+${symbol}`;
  }

  return undefined;
}

/**
 * Rule 2 (§2.1): the physical digit, Ctrl held and Alt not held, Shift kept, or `undefined`.
 *
 * 046 iterate round 2 (FR-114) — the maintainer's own words, mid-build: "The 'Zoom Reset' key
 * bindings need to use the numpad zero, NOT the 0 key." Before this round `Numpad0` aliased `Digit0`
 * here unconditionally (FR-105's "no `Numpad…` token" rule), which was right while `zoom.reset`'s
 * target genuinely was the main-row `0`. Now `Numpad0` is a command's own literal key (`zoom.reset` /
 * `panel.zoomReset`, both matched through rule 1/1b instead, since both require Alt and this rule
 * explicitly excludes it), so the blanket alias is gone: `Numpad0` produces its OWN candidate token,
 * never folded onto `Digit0`'s. `Digit0`–`Digit9` are unaffected — every other Ctrl+digit command
 * resolves exactly as before.
 */
function digitCandidate(e: ChordEventLike): string | undefined {
  if (e.metaKey) return undefined;
  const digitCode = /^Digit([0-9])$/.exec(e.code);
  const digit = digitCode ? digitCode[1] : e.code === 'Numpad0' ? 'Numpad0' : undefined;
  if (digit === undefined || !e.ctrlKey || e.altKey) return undefined;
  const parts = ['Ctrl'];
  if (e.shiftKey) parts.push('Shift');
  parts.push(digit);
  return parts.join('+');
}

/**
 * The layout-independent key CANDIDATES for a keyboard chord (046 FR-021, FR-026, FR-104, FR-105,
 * R2, R22).
 *
 * throng matches a chord on the PRODUCED character (`e.key`), which is wrong for the digit row and,
 * as of the iterate-round-1 tier, for the whole `Ctrl+Shift+Alt` navigation/application tier: the
 * character a layout produces for a given physical key varies (`)` on US, `=` on German for
 * Shift+0; a comma on AZERTY for the `M` key) — and `zoom.reset`'s default (046 iterate round 2,
 * FR-114, `Ctrl+Shift+Alt+Numpad0`) matches on physical code alone regardless of what a keypad
 * produces at all.
 * `chordCandidates(e)` widens matching to try the PHYSICAL key first — so a chord resolves on every
 * layout the produced-character match already covered, plus every layout it did not — while never
 * matching a symbol AltGr typed on purpose (Alt held excludes the tier-1 rule, which requires Shift
 * too; the same-binding rule's own `sameBindingSymbolOfCode` guard excludes it directly) and never
 * colliding with it.
 *
 * [contracts/keybindings-and-focus.md](../../../../specs/046-side-panes-and-project-list/contracts/keybindings-and-focus.md)
 * §2 and §4 are the source of truth for every rule below and for the example tables.
 */
export function chordCandidates(event: ChordEventLike): string[] {
  if (event.metaKey) return [];
  const e = withKeypadShift(event);

  const same = samePhysicalCandidate(e);
  if (same !== undefined) return [same];

  const candidates: string[] = [];
  const digit = digitCandidate(e);
  if (digit !== undefined) candidates.push(digit);

  // Rule 3 (§2.2): the produced token, built exactly as today — the same Shift-keeping rule the
  // window-chord listener has always applied (app.tsx): Shift is kept only for the physical
  // backtick, an F-key, a single letter or an arrow key, because for every other key the produced
  // character already encodes Shift (`)` for Shift+0, `+` for Shift+=).
  const keepShift =
    isBackquote(e) ||
    /^F\d{1,2}$/.test(e.key) ||
    /^[a-z]$/i.test(e.key) ||
    /^Arrow(Left|Right|Up|Down)$/.test(e.key);
  const parts: string[] = [];
  if (e.ctrlKey) parts.push('Ctrl');
  if (keepShift && e.shiftKey) parts.push('Shift');
  if (e.altKey) parts.push('Alt');
  parts.push(chordKey(e));
  candidates.push(parts.join('+'));

  // Rule 4 (§2.3): duplicates removed, the physical digit token first.
  return [...new Set(candidates)];
}

/**
 * The modifiers CARRIED into a two-stroke chord's second stroke (046 iterate round 4, FR-123): those
 * held at the first stroke and not released since.
 */
export interface CarriedModifiers {
  readonly ctrl: boolean;
  readonly alt: boolean;
  readonly shift: boolean;
  readonly meta: boolean;
}

/** Nothing carried — no first stroke is pending. */
export const NO_CARRIED: CarriedModifiers = Object.freeze({ ctrl: false, alt: false, shift: false, meta: false });

/** The modifiers held at the first stroke, which the second stroke inherits until each is released. */
export function carriedModifiers(first: ChordEventLike): CarriedModifiers {
  return { ctrl: first.ctrlKey, alt: first.altKey, shift: first.shiftKey, meta: first.metaKey ?? false };
}

/** A modifier's keyup while a prefix is pending drops it: pressed again, it counts (FR-123). */
export function releaseCarried(carried: CarriedModifiers, keyup: { key: string }): CarriedModifiers {
  switch (keyup.key) {
    case 'Control':
      return { ...carried, ctrl: false };
    case 'Alt':
    case 'AltGraph':
      return { ...carried, alt: false };
    case 'Shift':
      return { ...carried, shift: false };
    case 'Meta':
    case 'OS':
      return { ...carried, meta: false };
    default:
      return carried;
  }
}

/**
 * Whether a keyup lets go of a modifier the first stroke held (046 FR-124). While a prefix is pending
 * that ENDS it, at once and silently: a two-stroke chord is one continuous press.
 */
export function releasesCarried(carried: CarriedModifiers, keyup: { key: string }): boolean {
  switch (keyup.key) {
    case 'Control':
      return carried.ctrl;
    case 'Alt':
    case 'AltGraph':
      return carried.alt;
    case 'Shift':
      return carried.shift;
    case 'Meta':
    case 'OS':
      return carried.meta;
    default:
      return false;
  }
}

/**
 * Whether a keydown still holds every modifier the first stroke held (046 FR-124). False means one
 * was let go even though its keyup never arrived here (it went to another element or window), and the
 * pending prefix is over just as if it had.
 */
export function holdsCarried(e: ChordEventLike, carried: CarriedModifiers): boolean {
  return (
    (!carried.ctrl || e.ctrlKey) &&
    (!carried.alt || e.altKey) &&
    (!carried.shift || e.shiftKey) &&
    (!carried.meta || (e.metaKey ?? false))
  );
}

/**
 * The second stroke as it reads with every carried modifier cleared (046 FR-123).
 *
 * Superseded for MATCHING by FR-124 (supersession S29): the editor's two-stroke engine matches the
 * second stroke exactly as pressed, and no longer calls this. Kept for the capture modal's own use
 * until that moves to the comma form (T207).
 * Copies the fields by name — a DOM event's `code`/`key` are prototype getters a spread would lose.
 */
export function withoutCarried(e: ChordEventLike, carried: CarriedModifiers): ChordEventLike {
  const getModifierState = e.getModifierState;
  // A carried Shift cleared from a letter leaves the letter it types unshifted, which is what a
  // bare-key second stroke is matched on (`w`, never `W`).
  const unshift = carried.shift && e.shiftKey && /^[A-Z]$/.test(e.key);
  return {
    code: e.code,
    key: unshift ? e.key.toLowerCase() : e.key,
    ctrlKey: e.ctrlKey && !carried.ctrl,
    altKey: e.altKey && !carried.alt,
    shiftKey: e.shiftKey && !carried.shift,
    metaKey: (e.metaKey ?? false) && !carried.meta,
    ...(getModifierState ? { getModifierState: (k: 'NumLock') => getModifierState.call(e, k) } : {}),
  };
}

/** The event shape the resolvers (`resolveAction`, `resolveScoped`, `eventToToken`) take. */
export interface ResolverEvent {
  key: string;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
}

/**
 * Resolve a keydown the FR-026/FR-104 way, for EVERY renderer site that turns a key into a command.
 *
 * The PHYSICAL candidate — the tier-1 key, the Ctrl+Alt same-binding key, or the physical digit, in
 * that priority — is tried first; only when none applies does the `produced` fallback get a turn.
 * `produced` defaults to the event exactly as it reported itself (Shift included, unconditionally),
 * which is what lets a caller (the window listener) hand this a differently-built event for its own
 * case without changing what every other site gets by default.
 *
 * Fix round IMPORTANT (review of T111): this used to try EVERY entry {@link chordCandidates} returns,
 * including rule 3's own produced token — built with Shift DROPPED for any key that is not the
 * physical backtick, an F-key, a letter or an arrow (`Delete`, `Home`, `End`, `Enter`, `Escape` are
 * none of those). That let `Shift+Delete` resolve as plain `Delete` (`file.delete` in the explorer),
 * `Ctrl+Shift+Home`/`End` reserve as `terminal.scrollToTop`/`Bottom` instead of reaching the shell,
 * `Ctrl+Shift+Enter` fire `preview.followLink`, and `Shift+Escape` close the find bar — all BEFORE
 * the Shift-preserving `produced` fallback ever got a turn. Only the physical candidates take
 * priority now; rule 3's own token is reached only through the window listener's own override
 * ({@link windowProducedEvent}, which explicitly wants its Shift-dropping behaviour), never through
 * this loop.
 *
 * An OS-owned Meta combo declines outright (FR-104): no physical candidate is tried, and the
 * fallback is skipped too, so a produced character built while Meta is held cannot coincidentally
 * match a binding meant for the unmodified chord.
 *
 * Why every site, not just the window listener: the capture modal records the physical key for any
 * command (`Ctrl+Shift+1`, never the `Ctrl+Shift+!` a US layout produces; `Ctrl+Shift+Alt+M`, never
 * whatever a non-US layout's `M` position happens to produce), so a resolver that matched only the
 * produced character could never reach a chord the user had just recorded.
 * `renderer-chord-resolvers.test.ts` discovers the call sites and holds them all to this.
 */
export function resolveKeydown<T>(
  event: ChordEventLike,
  resolve: (ev: ResolverEvent) => T | null | undefined,
  produced?: ResolverEvent,
): T | null {
  if (event.metaKey) return null;
  const e = withKeypadShift(event);
  produced ??= { key: e.key, ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey };
  const physical = samePhysicalCandidate(e) ?? digitCandidate(e);
  if (physical !== undefined) {
    const hit = resolve(candidateEvent(physical));
    if (hit !== null && hit !== undefined) return hit;
  }
  return resolve(produced) ?? null;
}

/** The window listener's produced token (the last of {@link chordCandidates}), as a resolver event. */
export function windowProducedEvent(e: ChordEventLike): ResolverEvent {
  const tokens = chordCandidates(e);
  const last = tokens[tokens.length - 1];
  return last !== undefined ? candidateEvent(last) : { key: '', ctrl: false, alt: false, shift: false };
}

/**
 * A candidate token from {@link chordCandidates}, split back into the event shape the resolver
 * takes. The key is whatever follows the modifiers, so `Ctrl++` gives `+` and `Ctrl+ ` gives the
 * spacebar's `' '` (which `eventToToken` canonicalises to `Space`).
 */
export function candidateEvent(token: string): { key: string; ctrl: boolean; alt: boolean; shift: boolean } {
  const ev = { key: token, ctrl: false, alt: false, shift: false };
  for (;;) {
    const mod = /^(Ctrl|Shift|Alt)\+(?=.)/.exec(ev.key);
    if (!mod) return ev;
    if (mod[1] === 'Ctrl') ev.ctrl = true;
    else if (mod[1] === 'Shift') ev.shift = true;
    else ev.alt = true;
    ev.key = ev.key.slice(mod[0].length);
  }
}
