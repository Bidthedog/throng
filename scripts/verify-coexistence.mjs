// The coexistence run (058 FR-031, FR-018, FR-021, research D11): every installer in every scope and
// the archive, on ONE clean machine at once, proving they live side by side.
//
//   all-installed                 five copies are on disk together
//   each-launches-own-version     each opens a window and reports the version it claims
//   second-launch-refused         launching another copy while one runs starts no second instance
//   same-data-folder              every copy keeps its data in the one per-user folder
//   reattach-across-copies        a terminal started from one copy is reattached from another copy
//                                 of the same build (FR-021)
//   reinstall-one-leaves-others   reinstalling one copy in place leaves the other four installed
//   uninstall-one-leaves-others   removing one copy leaves the other four installed and launchable
//
// "Reinstall" is a same-version reinstall in place: no earlier release carries an MSI, so a
// cross-version upgrade of every format cannot be exercised until the next release (research D11);
// the by-hand upgrade check for this release is in the quickstart.
//
// Three of these steps (second-launch-refused, same-data-folder, reattach-across-copies) can prove
// nothing unless they use the REAL per-user namespace and data folder, so this run refuses a machine
// that already has a throng profile unless `--allow-dirty-profile` is given. It is for the release
// matrix's clean runner, not for a developer machine.
import { execFileSync, spawn } from 'node:child_process';
import { copyFileSync, existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { buildCoexistenceVerdict, declareArtifactSet, resolveArtifact } from '@throng/core';
import { installLayout } from './verify-installer-args.mjs';
import { runAsAccount, systemRunner, withSecondAccount } from './second-account.mjs';
import { makeSharedDir, removeSharedDir, runCommand, withInstallerPolicyEnabled } from './verify-scope-steps.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const psq = (s) => String(s).replace(/'/g, "''");

/** Everything running from under `dir`: pid, image name, command line. */
function processesUnder(dirs) {
  const roots = dirs.map((d) => `'${psq(d)}'`).join(',');
  const script =
    `$roots = @(${roots})\n` +
    `$rows = Get-CimInstance Win32_Process | Where-Object { $p = $_.ExecutablePath; $p -and ($roots | Where-Object { $p.StartsWith($_, [System.StringComparison]::OrdinalIgnoreCase) }) } | ` +
    `ForEach-Object { [pscustomobject]@{ pid = [int]$_.ProcessId; name = [string]$_.Name; path = [string]$_.ExecutablePath; commandLine = [string]$_.CommandLine } }\n` +
    `ConvertTo-Json -Compress -InputObject @($rows)`;
  try {
    const out = execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', timeout: 60000 });
    const parsed = JSON.parse(out || '[]');
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return [];
  }
}

/** The main (browser) processes of throng: the executable itself with no `--type=` role argument. */
const mainProcesses = (dirs) =>
  processesUnder(dirs).filter((p) => /^throng\.exe$/i.test(p.name) && !/--type=/.test(p.commandLine));

function stopProcesses(predicateScript) {
  try {
    execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', predicateScript], { stdio: 'ignore', timeout: 60000 });
  } catch {
    /* best effort */
  }
}

/** Stop the app's processes under these roots but leave the daemon (node.exe), which must outlive the UI. */
function stopApp(dirs) {
  const roots = dirs.map((d) => `'${psq(d)}'`).join(',');
  stopProcesses(
    `$roots = @(${roots}); Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'throng.exe' -and $_.ExecutablePath } | ` +
      `Where-Object { $path = $_.ExecutablePath; $roots | Where-Object { $path.StartsWith($_, [System.StringComparison]::OrdinalIgnoreCase) } } | ` +
      `ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`,
  );
}

/** Stop everything under these roots, daemon included. */
function stopAll(dirs) {
  for (const p of processesUnder(dirs)) {
    stopProcesses(`Stop-Process -Id ${p.pid} -Force -ErrorAction SilentlyContinue`);
  }
}

