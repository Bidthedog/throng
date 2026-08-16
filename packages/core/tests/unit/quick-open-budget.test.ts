import { describe, it, expect } from 'vitest';
import { compileQuery } from '../../src/picker/match.js';
import { rankFilePath, rankStable, QUICK_OPEN_MAX_ROWS } from '../../src/picker/rank.js';
import { countRegExpConstructions } from './fixtures/regexp-constructions.js';

// 033 SC-002, measurable half (contracts/file-index.md §5): one keystroke over a 50,000-file
// project must not stall the list. The whole pure pipeline —
//
//     compileQuery → filter → rankFilePath → rankStable → slice(QUICK_OPEN_MAX_ROWS)
//
// is what a keystroke costs, and this file is where that cost is held to account. If it goes red,
// the pipeline is doing per-entry work it is supposed to do per QUERY — fix the pipeline, never
// the budget.
//
// WHY THIS FILE COUNTS WORK AND DOES NOT TIME ANYTHING
//
// SC-002 words the criterion as a duration, and the first version of this file asserted it as one:
// the WORST of five wall-clock samples against a hard 100 ms. That measured the machine rather
// than the pipeline. It passed five times out of five in isolation and failed four of the eight
// full runs it was measured across, at 102.5, 105.1, 105.3 and 147.0 ms, with no code change
// between any of them — and it failed MORE often when neighbouring test files were EXCLUDED,
// which is the signature of contention rather than of anything the pipeline did. The unit project runs ~160 files in parallel; a keystroke
// that costs 38 ms alone costs 66 ms inside that, and 100 ms sits squarely in the spread.
//
// Raising the number would only move the coin toss, so two contention-tolerant replacements were
// built and measured before this one was settled on:
//
//   - the same wall-clock assertion taking the BEST of N samples instead of the worst. Rejected:
//     the best sample of the widest query still moved from 38 ms to 66 ms under an ordinary full
//     run, leaving a third of the budget to absorb a bad afternoon.
//   - a CALIBRATED ratio — the keystroke against a reference workload measured in the same
//     process and the same run, asserted at "no more than 8 naive passes over the same corpus",
//     with the two timed adjacently, windows matched for length, and the best per-sample ratio
//     taken. Genuinely better: it held at 3.7–4.0 alone and under a normal full run where the
//     absolute number drifted 70%. Still rejected, on measurement: stressed with eight CPU
//     burners against a 20-worker run on a 20-core box, it failed three of four runs, once on the
//     EMPTY query whose ordinary ratio is 0.2. When a worker is starved badly enough, both halves
//     of the ratio are perturbed independently and violently, and no ceiling that still catches a
//     regression survives it. A budget test that can be made to fail by a busy machine is the
//     defect this file exists to have fixed, not a compromise to ship.
//
// So what is asserted here is the WORK a keystroke does — how many regular expressions it builds
// and how many times it scores each candidate — over the full 50,000-path corpus. That is the
// algorithmic content of SC-002, it is exactly what a per-entry regression destroys, and a count
// says the same thing on a starved machine as on an idle one.
//
// The DURATION half of SC-002 is asserted at the E2E layer, where the app is real and contention
// is controlled: `packages/ui/tests/e2e/quick-open-perf.e2e.ts` measures in-page keystroke-to-list
// latency against a stated ceiling. See plan.md, "Performance goals, and where each is measured".

const CORPUS_SIZE = 50_000;

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

