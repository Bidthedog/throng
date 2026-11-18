import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

/**
 * 072 contracts/pipeline-dispatch.md, Guarantees: what the full pipeline may and may not do, read from the workflow's
 * shape. Only a real run would otherwise exercise them, and a run is an hour of runner time.
 *
 * Layer: unit. Reads `.github/workflows/pipeline.yml` and runs `scripts/ci-plan.sh` (the plan job's one step) against a
 * temp GITHUB_OUTPUT; nothing starts a runner.
 */

const ROOT = process.cwd();
const WORKFLOWS = join(ROOT, '.github', 'workflows');

interface Step {
  name?: string;
  if?: string;
  uses?: string;
  run?: string;
  env?: Record<string, string>;
  with?: Record<string, unknown>;
}
interface Job {
  name?: string;
  needs?: string | string[];
  if?: string;
  'runs-on'?: unknown;
  permissions?: Record<string, string>;
  environment?: unknown;
  strategy?: { matrix?: unknown; 'fail-fast'?: unknown };
  steps?: Step[];
  outputs?: Record<string, string>;
}
interface Workflow {
  name?: string;
  'run-name'?: string;
  on: Record<string, { inputs?: Record<string, unknown>; cron?: string }[] | { inputs?: Record<string, unknown> } | undefined> & {
    schedule?: { cron: string }[];
    workflow_dispatch?: { inputs: Record<string, unknown> };
  };
  concurrency?: { group: string; 'cancel-in-progress'?: unknown };
  permissions?: Record<string, string>;
  jobs: Record<string, Job>;
}

const text = readFileSync(join(WORKFLOWS, 'pipeline.yml'), 'utf8');
const pipeline = parse(text) as Workflow;
const needsOf = (job: Job): string[] => [job.needs ?? []].flat();
const ids = Object.keys(pipeline.jobs);
const NO_CANCEL = ['plan', 'verdict', 'report'];
const cancellers = ids.filter((id) => !NO_CANCEL.includes(id));

describe('triggers (contract: Triggers)', () => {
  it('are exactly schedule, workflow_dispatch and workflow_call', () => {
    expect(Object.keys(pipeline.on).sort()).toEqual(['schedule', 'workflow_call', 'workflow_dispatch']);
  });

  it('runs nightly at 01:00 UTC', () => {
    expect(pipeline.on.schedule).toEqual([{ cron: '0 1 * * *' }]);
  });

  it('takes exactly the documented dispatch inputs', () => {
    expect(Object.keys(pipeline.on.workflow_dispatch?.inputs ?? {}).sort()).toEqual(
      [
        'e2e_filter',
        'hand_tests',
        'platforms',
        'run_to_completion',
        'shards',
        'stages',
        'stress_grep',
        'stress_rounds',
        'stress_spec',
        'test_filter',
        'trace',
      ].sort(),
    );
  });

  it('offers a verdict to a caller', () => {
    const call = pipeline.on.workflow_call as { outputs?: Record<string, { value: string }> };
    expect(call.outputs?.verdict?.value).toContain('jobs.verdict.outputs');
  });
});

describe('it never publishes (FR-013, Guarantee 1)', () => {
  it.each([
    ['the signing key', /REPO_SIGNING_KEY/],
    ['the release Environment', /environment:\s*release/],
    ["a GitHub release", /gh release (create|upload|edit|delete)/],
    ['a site deployment', /workflow run pages\.yml/],
    ['a repository upload', /package-repo\.mjs\s+(sign|bundle|publish)/],
  ])('never touches %s', (_what, pattern) => {
    expect(text).not.toMatch(pattern);
  });

  it('has no job in an environment', () => {
    for (const id of ids) expect(pipeline.jobs[id]?.environment, id).toBeUndefined();
  });
});

