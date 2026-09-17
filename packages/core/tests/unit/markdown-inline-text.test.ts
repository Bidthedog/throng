import { describe, expect, it } from 'vitest';
import { markdownInlineText } from '../../src/preview/providers/markdown/inline-text.js';

/**
 * 044 T178 — a heading's RENDERED text, read off its source line (FR-090b, FR-090f).
 *
 * The preview reads this from markdown-it's inline tokens; core has no parser, and the editor's heading
 * reveal (`heading-line.ts`, FR-090d) has only the line. The two must land on the same slug, so this
 * resolves exactly the constructs that change a heading's text and leaves everything else alone.
 */
describe('markdownInlineText', () => {
  it.each([
    ['plain text is returned unchanged', 'Getting started', 'Getting started'],
    ['an inline link keeps its text', '[Foo](bar.md) baz', 'Foo baz'],
    ['a link with a title', 'see [Foo](bar.md "T") now', 'see Foo now'],
    ['an image renders nothing', '![logo](logo.png) Title', ' Title'],
    ['an HTML anchor renders nothing', '<a name="install"></a>Install', 'Install'],
    ['an HTML element keeps the text inside it', 'a <em>b</em> c', 'a b c'],
    ['an autolink renders its URL', '<https://example.com/x>', 'https://example.com/x'],
    ['an email autolink renders its address', '<who@example.com>', 'who@example.com'],
    ['emphasis markers go', '_Note_ and __Strong__', 'Note and Strong'],
    ['an intraword underscore stays', 'snake_case_name', 'snake_case_name'],
    ['an unmatched underscore stays', '_lonely', '_lonely'],
    ['a code span keeps its content verbatim', '`code_span` stays', 'code_span stays'],
    ['a code span keeps its markers when unclosed', 'a ` b', 'a ` b'],
    ['a double-backtick span', 'a ``b ` c`` d', 'a b ` c d'],
    ['an escaped marker is a literal', '\\_literal\\_ and \\[x\\]', '_literal_ and [x]'],
    ['a named entity', 'A &amp; B', 'A & B'],
    ['a numeric entity', 'A &#38; B', 'A & B'],
    ['an unknown entity is left alone', 'A &nosuch; B', 'A &nosuch; B'],
    ['a stray bracket is a literal', 'a ] b [ c', 'a ] b [ c'],
    ['a reference link is left as written', '[Foo][ref]', '[Foo][ref]'],
    ['a bare less-than is a literal', 'a < b and c > d', 'a < b and c > d'],
    ['`*` and `~` are left to the slugger', '*Hello* ~~gone~~', '*Hello* ~~gone~~'],
  ])('%s', (_name, source, expected) => {
    expect(markdownInlineText(source)).toBe(expected);
  });

  /*
   * Adversarial review I2's bound, applied to this scanner: every one of these is a shape a naive
   * "find the matching X" loop turns quadratic. Measured well under the bound; the quadratic forms took
   * seconds.
   */
  describe('hostile input finishes within a bound', () => {
    const BOUND_MS = 2_000;

    it.each([
      ['100,000 unmatched brackets', '['.repeat(100_000)],
      ['100,000 unmatched less-thans', '<'.repeat(100_000)],
      ['100,000 backticks', '`'.repeat(100_000)],
      ['100,000 underscores', '_'.repeat(100_000)],
      ['100,000 ampersands', '&'.repeat(100_000)],
      ['a 100,000-space run', `a${' '.repeat(100_000)}b`],
      ['alternating link openings', '[x]('.repeat(25_000)],
    ])('%s', (_name, source) => {
      const started = performance.now();
      markdownInlineText(source);
      expect(performance.now() - started).toBeLessThan(BOUND_MS);
    }, 60_000);
  });
});
