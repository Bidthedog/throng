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

/**
 * What a token RENDERS AS (017 / #54).
 *
 * `IconValue` says what a token resolves *to*, and it can answer `{ image: 'folder.svg' }` — a
 * filename, which is not renderable on its own. The renderer must never touch the disk, so the main
 * process turns every image into one of these ONCE, at pack-load time, and ships the result.
 *
 * `svg` carries sanitised MARKUP, not a path, because an SVG inside an `<img>` is an isolated
 * document whose `currentColor` resolves to black instead of to the theme — which is the whole bug.
 * Inlining is the only way a pack icon can take the theme's colour.
 */
export type IconAsset =
  | { kind: 'glyph'; glyph: string }
  | { kind: 'svg'; markup: string }
  // 018 follow-up — NO RASTER. An icon takes the theme's colour and the theme's size; a PNG can do
  // neither. It kept its own colour, wrong for most of the fifteen themes by construction, and went
  // soft the moment anybody enlarged it. A non-SVG asset now degrades to `missing`, which falls down
  // the icon chain to the theme's glyph.
  | { kind: 'missing' };

/**
 * A pack whose assets have been loaded into memory.
 *
 * Note there is no `assetBase`: once the assets are here, the renderer has no business knowing where
 * on disk the pack lives — and handing it an absolute path is exactly the leak that invites a
 * `file://` read back onto the render path.
 */
export interface LoadedIconPack extends IconPackManifest {
  assets: Record<string, IconAsset>;
  /** Why the pack could not be loaded. Its presence is how "this pack is broken" reaches the user. */
  error?: string;
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

/** The theme's own glyph for a token, then the ultimate throng default. Never undefined. */
function glyphFallback(theme: Theme, token: string): IconAsset {
  const themeGlyph = theme.icons[token];
  if (themeGlyph) return { kind: 'glyph', glyph: themeGlyph };
  return { kind: 'glyph', glyph: THRONG_THEME.icons[token] ?? '' };
}

/**
 * Resolve what a token RENDERS AS — the single authoritative entry point for every icon in the app.
 *
 * Runs the same precedence chain as `resolveIconValue` (override → pack → theme glyph → default),
 * then turns the result into something renderable.
 *
 * The invariant that matters: **a token always produces something renderable.** If a pack claims an
 * image but the file was missing, unreadable, or not actually an SVG, the loader records `missing` —
 * and this function then falls back DOWN THE CHAIN to the theme's glyph rather than returning the
 * hole. A naive `pack.assets[token]` lookup would render nothing, so a half-broken pack would
 * produce a half-empty interface (FR-003).
 */
export function resolveIconAsset(
  theme: Theme,
  packs: Record<string, LoadedIconPack>,
  token: string,
): IconAsset {
  const value = resolveIconValue(theme, packs, token);
  if ('glyph' in value) return { kind: 'glyph', glyph: value.glyph };

  // The value is an image, and an image is only renderable if its FILE was loaded into an asset.
  // The main-process loader loads a *pack's* files — it does not load override files. So a pack
  // asset may be used only when the winning image actually came from the pack, i.e. NOT from an
  // image override. Reading `pack.assets[token]` unconditionally would render the pack's folder
  // icon for a token the user overrode to a different image — the wrong picture — or, with no pack,
  // silently render nothing.
  const fromOverrideImage = (() => {
    const override = theme.iconOverrides?.[token];
    return override !== undefined && 'image' in override;
  })();

  if (!fromOverrideImage) {
    const pack = theme.iconPack ? packs[theme.iconPack] : undefined;
    const asset = pack?.assets[token];
    if (asset && asset.kind !== 'missing') return asset;
  }

  // An image override (whose file is not loaded) — or a pack image whose asset failed to load —
  // falls back DOWN the chain to a glyph rather than rendering the wrong image or a hole.
  return glyphFallback(theme, token);
}
