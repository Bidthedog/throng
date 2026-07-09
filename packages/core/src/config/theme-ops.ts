/**
 * Theme operations (feature 007, FR-035/036a). Pure rules for the Themes tab:
 * validating/renaming theme names (reject a collision) and activating a theme
 * (select = activate → set `appearance.theme`). File I/O (the actual rename on
 * disk) is a UI-main concern; these are the decision rules it and the UI share.
 * No OS/DOM.
 */
import type { AppSettings } from './app-settings.js';

/** A theme name is a safe single path segment (no separators/reserved chars). */
export function isValidThemeName(name: string): boolean {
  const n = name.trim();
  if (n.length === 0 || n === '.' || n === '..') return false;
  return !/[<>:"/\\|?*]/.test(n);
}

export type ThemeRenameResult = { ok: true } | { ok: false; error: 'exists' | 'invalid' };

/**
 * Validate renaming `from` → `to` against the existing theme names. Rejects an
 * invalid name and a case-insensitive collision with a DIFFERENT theme (FR-036a);
 * renaming to the same name (incl. a case-only change of itself) is allowed.
 */
export function checkRename(existing: readonly string[], from: string, to: string): ThemeRenameResult {
  const target = to.trim();
  if (!isValidThemeName(target)) return { ok: false, error: 'invalid' };
  const collides = existing.some(
    (n) => n !== from && n.toLowerCase() === target.toLowerCase(),
  );
  return collides ? { ok: false, error: 'exists' } : { ok: true };
}

/** Select = activate (FR-035): return settings with the active theme set to `name`. */
export function activateTheme(settings: AppSettings, name: string): AppSettings {
  return { ...settings, appearance: { ...settings.appearance, theme: name } };
}