describe('fail fast (FR-019, FR-020, Guarantee 2)', () => {
  it.each(cancellers)('%s ends with the fail-fast action, gated on failure, cancellation and the plan', (id) => {
    const steps = pipeline.jobs[id]?.steps ?? [];
    const last = steps[steps.length - 1];
    // cancelled() as well as failure(): a job that hits its timeout is cancelled, and a failure()-only step never runs in it.
    expect(last?.if, id).toBe("(failure() || cancelled()) && needs.plan.outputs.fail_fast == 'true'");
    expect(last?.uses, id).toBe('./.github/actions/fail-fast-cancel');
    expect(needsOf(pipeline.jobs[id] as Job), `${id} must need plan to read its output`).toContain('plan');
  });

  it('the fail-fast action never cancels its own run: it asks fail-fast.yml to, falling back to REST where gh is absent', () => {
    // A job that cancels its own run is cancelled with it, so the job that FAILED would read `cancelled` and only the
    // verdict would read `failure`. Handing the cancel to another workflow lets the failing job finish as `failure`.
    const action = readFileSync(join(ROOT, '.github', 'actions', 'fail-fast-cancel', 'action.yml'), 'utf8');
    expect(action).not.toContain('gh run cancel');
    expect(action).not.toContain('actions/runs/$GITHUB_RUN_ID/cancel');
    expect(action).toMatch(/gh workflow run fail-fast\.yml\b[^\n]*-f run_id="\$GITHUB_RUN_ID"/);
    expect(action).toContain('actions/workflows/fail-fast.yml/dispatches');
  });

  it('fail-fast.yml cancels the run only once every job with a failed step has finished', () => {
    const text = readFileSync(join(ROOT, '.github', 'workflows', 'fail-fast.yml'), 'utf8');
    const wf = parse(text) as { on: Record<string, { inputs?: Record<string, unknown> }>; permissions: Record<string, string> };
    expect(Object.keys(wf.on)).toEqual(['workflow_dispatch']);
    expect(wf.on.workflow_dispatch?.inputs).toHaveProperty('run_id');
    expect(wf.permissions.actions).toBe('write');
    const wait = text.indexOf('select(.status != "completed" and any(.steps[]?; .conclusion == "failure"))');
    const cancel = text.indexOf('gh run cancel');
    expect(wait, 'waits on the failing jobs').toBeGreaterThan(-1);
    expect(cancel, 'cancels after waiting').toBeGreaterThan(wait);
  });

  it('plan, verdict and report carry no cancel step', () => {
    for (const id of NO_CANCEL) expect(JSON.stringify(pipeline.jobs[id])).not.toContain('fail-fast-cancel');
  });

  it('stops a vitest run and a Playwright run at their first failing test, only when fail-fast', () => {
    const vitest = readFileSync(join(ROOT, 'scripts', 'ci-vitest.sh'), 'utf8');
    const shard = readFileSync(join(ROOT, 'scripts', 'ci-e2e-shard.sh'), 'utf8');
    // The nightly passes neither: each flag sits behind the plan's fail_fast output, never unconditional.
    expect(vitest).toMatch(/if \[ "\$fail_fast" = true \]; then args\+=\(--bail=1\)/);
    expect(shard).toContain('THRONG_E2E_FAIL_FAST=1');
    expect(shard).toMatch(/if \[ "\$fail_fast" = true \]; then args\+=\(--max-failures=1\)/);
    expect(text.match(/FAIL_FAST: \$\{\{ needs\.plan\.outputs\.fail_fast \}\}/g)?.length).toBeGreaterThanOrEqual(6);
  });

  it('never lets a matrix cancel its siblings on its own', () => {
    for (const id of ids) expect(pipeline.jobs[id]?.strategy?.['fail-fast'], id).not.toBe(true);
  });
});

describe('an empty selection fails (no --passWithNoTests)', () => {
  it('appears in no workflow', () => {
    for (const name of readdirSync(WORKFLOWS).filter((n) => /\.ya?ml$/.test(n))) {
      expect(readFileSync(join(WORKFLOWS, name), 'utf8'), name).not.toMatch(/pass-with-no-tests|passWithNoTests/i);
    }
  });
});

