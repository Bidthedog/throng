/**
 * Theme operations (feature 007, FR-035/036a). Pure rules for the Themes tab:
 * validating/renaming theme names (reject a collision) and activating a theme
 * (select = activate → set `appearance.theme`). File I/O (the actual rename on
 * disk) is a UI-main concern; these are the decision rules it and the UI share.
 * No OS/DOM.
 */
import type { AppSettings } from './app-settings.js';
import type { Theme } from './theme.js';

/** The six colour tokens 021 removes (menu/dialog surfaces + the four legacy button tokens). */
const REMOVED_COLOUR_TOKENS = [
  'menuSurface',
  'dialogSurface',
  'buttonBg',
  'buttonText',
  'buttonHoverBg',
  'buttonHoverText',
] as const;

/** True for a genuinely-set colour value — a non-blank string (an empty/whitespace value means "unset"). */
function isSetColour(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

/** First set value of the two — used for Cancel's legacy-token-with-fallback derivation. */
function pick(primary: unknown, fallback: unknown): string | undefined {
  if (isSetColour(primary)) return primary;
  if (isSetColour(fallback)) return fallback;
  return undefined;
}

/**
 * Migrate one theme's `colours` to the 021 token model (FR-031/032), **idempotently** and
 * **losslessly** for surviving tokens. Order matters (data-model §6, F1): snapshot the ORIGINAL
 * colours first, derive every typed button token FROM THAT SNAPSHOT, and only THEN drop the removed
 * keys — so Cancel captures the legacy `button*` values rather than their fallbacks. A token already
 * present is never overwritten (an author's explicit value wins, and a re-run is a no-op).
 */
export function migrateThemeColours(colours: Record<string, string>): Record<string, string> {
  const src = { ...colours };
  const out: Record<string, string> = { ...colours };

  const seed = (token: string, value: string | undefined): void => {
    if (!isSetColour(out[token]) && isSetColour(value)) out[token] = value;
  };

  // Confirm ← accent / accentText.
  seed('confirmButtonBg', src.accent);
  seed('confirmButtonHoverBg', src.accent);
  seed('confirmButtonBorder', src.accent);
  seed('confirmButtonHoverBorder', src.accent);
  seed('confirmButtonText', src.accentText);
  seed('confirmButtonHoverText', src.accentText);
  // Destroy ← danger / dangerText.
  seed('destroyButtonBg', src.danger);
  seed('destroyButtonHoverBg', src.danger);
  seed('destroyButtonBorder', src.danger);
  seed('destroyButtonHoverBorder', src.danger);
  seed('destroyButtonText', src.dangerText);
  seed('destroyButtonHoverText', src.dangerText);
  // Cancel ← the legacy button surface/text (fallbacks: surface / surfaceActive / text) + the border.
  seed('cancelButtonBg', pick(src.buttonBg, src.surface));
  seed('cancelButtonHoverBg', pick(src.buttonHoverBg, src.surfaceActive));
  seed('cancelButtonText', pick(src.buttonText, src.text));
  seed('cancelButtonHoverText', pick(src.buttonHoverText, src.text));
  seed('cancelButtonBorder', src.border);
  seed('cancelButtonHoverBorder', src.border);

  // Drop the removed keys AFTER deriving (derive-before-drop).
  for (const token of REMOVED_COLOUR_TOKENS) delete out[token];
  return out;
}

/**
 * Migrate a whole theme document read from disk to the 021 model (FR-031/032). Pure, idempotent,
 * lossless. Applied on the theme LOAD path so any user theme authored before 021 gains the typed
 * button tokens and sheds the removed surfaces before it is used.
 */
export function migrateTheme(raw: Theme): Theme {
  const colours = (raw.colours ?? {}) as Record<string, string>;
  return { ...raw, colours: migrateThemeColours(colours) };
}

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
