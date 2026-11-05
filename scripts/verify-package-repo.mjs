#!/usr/bin/env node
// The repository route on a clean machine (064 FR-013): add the source, install, upgrade through a newer index, keep the
// channels apart, and refuse a tampered or unsigned index. Each failure names its step and exits 1, which blocks publish.
//
//   sudo node scripts/verify-package-repo.mjs --role deb|rpm --older <package> --older-version <v> \
//        --current <package> --version <v>
//
// It changes the machine it runs on: it adds a package source and installs throng. Run it on a runner or in a container.
// The indexes and packages come from two local servers, with an ephemeral key. GitHub's own redirects are in research D1.
import { spawn, spawnSync } from 'node:child_process';
import { appendFileSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { parseArgs } from 'node:util';

import { REPO_SLUG, buildIndexes, channelsFor, isPrerelease, signIndexes } from './package-repo.mjs';
import { serveStatic } from './site.mjs';

const { values: args } = parseArgs({
  options: {
    role: { type: 'string' },
    older: { type: 'string' },
    'older-version': { type: 'string' },
    current: { type: 'string' },
    version: { type: 'string' },
  },
});
const { role, older, version } = args;
const olderVersion = args['older-version'];
const current = args.current;
if (!['deb', 'rpm'].includes(role) || !older || !olderVersion || !current || !version) {
  console.error('usage: verify-package-repo.mjs --role deb|rpm --older <pkg> --older-version <v> --current <pkg> --version <v>');
  process.exit(2);
}

const INDEX_PORT = 18571;
const ASSET_PORT = 18572;
const indexUrl = `http://127.0.0.1:${INDEX_PORT}`;
const assetUrl = `http://127.0.0.1:${ASSET_PORT}`;
const SOURCE_FILE = '/etc/apt/sources.list.d/throng-verify.list';
const REPO_FILE = '/etc/yum.repos.d/throng-verify.repo';
const KEYRING = '/usr/share/keyrings/throng-verify.asc';

const work = mkdtempSync(join(tmpdir(), 'throng-repo-'));
const site = join(work, 'site');
const assets = join(work, 'assets');
const gpgHome = join(work, 'gnupg');
mkdirSync(site, { recursive: true });
mkdirSync(gpgHome, { recursive: true, mode: 0o700 });

const failures = [];
const report = (step, passed, detail = '') => {
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${step}${detail ? `: ${detail}` : ''}`);
  if (!passed) failures.push(step);
};

/**
 * The servers live in this process, so this cannot block the event loop while apt or dnf talks to them.
 * Returns the exit code and everything printed.
 */
function sh(command, commandArgs = [], env = {}) {
  return new Promise((done) => {
    const child = spawn(command, commandArgs, {
      env: { ...process.env, DEBIAN_FRONTEND: 'noninteractive', ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (d) => { output += d; });
    child.stderr.on('data', (d) => { output += d; });
    child.on('error', (error) => done({ code: 127, output: error.message }));
    child.on('close', (code) => done({ code, output }));
  });
}

function must(result, what) {
  if (result.code !== 0) throw new Error(`${what} exited ${result.code}\n${result.output}`);
  return result.output;
}

function gpg(...gpgArgs) {
  const result = spawnSync('gpg', ['--batch', ...gpgArgs], { encoding: 'utf8', env: { ...process.env, GNUPGHOME: gpgHome } });
  if (result.status !== 0) throw new Error(`gpg ${gpgArgs.join(' ')}\n${result.stderr}`);
  return result.stdout;
}

/** Lays a package out at the path its index names, on the asset server. */
function publishAsset(packagePath, packageVersion) {
  const dir = join(assets, REPO_SLUG, 'releases', 'download', `v${packageVersion}`);
  mkdirSync(dir, { recursive: true });
  copyFileSync(packagePath, join(dir, basename(packagePath)));
}

/** What a release's sign-index job does, with this run's own key. */
function publishIndex(packagePath, packageVersion, channels = channelsFor(packageVersion)) {
  publishAsset(packagePath, packageVersion);
  buildIndexes({
    version: packageVersion,
    out: site,
    channels,
    assetHost: assetUrl,
    ...(role === 'deb' ? { deb: packagePath } : { rpm: packagePath }),
  });
  signIndexes({ dir: site, gpgHome });
}

function addSource(channel) {
  if (role === 'deb') {
    writeFileSync(SOURCE_FILE, `deb [signed-by=${KEYRING}] mirror+${indexUrl}/apt/${channel}.list ${channel} main\n`);
  } else {
    writeFileSync(
      REPO_FILE,
      `[throng-verify]\nname=throng\nbaseurl=${indexUrl}/rpm/${channel}\nenabled=1\ngpgcheck=0\nrepo_gpgcheck=1\ngpgkey=${indexUrl}/throng-repo-key.asc\n`,
    );
  }
}

const packageManager = {
  deb: {
    refresh: async () => {
      // Only this source's lists go. The system's are what the package's dependencies resolve from.
      for (const name of readdirSync('/var/lib/apt/lists')) {
        if (name.includes('127.0.0.1')) rmSync(join('/var/lib/apt/lists', name), { force: true });
      }
      return sh('apt-get', ['update']);
    },
    install: () => sh('apt-get', ['install', '-y', '--no-install-recommends', 'throng']),
    upgrade: () => sh('apt-get', ['upgrade', '-y']),
    remove: () => sh('apt-get', ['remove', '-y', 'throng']),
    // `apt remove` leaves the package known, with its version, in the config-files state.
    installed: async () => {
      const [state, packageVersion] = (await sh('dpkg-query', ['-W', '-f', '${db:Status-Abbrev} ${Version}', 'throng'])).output.trim().split(/\s+/);
      return state === 'ii' ? packageVersion : '(not installed)';
    },
    candidate: async () => /Candidate:\s*(\S+)/.exec((await sh('apt-cache', ['policy', 'throng'])).output)?.[1] ?? '(none)',
    filter: (v) => v.replace('-', '~'),
  },
  rpm: {
    refresh: async () => {
      await sh('dnf', ['clean', 'all']);
      return sh('dnf', ['-y', 'makecache', '--disablerepo=*', '--enablerepo=throng-verify']);
    },
    install: () => sh('dnf', ['-y', 'install', 'throng']),
    upgrade: () => sh('dnf', ['-y', 'upgrade', 'throng']),
    remove: () => sh('dnf', ['-y', 'remove', 'throng']),
    installed: async () => (await sh('rpm', ['-q', '--qf', '%{VERSION}', 'throng'])).output.trim(),
    // dnf5 skips a repository it cannot trust, with a warning and exit 0. So what refusal looks like here is a query
    // that offers nothing, and the lines around the answer are dnf's own progress.
    candidate: async () => {
      const result = await sh('dnf', ['repoquery', '--disablerepo=*', '--enablerepo=throng-verify', '--qf', '%{version}\n', 'throng']);
      return (result.code === 0 && result.output.split('\n').find((line) => /^\d+\.\d+\.\d+/.test(line.trim()))?.trim()) || '(none)';
    },
    filter: (v) => v.replace('-', '~'),
  },
}[role];

const wanted = packageManager.filter;

function resetIndex(file) {
  const original = readFileSync(file);
  return () => writeFileSync(file, original);
}

/** Refusal means the refresh failed or offered nothing, for a change the package manager must notice. */
async function expectRefused(step, tamper) {
  const undo = tamper();
  const result = await packageManager.refresh();
  const candidate = await packageManager.candidate();
  undo();
  report(step, result.code !== 0 || candidate === '(none)', `exit ${result.code}, candidate ${candidate}`);
}

async function verifyRefusals(channel) {
  // Removed first, so a candidate can only come from the index under test.
  must(await packageManager.remove(), 'remove');

  // The control. Without it, a check that can never see a candidate would pass every refusal below.
  must(await packageManager.refresh(), 'refresh');
  const untouched = await packageManager.candidate();
  report('the untouched index offers the package', untouched === wanted(version), untouched);

  if (role === 'deb') {
    const dist = join(site, 'apt', 'dists', channel);
    const packages = join(dist, 'main', 'binary-amd64', 'Packages');
    const packagesGz = `${packages}.gz`;
    await expectRefused('a changed Packages is refused', () => {
      const undoPlain = resetIndex(packages);
      const undoGz = resetIndex(packagesGz);
      appendFileSync(packages, 'Description: tampered\n');
      rmSync(packagesGz);
      return () => { undoPlain(); undoGz(); };
    });
    const inRelease = join(dist, 'InRelease');
    await expectRefused('a changed InRelease is refused', () => {
      const undo = resetIndex(inRelease);
      writeFileSync(inRelease, readFileSync(inRelease, 'utf8').replace(`Suite: ${channel}`, 'Suite: tampered'));
      return undo;
    });
    await expectRefused('an unsigned index is refused', () => {
      const undoIn = resetIndex(inRelease);
      const gpgFile = join(dist, 'Release.gpg');
      const undoGpg = resetIndex(gpgFile);
      rmSync(inRelease);
      rmSync(gpgFile);
      return () => { undoIn(); undoGpg(); };
    });
    await expectRefused('a signature by another key is refused', () => {
      const undo = resetIndex(inRelease);
      const otherHome = mkdtempSync(join(work, 'other-'));
      const env = { ...process.env, GNUPGHOME: otherHome };
      spawnSync('gpg', ['--batch', '--passphrase', '', '--quick-generate-key', 'other <other@example.invalid>', 'ed25519', 'sign', 'never'], { env });
      spawnSync('gpg', ['--batch', '--yes', '--clearsign', '-o', inRelease, join(dist, 'Release')], { env });
      return undo;
    });
  } else {
    const repodata = join(site, 'rpm', channel, 'repodata');
    const repomd = join(repodata, 'repomd.xml');
    const signature = `${repomd}.asc`;
    await expectRefused('a changed repomd.xml is refused', () => {
      const undo = resetIndex(repomd);
      appendFileSync(repomd, '<!-- tampered -->\n');
      return undo;
    });
    const primary = join(repodata, readdirSync(repodata).find((f) => f.includes('primary')));
    await expectRefused('a changed primary is refused', () => {
      const undo = resetIndex(primary);
      appendFileSync(primary, 'x');
      return undo;
    });
    await expectRefused('an unsigned index is refused', () => {
      const undo = resetIndex(signature);
      rmSync(signature);
      return undo;
    });
    await expectRefused('a signature by another key is refused', () => {
      const undo = resetIndex(signature);
      const otherHome = mkdtempSync(join(work, 'other-'));
      const env = { ...process.env, GNUPGHOME: otherHome };
      spawnSync('gpg', ['--batch', '--passphrase', '', '--quick-generate-key', 'other <other@example.invalid>', 'ed25519', 'sign', 'never'], { env });
      spawnSync('gpg', ['--batch', '--yes', '--armor', '--detach-sign', '-o', signature, repomd], { env });
      return undo;
    });
  }

  // A signed index, naming a package whose bytes are not the ones it hashed.
  const packageDir = join(assets, REPO_SLUG, 'releases', 'download', `v${version}`);
  const asset = join(packageDir, basename(current));
  const undoAsset = resetIndex(asset);
  appendFileSync(asset, 'tampered');
  const refreshed = await packageManager.refresh();
  must(refreshed, 'refresh before the tampered package');
  // apt keeps what it downloaded, and would reinstall the genuine copy from the earlier upgrade without fetching this
  // one. Docker's Ubuntu images turn that cache off, so only a hosted runner shows it. dnf's refresh already cleared its own.
  if (role === 'deb') must(await sh('apt-get', ['clean']), 'apt-get clean');
  const attempt = await packageManager.install();
  undoAsset();
  report('a package that differs from its index is refused', attempt.code !== 0 && (await packageManager.installed()) !== wanted(version), `exit ${attempt.code}`);
}

async function main() {
  mkdirSync(assets, { recursive: true });
  const servers = [await serveStatic(site, INDEX_PORT), await serveStatic(assets, ASSET_PORT)];
  try {
    gpg('--passphrase', '', '--quick-generate-key', 'throng repository check <verify@example.invalid>', 'ed25519', 'sign', 'never');
    const publicKey = gpg('--armor', '--export');
    writeFileSync(join(site, 'throng-repo-key.asc'), publicKey);
    mkdirSync(join(site, 'apt'), { recursive: true });
    for (const channel of ['stable', 'prerelease']) {
      writeFileSync(join(site, 'apt', `${channel}.list`), `${indexUrl}/apt/\tpriority:1\ttype:index\n${assetUrl}/\tpriority:1\ttype:deb\n`);
    }
    if (role === 'deb') writeFileSync(KEYRING, publicKey);

    // The older build is stable, so it sits in both channels.
    publishIndex(older, olderVersion);
    addSource('stable');
    must(await packageManager.refresh(), 'refresh');
    must(await packageManager.install(), 'install');
    const installedOlder = await packageManager.installed();
    report('installs from the repository', installedOlder === wanted(olderVersion), installedOlder);

    if (isPrerelease(version)) {
      publishIndex(current, version);
      must(await packageManager.refresh(), 'refresh');
      const stableCandidate = await packageManager.candidate();
      report('a prerelease does not reach the stable channel', stableCandidate === wanted(olderVersion), stableCandidate);
      let refused = false;
      try {
        buildIndexes({ version, out: join(work, 'refused'), channels: ['stable'], ...(role === 'deb' ? { deb: current } : { rpm: current }) });
      } catch {
        refused = true;
      }
      report('building a stable index from a prerelease is refused', refused);
      addSource('prerelease');
    } else {
      publishIndex(current, version);
    }

    const channel = isPrerelease(version) ? 'prerelease' : 'stable';
    must(await packageManager.refresh(), 'refresh');
    must(await packageManager.upgrade(), 'upgrade');
    const upgraded = await packageManager.installed();
    report('a newer release arrives through the ordinary upgrade', upgraded === wanted(version), upgraded);

    await verifyRefusals(channel);
  } finally {
    for (const server of servers) server.close();
    rmSync(SOURCE_FILE, { force: true });
    rmSync(REPO_FILE, { force: true });
    if (existsSync(KEYRING)) rmSync(KEYRING, { force: true });
    rmSync(work, { recursive: true, force: true });
  }
  if (failures.length > 0) {
    console.error(`\n${failures.length} check(s) failed: ${failures.join('; ')}`);
    process.exit(1);
  }
  console.log('\nThe repository route holds.');
}

main().catch((error) => {
  console.error(`FAIL  ${error.message}`);
  process.exit(1);
});
