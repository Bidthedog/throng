/*
 * NO SHEBANG, DELIBERATELY, and it cost a red CI to learn.
 *
 * This module is imported by `packages/ui/tests/unit/e2e-durations.test.ts`, and Vite decides per
 * environment whether to hand an imported `.mjs` to Node (where `#!` is legal and stripped) or to
 * INLINE it, wrapping the source in a function body — where `#!` is not at the start of a program
 * and is a hard `SyntaxError: Invalid or unexpected token`. It externalised locally and inlined on
 * CI, so the file loaded here and failed there, taking the whole unit job with it while 287 other
 * suites passed.
 *
 * Nothing is lost by dropping it: the documented invocation is `node scripts/e2e-durations.mjs`,
 * and on Windows — the only platform this repo builds for — a shebang has never done anything.
 * `packages/ui/tests/unit/script-imports-parse.test.ts` now fails the build if one comes back.
 */
/**
 * Per-file E2E durations, from a run that already happened (034 SC-015).
 *
 * The question this answers — "which spec files cost the most?" — was being answered by reading the
 * `list` reporter's scrollback and adding up by eye, which is why every timing figure published
 * about this suite before spec 034 was wrong: the docs said 24.7 minutes when the truth was 46.9.
 * A number nobody can re-derive is a number that drifts, so the procedure is a command rather than
 * a habit.
 *
 * It reads the JSON report Playwright already knows how to write, so it costs NOTHING beyond the
 * run you were doing anyway — no instrumentation, no second run, no reporter to install:
 *
 *   THRONG_E2E_JSON_OUT=e2e-report.json npm run test:e2e
 *   node scripts/e2e-durations.mjs e2e-report.json
 *
 * Durations are summed across every test in a file INCLUDING retries, because a file that passes
 * only on its second attempt genuinely costs the suite both attempts. That is the number the tier
 * plan and the launch-sharing decisions are made against, so it is the number reported.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Aggregate a Playwright JSON report into per-file totals.
 *
 * Exported, and separate from the printing, so the arithmetic can be proven at the unit layer
 * against a report whose right answer is known. Recording durations is the one job this has, and a
 * reporting script that quietly halves its numbers is worse than no script — the whole reason
 * SC-015 exists is that the published figures had drifted to roughly half the truth.
 *
 * Walks the suite tree rather than assuming its depth: Playwright nests a suite per file and then
 * one per `describe`, so wrapping a file's tests in one more `describe` would otherwise change the
 * answer. `file` is inherited downward because only the outermost suite carries it.
 *
 * Retries are INCLUDED. A file that passes on its second attempt genuinely costs the suite both
 * attempts, and that is the number the tier plan is made against.
 */
export function aggregate(report) {
  const byFile = new Map();
  let tests = 0;
  let retried = 0;

  function visit(suite, inheritedFile) {
    const file = suite.file ?? inheritedFile;
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests ?? []) {
        tests += 1;
        if ((test.results ?? []).length > 1) retried += 1;
        const entry = byFile.get(file) ?? { ms: 0, tests: 0 };
        for (const result of test.results ?? []) entry.ms += result.duration ?? 0;
        entry.tests += 1;
        byFile.set(file, entry);
      }
    }
    for (const child of suite.suites ?? []) visit(child, file);
  }

  for (const suite of report.suites ?? []) visit(suite, suite.file);

  const rows = [...byFile.entries()]
    .map(([file, v]) => ({ file, ...v }))
    .sort((a, b) => b.ms - a.ms);
  return { rows, tests, retried, totalMs: rows.reduce((a, r) => a + r.ms, 0) };
}

function main(argv) {
  const path = argv[2];
  if (!path) {
    console.error('usage: node scripts/e2e-durations.mjs <json-report>');
    console.error('produce one with: THRONG_E2E_JSON_OUT=e2e-report.json npm run test:e2e');
    return 2;
  }

  let report;
  try {
    report = JSON.parse(readFileSync(path, 'utf8'));
  } catch (cause) {
    console.error(`cannot read ${path} as a Playwright JSON report: ${cause.message}`);
    return 2;
  }

  const { rows, tests, retried, totalMs } = aggregate(report);
  if (rows.length === 0) {
    console.error(`${path} contains no suites — was the run filtered to nothing?`);
    return 1;
  }

  console.log(`${rows.length} spec files, ${tests} tests, ${retried} retried`);
  console.log(`${(totalMs / 60000).toFixed(1)} minutes of test time (retries included)`);
  console.log('');
  console.log('    mins   tests  share  file');
  let cumulative = 0;
  for (const r of rows) {
    cumulative += r.ms;
    console.log(
      `  ${(r.ms / 60000).toFixed(2).padStart(6)}  ${String(r.tests).padStart(6)}  ` +
        `${((cumulative / totalMs) * 100).toFixed(0).padStart(4)}%  ${r.file}`,
    );
  }
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exit(main(process.argv));
}
