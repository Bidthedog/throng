// td's `tag.list` for the e2e runner: every Playwright test carrying the tag, as the `{name, file}` array td reads.
//
// Playwright's own `--list` prints titles, which td cannot read as ids, and it exits 1 with "No tests found" when nothing
// carries the tag — which td reported as a failed listing, leaving every tier unknown. This asks Playwright for its JSON
// list instead, passes with no tests, and names each test the way its JUnit reporter does: the describe titles and the
// test title joined by " › ", with the file relative to the repository root.
//
// Usage: node scripts/td-e2e-tag-list.mjs <tag>      (the tag without its @, as td's tag.names maps it)
import { spawnSync } from 'node:child_process';
import { relative, resolve } from 'node:path';
import { isMain } from './is-main.mjs';

/** Flatten Playwright's JSON report into `{ name, file }`, file relative to `repoRoot`. */
export function testsFromReport(report, repoRoot) {
  const rootDir = report.config?.rootDir ?? repoRoot;
  const out = [];
  const walk = (suite, titles) => {
    for (const spec of suite.specs ?? []) {
      out.push({ name: [...titles, spec.title].join(' › '), file: relative(repoRoot, resolve(rootDir, spec.file)).split('\\').join('/') });
    }
    for (const child of suite.suites ?? []) walk(child, [...titles, child.title]);
  };
  // The top-level suites are files: their titles are paths, not describe blocks, so they start no title path.
  for (const file of report.suites ?? []) walk(file, []);
  return out;
}

function main() {
  const tag = process.argv[2];
  if (!tag) {
    console.error('usage: node scripts/td-e2e-tag-list.mjs <tag>');
    process.exit(64);
  }
  const res = spawnSync('npx', ['playwright', 'test', '--list', '--reporter=json', '--pass-with-no-tests', '--grep', `@${tag}\\b`], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    shell: process.platform === 'win32',
  });
  if (res.status !== 0) {
    process.stderr.write(res.stderr || res.stdout);
    process.exit(res.status ?? 1);
  }
  process.stdout.write(`${JSON.stringify(testsFromReport(JSON.parse(res.stdout), process.cwd()))}\n`);
}

if (isMain(import.meta.url)) main();
