/**
 * Theme operations (feature 007, FR-035/036a). Pure rules for the Themes tab:
 * validating/renaming theme names (reject a collision) and activating a theme
 * (select = activate → set `appearance.theme`). File I/O (the actual rename on
 * disk) is a UI-main concern; these are the decision rules it and the UI share.
 * No OS/DOM.
 */
import type { AppSettings } from './app-settings.js';
import type { Theme } from './theme.js';

/**
 * The colour tokens 021 removes: the menu/dialog surfaces, the four legacy button tokens, and — in the
 * follow-up pass — `activePaneHighlight`, consolidated onto `activePanelBorder` (one active-pane
 * highlight app-wide).
 */
const REMOVED_COLOUR_TOKENS = [
  'menuSurface',
  'dialogSurface',
  'buttonBg',
  'buttonText',
  'buttonHoverBg',
  'buttonHoverText',
  'activePaneHighlight',
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

  // The active-pane highlight consolidation (021 follow-up): the File Explorer's `activePaneHighlight`
  // folds onto `activePanelBorder`. Seed the survivor from it only if the survivor is unset (an author's
  // explicit panel-border value wins), then the key is dropped below with the other removed tokens.
  seed('activePanelBorder', src.activePaneHighlight);

  // Drop the removed keys AFTER deriving (derive-before-drop).
  for (const token of REMOVED_COLOUR_TOKENS) delete out[token];
  return out;
}

/** The default base weights a role's `bold` boolean used to resolve to (theme.ts `fonts.weights`). */
const DEFAULT_BOLD_WEIGHT = 600;
const DEFAULT_NORMAL_WEIGHT = 400;

/**
 * Migrate one theme's `typography` to the 021 follow-up model, idempotently and losslessly:
 *
 *  - a role's boolean `bold` becomes a numeric `weight` (the exact weight it used to resolve to, read
 *    from this theme's own `fonts.weights`), so nothing renders differently;
 *  - the retired `dialog` role is dropped (dialogs now inherit the base font);
 *  - the editor sheds casing/italic/underline/strikethrough (source text is not prose).
 *
 * A role already carrying an explicit `weight` is left untouched (a re-run is a no-op).
 */
export function migrateThemeTypography(
  typography: Record<string, Record<string, unknown>> | undefined,
  fonts: { weights?: { normal?: number; bold?: number } } | undefined,
): Record<string, Record<string, unknown>> | undefined {
  if (typography === undefined || typography === null) return typography;
  const boldWeight = fonts?.weights?.bold ?? DEFAULT_BOLD_WEIGHT;
  const normalWeight = fonts?.weights?.normal ?? DEFAULT_NORMAL_WEIGHT;

  const out: Record<string, Record<string, unknown>> = {};
  for (const [role, spec] of Object.entries(typography)) {
    if (role === 'dialog') continue; // retired
    const next: Record<string, unknown> = { ...(spec ?? {}) };
    if (typeof next.bold === 'boolean' && next.weight === undefined) {
      next.weight = next.bold ? boldWeight : normalWeight;
    }
    delete next.bold;
    if (role === 'editor') {
      delete next.case;
      delete next.italic;
      delete next.underline;
      delete next.strikethrough;
    }
    out[role] = next;
  }
  return out;
}

/**
 * Migrate a whole theme document read from disk to the 021 model (FR-031/032). Pure, idempotent,
 * lossless. Applied on the theme LOAD path so any user theme authored before 021 gains the typed
 * button tokens and sheds the removed surfaces before it is used.
 */
export function migrateTheme(raw: Theme): Theme {
  const colours = (raw.colours ?? {}) as Record<string, string>;
  const typography = migrateThemeTypography(
    raw.typography as Record<string, Record<string, unknown>> | undefined,
    raw.fonts,
  );
  const next: Theme = { ...raw, colours: migrateThemeColours(colours) };
  if (typography === undefined) delete (next as { typography?: unknown }).typography;
  else next.typography = typography as Theme['typography'];
  return next;
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
