/**
 * 049 T035 — Principle XII "Measured, not assumed": occurrence tinting runs on every selection change, so
 * its cost is measured on a representative large input (SC-005: a 10,000-line document, tints on screen
 * within 100 ms). The budgets sit far inside 100 ms so a slow CI runner does not flake, and the measured
 * times are logged for the PR.
 */
import { describe, expect, it } from 'vitest';
import { Text } from '@codemirror/state';
import { occurrenceMatches, withoutSearchMatches, editorMatches } from '@throng/core';

const LINES = 10_000;
// Every fifth line carries the selected word, so a whole-document scan finds 2,000 occurrences.
const lines = Array.from({ length: LINES }, (_, i) =>
  i % 5 === 0 ? `const value_${i} = lookup(id, rows[${i}]); // id ${i}` : `  return render(widthOf(row${i}), valid);`,
);
const doc = Text.of(lines);
const query = { term: 'id', wholeWord: true };
const selection = { from: doc.line(1).from + lines[0]!.indexOf('id,'), to: doc.line(1).from + lines[0]!.indexOf('id,') + 2 };

function time(fn: () => void, runs = 5): number {
  fn(); // warm
  let best = Infinity;
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    fn();
    best = Math.min(best, performance.now() - t0);
  }
  return best;
}

describe('occurrence tinting cost on 10,000 lines (SC-005, Principle XII)', () => {
  it('a whole-document scan, with search-match precedence, stays well inside 100 ms', () => {
    const search = editorMatches(doc, 'lookup', { caseSensitive: false, wholeWord: false });
    let found = 0;
    const ms = time(() => {
      found = withoutSearchMatches(occurrenceMatches(doc, query, selection), search).length;
    });
    console.info(`[049 T035] whole document: ${found} occurrences in ${ms.toFixed(1)} ms`);
    expect(found).toBeGreaterThanOrEqual(2000);
    expect(ms).toBeLessThan(20);
  });

  it('a 60-line visible range costs a small fraction of that', () => {
    const start = doc.line(5000).from;
    const visible = [{ from: start, to: doc.line(5060).to }];
    let found = 0;
    const ms = time(() => {
      found = occurrenceMatches(doc, query, selection, visible).length;
    });
    console.info(`[049 T035] visible range: ${found} occurrences in ${ms.toFixed(2)} ms`);
    expect(found).toBeGreaterThan(0);
    expect(ms).toBeLessThan(5);
  });
});
