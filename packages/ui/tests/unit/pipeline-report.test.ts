/**
 * 072 FR-021: a nightly with any failure leaves ONE consolidated report on master's single nightly-failure issue, and a
 * later fully green full run on master closes it. Partial and branch runs never touch it.
 *
 * Layer: unit. `scripts/pipeline-report.mjs` takes the GitHub API as an injected object, so every branch is exercised
 * without a network (contracts/nightly-report.md).
 */
import { describe, expect, it } from 'vitest';
import {
  ISSUE_TITLE,
  collectTests,
  decide,
  readResults,
  renderReport,
  runReport,
} from '../../../../scripts/pipeline-report.mjs';

describe('readResults', () => {
  // A night where every job broke before testing uploads no result, so the download creates no folder. The report must
  // still be written: that night is exactly the one it exists for (072 code review).
  it('reads no results, rather than throwing, when the folder was never created', () => {
    expect(readResults('/nonexistent/072-results')).toEqual([]);
  });
});

const RUN = 'https://github.com/o/r/actions/runs/42';
const job = (name: string, conclusion: string, id = name.length) => ({
  name,
  conclusion,
  html_url: `${RUN}/job/${id}`,
});

const vitest = (file: string, ...failed: string[]) => ({
  testResults: [
    {
      name: `/home/runner/work/throng/throng/${file}`,
      assertionResults: [
        { title: 'passes', fullName: 'suite passes', ancestorTitles: ['suite'], status: 'passed' },
        ...failed.map((t) => ({ title: t, fullName: `suite ${t}`, ancestorTitles: ['suite'], status: 'failed' })),
      ],
    },
  ],
});

const playwright = (file: string, tests: { title: string; status: string }[]) => ({
  config: {},
  suites: [
    {
      title: file,
      file,
      specs: tests.map((t) => ({ title: t.title, file, tests: [{ status: t.status }] })),
      suites: [],
    },
  ],
});

describe('collectTests', () => {
  it('reads failed vitest tests with platform and layer from the file name', () => {
    const tests = collectTests([
      { path: 'results/results-windows-unit.json', json: vitest('packages/core/tests/unit/a.test.ts', 'breaks') },
    ]);
    expect(tests).toEqual([
      {
        file: 'packages/core/tests/unit/a.test.ts',
        title: 'suite breaks',
        platform: 'windows',
        layer: 'unit',
        kind: 'failed',
      },
    ]);
  });

  it('reads failed and flaky Playwright tests, skipping passes and skips', () => {
    const tests = collectTests([
      {
        path: 'e2e-linux-1/e2e-report.json',
        json: playwright('boot.e2e.ts', [
          { title: 'ok', status: 'expected' },
          { title: 'red', status: 'unexpected' },
          { title: 'wobbly', status: 'flaky' },
          { title: 'off', status: 'skipped' },
        ]),
      },
    ]);
    expect(tests.map((t: { title: string; kind: string; platform: string; layer: string }) => [t.title, t.kind, t.platform, t.layer])).toEqual([
      ['red', 'failed', 'linux', 'e2e'],
      ['wobbly', 'flaky', 'linux', 'e2e'],
    ]);
  });

  it('lists a test once per platform, however many shards report it', () => {
    const red = playwright('boot.e2e.ts', [{ title: 'red', status: 'unexpected' }]);
    const tests = collectTests([
      { path: 'e2e-windows-1/e2e-report.json', json: red },
      { path: 'e2e-windows-2/e2e-report.json', json: red },
      { path: 'e2e-macos-1/e2e-report.json', json: red },
    ]);
    expect(tests.map((t: { platform: string }) => t.platform)).toEqual(['windows', 'macos']);
  });
});

describe('decide', () => {
  const failing = { jobs: [job('unit (windows)', 'failure')], tests: [] };
  const green = { jobs: [job('unit (windows)', 'success'), job('hand-tests', 'skipped')], tests: [] };

  it('does nothing for a partial run or a run off master', () => {
    expect(decide({ ...failing, full: false, ref: 'refs/heads/master', openIssue: undefined })).toBe('none');
    expect(decide({ ...failing, full: true, ref: 'refs/heads/feature/x', openIssue: undefined })).toBe('none');
  });

  it('opens the issue on a failure with none open, and comments when one is', () => {
    expect(decide({ ...failing, full: true, ref: 'refs/heads/master', openIssue: undefined })).toBe('open');
    expect(decide({ ...failing, full: true, ref: 'refs/heads/master', openIssue: 7 })).toBe('comment');
  });

  it('treats cancelled and timed-out jobs as failures, and skipped ones as not', () => {
    for (const c of ['cancelled', 'timed_out']) {
      expect(decide({ jobs: [job('e2e', c)], tests: [], full: true, ref: 'refs/heads/master', openIssue: 7 })).toBe(
        'comment',
      );
    }
    expect(decide({ ...green, full: true, ref: 'refs/heads/master', openIssue: undefined })).toBe('none');
  });

  it('closes the open issue on a fully green run, but not when a test flaked', () => {
    expect(decide({ ...green, full: true, ref: 'refs/heads/master', openIssue: 7 })).toBe('close');
    const flaked = [{ file: 'a', title: 't', platform: 'linux', layer: 'e2e', kind: 'flaky' }];
    expect(decide({ ...green, tests: flaked, full: true, ref: 'refs/heads/master', openIssue: 7 })).toBe('comment');
  });

  it('ignores the report job itself', () => {
    const jobs = [job('unit (linux)', 'success'), job('report', 'failure')];
    expect(decide({ jobs, tests: [], full: true, ref: 'refs/heads/master', openIssue: 7 })).toBe('close');
  });
});

