import { describe, it, expect } from 'vitest';
import { matches, matchSpans } from '../../src/picker/match.js';

// 031 US3 (contracts/tab-strip.md §5, K4–K7, K10; spec FR-028c): what counts as a
// match in the typeahead picker. The query splits on whitespace into terms, and an
// entry matches when EVERY term appears as a case-insensitive substring somewhere in
// the text, in ANY order. Not fuzzy, not a subsequence, not a ranking.

describe('matches — the spec\u2019s three worked examples (K4)', () => {
  it("matches 'file find.txt' against 'find file'", () => {
    expect(matches('file find.txt', 'find file')).toBe(true);
  });

  it("matches 'find any file.md' against 'find file'", () => {
    expect(matches('find any file.md', 'find file')).toBe(true);
  });

  it("matches 'prefix file any find.pdf' against 'find file'", () => {
    expect(matches('prefix file any find.pdf', 'find file')).toBe(true);
  });
});

describe('matches — every term must be present (FR-028c)', () => {
  it('rejects a text that is missing one of the terms', () => {
    expect(matches('file.txt', 'find file')).toBe(false);
    expect(matches('find.txt', 'find file')).toBe(false);
  });

  it('accepts a single term as a plain substring', () => {
    expect(matches('build output', 'out')).toBe(true);
    expect(matches('build output', 'input')).toBe(false);
  });

  it('is order-independent for terms that overlap in the text', () => {
    expect(matches('abc', 'c a')).toBe(true);
    expect(matches('abc', 'a c')).toBe(true);
  });

  it('ignores repeated whitespace between terms', () => {
    expect(matches('find any file.md', '  find \t file  ')).toBe(true);
  });

  it('is not a subsequence match — the term must appear contiguously', () => {
    expect(matches('f-i-l-e', 'file')).toBe(false);
  });

  it('treats regular-expression punctuation in a term as literal text', () => {
    expect(matches('a+b', 'a+')).toBe(true);
    expect(matches('ab', 'a+')).toBe(false);
    expect(matches('main.ts', '.ts')).toBe(true);
    expect(matches('maints', '.ts')).toBe(false);
  });
});

describe('matches — case insensitivity (K5)', () => {
  it('ignores the case of the text', () => {
    expect(matches('FILE Find.TXT', 'find file')).toBe(true);
  });

  it('ignores the case of the query', () => {
    expect(matches('file find.txt', 'FIND FILE')).toBe(true);
  });

  it('ignores case in both at once', () => {
    expect(matches('Build Output', 'oUtPuT bUiLd')).toBe(true);
  });
});

describe('matches — an empty query matches everything (K6)', () => {
  it('matches on an empty query', () => {
    expect(matches('anything at all', '')).toBe(true);
  });

  it('matches on a query of only whitespace', () => {
    expect(matches('anything at all', '   ')).toBe(true);
    expect(matches('anything at all', '\t\n ')).toBe(true);
  });

  it('matches an empty text on an empty query', () => {
    expect(matches('', '')).toBe(true);
  });

  it('does not match an empty text on a real query', () => {
    expect(matches('', 'find')).toBe(false);
  });
});

describe('matches — terms match across separators (K7)', () => {
  it("matches 'src/find/file.ts' against 'find file' — what makes the control reusable for paths", () => {
    expect(matches('src/find/file.ts', 'find file')).toBe(true);
  });

  it('matches a term that spans a separator', () => {
    expect(matches('src/find/file.ts', 'find/file')).toBe(true);
    expect(matches('C:\\repo\\src\\main.ts', 'repo\\src')).toBe(true);
  });

  it('matches across a separator in either order', () => {
    expect(matches('src/find/file.ts', 'file src')).toBe(true);
  });
});

describe('matchSpans (K10)', () => {
  it('returns one span per matched term, in text order', () => {
    expect(matchSpans('file find.txt', 'find file')).toEqual([
      { start: 0, end: 4 },
      { start: 5, end: 9 },
    ]);
  });

  it('returns a span for each of three terms', () => {
    // 'prefix file any find.pdf': file at 7, any at 12, find at 16.
    expect(matchSpans('prefix file any find.pdf', 'find any file')).toEqual([
      { start: 7, end: 11 },
      { start: 12, end: 15 },
      { start: 16, end: 20 },
    ]);
  });

  it('returns spans over a path', () => {
    expect(matchSpans('src/find/file.ts', 'find file')).toEqual([
      { start: 4, end: 8 },
      { start: 9, end: 13 },
    ]);
  });

  it('indexes the original text, whatever the case', () => {
    expect(matchSpans('FILE find.txt', 'file')).toEqual([{ start: 0, end: 4 }]);
    expect(matchSpans('Build Output', 'output')).toEqual([{ start: 6, end: 12 }]);
  });

  it('returns no spans for an empty or whitespace-only query', () => {
    expect(matchSpans('file find.txt', '')).toEqual([]);
    expect(matchSpans('file find.txt', '   ')).toEqual([]);
  });

  it('returns no spans when the text does not match', () => {
    expect(matchSpans('file.txt', 'find file')).toEqual([]);
  });

  it('merges terms that land on the same run of text, so no character is marked twice', () => {
    expect(matchSpans('file.txt', 'file file')).toEqual([{ start: 0, end: 4 }]);
    expect(matchSpans('abc', 'ab bc')).toEqual([{ start: 0, end: 3 }]);
  });

  it('marks only what the terms cover', () => {
    const spans = matchSpans('find any file.md', 'find file');
    expect(spans.map((s) => 'find any file.md'.slice(s.start, s.end))).toEqual(['find', 'file']);
  });
});