/** Open the app with its own throwaway namespace and require a real window. */
async function opensWindow(exe, tag) {
  let electron;
  try {
    ({ _electron: electron } = await import('@playwright/test'));
  } catch (err) {
    console.error(`[verify-coexistence] Playwright unavailable — ${err.message}`);
    return false;
  }
  const profile = join(process.env.TEMP ?? homedir(), `throng-coexist-${tag}-${process.pid}`);
  let app;
  try {
    app = await electron.launch({
      executablePath: exe,
      args: [`--user-data-dir=${profile}`],
      env: {
        ...process.env,
        THRONG_PIPE_NAME: `\\\\.\\pipe\\throng-coexist-${tag}-${process.pid}`,
        THRONG_CONFIG_ROOT: join(profile, 'config'),
        THRONG_DATABASE_PATH: join(profile, 'throng.db'),
      },
      timeout: 45000,
    });
    const win = await app.firstWindow({ timeout: 30000 });
    await win.waitForLoadState('domcontentloaded');
    return true;
  } catch (err) {
    console.error(`[verify-coexistence] ${tag}: no window — ${err.message}`);
    return false;
  } finally {
    if (app) await Promise.race([app.close().catch(() => {}), delay(10000)]);
  }
}

/** Start an app in the REAL namespace and wait until its main process is up. */
async function startInRealNamespace(exe, dirs, waitMs = 40000) {
  spawn(exe, [], { detached: true, stdio: 'ignore' }).unref();
  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    await delay(1500);
    if (mainProcesses(dirs).length > 0) return true;
  }
  return false;
}

/** The per-user daemon pipe a running throng created, found by name — it is derived from the account. */
function discoverDaemonPipe() {
  try {
    const out = execFileSync(
      'powershell',
      ['-NoProfile', '-NonInteractive', '-Command', "[System.IO.Directory]::GetFiles('\\\\.\\pipe\\') | Where-Object { $_ -like '*throng.*.daemon' }"],
      { encoding: 'utf8', timeout: 30000 },
    );
    return out.split(/\r?\n/).map((l) => l.trim()).find((l) => /throng\..*\.daemon$/.test(l)) ?? null;
  } catch {
    return null;
  }
}

/** Run the standalone probe with a copy's own bundled runtime; returns its single JSON line. */
function probe(root, sharedDir, args) {
  const script = join(sharedDir, 'daemon-probe.mjs');
  try {
    const out = execFileSync(join(root, 'resources', 'runtime', 'node.exe'), [script, ...args], { encoding: 'utf8', timeout: 90000 });
    return JSON.parse(out.trim().split(/\r?\n/).pop());
  } catch (err) {
    const stdout = String(err.stdout ?? '').trim().split(/\r?\n/).pop();
    try {
      return JSON.parse(stdout);
    } catch {
      return { ok: false, error: err.message };
    }
  }
}

const appDataThrongDirs = () => {
  const appData = process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming');
  try {
    return readdirSync(appData).filter((n) => /throng/i.test(n));
  } catch {
    return [];
  }
};

/**
 * @param {{dir: string, expectedVersion?: string, verdictOut: string, allowDirtyProfile: boolean}} options
 * @returns {Promise<number>} the process exit code.
 */
