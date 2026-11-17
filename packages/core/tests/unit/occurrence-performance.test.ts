/**
 * 049 T035 — Principle XII "Measured, not assumed": occurrence tinting runs on every selection change, so
 * its cost is measured on a representative large input (SC-005: a 10,000-line document, tints on screen
 * within 100 ms). The budgets sit far inside 100 ms, are measured in CPU time so a busy machine does not
 * flake them (see `cpuMsPerRun`), and the measured times are logged for the PR.
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

/**
 * The work's cost in this thread's CPU time, as a mean over enough runs to use at least `minTotalMs` of it.
 *
 * Wall time measured the machine, not the code: in a full parallel suite, or with every core busy, a
 * 2.9 ms scan read 21.6-26.1 ms (best of five) and failed a 20 ms budget it clears sevenfold. Thread
 * CPU time does not count the time the scheduler kept the thread waiting. Windows reports it in clock
 * ticks (about 15.6 ms), so one run cannot be timed alone; a total of 200 ms keeps that within 8%.
 * Node before 23.9 has no `threadCpuUsage`, and there it falls back to wall time.
 */
function cpuMsPerRun(fn: (i: number) => void, minTotalMs = 200): number {
  const now = (): number => {
    const u = typeof process.threadCpuUsage === 'function' ? process.threadCpuUsage() : null;
    return u ? (u.user + u.system) / 1000 : performance.now();
  };
  fn(0); // warm
  const start = now();
  let runs = 0;
  do fn(++runs);
  while (now() - start < minTotalMs);
  return (now() - start) / runs;
}

describe('occurrence tinting cost on 10,000 lines (SC-005, Principle XII)', () => {
  it('a whole-document scan, with search-match precedence, stays well inside 100 ms', () => {
    const search = editorMatches(doc, 'lookup', { caseSensitive: false, wholeWord: false });
    let found = 0;
    const ms = cpuMsPerRun(() => {
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
    const ms = cpuMsPerRun(() => {
      found = occurrenceMatches(doc, query, selection, visible).length;
    });
    console.info(`[049 T035] visible range: ${found} occurrences in ${ms.toFixed(2)} ms`);
    expect(found).toBeGreaterThan(0);
    expect(ms).toBeLessThan(5);
  });
});
