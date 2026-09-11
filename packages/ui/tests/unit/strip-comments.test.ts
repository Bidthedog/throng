import { describe, expect, it } from 'vitest';
import { stripComments } from './helpers/strip-comments.js';

/**
 * #379 — the comment-stripping the source guards scan through.
 *
 * ══ WHAT IS ACTUALLY AT RISK HERE ══
 *
 * Two failure directions, and they are not symmetrical.
 *
 * Stripping too LITTLE is the papercut this was written for: a guard that scans raw text cannot
 * tell a usage from a sentence about one, so documenting the guard's own subject fails the build.
 * Annoying, visible, and it costs a comment.
 *
 * Stripping too MUCH is the one that matters. A stripper that treats a `//` inside a string literal
 * as the start of a comment deletes the rest of that line — real code — and the guard then passes
 * over source it is no longer reading, silently. That is a guard turning into decoration, which is
 * strictly worse than the papercut.
 *
 * So the cases below are weighted accordingly: one for each thing that must be removed, and a
 * deliberate battery for every context in which a `/` must NOT be read as a comment.
 */

/** `stripComments` keeps the code and drops the prose. */
describe('comments are removed', () => {
  it('a block comment goes, and the code around it stays', () => {
    expect(stripComments('const a = 1; /* gone */ const b = 2;')).toBe(
      'const a = 1;  const b = 2;',
    );
  });

  it('a JSDoc block goes', () => {
    const src = ['/**', ' * Documentation.', ' */', 'export const a = 1;'].join('\n');
    expect(stripComments(src).trim()).toBe('export const a = 1;');
  });

  it('a line comment goes, up to the newline and no further', () => {
    const src = ['const a = 1; // gone', 'const b = 2;'].join('\n');
    expect(stripComments(src)).toBe(['const a = 1; ', 'const b = 2;'].join('\n'));
  });

  it('a quote inside a comment does not open a string literal', () => {
    /*
     * The apostrophe trap. If `don't` opened a string, everything up to the next `'` in the file
     * would be swallowed as string content — including any comment inside it, which would then be
     * scanned as code.
     */
    const src = ["// it doesn't open a string", "const a = 'x';"].join('\n');
    expect(stripComments(src)).toBe(['', "const a = 'x';"].join('\n'));
  });

  it('line numbers still line up — a stripped block keeps its newlines', () => {
    const src = ['const a = 1;', '/* one', ' * two', ' */', 'const b = 2;'].join('\n');
    expect(stripComments(src).split('\n')).toHaveLength(5);
    expect(stripComments(src).split('\n')[4]).toBe('const b = 2;');
  });
});

/**
 * Everything that is NOT a comment survives verbatim.
 *
 * Each case pairs the hazardous literal with a trailing statement, because the damage a
 * mis-detected comment does is to the REST OF THE LINE — asserting only that the literal survived
 * would miss exactly the loss that matters.
 */
describe('a slash inside a literal is not a comment', () => {
  it('a double-quoted URL', () => {
    const src = 'const u = "https://example.com/x"; const after = 1;';
    expect(stripComments(src)).toBe(src);
  });

  it('a single-quoted UNC path', () => {
    const src = "const p = '//server/share'; const after = 1;";
    expect(stripComments(src)).toBe(src);
  });

  it('a template literal', () => {
    const src = 'const u = `https://example.com`; const after = 1;';
    expect(stripComments(src)).toBe(src);
  });

  it('a block-comment opener inside a string', () => {
    const src = 'const s = "/* not a comment */"; const after = 1;';
    expect(stripComments(src)).toBe(src);
  });

  it('an escaped quote does not end the string early', () => {
    const src = 'const s = "a \\" // b"; const after = 1;';
    expect(stripComments(src)).toBe(src);
  });

  it('a regex literal that matches a double slash', () => {
    // `/\/\//` is an ordinary path-separator pattern and contains a literal `//`. A naive stripper
    // eats the rest of the line from inside it.
    const src = 'const re = /\\/\\//; const after = 1;';
    expect(stripComments(src)).toBe(src);
  });

  it('a comment INSIDE a template interpolation is still stripped', () => {
    const src = 'const s = `a${/* gone */ b}c`;';
    expect(stripComments(src)).toBe('const s = `a${ b}c`;');
  });

  it('a string inside a template interpolation is left alone', () => {
    const src = 'const s = `a${x ? "//y" : z}b`; const after = 1;';
    expect(stripComments(src)).toBe(src);
  });

  it('a division that looks like the start of a regex costs one character, not the line', () => {
    /*
     * `{` is one of the positions where a `/` legitimately opens a regex, so `{width / 2}` is
     * ambiguous on its face. The stripper resolves it by requiring a literal to close on its own
     * line — so a mis-read degrades to emitting the `/` verbatim rather than swallowing what
     * follows it, which is the only direction that could hide a real finding.
     */
    const src = 'const style = { width: width / 2 }; const after = 1;';
    expect(stripComments(src)).toBe(src);
  });
});

/**
 * The case the issue was actually filed for, stated in the guard's own terms.
 *
 * `icon-tokens-exist` matches `<Icon … token="…">`. A comment writing that form out must not be a
 * finding; the element itself must still be one.
 */
describe('the icon-token guard sees elements and not prose (#379)', () => {
  const ICON_ATTRIBUTE = /<Icon\b[^>]*?\btoken="([^"]+)"/g;
  const tokensIn = (src: string): string[] =>
    [...stripComments(src).matchAll(ICON_ATTRIBUTE)].map((m) => m[1]!);

  it('a comment describing the attribute form yields no token', () => {
    const src = [
      '/**',
      ' * Each control writes its own `<Icon token="…" />` inline, as a literal, because that is',
      ' * the exact form `icon-tokens-exist` matches.',
      ' */',
      'const GROUPINGS = [];',
    ].join('\n');
    expect(tokensIn(src)).toEqual([]);
  });

  it('a real element still yields its token — including one beside such a comment', () => {
    const src = [
      '// Explaining <Icon token="prose-only" /> must not count.',
      'const el = <Icon token="replace" />;',
    ].join('\n');
    expect(tokensIn(src)).toEqual(['replace']);
  });

  it('an element on the same line as a string containing a slash is still found', () => {
    // The regression the "strip too much" direction would cause: the guard quietly stops seeing
    // usages rather than reporting a wrong one.
    const src = 'const el = <Icon title="a//b" token="replace" />;';
    expect(tokensIn(src)).toEqual(['replace']);
  });
});
