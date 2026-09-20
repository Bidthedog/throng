import { describe, expect, it } from 'vitest';
import { linkReadoutTarget } from '../../src/links/readout.js';

/**
 * 045 FR-167a (round four) — the status-bar readout's "first reading": an absolute address where
 * the panel has a base, the text as written where it has none, resolved by the same `..`/`.` join
 * the Markdown preview's own links already use.
 */
describe('linkReadoutTarget (FR-167a)', () => {
  it('an already-absolute drive path is itself, base or none', () => {
    expect(linkReadoutTarget('D:\\other\\file.txt', 'D:\\proj')).toBe('D:\\other\\file.txt');
    expect(linkReadoutTarget('D:\\other\\file.txt', null)).toBe('D:\\other\\file.txt');
  });

  it('a UNC location is itself', () => {
    expect(linkReadoutTarget('\\\\server\\share\\file.txt', 'D:\\proj')).toBe('\\\\server\\share\\file.txt');
  });

  it('a relative path resolves against the base, `..` included', () => {
    expect(linkReadoutTarget('src\\foo.ts', 'D:\\proj')).toBe('D:\\proj\\src\\foo.ts');
    expect(linkReadoutTarget('..\\sibling\\foo.ts', 'D:\\proj\\src')).toBe('D:\\proj\\sibling\\foo.ts');
  });

  it('a relative path with no base is the text as written', () => {
    expect(linkReadoutTarget('src/foo.ts', null)).toBe('src/foo.ts');
    expect(linkReadoutTarget('src/foo.ts', undefined)).toBe('src/foo.ts');
    expect(linkReadoutTarget('src/foo.ts', '')).toBe('src/foo.ts');
  });

  it('a relative path that climbs above the base’s root falls back to the text as written', () => {
    expect(linkReadoutTarget('..\\..\\..\\out.txt', 'D:\\proj')).toBe('..\\..\\..\\out.txt');
  });

  it('follows the base’s own separator style', () => {
    expect(linkReadoutTarget('src/foo.ts', '/home/user/proj')).toBe('/home/user/proj/src/foo.ts');
  });
});
