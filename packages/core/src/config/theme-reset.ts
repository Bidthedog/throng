/**
 * The **session undo** for the preferences editor (feature 007, FR-024) — restore every
 * editor to its state when the window opened. Pure: produces the write plan the renderer
 * applies via config.write. No OS/DOM.
 *
 * This is NOT a reset to shipped defaults, and must never be conflated with one. Feature
 * 015 retired the reset-to-defaults helpers that used to live here (`resetCurrentSettings`,
 * `resetCurrentKeybindings`, `resetCurrentTheme`, `isBuiltInTheme`): they resolved defaults
 * from the DEFAULT_* / ALL_DEFAULT_THEMES constants rather than feature 010's shipped
 * record, giving the app two competing answers to "what did this ship as" — and they had
 * already drifted apart. Defaults now come from `buildShippedDefaults()`, and only from
 * there (SC-009). The session undo below is untouched.
 */
import type { ConfigDocId } from '../abstractions/config-store.js';

/** The reset-all on-entry snapshot (FR-024). */
export interface OnEntrySnapshot {
  /** Raw settings document at window open. */
  settings: string;
  /** Raw keybindings document at window open. */
  keybindings: string;
  /** name → raw theme document, captured the first time the theme is active this session. */
  themes: Record<string, string>;
  /** appearance.theme at window open (re-activated by restoring `settings`). */
  activeTheme: string;
}

export interface WritePlanEntry {
  id: ConfigDocId;
  json: string;
}
export type WritePlan = WritePlanEntry[];

/**
 * Reset-all (FR-024): a session-scoped revert. Produces a write plan restoring the
 * settings + keybindings files and every theme file touched this session to their
 * on-entry contents. Restoring settings.json (which carries the on-entry
 * appearance.theme) re-activates the theme that was active on entry.
 */
export function revertAll(snapshot: OnEntrySnapshot): WritePlan {
  const plan: WritePlan = [
    { id: { kind: 'settings' }, json: snapshot.settings },
    { id: { kind: 'keybindings' }, json: snapshot.keybindings },
  ];
  for (const [name, json] of Object.entries(snapshot.themes)) {
    plan.push({ id: { kind: 'theme', name }, json });
  }
  return plan;
}
