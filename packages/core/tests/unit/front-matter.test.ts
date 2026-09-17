import { describe, it, expect } from 'vitest';
import { splitFrontMatter } from '../../src/preview/front-matter.js';

/**
 * 044 T010 — recognising a YAML front matter block (FR-085, research R4).
 *
 * Only the split lives in core; parsing the YAML is the renderer's. What matters here is the exact
 * boundary — a `---` that is not on the first line is a horizontal rule, and an unclosed fence is not
 * front matter at all — and `bodyLineOffset`, without which every `data-source-line` anchor in the
 * body would be off by the height of the block (R11).
 */

describe('splitFrontMatter', () => {
  it('splits a block on line 1 closed by a later ---', () => {
    const text = '---\ntitle: Hello\ntags: [a, b]\n---\n# Heading\nBody\n';
    expect(splitFrontMatter(text)).toEqual({
      source: 'title: Hello\ntags: [a, b]',
      body: '# Heading\nBody\n',
      bodyLineOffset: 4,
    });
  });

  it('tolerates CRLF line endings', () => {
    const text = '---\r\ntitle: Hello\r\n---\r\n# Heading\r\n';
    expect(splitFrontMatter(text)).toEqual({
      source: 'title: Hello',
      body: '# Heading\r\n',
      bodyLineOffset: 3,
    });
  });

  it('tolerates trailing whitespace on both fences', () => {
    const text = '---  \ntitle: Hello\n--- \t\nBody';
    expect(splitFrontMatter(text)).toEqual({ source: 'title: Hello', body: 'Body', bodyLineOffset: 3 });
  });

  it('keeps the source’s own inner lines verbatim, blank lines and CRLF included', () => {
    const text = '---\r\na: 1\r\n\r\nb: |\r\n  x\r\n---\r\n';
    expect(splitFrontMatter(text)).toEqual({ source: 'a: 1\r\n\r\nb: |\r\n  x', body: '', bodyLineOffset: 6 });
  });

  it('an empty block is still front matter', () => {
    expect(splitFrontMatter('---\n---\nBody')).toEqual({ source: '', body: 'Body', bodyLineOffset: 2 });
  });

  it('closes at the FIRST later fence — a second block belongs to the body', () => {
    const text = '---\na: 1\n---\ntext\n---\nmore\n';
    expect(splitFrontMatter(text)).toEqual({ source: 'a: 1', body: 'text\n---\nmore\n', bodyLineOffset: 3 });
  });

  it('a closing fence at the very end of the text, with no newline, ends the block', () => {
    expect(splitFrontMatter('---\na: 1\n---')).toEqual({ source: 'a: 1', body: '', bodyLineOffset: 3 });
  });

  it('tolerates a leading byte-order mark', () => {
    // Built from its code point so the source file carries no invisible character.
    const BOM = String.fromCharCode(0xfeff);
    expect(splitFrontMatter(`${BOM}---\na: 1\n---\nBody`)).toEqual({ source: 'a: 1', body: 'Body', bodyLineOffset: 3 });
  });

  describe('is NOT front matter', () => {
    it.each([
      ['--- on line 2', '\n---\na: 1\n---\nBody'],
      ['an unclosed fence', '---\na: 1\nBody\n'],
      ['a fence of four dashes', '----\na: 1\n----\nBody'],
      ['a fence with trailing text', '--- yaml\na: 1\n---\nBody'],
      ['an indented opening fence', ' ---\na: 1\n---\nBody'],
      ['an opening fence alone', '---'],
      ['an empty document', ''],
      ['plain Markdown', '# Title\n\n---\n\ntext'],
    ])('%s', (_name, text) => {
      expect(splitFrontMatter(text)).toEqual({ source: null, body: text, bodyLineOffset: 0 });
    });

    it('an indented closing fence does not close the block', () => {
      const text = '---\na: 1\n  ---\nBody';
      expect(splitFrontMatter(text)).toEqual({ source: null, body: text, bodyLineOffset: 0 });
    });
  });
});
