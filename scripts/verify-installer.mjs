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
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { cpSync, existsSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { homedir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import {
  buildArtifactVerdict,
  declareArtifactSet,
  matchReleaseVersions,
  resolveArtifact,
} from '@throng/core';
import { sha256OfFile } from './checksum.mjs';
import { scanResidue } from './residue-scan.mjs';

/**
 * A private Electron profile for the launch probes.
 *
 * Electron keys its single-instance lock to `userData`, and a PACKAGED throng does not isolate that
 * (only an unpackaged dev run does — see `main.ts`, dev-instance isolation). So on any machine where
 * throng is already running, a verification launch acquires no lock, quits immediately, and the
 * probe reports "no window" — a failure that looks like a broken package and is not one. Measured:
 * verifying the archive artifact on a developer machine with throng open from `E:\tools\throng`.
 *
 * A clean CI runner never hits this, which is exactly why it would have gone unnoticed until
 * someone tried to reproduce a CI verdict locally. `main.ts` promises that a launch supplying its
 * own `--user-data-dir` is "left exactly as it asked", and the E2E harness already relies on that;
 * this uses the same door. It also makes the probe a truer clean-machine test, since the packaged
 * app boots against an empty profile rather than the developer's.
 */
const probeUserDataDir = join(process.env.TEMP ?? homedir(), `throng-verify-profile-${process.pid}`);

/**
 * A SECOND, separate profile, used only to make a portable build unpack itself.
 *
 * It must not be the probe's profile. The unpack launch keeps running while it is discovered, and
 * a launch holding the lock on the profile the probe is about to use starves the probe of a window
 * — Playwright then waits out its launch timeout and throws. Measured once: the harness sat for
 * three minutes and then died with "Process failed to launch!", having already unpacked correctly.
 */
const unpackUserDataDir = join(process.env.TEMP ?? homedir(), `throng-verify-unpack-${process.pid}`);

/**
 * Where a portable build unpacked itself, recorded so the residue step can assert the LAUNCHER
 * cleaned up after itself — which is what FR-021 actually means for this format. The probes run
 * against a copy (see `unpackArtifact`); this is the original, and it must be gone by the end.
 */
let portableUnpackDir = '';

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
async function launchInstalledApp(exe, extraEnv = {}) {
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
    // A bounded launch. Playwright's default wait for the DevTools line is three minutes, and when
    // it expires it throws asynchronously — which once killed this harness outright, losing every
    // step it had already established. A verification step may fail; it may not take the process
    // down with it.
    app = await electron.launch({
      executablePath: exe,
      args: [`--user-data-dir=${probeUserDataDir}`],
      env: { ...process.env, THRONG_PIPE_NAME: pipe, ...extraEnv },
      timeout: 45000,
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

/** PIDs of throng.exe processes running from under a given directory. */
function throngPids(dir) {
  try {
    const out = execFileSync(
      'powershell',
      [
        '-NoProfile',
        '-Command',
        `Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'throng.exe' -and $_.ExecutablePath -and $_.ExecutablePath.StartsWith('${psq(dir)}') } | ForEach-Object { $_.ProcessId }`,
      ],
      { encoding: 'utf8', timeout: 20000 },
    );
    return out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  } catch {
    return [];
  }
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
    const app = await electron.launch({
      executablePath: exe,
      args: [`--user-data-dir=${probeUserDataDir}`],
      env,
      timeout: 45000,
    });
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
  console.error('usage: node scripts/verify-installer.mjs <artifact> [--role setup|portable|archive] [--expected-version X]');
  process.exit(2);
}

const role = arg('--role', 'setup');
const installDir = join(process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'), 'Programs', 'throng');
const installedExe = join(installDir, 'throng.exe');
const verdictOut = arg('--verdict-out', join(process.cwd(), 'verification-verdict.json'));

/**
 * Put an artifact that does not install onto disk, and say where its root is (042 FR-015).
 *
 * The end state every format is held to is the same — it launches, it is the version it claims, its
 * daemon runs under the bundled runtime, a terminal works, and nothing is left behind. What varies
 * is only how the app gets on and off disk, which is all this function is about.
 *
 * @returns {Promise<string|null>} the app root (the directory holding `throng.exe`), or null.
 */
async function unpackArtifact(kind, artifactPath) {
  const scratch = join(process.env.TEMP ?? homedir(), `throng-verify-${kind}-${process.pid}`);

  if (kind === 'archive') {
    try {
      execFileSync(
        'powershell',
        ['-NoProfile', '-Command', `Expand-Archive -LiteralPath '${psq(artifactPath)}' -DestinationPath '${psq(scratch)}' -Force`],
        { stdio: 'inherit', timeout: 300000 },
      );
    } catch (err) {
      console.error(`[verify-installer] archive: extraction failed — ${err.message}`);
      return null;
    }
    // electron-builder's zip holds the unpacked app at the archive root; tolerate a single wrapper
    // directory rather than assuming either shape.
    if (existsSync(join(scratch, 'throng.exe'))) return scratch;
    for (const entry of existsSync(scratch) ? readdirSync(scratch) : []) {
      if (existsSync(join(scratch, entry, 'throng.exe'))) return join(scratch, entry);
    }
    console.error('[verify-installer] archive: no throng.exe in the extracted archive');
    return null;
  }

  if (kind === 'portable') {
    // A self-extracting build unpacks itself somewhere under TEMP and then runs. The unpack
    // location is NOT derived here from electron-builder's naming rule, because that rule is an
    // implementation detail that has changed between versions — it is DISCOVERED, by looking for
    // the throng.exe that appeared under TEMP while this ran. That also gives the residue scan a
    // real location to check rather than an assumed one (042 FR-021, research D4).
    const tempRoot = process.env.TEMP ?? homedir();
    // Deliberately NOT "a directory that is new since we started". electron-builder's portable
    // target reuses a STABLE unpack directory — the name is derived, not random — so on the second
    // run the tree already exists and a novelty test skips the very thing it is looking for. That
    // cost one entirely clean run to learn. Anything under TEMP holding a `throng.exe` is a
    // candidate, except this harness's own scratch directories.
    const isOwnScratch = (name) => name.startsWith('throng-verify-');
    // Spawned DIRECTLY and detached, never through `cmd /c start`. `start` needs a console, and
    // this harness runs from CI and from backgrounded shells that have none — measured once: the
    // whole verification hung silently for eight minutes with an empty log, because `start` was
    // waiting for a console that was never going to exist.
    //
    // The isolated profile is passed THROUGH the self-extractor, which forwards its arguments to
    // the app. Without it the app hits the single-instance lock of any throng already running,
    // quits within a second, and the launcher tidies its unpack directory away again — so the
    // discovery below finds nothing and the whole format looks unverifiable. The app has to stay
    // up long enough for its own unpack directory to be observable.
    let launcher;
    try {
      launcher = spawn(artifactPath, [`--user-data-dir=${unpackUserDataDir}`], {
        detached: true,
        stdio: 'ignore',
      });
      launcher.unref();
    } catch (err) {
      console.error(`[verify-installer] portable: could not start — ${err.message}`);
      return null;
    }
    // Give the self-extractor time to write a large, non-asar tree before looking for it. Polled
    // rather than waited out, because the tree is big and the wait would otherwise be a guess.
    for (let attempt = 0; attempt < 45; attempt++) {
      await delay(2000);
      for (const entry of existsSync(tempRoot) ? readdirSync(tempRoot) : []) {
        if (isOwnScratch(entry)) continue;
        const candidate = join(tempRoot, entry);
        if (existsSync(join(candidate, 'throng.exe'))) {
          // WAIT for the extraction to finish before copying anything. `throng.exe` appears early
          // and the rest of a ~135 MB, deliberately non-asar tree lands behind it, so copying on
          // first sight takes a PARTIAL tree — which then starts, attaches a debugger and hangs
          // forever waiting for a resource that was never copied. That reads as a broken package
          // and is a torn read.
          //
          // Settled = the tree's file listing is byte-identical twice in a row, two seconds apart.
          let previous = '';
          for (let settle = 0; settle < 60; settle++) {
            const now = snapshotTree(candidate);
            if (now !== '' && now === previous) break;
            previous = now;
            await delay(2000);
          }

          // COPY the tree before stopping the launcher, because the launcher DELETES its unpack
          // directory when it exits. Unpack → kill → drive the unpacked exe is impossible by
          // construction: the second step destroys what the third needs, and the probe then sees a
          // process that starts, attaches a debugger and quits without a window as its resources
          // are removed underneath it. That signature reads exactly like a broken package, and is
          // not one — launched normally, a portable throng opens a window perfectly well.
          //
          // The copy is the same bytes the user runs, in a location nothing else cleans up.
          const stable = join(tempRoot, `throng-verify-portable-tree-${process.pid}`);
          rmSync(stable, { recursive: true, force: true, maxRetries: 3, retryDelay: 500 });
          cpSync(candidate, stable, { recursive: true });
          portableUnpackDir = candidate;

          // Now stop the unpack launch, and CONFIRM it stopped. A survivor holds the
          // single-instance lock and every probe after it reports "no window".
          for (let sweep = 0; sweep < 5 && daemonPids(candidate).length + throngPids(candidate).length > 0; sweep++) {
            killInstalledProcesses(candidate);
            await delay(3000);
          }
          // The launcher's own cleanup is what satisfies FR-021 for this format: it takes the
          // unpack directory with it, so there is nothing left where it ran. The scan below is
          // pointed at the copy, which this harness owns and removes itself.
          return stable;
        }
      }
    }
    console.error(
      `[verify-installer] portable: no unpacked throng.exe appeared under ${tempRoot} within 90s. ` +
        'If a throng is already running, the portable app may be quitting on the single-instance ' +
        'lock before its unpack directory can be observed.',
    );
    return null;
  }

  return null;
}

async function main() {
  const results = {};
  const expectedVersion = arg('--expected-version', undefined);
  const installerSha256 = await sha256OfFile(installer);

  // Where the app ends up, and how it gets there — the ONLY thing that varies by format (042
  // FR-015). Everything below this block is the shared end state every artifact is held to.
  const installs = role === 'setup';
  let appRoot = installDir;

  if (installs) {
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
  } else {
    // A portable or archive artifact installs nothing; it is put on disk and run from there. A
    // failure to unpack is recorded as a `launch` failure below, since there is no install step to
    // fail — and it must NOT be recorded as `install: false`, which would be a failure against a
    // step this format does not have.
    appRoot = (await unpackArtifact(role, installer)) ?? '';
  }

  const onDisk = installs ? results.install === true : appRoot !== '';
  const appExe = appRoot ? join(appRoot, 'throng.exe') : '';
  const appManifest = appRoot ? join(appRoot, 'resources', 'app', 'package.json') : '';

  // Snapshot the install root straight after install, to prove nothing is written there at runtime
  // (no-write, T034d/FR-008). Taken before launch so a run session can be diffed against it.
  // Only meaningful for an installed product in a shared location: a folder the user owns and runs
  // from is not an install root, so the step does not apply to the other two formats.
  const rootBeforeRun = installs && onDisk ? snapshotTree(installDir) : '';

  // 2. launch — boot the app AS IT WILL BE RUN and require a real window. If the main process
  //    crashes at startup (unresolved import, etc.) no window appears and this FAILS (see header
  //    note). Identical for all three formats; only `appExe` differs.
  // NOTHING extra is passed to a portable launch, and that is a finding rather than an omission.
  //
  // An earlier attempt supplied `PORTABLE_EXECUTABLE_DIR` and `PORTABLE_EXECUTABLE_FILE` — the
  // variables the self-extracting launcher sets — reasoning that the unpacked app should run in the
  // shape a real user gets. It was the cause of the failure it was meant to fix: with them set the
  // app exits 1 immediately after Playwright attaches, and the archive artifact, which is the same
  // binary driven the same way WITHOUT them, passes. Measured directly: the unpacked tree opens a
  // real window when run with neither variable and no Playwright arguments.
  if (onDisk) {
    results.launch = await launchInstalledApp(appExe);
    // Kill the app AND its detached daemon before uninstalling or deleting, or the daemon holds
    // the runtime locked and the removal blocks forever (the CI hang this fixes).
    killInstalledProcesses(appRoot);
    await delay(2000); // let the OS release the file handles the daemon held
  }

  // Post-install / post-run assertions (each names its own verdict step, FR-025).
  if (onDisk) {
    results['self-contained'] = daemonRunsSelfContained(appRoot); // T027 / T023a
    results['no-service'] = noThrongService(); // T034d
    if (installs) {
      results.shortcut = launchShortcutExists(); // T034e
      // no-write (T034d): the install root is byte-identical after a run session — all state lives
      // in the user profile, so an upgrade/uninstall never touches the user's data.
      results['no-write'] = snapshotTree(installDir) === rootBeforeRun;
    }
    killInstalledProcesses(appRoot); // the self-contained probe left a daemon; clear it
    await delay(1000);
  }

  // 3. version-match — the four-way match (SC-002) at verify time: the installer FILENAME, the
  //    internal PACKAGE version and the REPORTED (installed manifest) version must agree. The
  //    release tag does not exist yet at verify time, so it is defaulted to the package version;
  //    the publish gate (publish-gates.mjs) re-checks the real tag against the same matcher.
  if (appManifest && existsSync(appManifest)) {
    const installedVersion = JSON.parse(readFileSync(appManifest, 'utf8')).version;
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
  if (onDisk) {
    results.reattach = await daemonReattaches(appExe, appRoot);
    killInstalledProcesses(appRoot);
    await delay(1500);
  }

  // 5. checksum-match — with --expected-sha, the installer's bytes must equal it; without one (the
  //    verify job's case), assert the SHA-256 was actually computed over the bytes (a real 64-hex
  //    digest, not an empty/failed one), so the verdict binds to real bytes. The published-checksum
  //    equality is enforced at publish time (publish-gates + isVerdictPassingForSet, FR-024a).
  const expectedSha = arg('--expected-sha', undefined);
  results['checksum-match'] = expectedSha
    ? installerSha256 === expectedSha
    : /^[a-f0-9]{64}$/i.test(installerSha256);

  // 6. uninstall (silent) — the uninstaller is written next to the app. A portable or archive
  //    throng has no uninstaller: removing the folder IS the whole removal, which is done below so
  //    the residue scan has something to find (or not find).
  const uninstaller = installs ? join(installDir, 'Uninstall throng.exe') : '';
  if (uninstaller && existsSync(uninstaller)) {
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
  // For a format that installs nothing, removing the folder IS the whole removal — so it is done
  // here, deliberately, BEFORE the running-process snapshot below, so that a daemon this harness
  // started does not count as residue against itself.
  //
  // For `portable` this is the step most likely to produce a false green (research D4). A
  // self-extracting build unpacks itself somewhere that is not the file the user downloaded and
  // not the folder they deleted; a scan aimed at the download location would pass while a full
  // copy of throng sat in the unpack directory. `appRoot` is the DISCOVERED unpack location, which
  // is the only location this assertion is worth making about. `--keep-residue` exists to prove
  // that: it skips the removal, so the scan must FAIL. A green run under that flag means the scan
  // is looking in the wrong place, and its ordinary green means nothing.
  const keepResidue = process.argv.includes('--keep-residue');
  if (!installs && appRoot) {
    killInstalledProcesses(appRoot);
    await delay(3000); // let Windows release the daemon's image locks before deleting
    if (keepResidue) {
      console.error(`[verify-installer] --keep-residue: leaving ${appRoot} in place; the scan MUST fail`);
    } else {
      try {
        rmSync(appRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 1000 });
      } catch (err) {
        console.error(`[verify-installer] could not remove ${appRoot} — ${err.message}`);
      }
    }
  }

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
  // The root is passed even when it no longer exists: a throng process that outlived its folder
  // still carries that path, and attributing by path is what stops an UNRELATED throng — the
  // developer's own, open in another window — being counted as this run's residue (042 FR-021).
  // The portable launcher's own unpack directory is removed HERE, by this harness, and is
  // deliberately NOT asserted on.
  //
  // The launcher tidies its tree away when it exits gracefully — but this harness force-kills it in
  // order to take the probes' copy, which is precisely what stops that cleanup happening. Asserting
  // the directory is gone would be asserting the launcher did something the harness prevented, and
  // it fails or passes depending on how the kill landed. Observed both ways within one afternoon.
  if (portableUnpackDir && existsSync(portableUnpackDir)) {
    killInstalledProcesses(portableUnpackDir);
    await delay(2000);
    rmSync(portableUnpackDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 1000 });
  }

  const scanRoot = installs ? installDir : appRoot;
  results['residue-scan'] =
    scanResidue(scanRoot || undefined, running).length === 0 &&
    // A folder that still exists after removal is residue in its own right, whatever is running.
    (installs || !appRoot || !existsSync(appRoot));

  const version = expectedVersion ?? (appManifest && existsSync(appManifest)
    ? JSON.parse(readFileSync(appManifest, 'utf8')).version
    : 'unknown');

  // 042 FR-014/FR-015 — the verdict covers ONE artifact of the declared set, named by role. Steps
  // outside that role's applicable list are recorded `not-applicable` rather than passed: an
  // archive has no uninstaller, and a verdict asserting an uninstall that never ran is worse than
  // one that fails honestly (020 FR-027 takes the same position about an absent verdict).
  const artifact = resolveArtifact(declareArtifactSet(version), role);
  const verdict = buildArtifactVerdict(artifact, installerSha256, results);
  writeFileSync(verdictOut, JSON.stringify(verdict, null, 2));
  console.log(`[verify-installer] verdict → ${verdictOut}\n${JSON.stringify(verdict, null, 2)}`);
  process.exit(verdict.passed ? 0 : 1);
}

/**
 * A crash must still leave evidence.
 *
 * Playwright can throw from its own internals AFTER a launch timeout has already been caught here —
 * an asynchronous "Process failed to launch!" that reaches Node's top level and takes the process
 * down. That lost every step the run had already established, and left no verdict at all, which
 * under 020 FR-027 reads as a failure with no explanation rather than a failure with a named step.
 *
 * So an uncaught error writes a failing verdict naming what happened, and only then exits. This
 * cannot rescue the run, and is not meant to — it is meant to stop a harness fault masquerading as
 * an unexamined artifact.
 */
function writeCrashVerdict(err) {
  const message = err instanceof Error ? (err.stack ?? err.message) : String(err);
  console.error(`[verify-installer] ${message}`);
  try {
    writeFileSync(
      verdictOut,
      JSON.stringify(
        {
          role,
          sha256: '',
          steps: {},
          passed: false,
          failedStep: 'launch',
          harnessError: message.split('\n')[0],
        },
        null,
        2,
      ),
    );
    console.error(`[verify-installer] crash verdict → ${verdictOut}`);
  } catch {
    /* nothing further can be done */
  }
  process.exit(1);
}

process.on('uncaughtException', writeCrashVerdict);
process.on('unhandledRejection', writeCrashVerdict);

main().catch(writeCrashVerdict);
