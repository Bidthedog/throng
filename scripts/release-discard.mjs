/**
 * Discard a failed release attempt so the SAME version can be re-tagged (072 FR-031, contracts/release-run.md).
 *
 * A release run that failed on a test or a build leaves a tag and that run's installers and packages behind. This
 * deletes, for every release.yml run on the tag, the build artifacts (`throng-*`, `*-upgrade-fixture`,
 * `repo-index-bundle`, `release-body`), then the remote tag. Test evidence stays. A tag whose release is published is
 * refused: a published release is never touched. An infrastructure fault is not a reason to run this — re-run the
 * failed jobs on the same tag instead.
 *
 *   node scripts/release-discard.mjs <tag> [--dry-run]
 *
 * Env: GITHUB_REPOSITORY (default: the `gh` repo of the working directory). Exit 0 done, 3 refused (published),
 * 64 usage, 1 a GitHub call failed.
 */
import { spawnSync } from 'node:child_process';
import { isMain } from './is-main.mjs';

const BUILD = [/^throng-/, /-upgrade-fixture$/, /^repo-index-bundle$/, /^release-body$/];

export const isBuildArtifact = (name) => BUILD.some((re) => re.test(name));

/**
 * The release a `gh api repos/{repo}/releases/tags/<tag>` call found, or undefined when GitHub answered 404. Any other
 * failure throws: a rate limit or an outage must stop the discard, never read as "not published".
 */
export function releaseFromGh({ status, stdout, stderr }) {
  if (status === 0) return JSON.parse(stdout);
  if (/HTTP 404/.test(stderr ?? '')) return undefined;
  throw new Error(`could not read the release: ${String(stderr || 'gh failed').trim()}`);
}

/** The whole discard, against an injected API (see `ghApi` for the real one). Returns the exit code. */
export async function runDiscard({ api, tag, dryRun, log }) {
  if (!/^v\d/.test(tag ?? '')) {
    log(`usage: release-discard.mjs <v-tag> [--dry-run] — got "${tag ?? ''}"`);
    return 64;
  }
  const release = await api.getRelease(tag);
  if (release) {
    log(`refused: ${tag} is published (${release.html_url}); a published release is never discarded`);
    return 3;
  }
  const doomed = [];
  for (const run of await api.listReleaseRuns(tag)) {
    for (const a of await api.listArtifacts(run.id)) {
      if (isBuildArtifact(a.name)) {
        doomed.push(a);
        log(`${dryRun ? 'would delete' : 'delete'} artifact ${a.name} (run ${run.id})`);
      } else {
        log(`keep ${a.name} (run ${run.id})`);
      }
    }
  }
  log(`${dryRun ? 'would delete' : 'delete'} tag ${tag}`);
  if (dryRun) return 0;
  for (const a of doomed) await api.deleteArtifact(a.id);
  await api.deleteTag(tag);
  log(`discarded ${tag}: re-tag the same version once the fix is on master`);
  return 0;
}

function gh(args) {
  const r = spawnSync('gh', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return r;
}

function ok(args) {
  const r = gh(args);
  if (r.status !== 0) throw new Error(`gh ${args.slice(0, 3).join(' ')} failed: ${r.stderr || r.error?.message}`);
  return r.stdout;
}

const lines = (out) =>
  out
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));

export function ghApi(repo) {
  return {
    getRelease: async (tag) => {
      return releaseFromGh(gh(['api', `repos/${repo}/releases/tags/${tag}`]));
    },
    listReleaseRuns: async (tag) =>
      lines(
        ok(['api', '--paginate', `repos/${repo}/actions/workflows/release.yml/runs?branch=${encodeURIComponent(tag)}&per_page=100`, '--jq', '.workflow_runs[]']),
      ),
    listArtifacts: async (runId) =>
      lines(ok(['api', '--paginate', `repos/${repo}/actions/runs/${runId}/artifacts?per_page=100`, '--jq', '.artifacts[]'])),
    deleteArtifact: async (id) => {
      ok(['api', '-X', 'DELETE', `repos/${repo}/actions/artifacts/${id}`]);
    },
    deleteTag: async (tag) => {
      ok(['api', '-X', 'DELETE', `repos/${repo}/git/refs/tags/${tag}`]);
    },
  };
}

async function main() {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes('--dry-run');
  const tag = argv.find((a) => !a.startsWith('--'));
  const repo =
    process.env.GITHUB_REPOSITORY || ok(['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner']).trim();
  try {
    process.exit(await runDiscard({ api: ghApi(repo), tag, dryRun, log: (l) => console.log(`[release-discard] ${l}`) }));
  } catch (e) {
    console.error(`[release-discard] ${e.message}`);
    process.exit(1);
  }
}

if (isMain(import.meta.url)) await main();
