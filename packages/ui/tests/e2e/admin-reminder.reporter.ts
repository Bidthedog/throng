import type { Reporter, TestCase, TestResult, FullResult } from '@playwright/test/reporter';

/**
 * Prints a reminder after EVERY E2E run about the coverage this run did NOT provide.
 *
 * TWO DIRECTIONS, because elevation cuts both ways and only one of them used to be reported.
 *
 * ELEVATED-ONLY (`@admin`): the run-as-admin / de-elevation path verifies only when the run IS
 * elevated. Constitution requirement — a green non-elevated run must not imply that coverage.
 *
 * UNELEVATED-ONLY (`skipIfElevated()`): the mirror image, and the one that was silent. Those tests
 * assume a normal-integrity daemon and skip when the run is elevated — which is EVERY GitHub-hosted
 * Windows runner, because they run as administrator with UAC disabled. There is no filtered token
 * to drop to there, so this cannot be fixed by configuration: `schtasks /RL LIMITED` has nothing to
 * fall back on and `runas /trustlevel` produces nothing (measured, CI run 30947653266).
 *
 * That gap became load-bearing when the gate moved to hosted runners and the self-hosted
 * (unelevated) machine was retired. A skipped test that nobody counts reads exactly like a test
 * that passed, so the number is printed on every run and the reader is told where it IS verified.
 */
const RULE = '─'.repeat(74);

/** The reason string `skipIfElevated()` passes to `test.skip` — see `admin.ts`. */
const UNELEVATED_SKIP = 'non-elevated (normal-integrity) daemon';

export default class AdminReminderReporter implements Reporter {
  private skipped = 0;
  private ran = 0;
  private unelevatedOnly = 0;

  onTestEnd(test: TestCase, result: TestResult): void {
    if (test.tags?.includes('@admin')) {
      if (result.status === 'skipped') this.skipped += 1;
      else this.ran += 1;
      return;
    }
    // Matched on the skip REASON rather than on a tag: these tests carry no tag of their own, and
    // adding one would mean touching 29 files to record something `admin.ts` already states once.
    if (
      result.status === 'skipped' &&
      test.annotations?.some((a) => a.description?.includes(UNELEVATED_SKIP))
    ) {
      this.unelevatedOnly += 1;
    }
  }

  onEnd(_result: FullResult): void | Promise<void> {
    const out: string[] = ['', RULE];
    if (this.skipped > 0) {
      out.push(
        `⚠  ADMIN REMINDER: ${this.skipped} @admin E2E test(s) were SKIPPED (not running elevated).`,
        `   The run-as-admin / de-elevation (mixed-mode) path is NOT covered by this run.`,
        `   Verify it by running elevated:   npm run test:e2e:admin`,
      );
    } else if (this.ran > 0) {
      out.push(`✓  ${this.ran} @admin E2E test(s) ran ELEVATED — the run-as-admin path was covered.`);
    } else {
      out.push(
        `ℹ  ADMIN REMINDER: run-as-admin / de-elevation behaviour lives in @admin E2E,`,
        `   which only verify when elevated. Run:   npm run test:e2e:admin`,
      );
    }
    if (this.unelevatedOnly > 0) {
      out.push(
        '',
        `⚠  UNELEVATED REMINDER: ${this.unelevatedOnly} test(s) were SKIPPED because this run IS elevated.`,
        `   They assume a normal-integrity daemon. Every GitHub-hosted Windows runner is elevated`,
        `   with UAC off, so this gap CANNOT be closed there — there is no filtered token to drop to.`,
        `   They verify on any ordinary developer machine:   npm run test:e2e`,
      );
    }
    out.push(RULE, '');
    console.log(out.join('\n'));
  }
}
