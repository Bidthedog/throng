// The clean-machine lifecycle of one Linux package (063 FR-017, research D8). `verify-installer.mjs` is Windows' and
// stays as it is (FR-021); this writes the same verdict, over the same step vocabulary.
//
//   node scripts/verify-linux-package.mjs <artifact> --role deb|rpm|tarball --expected-version X
//        --verdict-out <file> [--older <package>]
//
// `--older` is required for the .deb and .rpm: an older build of this tree, for the upgrade over a running copy. Run it
// on a clean machine as an account with passwordless sudo that is not root, under a display
// (scripts/ci-linux-display.sh). It installs and removes things system-wide, so it is not for a workstation.
import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { connect } from 'node:net';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { buildArtifactVerdict, combinationsOf, declareArtifactSet, matchReleaseVersions } from '@throng/core';
import { _electron as electron } from '@playwright/test';
import { sha256OfFile } from './checksum.mjs';

const PAYLOAD = '/opt/throng';
const VERSIONS = '/opt/throng-versions';
const COMMAND = '/usr/bin/throng';
const DESKTOP_EXEC = '/opt/throng/throng';
const DESKTOP_ENTRY = '/usr/share/applications/throng.desktop';
const ICON = '/usr/share/icons/hicolor/256x256/apps/throng.png';
const PROFILE = '/etc/apparmor.d/throng';
const MARKER = 'THRONG_VERIFY_OK';

function flag(name) {
  const i = process.argv.indexOf(name);
  return i === -1 ? undefined : process.argv[i + 1];
}

const artifact = resolve(process.argv[2] ?? '');
const role = flag('--role');
const expectedVersion = flag('--expected-version');
const verdictOut = flag('--verdict-out');
const older = flag('--older') ? resolve(flag('--older')) : undefined;
const isPackage = role === 'deb' || role === 'rpm';

if (process.platform !== 'linux' || process.getuid?.() === 0) {
  console.error('[verify-linux] runs on Linux, as an account that is not root: throng refuses to start as root.');
  process.exit(2);
}
if (!existsSync(artifact) || !['deb', 'rpm', 'tarball'].includes(role) || !expectedVersion || !verdictOut) {
  console.error('[verify-linux] needs <artifact> --role deb|rpm|tarball --expected-version X --verdict-out <file>');
  process.exit(2);
}
if (isPackage && !(older && existsSync(older))) {
  console.error(`[verify-linux] the ${role} needs --older <package> for the upgrade step`);
  process.exit(2);
}

const log = (message) => console.error(`[verify-linux] ${new Date().toISOString()} ${message}`);
const scratch = mkdtempSync(join(tmpdir(), 'throng-verify-'));
const pipe = join(scratch, 'd.sock');
const logDir = resolve('installer-logs');
mkdirSync(logDir, { recursive: true });

/** Run a command, say what it did, and answer with its exit code. */
function run(file, args, { quiet = false } = {}) {
  const result = spawnSync(file, args, { encoding: 'utf8', timeout: 600_000 });
  if (!quiet || result.status !== 0) {
    log(`$ ${file} ${args.join(' ')} → ${result.status}\n${result.stdout ?? ''}${result.stderr ?? ''}`);
  }
  return result;
}

const sudo = (...args) => run('sudo', ['-n', ...args]);

/** The package manager, in the ordinary commands a person would type (063 FR-004, FR-011). */
const packages = {
  install: (file) =>
    role === 'deb'
      ? sudo('env', 'DEBIAN_FRONTEND=noninteractive', 'apt-get', 'install', '-y', file).status === 0
      : sudo('dnf', 'install', '-y', file).status === 0,
  remove: () =>
    role === 'deb'
      ? sudo('env', 'DEBIAN_FRONTEND=noninteractive', 'apt-get', 'remove', '-y', 'throng').status === 0
      : sudo('dnf', 'remove', '-y', 'throng').status === 0,
  /** The older package, the way people mistakenly try it: dpkg is what apt's own refusal does not cover. */
  downgrade: (file) => (role === 'deb' ? sudo('dpkg', '-i', file) : sudo('dnf', 'install', '-y', file)),
  recordedVersion: () =>
    role === 'deb'
      ? run('dpkg-query', ['-W', '-f=${Version}', 'throng'], { quiet: true }).stdout
      : run('rpm', ['-q', '--qf', '%{VERSION}', 'throng'], { quiet: true }).stdout,
  isInstalled: () =>
    (role === 'deb'
      ? run('dpkg-query', ['-W', '-f=${Status}', 'throng'], { quiet: true }).stdout.includes('install ok installed')
      : run('rpm', ['-q', 'throng'], { quiet: true }).status === 0),
};

