import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';
import { describe, it, expect } from 'vitest';

/**
 * Every wall-clock ceiling names the requirement it defends (spec 034, FR-018 / SC-007).
 *
 * A `toBeLessThan(2000)` is a PERFORMANCE ASSERTION, and a performance assertion that defends no
 * stated requirement is indistinguishable from a locally invented allowance. That distinction is
 * not academic: an invented ceiling turns a contended run into a fake regression that nobody can
 * adjudicate, because there is no requirement to check the behaviour against. Spec 033 shipped one
 * — a 250ms allowance for "IPC, a React render and a paint" defending an SC that states 100ms over
 * the pure pipeline — and it was deleted rather than re-based, precisely because no reading of the
 * requirement produced the number.
 *
 * So a numeric ceiling must carry one of three things above it:
 *
 *   - a **requirement citation** — `FR-###`, `SC-###` or `NFR-###`, optionally naming its spec —
 *     which is the case this criterion is really about; or
 *   - **`not-a-clock: <reason>`**, for a bound that is not a duration at all. The virtualised
 *     explorer asserting fewer than 200 rows in the DOM is a real assertion about rendering, and
 *     SC-007 does not govern it; or
 *   - **`validity-bound: <reason>`**, for a clock that separates two OUTCOMES rather than asserting
 *     a speed. `app-shell` bounding a close at ten seconds is not a performance claim: a shutdown
 *     that needed the force-kill fallback cannot come in under it, so the number is what makes
 *     "closed" and "was killed" distinguishable. Delete it and the test still passes when the app
 *     had to be killed, which is the opposite of what it says it checks.
 *
 * The third category is the one that could become a loophole, so it is deliberately narrow: it must
 * name the production constant it derives from, and "this would otherwise be slow" is not a reason —
 * that is a performance ceiling and it needs a requirement like any other.
 *
 * Requiring the author to say WHICH is the point. Deciding "is this number a clock?" mechanically
 * means reading the expression under `expect()`, and a scanner that guesses will guess wrong on the
 * one that matters; a scanner that makes the author declare cannot.
 *
 * **It bit on first run, which is its control.** Against the suite as it stood on 2026-08-18 it
 * failed with EIGHT undeclared ceilings and went green one at a time as each was answered — so it
 * distinguishes declared from undeclared rather than passing on everything. Three of the eight were
 * ones a hand-written grep had missed: `toBeLessThanOrEqual`, a numeric separator (`10_000`), and
 * `quick-open-perf.e2e.ts`'s invented 250 ms keystroke allowance, which a rebase plan had recorded
 * as deleted months earlier and which was still there.
 */

const E2E_DIR = fileURLToPath(new URL('../e2e', import.meta.url));

/** A numeric bound big enough to be a duration or a budget rather than an index or a small count. */
const BOUND = /\.toBeLessThan(?:OrEqual)?\(\s*([0-9_]{3,})\s*\)/;
const CITATION = /\b(?:FR|SC|NFR)-\d{3}\b/;
/** A marker with nothing after it reads as a judgement somebody made; require the reason. */
const MARKER = /(?:not-a-clock|validity-bound):\s*\S.{19,}/;
/**
 * How far above the assertion to look for its declaration.
 *
 * Twenty rather than ten because the declarations that exist in this suite are ARGUMENTS, not
 * labels — `daemon-status-bar.e2e.ts` spends fifteen lines explaining why two seconds is the right
 * ceiling and why the file is therefore in the serial tier. A lookback that only caught one-line
 * citations would reject exactly the best-documented ceilings in the repo, which would teach people
 * to write worse ones.
 */
const LOOKBACK = 20;

function specFiles(): string[] {
  return readdirSync(E2E_DIR)
    .filter((f) => f.endsWith('.e2e.ts'))
    .map((f) => join(E2E_DIR, f));
}

interface Bound {
  where: string;
  code: string;
  declared: boolean;
}

function boundsIn(file: string): Bound[] {
  const lines = readFileSync(file, 'utf8').split(/\r?\n/);
  const found: Bound[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!BOUND.test(lines[i])) continue;
    const context = lines.slice(Math.max(0, i - LOOKBACK), i + 1).join('\n');
    found.push({
      where: `${relative(E2E_DIR, file).replace(/\\/g, '/')}:${i + 1}`,
      code: lines[i].trim(),
      declared: CITATION.test(context) || MARKER.test(context),
    });
  }
  return found;
}

describe('wall-clock ceilings name what they defend', () => {
  const bounds = specFiles().flatMap(boundsIn);

  it('finds the ceilings at all, so an empty pass cannot be mistaken for a clean one', () => {
    expect(bounds.length, 'no numeric ceilings were found — the scanner is broken').toBeGreaterThan(0);
  });

  it('every ceiling cites a requirement, or says it is not a clock', () => {
    const bare = bounds.filter((b) => !b.declared);
    expect(
      bare.map((b) => `${b.where}  ${b.code}`),
      `These ceilings defend nothing that is written down. A performance assertion with an ` +
        `invented number cannot tell a regression from a contended machine, because there is no ` +
        `requirement to check the behaviour against. Within ten lines above it, either cite the ` +
        `requirement (FR-###, SC-### or NFR-###, naming its spec if it is another one) or, if the ` +
        `bound is not a duration, write "not-a-clock: <what it bounds and why>":\n`,
    ).toEqual([]);
  });
});
