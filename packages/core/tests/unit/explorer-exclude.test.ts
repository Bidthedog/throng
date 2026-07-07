import { describe, it, expect } from 'vitest';
import { isExcluded, DEFAULT_EXCLUDE_GLOBS } from '@throng/core';

describe('explorer exclude matching (004 T018/T021)', () => {
  it('hides default-excluded dotted entries at any depth', () => {
    expect(isExcluded('.git', DEFAULT_EXCLUDE_GLOBS)).toBe(true);
    expect(isExcluded('src/.git', DEFAULT_EXCLUDE_GLOBS)).toBe(true);
    expect(isExcluded('.DS_Store', DEFAULT_EXCLUDE_GLOBS)).toBe(true);
    expect(isExcluded('CVS', DEFAULT_EXCLUDE_GLOBS)).toBe(true);
  });

  it('does not hide normal source files', () => {
    expect(isExcluded('src/index.ts', DEFAULT_EXCLUDE_GLOBS)).toBe(false);
    expect(isExcluded('README.md', DEFAULT_EXCLUDE_GLOBS)).toBe(false);
    expect(isExcluded('.gitignore', DEFAULT_EXCLUDE_GLOBS)).toBe(false);
  });

  it('applies custom user globs', () => {
    expect(isExcluded('build.log', ['*.log'])).toBe(true);
    expect(isExcluded('notes.txt', ['*.log'])).toBe(false);
    expect(isExcluded('dist/app.js', ['**/dist/**'])).toBe(true);
  });

  it('excludes nothing for an empty list', () => {
    expect(isExcluded('.git', [])).toBe(false);
  });
});
