// Builds, signs and bundles one release's package-repository indexes (064). No package file goes in the output: each
// index points at the release's own assets on GitHub. Why the indexes look like this:
// specs/064-website-and-package-repos/research.md.
//
//   node scripts/package-repo.mjs build  --version <v> --out <dir> [--deb <path>] [--rpm <path>] [--channel <c>]... [--asset-host <url>]
//   node scripts/package-repo.mjs sign   --dir <dir>     (signs with the only secret key in GNUPGHOME)
//   node scripts/package-repo.mjs bundle --dir <dir> --version <v> --out <dir>
//
// Node built-ins only, so a job can run it with no install. Needs dpkg-deb for --deb, createrepo_c for --rpm, gpg to sign.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

export const REPO_SLUG = 'Bidthedog/throng';
export const DEFAULT_ASSET_HOST = 'https://github.com';
export const BUNDLE_PREFIX = 'throng-repo-index-';

const bundleName = (version) => `${BUNDLE_PREFIX}${version}.tar.gz`;

const parseVersion = (version) => {
  const [core, ...rest] = version.replace(/^v/, '').split('-');
  return { core: core.split('.').map(Number), pre: rest.length ? rest.join('-').split('.') : [] };
};

/** One prerelease identifier against another. `alpha12` splits into word and number, as this project's tags need. */
function compareIdentifier(a, b) {
  const split = (s) => /^([^\d]*)(\d*)$/.exec(s) ?? [s, s, ''];
  const [, wordA, numA] = split(a);
  const [, wordB, numB] = split(b);
  if (wordA !== wordB) return wordA < wordB ? -1 : 1;
  return Math.sign(Number(numA || 0) - Number(numB || 0));
}

/** SemVer precedence, prerelease included. A release outranks its own prereleases. */
export function compareSemver(a, b) {
  const left = parseVersion(a);
  const right = parseVersion(b);
  for (let i = 0; i < 3; i += 1) {
    const diff = (left.core[i] ?? 0) - (right.core[i] ?? 0);
    if (diff !== 0) return Math.sign(diff);
  }
  if (left.pre.length === 0 || right.pre.length === 0) {
    return Math.sign(right.pre.length - left.pre.length);
  }
  for (let i = 0; i < Math.max(left.pre.length, right.pre.length); i += 1) {
    if (left.pre[i] === undefined) return -1;
    if (right.pre[i] === undefined) return 1;
    const diff = compareIdentifier(left.pre[i], right.pre[i]);
    if (diff !== 0) return diff;
  }
  return 0;
}

export const isPrerelease = (version) => version.includes('-');

/** Which channels a release's indexes go in (FR-007). */
export const channelsFor = (version) => (isPrerelease(version) ? ['prerelease'] : ['stable', 'prerelease']);

/**
 * Which release's bundle each channel serves, from GitHub's release list (FR-007). A stable channel needs both the
 * version and GitHub's flag to agree, so one mislabelled release cannot put an alpha in front of a stable user.
 */
export function selectBundles(releases) {
  const candidates = releases
    .filter((release) => !release.draft)
    .map((release) => {
      const version = release.tag_name.replace(/^v/, '');
      const asset = bundleName(version);
      const hasBundle = release.assets.some((a) => a.name === asset);
      return hasBundle ? { version, tag: release.tag_name, asset, flaggedPrerelease: release.prerelease } : null;
    })
    .filter(Boolean)
    .sort((a, b) => compareSemver(b.version, a.version));
  const stable = candidates.find((c) => !isPrerelease(c.version) && !c.flaggedPrerelease) ?? null;
  return { stable, prerelease: candidates[0] ?? null };
}

/** A release asset's path below the asset host. apt joins it to its `type:deb` mirror (research D1). */
export const releaseAssetPath = (version, filename) => `${REPO_SLUG}/releases/download/v${version}/${filename}`;

export function aptStanza(control, { filename, size, sha256 }) {
  return `${control.trimEnd()}\nFilename: ${filename}\nSize: ${size}\nSHA256: ${sha256}\n`;
}

/** The `Date` format apt requires: RFC 1123 in UTC, spelled `UTC`. */
const aptDate = (date) => date.toUTCString().replace('GMT', 'UTC');

/** No `Valid-Until`: the index is only rewritten by a release, which may be months apart. */
export function aptRelease(channel, date, files) {
  const lines = [
    'Origin: throng',
    'Label: throng',
    `Suite: ${channel}`,
    `Codename: ${channel}`,
    `Date: ${aptDate(date)}`,
    'Architectures: amd64',
    'Components: main',
    'Description: throng packages',
    'SHA256:',
    ...files.map((f) => ` ${f.sha256} ${f.size} ${f.path}`),
  ];
  return `${lines.join('\n')}\n`;
}

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', ...options });
  if (result.error) throw new Error(`${command}: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} exited ${result.status}\n${result.stderr ?? ''}`);
  return result.stdout;
}

