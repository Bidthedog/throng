import type { Reporter, TestCase, TestResult, FullResult } from '@playwright/test/reporter';

/**
 * Prints a reminder after EVERY E2E run that the run-as-admin / de-elevation path
 * (the `@admin`-tagged tests) is only verified when the run is elevated. Constitution
 * requirement: admin-mode behaviour must be manually verified elevated, and we must
 * not let a green non-elevated run imply that coverage. Counts how many `@admin`
 * tests were skipped vs actually ran so the message reflects this run.
 */
const RULE = '─'.repeat(74);

export default class AdminReminderReporter implements Reporter {
  private skipped = 0;
  private ran = 0;

  onTestEnd(test: TestCase, result: TestResult): void {
    if (!test.tags?.includes('@admin')) return;
    if (result.status === 'skipped') this.skipped += 1;
    else this.ran += 1;
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
    out.push(RULE, '');
    // eslint-disable-next-line no-console
    console.log(out.join('\n'));
  }
}
