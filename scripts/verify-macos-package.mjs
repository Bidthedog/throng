// The clean-machine lifecycle of one macOS copy (070 FR-010, FR-045, research R26), the macOS counterpart of
// verify-linux-package.mjs. It writes the same verdict, over the same step vocabulary (MACOS_PACKAGE_STEPS).
//
//   node scripts/verify-macos-package.mjs <artifact> --role dmg|macarchive --runner current|previous
//        --expected-version X --verdict-out <file> [--older <older .dmg or .zip>]
//
// `--older` is required for the disk image: an older build of this tree, for the upgrade over a running copy. Run it on
// a clean hosted Mac, as the runner's own account: it installs into ~/Applications, opens the app through Launch
// Services and deletes it again, so it is not for a workstation. Every step is tried even after one fails, so the
// verdict says what held and what did not; `gatekeeper-first-launch` is recorded unproven, because no hosted runner can
// click Open Anyway.
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { matchReleaseVersions } from '@throng/core';
import { _electron as electron } from '@playwright/test';
import { sha256OfFile } from './checksum.mjs';
import { darwinProcessTable } from './process-table.mjs';
import {
  coreJourney,
  createRpc,
  keepIsListed,
  keepTerminal,
  projectNames,
  projectRoot,
  reattaches,
  runStep,
  snapshot,
  waitForDaemon as waitForDaemonOn,
} from './verify-package-lib.mjs';
import {
  DEV_LIBRARY_ENTRIES,
  LIBRARY_FOLDERS_SCANNED,
  TRANSLOCATED_EXEC_PATH,
  isThrongProcess,
  macosVerdict,
  parseMacosVerifyArgs,
  undocumentedLibraryEntries,
  versionlessFilename,
} from './verify-macos-lib.mjs';

const args = parseMacosVerifyArgs(process.argv.slice(2));
if (!args.ok) {
  console.error(args.message);
  process.exit(args.code);
}
if (process.platform !== 'darwin' || process.getuid?.() === 0) {
  console.error('[verify-macos] runs on macOS, as an account that is not root: throng refuses to start as root.');
  process.exit(2);
}
const artifact = resolve(args.artifact);
const older = args.older ? resolve(args.older) : undefined;
const { role, runner, expectedVersion, verdictOut } = args;
if (!existsSync(artifact) || (older && !existsSync(older))) {
  console.error(`[verify-macos] no such file: ${existsSync(artifact) ? older : artifact}`);
  process.exit(2);
}

const log = (message) => console.error(`[verify-macos] ${new Date().toISOString()} ${message}`);
const scratch = mkdtempSync(join(tmpdir(), 'throng-verify-'));
const pipe = join(scratch, 'd.sock');
const logDir = resolve('installer-logs');
mkdirSync(logDir, { recursive: true });

/** A fresh Applications folder of the account's own, which installed-copy detection treats as installed (T036). */
const APPLICATIONS = join(homedir(), 'Applications');
const BUNDLE = join(APPLICATIONS, 'throng.app');
const EXECUTABLE = join(BUNDLE, 'Contents', 'MacOS', 'throng');
const RUNTIME = join(BUNDLE, 'Contents', 'Resources', 'runtime', 'node');
const LIBRARY = join(homedir(), 'Library');
/** The new copy as it came out of the download, kept aside so the upgrade can put it over the older one. */
const PRISTINE = join(scratch, 'new', 'throng.app');
/** How the app is reached: Launch Services starts `open -a` launches with launchd's environment, not this one. */
const APP_ENV = { THRONG_PIPE_NAME: pipe, THRONG_LOG_DIR: logDir };

/** Run a command, say what it did, and answer with its result. */
function run(file, argv, { quiet = false, env, timeout = 600_000 } = {}) {
  const result = spawnSync(file, argv, { encoding: 'utf8', timeout, env: env ? { ...process.env, ...env } : process.env });
  if (!quiet || result.status !== 0) {
    log(`$ ${file} ${argv.join(' ')} → ${result.status}${result.signal ? ` (${result.signal})` : ''}\n${result.stdout ?? ''}${result.stderr ?? ''}`);
  }
  return result;
}

