import { describe, it, expect } from 'vitest';
// @ts-expect-error — a plain .mjs script with no type declarations; the shape is asserted below.
import { aggregate } from '../../../../scripts/e2e-durations.mjs';

/**
 * The per-file duration procedure (spec 034, SC-015).
 *
 * SC-015 exists because the suite's published timings had drifted to roughly half the truth — 24.7
 * minutes documented against 46.9 measured — and the reason they could drift is that nobody could
 * re-derive them. Replacing "read the scrollback and add up by eye" with a script only helps if the
 * script's arithmetic is right, so it is proven here rather than trusted.
 *
 * Each case below is a way the aggregation could be wrong while still producing a plausible table.
 */

interface Result {
  duration: number;
}
interface Test {
  results: Result[];
}
interface Spec {
  tests: Test[];
}
interface Suite {
  file?: string;
  specs?: Spec[];
  suites?: Suite[];
}

const test = (...durations: number[]): Test => ({ results: durations.map((d) => ({ duration: d })) });
const spec = (...tests: Test[]): Spec => ({ tests });

describe('per-file E2E durations', () => {
  it('sums every test in a file', () => {
    const report = { suites: [{ file: 'a.e2e.ts', specs: [spec(test(1000), test(2000))] }] };
    const { rows, totalMs, tests } = aggregate(report);
    expect(rows).toEqual([{ file: 'a.e2e.ts', ms: 3000, tests: 2 }]);
    expect(totalMs).toBe(3000);
    expect(tests).toBe(2);
  });

  it('counts retries, because the suite really paid for them', () => {
    // A file that passes on its second attempt costs both attempts. Reporting only the winning
    // attempt would make the flakiest files look like the cheapest — precisely backwards for a
    // number used to decide tier assignment.
    const report = { suites: [{ file: 'flaky.e2e.ts', specs: [spec(test(1000, 1200))] }] };
    const { rows, retried, tests } = aggregate(report);
    expect(rows[0].ms).toBe(2200);
    expect(rows[0].tests, 'a retried test is still ONE test').toBe(1);
    expect(retried).toBe(1);
    expect(tests).toBe(1);
  });

  it('finds tests nested inside describe blocks', () => {
    // The silent-halving bug: only the outermost suite carries `file`, so an implementation that
    // reads `suite.file` without inheriting it downward drops every test inside a describe. Most
    // specs in this repo use describe, so that would understate nearly the whole suite.
    const report: { suites: Suite[] } = {
      suites: [
        {
          file: 'nested.e2e.ts',
          specs: [spec(test(500))],
          suites: [
            { specs: [spec(test(1500))], suites: [{ specs: [spec(test(2000))] }] },
          ],
        },
      ],
    };
    const { rows, tests } = aggregate(report);
    expect(rows).toEqual([{ file: 'nested.e2e.ts', ms: 4000, tests: 3 }]);
    expect(tests).toBe(3);
  });

  it('sorts most expensive first', () => {
    const report = {
      suites: [
        { file: 'cheap.e2e.ts', specs: [spec(test(100))] },
        { file: 'dear.e2e.ts', specs: [spec(test(9000))] },
        { file: 'middling.e2e.ts', specs: [spec(test(3000))] },
      ],
    };
    expect(aggregate(report).rows.map((r) => r.file)).toEqual([
      'dear.e2e.ts',
      'middling.e2e.ts',
      'cheap.e2e.ts',
    ]);
  });

  it('reports nothing rather than zero for an empty report', () => {
    // The caller prints an error and exits non-zero on this; returning a plausible empty table
    // instead would read as "the suite costs nothing".
    expect(aggregate({ suites: [] })).toEqual({ rows: [], tests: 0, retried: 0, totalMs: 0 });
    expect(aggregate({})).toEqual({ rows: [], tests: 0, retried: 0, totalMs: 0 });
  });

  it('survives a test with no results at all', () => {
    // A skipped test carries an empty results array. Reaching into results[0] would throw and take
    // the whole report down over a test that cost nothing.
    const report = { suites: [{ file: 'skipped.e2e.ts', specs: [{ tests: [{ results: [] }] }] }] };
    expect(aggregate(report).rows).toEqual([{ file: 'skipped.e2e.ts', ms: 0, tests: 1 }]);
  });
});
