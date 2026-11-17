import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

/**
 * 065 FR-001 to FR-004 and 072 contracts/release-run.md: a release runs from tag to publish with nobody waiting on it, it
 * runs the full pipeline first, and what stands in for the human sign-off it replaces. These are properties of the
 * workflow's shape, which only a real publish would otherwise exercise.
 */

const ROOT = process.cwd();

interface Step {
  name?: string;
  env?: Record<string, string>;
  run?: string;
}
interface Job {
  needs?: string | string[];
  environment?: string | { name: string };
  if?: string;
  uses?: string;
  secrets?: unknown;
  permissions?: Record<string, string>;
  steps?: Step[];
}
interface Workflow {
  on: Record<string, { tags?: string[]; branches?: string[]; inputs?: unknown } | null>;
  concurrency?: { group: string; 'cancel-in-progress'?: unknown };
  jobs: Record<string, Job>;
}

const text = readFileSync(join(ROOT, '.github', 'workflows', 'release.yml'), 'utf8');
const release = parse(text) as Workflow;
const pipelineText = readFileSync(join(ROOT, '.github', 'workflows', 'pipeline.yml'), 'utf8');
const pipeline = parse(pipelineText) as { jobs: Record<string, Job> };
const PUBLISHING = ['sign-index', 'publish'] as const;
const needsOf = (job: Job): string[] => (job.needs === undefined ? [] : Array.isArray(job.needs) ? job.needs : [job.needs]);

describe('what starts a release (072 FR-022, FR-025)', () => {
  it('is a pushed v* tag and nothing else: no branch, no dispatch, no input', () => {
    expect(Object.keys(release.on)).toEqual(['push']);
    expect(release.on.push?.tags).toEqual(['v*']);
    expect(release.on.push?.branches).toBeUndefined();
    expect(text).not.toMatch(/workflow_dispatch|inputs:/);
  });

  it('has no way to skip or reuse the pipeline, or to rehearse the manual plan', () => {
    for (const gone of ['e2e-reuse', 'e2e-full', 'skip_e2e', 'hand_tests', 'trace']) expect(text, gone).not.toContain(gone);
  });

  it('cancels an older run of the same tag, in a group the called pipeline does not share (FR-026)', () => {
    expect(release.concurrency?.group).toBe('release-${{ github.ref }}');
    expect(release.concurrency?.['cancel-in-progress']).toBe(true);
    expect(pipelineText).not.toContain('release-${{ github.ref }}');
  });
});

describe('the full pipeline comes first (072 FR-022, FR-024)', () => {
  it('checks the tagged commit is on master, then calls pipeline.yml, in that order', () => {
    const onMaster = release.jobs['on-master'] as Job;
    expect(JSON.stringify(onMaster.steps)).toContain('merge-base --is-ancestor');
    const call = release.jobs.pipeline as Job;
    expect(call.uses).toBe('./.github/workflows/pipeline.yml');
    expect(needsOf(call)).toEqual(['on-master']);
  });

  it('passes no secret: the pipeline publishes nothing and needs none', () => {
    expect(release.jobs.pipeline?.secrets).toBeUndefined();
    expect(text).not.toContain('secrets: inherit');
  });

  it('grants the called jobs at least what they request, so the run is valid', () => {
    const rank = { none: 0, read: 1, write: 2 } as Record<string, number>;
    const granted = release.jobs.pipeline?.permissions ?? {};
    expect(granted.actions).toBe('write');
    expect(granted.contents).toBe('read');
    for (const [id, job] of Object.entries(pipeline.jobs)) {
      for (const [scope, level] of Object.entries(job.permissions ?? {})) {
        expect(rank[granted[scope] ?? 'none'], `${id} needs ${scope}: ${level}`).toBeGreaterThanOrEqual(rank[level] ?? 0);
      }
    }
  });

  it('signing, publishing and the repositories wait for the pipeline', () => {
    for (const id of [...PUBLISHING]) expect(needsOf(release.jobs[id] as Job), id).toContain('pipeline');
    expect(needsOf(release.jobs.publish as Job)).toContain('sign-index');
    expect(needsOf(release.jobs['deploy-repositories'] as Job)).toEqual(['publish']);
  });

  it('keeps no build or verification job of its own: the pipeline owns them', () => {
    expect(Object.keys(release.jobs).sort()).toEqual(['deploy-repositories', 'on-master', 'pipeline', 'publish', 'sign-index']);
  });
});

describe('an unattended release (065)', () => {
  it('no step supplies a human sign-off (FR-001)', () => {
    expect(text).not.toMatch(/THRONG_QA_SIGNED_OFF/);
    expect(text).not.toMatch(/QA sign-off is missing/);
  });

  it('only a version tag can publish (FR-002)', () => {
    for (const id of PUBLISHING) {
      const job = release.jobs[id];
      expect(job?.if, id).toMatch(/startsWith\(github\.ref, 'refs\/tags\/v'\)/);
      expect(job?.if, id).not.toMatch(/workflow_dispatch/);
    }
  });

  it('every publishing job refuses a tag whose commit is not on master (FR-003)', () => {
    for (const id of PUBLISHING) {
      const steps = release.jobs[id]?.steps ?? [];
      const guard = steps.findIndex((step) => step.run?.includes('merge-base --is-ancestor'));
      expect(guard, `${id} has no on-master guard`).toBeGreaterThanOrEqual(0);
      // Before anything that reads a secret or creates the release.
      const firstSensitive = steps.findIndex(
        (step) => JSON.stringify(step).includes('secrets.') || step.run?.includes('gh release create'),
      );
      expect(guard, `${id} guards too late`).toBeLessThan(firstSensitive);
    }
  });

  it('publishes only when every job it needs succeeded (FR-002)', () => {
    // A job `if` with no status function is ANDed with GitHub's implicit success(), which is false when ANY upstream job
    // was skipped. alpha16's tag built and verified everything and then skipped sign-index, publish and
    // deploy-repositories. Every need is named, with its own result.
    for (const id of [...PUBLISHING, 'deploy-repositories']) {
      const job = release.jobs[id] as Job;
      expect(job.if, `${id} has no status function`).toMatch(/!cancelled\(\)/);
      for (const need of needsOf(job)) {
        expect(job.if, `${id} runs without ${need} having succeeded`).toContain(`needs.${need}.result == 'success'`);
      }
    }
  });

  it('the rendered body is refused for any unmet condition, not all but one (FR-004)', () => {
    const steps = pipeline.jobs['render-body']?.steps ?? [];
    const gate = steps.find((step) => step.run?.includes('publish-gates.mjs'));
    expect(gate?.run).toBeDefined();
    expect(gate?.run).not.toMatch(/grep -q/);
  });
});
