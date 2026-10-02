/**
 * 049 T033 — what counts as another occurrence of a selection (FR-015), and the one precedence rule
 * against search matches (FR-013, US3 scenario 2). Stated once here and called by both the editor and
 * the preview, so the two cannot disagree.
 */
import { describe, expect, it } from 'vitest';
import { Text } from '@codemirror/state';
import { isWordChar, occurrenceMatches, occurrenceQuery, withoutSearchMatches, type Match } from '@throng/core';

const doc = (...lines: string[]): Text => Text.of(lines);
/** The text each match covers, in order — the readable form of an assertion over offsets. */
const texts = (d: Text, ms: Match[]): string[] => ms.map((m) => d.sliceString(m.from, m.to));
/** The line text around a selection of `term` at the first index of `term` in `line`, as a query. */
const select = (line: string, term: string, at = line.indexOf(term)) => occurrenceQuery(line, at, at + term.length);

describe('isWordChar — letters, digits and underscore (FR-015)', () => {
  it('counts letters in any script, digits and underscore', () => {
    for (const ch of ['a', 'Z', 'é', 'ж', '字', '7', '_']) expect(isWordChar(ch)).toBe(true);
  });
  it('counts everything else as a boundary', () => {
    for (const ch of ['-', '.', ' ', '\t', '(', '/', '$', '"']) expect(isWordChar(ch)).toBe(false);
  });
});

describe('occurrenceQuery — which selections tint anything (FR-015)', () => {
  it('is null for an empty, whitespace-only or one-character selection', () => {
    expect(occurrenceQuery('a b', 1, 1)).toBeNull();
    expect(occurrenceQuery('a   b', 1, 4)).toBeNull();
    expect(occurrenceQuery('a b', 0, 1)).toBeNull();
  });

  it('is null for a selection spanning more than one line', () => {
    expect(occurrenceQuery('ab\ncd', 0, 4)).toBeNull();
  });

  it('is whole-word when the selection starts and ends at word boundaries', () => {
    expect(select('a id b', 'id')).toEqual({ term: 'id', wholeWord: true });
    expect(select('x=-id.', 'id')).toEqual({ term: 'id', wholeWord: true });
    expect(select('id', 'id')).toEqual({ term: 'id', wholeWord: true });
  });

  it('is literal when the selection is part of a word', () => {
    expect(select('width', 'id')).toEqual({ term: 'id', wholeWord: false });
    expect(select('a idx b', 'id')).toEqual({ term: 'id', wholeWord: false });
  });

  it('is literal when the selection itself starts or ends on a non-word character', () => {
    expect(select('a -id b', '-id')).toEqual({ term: '-id', wholeWord: false });
  });
});

describe('occurrenceMatches (FR-015)', () => {
  const d = doc('id width -id id. some-id-word', 'valid id_x ID Id', 'id');
  const sel = { from: 0, to: 2 }; // the first `id`

  it('with a whole-word `id` tints id, -id, id. and some-id-word, and not width, valid, id_x', () => {
    const ms = occurrenceMatches(d, { term: 'id', wholeWord: true }, sel);
    expect(texts(d, ms)).toEqual(['id', 'id', 'id', 'id']);
    const starts = ms.map((m) => m.from);
    const at = (needle: string, from = 0): number => d.toString().indexOf(needle, from);
    expect(starts).toEqual([at('-id') + 1, at('id.'), at('some-id') + 5, d.line(3).from]);
  });

  it('is case-sensitive', () => {
    const ms = occurrenceMatches(d, { term: 'id', wholeWord: true }, sel);
    expect(ms.some((m) => d.sliceString(m.from, m.to) !== 'id')).toBe(false);
  });

  it('with a literal query tints every literal occurrence, inside words too', () => {
    const d2 = doc('width valid idx');
    const ms = occurrenceMatches(d2, { term: 'id', wholeWord: false }, { from: 1, to: 3 });
    // `wIDth` (the selection, 1–3) excluded; `valID` at 9, `IDx` at 12.
    expect(ms.map((m) => m.from)).toEqual([9, 12]);
  });

  it('never includes the selection itself', () => {
    const ms = occurrenceMatches(d, { term: 'id', wholeWord: true }, sel);
    expect(ms.some((m) => m.from === sel.from && m.to === sel.to)).toBe(false);
  });

  it('gives the same answer over a plain string as over a Text (a preview text model)', () => {
    const q = { term: 'id', wholeWord: true };
    expect(occurrenceMatches(d.toString(), q, sel)).toEqual(occurrenceMatches(d, q, sel));
    const literal = { term: 'id', wholeWord: false };
    expect(occurrenceMatches(d.toString(), literal, sel)).toEqual(occurrenceMatches(d, literal, sel));
  });

  it('is bounded by `within` when given', () => {
    const line3 = d.line(3);
    const ms = occurrenceMatches(d, { term: 'id', wholeWord: true }, sel, [{ from: line3.from, to: line3.to }]);
    expect(ms).toEqual([{ from: line3.from, to: line3.from + 2 }]);
  });
});

describe('withoutSearchMatches — a search match wins (FR-013)', () => {
  it('drops every occurrence overlapping a search match and keeps the rest', () => {
    const occurrences: Match[] = [
      { from: 0, to: 2 },
      { from: 10, to: 12 },
      { from: 20, to: 22 },
      { from: 30, to: 32 },
    ];
    const search: Match[] = [
      { from: 10, to: 12 }, // identical
      { from: 21, to: 25 }, // overlapping
      { from: 32, to: 34 }, // touching only, so not overlapping
    ];
    expect(withoutSearchMatches(occurrences, search)).toEqual([
      { from: 0, to: 2 },
      { from: 30, to: 32 },
    ]);
  });

  it('with no search matches keeps every occurrence', () => {
    const occurrences: Match[] = [{ from: 1, to: 3 }];
    expect(withoutSearchMatches(occurrences, [])).toEqual(occurrences);
  });
});
