/**
 * Key-binding chord capture (feature 007, FR-032/032a/033/033a/034). Pure logic
 * behind the capture modal: build a canonical token from a key event, validate it
 * (modifier + key minimum; OS-reserved denylist), detect conflicts, and produce
 * replace/reassign write plans. Builds on `keybindings.ts` `normalizeToken`; the
 * modal writes the resulting `keybindings.json` via `config.write`. No OS/DOM.
 */
import { normalizeToken, type ActionId } from './keybindings.js';

/** A captured key event (the modal supplies these from a DOM KeyboardEvent). */
export interface CaptureEvent {
  key: string;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  meta: boolean;
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
 * Build the canonical chord token for a capture event:
 * `Ctrl+Shift+Alt+Meta+<key>` (only the pressed parts). A held modifier key is
 * never appended as the key, so a lone modifier yields just the modifier name
 * (not bindable). Consistent with `eventToToken` for the Ctrl/Shift/Alt/key part,
 * plus Meta, so a saved chord resolves at runtime.
 */
export function captureToken(ev: CaptureEvent): string {
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
  'Tab',
  'NumLock',
]);

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
 * The other action already bound to `token` (case-insensitive), or null. The
 * action being edited is excluded so re-capturing its own chord is not a conflict.
 */
export function findConflict(
  bindings: Record<string, string[]>,
  token: string,
  exceptAction: ActionId,
): ActionId | null {
  const norm = normalizeToken(token);
  for (const [action, tokens] of Object.entries(bindings)) {
    if (action === exceptAction) continue;
    if (tokens.some((t) => normalizeToken(t) === norm)) return action as ActionId;
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