const rpc = createRpc(pipe);
const waitForDaemon = () => waitForDaemonOn(rpc);
const ours = () => darwinProcessTable().filter((p) => isThrongProcess(p, BUNDLE));

/** The `.app` out of a disk image (mounted read-only, never shown in Finder) or an archive, into `into`. */
function extractBundle(file, into) {
  mkdirSync(into, { recursive: true });
  if (file.endsWith('.dmg')) {
    const mount = mkdtempSync(join(scratch, 'mount-'));
    if (run('hdiutil', ['attach', '-nobrowse', '-readonly', '-noautoopen', '-mountpoint', mount, file]).status !== 0) return false;
    try {
      if (run('ditto', [join(mount, 'throng.app'), join(into, 'throng.app')]).status !== 0) return false;
    } finally {
      run('hdiutil', ['detach', mount, '-force'], { quiet: true });
    }
  } else if (run('ditto', ['-x', '-k', file, into]).status !== 0) {
    return false;
  }
  return existsSync(join(into, 'throng.app', 'Contents', 'MacOS', 'throng'));
}

/** Launch the installed copy as a person's double-click would, with Playwright attached. No --no-sandbox is added. */
async function open() {
  const app = await electron.launch({
    executablePath: EXECUTABLE,
    env: { ...process.env, ...APP_ENV },
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

/** Stop anything of this copy's still running, so one step's leftovers are not the next step's starting state. */
async function clearProcesses() {
  try {
    await rpc('terminal.killAll', {}, 5000);
  } catch {
    /* No daemon. */
  }
  for (const p of ours()) {
    try {
      process.kill(p.pid, 'SIGKILL');
    } catch {
      /* Already gone. */
    }
  }
  await delay(1000);
}

const plistVersion = (bundle) =>
  run('plutil', ['-extract', 'CFBundleShortVersionString', 'raw', '-o', '-', join(bundle, 'Contents', 'Info.plist')], { quiet: true }).stdout.trim();

/** Copy the download into a fresh Applications folder, as a person drags it there. */
function install() {
  if (existsSync(BUNDLE)) {
    log(`install: ${BUNDLE} is already there, so this is not a clean machine`);
    return false;
  }
  if (!extractBundle(artifact, dirname(PRISTINE))) return false;
  return run('ditto', [PRISTINE, BUNDLE]).status === 0 && existsSync(EXECUTABLE);
}

/**
 * FR-007: launched as if translocated (T035's THRONG_TEST_EXEC_PATH seam), the copy says to move it and exits 1,
 * starting nothing — no daemon, no terminal host, no collector — and making no data folder. Run before any other launch,
 * while a clean machine has no data folder to confuse with a new one.
 */
function refusesTranslocated() {
  const data = join(LIBRARY, 'Application Support', 'throng');
  const before = existsSync(data);
  // Thirty seconds: a refusal that waits on a dialog nobody can click is a hang, and fails here rather than stalling.
  const start = run(EXECUTABLE, [], { env: { ...APP_ENV, THRONG_TEST_EXEC_PATH: TRANSLOCATED_EXEC_PATH }, timeout: 30_000 });
  const left = ours();
  const facts = {
    exitedOne: start.status === 1,
    nothingLeft: left.length === 0,
    noDataFolder: !before && !existsSync(data),
  };
  log(`translocated: ${JSON.stringify(facts)}${left.length ? `; still running ${left.map((p) => `${p.pid} ${p.comm}`).join(', ')}` : ''}`);
  return Object.values(facts).every(Boolean);
}

/** The sandbox is on: no process of this copy disabled it, and a renderer is running. */
function sandboxIsOn() {
  const mine = ours();
  const off = mine.filter((p) => p.args.includes('--no-sandbox'));
  if (off.length > 0) log(`launch: --no-sandbox on ${off.map((p) => p.pid).join(', ')}`);
  return off.length === 0 && mine.some((p) => p.args.includes('--type=renderer'));
}

/** The daemon runs under the bundle's own runtime, whatever `node` this Mac has (FR-004). */
function daemonIsSelfContained() {
  const daemons = ours().filter((p) => p.args.includes('packages/daemon/dist/main.js'));
  log(`self-contained: daemon(s) ${daemons.map((p) => `${p.pid} ${p.comm}`).join(', ') || 'none'}`);
  return daemons.length > 0 && daemons.every((p) => p.comm === RUNTIME || p.args.startsWith(`${RUNTIME} `));
}

/** Info.plist, the version the app reports (what About shows), its manifest and the filename all say one version. */
async function versionMatches(session) {
  const plist = plistVersion(BUNDLE);
  const reported = await session.app.evaluate(({ app }) => app.getVersion());
  const manifest = JSON.parse(readFileSync(join(BUNDLE, 'Contents', 'Resources', 'app', 'package.json'), 'utf8')).version;
  const match = matchReleaseVersions({
    installerFilename: versionlessFilename(basename(artifact)),
    packageVersion: expectedVersion,
    reportedVersion: reported,
    releaseTag: `v${expectedVersion}`,
  });
  log(`version-match: plist ${plist}, reported ${reported}, manifest ${manifest}${match.matched ? '' : `; ${match.reason}`}`);
  return match.matched && plist === expectedVersion && manifest === expectedVersion;
}

/** Every `~/Library` entry naming throng, as `Caches/com.throng.throng`. */
function libraryEntries() {
  const found = [];
  for (const folder of LIBRARY_FOLDERS_SCANNED) {
    const dir = join(LIBRARY, folder);
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) if (/throng/i.test(name)) found.push(`${folder}/${name}`);
  }
  return found.sort();
}

const userDataIsThere = () => existsSync(join(LIBRARY, 'Application Support', 'throng'));
const devDataIsAbsent = () => DEV_LIBRARY_ENTRIES.every((entry) => !existsSync(join(LIBRARY, entry)));

/** The journey ran, in the installed copy's own folders and not dev mode's (FR-014). */
async function journeyHolds(name) {
  const facts = { terminal: await coreJourney(rpc, name), userData: userDataIsThere(), noDevData: devDataIsAbsent() };
  log(`core-journey: ${JSON.stringify(facts)}`);
  return Object.values(facts).every(Boolean);
}

/** A folder handed to the app some way becomes a project in its daemon within a minute (FR-024, FR-024a). */
async function opensAsProject(name, hand) {
  const folder = realpathSync(projectRoot(name));
  hand(folder);
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      if (JSON.stringify(await rpc('projects.list', {}, 2000)).includes(folder)) return true;
    } catch {
      /* Not up yet. */
    }
    await delay(1000);
  }
  log(`${name}: ${folder} did not become a project`);
  return false;
}

