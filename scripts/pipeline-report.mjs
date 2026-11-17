/**
 * The nightly report (072 FR-021, contracts/nightly-report.md).
 *
 * The full pipeline's `report` job runs this after every other job. On a full run on master it keeps ONE issue, "Nightly
 * pipeline failed on master": opened (or commented on) with every failed job and every failed or flaky test when the run
 * was not fully green, and closed when a later full run is. A partial run, or a run off master, touches nothing.
 *
 *   node scripts/pipeline-report.mjs --run-id <id> --sha <sha> --ref <ref> --full <true|false> --results-dir <dir>
 *
 * Env: GH_TOKEN, GITHUB_REPOSITORY, GITHUB_SERVER_URL (defaults to https://github.com). Exit 0 whatever the run's
 * outcome — the run's own jobs already carry its verdict — and 2 when GitHub cannot be reached.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { isMain } from './is-main.mjs';

export const ISSUE_TITLE = 'Nightly pipeline failed on master';
const LABELS = ['bug', 'area:infra'];
const FAILED = new Set(['failure', 'cancelled', 'timed_out']);
const PLATFORMS = ['windows', 'linux', 'macos'];
// `admin` before `e2e`: the admin lane's files are named e2e-admin-*.
const LAYERS = ['admin', 'unit', 'component', 'integration', 'contract', 'e2e'];

const find = (path, words) => words.find((w) => new RegExp(`(^|[^a-z])${w}([^a-z]|$)`, 'i').test(path));

function repoPath(name) {
  const p = String(name).replaceAll('\\', '/');
  const i = p.search(/(^|\/)(packages|scripts)\//);
  return i < 0 ? p : p.slice(p[i] === '/' ? i + 1 : i);
}

function* playwrightSpecs(suite, ancestors) {
  for (const spec of suite.specs ?? []) yield { spec, ancestors, file: spec.file ?? suite.file };
  for (const child of suite.suites ?? []) yield* playwrightSpecs(child, [...ancestors, child.title]);
}

/**
 * Every failed or flaky test in the run's result files, once per platform. `files` is `[{ path, json }]`; the platform
 * and layer come from the path (`results-<platform>-<layer>.json`, or an artifact directory named for them).
 */
export function collectTests(files) {
  const out = [];
  const seen = new Set();
  const add = (t) => {
    const key = `${t.file}\0${t.title}\0${t.platform}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(t);
  };
  for (const { path, json } of files) {
    const platform = find(path, PLATFORMS) ?? 'unknown';
    if (json && Array.isArray(json.testResults)) {
      const layer = find(path, LAYERS) ?? 'unknown';
      for (const file of json.testResults) {
        for (const a of file.assertionResults ?? []) {
          if (a.status === 'failed') {
            add({ file: repoPath(file.name), title: a.fullName ?? a.title, platform, layer, kind: 'failed' });
          }
        }
      }
    } else if (json && Array.isArray(json.suites)) {
      const layer = find(path, ['admin']) ?? 'e2e';
      for (const top of json.suites) {
        for (const { spec, ancestors, file } of playwrightSpecs(top, [])) {
          const statuses = (spec.tests ?? []).map((t) => t.status);
          const kind = statuses.includes('unexpected') ? 'failed' : statuses.includes('flaky') ? 'flaky' : undefined;
          if (!kind) continue;
          add({ file: repoPath(file ?? top.file), title: [...ancestors, spec.title].join(' › '), platform, layer, kind });
        }
      }
    }
  }
  return out;
}

const counted = (jobs) => jobs.filter((j) => !/^report\b/i.test(j.name));
const failedJobs = (jobs) => counted(jobs).filter((j) => FAILED.has(j.conclusion));

/** What to do with the issue: 'none', 'open', 'comment' or 'close'. */
export function decide({ full, ref, jobs, tests, openIssue }) {
  if (!full || ref !== 'refs/heads/master') return 'none';
  const broken = failedJobs(jobs).length > 0 || tests.length > 0;
  if (broken) return openIssue === undefined ? 'open' : 'comment';
  return openIssue === undefined ? 'none' : 'close';
}

export function renderReport({ runUrl, sha, date, jobs, tests }) {
  const failed = failedJobs(jobs);
  const lines = [`**Nightly pipeline failed** — ${runUrl} on \`${sha.slice(0, 8)}\` (${date})`, ''];
  lines.push(`### Failed jobs (${failed.length})`);
  for (const j of failed) lines.push(`- [${j.name}](${j.html_url}) — ${j.conclusion}`);
  lines.push('', `### Failed or flaky tests (${tests.length})`);
  for (const t of tests) lines.push(`- \`${t.file}\` › ${t.title} — ${t.platform}/${t.layer} — ${t.kind}`);
  return `${lines.join('\n')}\n`;
}