describe('concurrency (research R11)', () => {
  const group = pipeline.concurrency?.group ?? '';

  it('is keyed by event and ref for schedule and dispatch, and by run id for a call', () => {
    expect(group).toContain('github.event_name');
    expect(group).toContain('github.ref');
    expect(group).toContain('github.run_id');
  });

  it("can never equal the caller's release-<ref> group", () => {
    expect(group.startsWith('pipeline-')).toBe(true);
    expect(group).not.toContain('release-');
  });
});

describe('run name and permissions', () => {
  it('names a full run exactly "pipeline (full)" and any other "pipeline (partial: …)"', () => {
    const runName = pipeline['run-name'] ?? '';
    expect(runName).toContain('pipeline (full)');
    expect(runName).toContain('pipeline (partial: ');
  });

  it('grants actions: write for the cancel, and nothing broader than a job needs', () => {
    expect(pipeline.permissions).toEqual({ contents: 'read' });
    for (const id of cancellers) {
      expect(pipeline.jobs[id]?.permissions?.actions, id).toBe('write');
      expect(Object.keys(pipeline.jobs[id]?.permissions ?? {}).sort(), id).toEqual(['actions', 'contents']);
    }
    expect(pipeline.jobs.report?.permissions).toEqual({ actions: 'read', contents: 'read', issues: 'write' });
    expect(pipeline.jobs.verdict?.permissions).toEqual({ actions: 'read', contents: 'read' });
    expect(pipeline.jobs.plan?.permissions).toEqual({ contents: 'read' });
  });
});

