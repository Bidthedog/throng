// Which guide screenshots are out of date (080 FR-067): an image is stale when the source of the screen it shows
// changed since a release and the image itself did not. `site/guide/images/screens.json` names each image's screen.
//
//   node scripts/guide-screens-stale.mjs [--since <ref>]     default: the latest release tag
//
// Exit 0: every screenshot is current. Exit 1: one or more are stale (listed, with the files that changed), or the
// map and the images disagree. Fix by re-running `npm run guide:screenshots` and committing the images.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const IMAGES = 'site/guide/images';

/** Whether `file` is `entry` or, for an entry ending in `/`, lies below it. */
const covers = (entry, file) => (entry.endsWith('/') ? file.startsWith(entry) : file === entry);

/**
 * The stale images: each one whose screen (its own entries plus `everyScreen`) has a changed file, while the image
 * is not among the changed files. Returns `{ image, because }` with the screen files that changed.
 */
export function staleScreens(map, changedFiles) {
  const changed = new Set(changedFiles);
  const stale = [];
  for (const [image, entries] of Object.entries(map.screens)) {
    if (changed.has(`${IMAGES}/${image}`)) continue;
    const screen = [...(map.everyScreen ?? []), ...entries];
    const because = changedFiles.filter((f) => screen.some((entry) => covers(entry, f)));
    if (because.length > 0) stale.push({ image, because });
  }
  return stale;
}

/** Every PNG under the images folder, relative to it, with `/` separators. */
export function imagesOnDisk(root = ROOT) {
  const top = join(root, IMAGES);
  const found = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (name.endsWith('.png')) found.push(relative(top, path).split(sep).join('/'));
    }
  };
  if (existsSync(top)) walk(top);
  return found.sort();
}

/** Disagreements between the map and the images and source on disk; empty when they agree. */
export function mapProblems(map, root = ROOT) {
  const problems = [];
  const mapped = new Set(Object.keys(map.screens));
  for (const image of imagesOnDisk(root)) if (!mapped.has(image)) problems.push(`${image}: no screen in screens.json`);
  for (const image of mapped) if (!existsSync(join(root, IMAGES, image))) problems.push(`${image}: in screens.json but not on disk`);
  for (const entry of new Set([...(map.everyScreen ?? []), ...Object.values(map.screens).flat()])) {
    if (!existsSync(join(root, entry))) problems.push(`${entry}: named in screens.json but does not exist`);
  }
  return problems;
}

export function readMap(root = ROOT) {
  return JSON.parse(readFileSync(join(root, IMAGES, 'screens.json'), 'utf8'));
}

const invoked = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  const i = process.argv.indexOf('--since');
  const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
  const since = i === -1 ? git('describe', '--tags', '--abbrev=0', '--match', 'v*') : process.argv[i + 1];
  if (!since) throw new Error('usage: guide-screens-stale.mjs [--since <ref>]');
  const map = readMap();
  const problems = mapProblems(map);
  const changedFiles = git('diff', '--name-only', `${since}..HEAD`).split('\n').filter(Boolean);
  const stale = staleScreens(map, changedFiles);
  for (const p of problems) console.log(`map: ${p}`);
  for (const { image, because } of stale) {
    console.log(`stale: ${image} (its screen changed since ${since}: ${because.slice(0, 5).join(', ')}${because.length > 5 ? `, and ${because.length - 5} more` : ''})`);
  }
  if (problems.length === 0 && stale.length === 0) console.log(`every guide screenshot is current since ${since}`);
  process.exitCode = problems.length > 0 || stale.length > 0 ? 1 : 0;
}
