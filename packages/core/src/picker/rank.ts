/**
 * Ranking for the shared picker when it is seeded with file paths (033 US1, FR-007a/FR-007b,
 * contracts/picker-extensions.md §2, K1–K6).
 *
 * Matching is a filter and stays one (031): every term must appear, in any order. Ranking is the
 * separate question of which of the survivors to put at the top, and it answers it with two rules a
 * user can predict without being told them:
 *
 *   1. a hit in the FILE NAME beats a hit only in the directory part — typing `report` means the
 *      file called report, not the twelve files inside a folder called report (K1);
 *   2. among hits of the same kind, an EARLIER hit beats a later one (K2).
 *
 * Anything those two cannot separate keeps the order it was seeded in, decided by an explicit index
 * comparison rather than by trusting the sort to be stable (K3).
 *
 * Pure, and corpus-agnostic in signature: nothing here reads a setting, a clock or a filesystem.
 */
import type { CompiledQuery } from './match.js';

/**
 * The most rows Quick Open RENDERS (FR-014, R11).
 *
 * A cap on drawing, not on matching — every candidate is still matched, so the truncation line can
 * tell the truth about how many did. Named here rather than written at its point of use, and
 * deliberately NOT a user setting: it is a rendering limit that exists so the list stays responsive,
 * not a preference anyone benefits from expressing.
 */
export const QUICK_OPEN_MAX_ROWS = 200;

/**
 * A name hit's advantage. Larger than any position penalty can reach, so K1 is never outvoted by
 * K2 — an ugly late name hit still beats a beautiful early directory one.
 */
const NAME_HIT = 1_000_000;

/** Position penalties stop counting here, so a pathological path cannot invert K1. */
const MAX_POSITION_PENALTY = 100_000;

/**
 * How well `text` — a root-relative POSIX path — answers `query`. Higher is better; 0 for a text
 * that does not match, and 0 for every text when the query is empty (K5).
 *
 * Scored from the compiled query's own spans, so ranking can never disagree with what the row is
 * about to draw as marked.
 */
export function rankFilePath(text: string, query: CompiledQuery): number {
  if (query.empty) return 0;

  const spans = query.spans(text);
  if (spans.length === 0) return 0;

  // The file name is everything after the last separator; a path with no separator is all name.
  const nameStart = text.lastIndexOf('/') + 1;

  let score = 0;
  for (const span of spans) {
    const inName = span.start >= nameStart;
    const offset = inName ? span.start - nameStart : span.start;
    score += (inName ? NAME_HIT : 0) - Math.min(offset, MAX_POSITION_PENALTY);
  }
  return score;
}

/**
 * `items` ordered by `score` DESCENDING, then by each item's SEEDED INDEX ascending (K3, K6).
 *
 * Two properties this owes the caller, both easy to lose by writing the obvious one-liner:
 *
 * - `score` is called exactly ONCE per item. Calling it from inside the comparator would score the
 *   same item log-n times, and the budget in `quick-open-budget.test.ts` is what that costs.
 * - the tiebreak is the explicit index, not the engine's sort stability. A comparator that returns
 *   0 for a tie is asking the runtime for a guarantee, and the guarantee this list needs — that an
 *   unchanged result set never reorders under the user's arrow keys — is worth stating in the code.
 *
 * Returns a new array; the input is not mutated.
 *
 * It sorts an array of INDICES rather than an array of `{ item, score }` objects, which is the
 * difference between three flat arrays and fifty thousand short-lived objects on the keystroke path.
 */
export function rankStable<T>(items: readonly T[], score: (item: T) => number): T[] {
  const scores = items.map((item) => score(item));
  const order = items.map((_item, index) => index);
  order.sort((a, b) => scores[b] - scores[a] || a - b);
  return order.map((index) => items[index]);
}
