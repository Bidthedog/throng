import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

/**
 * 065 FR-001 to FR-004: a release runs from tag to publish with nobody waiting on it, and what stands in for the human
 * sign-off it replaces. These are properties of the workflow's shape, which only a real publish would otherwise exercise.
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
  steps?: Step[];
}
interface Workflow {
  on: { workflow_dispatch?: { inputs?: Record<string, unknown> } };
  jobs: Record<string, Job>;
}

const text = readFileSync(join(ROOT, '.github', 'workflows', 'release.yml'), 'utf8');
const release = parse(text) as Workflow;
const PUBLISHING = ['sign-index', 'publish'] as const;

describe('an unattended release (065)', () => {
  it('no step supplies a human sign-off (FR-001)', () => {
    expect(text).not.toMatch(/THRONG_QA_SIGNED_OFF/);
    expect(text).not.toMatch(/QA sign-off is missing/);
  });

  it('only a version tag can publish: a dispatch is always a rehearsal (FR-002)', () => {
    expect(release.on.workflow_dispatch?.inputs).not.toHaveProperty('publish');
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

  it('publishes when the E2E verdict is reused, and only when every job it needs succeeded (FR-002)', () => {
    // A job `if` with no status function is ANDed with GitHub's implicit success(), which is false when ANY
    // upstream job was skipped. e2e-full is skipped whenever e2e-reuse reuses the gate's verdict, so alpha16's
    // tag built and verified everything and then skipped sign-index, publish and deploy-repositories.
    const needsOf = (job: Job): string[] => (job.needs === undefined ? [] : Array.isArray(job.needs) ? job.needs : [job.needs]);
    for (const id of [...PUBLISHING, 'deploy-repositories']) {
      const job = release.jobs[id] as Job;
      expect(job.if, `${id} has no status function, so a skipped e2e-full skips it`).toMatch(/!cancelled\(\)/);
      for (const need of needsOf(job)) {
        expect(job.if, `${id} runs without ${need} having succeeded`).toContain(`needs.${need}.result == 'success'`);
      }
    }
  });

  it('the rendered body is refused for any unmet condition, not all but one (FR-004)', () => {
    const steps = release.jobs['render-body']?.steps ?? [];
    const gate = steps.find((step) => step.run?.includes('publish-gates.mjs'));
    expect(gate?.run).toBeDefined();
    expect(gate?.run).not.toMatch(/grep -q/);
  });
});
