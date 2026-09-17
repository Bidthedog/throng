import { describe, it, expect } from 'vitest';
import { markdownHeadingLine } from '../../src/preview/providers/markdown/heading-line.js';

/**
 * 044 FR-090d — the caret line the editor's heading reveal resolves a followed `other.md#heading`
 * link against. Moved out of `preview-links.test.ts` alongside `markdownHeadingLine` itself (fix
 * round 1, item 3): the grammar lives with the Markdown provider now, not in the shared preview
 * module every provider's links pass through.
 */

describe('markdownHeadingLine — the caret line for a fragment (FR-090d)', () => {
  const doc = [
    '---', //               1
    'title: Front', //      2
    '---', //               3
    '# Title', //           4
    'Intro text.', //       5
    '', //                  6
    '## Install', //        7
    '```ts', //             8
    '# not a heading', //   9
    '```', //              10
    '## Install ##', //    11
    'Setext Heading', //   12
    '==============', //   13
    '   ### Indented', //  14
    '    # code block', // 15
  ].join('\r\n');

  it.each([
    ['title', 4],
    ['Install', 7],
    ['install-1', 11],
    ['setext-heading', 12],
    ['indented', 14],
  ])('#%s is on line %i (1-based)', (fragment, line) => {
    expect(markdownHeadingLine(doc, fragment)).toBe(line);
  });

  it.each(['not-a-heading', 'code-block', 'front', 'missing', ''])('#%s names no heading', (fragment) => {
    expect(markdownHeadingLine(doc, fragment)).toBeNull();
  });

  /*
   * markdown-it renders a heading inside a block quote or a list item as a heading, and the rendered
   * preview slugs it. If this function skipped those, its de-duplication numbering would run one
   * behind the preview's from that point on, and `#install-1` would land on the wrong line.
   */
  describe('headings inside block quotes and list items count, in document order', () => {
    const nested = [
      '## Install', //               1
      '> ## Install', //             2
      '- ## Install', //             3
      '1. ## Install', //            4
      '> - ## Install', //           5
      '', //                         6
      '> Quoted Setext', //          7
      '> ===', //                    8
      '', //                         9
      '> ```', //                   10
      '> # fenced in a quote', //   11
      '> ```', //                   12
      '* ## Install', //            13
      '', //                        14
      '- item', //                  15
      '---', //                     16  a thematic break after a list, not a setext underline
      '## After', //                17
    ].join('\n');

    it.each([
      ['install', 1],
      ['install-1', 2],
      ['install-2', 3],
      ['install-3', 4],
      ['install-4', 5],
      ['quoted-setext', 7],
      ['install-5', 13],
      ['after', 17],
    ])('#%s is on line %i', (fragment, line) => {
      expect(markdownHeadingLine(nested, fragment)).toBe(line);
    });

    it.each(['fenced-in-a-quote', 'item'])('#%s names no heading', (fragment) => {
      expect(markdownHeadingLine(nested, fragment)).toBeNull();
    });
  });
});

/*
 * 044 T178 (FR-090b, FR-090f) — a heading is slugged from what the reader SEES. The preview slugs
 * markdown-it's inline tokens; this scanner reads the same text off the source line, or `#foo-baz` would
 * scroll the preview and leave the editor's caret on the wrong line.
 */
describe('a heading is slugged from its RENDERED text (T178)', () => {
  const doc = [
    '## [Foo](bar.md) baz', //                1
    '## <a name="install"></a>Install', //     2
    '## _Note_ and __Strong__', //             3
    '## `code_span` stays', //                 4
    '## snake_case_name', //                   5
    '## ![logo](logo.png) Title', //           6
    '## A &amp; B', //                         7
    '## \\_literal\\_', //                     8
    '## <https://example.com/x>', //           9
  ].join('\n');

  it.each([
    ['foo-baz', 1],
    ['install', 2],
    ['note-and-strong', 3],
    ['code_span-stays', 4],
    ['snake_case_name', 5],
    ['title', 6],
    ['a--b', 7],
    ['_literal_', 8],
    ['httpsexamplecomx', 9],
  ])('#%s is on line %i', (fragment, line) => {
    expect(markdownHeadingLine(doc, fragment)).toBe(line);
  });

  it.each(['foobarmd-baz', 'a-nameinstallainstall', 'logologopng-title', 'a-amp-b'])('#%s — the SOURCE spelling — names nothing', (fragment) => {
    expect(markdownHeadingLine(doc, fragment)).toBeNull();
  });

  it('de-duplicates on the rendered text, so two differently written headings collide', () => {
    const two = ['## Install', '## [Install](x.md)'].join('\n');
    expect(markdownHeadingLine(two, 'install')).toBe(1);
    expect(markdownHeadingLine(two, 'install-1')).toBe(2);
  });

  it('a setext heading is read the same way', () => {
    expect(markdownHeadingLine('[Getting](a.md) started\n===\n', 'getting-started')).toBe(1);
  });
});

describe('markdownHeadingLine on hostile input finishes within a bound (adversarial review I2 + hardening)', () => {
  // Measured: ≤ 85 ms after the fix, 10 s (the space run) and ~150 s (the headings) before it.
  const BOUND_MS = 2_000;

  function timed<T>(run: () => T): { value: T; ms: number } {
    const started = performance.now();
    const value = run();
    return { value, ms: performance.now() - started };
  }

  it('the closing sequence is still removed only when a space or tab precedes it', () => {
    const doc = ['# a # #', '# b#', '# c \t##  ', '#  #', '# ##d'].join('\n');
    expect(markdownHeadingLine(doc, 'a-')).toBe(1);
    expect(markdownHeadingLine(doc, 'b')).toBe(2);
    expect(markdownHeadingLine(doc, 'c')).toBe(3);
    // `#  #` is an empty heading; `# ##d` keeps `##d` as its text.
    expect(markdownHeadingLine(doc, 'd')).toBe(5);
  });

  it('a heading with a 100,000-space run that is not a closing sequence', () => {
    const doc = `# a${' '.repeat(100_000)}b\n\n# Target\n`;
    const { value, ms } = timed(() => markdownHeadingLine(doc, 'target'));
    expect(value).toBe(3);
    expect(ms).toBeLessThan(BOUND_MS);
  }, 60_000);

  it.each([
    ['empty', '#\n'],
    ['identical', '# a\n'],
  ])('50,000 %s headings, looking for one past them all', (_name, line) => {
    const doc = `${line.repeat(50_000)}# Target\n`;
    const { value, ms } = timed(() => markdownHeadingLine(doc, 'target'));
    expect(value).toBe(50_001);
    expect(ms).toBeLessThan(BOUND_MS);
  }, 120_000);
});
