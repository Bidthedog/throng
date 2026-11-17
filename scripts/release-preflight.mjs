// Whether a release may start (065 FR-005, FR-013; 072 FR-027): the `throng-release` skill runs this first.
//
// Each finding is printed with what to act on, and the exit code is 1 when there is one. Exit 2 means
// the facts could not be read at all, which says nothing about master.
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ISSUE_TITLE as NIGHTLY_ISSUE_TITLE } from './pipeline-report.mjs';

/**
 * A full pipeline run (072 FR-018): the nightly, or a dispatch of every stage on every platform, which pipeline.yml's
 * `run-name` calls `pipeline (full)`. A release's own call to the pipeline is not master's verdict.
 */
export function isFullPipeline(run) {
  return run.event === 'schedule' || (run.event === 'workflow_dispatch' && run.display_title === 'pipeline (full)');
}

/**
 * A dispatch fails fast by cancelling its own run (072 FR-019), so a red one concludes `cancelled` with a failed job.
 * A run cancelled with no failed job was merely superseded by a newer one and says nothing.
 */
const failedFast = (run) => run.conclusion === 'cancelled' && (run.failed_jobs ?? 0) > 0;
const finished = (run) =>
  run.status === 'completed' && ((run.conclusion !== 'cancelled' && run.conclusion !== 'skipped') || failedFast(run));

/** What is wrong with the newest finished run in `runs`, or nothing. */
function judge(what, runs) {
  const latest = runs.find(finished);
  if (!latest) return { kind: 'master', message: `${what}: no finished run on master to judge` };
  if (failedFast(latest)) return { kind: 'master', message: `${what} failed (${latest.failed_jobs} job(s); fail-fast cancelled the rest): ${latest.html_url}` };
  if (latest.conclusion !== 'success') return { kind: 'master', message: `${what} is ${latest.conclusion}: ${latest.html_url}` };
  if (latest.run_attempt > 1) return { kind: 'master', message: `${what} went green only on attempt ${latest.run_attempt}, which is a flake: ${latest.html_url}` };
  return undefined;
}

/** Every reason this release may not start; empty when it may. */
export function evaluatePreflight({ requiredReviewers, tagPolicies, pipelineRuns, nightlyIssues }) {
  const findings = [];
  if (requiredReviewers !== 0) {
    findings.push({ kind: 'environment', message: `the release Environment has ${requiredReviewers} required reviewer rule(s); 065 FR-005 requires none` });
  }
  if (tagPolicies.join(',') !== 'tag:v*') {
    findings.push({ kind: 'environment', message: `the release Environment accepts [${tagPolicies.join(', ')}]; 065 FR-005 requires exactly tag:v*` });
  }
  const pipeline = judge('the latest full pipeline on master', pipelineRuns.filter(isFullPipeline));
  if (pipeline) findings.push(pipeline);
  for (const issue of nightlyIssues) {
    findings.push({ kind: 'master', message: `#${issue.number} is open (${issue.title}): a nightly failure stays a defect until its fix closes it` });
  }
  return findings;
}

function ghJson(path) {
  return JSON.parse(execFileSync('gh', ['api', path], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 32 * 1024 * 1024 }));
}

function failedJobCount(runId) {
  const jobs = ghJson(`repos/{owner}/{repo}/actions/runs/${runId}/jobs?per_page=100`).jobs;
  return jobs.filter((j) => j.conclusion === 'failure' || j.conclusion === 'timed_out').length;
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
    pipelineRuns: runs('pipeline.yml').map((run) =>
      run.conclusion === 'cancelled' && isFullPipeline(run)
        ? { ...run, failed_jobs: failedJobCount(run.id) }
        : run,
    ),
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