/** Finder's Open With and a folder dropped on the Dock icon, cold and with throng running (FR-024, research R19). */
async function opensFoldersFromLaunchServices() {
  await clearProcesses();
  const viaOpen = (folder) => run('open', ['-a', BUNDLE, folder]);
  const cold = await opensAsProject('verify-open-cold', viaOpen);
  const warm = await opensAsProject('verify-open-warm', viaOpen);
  const windows = ours().filter((p) => p.comm === EXECUTABLE).length;
  log(`open-file: cold=${cold} warm=${warm}, ${windows} app process(es)`);
  await clearProcesses();
  return cold && warm && windows === 1;
}

/** The bundle's own `bin/throng <folder>` opens the folder as a project (FR-024a, research R20). */
async function cliCommandOpensFolder() {
  await clearProcesses();
  const script = join(BUNDLE, 'Contents', 'Resources', 'bin', 'throng');
  const opened = await opensAsProject('verify-cli', (folder) => run(script, [folder], { env: APP_ENV }));
  await clearProcesses();
  return opened;
}

/** FR-008, US scenario: an older copy left open while the new one replaces it, then the next launch. Disk image only. */
async function upgradeOverARunningCopy() {
  rmSync(BUNDLE, { recursive: true, force: true });
  if (!older || !extractBundle(older, APPLICATIONS)) return false;
  const oldVersion = plistVersion(BUNDLE);
  const session = await open();
  const daemon = (await waitForDaemon()).pid;
  await rpc('projects.create', { name: 'verify-two', colour: '#3b82f6', rootFolder: projectRoot('verify-two') });
  const kept = await keepTerminal(rpc);

  // What dragging the new copy onto Applications does: the old bundle goes, the new one is copied in, all while it runs.
  rmSync(BUNDLE, { recursive: true, force: true });
  const replaced = run('ditto', [PRISTINE, BUNDLE]).status === 0 && plistVersion(BUNDLE) === expectedVersion;
  const stillOurs = (await session.window.evaluate(() => 1 + 1).catch(() => 0)) === 2;
  const sameDaemon = (await waitForDaemon()).pid === daemon;
  const terminalLives = await keepIsListed(rpc);

  // FR-008, 063 FR-010: the one notice. The app checks on focus and once a minute.
  await session.app
    .evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      win?.blur();
      win?.focus();
    })
    .catch(() => {});
  const noticed = await session.window.getByTestId('installed-version-notice').waitFor({ timeout: 80_000 }).then(
    () => true,
    () => false,
  );
  const restartOffered = noticed && (await session.window.getByTestId('installed-version-restart').count()) === 1;
  await rpc('terminal.killAll', {});
  await close(session);
  await clearProcesses();

  // The next launch is the new version, with every project there.
  const next = await open();
  const newRuns = (await next.app.evaluate(({ app }) => app.getVersion())) === expectedVersion;
  const names = await projectNames(rpc);
  const dataKept = names.includes('verify-one') && names.includes('verify-two');
  await close(next);
  await clearProcesses();

  const facts = { kept, replaced, stillOurs, sameDaemon, terminalLives, noticed, restartOffered, newRuns, dataKept };
  log(`in-use-upgrade: from ${oldVersion}: ${JSON.stringify(facts)}; projects ${names.join(', ')}`);
  return Object.values(facts).every(Boolean);
}

