import { describe, it, expect } from 'vitest';
import { compileQuery } from '../../src/picker/match.js';
import { rankFilePath, rankStable, QUICK_OPEN_MAX_ROWS } from '../../src/picker/rank.js';

// 033 SC-002, measurable half (contracts/file-index.md §5): one keystroke over a 50,000-file
// project must complete the WHOLE pure pipeline in under 100 ms —
//
//     compileQuery → filter → rankFilePath → rankStable → slice(QUICK_OPEN_MAX_ROWS)
//
// The number is not negotiable and neither is the statistic: this asserts the WORST of N samples,
// not the mean. A mean hides the keystroke the user actually noticed, and the budget exists
// because of that keystroke. If this goes red, the wrappers are re-compiling something per entry —
// fix the pipeline, never the budget.

const CORPUS_SIZE = 50_000;
const BUDGET_MS = 100;
const SAMPLES = 5;

/** 50,000 root-relative POSIX paths of realistic depth and shape. */
function corpus(): string[] {
  const areas = ['packages', 'apps', 'services', 'tools', 'vendor'];
  const middles = ['src', 'lib', 'internal', 'components', 'handlers', 'tests', 'generated'];
  const leaves = ['index', 'handler', 'service', 'model', 'view', 'helper', 'client', 'store'];
  const extensions = ['.ts', '.tsx', '.js', '.json', '.md', '.css'];
  const paths: string[] = [];
  for (let i = 0; i < CORPUS_SIZE; i += 1) {
    const area = areas[i % areas.length];
    const middle = middles[(i >> 2) % middles.length];
    const leaf = leaves[(i >> 5) % leaves.length];
    const extension = extensions[(i >> 3) % extensions.length];
    paths.push(`${area}/module-${i % 997}/${middle}/depth-${i % 37}/${leaf}-${i}${extension}`);
  }
  return paths.sort();
}

/** Exactly what a keystroke costs: compile, filter, rank, cap. */
function keystroke(paths: readonly string[], query: string): string[] {
  const compiled = compileQuery(query);
  const matched = paths.filter((path) => compiled.test(path));
  const rankedPaths = rankStable(matched, (path) => rankFilePath(path, compiled));
  return rankedPaths.slice(0, QUICK_OPEN_MAX_ROWS);
}

/** The worst of `SAMPLES` timed runs, in milliseconds. */
function worstOf(run: () => unknown): number {
  run(); // warm-up, deliberately not measured
  let worst = 0;
  for (let sample = 0; sample < SAMPLES; sample += 1) {
    const started = performance.now();
    run();
    worst = Math.max(worst, performance.now() - started);
  }
  return worst;
}

describe('Quick Open keystroke budget (SC-002)', () => {
  const paths = corpus();

  it(`has a corpus of ${CORPUS_SIZE} paths`, () => {
    expect(paths).toHaveLength(CORPUS_SIZE);
  });

  it(`completes a two-term keystroke over ${CORPUS_SIZE} paths in under ${BUDGET_MS} ms (worst of ${SAMPLES})`, () => {
    let rows: string[] = [];
    const worst = worstOf(() => {
      rows = keystroke(paths, 'handler service');
    });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThanOrEqual(QUICK_OPEN_MAX_ROWS);
    expect(worst).toBeLessThan(BUDGET_MS);
  });

  it(`completes a single-character keystroke — the widest match set — in under ${BUDGET_MS} ms`, () => {
    // One character matches almost everything, so ranking and the sort do their most work here.
    let rows: string[] = [];
    const worst = worstOf(() => {
      rows = keystroke(paths, 'e');
    });
    expect(rows).toHaveLength(QUICK_OPEN_MAX_ROWS);
    expect(worst).toBeLessThan(BUDGET_MS);
  });

  it(`completes a keystroke that matches NOTHING in under ${BUDGET_MS} ms`, () => {
    let rows: string[] = [];
    const worst = worstOf(() => {
      rows = keystroke(paths, 'zzzznotpresentzzzz');
    });
    expect(rows).toEqual([]);
    expect(worst).toBeLessThan(BUDGET_MS);
  });

  it(`completes an EMPTY query — every path a candidate — in under ${BUDGET_MS} ms`, () => {
    let rows: string[] = [];
    const worst = worstOf(() => {
      rows = keystroke(paths, '');
    });
    expect(rows).toHaveLength(QUICK_OPEN_MAX_ROWS);
    expect(worst).toBeLessThan(BUDGET_MS);
  });

  it('caps the RENDERED rows without narrowing what was matched (FR-014)', () => {
    const compiled = compileQuery('handler');
    const matched = paths.filter((path) => compiled.test(path));
    expect(matched.length).toBeGreaterThan(QUICK_OPEN_MAX_ROWS);
    expect(keystroke(paths, 'handler')).toHaveLength(QUICK_OPEN_MAX_ROWS);
  });
});
