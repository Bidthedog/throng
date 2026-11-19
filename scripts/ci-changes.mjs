// Does a pull request change anything a PR CI job reads (072 FR-004a)?
//
// ci.yml's `changes` job pipes the pull request's changed paths in, one per line, and writes this script's answer to
// $GITHUB_OUTPUT:
//
//   git diff --name-only HEAD^1 HEAD | node scripts/ci-changes.mjs >> "$GITHUB_OUTPUT"
//
// prints `code=true` when any changed path can affect a job, `code=false` when none can. The work jobs run only on
// `code=true`, and the CI verdict passes on `code=false` without them.
//
// A path is INERT only when nothing PR CI runs can read it: no lint, typecheck, test or build input. The list is short on
// purpose and fails safe: a path it does not name runs everything. Before adding a pattern, find every test, script and
// config that reads under it (docs/ and the root README are read by docs-currency.test.ts, so they are NOT inert).
//
// No dependencies, so the job needs no `npm ci`.
import { readFileSync } from 'node:fs';
import { isMain } from './is-main.mjs';

/**
 * Paths no PR CI job reads. Anchored; matched against repo-relative, forward-slash paths. Audited 2026-11-19 against every
 * test, script and config ci.yml runs: `eslint .` lints only JS and TS (see CODE below), typecheck covers `packages/*` only,
 * and no test reads any of these from disk.
 */
export const INERT_PATHS = Object.freeze([
  // Spec Kit: the constitution, templates and memory. Lint-ignored; file-explorer-name.test.ts names the constitution only
  // to exclude it.
  /^\.specify\//,
  // Spec artifacts: read by people and by Spec Kit, never by a test or the build.
  /^specs\//,
  // Agent material: manual test plans, skills, hooks, memory and settings. Lint-ignored, and no test reads them.
  // (.claude/worktree-prep.json is NOT here: clear-dev-state.integration.test.ts reads it.)
  /^\.claude\/\.manual-test-plans\//,
  /^\.claude\/skills\//,
  /^\.claude\/hooks\//,
  /^\.claude\/agent-memory\//,
  /^\.claude\/settings(\.local)?\.json$/,
  /^CLAUDE\.md$/,
  // GitHub's issue and pull request templates: read by GitHub, never by a test.
  /^\.github\/ISSUE_TEMPLATE\//,
  /^\.github\/PULL_REQUEST_TEMPLATE\.md$/,
]);

/** A file `eslint .` lints wherever it sits, so never inert even under an inert folder. */
const CODE = /\.(?:[cm]?[jt]s|[jt]sx)$/;

/** Whether one changed path can affect a PR CI job. Anything not declared inert can, and so can any JS or TS file. */
export function affectsCi(path) {
  if (CODE.test(path)) return true;
  return !INERT_PATHS.some((pattern) => pattern.test(path));
}

/**
 * The answer for a whole pull request. An empty list runs everything: a diff that could not be read is not evidence that
 * nothing changed.
 */
export function decide(paths) {
  const changed = paths.map((p) => p.trim()).filter((p) => p !== '');
  if (changed.length === 0) return { code: true, relevant: [] };
  const relevant = changed.filter(affectsCi);
  return { code: relevant.length > 0, relevant };
}

if (isMain(import.meta.url)) {
  const { code, relevant } = decide(readFileSync(0, 'utf8').split('\n'));
  for (const path of relevant.slice(0, 20)) process.stderr.write(`affects CI: ${path}\n`);
  if (!code) process.stderr.write('no changed file is one a PR CI job reads\n');
  process.stdout.write(`code=${code}\n`);
}