export async function runCoexistence(options) {
  const repoRoot = join(here, '..');
  const version = options.expectedVersion ?? JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')).version;
  const set = declareArtifactSet(version);
  const artifactPath = (role) => join(options.dir, resolveArtifact(set, role).filename);
  const log = (m) => console.error(`[verify-coexistence] ${m}`);

  if (appDataThrongDirs().length > 0 && !options.allowDirtyProfile) {
    log(
      `refusing: this machine already has a throng profile (${appDataThrongDirs().join(', ')}). The real-namespace steps prove ` +
        'nothing on a machine that has one. Run it on a clean runner, or pass --allow-dirty-profile (a warning, not a fix).',
    );
    return 2;
  }
  if (options.allowDirtyProfile) log('WARNING: --allow-dirty-profile — an existing throng profile can make the real-namespace steps pass or fail for the wrong reason');

  const copies = [];
  const results = {};
  const layouts = {};
  const sharedDir = makeSharedDir();
  copyFileSync(join(here, 'daemon-probe.mjs'), join(sharedDir, 'daemon-probe.mjs'));

  try {
    return await withInstallerPolicyEnabled(() => withSecondAccount(systemRunner, async (account) => {
    // Five copies on one machine: the two installers in both scopes, and the archive extracted.
    //
    // The MSI is the exception to "everything is installed by the administrator": it has ONE product
    // code per build, so one account cannot hold it per-user and machine-wide at once — installing the
    // second scope would go to maintenance on the first. Windows Installer tracks a per-user install
    // per account, though, so the per-user MSI is installed by a standard SECOND account and the
    // machine-wide one by the administrator. The copy list in the verdict says who installed what.
    for (const [role, scope] of [['setup', 'per-user'], ['setup', 'machine'], ['msi', 'per-user'], ['msi', 'machine']]) {
      const id = `${role}-${scope === 'machine' ? 'machine' : 'user'}`;
      let layout;
      let code;
      let installedBy = 'the administrator';
      if (id === 'msi-user') {
        const profile = join('C:\\Users', account.name);
        const sharedMsi = join(sharedDir, 'msi-under-test.msi');
        copyFileSync(artifactPath('msi'), sharedMsi);
        layout = installLayout({
          role,
          scope,
          version,
          artifactPath: sharedMsi,
          env: { LOCALAPPDATA: join(profile, 'AppData', 'Local'), APPDATA: join(profile, 'AppData', 'Roaming'), SystemRoot: process.env.SystemRoot },
        });
        code = (await runAsAccount(systemRunner, account, sharedDir, { file: layout.install.file, args: layout.install.args, timeoutMs: 300000 })).code;
        installedBy = 'a standard second account (one product code cannot be held per-user and machine-wide by one account)';
      } else {
        layout = installLayout({ role, scope, version, artifactPath: artifactPath(role), env: process.env });
        code = runCommand(layout.install.file, layout.install.args, 300000);
      }
      layouts[id] = layout;
      await delay(4000);
      if (!layout.install.okCodes.includes(code)) log(`${id}: install exited ${code}`);
      copies.push({ id, installRoot: layout.root, version, installedBy });
    }
    const archiveRoot = join(process.env.TEMP ?? homedir(), `throng-coexist-archive-${process.pid}`);
    try {
      execFileSync('powershell', ['-NoProfile', '-Command', `Expand-Archive -LiteralPath '${psq(artifactPath('archive'))}' -DestinationPath '${psq(archiveRoot)}' -Force`], { stdio: 'inherit', timeout: 300000 });
    } catch (err) {
      log(`archive: extraction failed — ${err.message}`);
    }
    // electron-builder's zip holds the app at the archive root; tolerate one wrapper directory.
    const archiveApp = existsSync(join(archiveRoot, 'throng.exe'))
      ? archiveRoot
      : (readdirSync(archiveRoot).map((e) => join(archiveRoot, e)).find((p) => existsSync(join(p, 'throng.exe'))) ?? archiveRoot);
    copies.push({ id: 'archive', installRoot: archiveApp, version });

    const roots = copies.map((c) => c.installRoot);
    const exeOf = (c) => join(c.installRoot, 'throng.exe');
    const reportedVersion = (c) => {
      try {
        return JSON.parse(readFileSync(join(c.installRoot, 'resources', 'app', 'package.json'), 'utf8')).version;
      } catch {
        return null;
      }
    };

    results['all-installed'] = copies.every((c) => existsSync(exeOf(c)));
    if (!results['all-installed']) log(`not installed: ${copies.filter((c) => !existsSync(exeOf(c))).map((c) => c.id).join(', ')}`);

    // Each copy opens a window of its own and says the version it is.
    let each = true;
    for (const c of copies) {
      const opens = await opensWindow(exeOf(c), c.id);
      const own = reportedVersion(c) === version;
      if (!opens || !own) log(`${c.id}: window ${opens ? 'opened' : 'DID NOT open'}, version ${reportedVersion(c)} (want ${version})`);
      each = each && opens && own;
      stopAll(roots);
      await delay(2000);
    }
    results['each-launches-own-version'] = each;

    // The next three use the REAL namespace. Start from nothing running.
    stopAll(roots);
    await delay(3000);
    const [first, second, third] = [copies[0], copies[3], copies[2]];
    const firstUp = await startInRealNamespace(exeOf(first), roots);
    await delay(6000);
    spawn(exeOf(second), [], { detached: true, stdio: 'ignore' }).unref();
    await delay(10000);
    const mains = mainProcesses(roots);
    results['second-launch-refused'] = firstUp && mains.length === 1 && mains[0].path.toLowerCase().startsWith(first.installRoot.toLowerCase());
    if (!results['second-launch-refused']) log(`second-launch-refused: ${mains.length} main process(es) running after two launches (want 1, from ${first.id})`);

    // Reattach across copies: start a terminal that stays open, close the first copy's window (not
    // its daemon), open a THIRD copy of the same build, and find the same daemon with the terminal.
    const pipe = discoverDaemonPipe();
    let reattached = false;
    if (pipe) {
      const started = probe(first.installRoot, sharedDir, ['--pipe', pipe, '--terminal', 'keep']);
      stopApp(roots);
      await delay(3000);
      const up = await startInRealNamespace(exeOf(third), roots);
      await delay(6000);
      const listed = probe(first.installRoot, sharedDir, ['--pipe', pipe, '--list']);
      reattached = up && started.ok === true && listed.pid === started.pid && listed.keepSessionListed === true;
      if (!reattached) log(`reattach-across-copies: started ${JSON.stringify(started)}; from ${third.id}: ${JSON.stringify(listed)}`);
    } else {
      log('reattach-across-copies: no per-user daemon pipe appeared');
    }
    results['reattach-across-copies'] = reattached;

    // Every copy keeps its data in the one folder. Open each in turn, then look at what was made.
    for (const c of copies) {
      stopApp(roots);
      await delay(2000);
      await startInRealNamespace(exeOf(c), roots, 30000);
      await delay(4000);
    }
    stopAll(roots);
    const dataDirs = appDataThrongDirs();
    results['same-data-folder'] = dataDirs.length === 1 && dataDirs[0].toLowerCase() === 'throng';
    if (!results['same-data-folder']) log(`same-data-folder: found ${JSON.stringify(dataDirs)} under %APPDATA% (want exactly "throng")`);
    await delay(3000);

    // Reinstalling one copy in place leaves the other four alone.
    const reinstalled = layouts['setup-user'];
    const reinstallCode = runCommand(reinstalled.reinstall.file, reinstalled.reinstall.args, 300000);
    await delay(4000);
    results['reinstall-one-leaves-others'] =
      reinstalled.reinstall.okCodes.includes(reinstallCode) && copies.every((c) => existsSync(exeOf(c)));
    if (!results['reinstall-one-leaves-others']) log(`reinstall-one-leaves-others: exit ${reinstallCode}`);

    // Removing one copy leaves the other four installed and still launchable.
    const removed = layouts['msi-machine'];
    stopAll(roots);
    await delay(3000);
    const uninstallCode = runCommand(removed.uninstall.file, removed.uninstall.args, 300000);
    await delay(4000);
    const remaining = copies.filter((c) => c.id !== 'msi-machine');
    let others = !existsSync(join(removed.root, 'throng.exe')) && uninstallCode >= 0 && remaining.every((c) => existsSync(exeOf(c)));
    for (const c of remaining) {
      const opens = others ? await opensWindow(exeOf(c), `after-${c.id}`) : false;
      stopAll(roots);
      others = others && opens;
    }
    results['uninstall-one-leaves-others'] = others;

    // Tidy what is left: this run owns every copy it installed.
    stopAll(roots);
    for (const id of ['setup-user', 'setup-machine']) {
      const l = layouts[id];
      runCommand(l.uninstall.file, l.uninstall.args, 300000);
    }
    // The per-user MSI belongs to the second account, so it is removed by that account.
    const accountMsi = layouts['msi-user'];
    await runAsAccount(systemRunner, account, sharedDir, { file: accountMsi.uninstall.file, args: accountMsi.uninstall.args, timeoutMs: 300000 }).catch(() => {});
    rmSync(archiveRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 500 });

    const verdict = buildCoexistenceVerdict(version, copies, results);
    writeFileSync(options.verdictOut, JSON.stringify(verdict, null, 2));
    console.log(`[verify-coexistence] verdict → ${options.verdictOut}\n${JSON.stringify(verdict, null, 2)}`);
    return verdict.passed ? 0 : 1;
    }, { onWarning: (m) => log(`warning: ${m}`) }), log);
  } catch (err) {
    // A crash must still leave evidence, like the per-combination harness: a failing verdict.
    log(err instanceof Error ? (err.stack ?? err.message) : String(err));
    const verdict = buildCoexistenceVerdict(version, copies, results);
    writeFileSync(options.verdictOut, JSON.stringify({ ...verdict, harnessError: String(err?.message ?? err).split('\n')[0] }, null, 2));
    return 1;
  } finally {
    removeSharedDir(sharedDir);
  }
}
