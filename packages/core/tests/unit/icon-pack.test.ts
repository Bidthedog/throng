import { describe, it, expect } from 'vitest';
import {
  parseIconPack,
  resolveIconValue,
  resolveIconAsset,
  type IconAsset,
  type LoadedIconPack,
} from '../../src/config/icon-pack.js';
import { THRONG_THEME, type IconValue, type Theme } from '../../src/config/theme.js';

describe('parseIconPack (tolerant)', () => {
  it('classifies .svg/.png strings as images and others as glyphs; mixes both', () => {
    const pack = parseIconPack({
      name: 'mixed',
      tokens: { folder: 'folder.svg', file: 'file.PNG', add: '＋', terminal: '▣' },
    });
    expect(pack.name).toBe('mixed');
    expect(pack.tokens.folder).toEqual({ image: 'folder.svg' });
    expect(pack.tokens.file).toEqual({ image: 'file.PNG' });
    expect(pack.tokens.add).toEqual({ glyph: '＋' });
    expect(pack.tokens.terminal).toEqual({ glyph: '▣' });
  });

  it('accepts already-structured glyph/image values', () => {
    const pack = parseIconPack({ name: 'p', tokens: { a: { glyph: 'x' }, b: { image: 'b.svg' } } });
    expect(pack.tokens.a).toEqual({ glyph: 'x' });
    expect(pack.tokens.b).toEqual({ image: 'b.svg' });
  });

  it('drops image filenames that try to escape the pack folder (FR-040 confinement)', () => {
    const pack = parseIconPack({
      name: 'evil',
      tokens: {
        bad1: '../../../Windows/win.ini.png',
        bad2: 'sub/dir/icon.svg',
        bad3: 'C:evil.png',
        good: 'icon.svg',
        struct: { image: '../escape.png' },
      },
    });
    expect(pack.tokens.bad1).toBeUndefined();
    expect(pack.tokens.bad2).toBeUndefined();
    expect(pack.tokens.bad3).toBeUndefined();
    expect(pack.tokens.struct).toBeUndefined();
    expect(pack.tokens.good).toEqual({ image: 'icon.svg' });
  });

  it('drops malformed tokens and tolerates a missing/!object manifest', () => {
    const pack = parseIconPack({ name: 'p', tokens: { good: 'g', bad: 42, empty: '' } });
    expect(pack.tokens.good).toEqual({ glyph: 'g' });
    expect(pack.tokens.bad).toBeUndefined();
    expect(pack.tokens.empty).toBeUndefined();
    expect(parseIconPack(null)).toEqual({ name: '', tokens: {} });
    expect(parseIconPack('nope')).toEqual({ name: '', tokens: {} });
  });
});

describe('resolveIconValue (FR-040 fallback chain)', () => {
  const base: Theme = { ...THRONG_THEME, name: 'x' };

  it('override wins over everything', () => {
    const theme: Theme = { ...base, iconPack: 'p', iconOverrides: { folder: { image: 'my.svg' } } };
    const packs = { p: parseIconPack({ name: 'p', tokens: { folder: 'pack.png' } }) };
    expect(resolveIconValue(theme, packs, 'folder')).toEqual({ image: 'my.svg' });
  });

  it('then the chosen pack', () => {
    const theme: Theme = { ...base, iconPack: 'p' };
    const packs = { p: parseIconPack({ name: 'p', tokens: { folder: 'pack.png' } }) };
    expect(resolveIconValue(theme, packs, 'folder')).toEqual({ image: 'pack.png' });
  });

  it('then the theme glyph, then the throng glyph', () => {
    const theme: Theme = { ...base, iconPack: 'p', icons: { ...base.icons, add: 'A' } };
    const packs = { p: parseIconPack({ name: 'p', tokens: {} }) }; // pack lacks the token
    expect(resolveIconValue(theme, packs, 'add')).toEqual({ glyph: 'A' });
    // a token the theme also lacks falls back to the throng glyph
    const bare: Theme = { ...base, icons: {} };
    expect(resolveIconValue(bare, {}, 'terminal')).toEqual({ glyph: THRONG_THEME.icons.terminal });
  });

  it('an unknown pack name falls through to the glyph chain', () => {
    const theme: Theme = { ...base, iconPack: 'missing' };
    expect(resolveIconValue(theme, {}, 'folder')).toEqual({ glyph: THRONG_THEME.icons.folder });
  });
});

/**
 * 017 / #54 — the RENDER model.
 *
 * `resolveIconValue` says WHAT a token resolves to; it can answer `{ image: 'folder.svg' }`, which
 * is not renderable on its own (you also need the pack it came from). `resolveIconAsset` says what
 * the token RENDERS AS: a glyph, sanitised inline SVG markup, a raster data URI — or nothing, in
 * which case it must fall back rather than leave a hole.
 */