/** One JSON-RPC call to the app's own daemon, as the window makes them. */
function rpc(method, params = {}, timeoutMs = 20_000) {
  return new Promise((settle, reject) => {
    const socket = connect(pipe);
    let buffer = '';
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error(`${method} timed out`));
    }, timeoutMs);
    socket.setEncoding('utf8');
    socket.on('connect', () => socket.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })}\n`));
    socket.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    socket.on('data', (chunk) => {
      buffer += chunk;
      const newline = buffer.indexOf('\n');
      if (newline === -1) return;
      clearTimeout(timer);
      socket.destroy();
      const reply = JSON.parse(buffer.slice(0, newline));
      if (reply.error) reject(new Error(`${method}: ${reply.error.message}`));
      else settle(reply.result);
    });
  });
}

/** A sandboxed process's exe link cannot be read, even by its own account, though its cmdline and status can. */
function readExe(pid) {
  try {
    return readlinkSync(`/proc/${pid}/exe`);
  } catch {
    return '';
  }
}

/** Every process on the machine, as far as this account can read. */
function processes() {
  const found = [];
  for (const name of readdirSync('/proc')) {
    if (!/^\d+$/.test(name)) continue;
    try {
      found.push({
        pid: Number(name),
        exe: readExe(name),
        cmdline: readFileSync(`/proc/${name}/cmdline`, 'utf8').split('\0').join(' '),
        status: readFileSync(`/proc/${name}/status`, 'utf8'),
      });
    } catch {
      /* Gone already. */
    }
  }
  return found;
}

const isThrongProcess = (p) =>
  /\/throng-bin( \(deleted\))?$/.test(p.exe) || /\/throng-bin /.test(p.cmdline) || p.cmdline.includes('packages/daemon/dist/main.js');

/** Launch through the launcher, as a person does. `chromiumSandbox` stops Playwright adding --no-sandbox itself. */
async function open(launcher) {
  const app = await electron.launch({
    executablePath: launcher,
    // No --user-data-dir: throng keeps its database beside it, and this machine is clean anyway. Only the socket is moved,
    // so the daemon can be reached. Settings and data use their real folders (FR-014).
    env: { ...process.env, THRONG_PIPE_NAME: pipe, THRONG_LOG_DIR: logDir },
    timeout: 60_000,
    chromiumSandbox: true,
  });
  app.process().stderr?.on('data', (chunk) => process.stderr.write(chunk));
  const window = await app.firstWindow({ timeout: 45_000 });
  await window.waitForLoadState('domcontentloaded');
  await waitForDaemon();
  return { app, window };
}

/** Close the window. A daemon outlives it by design (Principle III), and the close prompt is not what is under test. */
async function close(session) {
  const uiPid = session.app.process().pid;
  await Promise.race([session.app.close().catch(() => {}), delay(10_000)]);
  try {
    if (uiPid) process.kill(uiPid, 'SIGKILL');
  } catch {
    /* Already gone. */
  }
  await delay(1500);
}

async function waitForDaemon() {
  const deadline = Date.now() + 30_000;
  let last;
  while (Date.now() < deadline) {
    try {
      return await rpc('health.ping', {}, 2000);
    } catch (err) {
      last = err;
      await delay(500);
    }
  }
  throw new Error(`the daemon did not answer: ${last?.message}`);
}

/** Stop anything of ours still running, so one step's leftovers are not the next step's starting state. */
async function clearProcesses() {
  try {
    await rpc('terminal.killAll', {}, 5000);
  } catch {
    /* No daemon. */
  }
  for (const p of processes().filter(isThrongProcess)) {
    try {
      process.kill(p.pid, 'SIGKILL');
    } catch {
      /* Already gone. */
    }
  }
  await delay(1000);
}

/** The sandbox is on (FR-006, SC-005): no process disabled it, and a renderer runs under seccomp-bpf. */
function sandboxIsOn() {
  const ours = processes().filter(isThrongProcess);
  const off = ours.filter((p) => p.cmdline.includes('--no-sandbox'));
  if (off.length > 0) {
    log(`sandbox: --no-sandbox on ${off.map((p) => p.pid).join(', ')}`);
    return false;
  }
  const renderers = ours.filter((p) => p.cmdline.includes('--type=renderer'));
  const confined = renderers.filter((p) => /^Seccomp:\s+2$/m.test(p.status));
  log(`sandbox: ${renderers.length} renderer(s), ${confined.length} under seccomp-bpf`);
  return renderers.length > 0 && confined.length === renderers.length;
}

/** The daemon runs under the bundled runtime in `root`, whatever `node` is on this machine (FR-002). */
function daemonIsSelfContained(root) {
  const daemons = processes().filter((p) => p.cmdline.includes('packages/daemon/dist/main.js'));
  log(`self-contained: daemon(s) ${daemons.map((p) => `${p.pid} ${p.exe}`).join(', ') || 'none'}`);
  return daemons.length > 0 && daemons.every((p) => p.exe === join(root, 'resources', 'runtime', 'node'));
}

const projectRoot = (name) => {
  const folder = join(homedir(), 'throng-verify', name);
  mkdirSync(folder, { recursive: true });
  return folder;
};

/** A project goes in, and a terminal runs a command in a real shell on the app's own daemon (SC-001). */
async function coreJourney(name) {
  await rpc('projects.create', { name, colour: '#3b82f6', rootFolder: projectRoot(name) });
  const params = {
    panelId: 'verify-echo',
    projectId: 'verify-project',
    rootless: true,
    viewId: 'verify-view',
    cols: 80,
    rows: 24,
    // It stays open: the daemon forgets a session that has exited, scrollback and all, and the next attach starts another.
    launch: { file: '/bin/sh', args: ['-c', `echo ${MARKER}; exec sleep 300`], cwd: homedir() },
  };
  let attached = await rpc('terminal.attach', params);
  const deadline = Date.now() + 15_000;
  while (!String(attached.scrollback ?? '').includes(MARKER) && Date.now() < deadline) {
    await delay(500);
    attached = await rpc('terminal.attach', { ...params, explicit: false });
  }
  return String(attached.scrollback ?? '').includes(MARKER);
}

/** A shell that stays open, for a later step to look for. */
async function keepTerminal() {
  const attached = await rpc('terminal.attach', {
    panelId: 'verify-keep',
    projectId: 'verify-project',
    rootless: true,
    viewId: 'verify-view',
    cols: 80,
    rows: 24,
    launch: { file: '/bin/sh', args: [], cwd: homedir() },
  });
  return attached.status === 'running';
}

const keepIsListed = async () => JSON.stringify(await rpc('terminal.list', {})).includes('verify-keep');
const projectNames = async () => ((await rpc('projects.list', {}))?.projects ?? []).map((p) => p.name);

/** The daemon survives the window, and the next window reuses it, terminal and all (Principle III). */
async function reattaches(launcher) {
  const first = await open(launcher);
  const before = (await waitForDaemon()).pid;
  const kept = await keepTerminal();
  await close(first);
  const survived = (await waitForDaemon()).pid === before;
  const second = await open(launcher);
  const same = (await waitForDaemon()).pid === before;
  const listed = await keepIsListed();
  await rpc('terminal.killAll', {});
  await close(second);
  log(`reattach: kept=${kept} survived=${survived} same=${same} listed=${listed}`);
  return kept && survived && same && listed;
}

/** No unit under any systemd folder names throng (020 FR-011). */
function noService() {
  for (const dir of ['/etc/systemd/system', '/usr/lib/systemd/system', '/lib/systemd/system']) {
    if (existsSync(dir) && readdirSync(dir).some((name) => name.includes('throng'))) return false;
  }
  return true;
}

/** Every file's path and modified time, to prove a run wrote nothing there (FR-005). */
function snapshot(...roots) {
  const lines = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else lines.push(`${path}:${statSync(path, { throwIfNoEntry: false })?.mtimeMs ?? 'link'}`);
    }
  };
  for (const root of roots) if (existsSync(root)) walk(root);
  return lines.sort().join('\n');
}

const versionIn = (root) => JSON.parse(readFileSync(join(root, 'resources', 'app', 'package.json'), 'utf8')).version;

/** Filename, manifest and (for a package) the manager's record all say one version; the record with its tilde. */
function versionMatches(root) {
  const reported = versionIn(root);
  const match = matchReleaseVersions({
    // Without the architecture, which the matcher would read as part of the prerelease.
    installerFilename: basename(artifact).replace(/-(amd64\.deb|x86_64\.rpm|linux-x64\.tar\.gz)$/, '.pkg'),
    packageVersion: expectedVersion,
    reportedVersion: reported,
    releaseTag: `v${expectedVersion}`,
  });
  if (!match.matched) log(`version-match: ${match.reason}`);
  if (!isPackage) return match.matched;
  const recorded = packages.recordedVersion();
  const wanted = expectedVersion.replaceAll('-', '~');
  if (recorded !== wanted) log(`version-match: the package manager records ${recorded}, not ${wanted}`);
  return match.matched && recorded === wanted;
}

/** Nothing of ours is running, and none starts again. The daemon's own check is on a 30-second timer (FR-013). */
async function processesEnd() {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    if (processes().filter(isThrongProcess).length === 0) return true;
    await delay(1000);
  }
  log(`residue: still running ${processes().filter(isThrongProcess).map((p) => `${p.pid} ${p.exe}`).join(', ')}`);
  return false;
}

const USER_DATA = [join(homedir(), '.local/share/throng'), join(homedir(), '.config/throng')];
function userDataIsThere() {
  const absent = USER_DATA.filter((path) => !existsSync(path));
  if (absent.length > 0) log(`user data: no ${absent.join(', ')}`);
  return absent.length === 0;
}
const devDataIsAbsent = () => !existsSync(join(homedir(), '.local/share/throng-dev')) && !existsSync(join(homedir(), '.config/throng-dev'));

/** The journey ran, in the installed build's own folders and not dev mode's (FR-014). */
async function journeyHolds(name) {
  const facts = { terminal: await coreJourney(name), userData: userDataIsThere(), noDevData: devDataIsAbsent() };
  log(`core-journey: ${JSON.stringify(facts)}`);
  return Object.values(facts).every(Boolean);
}

/** The whole lifecycle of a .deb or .rpm. Each step leaves the next a machine it can start from. */
async function verifyPackage(results) {
  results.install = packages.install(artifact) && existsSync(COMMAND) && existsSync(join(VERSIONS, 'current'));
  if (!results.install) return;

  const root = join(VERSIONS, expectedVersion);
  const before = snapshot(PAYLOAD, VERSIONS);

  // FR-005: only root may write to what every account runs.
  const writable = run('find', [PAYLOAD, VERSIONS, '-not', '-type', 'l', '-perm', '-o+w'], { quiet: true }).stdout.trim();
  if (writable) {
    log(`install: world-writable:\n${writable.split('\n').slice(0, 20).join('\n')}`);
    results.install = false;
  }

  results['version-match'] = versionMatches(root);
  results.shortcut =
    existsSync(DESKTOP_ENTRY) &&
    readFileSync(DESKTOP_ENTRY, 'utf8').includes(`Exec=${DESKTOP_EXEC} `) &&
    existsSync(ICON) &&
    existsSync(COMMAND);
  results['no-service'] = noService();

  // What the desktop's application list starts. It must hand over to the version folder (research D2).
  const session = await open(DESKTOP_EXEC);
  const fromVersionFolder = processes().some((p) => p.exe === join(root, 'throng-bin'));
  log(`launch: running from the version folder: ${fromVersionFolder}`);
  results.launch = sandboxIsOn() && fromVersionFolder;
  results['self-contained'] = daemonIsSelfContained(root);
  results['core-journey'] = await journeyHolds('verify-one');
  await rpc('terminal.killAll', {});
  await close(session);

  results.reattach = await reattaches(COMMAND);
  results['no-write'] = snapshot(PAYLOAD, VERSIONS) === before;
  await clearProcesses();

  // Removed while open (US3.3): it keeps running, and ends once closed.
  const openForRemoval = await open(COMMAND);
  const removed = packages.remove();
  const stillAnswers = (await openForRemoval.window.evaluate(() => 1 + 1).catch(() => 0)) === 2;
  const left = [PAYLOAD, VERSIONS, COMMAND, DESKTOP_ENTRY, PROFILE].filter((path) => existsSync(path));
  results.uninstall = removed && stillAnswers && !packages.isInstalled() && left.length === 0;
  log(`uninstall: removed=${removed} stillAnswers=${stillAnswers} left=${left.join(', ') || 'nothing'}`);
  if (left.includes(PAYLOAD)) run('find', [PAYLOAD, '-maxdepth', '3', '-ls']);
  await close(openForRemoval);

  results['residue-scan'] =
    (await processesEnd()) && ![PAYLOAD, VERSIONS, COMMAND].some((path) => existsSync(path)) && userDataIsThere();
  await clearProcesses();

  results['in-use-upgrade'] = await upgradeOverARunningCopy();
}

/** FR-009 to FR-011, SC-003: an older copy left open across the upgrade, then the restart, then the refused downgrade. */
async function upgradeOverARunningCopy() {
  const oldVersion = readOlderVersion();
  if (!packages.install(older)) return false;
  const session = await open(COMMAND);
  const running = processes().find((p) => /\/throng-bin$/.test(p.exe) && !p.cmdline.includes('--type='));
  const daemon = (await waitForDaemon()).pid;
  await rpc('projects.create', { name: 'verify-two', colour: '#3b82f6', rootFolder: projectRoot('verify-two') });
  const kept = await keepTerminal();

  const upgraded = packages.install(artifact);
  const moved = readlinkSync(join(VERSIONS, 'current')) === expectedVersion;
  const oldStays = existsSync(join(VERSIONS, oldVersion, 'resources', 'app', 'package.json'));

  // The on-demand loads a replaced tree would break: a reload reads the renderer's files again (FR-009).
  await session.window.reload();
  await session.window.waitForLoadState('domcontentloaded');
  const stillOurs = (await session.window.evaluate(() => 1 + 1).catch(() => 0)) === 2;
  const sameDaemon = (await waitForDaemon()).pid === daemon;
  const terminalLives = await keepIsListed();
  const exeStays = running?.exe === join(VERSIONS, oldVersion, 'throng-bin');

  // FR-010: the one notice, with what resolves it. The check runs when the window announces itself, as the reload did.
  const notice = session.window.getByTestId('installed-version-notice');
  const noticed = await notice.waitFor({ timeout: 80_000 }).then(() => true, () => false);
  const restartOffered = noticed && (await session.window.getByTestId('installed-version-restart').count()) === 1;

  await rpc('terminal.killAll', {});
  await close(session);

  // The next launch is the new version, with every project there (FR-011). Its daemon may be the old one if the
  // daemon's code did not change between the two, which is why this does not compare daemons.
  const next = await open(COMMAND);
  const newRuns = processes().some((p) => p.exe === join(VERSIONS, expectedVersion, 'throng-bin'));
  const names = await projectNames();
  const dataKept = names.includes('verify-one') && names.includes('verify-two');
  await close(next);
  await clearProcesses();

  // The ordinary command refuses the older package, leaving everything as it was (FR-011).
  const attempt = packages.downgrade(older);
  const refused =
    packages.recordedVersion() === expectedVersion.replaceAll('-', '~') &&
    readlinkSync(join(VERSIONS, 'current')) === expectedVersion &&
    existsSync(join(VERSIONS, expectedVersion, 'throng-bin'));
  log(`downgrade: exit ${attempt.status}, refused=${refused}`);

  packages.remove();
  await clearProcesses();

  const facts = { kept, upgraded, moved, oldStays, stillOurs, sameDaemon, terminalLives, exeStays, noticed, restartOffered, newRuns, dataKept, refused };
  log(`in-use-upgrade: ${JSON.stringify(facts)}; projects ${names.join(', ')}`);
  return Object.values(facts).every(Boolean);
}

/** The older package's version, read from the package itself. */
function readOlderVersion() {
  const raw =
    role === 'deb'
      ? run('dpkg-deb', ['-f', older, 'Version'], { quiet: true }).stdout
      : run('rpm', ['-qp', '--qf', '%{VERSION}', older], { quiet: true }).stdout;
  return raw.trim().replaceAll('~', '-');
}

const SPACED_FOLDER = join(homedir(), 'throng verify archive');

/** Extract into a folder with a space in its path (spec edge case), and return the app's root. */
function extract() {
  // Under home, where a person extracts it, and where a setuid helper works: /tmp can be mounted nosuid.
  const into = SPACED_FOLDER;
  mkdirSync(into, { recursive: true });
  if (run('tar', ['-xzf', artifact, '-C', into]).status !== 0) return null;
  if (existsSync(join(into, 'throng'))) return into;
  for (const name of readdirSync(into)) if (existsSync(join(into, name, 'throng'))) return join(into, name);
  log('archive: no throng in the extracted folder');
  return null;
}

const namespacesAreRestricted = () => run('unshare', ['--user', '--map-root-user', 'true'], { quiet: true }).status !== 0;

/** The launcher run with no display, so its message reaches stderr and no dialog waits for an answer. */
function launcherRefusal(root) {
  const env = { ...process.env };
  delete env.DISPLAY;
  delete env.WAYLAND_DISPLAY;
  return spawnSync(join(root, 'throng'), [], { encoding: 'utf8', env, timeout: 30_000 });
}

/** The helper cannot run from a path with a space, so the launcher says to move the folder, and offers no commands. */
function refusesTheSpace(root) {
  const refused = launcherRefusal(root);
  log(`archive: from a spaced path, launcher exit ${refused.status}\n${refused.stderr}`);
  return refused.status === 1 && refused.stderr.includes('path with no spaces') && !refused.stderr.includes('sudo ');
}

/**
 * Where the machine restricts user namespaces, the launcher refuses and gives the fix (FR-008). Its commands are run
 * exactly as it printed them, so a wrong one fails here.
 */
function refusesThenFixes(root) {
  const refused = launcherRefusal(root);
  const commands = (refused.stderr ?? '').split('\n').map((l) => l.trim()).filter((l) => l.startsWith('sudo '));
  log(`archive: launcher exit ${refused.status}, gave ${commands.length} command(s)\n${refused.stderr}`);
  if (refused.status !== 1 || commands.length !== 2) return false;
  return commands.every((command) => run('sh', ['-c', command.replace(/^sudo /, 'sudo -n ')]).status === 0);
}

/** What Electron says when started with nothing attached, since a launch that dies tells Playwright nothing. */
function showPlainStart(root) {
  run('ls', ['-l', join(root, 'chrome-sandbox')]);
  run('findmnt', ['-T', root]);
  const start = spawnSync(join(root, 'throng'), [], {
    encoding: 'utf8',
    timeout: 10_000,
    env: { ...process.env, THRONG_PIPE_NAME: pipe, THRONG_LOG_DIR: logDir },
  });
  log(`archive: a plain start → status ${start.status}, signal ${start.signal}\n${start.stderr ?? ''}`);
  for (const p of processes().filter(isThrongProcess)) {
    try {
      process.kill(p.pid, 'SIGKILL');
    } catch {
      /* Already gone. */
    }
  }
}

/** The archive: extract, run, delete the folder. There is nothing else to remove (FR-004, US4). */
async function verifyArchive(results) {
  const spaced = extract();
  if (!spaced) {
    results.launch = false;
    return;
  }
  const restricted = namespacesAreRestricted();
  log(`archive: this machine ${restricted ? 'restricts' : 'does not restrict'} user namespaces`);
  let root = spaced;
  let fixed = true;
  if (restricted) {
    fixed = refusesTheSpace(spaced);
    root = join(homedir(), 'throng-verify-archive');
    renameSync(spaced, root);
    fixed = refusesThenFixes(root) && fixed;
  }
  results['version-match'] = versionMatches(root);
  results['no-service'] = noService();

  const launcher = join(root, 'throng');
  const session = await open(launcher).catch((err) => {
    showPlainStart(root);
    throw err;
  });
  results.launch = fixed && sandboxIsOn();
  results['self-contained'] = daemonIsSelfContained(root);
  results['core-journey'] = await journeyHolds('verify-archive');
  await rpc('terminal.killAll', {});
  await close(session);

  results.reattach = await reattaches(launcher);
  await clearProcesses();

  if (restricted) {
    results.launch = (await runsFromASpaceWhereAllowed(root, spaced)) && results.launch;
    await clearProcesses();
    root = spaced;
  }

  rmSync(root, { recursive: true, force: true });
  results['residue-scan'] = (await processesEnd()) && !existsSync(root) && userDataIsThere();
  rmSync(SPACED_FOLDER, { recursive: true, force: true });
}

/** Spec edge case: with no restriction the helper is not needed, so a path with a space runs normally. */
async function runsFromASpaceWhereAllowed(root, spaced) {
  renameSync(root, spaced);
  const setting = 'kernel.apparmor_restrict_unprivileged_userns';
  sudo('sysctl', '-w', `${setting}=0`);
  try {
    const session = await open(join(spaced, 'throng'));
    const on = sandboxIsOn();
    await close(session);
    log(`archive: from a spaced path, with no restriction: sandbox ${on}`);
    return on;
  } finally {
    sudo('sysctl', '-w', `${setting}=1`);
  }
}

const results = {};
let sha256 = '';

/** Write the verdict from what the run established, and leave. Once: a crash can arrive during the ordinary path. */
let finished = false;
function finish() {
  if (finished) return;
  finished = true;
  const combination = combinationsOf(declareArtifactSet(expectedVersion)).find((c) => c.role === role);
  const verdict = buildArtifactVerdict(combination, sha256, results, {});
  const document = { version: expectedVersion, ...verdict };
  mkdirSync(dirname(resolve(verdictOut)), { recursive: true });
  writeFileSync(verdictOut, JSON.stringify(document, null, 2));
  console.log(`[verify-linux] verdict → ${verdictOut}\n${JSON.stringify(document, null, 2)}`);

  cpSync(scratch, join(logDir, 'scratch'), { recursive: true, filter: (source) => !source.endsWith('.sock') });
  rmSync(scratch, { recursive: true, force: true });
  process.exit(verdict.passed ? 0 : 1);
}

/**
 * A crash must still leave evidence. Playwright can throw from its own internals after a failed launch, which reaches the
 * top level instead of the catch below (the Windows harness met the same thing), and an absent verdict names nothing.
 */
function crashed(err) {
  log(`crashed: ${err instanceof Error ? (err.stack ?? err.message) : err}`);
  finish();
}
process.on('uncaughtException', crashed);
process.on('unhandledRejection', crashed);

async function main() {
  sha256 = await sha256OfFile(artifact);
  results['checksum-match'] = /^[a-f0-9]{64}$/i.test(sha256);
  try {
    if (isPackage) await verifyPackage(results);
    else await verifyArchive(results);
  } catch (err) {
    // A harness failure names where it got to, and the steps it reached still count.
    log(`stopped: ${err instanceof Error ? (err.stack ?? err.message) : err}`);
    await clearProcesses().catch(() => {});
  }
  finish();
}

main().catch(crashed);
