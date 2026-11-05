// Assembles the GitHub Pages site (064 FR-008): the static files from site/, and each channel's signed indexes from the
// bundles attached to releases. A deployment replaces the whole site, so every deployment brings the repositories, and
// needs no signing key to do it.
//
//   node scripts/site.mjs assemble --out <dir>      what pages.yml deploys; needs `gh`, and fails on a missing bundle
//
// Node built-ins only.
import { spawnSync } from 'node:child_process';
import { cpSync, createReadStream, existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { REPO_SLUG, selectBundles } from './package-repo.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const KEY_FILE = 'throng-repo-key.asc';

function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (result.error) throw new Error(`${command}: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} exited ${result.status}\n${result.stderr}`);
  return result.stdout;
}

const listReleasesFromGitHub = async () => {
  const pages = JSON.parse(run('gh', ['api', '--paginate', '--slurp', `repos/${REPO_SLUG}/releases?per_page=100`]));
  return pages.flat();
};

const fetchBundleFromGitHub = async ({ tag, asset }, dir) => {
  run('gh', ['release', 'download', tag, '--repo', REPO_SLUG, '--pattern', asset, '--dir', dir, '--clobber']);
  return join(dir, asset);
};

/** Copies one channel out of an extracted bundle. A bundle lacking the channel it was chosen for is a build fault. */
function layChannel(extracted, out, channel, version) {
  for (const [from, to] of [
    [join('apt', 'dists', channel), join('apt', 'dists', channel)],
    [join('rpm', channel), join('rpm', channel)],
  ]) {
    const source = join(extracted, from);
    if (!existsSync(source)) throw new Error(`the bundle for ${version} has no ${channel} channel at ${from}`);
    cpSync(source, join(out, to), { recursive: true });
  }
}

export async function assembleSite({
  source = join(ROOT, 'site'),
  out,
  listReleases = listReleasesFromGitHub,
  fetchBundle = fetchBundleFromGitHub,
}) {
  if (!existsSync(join(source, KEY_FILE))) {
    throw new Error(`${KEY_FILE} is missing from the site, and every install instruction downloads it`);
  }
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  cpSync(source, out, { recursive: true });
  writeFileSync(join(out, '.nojekyll'), '');

  const picked = selectBundles(await listReleases());
  const work = mkdtempSync(join(tmpdir(), 'throng-site-'));
  try {
    const extracted = new Map();
    for (const channel of ['stable', 'prerelease']) {
      const bundle = picked[channel];
      if (!bundle) continue;
      if (!extracted.has(bundle.asset)) {
        const dir = join(work, bundle.version);
        mkdirSync(dir, { recursive: true });
        run('tar', ['-xzf', await fetchBundle(bundle, dir), '-C', dir]);
        extracted.set(bundle.asset, dir);
      }
      layChannel(extracted.get(bundle.asset), out, channel, bundle.version);
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.xml': 'text/xml; charset=utf-8',
  '.asc': 'text/plain; charset=utf-8',
  '.list': 'text/plain; charset=utf-8',
  '.repo': 'text/plain; charset=utf-8',
};

/** A static server over `dir`, as Pages is. Used by the repository route check. */
export function serveStatic(dir, port, host = '127.0.0.1') {
  const base = resolve(dir);
  const server = createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, 'http://local').pathname);
    let path = normalize(join(base, pathname));
    if (path !== base && !path.startsWith(base + sep)) {
      response.writeHead(403).end();
      return;
    }
    if (existsSync(path) && statSync(path).isDirectory()) path = join(path, 'index.html');
    if (!existsSync(path)) {
      response.writeHead(404).end('Not found');
      return;
    }
    response.writeHead(200, {
      'content-type': CONTENT_TYPES[extname(path)] ?? 'application/octet-stream',
      'content-length': statSync(path).size,
      'cache-control': 'no-store',
    });
    createReadStream(path).pipe(response);
  });
  return new Promise((done, fail) => {
    server.once('error', fail);
    server.listen(port, host, () => done(server));
  });
}

function flag(argv, name) {
  const i = argv.indexOf(name);
  return i === -1 ? undefined : argv[i + 1];
}

async function main(argv) {
  const [command, ...rest] = argv;
  if (command === 'assemble') {
    const out = flag(rest, '--out');
    if (!out) throw new Error('assemble needs --out <dir>');
    await assembleSite({ out: resolve(out) });
    return;
  }
  throw new Error('usage: site.mjs assemble --out <dir>');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`[site] ${error.message}`);
    process.exit(1);
  });
}
