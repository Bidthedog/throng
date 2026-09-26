/**
 * Key-binding chord capture (feature 007, FR-032/032a/033/033a/034). Pure logic
 * behind the capture modal: build a canonical token from a key event, validate it
 * (modifier + key minimum; OS-reserved denylist), detect conflicts, and produce
 * replace/reassign write plans. Builds on `keybindings.ts` `normalizeToken`; the
 * modal writes the resulting `keybindings.json` via `config.write`. No OS/DOM.
 */
import {
  COMMAND_SCOPES,
  formatChord,
  normalizeToken,
  sameBindingToken,
  scopesIntersect,
  splitStrokes,
  type ActionId,
  type CommandScopes,
} from './keybindings.js';

/** A captured key event (the modal supplies these from a DOM KeyboardEvent). */
export interface CaptureEvent {
  key: string;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  meta: boolean;
  /**
   * The physical key (`KeyboardEvent.code`), when the caller has one (046 iterate round 1, T108,
   * FR-104/FR-105). Optional so an existing caller that supplies only `key` keeps building the
   * produced-character token it always has — see the last case below.
   */
  code?: string;
  /**
   * `getModifierState('NumLock')`, when the caller can read it (046 FR-120). Absent → the event's
   * own `shift` stands, exactly as before FR-120.
   */
  numLock?: boolean;
}

/** Each keypad digit key's navigation `key` — what it reports with NumLock off, or on with Shift. */
const KEYPAD_NAV_KEY_OF_CODE: Readonly<Record<string, string>> = {
  Numpad0: 'Insert',
  Numpad1: 'End',
  Numpad2: 'ArrowDown',
  Numpad3: 'PageDown',
  Numpad4: 'ArrowLeft',
  Numpad5: 'Clear',
  Numpad6: 'ArrowRight',
  Numpad7: 'Home',
  Numpad8: 'ArrowUp',
  Numpad9: 'PageUp',
  NumpadDecimal: 'Delete',
};

/**
 * Whether Windows hid a held Shift from this keypad press (046 FR-120). With NumLock ON, Shift held
 * on a keypad digit key inverts it to its navigation key and Windows synthesises a Shift key-up
 * first, so the keydown reports `shiftKey` false (measured, research R22 "T149 follow-up"). Without
 * Shift the same key reports its digit, so a navigation `key` with NumLock on can only mean Shift
 * was held. `numLock` undefined (no state readable) → `false`, the pre-FR-120 behaviour.
 *
 * Exported so `packages/ui/src/renderer/config/chord-key.ts` reuses this rule rather than
 * re-deriving it.
 */
export function keypadHidesShift(code: string, key: string, shift: boolean, numLock: boolean | undefined): boolean {
  return numLock === true && !shift && KEYPAD_NAV_KEY_OF_CODE[code] === key;
}

/** DOM `key` values that are themselves modifiers — never the chord's key. */
const MODIFIER_KEY_NAMES = new Set([
  'Control',
  'Shift',
  'Alt',
  'Meta',
  'OS',
  'CapsLock',
  'ContextMenu',
  'Dead',
]);

const MODS = ['Ctrl', 'Shift', 'Alt', 'Meta'] as const;

