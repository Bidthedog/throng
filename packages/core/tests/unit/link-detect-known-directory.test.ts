import { describe, expect, it } from 'vitest';
import { detectPathSpans } from '../../src/links/detect.js';
import { MAX_PATH_SPACE_WORDS } from '../../src/links/limits.js';

/**
 * 045 round five — `DetectOptions.namesKnownDirectory`, the ONE thing the space rule may be told.
 *
 * The reported bug is that a prompt whose folder has a space in it loses its last word:
 * `PS D:\git\throng_tests\test 1>` drew `…\test`. The 92-case table in `link-detect-spaces.test.ts`
 * is the maintainer's own answer about what the TEXT alone may mean, and it is untouched here — the
 * first case below is the same line with no predicate, and it still stops at the space.
 *
 * What changes is that a caller holding the shell's working directory may say so. The predicate is
 * the caller's because only the renderer knows about drive letters and mount forms (Principle II);
 * this file drives it with a plain, deliberately dumb one so the GRAMMAR's half is what is under
 * test. The flavour normalisation that makes `/d/git/…` and `D:\git\…` one directory is the
 * renderer's, and `terminal-link-prompt-cwd.test.ts` covers it.
 */

/** The dumb predicate: the text, folded to one separator and lower-cased, names `cwd` or an ancestor. */
function within(cwd: string): (text: string) => boolean {
  const fold = (s: string): string => s.replace(/[\\/]+/g, '/').toLowerCase();
  const target = fold(cwd);
  return (text) => {
    const candidate = fold(text);
    return candidate === target || target.startsWith(`${candidate}/`);
  };
}

const CWD = String.raw`D:\git\throng_tests\test 1`;

describe('the space rule with no predicate is exactly the case table', () => {
  it('a prompt stops at the space, as FR-173 says it must', () => {
    expect(detectPathSpans(String.raw`PS D:\git\throng_tests\test 1>`)).toEqual([
      String.raw`D:\git\throng_tests\test`,
    ]);
  });
});

describe('round five — a span that lands on the known directory may cross the space', () => {
  const spans = (line: string, cwd = CWD): string[] =>
    detectPathSpans(line, { namesKnownDirectory: within(cwd) });

  it('the PowerShell prompt — the trailing `>` is trimmed before the comparison', () => {
    expect(spans(String.raw`PS D:\git\throng_tests\test 1>`)).toEqual([CWD]);
  });

  it('the cmd prompt', () => {
    expect(spans(String.raw`D:\git\throng_tests\test 1>`)).toEqual([CWD]);
  });

  it('a header that prints the directory as ordinary text — any span, not only a prompt', () => {
    expect(spans(`cwd: ${CWD}`)).toEqual([CWD]);
  });

  it('an ancestor of the directory extends too, at a separator boundary', () => {
    expect(spans(String.raw`D:\git\my project`, String.raw`D:\git\my project\src`)).toEqual([
      String.raw`D:\git\my project`,
    ]);
  });

  it('but a sibling that merely shares a string prefix does not', () => {
    // `D:\a\test` is a raw prefix of `D:\a\tester`, and extending on that would make prose noisier.
    expect(spans(String.raw`D:\a\test er`, String.raw`D:\a\tester`)).toEqual([String.raw`D:\a\test`]);
  });

  it('the LONGEST landing wins, so a two-word folder is not cut at its first word', () => {
    const cwd = String.raw`D:\git\my test 1`;
    expect(spans(String.raw`PS D:\git\my test 1>`, cwd)).toEqual([cwd]);
  });

  it('a terminator still wins outright, so the case table keeps its answers', () => {
    // `.md` ends the scan at `1\test.md` exactly as it did before, though `…\test 1` names the cwd.
    expect(spans(String.raw`D:\git\throng_tests\test 1\test.md`)).toEqual([
      String.raw`D:\git\throng_tests\test 1\test.md`,
    ]);
  });

  it('prose never matches a directory, so nothing else on the line moves', () => {
    expect(spans(String.raw`see D:\notes and 60/40 and e.g. this`, String.raw`D:\notes x`)).toEqual([
      String.raw`D:\notes`,
    ]);
  });

  it('the extension is bounded by MAX_PATH_SPACE_WORDS like every other scan', () => {
    const deep = String.raw`D:\a b c d e f g`;
    expect(deep.split(' ').length).toBeGreaterThan(MAX_PATH_SPACE_WORDS);
    // The cap is reached before the last word, so the span is the default one.
    expect(spans(`${deep}>`, deep)).toEqual([String.raw`D:\a`]);
  });

  it('a predicate that answers for nothing leaves detection exactly as it was', () => {
    expect(detectPathSpans(String.raw`PS D:\git\throng_tests\test 1>`, { namesKnownDirectory: () => false })).toEqual(
      [String.raw`D:\git\throng_tests\test`],
    );
  });
});