describe('what depends on what (Guarantees 3 and 4, R3)', () => {
  const RESULT = /needs\.([\w-]+)\.result/g;
  const READABLE = ['plan', 'macos-runners', 'combinations', 'build-installer', 'build-linux', 'build-macos'];

  it('no job reads a test job result, except the verdict and the report', () => {
    for (const id of ids.filter((i) => !['verdict', 'report'].includes(i))) {
      const read = [...(pipeline.jobs[id]?.if ?? '').matchAll(RESULT)].map((m) => m[1]);
      for (const need of read) expect(READABLE, `${id} reads needs.${need}.result`).toContain(need);
    }
  });

  it('packaging needs only the plan and the runner list', () => {
    for (const id of ['build-installer', 'build-linux', 'build-macos']) {
      expect(needsOf(pipeline.jobs[id] as Job).filter((n) => !['plan', 'macos-runners'].includes(n)), id).toEqual([]);
    }
  });

  it('each verification job needs its own build, the plan and the job that writes its matrix; never another verification', () => {
    const own: Record<string, string> = {
      'verify-installer': 'build-installer',
      coexistence: 'build-installer',
      'verify-linux': 'build-linux',
      'verify-repositories': 'build-linux',
      'verify-macos': 'build-macos',
    };
    for (const [id, build] of Object.entries(own)) {
      const needs = needsOf(pipeline.jobs[id] as Job);
      expect(needs, id).toContain(build);
      const others = needs.filter((n) => ![build, 'plan', 'combinations', 'macos-runners'].includes(n));
      expect(others, `${id} waits on ${others.join(', ')}`).toEqual([]);
    }
  });

  it('the verdict and the report wait for every other job, and run whatever happened', () => {
    const others = ids.filter((id) => id !== 'verdict' && id !== 'report');
    expect(needsOf(pipeline.jobs.verdict as Job).sort()).toEqual([...others].sort());
    expect(pipeline.jobs.verdict?.if).toBe('always()');
    expect(needsOf(pipeline.jobs.report as Job).sort()).toEqual([...others, 'verdict'].sort());
  });

  it('the verdict records the tree and fails on a failed or cancelled job', () => {
    const steps = JSON.stringify(pipeline.jobs.verdict?.steps);
    expect(steps).toContain('HEAD^{tree}');
    expect(steps).toMatch(/failure/);
    expect(steps).toMatch(/cancelled/);
    expect(pipeline.jobs.verdict?.outputs?.result).toBeDefined();
  });

  it('the verdict fails a run in which no job concluded success, so an all-skipped selection is not green', () => {
    const script = (pipeline.jobs.verdict?.steps ?? []).map((s) => s.run ?? '').join('\n');
    expect(script).toContain('no selected job succeeded');
    expect(script).toMatch(/\.value\.result == "success"/);
  });

  it('verify-macos verifies only the releases the dispatch selected', () => {
    const script = (pipeline.jobs['macos-runners']?.steps ?? []).map((s) => s.run ?? '').join('\n');
    expect(script).toMatch(/matrix=.*select\(/s);
    expect(script).toContain('.runner');
    expect(script).toContain('WANT_CURRENT');
  });
});

describe('artifacts that outlive a run are kept seven days (FR-014)', () => {
  it('every build-artifact upload sets retention-days: 7', () => {
    const uploads = ids.flatMap((id) =>
      (pipeline.jobs[id]?.steps ?? [])
        .filter((s) => s.uses?.startsWith('actions/upload-artifact'))
        .map((s) => ({ id, name: String(s.with?.name ?? ''), days: s.with?.['retention-days'] })),
    );
    const builds = uploads.filter((u) => /^throng-|-upgrade-fixture$|^release-body$/.test(u.name));
    expect(builds.length).toBeGreaterThanOrEqual(7);
    for (const u of builds) expect(u.days, `${u.id}: ${u.name}`).toBe(7);
  });
});

describe('the nightly report (FR-021, contracts/nightly-report.md)', () => {
  const report = pipeline.jobs.report as Job;

  it('runs on a full run on master, whatever happened', () => {
    expect(report.if).toContain('always()');
    expect(report.if).toContain("needs.plan.outputs.full == 'true'");
    expect(report.if).toContain("github.ref == 'refs/heads/master'");
  });

  it('runs scripts/pipeline-report.mjs over the downloaded results', () => {
    const run = (report.steps ?? []).map((s) => s.run ?? '').join('\n');
    expect(run).toContain('node scripts/pipeline-report.mjs');
    for (const flag of ['--run-id', '--sha', '--ref', '--full', '--results-dir']) expect(run).toContain(flag);
    expect(JSON.stringify(report.steps)).toContain('GH_TOKEN');
  });

  it('every vitest job writes a JSON result file and uploads it', () => {
    for (const id of ['vitest-windows', 'vitest-linux', 'vitest-macos']) {
      const steps = pipeline.jobs[id]?.steps ?? [];
      expect(steps.map((s) => s.run ?? '').join('\n'), id).toContain('scripts/ci-vitest.sh');
      expect(JSON.stringify(steps), id).toContain('results-');
      expect(readFileSync(join(ROOT, 'scripts', 'ci-vitest.sh'), 'utf8')).toMatch(/--reporter=json.*--outputFile\.json=/);
      expect(steps.some((s) => s.uses?.startsWith('actions/upload-artifact')), id).toBe(true);
    }
  });

  it('the report downloads only the small JSON artifacts, never the traces and videos', () => {
    const download = (report.steps ?? []).find((s) => s.uses?.startsWith('actions/download-artifact'));
    expect(download?.with?.pattern).toBe('json-results-*');
  });

  it('every job that writes a result file uploads it alone as json-results-<platform>-…', () => {
    const json = ids.flatMap((id) =>
      (pipeline.jobs[id]?.steps ?? [])
        .filter((s) => s.uses?.startsWith('actions/upload-artifact') && String(s.with?.name).startsWith('json-results-'))
        .map((s) => ({ id, name: String(s.with?.name), path: String(s.with?.path) })),
    );
    for (const id of ['vitest-windows', 'vitest-linux', 'vitest-macos', 'e2e-windows', 'e2e-linux', 'e2e-macos', 'admin', 'calibration']) {
      const mine = json.filter((u) => u.id === id);
      expect(mine.length, id).toBe(1);
      // The platform is read from the path by the report script.
      expect(mine[0]?.name, id).toMatch(/windows|linux|macos/);
      expect(mine[0]?.path, id).toMatch(/\.json/);
      expect(mine[0]?.path, id).not.toMatch(/test-results\//);
    }
  });

  it('every E2E job writes the Playwright JSON report and uploads it', () => {
    for (const id of ['e2e-windows', 'e2e-linux', 'e2e-macos', 'admin', 'calibration']) {
      const steps = pipeline.jobs[id]?.steps ?? [];
      expect(JSON.stringify(pipeline.jobs[id]), id).toMatch(/THRONG_E2E_JSON_OUT|admin-report\.json/);
      expect(steps.some((s) => s.uses?.startsWith('actions/upload-artifact')), id).toBe(true);
    }
  });
});

describe('the dispatch inputs reach the jobs (FR-017, contract: Dispatch inputs)', () => {
  const SELECTED = [
    'lint',
    'vitest-windows',
    'vitest-linux',
    'vitest-macos',
    'e2e-windows',
    'e2e-linux',
    'e2e-macos',
    'admin',
    'calibration',
    'macos-latency',
    'build-installer',
    'build-linux',
    'build-macos',
    'stress',
    'hand-tests',
  ];

  it.each(SELECTED)('%s is selected by the plan, not by another job', (id) => {
    expect(pipeline.jobs[id]?.if, id).toMatch(/needs\.plan\.outputs\./);
  });

  it('a platform-specific job also reads its platform flag', () => {
    expect(pipeline.jobs['vitest-windows']?.if).toContain('p_windows');
    expect(pipeline.jobs['vitest-linux']?.if).toContain('p_linux');
    expect(pipeline.jobs['e2e-macos']?.if).toContain('p_macos');
    expect(pipeline.jobs.admin?.if).toContain('p_windows');
  });

  it('the stress job runs one spec for N rounds with retries off and uploads every round', () => {
    const stress = pipeline.jobs.stress as Job;
    expect(stress.if).toContain('stress');
    const script = readFileSync(join(ROOT, 'scripts', 'ci-stress-rounds.sh'), 'utf8');
    expect(script).toContain('--retries=0');
    expect(JSON.stringify(stress.steps)).toContain('ci-stress-rounds.sh');
    const upload = (stress.steps ?? []).find((s) => s.uses?.startsWith('actions/upload-artifact'));
    expect(JSON.stringify(upload?.with)).toContain('round-');
  });

  it('the hand tests run only on a dispatch that asked for them', () => {
    expect(pipeline.jobs['hand-tests']?.if).toContain("needs.plan.outputs.hand_tests == 'true'");
  });
});

describe('the plan (scripts/ci-plan.sh, FR-018)', () => {
  const plan = (env: Record<string, string>): { code: number; out: Record<string, string>; stderr: string } => {
    const dir = mkdtempSync(join(tmpdir(), 'ci-plan-'));
    try {
      const outFile = join(dir, 'out');
      const r = spawnSync('bash', [join(ROOT, 'scripts', 'ci-plan.sh')], {
        env: { PATH: process.env.PATH ?? '', GITHUB_OUTPUT: outFile, ...env },
        encoding: 'utf8',
      });
      let out: Record<string, string> = {};
      try {
        out = Object.fromEntries(
          readFileSync(outFile, 'utf8')
            .split('\n')
            .filter((l) => l.includes('='))
            .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
        );
      } catch {
        // No output file: the script refused.
      }
      return { code: r.status ?? -1, out, stderr: r.stderr };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };

  it('is full, nightly and not fail-fast on a schedule', () => {
    const { out, code, stderr } = plan({ EVENT: 'schedule' });
    // The script's own word when it refuses: on a hosted macOS runner this once came back empty, with nothing to say why.
    expect(out, `ci-plan.sh exited ${code}: ${stderr}`).toMatchObject({ mode: 'nightly', fail_fast: 'false', full: 'true', stage_e2e: 'true', p_windows: 'true', p_linux: 'true', p_macos: 'true' });
  });

  it('is full and fail-fast on a call, whatever inputs reach it', () => {
    const { out } = plan({ EVENT: 'push', STAGES: 'unit', PLATFORMS: 'linux', E2E_FILTER: '@editor', HAND_TESTS: 'true', TRACE: 'true' });
    expect(out).toMatchObject({ mode: 'agent', fail_fast: 'true', full: 'true', stage_e2e: 'true', p_windows: 'true', hand_tests: 'false', trace: 'false', e2e_filter: '' });
  });

  it('is full on a dispatch with every default', () => {
    expect(plan({ EVENT: 'workflow_dispatch', STAGES: 'all', PLATFORMS: 'all' }).out).toMatchObject({ mode: 'agent', fail_fast: 'true', full: 'true' });
    expect(plan({ EVENT: 'workflow_dispatch' }).out.full).toBe('true');
  });

  it.each([
    ['a stage subset', { STAGES: 'unit' }],
    ['a platform subset', { PLATFORMS: 'windows' }],
    ['an E2E filter', { E2E_FILTER: '@editor' }],
    ['a test filter', { TEST_FILTER: 'packages/core/tests/unit/x.test.ts' }],
    ['a stress input', { STRESS_SPEC: 'packages/ui/tests/e2e/x.e2e.ts' }],
  ])('is partial on %s', (_what, env) => {
    expect(plan({ EVENT: 'workflow_dispatch', ...env }).out.full).toBe('false');
  });

  it('selects only the named stages and platforms', () => {
    const { out } = plan({ EVENT: 'workflow_dispatch', STAGES: 'unit,component', PLATFORMS: 'windows' });
    expect(out).toMatchObject({ stage_unit: 'true', stage_component: 'true', stage_e2e: 'false', stage_package: 'false', p_windows: 'true', p_linux: 'false', p_macos: 'false' });
    expect(out.layers).toBe('["unit","component"]');
  });

  it('selects one macOS release by its slot', () => {
    const { out } = plan({ EVENT: 'workflow_dispatch', STAGES: 'unit', PLATFORMS: 'macos-previous' });
    expect(out).toMatchObject({ p_macos: 'true', p_macos_current: 'false', p_macos_previous: 'true', p_windows: 'false' });
  });

  it('gives each platform its shard count, and one shard to a filtered run', () => {
    expect(plan({ EVENT: 'schedule' }).out).toMatchObject({ shards_windows: '[1,2,3,4]', shards_linux: '[1,2]', shards_macos: '[1,2]', shard_n_windows: '4' });
    expect(plan({ EVENT: 'workflow_dispatch', SHARDS: 'windows=2,linux=3' }).out).toMatchObject({ shards_windows: '[1,2]', shards_linux: '[1,2,3]', shards_macos: '[1,2]' });
    expect(plan({ EVENT: 'workflow_dispatch', E2E_FILTER: '@editor' }).out).toMatchObject({ shards_windows: '[1]', shard_n_windows: '1', e2e_filter: '@editor' });
  });

  it('turns a stress input into one stress run on one platform and nothing else', () => {
    const { out } = plan({ EVENT: 'workflow_dispatch', STRESS_SPEC: 'packages/ui/tests/e2e/x.e2e.ts', STRESS_ROUNDS: '5' });
    expect(out).toMatchObject({ stress: 'true', stress_platform: 'windows', stress_rounds: '5', stage_e2e: 'false', stage_unit: 'false', stage_package: 'false', full: 'false' });
    expect(plan({ EVENT: 'workflow_dispatch', STRESS_SPEC: 'packages/ui/tests/e2e/x.e2e.ts', PLATFORMS: 'linux' }).out.stress_platform).toBe('linux');
  });

  it('runs a test path in the one layer that owns it, and a name pattern in every selected layer', () => {
    expect(plan({ EVENT: 'workflow_dispatch', TEST_FILTER: 'packages/core/tests/unit/x.test.ts' }).out.layers).toBe('["unit"]');
    expect(plan({ EVENT: 'workflow_dispatch', TEST_FILTER: 'packages/ui/tests/component/x.test.tsx' }).out.layers).toBe('["component"]');
    expect(plan({ EVENT: 'workflow_dispatch', TEST_FILTER: 'packages/daemon/tests/integration/x.test.ts' }).out.layers).toBe('["integration"]');
    expect(plan({ EVENT: 'workflow_dispatch', TEST_FILTER: 'packages/core/tests/contract/x.test.ts' }).out.layers).toBe('["contract"]');
    expect(plan({ EVENT: 'workflow_dispatch', TEST_FILTER: 'some test name' }).out.layers).toBe('["unit","component","integration","contract"]');
  });

  it('accepts verify with package', () => {
    expect(plan({ EVENT: 'workflow_dispatch', STAGES: 'package,verify' }).out).toMatchObject({ stage_package: 'true', stage_verify: 'true' });
  });

  it('sets hand_tests and trace only on a dispatch', () => {
    expect(plan({ EVENT: 'schedule', HAND_TESTS: 'true', TRACE: 'true' }).out).toMatchObject({ hand_tests: 'false', trace: 'false' });
    expect(plan({ EVENT: 'workflow_dispatch', HAND_TESTS: 'true', TRACE: 'true' }).out).toMatchObject({ hand_tests: 'true', trace: 'true' });
  });

  it('runs a dispatch to completion only when asked, and never a release', () => {
    // A sweep for every failure at once (the nightly's behaviour); a dispatch still fails fast by default.
    expect(plan({ EVENT: 'workflow_dispatch', RUN_TO_COMPLETION: 'true' }).out).toMatchObject({ mode: 'agent', fail_fast: 'false' });
    expect(plan({ EVENT: 'workflow_dispatch' }).out).toMatchObject({ fail_fast: 'true' });
    // release.yml's call stops at the first failure whatever is passed: nothing publishes from a red run anyway.
    expect(plan({ EVENT: 'push', RUN_TO_COMPLETION: 'true' }).out).toMatchObject({ fail_fast: 'true' });
  });

  it.each([
    ['an unknown stage', { STAGES: 'unit,bogus' }],
    ['an unknown platform', { PLATFORMS: 'beos' }],
    ['a stage no selected platform can run', { STAGES: 'admin', PLATFORMS: 'linux' }],
    ['a shard count that is not a number', { SHARDS: 'windows=x' }],
    ['a stress spec that is not an .e2e.ts path', { STRESS_SPEC: 'rm -rf /' }],
    ['a filter carrying a shell metacharacter', { TEST_FILTER: '$(id)' }],
    ['verify without package, which would skip every verification job', { STAGES: 'verify' }],
    ['calibration with an e2e_filter, which skips the calibration job', { STAGES: 'calibration', E2E_FILTER: '@editor' }],
    ['a test path no layer owns', { STAGES: 'unit', TEST_FILTER: 'packages/ui/src/x.test.ts' }],
    ['a test path for a layer the stages leave out', { STAGES: 'unit', TEST_FILTER: 'packages/ui/tests/component/x.test.tsx' }],
  ])('refuses %s, so a typo fails the run rather than running nothing', (_what, env) => {
    const r = plan({ EVENT: 'workflow_dispatch', ...env });
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('::error::');
  });
});