/**
 * The `+`/`-`/`Numpad0` SAME-BINDING symbol for `code` (046 FR-105), guarded against an AltGr false
 * positive (review finding CRITICAL on 34d06dac): on Windows, AltGr is reported by Chromium as
 * Ctrl+Alt together (R22), so an unguarded code match would swallow a German AltGr+ß (physical
 * `Minus`, produces `\`), an AZERTY AltGr+= (produces `}`), and similar combinations that type
 * something else entirely, folding them onto `Ctrl+Alt++`/`Ctrl+Alt+-` as though the plain key had
 * been pressed with real Ctrl+Alt.
 *
 * The keypad codes (`NumpadAdd`, `NumpadSubtract`, `Numpad0`) are always safe — there is no AltGr on
 * the numeric keypad. `Equal` and `Minus` are matched when `key` is genuinely one of the symbols the
 * key types WITHOUT AltGr — its plain production, or its Shift-held one (`=`/`+`, `-`/`_` on a US
 * keyboard), which is FR-105's own wording for the exception: "the produced =". The Shift-held form
 * matters because `tier1PhysicalKey` reuses this same guard for the Ctrl+SHIFT+Alt tier, where Shift
 * is unconditionally held and a US keyboard's Minus key genuinely produces `_`, not `-` — a version
 * of this guard that only accepted `-` would read that as an AltGr mismatch and lose the physical
 * match tier-1 exists to provide (fix round finding, T111/T113).
 *
 * `Digit0` is deliberately NOT covered here (main-row `0`): AltGr+0 reports as Ctrl+Alt on
 * German/AZERTY and must still record its own produced symbol (`}`, `@`), the same exclusion R2/
 * FR-026 already made for the digit row — and, as of 046 iterate round 2 (FR-114, the maintainer's
 * own words, "the numpad zero, NOT the 0 key"), `Digit0` no longer resolves `zoom.reset` or
 * `panel.zoomReset` at all, so there is nothing left for it to alias onto here.
 *
 * `Numpad0` returns its OWN symbol, `'Numpad0'`, UNCONDITIONALLY — not folded onto `'0'` — matched on
 * `code` alone, regardless of what `key` a NumLock-on/off keypad happens to report (`'0'`, or the
 * Shift+NumLock quirk `'Insert'`). Before round 2 this case matched only when `key === '0'`, so a
 * NumLock-off press (which reports its navigation name, e.g. `Insert`) never folded to the `0`
 * binding at all; that guard existed only because the target WAS `0`. Now that `zoom.reset` and
 * `panel.zoomReset` ship `Numpad0` as their OWN literal token (FR-114), there is nothing left to
 * guard against a false positive on — every physical Numpad0 press, with or without NumLock, is
 * genuinely a Numpad0 press, and `code` already says so.
 *
 * Exported so `packages/ui/src/renderer/config/chord-key.ts`'s own copy of this rule (rule 1b) can
 * share the same guard rather than re-deriving it.
 */
export function sameBindingSymbolOfCode(code: string, key: string): string | undefined {
  switch (code) {
    case 'NumpadAdd':
      return '+';
    case 'NumpadSubtract':
      return '-';
    case 'Equal':
      return key === '=' || key === '+' ? '+' : undefined;
    case 'Minus':
      return key === '-' || key === '_' ? '-' : undefined;
    case 'Numpad0':
      return 'Numpad0';
    default:
      return undefined;
  }
}

/**
 * The tier-1 physical key NAME for `code` (046 FR-104): a letter, a digit, the same-binding `+`/`-`
 * or the literal `Numpad0` (guarded by {@link sameBindingSymbolOfCode}; `Numpad0` is FR-114's named
 * exception to the "no shipped `Numpad…` token" rule, for `zoom.reset` alone at this tier), the
 * backtick (aliased from `Backquote`, as `chordKey` already does for the single-stroke path), a
 * NumLock-off keypad key's own produced name for every OTHER keypad key (never its `Numpad…` code —
 * FR-105 still forbids that token for anything but `Numpad0`), or the code itself for any other
 * named key (`ArrowLeft`, `PageDown`, …), which already names it.
 *
 * Exported so `packages/ui/src/renderer/config/chord-key.ts`'s tier-1 rule reuses this exact
 * function rather than keeping a second copy that can drift (fix round review, MINOR).
 */
export function tier1PhysicalKey(code: string, key: string): string {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (code === 'Backquote') return '`';
  const sameBinding = sameBindingSymbolOfCode(code, key);
  if (sameBinding) return sameBinding;
  if (code.startsWith('Numpad')) return key;
  return code;
}

