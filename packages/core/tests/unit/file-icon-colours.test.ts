import { describe, expect, it } from 'vitest';
import {
  ALL_DEFAULT_THEMES,
  FILE_ICON_CATEGORIES,
  FILE_ICON_CATEGORY_TOKENS,
  ICON_KEYS,
  OPTIONAL_THEME_COLOUR_TOKENS,
  ciede2000,
  contrastFailures,
  contrastRatio,
  deriveFileIconColours,
  fileIconCategory,
  hexToRgb,
  rgbToLab,
} from '../../src/index.js';

/**
 * 069 FR-061 — file icons coloured by category: every file kind has one, every bundled theme carries a
 * colour per category that reads on the tree's backgrounds, and the categories stay apart from each other.
 */
const TOKENS = Object.values(FILE_ICON_CATEGORY_TOKENS);
const BACKGROUNDS = ['sidebarBg', 'hoverSurface', 'surfaceActive', 'appBg'] as const;

describe('file icon categories (069 FR-061)', () => {
  it('gives every file kind a category, the unknown file its own, and nothing else one', () => {
    const fileKinds = ICON_KEYS.filter((k) => /^file[A-Z]/.test(k));
    expect(fileKinds.filter((k) => fileIconCategory(k) === null)).toEqual([]);
    // 069 FR-064 — the fallback file icon is set apart from the folders, which keep the Icon Colour.
    expect(fileIconCategory('file')).toBe('other');
    for (const k of ['folder', 'folderOpen', 'symlink', 'folderGit', 'save']) expect(fileIconCategory(k)).toBeNull();
  });

  it('makes each category an optional theme colour, so an unset one falls back to the Icon Colour', () => {
    expect(FILE_ICON_CATEGORIES).toHaveLength(8);
    for (const t of TOKENS) expect(OPTIONAL_THEME_COLOUR_TOKENS).toContain(t);
  });

  it.each(Object.entries(ALL_DEFAULT_THEMES))('%s: sets every category, each clearing 4.5:1 on every tree background', (_name, theme) => {
    for (const t of TOKENS) {
      const colour = theme.colours[t];
      expect(colour, t).toMatch(/^#[0-9a-f]{6}$/);
      for (const bg of BACKGROUNDS) {
        const behind = theme.colours[bg] ?? theme.colours.surface!;
        expect(contrastRatio(colour!, behind), `${t} on ${bg}`).toBeGreaterThanOrEqual(4.5);
      }
    }
    expect(contrastFailures(theme).filter((f) => f.fg.startsWith('fileIcon'))).toEqual([]);
  });

  it.each(Object.entries(ALL_DEFAULT_THEMES))('%s: keeps every two categories visibly apart', (_name, theme) => {
    for (let i = 0; i < TOKENS.length; i++) {
      for (let j = i + 1; j < TOKENS.length; j++) {
        const a = rgbToLab(hexToRgb(theme.colours[TOKENS[i]!]!));
        const b = rgbToLab(hexToRgb(theme.colours[TOKENS[j]!]!));
        expect(ciede2000(a, b), `${TOKENS[i]} / ${TOKENS[j]}`).toBeGreaterThanOrEqual(12);
      }
    }
  });

  it.each(Object.entries(ALL_DEFAULT_THEMES))('%s: draws the unknown file in a neutral grey, apart from the folders', (_name, theme) => {
    const other = theme.colours.fileIconOther!;
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(other.slice(i, i + 2), 16));
    expect(Math.max(r!, g!, b!) - Math.min(r!, g!, b!), `${other} is grey`).toBeLessThanOrEqual(2);
    // Folders keep the Icon Colour, which no bundled theme sets: they draw in the text colour.
    const folders = theme.colours.iconColour ?? theme.colours.text;
    expect(ciede2000(rgbToLab(hexToRgb(other)), rgbToLab(hexToRgb(folders))), `${other} / ${folders}`).toBeGreaterThanOrEqual(12);
  });

  it('lightens on a dark background and darkens on a light one', () => {
    const dark = deriveFileIconColours(['#101010']);
    const light = deriveFileIconColours(['#fafafa']);
    for (const t of TOKENS) {
      expect(contrastRatio(dark[t]!, '#101010')).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(light[t]!, '#fafafa')).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(dark[t]!, '#ffffff')).toBeLessThan(contrastRatio(light[t]!, '#ffffff'));
    }
  });

  it('measures a theme without the categories exactly as before', () => {
    const plain = { ...ALL_DEFAULT_THEMES.throng!, colours: { ...ALL_DEFAULT_THEMES.throng!.colours } };
    for (const t of TOKENS) delete plain.colours[t];
    expect(contrastFailures(plain).filter((f) => f.fg.startsWith('fileIcon'))).toEqual([]);
  });
});
