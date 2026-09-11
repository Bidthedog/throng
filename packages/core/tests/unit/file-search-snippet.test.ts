import { describe, expect, it } from 'vitest';
import { SNIPPET_CONTEXT_CHARS, snippetFor } from '@throng/core';

/**
 * 043 T008 / FR-036 — the snippet a result row shows.
 *
 * "the matched text highlighted, within a snippet of surrounding text extending to a nearby word
 * boundary on each side, with an ellipsis marking any side that was truncated."
 *
 * ══ THE TWO HALVES THAT ARE EASY TO GET BACKWARDS ══
 *
 * The ellipsis marks TRUNCATION, not context. A match near the start of its line has real context
 * before it and no ellipsis, because nothing was cut — and the tempting implementation, "show an
 * ellipsis whenever `before` is non-empty", gets that exactly wrong on every short line.
 *
 * And a word boundary is a boundary in BOTH directions: the snippet must not begin or end in the
 * middle of a word, so a truncated side lands on a boundary rather than on the character the
 * character budget happened to reach.
 */

const word = 'boundary';

describe('snippetFor (FR-036)', () => {
  it('returns the whole line, unmarked, when nothing was cut', () => {
    // `here` at columns 12-15 of a line far shorter than the context budget.
    expect(snippetFor('the needle is here', 4, 10)).toEqual({
      before: 'the ',
      matched: 'needle',
      after: ' is here',
      truncatedStart: false,
      truncatedEnd: false,
    });
  });

  it('splits the line exactly at the match', () => {
    const line = 'alpha beta gamma';
    const s = snippetFor(line, 6, 10);
    expect(s.matched).toBe('beta');
    expect(s.before + s.matched + s.after).toBe(line);
  });

  it('marks only the side that was actually truncated', () => {
    const long = `${word} `.repeat(40); // ~360 chars, far past the budget on both sides
    const mid = long.indexOf(word, 200);

    const both = snippetFor(long, mid, mid + word.length);
    expect(both.truncatedStart).toBe(true);
    expect(both.truncatedEnd).toBe(true);

    const atStart = snippetFor(long, 0, word.length);
    expect(atStart.truncatedStart).toBe(false);
    expect(atStart.truncatedEnd).toBe(true);

    const lastAt = long.lastIndexOf(word);
    const atEnd = snippetFor(long.trimEnd(), lastAt, lastAt + word.length);
    expect(atEnd.truncatedStart).toBe(true);
    expect(atEnd.truncatedEnd).toBe(false);
  });

  it('never begins or ends part-way through a word', () => {
    const long = `${word} `.repeat(40);
    const mid = long.indexOf(word, 200);
    const s = snippetFor(long, mid, mid + word.length);

    // A truncated side that landed mid-word would leave a fragment of `boundary` hanging off the
    // edge — the exact thing a character budget produces if it is not snapped to a boundary.
    expect(s.before.trimStart().startsWith(word)).toBe(true);
    expect(s.after.trimEnd().endsWith(word)).toBe(true);
  });

  it('keeps each side within the context budget', () => {
    const long = 'x'.repeat(500);
    const s = snippetFor(long, 250, 253);
    expect(s.before.length).toBeLessThanOrEqual(SNIPPET_CONTEXT_CHARS);
    expect(s.after.length).toBeLessThanOrEqual(SNIPPET_CONTEXT_CHARS);
    // An unbroken run of 500 characters has no boundary to snap to, and the snippet must still be
    // bounded rather than falling back to the whole line.
    expect(s.matched).toBe('xxx');
    expect(s.truncatedStart).toBe(true);
    expect(s.truncatedEnd).toBe(true);
  });

  it('handles a match that is the entire line', () => {
    expect(snippetFor('whole', 0, 5)).toEqual({
      before: '',
      matched: 'whole',
      after: '',
      truncatedStart: false,
      truncatedEnd: false,
    });
  });
});
