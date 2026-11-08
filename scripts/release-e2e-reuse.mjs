// Whether release.yml may take a gate's E2E verdict instead of running the suite again (065 FR-014).
//
// `gate.yml` runs the same full E2E suite, and fails on a flake, so a green full gate on the tree being
// released has already answered what `e2e-full` would ask. Matched by TREE, not commit: rebase-merging
// the release PR gives the commit a new SHA and leaves its content alone.
//
// Writes `reused` and `gate_run` to $GITHUB_OUTPUT. Anything it cannot establish answers "not reused",
// so the failure mode of this script is a slower release and never a skipped suite.
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isFullGate } from './release-preflight.mjs';

/** The newest run in `runs` that proves `targetTree`, or undefined. `treeOf` resolves a commit's tree. */
export async function findReusableGate(runs, treeOf, targetTree) {
  const trees = new Map();
  for (const run of runs) {
    if (run.status !== 'completed' || run.conclusion !== 'success' || run.run_attempt !== 1 || !isFullGate(run)) continue;
    if (!trees.has(run.head_sha)) trees.set(run.head_sha, await treeOf(run.head_sha));
    if (trees.get(run.head_sha) === targetTree) return run;
  }
  return undefined;
}

function ghJson(path) {
  return JSON.parse(execFileSync('gh', ['api', path], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 32 * 1024 * 1024 }));
}

async function main() {
  const repo = process.env.GITHUB_REPOSITORY;
  const treeOf = async (sha) => ghJson(`repos/${repo}/git/commits/${sha}`).tree.sha;
  let found;
  try {
    const { workflow_runs: runs } = ghJson(`repos/${repo}/actions/workflows/gate.yml/runs?status=success&per_page=50`);
    found = await findReusableGate(runs, treeOf, await treeOf(process.env.GITHUB_SHA));
  } catch (err) {
    console.log(`::warning::could not look for a reusable gate, so the E2E suite runs: ${err instanceof Error ? err.message : String(err)}`);
  }
  const message = found ? `E2E verdict reused from the full gate on the same tree: ${found.html_url}` : 'No full green gate on this tree: the E2E suite runs here.';
  console.log(message);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${message}\n`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `reused=${found ? 'true' : 'false'}\ngate_run=${found?.html_url ?? ''}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