/**
 * Build the canonical chord token for a capture event:
 * `Ctrl+Shift+Alt+Meta+<key>` (only the pressed parts). A held modifier key is
 * never appended as the key, so a lone modifier yields just the modifier name
 * (not bindable). Consistent with `eventToToken` for the Ctrl/Shift/Alt/key part,
 * plus Meta, so a saved chord resolves at runtime.
 *
 * 046 iterate round 1 (T108/T112, FR-104, FR-105) — when `ev.code` is given, two PHYSICAL forms take
 * priority over the produced character, mirroring `chordCandidates` in
 * `packages/ui/src/renderer/config/chord-key.ts` (the renderer's own copy, for the window listener
 * and every other resolver — this is core's, for a caller with no renderer to reach):
 *
 *  1. Ctrl+Shift+Alt (not Meta): the whole tier-1 navigation/application family, matched on `code` —
 *     so a non-US layout's produced character (a comma on AZERTY's `M`, `Ń` on Polish AltGr+Shift+N)
 *     never gets captured in its place.
 *  2. Ctrl+Alt without Shift: the `+`/`-` same-binding rule, so the keypad and the unshifted `=`/`-`
 *     keys record the SAME token `panel.zoomIn`/`panel.zoomOut` ship — plus, as of 046 iterate round
 *     2 (FR-114), the keypad `Numpad0` recording its OWN literal token, `panel.zoomReset`'s shipped
 *     key, never folded onto the main-row `0`.
 *
 * Without a `code` (an existing caller that never sends one), the produced-character form below
 * stands exactly as it always has — backward compatible by construction.
 *
 * 046 FR-120: a keypad press whose Shift Windows hid under NumLock ({@link keypadHidesShift}) is read
 * as Shift held before either form is tried, so it records the chord the user pressed.
 */
export function captureToken(event: CaptureEvent): string {
  const ev =
    event.code !== undefined && keypadHidesShift(event.code, event.key, event.shift, event.numLock)
      ? { ...event, shift: true }
      : event;
  if (ev.ctrl && ev.shift && ev.alt && !ev.meta && ev.code) {
    return normalizeToken(`Ctrl+Shift+Alt+${tier1PhysicalKey(ev.code, ev.key)}`);
  }
  if (ev.ctrl && ev.alt && !ev.shift && ev.code) {
    const symbol = sameBindingSymbolOfCode(ev.code, ev.key);
    if (symbol) return normalizeToken(`Ctrl+Alt+${symbol}`);
  }
  const parts: string[] = [];
  if (ev.ctrl) parts.push('Ctrl');
  if (ev.shift) parts.push('Shift');
  if (ev.alt) parts.push('Alt');
  if (ev.meta) parts.push('Meta');
  if (ev.key && !MODIFIER_KEY_NAMES.has(ev.key)) {
    // Canonicalise the spacebar (' ' → 'Space') so a reserved combo like Alt+Space
    // matches the denylist, and to stay consistent with eventToToken (FR-032a).
    parts.push(ev.key === ' ' ? 'Space' : ev.key);
  }
  return normalizeToken(parts.join('+'));
}

/** Split a canonical token into its modifiers and its (possibly empty) key. */
function splitChord(token: string): { mods: string[]; key: string } {
  let rest = token;
  const mods: string[] = [];
  for (const m of MODS) {
    if (rest === m) {
      mods.push(m);
      rest = '';
    } else if (rest.startsWith(`${m}+`)) {
      mods.push(m);
      rest = rest.slice(m.length + 1);
    }
  }
  return { mods, key: rest };
}

/**
 * Keys that MUST NOT be bound **alone** (FR-033a): OS/system keys and modifiers.
 * They remain usable as part of a modifier combination (e.g. `Ctrl+Space`). Space
 * is stored canonically as `'Space'` (captureToken maps the DOM `' '`).
 */
export const EXCLUDED_KEYS: ReadonlySet<string> = new Set([
  'Escape',
  'Space',
  'Shift',
  'Control',
  'Enter',
  'CapsLock',
  'NumLock',
]);
// `Tab` and `Shift+Tab` left this set in 016 (F1). They are the universal indent/outdent chords
// and the spec makes them `editor.indentLines`/`editor.outdentLines`' defaults — impossible while
// the capture modal rejected them, which would also have made two of the seven commands
// unrebindable. The constraint existed to protect focus traversal, and FR-017f's focus scoping
// now preserves that directly: while a transient input surface (013's find bar above all) holds
// focus, Tab moves within it and never reaches the document.

/**
 * A bindable chord has a non-modifier key (FR-033a — reversed: a single key is now
 * allowed, no modifier minimum). Rejected: a lone modifier (no key), and — when the
 * key is bound ALONE (no modifier) — the excluded OS/system keys. Reserved OS combos
 * are handled separately by {@link isReservedChord}.
 */
