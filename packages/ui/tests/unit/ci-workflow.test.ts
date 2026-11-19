import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

/**
 * 072 contracts/ci-verdict.md: PR CI runs only on pull requests, only on Linux, with no E2E, never fails fast, and ends
 * in one `CI verdict` check, the only required check on master (FR-001 to FR-009). A pull request that changes only files no
 * job reads skips the work jobs and passes the verdict (FR-004a).
 *
 * Layer: unit. Reads `.github/workflows/ci.yml`; nothing runs.
 */

const ROOT = process.cwd();

interface Step {
  name?: string;
  uses?: string;
  with?: Record<string, unknown>;
  id?: string;
  if?: string;
  run?: string;
  env?: Record<string, string>;
}
interface Job {
  name?: string;
  outputs?: Record<string, string>;
  needs?: string | string[];
  if?: string;
  'runs-on'?: unknown;
  strategy?: { 'fail-fast'?: unknown; matrix?: Record<string, unknown> };
  steps?: Step[];
}
interface Workflow {
  on: { pull_request?: { branches?: string[]; types?: string[] }; [trigger: string]: unknown };
  concurrency?: { group: string; 'cancel-in-progress'?: unknown };
  jobs: Record<string, Job>;
}

const text = readFileSync(join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');
const ci = parse(text) as Workflow;
const needsOf = (job: Job): string[] => [job.needs ?? []].flat();
const ids = Object.keys(ci.jobs);
const runs = (job: Job): string => (job.steps ?? []).map((s) => s.run ?? '').join('\n');
/** The jobs that run a layer: everything but the change check and the verdict. */
const WORK = ids.filter((i) => i !== 'verdict' && i !== 'changes');

describe('the trigger (FR-001, FR-009, FR-010)', () => {
  it('is exactly pull_request, with the four types, and nothing else', () => {
    expect(Object.keys(ci.on)).toEqual(['pull_request']);
    expect(ci.on.pull_request?.branches).toEqual(['master']);
    expect(ci.on.pull_request?.types?.slice().sort()).toEqual(['opened', 'ready_for_review', 'reopened', 'synchronize']);
  });

  it('has no draft guard: a draft gets a verdict too', () => {
    expect(text).not.toMatch(/\.draft/);
  });

  it('cancels an older run of the same pull request', () => {
    expect(ci.concurrency?.group).toContain('github.event.pull_request.number');
    expect(ci.concurrency?.group.startsWith('ci-')).toBe(true);
    expect(ci.concurrency?.['cancel-in-progress']).toBe(true);
  });
});

describe('Linux only, no E2E (FR-006, FR-007)', () => {
  it('every job runs on ubuntu-24.04', () => {
    for (const id of ids) expect(ci.jobs[id]?.['runs-on'], id).toBe('ubuntu-24.04');
  });

  it('starts no Playwright run and no E2E script', () => {
    expect(text).not.toMatch(/playwright|test:e2e|e2e-/i);
  });

  it('names no Windows or macOS runner', () => {
    expect(text).not.toMatch(/windows-|macos|xcode-/i);
  });
});

describe('the jobs (FR-002, FR-003, FR-005)', () => {
  it('are the change check, lint, unit, component, contract, integration and the verdict', () => {
    expect(ids.slice().sort()).toEqual(['changes', 'component', 'contract', 'integration', 'lint', 'unit', 'verdict']);
  });

  it('run in parallel: the work jobs wait only on the change check, which reads a list and waits on nothing', () => {
    expect(needsOf(ci.jobs.changes as Job)).toEqual([]);
    for (const id of WORK) expect(needsOf(ci.jobs[id] as Job), id).toEqual(['changes']);
  });

  it('lint and typecheck run once, in one job', () => {
    expect(runs(ci.jobs.lint as Job)).toContain('npm run lint');
    expect(runs(ci.jobs.lint as Job)).toContain('npm run typecheck');
  });

  it('component runs in two vitest shards', () => {
    expect(ci.jobs.component?.strategy?.matrix?.shard).toEqual([1, 2]);
    expect(runs(ci.jobs.component as Job)).toMatch(/--shard=\$\{\{ matrix\.shard \}\}\/2/);
  });

  it('integration runs only the tagged subset, selected by critical-path, and does not build the daemon (research R6)', () => {
    const integration = runs(ci.jobs.integration as Job);
    expect(integration).toContain('--project integration');
    expect(integration).toContain('--tags-filter=critical-path');
    expect(integration).not.toContain('npm run build');
  });

  it('contract spawns the real daemon, so it builds first', () => {
    const contract = runs(ci.jobs.contract as Job);
    expect(contract.indexOf('npm run build')).toBeGreaterThanOrEqual(0);
    expect(contract.indexOf('npm run build')).toBeLessThan(contract.indexOf('test:contract'));
  });

  it('every layer runs in its own job, with the npm cache on', () => {
    for (const id of WORK) {
      expect(JSON.stringify(ci.jobs[id]?.steps), id).toContain('"cache":"npm"');
    }
  });

  it('never passes with no tests', () => {
    expect(text).not.toMatch(/pass-with-no-tests|passWithNoTests/i);
  });
});

describe('the change check (FR-004a)', () => {
  const changes = ci.jobs.changes as Job;

  it('diffs the merge commit against its first parent, the base it would land on', () => {
    const checkout = (changes.steps ?? []).find((s) => s.uses?.startsWith('actions/checkout@'));
    expect(checkout?.with?.['fetch-depth']).toBe(2);
    expect(runs(changes)).toMatch(/git diff --name-only HEAD\^1 HEAD/);
  });

  it('answers through scripts/ci-changes.mjs, with no install', () => {
    expect(runs(changes)).toContain('node scripts/ci-changes.mjs');
    expect(runs(changes)).not.toContain('npm ci');
    expect(changes.outputs?.code).toMatch(/steps\.\w+\.outputs\.code/);
  });

  it('gates every work job, which runs only when a changed file can affect it', () => {
    for (const id of WORK) expect(ci.jobs[id]?.if, id).toBe("needs.changes.outputs.code == 'true'");
  });
});

describe('the CI verdict (FR-004)', () => {
  const verdict = ci.jobs.verdict as Job;

  it('is named CI verdict, waits for every other job and runs whatever happened', () => {
    expect(verdict.name).toBe('CI verdict');
    expect(needsOf(verdict).slice().sort()).toEqual(ids.filter((i) => i !== 'verdict').sort());
    expect(verdict.if).toBe('always()');
  });

  it('fails on anything but success: a failed, cancelled or skipped job', () => {
    const script = runs(verdict);
    expect(script).toContain('NEEDS');
    expect(JSON.stringify(verdict.steps)).toContain('toJSON(needs)');
    expect(script).toMatch(/!= "success"|!= 'success'/);
    expect(script).toMatch(/exit 1/);
  });

  it('passes over skipped work jobs only when the change check succeeded and found nothing they read (FR-004a)', () => {
    const script = runs(verdict);
    expect(script).toMatch(/\.changes\.result/);
    expect(script).toMatch(/\.changes\.outputs\.code/);
    // The skip is answered by the change check alone: a failed check never reads as "nothing to run".
    expect(script.indexOf('.changes.result')).toBeLessThan(script.indexOf('.changes.outputs.code'));
  });
});

describe('no job fails fast (FR-002)', () => {
  it('has no fail-fast matrix and no run-cancel step', () => {
    for (const id of ids) expect(ci.jobs[id]?.strategy?.['fail-fast'], id).not.toBe(true);
    expect(text).not.toMatch(/gh run cancel|fail-fast:\s*true|cancel-in-progress:\s*false/);
  });
});
