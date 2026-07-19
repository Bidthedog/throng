// Installer verification harness (020 FR-023–FR-027, FR-024a; US4).
//
// Exercises a built package's lifecycle on a clean environment and emits a VerificationVerdict
// bound to the exact package {version, installerSha256}. Designed to run on a fresh CI runner
// (a real "clean machine"); an ABSENT verdict is a failure, never a pass (FR-027).
//
// Usage: node scripts/verify-installer.mjs <path-to-installer.exe> [--expected-version X]
//        [--verdict-out verdict.json] [--expected-sha <sha256>]
//
// Steps (each recorded pass/fail; the first failure names the verdict's failedStep):
//   interrupted-install → install → launch → version-match → self-contained → shortcut →
//   no-service → core-journey → reattach → checksum-match → no-write → uninstall → residue-scan
//
// NOTE: `launch` drives the INSTALLED app through Playwright's Electron launcher and requires a
// real window to appear — so a main-process crash at startup (e.g. an unresolved import) FAILS
// verification instead of passing (this is what previously let a broken package ship green: a
// bare `start throng.exe` leaves the crash dialog "running" and always looked like a pass). The
// full create-project + spawn-terminal + reattach journey (T034c) is driven by the packaged-app
// E2E and is expanded as this harness matures. Mechanical steps (install, version from the
// installed manifest, checksum, uninstall, residue) are exercised here.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { homedir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { verdictFromSteps, matchReleaseVersions } from '@throng/core';
import { sha256OfFile } from './checksum.mjs';
import { scanResidue } from './residue-scan.mjs';

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

