/**
 * What may start a release (065 FR-005, FR-013; 072 FR-027): master proved green by its latest FULL pipeline run, with
 * nothing passing only on a re-run, no nightly failure left open, and a `release` Environment that will not stop the
 * pipeline for a person. Nothing runs release.yml on master any more (072 FR-010), so there is no master release run to
 * judge.
 */
import { describe, expect, it } from 'vitest';
import { evaluatePreflight, isFullPipeline } from '../../../../scripts/release-preflight.mjs';

const run = (over: Record<string, unknown> = {}) => ({
  status: 'completed',
  conclusion: 'success',
  run_attempt: 1,
  event: 'schedule',
  display_title: 'pipeline (full)',
  html_url: 'https://example.test/run',
  ...over,
});

const green = () => ({
  requiredReviewers: 0,
  tagPolicies: ['tag:v*'],
  pipelineRuns: [run()],
  nightlyIssues: [] as { number: number; title: string }[],
});

const kinds = (facts: ReturnType<typeof green>) => evaluatePreflight(facts).map((f: { kind: string }) => f.kind);

describe('the release preflight', () => {
  it('passes a green master and a correct Environment', () => {
    expect(evaluatePreflight(green())).toEqual([]);
  });

  it('refuses a required reviewer, and a tag policy that is not exactly v*', () => {
    expect(kinds({ ...green(), requiredReviewers: 1 })).toEqual(['environment']);
    expect(kinds({ ...green(), tagPolicies: [] })).toEqual(['environment']);
    expect(kinds({ ...green(), tagPolicies: ['tag:v*', 'branch:master'] })).toEqual(['environment']);
  });

  it('refuses a red latest full pipeline', () => {
    expect(kinds({ ...green(), pipelineRuns: [run({ conclusion: 'failure' })] })).toEqual(['master']);
  });

  it('refuses a run that went green only on a re-run', () => {
    expect(kinds({ ...green(), pipelineRuns: [run({ run_attempt: 2 })] })).toEqual(['master']);
  });

  it('reads past cancelled and unfinished runs to the latest verdict', () => {
    const pipelineRuns = [
      run({ status: 'in_progress', conclusion: null }),
      run({ conclusion: 'cancelled' }),
      run({ conclusion: 'failure' }),
    ];
    expect(kinds({ ...green(), pipelineRuns })).toEqual(['master']);
  });

  it('reads a dispatch that fail-fast cancelled after a job failed as red, and a merely superseded one as nothing', () => {
    // A failing dispatch cancels its own run (072 FR-019), so it concludes `cancelled`, not `failure`.
    const failedFast = run({ event: 'workflow_dispatch', conclusion: 'cancelled', failed_jobs: 1 });
    expect(kinds({ ...green(), pipelineRuns: [failedFast, run()] })).toEqual(['master']);
    const superseded = run({ event: 'workflow_dispatch', conclusion: 'cancelled', failed_jobs: 0 });
    expect(kinds({ ...green(), pipelineRuns: [superseded, run()] })).toEqual([]);
  });

  it('judges only full runs: a partial dispatch cannot hide a red nightly', () => {
    const pipelineRuns = [
      run({ event: 'workflow_dispatch', display_title: 'pipeline (partial: unit on windows)' }),
      run({ conclusion: 'failure' }),
    ];
    expect(kinds({ ...green(), pipelineRuns })).toEqual(['master']);
  });

  it('accepts a newer full dispatch over an older red nightly', () => {
    const pipelineRuns = [run({ event: 'workflow_dispatch' }), run({ conclusion: 'failure' })];
    expect(kinds({ ...green(), pipelineRuns })).toEqual([]);
  });

  it('refuses when no full pipeline has run on master', () => {
    expect(kinds({ ...green(), pipelineRuns: [] })).toEqual(['master']);
  });

  it('refuses while a nightly failure is still open: a flake is not fixed by the next green run', () => {
    expect(kinds({ ...green(), nightlyIssues: [{ number: 599, title: 'Nightly pipeline failed on master' }] })).toEqual([
      'master',
    ]);
  });

  it('counts a nightly and a full dispatch as full; a partial, a stress run or a release call as not', () => {
    expect(isFullPipeline(run({ display_title: 'anything' }))).toBe(true);
    expect(isFullPipeline(run({ event: 'workflow_dispatch' }))).toBe(true);
    expect(isFullPipeline(run({ event: 'workflow_dispatch', display_title: 'pipeline (partial: e2e on linux)' }))).toBe(
      false,
    );
    expect(isFullPipeline(run({ event: 'push' }))).toBe(false);
    expect(isFullPipeline(run({ event: 'pull_request' }))).toBe(false);
  });
});
