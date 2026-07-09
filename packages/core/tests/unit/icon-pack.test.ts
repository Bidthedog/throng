import { describe, it, expect } from 'vitest';
import { parseIconPack, resolveIconValue } from '../../src/config/icon-pack.js';
import { THRONG_THEME, type Theme } from '../../src/config/theme.js';

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
