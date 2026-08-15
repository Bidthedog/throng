import { describe, it, expect } from 'vitest';
import {
  DEFAULT_EXCLUDE_GLOBS,
  compileExcluder,
  hiddenPathGlobs,
  isExcluded,
} from '../../src/explorer/exclude.js';

/**
 * 033 FR-069a / FR-069c — the per-project hidden set, expressed as globs.
 *
 * ══ WHY THIS IS A GLOB CONVERSION AND NOT A `Set.has` ══
 *
 * The tree hides a folder by REMOVING ITS NODE, so everything beneath it disappears implicitly and
 * nobody ever had to think about descendants. The file index is FLAT: a `hidden.has(rel)` there
 * would hide `docs` — which is not even in the index, because the index holds files — and go on
 * listing `docs/guide.md`. The two mechanisms would then disagree about the same folder, which is
 * precisely the divergence FR-006 exists to forbid.
 *
 * Feeding the hidden set through the SAME `compileExcluder` as the globs is what makes FR-069c true
 * by construction rather than by care: there is one predicate, so there cannot be two answers.
 *
 * ══ WHY ESCAPING IS NOT A DETAIL ══
 *
 * A hidden path is a LITERAL. A glob is a pattern. A file the user genuinely named `a[1].ts` becomes
 * a character class the moment it is used as a pattern unhandled — and a character class matches
 * `a1.ts`, so hiding one file would hide a different one and leave the one the user picked visible.
 */
describe('hiddenPathGlobs (FR-069a)', () => {
  it('yields nothing for an empty hidden set', () => {
    expect(hiddenPathGlobs([])).toEqual([]);
  });

  it('emits the path itself and a descendant pattern for each entry', () => {
    expect(hiddenPathGlobs(['docs'])).toEqual(['docs', 'docs/**']);
  });

  it('a hidden FOLDER hides everything beneath it — the flat-index trap', () => {
    const excluded = compileExcluder([...hiddenPathGlobs(['docs'])]);
    expect(excluded('docs')).toBe(true);
    expect(excluded('docs/guide.md')).toBe(true);
    expect(excluded('docs/deep/nested/note.md')).toBe(true);
    // …and nothing that merely shares a prefix.
    expect(excluded('docs-archive/guide.md')).toBe(false);
    expect(excluded('src/docs.ts')).toBe(false);
  });

  it('a hidden FILE hides only itself', () => {
    const excluded = compileExcluder([...hiddenPathGlobs(['src/secret.ts'])]);
    expect(excluded('src/secret.ts')).toBe(true);
    expect(excluded('src/secret.ts.bak')).toBe(false);
    expect(excluded('src/other.ts')).toBe(false);
  });

  it('escapes glob metacharacters, so a literal name is matched literally', () => {
    const excluded = compileExcluder([...hiddenPathGlobs(['src/a[1].ts'])]);
    expect(excluded('src/a[1].ts'), 'the file the user actually hid').toBe(true);
    expect(excluded('src/a1.ts'), 'a character class would have swallowed this one').toBe(false);
  });

  it('escapes the other metacharacters a real file name can carry', () => {
    const names = ['src/what?.ts', 'src/star*.ts', 'src/{a,b}.ts', 'src/plus+one.ts', 'src/(x).ts'];
    const excluded = compileExcluder([...hiddenPathGlobs(names)]);
    for (const name of names) expect(excluded(name), name).toBe(true);
    // The neighbours each pattern would have caught unescaped.
    expect(excluded('src/whatX.ts')).toBe(false);
    expect(excluded('src/starANYTHING.ts')).toBe(false);
    expect(excluded('src/a.ts')).toBe(false);
    expect(excluded('src/plusone.ts')).toBe(false);
    expect(excluded('src/x.ts')).toBe(false);
  });

  it('the two mechanisms compose in ONE predicate (FR-069c)', () => {
    const excluded = compileExcluder([...DEFAULT_EXCLUDE_GLOBS, ...hiddenPathGlobs(['docs'])]);
    expect(excluded('.git'), 'a shipped glob').toBe(true);
    expect(excluded('node_modules'), 'a shipped glob (FR-070)').toBe(true);
    expect(excluded('docs/guide.md'), 'a hidden path').toBe(true);
    expect(excluded('src/app.ts')).toBe(false);
  });

  it('an empty hidden set changes nothing about the shipped globs', () => {
    const globs = [...DEFAULT_EXCLUDE_GLOBS, ...hiddenPathGlobs([])];
    expect(globs).toEqual([...DEFAULT_EXCLUDE_GLOBS]);
    expect(isExcluded('src/app.ts', globs)).toBe(false);
  });

  it('ignores entries that are empty or not strings, rather than excluding everything', () => {
    // A hidden set arrives from the daemon's JSON column. An empty string turned into a pattern
    // would compile to something that matches at the root, and the whole project would vanish.
    expect(hiddenPathGlobs(['', 'docs'])).toEqual(['docs', 'docs/**']);
    expect(hiddenPathGlobs([undefined as unknown as string, 'docs'])).toEqual(['docs', 'docs/**']);
  });

  it('normalises a leading slash and back-slash separators (#229)', () => {
    // Hidden paths are built by `joinRel` as root-relative POSIX, but this layer has been handed
    // both spellings before and the cost of tolerating them here is two replaces.
    const excluded = compileExcluder([...hiddenPathGlobs(['/docs', 'src\\vendor'])]);
    expect(excluded('docs/guide.md')).toBe(true);
    expect(excluded('src/vendor/lib.js')).toBe(true);
  });
});
