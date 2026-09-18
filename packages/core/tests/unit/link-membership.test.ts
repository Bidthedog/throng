import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { isLinkInProject } from '../../src/links/resolve.js';

/**
 * 045 M1–M6 — `contracts/link-resolution.md` §3, FR-021.
 *
 * The rule the whole feature's safety rests on: FR-055 forbids an editor or a preview from opening
 * anything outside the owning project, and `inProject` is the only thing standing between a link
 * and that. So the cases below are about the two ways it can be got wrong — judging the text
 * instead of the resolved location (M1/M2), and writing a fourth normaliser that disagrees with the
 * three the repo already has (M6).
 */

const ROOT = 'C:\\throng';

describe('isLinkInProject — M1/M2: the verdict is about the LOCATION, not the spelling', () => {
  it('M1: a resolved path inside the root is in the project', () => {
    expect(isLinkInProject('C:\\throng\\test.txt', ROOT)).toBe(true);
    expect(isLinkInProject('C:\\throng\\packages\\core\\src\\x.ts', ROOT)).toBe(true);
  });

  it('M1: a resolved path outside the root is not', () => {
    expect(isLinkInProject('C:\\elsewhere\\test.txt', ROOT)).toBe(false);
    expect(isLinkInProject('D:\\throng\\test.txt', ROOT)).toBe(false);
  });

  it('M1: a sibling whose name merely STARTS with the root is not inside it', () => {
    expect(isLinkInProject('C:\\throng-old\\test.txt', ROOT)).toBe(false);
  });

  it('M2 / US1 scenario 3: all five spellings of one file give one verdict', () => {
    // What each spelling RESOLVES to (link-resolve.test.ts owns the resolution itself). The verdict
    // is taken from the resolved location, so every one of them must agree.
    const resolved = [
      'C:\\throng\\test.txt',
      'C:/throng/test.txt',
      'c:\\THRONG\\test.txt',
      'C:\\throng\\.\\test.txt'.replace('\\.\\', '\\'),
      'C:/throng\\test.txt',
    ];
    expect(resolved.map((p) => isLinkInProject(p, ROOT))).toEqual([true, true, true, true, true]);
  });

  it('M2: the root may itself be spelled either way', () => {
    expect(isLinkInProject('C:\\throng\\test.txt', 'C:/throng')).toBe(true);
    expect(isLinkInProject('C:/throng/test.txt', 'C:\\throng')).toBe(true);
  });

  it('the root itself counts as inside the project', () => {
    expect(isLinkInProject(ROOT, ROOT)).toBe(true);
  });
});

describe('isLinkInProject — M3: a panel with no project judges everything outside', () => {
  it('a null root makes every target outside', () => {
    expect(isLinkInProject('C:\\throng\\test.txt', null)).toBe(false);
    expect(isLinkInProject('C:\\anything', null)).toBe(false);
  });

  it('an empty root is treated as no root, not as a root everything is under', () => {
    expect(isLinkInProject('C:\\throng\\test.txt', '')).toBe(false);
  });
});

describe('isLinkInProject — M4: a sub-workspace panel judges against its ORIGINAL project', () => {
  it('the caller supplies the root, so a sub-workspace passes originProjectId\u2019s root', () => {
    // Principle XI: a sub-workspace is a view, not a second source of truth. The rule here is that
    // whatever root is handed in is the one used — there is no second root hidden inside.
    const originRoot = 'C:\\throng';
    const otherRoot = 'C:\\other';
    expect(isLinkInProject('C:\\throng\\src\\x.ts', originRoot)).toBe(true);
    expect(isLinkInProject('C:\\throng\\src\\x.ts', otherRoot)).toBe(false);
  });
});

describe('isLinkInProject — M5: a symlink is judged on the location it NAMES', () => {
  it('no realpath is consulted — the named location decides', () => {
    // `C:\throng\link` may be a junction to `D:\elsewhere`; this rule is about strings and cannot
    // know that, which is exactly M5's requirement rather than a limitation of it.
    expect(isLinkInProject('C:\\throng\\link\\deep\\x.ts', ROOT)).toBe(true);
    expect(isLinkInProject('D:\\elsewhere\\deep\\x.ts', ROOT)).toBe(false);
  });

  it('a path that needs traversing to evaluate is refused rather than guessed', () => {
    expect(isLinkInProject('C:\\throng\\..\\Windows\\System32\\x.dll', ROOT)).toBe(false);
  });
});

describe('isLinkInProject — M6: the comparison is isUnderPath, and no new normaliser is written', () => {
  const source = readFileSync(
    fileURLToPath(new URL('../../src/links/resolve.ts', import.meta.url)),
    'utf8',
  );

  it('resolve.ts imports isUnderPath from fs/path-id', () => {
    expect(source).toMatch(/import\s*\{[^}]*isUnderPath[^}]*\}\s*from\s*'\.\.\/fs\/path-id\.js'/);
  });

  it('resolve.ts defines no case-folding or separator-folding normaliser of its own', () => {
    // `path-id.ts`'s own docstring records three near-copies of this comparison already in the
    // codebase. A fourth here is the DRY violation that file exists to warn about.
    expect(source).not.toMatch(/toLowerCase\s*\(\s*\)/);
    expect(source).not.toMatch(/function\s+normalise/i);
  });
});
