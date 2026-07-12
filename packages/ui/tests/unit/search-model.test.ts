/**
 * 013 — pure search model. Match finding (case / whole-word), wrap-around index
 * maths, the "N of M" count, and selection seeding. No DOM: CodeMirror's `Text`
 * and `SearchQuery` are pure JS, so the real matching semantics are covered here
 * rather than only in E2E.
 */
import { describe, expect, it } from 'vitest';
import { Text } from '@codemirror/state';
import {
  countOf,
  editorMatches,
  indexFrom,
  seedFrom,
  stepIndex,
  type MatchModes,
} from '../../src/renderer/search/search-model.js';

const PLAIN: MatchModes = { caseSensitive: false, wholeWord: false };
const doc = (...lines: string[]): Text => Text.of(lines);

describe('editorMatches', () => {
  it('finds every occurrence, case-insensitively by default', () => {
    const m = editorMatches(doc('foo Foo', 'FOO bar'), 'foo', PLAIN);
    expect(m).toHaveLength(3);
    expect(m[0]).toEqual({ from: 0, to: 3 });
  });

  it('honours the case-sensitive toggle', () => {
    const m = editorMatches(doc('foo Foo FOO'), 'foo', { ...PLAIN, caseSensitive: true });
    expect(m).toHaveLength(1);
  });

  it('honours the whole-word toggle', () => {
    const text = doc('foo food foo-bar');
    expect(editorMatches(text, 'foo', PLAIN)).toHaveLength(3); // substring: foo, foo(d), foo(-bar)
    expect(editorMatches(text, 'foo', { ...PLAIN, wholeWord: true })).toHaveLength(2); // foo, foo-bar
  });

  it('returns nothing for an empty term (no term ⇒ no search)', () => {
    expect(editorMatches(doc('anything'), '', PLAIN)).toEqual([]);
  });

  it('finds matches across lines at the right absolute offsets', () => {
    const m = editorMatches(doc('ab', 'ab'), 'ab', PLAIN);
    expect(m).toEqual([
      { from: 0, to: 2 },
      { from: 3, to: 5 }, // line 2 starts after the newline
    ]);
  });
});

describe('indexFrom (the match the caret lands on)', () => {
  const matches = [
    { from: 10, to: 13 },
    { from: 20, to: 23 },
  ];

  it('picks the first match at or after the caret', () => {
    expect(indexFrom(matches, 0)).toBe(0);
    expect(indexFrom(matches, 15)).toBe(1);
    expect(indexFrom(matches, 20)).toBe(1);
  });

  it('wraps to the first match when the caret is past the last one', () => {
    expect(indexFrom(matches, 999)).toBe(0);
  });

  it('is -1 when there is nothing to land on', () => {
    expect(indexFrom([], 5)).toBe(-1);
  });
});

describe('stepIndex (find next / previous wraps — FR-006/FR-011)', () => {
  it('advances and wraps at the end', () => {
    expect(stepIndex(0, 3, 1)).toBe(1);
    expect(stepIndex(2, 3, 1)).toBe(0);
  });

  it('retreats and wraps at the start', () => {
    expect(stepIndex(1, 3, -1)).toBe(0);
    expect(stepIndex(0, 3, -1)).toBe(2);
  });

  it('has nowhere to go with no matches', () => {
    expect(stepIndex(-1, 0, 1)).toBe(-1);
  });
});

describe('countOf ("3 of 12" — FR-002)', () => {
  it('reports a 1-based current index', () => {
    expect(countOf([{ from: 0, to: 1 }, { from: 2, to: 3 }], 1)).toEqual({ current: 2, total: 2 });
  });

  it('reports the no-results state (FR-009)', () => {
    expect(countOf([], -1)).toEqual({ current: 0, total: 0 });
  });
});

describe('seedFrom (FR-002b)', () => {
  it('seeds from a non-empty single-line selection', () => {
    expect(seedFrom('needle')).toBe('needle');
  });

  it('does not seed from an empty or multi-line selection', () => {
    expect(seedFrom('')).toBe('');
    expect(seedFrom('two\nlines')).toBe('');
    expect(seedFrom('two\r\nlines')).toBe('');
  });
});
