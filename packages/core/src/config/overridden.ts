/**
 * The overridden-test (015, FR-004a/FR-004b) — is this item still what the app
 * shipped, or has the user changed it?
 *
 * This is what decides whether a row shows its reset affordance, and the affordance IS the
 * row's "modified" cue, so the predicate has to mean exactly what the user would mean:
 *
 *   - A key binding is a SET of chords, not a sequence: an action fires on any of its chords,
 *     so reordering them (or recasing them) changes nothing the user can observe. An ordered,
 *     case-sensitive comparison would leave a JSON-mode reorder marked "modified" forever,
 *     offering a reset that visibly does nothing.
 *   - An action that ships UNBOUND has an EMPTY shipped chord set — a shipped value like any
 *     other. Binding it is an override; resetting it clears the binding back to unbound.
 *
 * An entry with no shipped counterpart is not resettable, so it is never reported as
 * overridden — there is nothing to return it to. That includes keys inherited from
 * `Object.prototype` (`__proto__`, `constructor`, …): plain bracket access resolves them, so
 * every lookup here walks OWN properties only.
 */
import type { AppSettings } from './app-settings.js';
import type { Keybindings } from './keybindings.js';
import { buildShippedDefaults, ownAtPath, type ShippedDefaults } from './shipped-defaults.js';

/** Order- and case-insensitive identity of a chord set. */
function chordSetKey(chords: readonly string[]): string {
  return JSON.stringify([...new Set(chords.map((c) => c.trim().toLowerCase()))].sort());
}

/** Structural equality that does not depend on key order (JSON.stringify does). */
function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, i) => deepEqual(item, b[i]));
  }
  const ka = Object.keys(a as Record<string, unknown>);
  const kb = Object.keys(b as Record<string, unknown>);
  if (ka.length !== kb.length) return false;
  return ka.every(
    (k) =>
      Object.prototype.hasOwnProperty.call(b, k) &&
      deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
  );
}

/**
 * True iff the setting leaf at `path` differs from its shipped value. A path with no shipped
 * counterpart is not resettable and is therefore never "overridden".
 */
export function isSettingOverridden(
  current: AppSettings,
  path: string,
  d: ShippedDefaults = buildShippedDefaults(),
): boolean {
  const shipped = ownAtPath(d.settings, path);
  if (shipped === undefined) return false;
  return !deepEqual(ownAtPath(current, path), shipped);
}

/**
 * True iff `action`'s chord SET differs from its shipped chord set (order and capitalisation
 * are irrelevant). An action absent from the shipped record is not resettable and is therefore
 * never "overridden".
 */
export function isBindingOverridden(
  current: Keybindings,
  action: string,
  d: ShippedDefaults = buildShippedDefaults(),
): boolean {
  if (!Object.prototype.hasOwnProperty.call(d.keybindings.bindings, action)) return false;
  const shipped = d.keybindings.bindings[action] ?? [];
  const mine = Object.prototype.hasOwnProperty.call(current.bindings, action)
    ? (current.bindings[action] ?? [])
    : [];
  return chordSetKey(mine) !== chordSetKey(shipped);
}

/*
 * The differs-from-entry test (015, FR-016) — the predicate behind the per-item REVERT
 * affordance.
 *
 * Same shape as the overridden-test above, and deliberately so: same leaf addressing, same
 * order-and-case-insensitive chord sets. Only the thing being compared against changes — the
 * document the preferences window was opened with, rather than the record the app shipped.
 *
 * That difference is the entire reason both exist. Reset asks "what does Throng ship?"; revert
 * asks "what did I start this session with?". For a user who arrives with an item ALREADY
 * overridden, those are different values, and collapsing them would silently throw away the
 * override they came in with.
 */

/** True iff the setting leaf at `path` differs from the value it held when the window opened. */
export function settingDiffersFromEntry(
  current: AppSettings,
  entry: AppSettings,
  path: string,
): boolean {
  return !deepEqual(ownAtPath(current, path), ownAtPath(entry, path));
}

/**
 * True iff `action`'s chord SET differs from the set it held when the window opened. An action
 * that was unbound on entry has an empty on-entry set — binding it is a change like any other.
 */
export function bindingDiffersFromEntry(
  current: Keybindings,
  entry: Keybindings,
  action: string,
): boolean {
  return chordSetKey(ownChords(current, action)) !== chordSetKey(ownChords(entry, action));
}

/** An action's chords by OWN property only — never `__proto__`, `constructor`, … */
function ownChords(k: Keybindings, action: string): readonly string[] {
  return Object.prototype.hasOwnProperty.call(k.bindings, action)
    ? (k.bindings[action] ?? [])
    : [];
}