export function buildAptIndex({ deb, version, channel, out, now = new Date() }) {
  const bytes = readFileSync(deb);
  const control = run('dpkg-deb', ['-f', deb]);
  const stanza = aptStanza(control, {
    filename: releaseAssetPath(version, basename(deb)),
    size: bytes.length,
    sha256: sha256(bytes),
  });
  const dist = join(out, 'apt', 'dists', channel);
  const binary = join(dist, 'main', 'binary-amd64');
  mkdirSync(binary, { recursive: true });
  const packages = Buffer.from(stanza);
  const packagesGz = gzipSync(packages, { level: 9 });
  writeFileSync(join(binary, 'Packages'), packages);
  writeFileSync(join(binary, 'Packages.gz'), packagesGz);
  const files = [
    { path: 'main/binary-amd64/Packages', size: packages.length, sha256: sha256(packages) },
    { path: 'main/binary-amd64/Packages.gz', size: packagesGz.length, sha256: sha256(packagesGz) },
  ];
  writeFileSync(join(dist, 'Release'), aptRelease(channel, now, files));
}

export function buildRpmIndex({ rpm, version, channel, out, assetHost = DEFAULT_ASSET_HOST }) {
  const work = mkdtempSync(join(tmpdir(), 'throng-rpm-'));
  try {
    copyFileSync(rpm, join(work, basename(rpm)));
    const baseUrl = `${assetHost}/${REPO_SLUG}/releases/download/v${version}/`;
    const target = join(out, 'rpm', channel);
    mkdirSync(target, { recursive: true });
    run('createrepo_c', ['--quiet', '--no-database', '--baseurl', baseUrl, '--outputdir', target, work]);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

export function buildIndexes({ version, out, deb, rpm, channels = channelsFor(version), assetHost, now }) {
  if (!deb && !rpm) throw new Error('nothing to index: give --deb, --rpm or both');
  for (const channel of channels) {
    if (channel === 'stable' && isPrerelease(version)) {
      throw new Error(`refusing to put prerelease ${version} in the stable channel`);
    }
    if (deb) buildAptIndex({ deb, version, channel, out, now });
    if (rpm) buildRpmIndex({ rpm, version, channel, out, assetHost });
  }
}

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

/** Signs with the only secret key in GNUPGHOME. Refusing a second one is what stops a test key signing a release. */
export function signIndexes({ dir, gpgHome }) {
  const env = gpgHome ? { ...process.env, GNUPGHOME: gpgHome } : process.env;
  const keys = run('gpg', ['--batch', '--list-secret-keys', '--with-colons'], { env })
    .split('\n')
    .filter((line) => line.startsWith('sec:'));
  if (keys.length !== 1) throw new Error(`expected exactly one signing key, found ${keys.length}`);
  const files = walk(dir);
  const targets = files.filter((f) => basename(f) === 'Release' || basename(f) === 'repomd.xml');
  if (targets.length === 0) throw new Error(`no index to sign under ${dir}`);
  for (const file of targets) {
    if (basename(file) === 'Release') {
      run('gpg', ['--batch', '--yes', '--clearsign', '--digest-algo', 'SHA512', '-o', join(file, '..', 'InRelease'), file], { env });
      run('gpg', ['--batch', '--yes', '--armor', '--detach-sign', '--digest-algo', 'SHA512', '-o', `${file}.gpg`, file], { env });
    } else {
      run('gpg', ['--batch', '--yes', '--armor', '--detach-sign', '--digest-algo', 'SHA512', '-o', `${file}.asc`, file], { env });
    }
  }
  return targets.map((f) => relative(dir, f));
}

export function bundleIndexes({ dir, version, out }) {
  mkdirSync(out, { recursive: true });
  const path = join(out, bundleName(version));
  const top = ['apt', 'rpm'].filter((name) => existsSync(join(dir, name)));
  run('tar', ['--sort=name', '--owner=0', '--group=0', '--numeric-owner', '-czf', path, '-C', dir, ...top]);
  return path;
}

function flags(argv) {
  const parsed = { channel: [] };
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i].replace(/^--/, '').replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    if (key === 'channel') parsed.channel.push(argv[i + 1]);
    else parsed[key] = argv[i + 1];
  }
  return parsed;
}

function main(argv) {
  const [command, ...rest] = argv;
  const args = flags(rest);
  if (command === 'build') {
    buildIndexes({
      version: args.version,
      out: args.out,
      deb: args.deb,
      rpm: args.rpm,
      assetHost: args.assetHost,
      channels: args.channel.length ? args.channel : undefined,
    });
    return;
  }
  if (command === 'sign') {
    for (const signed of signIndexes({ dir: args.dir })) console.log(`signed ${signed}`);
    return;
  }
  if (command === 'bundle') {
    console.log(bundleIndexes({ dir: args.dir, version: args.version, out: args.out }));
    return;
  }
  throw new Error('usage: package-repo.mjs build|sign|bundle (see the header)');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(`[package-repo] ${error.message}`);
    process.exit(1);
  }
}