describe('resolveIconAsset', () => {
  const base: Theme = {
    name: 'T',
    colours: {},
    fonts: { ui: 'x', mono: 'y' },
    icons: { folder: 'THEME_FOLDER', file: 'THEME_FILE' },
  };
  const pack = (assets: Record<string, IconAsset>, tokens: Record<string, IconValue>): LoadedIconPack => ({
    name: 'p',
    tokens,
    assets,
  });

  it('renders a glyph token as a glyph', () => {
    const theme: Theme = { ...base, iconPack: 'p' };
    const packs = { p: pack({}, { folder: { glyph: 'PACK_GLYPH' } }) };
    expect(resolveIconAsset(theme, packs, 'folder')).toEqual({ kind: 'glyph', glyph: 'PACK_GLYPH' });
  });

  it('renders an image token as its loaded SVG markup', () => {
    const theme: Theme = { ...base, iconPack: 'p' };
    const packs = {
      p: pack({ folder: { kind: 'svg', markup: '<svg/>' } }, { folder: { image: 'folder.svg' } }),
    };
    expect(resolveIconAsset(theme, packs, 'folder')).toEqual({ kind: 'svg', markup: '<svg/>' });
  });

  it('falls back DOWN THE CHAIN when the image could not be loaded — never a hole', () => {
    // The pack claims folder.svg, but the file was missing/corrupt/not an SVG, so the loader
    // recorded `missing`. FR-003: an icon must always resolve to something renderable. The one
    // outcome that is NOT acceptable is rendering nothing, which is what a naive
    // `pack.assets[token]` lookup would do.
    const theme: Theme = { ...base, iconPack: 'p' };
    const packs = { p: pack({ folder: { kind: 'missing' } }, { folder: { image: 'folder.svg' } }) };
    expect(resolveIconAsset(theme, packs, 'folder')).toEqual({ kind: 'glyph', glyph: 'THEME_FOLDER' });
  });

  it('falls back to the DEFAULT glyph when the theme has no glyph either', () => {
    const theme: Theme = { ...base, icons: {}, iconPack: 'p' };
    const packs = { p: pack({ destroy: { kind: 'missing' } }, { destroy: { image: 'destroy.svg' } }) };
    expect(resolveIconAsset(theme, packs, 'destroy')).toEqual({
      kind: 'glyph',
      glyph: THRONG_THEME.icons.destroy,
    });
  });

  it('a PARTIAL pack yields a fully-populated interface', () => {
    // Half the tokens are packed, half are not. Every one of them must still render.
    const theme: Theme = { ...base, iconPack: 'p' };
    const packs = {
      p: pack({ folder: { kind: 'svg', markup: '<svg id="f"/>' } }, { folder: { image: 'folder.svg' } }),
    };
    expect(resolveIconAsset(theme, packs, 'folder')).toEqual({ kind: 'svg', markup: '<svg id="f"/>' });
    expect(resolveIconAsset(theme, packs, 'file')).toEqual({ kind: 'glyph', glyph: 'THEME_FILE' });
  });

  it('renders a raster token as its data URI', () => {
    const theme: Theme = { ...base, iconPack: 'p' };
    const packs = {
      p: pack({ folder: { kind: 'raster', dataUri: 'data:image/png;base64,AA' } }, { folder: { image: 'folder.png' } }),
    };
    expect(resolveIconAsset(theme, packs, 'folder')).toEqual({
      kind: 'raster',
      dataUri: 'data:image/png;base64,AA',
    });
  });

  it('with no pack selected, every token is a theme glyph', () => {
    expect(resolveIconAsset(base, {}, 'folder')).toEqual({ kind: 'glyph', glyph: 'THEME_FOLDER' });
  });

  it('a GLYPH override wins over the pack', () => {
    const theme: Theme = { ...base, iconPack: 'p', iconOverrides: { folder: { glyph: 'OVR' } } };
    const packs = { p: pack({ folder: { kind: 'svg', markup: '<svg/>' } }, { folder: { image: 'folder.svg' } }) };
    expect(resolveIconAsset(theme, packs, 'folder')).toEqual({ kind: 'glyph', glyph: 'OVR' });
  });

  it('an IMAGE override does NOT render the pack image, and does NOT leave a hole', () => {
    // The override names a file the loader never loads (loading override files is out of scope, #55).
    // It must therefore NOT fall through to `pack.assets[token]` — that would render the pack's
    // folder icon for a token the user overrode to something else, the wrong picture — and it must
    // not render nothing. It falls back down the chain to a glyph.
    const theme: Theme = { ...base, iconPack: 'p', iconOverrides: { folder: { image: 'mine.svg' } } };
    const packs = { p: pack({ folder: { kind: 'svg', markup: '<svg id="pack"/>' } }, { folder: { image: 'folder.svg' } }) };
    expect(resolveIconAsset(theme, packs, 'folder')).toEqual({ kind: 'glyph', glyph: 'THEME_FOLDER' });
  });
});
