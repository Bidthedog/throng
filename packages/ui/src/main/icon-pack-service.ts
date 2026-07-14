/**
 * Icon-pack discovery and LOADING (007 FR-040; reworked by 017 / #54).
 *
 * Scans the per-user `%USERPROFILE%\.throng\icon-packs\` directory for pack folders (a folder is a
 * pack iff it contains a `pack.json` manifest) and loads each pack's assets INTO MEMORY, once.
 *
 * Two things changed in 017, and both are load-bearing:
 *
 *  1. **We no longer hand the renderer an `assetBase`.** It used to render pack images via a
 *     `file://` URL built from that path — but an SVG inside an `<img>` is an isolated document
 *     whose `currentColor` resolves to BLACK rather than to the page's theme colour. That is why
 *     selecting the SVG pack produced black-on-dark icons. The only way to theme a pack icon is to
 *     inline its markup, so we ship sanitised MARKUP instead of a path.
 *  2. **Assets are read once, here.** The file explorer resolves an icon per row; if rendering
 *     could reach the disk, painting a large tree would cost hundreds of reads per frame.
 *
 * A broken pack DEGRADES: it comes back with an `error` and no assets, so the Preferences picker can
 * show it as unavailable *with a reason*. It never throws, and it never disappears silently — a
 * chosen setting that appears to do nothing is the precise defect this feature exists to remove.
 */
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  parseIconPack,
  sanitiseSvg,
  THRONG_THEME,
  type IconAsset,
  type IconValue,
} from '@throng/core';

export interface IconPackInfo {
  name: string;
  /** Parsed token → glyph|image map. */
  tokens: Record<string, IconValue>;
  /** Every token pre-resolved to something renderable. The renderer never touches the disk. */
  assets: Record<string, IconAsset>;
  /** Why the pack could not be loaded. Its presence is how "this pack is broken" reaches the user. */
  error?: string;
}

const README_CONTENT = `# throng icon packs

An icon pack re-skins throng's icons. Drop a folder here and it becomes selectable
in Preferences → Themes → Icons.

## Layout

    icon-packs/
      <your-pack>/
        pack.json          # the manifest (required)
        *.svg             # SVG assets referenced by pack.json (SVG only — see below)

## pack.json

Maps each icon token to EITHER a glyph string OR a relative image filename
(ending .svg). SVG ONLY: icons take the theme's colour and the theme's size, and a raster can
do neither. Tokens you omit fall back to the
default throng glyph.

    {
      "name": "<your-pack>",
      "tokens": {
        "folder": "folder.svg",
        "file": "file.svg",
        "add": "＋",
        "terminal": "▣"
      }
    }

Icons render in a 24px box. A per-theme override (Preferences → Themes → Icons)
takes precedence over the pack, which takes precedence over the theme glyph,
which falls back to the throng glyph.

## Icon tokens

${Object.keys(THRONG_THEME.icons)
  .map((t) => `- ${t}`)
  .join('\n')}
`;

/**
 * Distinct, themeable (currentColor) line-art for each icon token — the secondary
 * bundled **SVG image pack** (FR-040b). Crisp at 24px and needs no OS/runtime. Any
 * token without a bespoke shape falls back to a generic rounded-square badge, so
 * the pack always covers every token.
 */