export function isBindableChord(token: string): boolean {
  const { mods, key } = splitChord(token);
  if (key.length === 0 || (MODS as readonly string[]).includes(key)) return false; // lone modifier
  if (mods.length === 0 && EXCLUDED_KEYS.has(key)) return false; // excluded single key
  return true;
}

/**
 * OS / window-control combinations the application cannot reliably bind, so they
 * must never be saved as a dead chord (FR-032a). A curated, extensible denylist
 * plus the rule that any chord whose only modifier is Meta/Super is OS-owned.
 */
export const RESERVED_CHORDS: ReadonlySet<string> = new Set([
  'Ctrl+Alt+Delete',
  'Ctrl+Shift+Escape',
  'Alt+F4',
  'Alt+Tab',
  'Alt+Escape',
  'Alt+Space',
]);

export function isReservedChord(token: string): boolean {
  if (RESERVED_CHORDS.has(token)) return true;
  const { mods, key } = splitChord(token);
  // The Windows/Super key is OS-owned: any chord whose only modifier is Meta.
  return key.length > 0 && mods.length > 0 && mods.every((m) => m === 'Meta');
}

/**
 * Whether `token` (assumed single-stroke — a two-stroke token never matches) is the FIRST STROKE
 * of one of `action`'s existing bindings, folded through {@link sameBindingToken} the same way
 * `chordCollisions` (keybindings.ts) folds a two-stroke's first stroke before comparing it (046,
 * FR-092 / FR-105, branch-review fix round). Exported so the capture modal can tell a genuine
 * duplicate-chord collision (own the WHOLE other chord, Reassign is safe) from this one (the other
 * action's real binding is the two-stroke, not the bare stroke — Reassign would search for an exact
 * match, find nothing to remove, and silently leave both readings live).
 */
export function isPrefixOfChord(
  bindings: Record<string, string[]>,
  action: ActionId,
  token: string,
): boolean {
  // 046 FR-126: any PROPER prefix — `Ctrl+E` of `Ctrl+E,W`, or `Ctrl+E,W` of `Ctrl+E,W,Q`.
  const mine = splitStrokes(sameBindingToken(normalizeToken(token)));
  if (!mine) return false;
  return (bindings[action] ?? []).some((t) => {
    const strokes = splitStrokes(sameBindingToken(normalizeToken(t)));
    return !!strokes && strokes.length > mine.length && mine.every((s, i) => strokes[i] === s);
  });
}

/**
 * The other action already bound to `token` **in a context where both are live**, or null
 * (016, FR-017b1).
 *
 * Scope-aware: a chord shared by two commands whose scopes are DISJOINT is not a conflict —
 * `editor.cutLine` ({editor}) and `file.cut` ({explorer}) legitimately both answer to `Ctrl+X`,
 * and warning about it would train the user to dismiss the warning that matters. A real clash —
 * scopes that intersect — still raises the warn → Reassign/Cancel flow (007 FR-034), and is never
 * silently taken by the last writer.
 *
 * The action being edited is excluded, so re-capturing its own chord is not a conflict.
 *
 * `checkPrefixOfOthers` (046, FR-092, branch-review fix round) additionally catches the case an
 * exact-token comparison misses: `token` is a plain single-stroke capture that equals the FIRST
 * STROKE of some OTHER action's two-stroke chord — e.g. capturing `Ctrl+E` while
 * `editor.toggleWordWrap` ships `Ctrl+E W`. Binding it would leave `Ctrl+E` genuinely ambiguous
 * between firing the new command and starting the other's pending prefix, the same ambiguity
 * `chordCollisions` already refuses in a SAVED bindings map (its own first-stroke rule), reused
 * here for a token not yet saved. Defaults to `true` for `evaluate`'s completed-capture call;
 * `armFirstStroke` (capture-modal.tsx) passes `false`, because ITS candidate is only the first
 * stroke of a NEW two-stroke-in-progress — two different two-stroke bindings merely sharing a
 * first stroke is legitimate (FR-092), not a collision, and this direction must not flag it.
 */
