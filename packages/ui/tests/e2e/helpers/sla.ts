import { expect, type TestInfo } from '@playwright/test';

/**
 * Wall-clock SLAs are asserted only where the reading MEANS something.
 *
 * A performance ceiling compares the product against a requirement. It can only do that on hardware
 * the requirement describes — 001 SC-001 says "on a typical modern Windows machine" in as many words
 * — and only when nothing else is competing for the machine. Asked anywhere else it does not report
 * a slow product; it reports a slow computer, in the shape of a test failure, and nobody downstream
 * can tell those apart.
 *
 * That is the whole cost of getting this wrong, and it is not theoretical: a ceiling that fires on
 * contention teaches people that reds are weather. Once a suite has taught that, a real regression
 * lands inside a bar everyone has learned to look past.
 *
 * `app-shell` already argued exactly this and encoded it as `workers === 1 && !CI`, narrowing WHEN
 * the SLA is checked to when the measurement is valid. This is that same argument with the second
 * condition it was always missing: **unloaded is not the same as representative.** A dedicated test
 * VM running one worker satisfies the old predicate perfectly and is still several times slower than
 * the machine the requirement is about.
 *
 * ── The consequence, stated plainly because it is easy to lose ──────────────────────────────────
 *
 * On a host that declares itself non-reference, these SLAs are NOT CHECKED. They are not relaxed to
 * a bigger number — a re-based budget silently redefines what the requirement promises — they are
 * skipped, and the skip is recorded as an annotation carrying the measurement that WOULD have been
 * asserted. So the number still appears in the report; it simply is not adjudicated there.
 *
 * The reading is therefore taken deliberately, on a reference machine, rather than incidentally on
 * whatever ran the suite. See "Where a performance SLA is measured" in docs/testing.md.
 */

/** Set on any host whose timings are not representative of a typical modern Windows machine. */
const NON_REFERENCE = 'THRONG_NON_REFERENCE_HARDWARE';

/**
 * Whether a wall-clock SLA reading is valid here. Three conditions, all necessary:
 *
 * - **one worker** — several Electron apps at once measures the rig, not the app;
 * - **not CI** — a shared hosted runner is contended by construction;
 * - **not a declared non-reference host** — the machine must be one the requirement is about.
 */
export function slaMeasurable(info: TestInfo): boolean {
  return info.config.workers === 1 && !process.env.CI && !process.env[NON_REFERENCE];
}

export interface SlaReading {
  /** What was timed, in the requirement's own terms. */
  what: string;
  /**
   * The requirement this ceiling defends — `FR-###`, `SC-###` or `NFR-###`, with its spec if that
   * is not obvious from the file.
   *
   * REQUIRED, and required by the TYPE rather than by a comment scanner (034 FR-018). A ceiling
   * that defends nothing written down cannot tell a regression from a slow machine, because there
   * is no requirement to check the behaviour against — so here it is impossible to write one.
   */
  requirement: string;
  elapsedMs: number;
  budgetMs: number;
}

/**
 * Assert a wall-clock SLA where the reading is valid; record it, unasserted, where it is not.
 *
 * The skip is deliberately visible. A silently absent assertion is indistinguishable from one that
 * passed, which is how a suite ends up believing it checks something it stopped checking.
 */
export function expectWithinSla(info: TestInfo, reading: SlaReading): void {
  const { what, requirement, elapsedMs, budgetMs } = reading;

  if (!slaMeasurable(info)) {
    info.annotations.push({
      type: 'sla-not-measured',
      description:
        `${requirement}: ${what} took ${elapsedMs}ms against a ${budgetMs}ms budget — NOT asserted. ` +
        `This host is contended or not reference hardware, so the number describes the machine as ` +
        `much as the product. Take the reading on a reference machine at --workers=1.`,
    });
    return;
  }

  expect(
    elapsedMs,
    `${requirement}: ${what} took ${elapsedMs}ms, over its ${budgetMs}ms budget`,
  ).toBeLessThan(budgetMs);
}
