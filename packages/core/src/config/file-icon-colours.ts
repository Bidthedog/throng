/**
 * 069 FR-061 — file icons coloured by CATEGORY, so a file's kind reads at a glance in the File Explorer
 * and Find in Files.
 *
 * Seven categories rather than a colour per language: about seven hues stay distinguishable from one
 * another; forty do not. Colour is a SECOND signal — every icon already differs by its art or label —
 * so a reader who cannot tell two hues apart loses nothing (WCAG 2.1 SC 1.4.1), and no separate
 * colour-blind mode is needed.
 *
 * Each category is an OPTIONAL theme colour token (see OPTIONAL_THEME_COLOUR_TOKENS). Unset, its icons
 * take the theme's Icon Colour as every other icon does, so clearing the seven gives the plain tree.
 * The bundled themes carry values DERIVED here, per theme, exactly as `errorText` and the syntax hues
 * are: each category keeps its hue, and its lightness moves away from the theme's backgrounds until it
 * clears {@link FILE_ICON_MIN_CONTRAST} on every surface a file icon is drawn on.
 *
 * Pure. No OS, no DOM.
 */
import { contrastRatio, hexToRgb, relativeLuminance } from './colour-math.js';

export const FILE_ICON_CATEGORIES = ['code', 'markup', 'data', 'document', 'media', 'archive', 'script'] as const;
export type FileIconCategory = (typeof FILE_ICON_CATEGORIES)[number];

/** The theme colour token each category paints with. */
export const FILE_ICON_CATEGORY_TOKENS: Readonly<Record<FileIconCategory, string>> = Object.freeze({
  code: 'fileIconCode',
  markup: 'fileIconMarkup',
  data: 'fileIconData',
  document: 'fileIconDocument',
  media: 'fileIconMedia',
  archive: 'fileIconArchive',
  script: 'fileIconScript',
});

/**
 * Which category each file icon key belongs to. A key not listed — the unknown `file`, folders, the
 * link badges — takes the plain Icon Colour.
 */
export const FILE_ICON_KEY_CATEGORY: Readonly<Record<string, FileIconCategory>> = Object.freeze({
  fileCode: 'code',
  fileC: 'code',
  fileCpp: 'code',
  fileCsharp: 'code',
  fileJava: 'code',
  fileJavaScript: 'code',
  fileTypeScript: 'code',
  filePython: 'code',
  fileGo: 'code',
  fileRust: 'code',
  fileRuby: 'code',
  fileR: 'code',
  fileLua: 'code',
  fileDart: 'code',
  fileSwift: 'code',
  fileScala: 'code',
  fileKotlin: 'code',
  filePhp: 'code',
  fileHtml: 'markup',
  fileCss: 'markup',
  fileSass: 'markup',
  fileJson: 'data',
  fileConfig: 'data',
  fileSpreadsheet: 'data',
  fileDatabase: 'data',
  fileSql: 'data',
  fileText: 'document',
  fileMarkdown: 'document',
  fileDiff: 'document',
  fileImage: 'media',
  fileAudio: 'media',
  fileVideo: 'media',
  fileFont: 'media',
  fileModel: 'media',
  fileArchive: 'archive',
  filePackage: 'archive',
  fileShell: 'script',
  filePowerShell: 'script',
  fileKey: 'script',
});

/** The category of an icon key, or `null` for one that takes the plain Icon Colour. */
export function fileIconCategory(key: string): FileIconCategory | null {
  return FILE_ICON_KEY_CATEGORY[key] ?? null;
}

/**
 * Each category's hue, in degrees: seven spread round the wheel so that neighbours in the tree differ
 * by hue as well as by art. Code is blue, markup red-orange, data teal, documents amber, media magenta,
 * archives violet, scripts and keys lime.
 */
export const FILE_ICON_HUES: Readonly<Record<FileIconCategory, number>> = Object.freeze({
  code: 210,
  markup: 15,
  data: 165,
  document: 45,
  media: 325,
  archive: 265,
  script: 95,
});

/**
 * The floor every derived colour clears against every background it is drawn on: WCAG 2.1 AA for text
 * (SC 1.4.3), since a label icon (TS, PY) is an image of text. The non-text floor (SC 1.4.11) is 3:1.
 */
export const FILE_ICON_MIN_CONTRAST = 4.5;

function hslToHex(h: number, s: number, l: number): string {
  const k = (n: number): number => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number): number => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const byte = (v: number): string => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0');
  return `#${byte(f(0))}${byte(f(8))}${byte(f(4))}`;
}

/**
 * The seven category colours for a theme, from the backgrounds a file icon sits on (the tree's pane,
 * a hovered row, a selected row, the results list). On a dark theme each hue is lightened, and on a
 * light one darkened, a step at a time from a mid-tone until it clears the floor against every one of
 * them.
 */
export function deriveFileIconColours(backgrounds: readonly string[]): Record<string, string> {
  const dark = relativeLuminance(hexToRgb(backgrounds[0] ?? '#000000')) < 0.18;
  const out: Record<string, string> = {};
  for (const category of FILE_ICON_CATEGORIES) {
    const hue = FILE_ICON_HUES[category];
    const saturation = dark ? 0.7 : 0.8;
    let lightness = dark ? 0.6 : 0.42;
    let colour = hslToHex(hue, saturation, lightness);
    const clears = (c: string): boolean => backgrounds.every((bg) => contrastRatio(c, bg) >= FILE_ICON_MIN_CONTRAST);
    while (!clears(colour) && lightness > 0.04 && lightness < 0.96) {
      lightness += dark ? 0.02 : -0.02;
      colour = hslToHex(hue, saturation, lightness);
    }
    out[FILE_ICON_CATEGORY_TOKENS[category]] = colour;
  }
  return out;
}
