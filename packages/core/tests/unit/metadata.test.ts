import { describe, it, expect } from 'vitest';
import {
  leavesOf,
  tokensOf,
  auditRegistry,
  assertEveryKeyDescribed,
  getAtPath,
  setAtPath,
  type FieldDescriptor,
  type MetadataRegistry,
} from '../../src/config/metadata.js';
import { DEFAULT_APP_SETTINGS } from '../../src/config/app-settings.js';
import { THRONG_THEME } from '../../src/config/theme.js';

function descriptor(key: string, over: Partial<FieldDescriptor> = {}): FieldDescriptor {
  return {
    key,
    label: key,
    description: `desc ${key}`,
    group: 'General',
    control: 'text',
    ...over,
  };
}

describe('leavesOf', () => {
  it('returns dotted paths for primitive leaves', () => {
    expect(leavesOf({ a: { b: 1, c: 'x' }, d: true }).sort()).toEqual(['a.b', 'a.c', 'd']);
  });

  it('treats arrays as leaves (does not descend into them)', () => {
    expect(leavesOf({ list: [1, 2, 3], nested: { arr: ['a'] } }).sort()).toEqual([
      'list',
      'nested.arr',
    ]);
  });

  it('enumerates the real AppSettings leaves', () => {
    const leaves = leavesOf(DEFAULT_APP_SETTINGS);
    expect(leaves).toContain('appearance.theme');
    expect(leaves).toContain('confirmations.destroyProject');
    expect(leaves).toContain('panes.projects.maxWidth');
    expect(leaves).toContain('behaviour.tabHoverActivateMs');
    expect(leaves).toContain('explorer.openMode');
    expect(leaves).toContain('explorer.excludeGlobs'); // array leaf, not descended
    expect(leaves).toContain('terminals.flavours'); // array leaf
    expect(leaves).toContain('editor.autoSave');
    expect(leaves).toContain('editor.defaultLineEnding');
    // arrays are not descended into
    expect(leaves.some((l) => l.startsWith('explorer.excludeGlobs.'))).toBe(false);
    expect(leaves.some((l) => l.startsWith('terminals.flavours.'))).toBe(false);
  });
});

describe('tokensOf', () => {
  it('excludes the theme name identifier', () => {
    expect(tokensOf(THRONG_THEME)).not.toContain('name');
  });

  it('enumerates colour, font, typography and icon tokens', () => {
    const tokens = tokensOf(THRONG_THEME);
    expect(tokens).toContain('colours.accent');
    expect(tokens).toContain('colours.appBg');
    expect(tokens).toContain('icons.folder');
    expect(tokens).toContain('icons.terminal');
    expect(tokens).toContain('fonts.family');
    expect(tokens).toContain('fonts.baseSizePx');
    expect(tokens).toContain('typography.paneTitle.case');
  });
});

describe('getAtPath / setAtPath', () => {
  const base = { a: { b: { c: 1 }, d: 2 }, e: [1, 2] };

  it('reads nested values', () => {
    expect(getAtPath(base, 'a.b.c')).toBe(1);
    expect(getAtPath(base, 'a.d')).toBe(2);
    expect(getAtPath(base, 'e')).toEqual([1, 2]);
    expect(getAtPath(base, 'a.b.x')).toBeUndefined();
    expect(getAtPath(base, 'nope.deep')).toBeUndefined();
  });

  it('sets nested values immutably (siblings shared, original untouched)', () => {
    const next = setAtPath(base, 'a.b.c', 99);
    expect(getAtPath(next, 'a.b.c')).toBe(99);
    expect(getAtPath(base, 'a.b.c')).toBe(1); // original unchanged
    expect(next.a.d).toBe(2);
    expect(next.e).toBe(base.e); // untouched sibling shared by reference
    expect(next).not.toBe(base);
    expect(next.a).not.toBe(base.a);
  });

  it('creates missing intermediate objects', () => {
    const next = setAtPath({} as Record<string, unknown>, 'x.y.z', 5);
    expect(getAtPath(next, 'x.y.z')).toBe(5);
  });
});

describe('auditRegistry', () => {
  const keys = ['a.b', 'c'];

  it('reports nothing wrong for an exact registry', () => {
    const reg: MetadataRegistry = [descriptor('a.b'), descriptor('c')];
    expect(auditRegistry(keys, reg)).toEqual({ missing: [], unknown: [], duplicated: [] });
  });

  it('reports a missing descriptor', () => {
    const reg: MetadataRegistry = [descriptor('a.b')];
    expect(auditRegistry(keys, reg).missing).toEqual(['c']);
  });

  it('reports an unknown (extra) descriptor', () => {
    const reg: MetadataRegistry = [descriptor('a.b'), descriptor('c'), descriptor('zzz')];
    expect(auditRegistry(keys, reg).unknown).toEqual(['zzz']);
  });

  it('reports a duplicated descriptor key', () => {
    const reg: MetadataRegistry = [descriptor('a.b'), descriptor('c'), descriptor('c')];
    expect(auditRegistry(keys, reg).duplicated).toEqual(['c']);
  });
});

describe('assertEveryKeyDescribed', () => {
  const keys = ['a.b', 'c'];

  it('does not throw for an exact registry', () => {
    const reg: MetadataRegistry = [descriptor('a.b'), descriptor('c')];
    expect(() => assertEveryKeyDescribed(keys, reg)).not.toThrow();
  });

  it('throws listing the missing key', () => {
    const reg: MetadataRegistry = [descriptor('a.b')];
    expect(() => assertEveryKeyDescribed(keys, reg)).toThrow(/c/);
  });

  it('throws on an unknown descriptor', () => {
    const reg: MetadataRegistry = [descriptor('a.b'), descriptor('c'), descriptor('zzz')];
    expect(() => assertEveryKeyDescribed(keys, reg)).toThrow(/zzz/);
  });
});