export function findConflict(
  bindings: Record<string, string[]>,
  token: string,
  exceptAction: ActionId,
  scopes: CommandScopes = COMMAND_SCOPES,
  checkPrefixOfOthers = true,
): ActionId | null {
  const norm = normalizeToken(token);
  const mine = scopes[exceptAction];
  for (const [action, tokens] of Object.entries(bindings)) {
    if (action === exceptAction) continue;
    if (!tokens.some((t) => normalizeToken(t) === norm)) continue;
    if (scopesIntersect(mine, scopes[action as ActionId])) return action as ActionId;
  }
  if (checkPrefixOfOthers) {
    for (const action of Object.keys(bindings)) {
      if (action === exceptAction) continue;
      if (!isPrefixOfChord(bindings, action as ActionId, token)) continue;
      if (scopesIntersect(mine, scopes[action as ActionId])) return action as ActionId;
    }
  }
  return null;
}

function cloneBindings(b: Record<string, string[]>): Record<string, string[]> {
  return Object.fromEntries(Object.entries(b).map(([k, v]) => [k, [...v]]));
}

/** Replace an action's chord(s) with exactly the captured token (JSON/programmatic use). */
export function applyReplace(
  bindings: Record<string, string[]>,
  action: ActionId,
  token: string,
): Record<string, string[]> {
  const next = cloneBindings(bindings);
  next[action] = [token];
  return next;
}

/**
 * Add a chord to an action's list (FR-033 — capture is additive, multiple chords
 * per action). A no-op if the action already has an equivalent chord (dedup,
 * case-insensitive).
 */
export function applyAdd(
  bindings: Record<string, string[]>,
  action: ActionId,
  token: string,
): Record<string, string[]> {
  const next = cloneBindings(bindings);
  const existing = next[action] ?? [];
  const norm = normalizeToken(token);
  if (!existing.some((t) => normalizeToken(t) === norm)) {
    next[action] = [...existing, token];
  } else {
    next[action] = existing;
  }
  return next;
}

/** Remove a single chord from an action's list (FR-033b). */
export function applyRemove(
  bindings: Record<string, string[]>,
  action: ActionId,
  token: string,
): Record<string, string[]> {
  const next = cloneBindings(bindings);
  const norm = normalizeToken(token);
  next[action] = (next[action] ?? []).filter((t) => normalizeToken(t) !== norm);
  return next;
}

/**
 * The canonical token for a two-stroke capture (046, FR-091/FR-092; FR-124): the `Mods+K1,K2` form
 * {@link formatTwoStroke} (`keybindings.ts`) writes — `Ctrl+E,W` for Ctrl held through E then W,
 * `Ctrl+E,Shift+W` when Shift was added for the second key. Each event goes through
 * {@link captureToken} exactly as a single-stroke capture would, so the same modifier canon and
 * space-to-`Space` handling apply to either half. `null` when a first-stroke modifier was no
 * longer held for the second key: that is two presses, not one chord.
 */
export function captureTwoStrokeToken(first: CaptureEvent, second: CaptureEvent): string | null {
  return captureChordToken([first, second]);
}

/**
 * The canonical token for a capture of one to three keys under held modifiers (046 FR-124,
 * FR-126): {@link formatChord} over each event's {@link captureToken} — `Ctrl+E,W,Q` for Ctrl held
 * through E, W and Q. `null` when a first-stroke modifier was no longer held for a later key, or
 * for more than three keys.
 */
export function captureChordToken(events: readonly CaptureEvent[]): string | null {
  return formatChord(events.map(captureToken));
}

/** Remove the token from its previous owner, then bind it to `toAction` (FR-034). */
export function applyReassign(
  bindings: Record<string, string[]>,
  fromAction: ActionId,
  toAction: ActionId,
  token: string,
): Record<string, string[]> {
  const norm = normalizeToken(token);
  const next = cloneBindings(bindings);
  next[fromAction] = (next[fromAction] ?? []).filter((t) => normalizeToken(t) !== norm);
  // Additive: keep the target action's existing chords and append this one (FR-033/034).
  const existing = next[toAction] ?? [];
  next[toAction] = existing.some((t) => normalizeToken(t) === norm) ? existing : [...existing, token];
  return next;
}
