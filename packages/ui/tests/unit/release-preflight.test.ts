/**
 * What may start a release (065 FR-005, FR-013): master proved green, with nothing passing only on a
 * re-run, and a `release` Environment that will not stop the pipeline for a person.
 */
import { describe, expect, it } from 'vitest';
import { evaluatePreflight, isFullGate } from '../../../../scripts/release-preflight.mjs';

const run = (over: Record<string, unknown> = {}) => ({
  status: 'completed',
  conclusion: 'success',
  run_attempt: 1,
  event: 'schedule',
  display_title: 'gate (full gate)',
  html_url: 'https://example.test/run',
  ...over,
});

const green = () => ({
  requiredReviewers: 0,
  tagPolicies: ['tag:v*'],
  releaseRuns: [run({ event: 'push', display_title: 'chore' })],
  gateRuns: [run()],
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

  it('refuses a red master release run', () => {
    expect(kinds({ ...green(), releaseRuns: [run({ conclusion: 'failure' })] })).toEqual(['master']);
  });

  it('refuses a run that went green only on a re-run', () => {
    expect(kinds({ ...green(), releaseRuns: [run({ run_attempt: 2 })] })).toEqual(['master']);
    expect(kinds({ ...green(), gateRuns: [run({ run_attempt: 2 })] })).toEqual(['master']);
  });

  it('reads past cancelled and unfinished runs to the latest verdict', () => {
    const releaseRuns = [run({ status: 'in_progress', conclusion: null }), run({ conclusion: 'cancelled' }), run({ conclusion: 'failure' })];
    expect(kinds({ ...green(), releaseRuns })).toEqual(['master']);
  });

  it('judges only full gates: a partial dispatch cannot hide a red nightly', () => {
    const gateRuns = [run({ event: 'workflow_dispatch', display_title: 'gate (lint)' }), run({ conclusion: 'failure' })];
    expect(kinds({ ...green(), gateRuns })).toEqual(['master']);
  });

  it('accepts a newer full dispatch over an older red nightly', () => {
    const gateRuns = [run({ event: 'workflow_dispatch' }), run({ conclusion: 'failure' })];
    expect(kinds({ ...green(), gateRuns })).toEqual([]);
  });

  it('refuses when no verdict exists at all', () => {
    expect(kinds({ ...green(), releaseRuns: [] })).toEqual(['master']);
    expect(kinds({ ...green(), gateRuns: [] })).toEqual(['master']);
  });

  it('refuses while a nightly failure is still open: a flake is not fixed by the next green run', () => {
    expect(kinds({ ...green(), nightlyIssues: [{ number: 599, title: 'Nightly gate failed on master' }] })).toEqual(['master']);
  });

  it('counts a nightly as full, and a stress or partial dispatch as not', () => {
    expect(isFullGate(run({ display_title: 'anything' }))).toBe(true);
    expect(isFullGate(run({ event: 'workflow_dispatch' }))).toBe(true);
    expect(isFullGate(run({ event: 'workflow_dispatch', display_title: 'gate (stress)' }))).toBe(false);
    expect(isFullGate(run({ event: 'pull_request' }))).toBe(false);
  });
});