/** The whole report, against an injected API (see `ghApi` for the real one). */
export async function runReport({ api, args, results }) {
  if (!args.full || args.ref !== 'refs/heads/master') return 'none';
  const jobs = await api.listJobs(args.runId);
  const tests = collectTests(results);
  const openIssue = await api.findOpenIssue(ISSUE_TITLE);
  const action = decide({ full: args.full, ref: args.ref, jobs, tests, openIssue });
  const date = args.date ?? new Date().toISOString().slice(0, 10);
  if (action === 'open') {
    await api.createIssue(ISSUE_TITLE, renderReport({ ...args, date, jobs, tests }), LABELS);
  } else if (action === 'comment') {
    await api.comment(openIssue, renderReport({ ...args, date, jobs, tests }));
  } else if (action === 'close') {
    await api.comment(openIssue, `Green on ${args.runUrl} at \`${args.sha}\``);
    await api.close(openIssue);
  }
  return action;
}

function gh(args, input) {
  const r = spawnSync('gh', args, { encoding: 'utf8', input, maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) {
    const err = new Error(`gh ${args.slice(0, 3).join(' ')} failed: ${r.stderr || r.error?.message}`);
    err.unreachable = true;
    throw err;
  }
  return r.stdout;
}

export function ghApi(repo) {
  return {
    listJobs: async (runId) =>
      // One compact JSON object per line, across every page.
      gh(['api', '--paginate', `repos/${repo}/actions/runs/${runId}/jobs?per_page=100`, '--jq', '.jobs[]'])
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line)),
    findOpenIssue: async (title) => {
      const found = JSON.parse(
        gh(['issue', 'list', '-R', repo, '--state', 'open', '--search', `"${title}" in:title`, '--json', 'number,title']),
      );
      return found.find((i) => i.title === title)?.number;
    },
    createIssue: async (title, body, labels) => {
      gh(['issue', 'create', '-R', repo, '--title', title, '--body-file', '-', ...labels.flatMap((l) => ['--label', l])], body);
    },
    comment: async (n, body) => {
      gh(['issue', 'comment', String(n), '-R', repo, '--body-file', '-'], body);
    },
    close: async (n) => {
      gh(['issue', 'close', String(n), '-R', repo]);
    },
  };
}

export function readResults(dir) {
  if (!existsSync(dir)) return [];
  const walk = (d) =>
    readdirSync(d).flatMap((name) => {
      const p = join(d, name);
      return statSync(p).isDirectory() ? walk(p) : [p];
    });
  return walk(dir)
    .filter((p) => p.endsWith('.json'))
    .flatMap((path) => {
      try {
        return [{ path, json: JSON.parse(readFileSync(path, 'utf8')) }];
      } catch {
        return [];
      }
    });
}

function parseArgs(argv) {
  const get = (flag) => {
    const i = argv.indexOf(flag);
    return i < 0 ? undefined : argv[i + 1];
  };
  return {
    runId: get('--run-id'),
    sha: get('--sha'),
    ref: get('--ref'),
    full: get('--full') === 'true',
    resultsDir: get('--results-dir'),
  };
}

async function main() {
  const a = parseArgs(process.argv.slice(2));
  const repo = process.env.GITHUB_REPOSITORY;
  if (!a.runId || !a.sha || !a.ref || !repo) {
    console.error('usage: pipeline-report.mjs --run-id <id> --sha <sha> --ref <ref> --full <true|false> --results-dir <dir>');
    process.exit(64);
  }
  const server = process.env.GITHUB_SERVER_URL ?? 'https://github.com';
  const args = { ...a, runUrl: `${server}/${repo}/actions/runs/${a.runId}` };
  const results = a.resultsDir ? readResults(a.resultsDir) : [];
  try {
    const action = await runReport({ api: ghApi(repo), args, results });
    console.log(`[pipeline-report] ${action}`);
  } catch (e) {
    console.error(`[pipeline-report] ${e.message}`);
    process.exit(e.unreachable ? 2 : 1);
  }
}

if (isMain(import.meta.url)) await main();