const SVG_SHAPES: Record<string, string> = {
  destroy: '<path d="M6 6l12 12M18 6L6 18"/>',
  collapse: '<path d="M15 6l-6 6 6 6"/>',
  expand: '<path d="M9 6l6 6-6 6"/>',
  rename: '<path d="M4 20h4L18 10l-4-4L4 16v4z"/><path d="M13 5l4 4"/>',
  send: '<path d="M4 12h13"/><path d="M12 6l6 6-6 6"/>',
  tab: '<rect x="3" y="6" width="18" height="12" rx="2"/>',
  add: '<path d="M12 5v14M5 12h14"/>',
  detach: '<path d="M14 4h6v6"/><path d="M20 4l-9 9"/><path d="M11 5H5v14h14v-6"/>',
  folder: '<path d="M3 7h6l2 2h10v10H3z"/>',
  folderOpen: '<path d="M3 7h6l2 2h10v3H3z"/><path d="M3 12h18l-2 7H5z"/>',
  chevron: '<path d="M9 6l6 6-6 6"/>',
  file: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/>',
  fileCode: '<path d="M6 3h8l4 4v14H6z"/><path d="M10 12l-2 2 2 2M14 12l2 2-2 2"/>',
  fileJson: '<path d="M6 3h8l4 4v14H6z"/><path d="M11 12q-2 0-2 2t-2 2q2 0 2 2t2 2"/>',
  fileMarkdown: '<path d="M6 3h8l4 4v14H6z"/><path d="M9 17v-4l2 2 2-2v4"/>',
  fileImage: '<path d="M6 3h8l4 4v14H6z"/><circle cx="10" cy="12" r="1.4"/><path d="M8 18l3-3 3 3 2-2"/>',
  fileText: '<path d="M6 3h8l4 4v14H6z"/><path d="M9 12h6M9 15h6M9 18h4"/>',
  symlink: '<path d="M6 19v-5a5 5 0 015-5h6"/><path d="M14 5l4 4-4 4"/>',
  expandAll: '<path d="M7 7l5 5 5-5"/><path d="M7 13l5 5 5-5"/>',
  collapseAll: '<path d="M7 12l5-5 5 5"/><path d="M7 18l5-5 5 5"/>',
  newFolder: '<path d="M3 7h6l2 2h10v10H3z"/><path d="M15 13v4M13 15h4"/>',
  terminal: '<rect x="4" y="5" width="16" height="14" rx="2"/><path d="M8 10l3 3-3 3M13 16h4"/>',
  // 018. Without a shape here a token silently falls back to GENERIC_SHAPE — a rounded square — so
  // the icon "works" while looking like nothing in particular. That is worse than failing.
  settings:
    '<circle cx="12" cy="12" r="3"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6L17 7M7 17l-1.4 1.4"/>',
  windowMinimise: '<path d="M5 12h14"/>',
  windowMaximise: '<rect x="5" y="5" width="14" height="14" rx="1"/>',
  windowRestore: '<rect x="5" y="8" width="11" height="11" rx="1"/><path d="M8 8V5h11v11h-3"/>',
  windowClose: '<path d="M6 6l12 12M18 6L6 18"/>',
};

const GENERIC_SHAPE = '<rect x="4" y="4" width="16" height="16" rx="3"/><circle cx="12" cy="12" r="2.5"/>';

function svgForToken(token: string): string {
  const inner = SVG_SHAPES[token] ?? GENERIC_SHAPE;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" ` +
    `stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">` +
    `${inner}</svg>\n`
  );
}

export class IconPackService {
  constructor(private readonly iconPacksDir: string) {}

  /**
   * Seed the two bundled icon packs on first run (FR-040b): a first-class
   * **`throng` glyph pack** (packaging THRONG_THEME's built-in glyphs, the default
   * `theme.iconPack`) and a secondary **`throng-svg` image pack** (a themeable SVG
   * per token). Idempotent — a pack already present (a user edit) is never
   * overwritten. Discovered + selectable via {@link listIconPacks}.
   */
  async ensureBundledPacks(): Promise<void> {
    const tokens = Object.keys(THRONG_THEME.icons);
    const packs: { name: string; files: Record<string, string> }[] = [
      {
        name: 'throng',
        files: {
          'pack.json': `${JSON.stringify(
            { name: 'throng', tokens: { ...THRONG_THEME.icons } },
            null,
            2,
          )}\n`,
        },
      },
      {
        name: 'throng-svg',
        files: {
          'pack.json': `${JSON.stringify(
            { name: 'throng-svg', tokens: Object.fromEntries(tokens.map((t) => [t, `${t}.svg`])) },
            null,
            2,
          )}\n`,
          ...Object.fromEntries(tokens.map((t) => [`${t}.svg`, svgForToken(t)])),
        },
      },
    ];
    for (const pack of packs) {
      const dir = join(this.iconPacksDir, pack.name);
      try {
        await readFile(join(dir, 'pack.json'), 'utf8');
        continue; // already seeded — never overwrite a user edit
      } catch {
        // fall through to seed
      }
      try {
        await mkdir(dir, { recursive: true });
        for (const [file, content] of Object.entries(pack.files)) {
          await writeFile(join(dir, file), content, 'utf8');
        }
      } catch {
        // best-effort
      }
    }
  }

