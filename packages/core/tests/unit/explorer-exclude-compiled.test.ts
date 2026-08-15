import { describe, it, expect, beforeEach, vi } from 'vitest';
import { isExcluded, compileExcluder, DEFAULT_EXCLUDE_GLOBS } from '../../src/explorer/exclude.js';

// 033 (contracts/file-index.md §1): `compileExcluder` is `isExcluded` with the picomatch
// compilation hoisted out of the per-path call. The walk asks the same question of tens of
// thousands of paths, so compiling the glob list once per LIST rather than once per PATH is
// the whole point — and the answer must not move by a single case.
//
// The picomatch module is wrapped (not replaced) so behaviour stays real while its
// compilations are counted; the equivalence table below is the one
// `packages/core/tests/unit/explorer-exclude.test.ts` already asserts, extended.

const spy = vi.hoisted(() => ({ compilations: 0 }));

vi.mock('picomatch', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const real = (actual.default ?? actual) as (...args: never[]) => unknown;
  const wrapped = (...args: never[]) => {
    spy.compilations += 1;
    return real(...args);
  };
  return { ...actual, default: wrapped };
});

beforeEach(() => {
  spy.compilations = 0;
});

/** [relPath, globs] — the shipped table, plus the cases the walk will actually meet. */
const TABLE: ReadonlyArray<readonly [relPath: string, globs: readonly string[]]> = [
  ['.git', DEFAULT_EXCLUDE_GLOBS],
  ['src/.git', DEFAULT_EXCLUDE_GLOBS],
  ['.DS_Store', DEFAULT_EXCLUDE_GLOBS],
  ['CVS', DEFAULT_EXCLUDE_GLOBS],
  ['.svn', DEFAULT_EXCLUDE_GLOBS],
  ['.hg', DEFAULT_EXCLUDE_GLOBS],
  ['Thumbs.db', DEFAULT_EXCLUDE_GLOBS],
  ['src/index.ts', DEFAULT_EXCLUDE_GLOBS],
  ['README.md', DEFAULT_EXCLUDE_GLOBS],
  ['.gitignore', DEFAULT_EXCLUDE_GLOBS],
  ['', DEFAULT_EXCLUDE_GLOBS],
  ['build.log', ['*.log']],
  ['notes.txt', ['*.log']],
  ['dist/app.js', ['**/dist/**']],
  ['dist', ['**/dist/**']],
  ['node_modules', ['**/node_modules']],
  ['src/node_modules', ['**/node_modules']],
  ['node_modules/pkg/index.js', ['**/node_modules']],
  ['.git', []],
  ['anything', []],
  ['deep/nested/path/to/file.ts', ['**/*.ts']],
  ['deep/nested/path/to/file.ts', ['**/*.md']],
];

describe('compileExcluder — identical answers to isExcluded', () => {
  it.each(TABLE)('compileExcluder(globs)(%j) === isExcluded(%j, globs)', (relPath, globs) => {
    expect(compileExcluder(globs)(relPath)).toBe(isExcluded(relPath, globs));
  });

  it('still hides the default-excluded dotted entries at any depth', () => {
    const excluded = compileExcluder(DEFAULT_EXCLUDE_GLOBS);
    expect(excluded('.git')).toBe(true);
    expect(excluded('src/.git')).toBe(true);
    expect(excluded('.DS_Store')).toBe(true);
    expect(excluded('CVS')).toBe(true);
  });

  it('still lets normal source files through', () => {
    const excluded = compileExcluder(DEFAULT_EXCLUDE_GLOBS);
    expect(excluded('src/index.ts')).toBe(false);
    expect(excluded('README.md')).toBe(false);
    expect(excluded('.gitignore')).toBe(false);
  });

  it('excludes nothing for an empty glob list, and never excludes the root itself', () => {
    expect(compileExcluder([])('.git')).toBe(false);
    expect(compileExcluder(DEFAULT_EXCLUDE_GLOBS)('')).toBe(false);
  });

  it('returns a reusable predicate — the same answer however many times it is asked', () => {
    const excluded = compileExcluder(['*.log']);
    for (let i = 0; i < 5; i += 1) {
      expect(excluded('build.log')).toBe(true);
      expect(excluded('notes.txt')).toBe(false);
    }
  });
});

describe('compileExcluder — picomatch is compiled once per glob LIST, not once per call', () => {
  it('compiles once however many paths the predicate is asked about', () => {
    const excluder = compileExcluder(DEFAULT_EXCLUDE_GLOBS);
    const compiledOnce = spy.compilations;
    for (let i = 0; i < 1000; i += 1) excluder(`src/module-${i}/index.ts`);
    expect(spy.compilations).toBe(compiledOnce);
    expect(compiledOnce).toBeLessThanOrEqual(1);
  });

  it('is dramatically cheaper than the per-call path — 1,000 paths, 1,000 compilations', () => {
    const excluder = compileExcluder(DEFAULT_EXCLUDE_GLOBS);
    spy.compilations = 0;
    for (let i = 0; i < 1000; i += 1) excluder(`src/module-${i}/index.ts`);
    const compiled = spy.compilations;

    spy.compilations = 0;
    for (let i = 0; i < 1000; i += 1) isExcluded(`src/module-${i}/index.ts`, DEFAULT_EXCLUDE_GLOBS);
    const perCall = spy.compilations;

    expect(compiled).toBe(0);
    expect(perCall).toBeGreaterThan(compiled);
  });

  it('compiles nothing at all for an empty glob list', () => {
    spy.compilations = 0;
    const excluder = compileExcluder([]);
    for (let i = 0; i < 100; i += 1) excluder(`file-${i}.ts`);
    expect(spy.compilations).toBe(0);
  });
});