/** Removal is deleting the bundle, here while it runs: the window keeps working, and nothing is left of it on disk. */
async function deletedWhileRunning() {
  const session = await open();
  rmSync(BUNDLE, { recursive: true, force: true });
  const removed = !existsSync(BUNDLE);
  const stillAnswers = (await session.window.evaluate(() => 1 + 1).catch(() => 0)) === 2;
  await close(session);
  log(`uninstall: removed=${removed} stillAnswers=${stillAnswers}`);
  return removed && stillAnswers;
}

/** Nothing of the copy runs, nothing starts again, and only the documented folders remain. The daemon's own check is on a timer. */
async function nothingIsLeft() {
  const deadline = Date.now() + 45_000;
  let running = ours();
  while (running.length > 0 && Date.now() < deadline) {
    await delay(1000);
    running = ours();
  }
  const entries = libraryEntries();
  const undocumented = undocumentedLibraryEntries(entries);
  const facts = { noProcess: running.length === 0, noBundle: !existsSync(BUNDLE), userData: userDataIsThere(), onlyDocumented: undocumented.length === 0 };
  log(`residue: ${JSON.stringify(facts)}; ~/Library has ${entries.join(', ') || 'nothing of throng'}`);
  if (running.length > 0) log(`residue: still running ${running.map((p) => `${p.pid} ${p.comm}`).join(', ')}`);
  if (undocumented.length > 0) log(`residue: undocumented ${undocumented.join(', ')}`);
  return Object.values(facts).every(Boolean);
}

const results = {};
let sha256 = '';

