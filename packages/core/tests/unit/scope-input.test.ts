/**
 * 043 T243 (FR-092b) — what the scope box's text MEANS.
 *
 * The box used to be read verbatim. Three things a person can type went wrong, and each is pinned
 * here by the input that caused it:
 *
 *   - `src/` — a trailing separator was carried into the row prefix, so every row read `src//a.ts`.
 *   - `src\\renderer` — a backslash was carried into every row's path, which is not how this app
 *     spells a root-relative path anywhere else.
 *   - `D:/proj/src` — an absolute path was joined onto the root as if it were relative, producing
 *     `D:\proj\D:\proj\src`, which does not exist, so the panel said *Scope missing* about a folder
 *     that was right there.
 *
 * FR-092b's answer is one reading: root-relative or absolute-inside-the-project are the same scope,
 * and absolute-outside is FR-070's refusal. This function is that reading and nothing else — no file
 * system, no `window`, and the containment rules are FR-070's own (`isWithinRoot`,
 * `relPathUnderRoot`), so a typed path and a chosen folder cannot disagree about where the project
 * ends.
 */
import { describe, expect, it } from 'vitest';
import { readScopeInput } from '../../src/search/scope-input.js';

const ROOT = 'D:/proj';

const scope = (text: string): string | 'outside' => {
  const read = readScopeInput(ROOT, text);
  return read.kind === 'outside' ? 'outside' : read.subPath;
};

describe('the whole project', () => {
  it('is an empty box', () => {
    expect(scope('')).toBe('');
  });

  it('is a box holding only whitespace or a lone dot', () => {
    expect(scope('   ')).toBe('');
    expect(scope('.')).toBe('');
    expect(scope('./')).toBe('');
  });

  it('is the project root typed out in full, in any spelling Windows treats as the same folder', () => {
    expect(scope('D:/proj')).toBe('');
    expect(scope('d:\\PROJ\\')).toBe('');
  });
});

describe('a root-relative path', () => {
  it('is itself', () => {
    expect(scope('src/renderer')).toBe('src/renderer');
  });

  it('may name a FILE — FR-092, the reason this reading exists', () => {
    expect(scope('src/renderer/app.tsx')).toBe('src/renderer/app.tsx');
  });

  it('reads backslashes as the separator this app spells root-relative paths with', () => {
    expect(scope('src\\renderer\\app.tsx')).toBe('src/renderer/app.tsx');
  });

  it('ignores a trailing separator, which used to produce rows like src//a.ts', () => {
    expect(scope('src/')).toBe('src');
    expect(scope('src\\')).toBe('src');
  });

  it('ignores a leading ./ and collapses doubled separators', () => {
    expect(scope('./src//renderer')).toBe('src/renderer');
  });

  it('keeps the case the user typed — the rows are keyed on the real spelling', () => {
    expect(scope('Src/Renderer')).toBe('Src/Renderer');
  });
});

describe('an absolute path — a "full" path, FR-092b', () => {
  it('inside the project reads as its root-relative form', () => {
    expect(scope('D:/proj/src/renderer/app.tsx')).toBe('src/renderer/app.tsx');
  });

  it('matches the root case- and separator-insensitively, as Windows does', () => {
    expect(scope('d:\\Proj\\src\\app.tsx')).toBe('src/app.tsx');
  });

  it('keeps the spelling AFTER the root exactly as typed', () => {
    // `relPathUnderRoot` slices from the original string — lower-casing the result would name a
    // path the tree does not key anything on.
    expect(scope('d:/PROJ/Src/App.tsx')).toBe('Src/App.tsx');
  });

  it('outside the project is refused, not joined on to the root', () => {
    expect(scope('D:/elsewhere/src')).toBe('outside');
    expect(scope('C:\\Windows\\win.ini')).toBe('outside');
  });

  it('that merely shares a PREFIX with the root is outside — D:/project is not inside D:/proj', () => {
    expect(scope('D:/project/src')).toBe('outside');
  });

  it('starting with a separator is absolute, not root-relative', () => {
    expect(scope('/etc/hosts')).toBe('outside');
  });

  it('a bare drive root is absolute and outside — C:\\ used to lose its separator and read as relative', () => {
    /*
     * 043 T261, found by the closing converge. Stripping the trailing separator turned `C:\` into
     * `C:`, which the absolute test did not recognise, so it was taken as a RELATIVE path named
     * `C:`, sent to main, and reported as a scope that had gone — the wrong condition.
     */
    expect(scope('C:\\')).toBe('outside');
    expect(scope('C:')).toBe('outside');
  });

  it('an absolute path that climbs out through .. is refused, even when it starts inside the root', () => {
    // T261's other half: the `..` check used to run on relative paths only.
    expect(scope('D:\\proj\\..\\other')).toBe('outside');
    expect(scope('D:/proj/src/../../elsewhere')).toBe('outside');
  });
});

describe('a relative path that climbs out', () => {
  it('is refused rather than silently clamped to the root', () => {
    /*
     * Clamping would search somewhere the user did not name and say nothing about it. Refusing puts
     * FR-070's notice on the control, which tells them the path is outside the project — true, and
     * the only thing they need to know to fix it.
     */
    expect(scope('../other')).toBe('outside');
    expect(scope('src/../../other')).toBe('outside');
  });
});