describe('renderReport', () => {
  it('lists every failed job, with or without test results, and every failed or flaky test', () => {
    const body = renderReport({
      runUrl: RUN,
      sha: '0123456789abcdef',
      date: '2026-11-18',
      jobs: [job('build-macos', 'failure', 1), job('e2e (linux 1/2)', 'failure', 2), job('unit (linux)', 'success', 3)],
      tests: [
        { file: 'boot.e2e.ts', title: 'red', platform: 'linux', layer: 'e2e', kind: 'failed' },
        { file: 'boot.e2e.ts', title: 'wobbly', platform: 'linux', layer: 'e2e', kind: 'flaky' },
      ],
    });
    expect(body).toContain(`**Nightly pipeline failed** — ${RUN} on \`01234567\` (2026-11-18)`);
    expect(body).toContain('### Failed jobs (2)');
    expect(body).toContain(`- [build-macos](${RUN}/job/1) — failure`);
    expect(body).toContain(`- [e2e (linux 1/2)](${RUN}/job/2) — failure`);
    expect(body).not.toContain('unit (linux)');
    expect(body).toContain('### Failed or flaky tests (2)');
    expect(body).toContain('- `boot.e2e.ts` › red — linux/e2e — failed');
    expect(body).toContain('- `boot.e2e.ts` › wobbly — linux/e2e — flaky');
  });
});

describe('runReport', () => {
  function fakeApi(openIssue?: number) {
    const calls: string[] = [];
    return {
      calls,
      api: {
        listJobs: async () => [job('unit (windows)', 'failure'), job('report', 'in_progress')],
        findOpenIssue: async (title: string) => {
          calls.push(`find ${title}`);
          return openIssue;
        },
        createIssue: async (title: string, body: string, labels: string[]) => {
          calls.push(`create ${title} [${labels.join(',')}] ${body.split('\n')[0]}`);
        },
        comment: async (n: number, body: string) => {
          calls.push(`comment #${n} ${body.split('\n')[0]}`);
        },
        close: async (n: number) => {
          calls.push(`close #${n}`);
        },
      },
    };
  }
  const args = { runId: '42', runUrl: RUN, sha: 'abcdef0123', ref: 'refs/heads/master', full: true, date: '2026-11-18' };

  it('opens the single issue with labels when none is open', async () => {
    const { api, calls } = fakeApi(undefined);
    await runReport({ api, args, results: [] });
    expect(calls).toEqual([
      `find ${ISSUE_TITLE}`,
      `create ${ISSUE_TITLE} [bug,area:infra] **Nightly pipeline failed** — ${RUN} on \`abcdef01\` (2026-11-18)`,
    ]);
  });

  it('comments on the open issue instead of opening a second', async () => {
    const { api, calls } = fakeApi(7);
    await runReport({ api, args, results: [] });
    expect(calls[1]).toMatch(/^comment #7 \*\*Nightly pipeline failed\*\*/);
    expect(calls).toHaveLength(2);
  });

  it('records green and closes the issue', async () => {
    const { api, calls } = fakeApi(7);
    api.listJobs = async () => [job('unit (windows)', 'success')];
    await runReport({ api, args, results: [] });
    expect(calls).toEqual([`find ${ISSUE_TITLE}`, `comment #7 Green on ${RUN} at \`abcdef0123\``, 'close #7']);
  });

  it('never calls the API beyond listing jobs for a partial run', async () => {
    const { api, calls } = fakeApi(7);
    await runReport({ api, args: { ...args, full: false }, results: [] });
    expect(calls).toEqual([]);
  });

  it('names the issue as the contract does', () => {
    expect(ISSUE_TITLE).toBe('Nightly pipeline failed on master');
  });
});