/** Write the verdict from what the run established, and leave. Once: a crash can arrive during the ordinary path. */
let finished = false;
function finish() {
  if (finished) return;
  finished = true;
  for (const name of Object.keys(APP_ENV)) run('launchctl', ['unsetenv', name], { quiet: true });
  const { document, passed } = macosVerdict({ version: expectedVersion, role, runner, sha256, results });
  mkdirSync(dirname(resolve(verdictOut)), { recursive: true });
  writeFileSync(verdictOut, JSON.stringify(document, null, 2));
  console.log(`[verify-macos] verdict → ${verdictOut}\n${JSON.stringify(document, null, 2)}`);
  exitCode = passed ? 0 : 1;
  // Evidence for the uploaded logs. Copying it must not decide the exit code: a socket or FIFO left in the scratch
  // folder made cpSync throw here once, and the crash handler then exited 0 on a failed verdict.
  keepEvidence('scratch', scratch, (source) => !source.endsWith('.sock') && !source.includes('/new/'));
  // The window logs where a Mac keeps logs, not where THRONG_LOG_DIR points (only the daemon reads that).
  keepEvidence('app-logs', join(homedir(), 'Library', 'Logs', 'throng'));
  rmSync(scratch, { recursive: true, force: true });
  process.exit(exitCode);
}

/** The exit code the verdict set; a crash after it can make it worse, never better. */
let exitCode = 1;

/** Copy one folder into the uploaded logs, regular files and folders only; a failure is logged, not thrown. */
function keepEvidence(name, from, keep = () => true) {
  if (!existsSync(from)) return;
  try {
    cpSync(from, join(logDir, name), {
      recursive: true,
      filter: (source) => {
        const kind = lstatSync(source, { throwIfNoEntry: false });
        return kind !== undefined && (kind.isDirectory() || kind.isFile()) && keep(source);
      },
    });
  } catch (err) {
    log(`keep ${name}: ${err instanceof Error ? err.message : err}`);
  }
}

/** A crash must still leave evidence: Playwright can throw from its own internals after a failed launch. */
function crashed(err) {
  log(`crashed: ${err instanceof Error ? (err.stack ?? err.message) : err}`);
  // After the verdict, finish() has already run and returns at once: leave with a failure, never a silent 0.
  if (finished) process.exit(1);
  finish();
}
process.on('uncaughtException', crashed);
process.on('unhandledRejection', crashed);

async function main() {
  sha256 = await sha256OfFile(artifact);
  results['checksum-match'] = /^[a-f0-9]{64}$/i.test(sha256);
  // FR-010: a hosted runner cannot click Open Anyway, so the first-launch block is never met here. Listed in the body.
  results['gatekeeper-first-launch'] = 'unproven';
  for (const [name, value] of Object.entries(APP_ENV)) run('launchctl', ['setenv', name, value], { quiet: true });

  await runStep(results, 'install', install, log);
  if (!results.install) return finish();

  const translocationRefused = refusesTranslocated();
  await clearProcesses();
  const before = snapshot(BUNDLE);
  let journey = false;
  await runStep(
    results,
    'launch',
    async () => {
      const session = await open();
      try {
        const sandboxed = sandboxIsOn();
        results['self-contained'] = daemonIsSelfContained();
        results['version-match'] = await versionMatches(session).catch((err) => (log(`version-match: ${err}`), false));
        journey = await journeyHolds('verify-one');
        await rpc('terminal.killAll', {});
        return sandboxed;
      } finally {
        await close(session);
      }
    },
    log,
  );
  await runStep(results, 'reattach', () => reattaches({ rpc, open, close, log }), log);
  await clearProcesses();
  await runStep(results, 'core-journey', async () => journey && translocationRefused && (await opensFoldersFromLaunchServices()), log);
  await runStep(results, 'cli-command', cliCommandOpensFolder, log);
  results['no-write'] = existsSync(BUNDLE) && snapshot(BUNDLE) === before;
  if (role === 'dmg') await runStep(results, 'in-use-upgrade', upgradeOverARunningCopy, log);
  await runStep(results, 'uninstall', deletedWhileRunning, log);
  await runStep(results, 'residue-scan', nothingIsLeft, log);
  await clearProcesses().catch(() => {});
  finish();
}

main().catch(crashed);
