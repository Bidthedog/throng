// FR-039 (spec 070): the Windows and Linux lanes keep running unchanged. A branch-end check, run once before the branch
// merges, rather than a permanent test: it compares ci.yml, gate.yml and release.yml at the merge base with master
// against the working tree, and fails if any job that existed before differs other than by a macOS job named in its
// `needs` (and that need's `needs.<job>.result == 'success'` term in its `if`, which is how every job here names a need).
//
//   node scripts/check-platform-jobs-unchanged.mjs [--base <ref>]
//
// Exit 0 unchanged · 1 a difference, each named · 2 the base or a workflow could not be read.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { load } from 'js-yaml';

export const WORKFLOWS = ['ci.yml', 'gate.yml', 'release.yml'];

/** A job this spec added: its id names macOS. Every job that existed before 070 is a Windows or Linux one. */
export const isMacosJob = (id) => /macos/.test(id);

const needsOf = (job) => (job?.needs === undefined ? [] : Array.isArray(job.needs) ? job.needs : [job.needs]);

/** A job with every macOS need, and that need's success term, taken back out; everything else exactly as it is. */
export function withoutMacosNeeds(job, macosJobs) {
  const copy = structuredClone(job ?? {});
  // `needs: a` and `needs: [a]` are one need; adding a macOS one is what turns the first into the second.
  if (copy.needs !== undefined) {
    const kept = needsOf(copy).filter((need) => !macosJobs.includes(need));
    if (kept.length === 0) delete copy.needs;
    else copy.needs = kept;
  }
  if (typeof copy.if === 'string') {
    let text = copy.if;
    for (const id of macosJobs) {
      const term = new RegExp(`\\s*&&\\s*needs\\.${id.replace(/[-.]/g, '\\$&')}\\.result\\s*==\\s*'success'`, 'g');
      text = text.replace(term, '');
    }
    // Folded (`>-`) and single-line forms of one condition read the same.
    copy.if = text.replace(/\s+/g, ' ').trim();
  }
  return copy;
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Every way `after` changes a Windows or Linux job of `before`, in words.
 *
 * @param {string} name the workflow's file name
 * @param {any} before the workflow at the merge base, parsed
 * @param {any} after the workflow now, parsed
 * @returns {string[]}
 */
export function platformJobDifferences(name, before, after) {
  const differences = [];
  const beforeJobs = before?.jobs ?? {};
  const afterJobs = after?.jobs ?? {};
  const macosJobs = Object.keys(afterJobs).filter(isMacosJob);

  const topKeys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})].filter((key) => key !== 'jobs'));
  for (const key of topKeys) {
    if (!same(before?.[key], after?.[key])) differences.push(`${name}: the workflow's '${key}' changed, and every job runs under it`);
  }

  for (const [id, job] of Object.entries(beforeJobs)) {
    if (!(id in afterJobs)) {
      differences.push(`${name}: ${id} was removed`);
      continue;
    }
    const was = withoutMacosNeeds(job, []);
    const now = withoutMacosNeeds(afterJobs[id], macosJobs);
    for (const key of new Set([...Object.keys(was), ...Object.keys(now)])) {
      if (!same(was[key], now[key])) differences.push(`${name}: ${id}'s '${key}' changed`);
    }
  }
  for (const id of Object.keys(afterJobs)) {
    if (!(id in beforeJobs) && !isMacosJob(id)) differences.push(`${name}: ${id} is new and is not a macOS job`);
  }
  return differences;
}

function git(root, ...args) {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function mergeBase(root) {
  for (const ref of ['origin/master', 'master']) {
    try {
      return git(root, 'merge-base', 'HEAD', ref).trim();
    } catch {
      /* Try the next. */
    }
  }
  throw new Error('no merge base with origin/master or master');
}

function main() {
  const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
  const at = process.argv.indexOf('--base');
  let base;
  const differences = [];
  try {
    base = at === -1 ? mergeBase(root) : process.argv[at + 1];
    for (const name of WORKFLOWS) {
      const before = load(git(root, 'show', `${base}:.github/workflows/${name}`));
      const after = load(readFileSync(join(root, '.github', 'workflows', name), 'utf8'));
      differences.push(...platformJobDifferences(name, before, after));
    }
  } catch (err) {
    console.error(`[platform-jobs] could not compare: ${err instanceof Error ? err.message : err}`);
    process.exit(2);
  }
  if (differences.length > 0) {
    console.error(`[platform-jobs] the Windows and Linux jobs differ from ${base} (FR-039):\n  ${differences.join('\n  ')}`);
    process.exit(1);
  }
  console.log(`[platform-jobs] every Windows and Linux job in ${WORKFLOWS.join(', ')} is as it was at ${base}.`);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) main();
