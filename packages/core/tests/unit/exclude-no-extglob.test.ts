/**
 * picomatch 4.0.7 — the newest release — builds a catastrophically backtracking regex from repeated extglobs
 * (GHSA-fc5q-39xc-vjpf, no patched version). throng's globs come from settings and the search box, and none of its
 * defaults is an extglob, so extglob parsing is switched off: `+(x)`, `@(x)`, `!(x)`, `*(x)` and `?(x)` are ordinary
 * text. Braces and `**` still work.
 *
 * Layer: unit — both compile sites are pure.
 */
import { describe, expect, it } from 'vitest';
import { compileExcluder } from '../../src/explorer/exclude.js';
import { parseExcludeBox } from '../../src/search/search-exclude.js';

describe('exclusion globs do not parse extglobs', () => {
  it('reads an extglob in the explorer exclusion list as literal text', () => {
    const excluded = compileExcluder(['+(a|b).log']);
    expect(excluded('a.log')).toBe(false);
    expect(excluded('+(a|b).log')).toBe(true);
  });

  it('still expands braces and globstars', () => {
    const excluded = compileExcluder(['**/*.{log,tmp}']);
    expect(excluded('deep/dir/x.tmp')).toBe(true);
    expect(excluded('deep/dir/x.ts')).toBe(false);
  });

  it('matches the hostile shape from the advisory in bounded time', () => {
    const hostile = `${'+(a)'.repeat(30)}b`;
    const excluded = compileExcluder([hostile]);
    const started = performance.now();
    expect(excluded('a'.repeat(40))).toBe(false);
    expect(performance.now() - started).toBeLessThan(250);
  });

  it('accepts an extglob in the search exclude box as a literal glob, not a compile error', () => {
    expect(parseExcludeBox('+(a|b).log')).toEqual({ globs: ['+(a|b).log'], invalid: [] });
  });
});
