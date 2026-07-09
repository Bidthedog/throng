/**
 * Reset / revert logic for the preferences editor (feature 007, FR-023/024).
 * Pure: produces the values (reset-current) or the write plan (reset-all) the
 * renderer applies via config.write. No OS/DOM.
 */
import { DEFAULT_APP_SETTINGS, type AppSettings } from './app-settings.js';
import { DEFAULT_KEYBINDINGS, type Keybindings } from './keybindings.js';
import { ALL_DEFAULT_THEMES } from './default-themes/index.js';
import type { Theme } from './theme.js';
import type { ConfigDocId } from '../abstractions/config-store.js';

/** Reset the Settings document to throng's defaults (FR-023). */
export function resetCurrentSettings(): AppSettings {
  return DEFAULT_APP_SETTINGS;
}

/** Reset the Key Bindings document to throng's defaults (FR-023). */
export function resetCurrentKeybindings(): Keybindings {
  return DEFAULT_KEYBINDINGS;
}

/**
 * Reset the selected theme (FR-023). Enabled only for a built-in (bundled) theme
 * — returns its installed default. A user-created theme returns null (the reset
 * control is disabled).
 */
export function resetCurrentTheme(
  name: string,
  defaults: Record<string, Theme> = ALL_DEFAULT_THEMES,
): Theme | null {
  return defaults[name] ?? null;
}

/** Whether the reset-current control is enabled for a theme (built-ins only). */
export function isBuiltInTheme(name: string, defaults: Record<string, Theme> = ALL_DEFAULT_THEMES): boolean {
  return name in defaults;
}

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
