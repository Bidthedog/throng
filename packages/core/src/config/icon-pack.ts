/**
 * Icon packs (feature 007, FR-039/040). An icon pack maps icon tokens to a glyph
 * OR a relative image filename (SVG/PNG); a pack may mix both. Pure model +
 * tolerant manifest parse + the per-token resolution fallback chain. Discovery and
 * asset-path resolution are UI-main concerns (the renderer never touches `fs`).
 * No OS/DOM here.
 */
import { THRONG_THEME, type IconValue, type Theme } from './theme.js';

export interface IconPackManifest {
  name: string;
  tokens: Record<string, IconValue>;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** A token string that names an image asset (vs a glyph) is one ending .svg/.png. */
function isImageFilename(value: string): boolean {
  return /\.(svg|png)$/i.test(value);
}

/**
 * A pack image must be a safe file inside the pack folder — no path separators,
 * parent refs, or drive letters — so a manifest can't point the renderer's
 * `file://` URL outside the pack (FR-040 confinement).
 */
function isSafeAssetFilename(value: string): boolean {
  return !/[/\\]/.test(value) && !value.includes('..') && !/^[a-zA-Z]:/.test(value);
}

/**
 * Tolerant parse of a `pack.json`. Each token value is either a string (a glyph,
 * or a relative image filename ending .svg/.png) or an already-structured
 * `{glyph}` / `{image}`. Malformed tokens are dropped rather than throwing.
 */
export function parseIconPack(raw: unknown): IconPackManifest {
  const name = isRecord(raw) && typeof raw.name === 'string' ? raw.name : '';
  const tokens: Record<string, IconValue> = {};
  if (isRecord(raw) && isRecord(raw.tokens)) {
    for (const [token, value] of Object.entries(raw.tokens)) {
      if (typeof value === 'string' && value.length > 0) {
        if (isImageFilename(value)) {
          if (isSafeAssetFilename(value)) tokens[token] = { image: value };
          // an unsafe (path-traversing) image filename is dropped → glyph fallback
        } else {
          tokens[token] = { glyph: value };
        }
      } else if (isRecord(value) && typeof value.glyph === 'string') {
        tokens[token] = { glyph: value.glyph };
      } else if (isRecord(value) && typeof value.image === 'string') {
        if (isSafeAssetFilename(value.image)) tokens[token] = { image: value.image };
      }
      // anything else is malformed → dropped
    }
  }
  return { name, tokens };
}

/**
 * Resolve the effective icon value for a token (FR-040 fallback chain):
 *   1. the theme's per-token override
 *   2. the chosen pack's token
 *   3. the theme's own glyph default
 *   4. the ultimate throng glyph fallback
 */
export function resolveIconValue(
  theme: Theme,
  packs: Record<string, IconPackManifest>,
  token: string,
): IconValue {
  const override = theme.iconOverrides?.[token];
  if (override) return override;
  const pack = theme.iconPack ? packs[theme.iconPack] : undefined;
  const fromPack = pack?.tokens[token];
  if (fromPack) return fromPack;
  const themeGlyph = theme.icons[token];
  if (themeGlyph) return { glyph: themeGlyph };
  return { glyph: THRONG_THEME.icons[token] ?? '' };
}
