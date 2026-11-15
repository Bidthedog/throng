/**
 * A vitest reporter for the macOS jobs (070 T018, FR-038): prints every skipped test grouped by the platform guard that
 * skipped it, as `admin-reminder.reporter.ts` does for the elevated Windows specs, and fails the run when a test
 * skipped without stating why. Add it beside the default reporter:
 *
 *   npx vitest run --project contract --reporter=default --reporter=./packages/platform/tests/support/skip-reasons.reporter.ts
 */
import { readFileSync } from 'node:fs';
import type { Reporter, TestModule } from 'vitest/node';
import { groupSkips, type SkippedTest } from './skip-reasons.js';

export default class SkipReasonsReporter implements Reporter {
  onTestRunEnd(testModules: ReadonlyArray<TestModule>): void {
    const skipped: SkippedTest[] = [];
    for (const module of testModules) {
      for (const test of module.children.allTests()) {
        if (test.result().state !== 'skipped') continue;
        skipped.push({ file: module.moduleId, name: test.fullName, line: test.location?.line ?? 0 });
      }
    }
    if (skipped.length === 0) return;
    const sources = new Map<string, string>();
    const sourceOf = (file: string): string => {
      if (!sources.has(file)) sources.set(file, readFileSync(file, 'utf8'));
      return sources.get(file)!;
    };
    const groups = groupSkips(skipped, sourceOf);
    const lines = [`\n${skipped.length} test(s) skipped on ${process.platform}:`];
    for (const [reason, tests] of groups) {
      if (reason === null) continue;
      lines.push(`  ${reason} (${tests.length})`);
    }
    const unexplained = groups.get(null) ?? [];
    if (unexplained.length > 0) {
      lines.push(`  NO STATED REASON (${unexplained.length}): guard each with skipUnlessWindows/Linux/Macos('<why>')`);
      for (const test of unexplained) lines.push(`    ${test.file}:${test.line} ${test.name}`);
      process.exitCode = 1;
    }
    process.stdout.write(`${lines.join('\n')}\n`);
  }
}