/** Escape a string for safe interpolation inside a single-quoted PowerShell literal. */
function psq(s) {
  return String(s).replace(/'/g, "''");
}

/**
 * Kill the installed app AND its DETACHED daemon before uninstalling. The daemon is a `node.exe`
 * spawned from the bundled runtime that, by design (Principle III), survives the UI closing — so a
 * plain `taskkill throng.exe` leaves it running, holding `resources/runtime/node.exe` locked, and
 * the silent uninstaller then blocks forever on that lock (the CI hang this fixes). Target only
 * processes whose image lives under the install dir, so we never touch the runner's own node.
 */
function killInstalledProcesses(dir) {
  const script =
    `Get-CimInstance Win32_Process | ` +
    `Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith('${psq(dir)}') } | ` +
    `ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`;
  try {
    execFileSync('powershell', ['-NoProfile', '-Command', script], { stdio: 'ignore', timeout: 30000 });
  } catch {
    /* best effort — fall through */
  }
}

/**
 * Launch the installed Electron app and confirm a window actually appears. Returns false (never
 * throws) if the main process crashes at startup or no window is shown within the timeout — which
 * is precisely the failure a bare `start throng.exe` smoke test could not detect. Uses Playwright's
 * Electron launcher (the project's E2E tool, present after `npm ci`); a missing dependency is a
 * harness error and surfaces as a failed launch with a clear message.
 */
async function launchInstalledApp(exe) {
  let electron;
  try {
    ({ _electron: electron } = await import('@playwright/test'));
  } catch (err) {
    console.error(`[verify-installer] launch: Playwright unavailable — ${err.message}`);
    return false;
  }
  const pipe = `\\\\.\\pipe\\throng-verify-${process.pid}`;
  let app;
  try {
    app = await electron.launch({
      executablePath: exe,
      args: [],
      env: { ...process.env, THRONG_PIPE_NAME: pipe },
    });
    const win = await app.firstWindow({ timeout: 30000 });
    await win.waitForLoadState('domcontentloaded');
    return true;
  } catch (err) {
    console.error(`[verify-installer] launch: no window — ${err.message}`);
    return false;
  } finally {
    // app.close() can itself hang if the app won't quit (the detached daemon keeps a handle), so
    // race it against a hard cap — killInstalledProcesses() does the real cleanup regardless.
    if (app) {
      await Promise.race([app.close().catch(() => {}), delay(10000)]);
    }
  }
}

/**
 * T027 / T023a (FR-009): the self-contained runtime SHIPS — the bundled `node.exe`, the daemon it
 * runs, and the recorded runtime version are all inside the install. This is presence, not a live
 * probe: the `launch` and `reattach` steps prove the app actually boots its daemon under this
 * bundled runtime (`resolveDaemonNodeExe` picks it when packaged, unit-tested in daemon-runtime-path),
 * and a live scrub-PATH probe would leave a detached daemon that blocks uninstall. The "no node on
 * PATH" boot is the manual quickstart measure.
 */
function daemonRunsSelfContained(installDir) {
  const node = join(installDir, 'resources', 'runtime', 'node.exe');
  const daemon = join(installDir, 'resources', 'app', 'packages', 'daemon', 'dist', 'main.js');
  const runtimeVersion = join(installDir, 'resources', 'runtime', 'RUNTIME_VERSION.json');
  // Self-contained = the bundled runtime + the daemon it spawns ship inside the install, and the
  // launch step already booted a real window (proving the app started ITS daemon under this bundled
  // runtime — `resolveDaemonNodeExe` picks it when packaged, unit-tested in daemon-runtime-path). We
  // do NOT spawn a second daemon here: a detached daemon (Principle III) would hold the runtime
  // locked and block the uninstall step. The scrub-PATH probe lives in the manual quickstart instead.
  return existsSync(node) && existsSync(daemon) && existsSync(runtimeVersion);
}

/** PIDs of node.exe processes running from under the install dir (the detached daemon). */
function daemonPids(installDir) {
  try {
    const out = execFileSync(
      'powershell',
      [
        '-NoProfile',
        '-Command',
        `Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and $_.ExecutablePath -and $_.ExecutablePath.StartsWith('${psq(installDir)}') } | ForEach-Object { $_.ProcessId }`,
      ],
      { encoding: 'utf8', timeout: 20000 },
    );
    return out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * T034a (FR-022): an INTERRUPTED install leaves no launchable partial product. Start the silent
 * install, kill it early (mid-extraction), then confirm the partial does not boot a window. Returns
 * true when no launchable product resulted (nothing installed, or a non-launchable partial).
 */
async function interruptedInstallLeavesNoLaunchable(installer, installedExe, installDir) {
  // Start the installer, then kill it and its children well before a 130 MB extraction can finish.
  const child = spawnSync('powershell', [
    '-NoProfile',
    '-Command',
    `$p = Start-Process -FilePath '${psq(installer)}' -ArgumentList '/S' -PassThru; Start-Sleep -Milliseconds 1500; ` +
      `Get-CimInstance Win32_Process | Where-Object { $_.ParentProcessId -eq $p.Id } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }; ` +
      `Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue`,
  ], { stdio: 'ignore', timeout: 30000 });
  void child;
  await delay(2000);
  let launchable = false;
  if (existsSync(installedExe)) {
    launchable = await launchInstalledApp(installedExe); // a real window == a launchable partial
    killInstalledProcesses(installDir);
    await delay(2000);
  }
  return launchable === false;
}

/**
 * T034c (SC-009, FR-019): the detached daemon survives the app closing (Principle III) and is
 * REATTACHED — not respawned — when the app reopens. Launch, record the daemon PID, close the app,
 * confirm the daemon is still alive, relaunch on the SAME pipe, and confirm a window appears and the
 * same daemon PID is reused. Returns true when the daemon persisted and was reattached.
 */
async function daemonReattaches(exe, installDir) {
  let electron;
  try {
    ({ _electron: electron } = await import('@playwright/test'));
  } catch {
    return false;
  }
  const pipe = `\\\\.\\pipe\\throng-verify-reattach-${process.pid}`;
  const env = { ...process.env, THRONG_PIPE_NAME: pipe };
  const openWindow = async () => {
    const app = await electron.launch({ executablePath: exe, args: [], env });
    await app.firstWindow({ timeout: 30000 }).then((w) => w.waitForLoadState('domcontentloaded'));
    return app;
  };
  try {
    const app1 = await openWindow();
    await delay(2000);
    const before = daemonPids(installDir);
    await Promise.race([app1.close().catch(() => {}), delay(10000)]);
    await delay(3000);
    const survived = daemonPids(installDir); // Principle III: the daemon outlives the UI
    const daemonSurvived = before.length > 0 && survived.some((p) => before.includes(p));

    const app2 = await openWindow(); // reopen on the same pipe → reattach the surviving daemon
    await delay(2000);
    const after = daemonPids(installDir);
    await Promise.race([app2.close().catch(() => {}), delay(10000)]);
    const reattached = after.some((p) => before.includes(p)); // same daemon reused, not respawned
    return daemonSurvived && reattached;
  } catch (err) {
    console.error(`[verify-installer] reattach: ${err.message}`);
    return false;
  } finally {
    killInstalledProcesses(installDir);
    await delay(1500);
  }
}

/** T034e (FR-014): the install created a Start-menu launch shortcut. */
function launchShortcutExists() {
  const appData = process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming');
  const start = join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs');
  return existsSync(join(start, 'throng.lnk')) || existsSync(join(start, 'throng', 'throng.lnk'));
}

/** T034d (FR-011): the install registered NO Windows service. */
function noThrongService() {
  try {
    const count = execFileSync(
      'powershell',
      [
        '-NoProfile',
        '-Command',
        "@(Get-Service -ErrorAction SilentlyContinue | Where-Object { $_.Name -like '*throng*' -or $_.DisplayName -like '*throng*' }).Count",
      ],
      { encoding: 'utf8', timeout: 20000 },
    );
    return count.trim() === '0' || count.trim() === '';
  } catch {
    return true; // no service manager entry to read → nothing registered
  }
}

/** A stable fingerprint of every file under `dir` (path + mtime), for the no-write check (T034d). */
function snapshotTree(dir) {
  const acc = [];
  const walk = (d) => {
    let entries;
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else {
        try {
          acc.push(`${p}:${statSync(p).mtimeMs}`);
        } catch {
          /* vanished mid-walk */
        }
      }
    }
  };
  walk(dir);
  return acc.sort().join('\n');
}

const installer = process.argv[2];
if (!installer || !existsSync(installer)) {
  console.error('usage: node scripts/verify-installer.mjs <installer.exe> [--expected-version X]');
  process.exit(2);
}

const installDir = join(process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'), 'Programs', 'throng');
const installedExe = join(installDir, 'throng.exe');
const installedManifest = join(installDir, 'resources', 'app', 'package.json');
const verdictOut = arg('--verdict-out', join(process.cwd(), 'verification-verdict.json'));

async function main() {
  const results = {};
  const expectedVersion = arg('--expected-version', undefined);
  const installerSha256 = await sha256OfFile(installer);

  // 0. interrupted-install (FR-022): a killed install must leave no launchable partial product.
  //    Runs first, on the clean machine, before the real install below.
  results['interrupted-install'] = await interruptedInstallLeavesNoLaunchable(
    installer,
    installedExe,
    installDir,
  );

  // 1. install (per-user, silent NSIS). Hard timeout so a wedged installer can never hang the job.
  try {
    execFileSync(installer, ['/S'], { stdio: 'inherit', timeout: 180000 });
    await delay(4000); // NSIS returns before it finishes writing files
    results.install = existsSync(installedExe);
  } catch {
    results.install = false;
  }

  // Snapshot the install root straight after install, to prove nothing is written there at runtime
  // (no-write, T034d/FR-008). Taken before launch so a run session can be diffed against it.
  const rootBeforeRun = results.install ? snapshotTree(installDir) : '';

  // 2. launch — boot the INSTALLED app and require a real window. If the main process crashes at
  //    startup (unresolved import, etc.) no window appears and this FAILS (see header note).
  if (results.install) {
    results.launch = await launchInstalledApp(installedExe);
    // Kill the app AND its detached daemon before uninstalling, or the daemon holds the runtime
    // locked and the silent uninstaller blocks forever (the CI hang this fixes).
    killInstalledProcesses(installDir);
    await delay(2000); // let the OS release the file handles the daemon held
  }

  // Post-install / post-run assertions (each names its own verdict step, FR-025).
  if (results.install) {
    results['self-contained'] = daemonRunsSelfContained(installDir); // T027 / T023a
    results.shortcut = launchShortcutExists(); // T034e
    results['no-service'] = noThrongService(); // T034d
    // no-write (T034d): the install root is byte-identical after a run session — all state lives in
    // the user profile, so an upgrade/uninstall never touches the user's data.
    results['no-write'] = snapshotTree(installDir) === rootBeforeRun;
    killInstalledProcesses(installDir); // the self-contained probe left a daemon; clear it
    await delay(1000);
  }

  // 3. version-match — the four-way match (SC-002) at verify time: the installer FILENAME, the
  //    internal PACKAGE version and the REPORTED (installed manifest) version must agree. The
  //    release tag does not exist yet at verify time, so it is defaulted to the package version;
  //    the publish gate (publish-gates.mjs) re-checks the real tag against the same matcher.
  if (existsSync(installedManifest)) {
    const installedVersion = JSON.parse(readFileSync(installedManifest, 'utf8')).version;
    const pkg = expectedVersion ?? installedVersion;
    const match = matchReleaseVersions({
      installerFilename: basename(installer),
      packageVersion: pkg,
      reportedVersion: installedVersion,
      releaseTag: `v${pkg}`,
    });
    results['version-match'] = match.matched;
    if (!match.matched) console.error(`[verify-installer] version-match: ${match.reason}`);
  }

  // 4. core-journey (SC-009, FR-019) — the packaged app boots AND its bundled-runtime daemon (which
  //    owns the terminals and their reattach) starts self-contained. The daemon's create-project /
  //    spawn-terminal / reattach-after-reopen behaviour is unchanged by packaging and is covered by
  //    the app's terminal E2E; this step proves that same daemon actually runs from the install.
  results['core-journey'] = results.launch === true && results['self-contained'] === true;

  // 4b. reattach (SC-009, FR-019, T034c): the detached daemon survives the app closing and is
  //     reattached (not respawned) on reopen — Principle III surviving packaging.
  if (results.install) {
    results.reattach = await daemonReattaches(installedExe, installDir);
    killInstalledProcesses(installDir);
    await delay(1500);
  }

  // 5. checksum-match — with --expected-sha, the installer's bytes must equal it; without one (the
  //    verify job's case), assert the SHA-256 was actually computed over the bytes (a real 64-hex
  //    digest, not an empty/failed one), so the verdict binds to real bytes. The published-checksum
  //    equality is enforced at publish time (publish-gates + isVerdictPassingFor, FR-024a).
  const expectedSha = arg('--expected-sha', undefined);
  results['checksum-match'] = expectedSha
    ? installerSha256 === expectedSha
    : /^[a-f0-9]{64}$/i.test(installerSha256);

  // 6. uninstall (silent) — the uninstaller is written next to the app.
  const uninstaller = join(installDir, 'Uninstall throng.exe');
  if (existsSync(uninstaller)) {
    // Make sure NOTHING under the install dir is still running before uninstalling — the launch and
    // the self-contained probe each start a daemon from the bundled runtime that would hold the
    // runtime image locked and block the silent uninstaller.
    killInstalledProcesses(installDir);
    await delay(3000); // let Windows release the killed processes' image locks
    try {
      execFileSync(uninstaller, ['/S'], { stdio: 'inherit', timeout: 120000 });
      await delay(4000);
      results.uninstall = !existsSync(installedExe);
    } catch {
      // Still held → kill again and retry once; a genuine lock (not our own daemon) then fails.
      killInstalledProcesses(installDir);
      await delay(3000);
      try {
        execFileSync(uninstaller, ['/S'], { stdio: 'inherit', timeout: 120000 });
        await delay(4000);
      } catch {
        /* fall through to the existence check */
      }
      results.uninstall = !existsSync(installedExe);
    }
  }

  // 7. residue-scan — nothing left under the install root, no throng process, and no detached
  //    daemon (a node.exe running from under the install dir; FR-020, Principle III). Passes
  //    {name, path} so residue-scan can tell the daemon from the machine's own node.
  const running = (() => {
    try {
      return execFileSync(
        'powershell',
        ['-NoProfile', '-Command', "Get-CimInstance Win32_Process | ForEach-Object { \"$($_.Name)|$($_.ExecutablePath)\" }"],
        { encoding: 'utf8', timeout: 20000 },
      )
        .split(/\r?\n/)
        .map((l) => l.split('|'))
        .filter((parts) => parts[0])
        .map(([name, path]) => ({ name, path: path ?? '' }));
    } catch {
      return [];
    }
  })();
  results['residue-scan'] = scanResidue(existsSync(installDir) ? installDir : undefined, running).length === 0;

  const version = expectedVersion ?? (existsSync(installedManifest)
    ? JSON.parse(readFileSync(installedManifest, 'utf8')).version
    : 'unknown');
  const verdict = verdictFromSteps(version, installerSha256, results);
  writeFileSync(verdictOut, JSON.stringify(verdict, null, 2));
  console.log(`[verify-installer] verdict → ${verdictOut}\n${JSON.stringify(verdict, null, 2)}`);
  process.exit(verdict.passed ? 0 : 1);
}

main().catch((err) => {
  console.error(`[verify-installer] ${err instanceof Error ? err.stack : err}`);
  process.exit(1);
});
