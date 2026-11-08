// Whether a release may start (065 FR-005, FR-013): the `throng-release` skill runs this first.
//
// Each finding is printed with what to act on, and the exit code is 1 when there is one. Exit 2 means
// the facts could not be read at all, which says nothing about master.
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const NIGHTLY_ISSUE_TITLE = 'Nightly gate failed on master';

/** A whole gate, not one stage or a stress run. gate.yml's `run-name` says which it was. */
export function isFullGate(run) {
  return run.event === 'schedule' || (run.event === 'workflow_dispatch' && run.display_title === 'gate (full gate)');
}

const finished = (run) => run.status === 'completed' && run.conclusion !== 'cancelled' && run.conclusion !== 'skipped';

/** What is wrong with the newest finished run in `runs`, or nothing. */
function judge(what, runs) {
  const latest = runs.find(finished);
  if (!latest) return { kind: 'master', message: `${what}: no finished run on master to judge` };
  if (latest.conclusion !== 'success') return { kind: 'master', message: `${what} is ${latest.conclusion}: ${latest.html_url}` };
  if (latest.run_attempt > 1) return { kind: 'master', message: `${what} went green only on attempt ${latest.run_attempt}, which is a flake: ${latest.html_url}` };
  return undefined;
}

/** Every reason this release may not start; empty when it may. */
export function evaluatePreflight({ requiredReviewers, tagPolicies, releaseRuns, gateRuns, nightlyIssues }) {
  const findings = [];
  if (requiredReviewers !== 0) {
    findings.push({ kind: 'environment', message: `the release Environment has ${requiredReviewers} required reviewer rule(s); 065 FR-005 requires none` });
  }
  if (tagPolicies.join(',') !== 'tag:v*') {
    findings.push({ kind: 'environment', message: `the release Environment accepts [${tagPolicies.join(', ')}]; 065 FR-005 requires exactly tag:v*` });
  }
  const release = judge('release.yml on master', releaseRuns);
  if (release) findings.push(release);
  const gate = judge('the latest full gate on master', gateRuns.filter(isFullGate));
  if (gate) findings.push(gate);
  for (const issue of nightlyIssues) {
    findings.push({ kind: 'master', message: `#${issue.number} is open (${issue.title}): a nightly failure stays a defect until its fix closes it` });
  }
  return findings;
}

function ghJson(path) {
  return JSON.parse(execFileSync('gh', ['api', path], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 32 * 1024 * 1024 }));
}

function readFacts() {
  const environment = ghJson('repos/{owner}/{repo}/environments/release');
  let policies = [];
  try {
    policies = ghJson('repos/{owner}/{repo}/environments/release/deployment-branch-policies').branch_policies;
  } catch {
    // GitHub answers 404 when the Environment has no custom policy: an empty list is the fact.
  }
  const runs = (workflow) => ghJson(`repos/{owner}/{repo}/actions/workflows/${workflow}/runs?branch=master&per_page=30`).workflow_runs;
  const issues = ghJson('repos/{owner}/{repo}/issues?state=open&per_page=100');
  return {
    requiredReviewers: environment.protection_rules.filter((r) => r.type === 'required_reviewers').length,
    tagPolicies: policies.map((p) => `${p.type}:${p.name}`),
    releaseRuns: runs('release.yml'),
    gateRuns: runs('gate.yml'),
    nightlyIssues: issues.filter((i) => i.title === NIGHTLY_ISSUE_TITLE && !i.pull_request),
  };
}

function main() {
  let facts;
  try {
    facts = readFacts();
  } catch (err) {
    console.error(`[release-preflight] could not read the facts: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(2);
  }
  const findings = evaluatePreflight(facts);
  for (const finding of findings) console.log(`[${finding.kind}] ${finding.message}`);
  if (findings.length === 0) console.log('release-preflight: master is green and the release Environment is correct');
  process.exit(findings.length === 0 ? 0 : 1);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