describe('Quick Open keystroke budget (SC-002)', () => {
  const paths = corpus();

  it(`has a corpus of ${CORPUS_SIZE} paths`, () => {
    expect(paths).toHaveLength(CORPUS_SIZE);
  });

  describe('the work one keystroke does over the whole corpus', () => {
    it('compiles one regular expression per QUERY TERM, whatever the corpus size', () => {
      const small = paths.slice(0, 500);
      const overSmall = countRegExpConstructions(() => void keystroke(small, 'handler service'));
      const overWhole = countRegExpConstructions(() => void keystroke(paths, 'handler service'));

      // Two terms, two compilations — at 500 paths and at 50,000 alike. The count being the SAME
      // for both corpora is the claim: compilation depends on the query, never on how much there
      // is to search. A pipeline that compiles per entry reports 1,022 for the small corpus and
      // tens of thousands for the whole one, both measured, and it reports them whether the
      // machine is idle or on its knees.
      expect(overSmall).toBe(2);
      expect(overWhole).toBe(2);
    });

    it('compiles one for a single-term query and none at all for an empty one', () => {
      expect(countRegExpConstructions(() => void keystroke(paths, 'e'))).toBe(1);
      expect(countRegExpConstructions(() => void keystroke(paths, '   '))).toBe(0);
    });

    it('compiles no more for a query that matches NOTHING — the whole corpus is still tested', () => {
      // The widest reach of the filter: every path is examined and every one of them rejected,
      // which is the shape most likely to tempt a per-entry compile back into the code.
      let rows: string[] = [];
      const constructions = countRegExpConstructions(() => {
        rows = keystroke(paths, 'zzzznotpresentzzzz');
      });
      expect(rows).toEqual([]);
      expect(constructions).toBe(1);
    });

    it('scores each surviving candidate exactly once', () => {
      // Scoring from inside the sort comparator is the other way this pipeline loses its budget:
      // it costs ~log n scorings per item rather than one, and every one of them re-runs the
      // query's regular expressions over the path.
      const compiled = compileQuery('handler');
      const matched = paths.filter((path) => compiled.test(path));
      let scorings = 0;
      const ranked = rankStable(matched, (path) => {
        scorings += 1;
        return rankFilePath(path, compiled);
      });

      expect(matched.length).toBeGreaterThan(QUICK_OPEN_MAX_ROWS);
      expect(ranked).toHaveLength(matched.length);
      expect(scorings).toBe(matched.length);
    });
  });

  // 033 FR-073, second half — CORPUS INDEPENDENCE.
  //
  // FR-073 restates SC-002 in two clauses. The first ("no filesystem work per keystroke") is
  // asserted at E2E, because it is about IPC. The second is this one: the work a keystroke does
  // PER QUERY TERM does not grow with the corpus. That is the claim SC-002 was really making — a
  // duration was only ever its proxy — and it is the half the block above does not assert, because
  // that block fixes the corpus and varies nothing.
  //
  // Two counters, one order of magnitude apart. Measured before the assertion was written
  // (T159 Red step, captured 2026-08-16); the assertion encodes exactly what was observed:
  //
  //   size   query               regexps  matched  scorings  perCandidate
  //   5,000  "handler service"         2      342       342             1
  //   5,000  "handler"                 1    1,282     1,282             1
  //   5,000  "e"                       1    5,000     5,000             1
  //   5,000  ""                        0    5,000     5,000             1
  //  50,000  "handler service"         2    3,222     3,222             1
  //  50,000  "handler"                 1   12,520    12,520             1
  //  50,000  "e"                       1   50,000    50,000             1
  //  50,000  ""                        0   50,000    50,000             1
  //
  // `matched` grows with the corpus and MUST — ten times the files, roughly ten times the hits.
  // What does not move is the pair either side of it: the compilations are a function of the
  // QUERY, and the scorings are exactly one per surviving candidate. A pipeline that compiled per
  // entry would report 5,001 against 50,001 here; one that scored from inside the sort comparator
  // would report ~log n per candidate rather than 1. Both regressions are invisible to a wall-clock
  // assertion on a contended machine and unmissable to these two numbers.
  describe('the work per query term does not grow with the corpus (FR-073)', () => {
    /** Every tenth path — a 5,000-entry sample of the same SHAPE, not a skewed prefix. */
    const sample = paths.filter((_, i) => i % 10 === 0);

    it('samples 5,000 paths, one order of magnitude below the whole corpus', () => {
      expect(sample).toHaveLength(CORPUS_SIZE / 10);
    });

    it.each([
      { query: 'handler service', regexps: 2 },
      { query: 'handler', regexps: 1 },
      { query: 'e', regexps: 1 },
      { query: '', regexps: 0 },
    ])(
      'builds $regexps regular expression(s) for $query at BOTH 5,000 and 50,000 candidates',
      ({ query, regexps }) => {
        expect(countRegExpConstructions(() => void keystroke(sample, query))).toBe(regexps);
        expect(countRegExpConstructions(() => void keystroke(paths, query))).toBe(regexps);
      },
    );

    it.each(['handler service', 'handler', 'e', ''])(
      'scores each surviving candidate exactly once for %j at BOTH corpus sizes',
      (query) => {
        const scoringsPerCandidate = (corpusOf: readonly string[]): number => {
          const compiled = compileQuery(query);
          const matched = corpusOf.filter((path) => compiled.test(path));
          let scorings = 0;
          rankStable(matched, (path) => {
            scorings += 1;
            return rankFilePath(path, compiled);
          });
          expect(matched.length).toBeGreaterThan(0);
          return scorings / matched.length;
        };

        expect(scoringsPerCandidate(sample)).toBe(1);
        expect(scoringsPerCandidate(paths)).toBe(1);
      },
    );

    it('finds MORE matches in the bigger corpus — so the sample is not the corpus in disguise', () => {
      // Guard the guard. If the sample somehow matched as much as the whole corpus, the two
      // assertions above would be comparing a set against itself and proving nothing.
      const compiled = compileQuery('handler');
      const inSample = sample.filter((path) => compiled.test(path)).length;
      const inWhole = paths.filter((path) => compiled.test(path)).length;
      expect(inSample).toBeGreaterThan(0);
      expect(inWhole).toBeGreaterThan(inSample * 5);
    });
  });

  describe(`what a keystroke returns at ${CORPUS_SIZE} paths`, () => {
    it('answers a two-term query with a non-empty, capped list', () => {
      const rows = keystroke(paths, 'handler service');
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.length).toBeLessThanOrEqual(QUICK_OPEN_MAX_ROWS);
    });

    it('fills the cap for a single character — the widest match set', () => {
      expect(keystroke(paths, 'e')).toHaveLength(QUICK_OPEN_MAX_ROWS);
    });

    it('fills the cap for an EMPTY query — every path a candidate (K6)', () => {
      expect(keystroke(paths, '')).toHaveLength(QUICK_OPEN_MAX_ROWS);
    });

    it('caps the RENDERED rows without narrowing what was matched (FR-014)', () => {
      const compiled = compileQuery('handler');
      const matched = paths.filter((path) => compiled.test(path));
      expect(matched.length).toBeGreaterThan(QUICK_OPEN_MAX_ROWS);
      expect(keystroke(paths, 'handler')).toHaveLength(QUICK_OPEN_MAX_ROWS);
    });
  });
});