  /**
   * Seed a README documenting the pack format so users can author their own by
   * example (FR-040a). Written once if absent; never overwrites a user's edit.
   */
  async ensureReadme(): Promise<void> {
    const path = join(this.iconPacksDir, 'README.md');
    try {
      await readFile(path, 'utf8');
      return; // already present
    } catch {
      // fall through to write
    }
    try {
      await mkdir(this.iconPacksDir, { recursive: true });
      await writeFile(path, README_CONTENT, 'utf8');
    } catch {
      // best-effort
    }
  }

  /**
   * Load one token's image asset from disk.
   *
   * Never throws: an unreadable or non-SVG file becomes `missing`, and the caller then falls back
   * DOWN the icon chain (theme glyph, then default) rather than rendering a hole (FR-003).
   */
  private async loadAsset(dir: string, file: string): Promise<IconAsset> {
    /*
     * SVG ONLY. A raster is not an icon here (018 follow-up).
     *
     * Icons are now SIZED by the theme and COLOURED by the theme. A PNG can do neither: it cannot be
     * asked to grow without going soft, and it cannot take `currentColor`, so it renders in whatever
     * colour it was painted with — which is wrong for most of the fifteen themes by construction. It
     * was accepted because it was easy to accept, and every pack that used it looked broken on arrival.
     *
     * A non-SVG file degrades to `missing`, which falls DOWN the icon chain to the theme's glyph — the
     * same as a corrupt file. The pack is not rejected; only the file that cannot do the job is.
     */
    if (!/\.svg$/i.test(file)) return { kind: 'missing' };
    try {
      const markup = sanitiseSvg(await readFile(join(dir, file), 'utf8'));
      // `null` = the file is not an SVG at all, whatever it is called.
      return markup === null ? { kind: 'missing' } : { kind: 'svg', markup };
    } catch {
      return { kind: 'missing' };
    }
  }

  /**
   * Every pack, with its assets loaded into memory. Absence-tolerant; never throws.
   *
   * A pack that cannot be read is still RETURNED, carrying an `error` — it must not vanish, because
   * a pack that silently disappears looks exactly like a setting that does nothing.
   */
  async listIconPacks(): Promise<IconPackInfo[]> {
    const packs: IconPackInfo[] = [];
    let entries;
    try {
      entries = await readdir(this.iconPacksDir, { withFileTypes: true });
    } catch {
      return packs; // icon-packs dir absent → no packs
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const dir = join(this.iconPacksDir, entry.name);

      let tokens: Record<string, IconValue>;
      try {
        const raw = await readFile(join(dir, 'pack.json'), 'utf8'); // a pack must have a manifest
        tokens = parseIconPack(JSON.parse(raw)).tokens;
      } catch (err) {
        packs.push({
          name: entry.name,
          tokens: {},
          assets: {},
          error: `Could not read pack.json: ${err instanceof Error ? err.message : String(err)}`,
        });
        continue;
      }

      // Read every image ONCE, here, so that rendering an icon later costs no disk at all.
      const assets: Record<string, IconAsset> = {};
      for (const [token, value] of Object.entries(tokens)) {
        assets[token] =
          'glyph' in value
            ? { kind: 'glyph', glyph: value.glyph }
            : await this.loadAsset(dir, value.image);
      }
      packs.push({ name: entry.name, tokens, assets });
    }
    return packs;
  }
}
