// The verification steps that exist because of install SCOPE (058 FR-006, FR-007, FR-010, FR-012,
// FR-013, FR-016a, FR-017b, FR-029; contracts/verification-matrix.md).
//
// Everything here drives a real installer or a real second account, so it can only be run on the
// clean runner the release matrix gives each combination — never on a developer machine, and never
// by a unit test (the decisions it rests on are tested in `verify-installer-args.test.ts`). Each
// function returns a plain result and never throws: a verification step may fail, it may not take
// the harness down with it (see `writeCrashVerdict` in `verify-installer.mjs`).
//
// What a step cannot prove is said where it stops, and travels with the verdict as `unproven` rather
// than being quietly counted as a pass.
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { bareInstallRefused, decodeInstallerLog, INSTALLER_POLICY_KEY, installLayout, mentionsInstallRoot, parseRegDword, scopeDiagnosticLines, uninstallRegistryRoots } from './verify-installer-args.mjs';
import { findMainProcess, integrityLevels, judgeNotElevated } from './process-integrity.mjs';
import { runAsAccount, SecondAccountError, systemRunner, withSecondAccount } from './second-account.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));

/** A directory every local account can read and write, for handing files to the second account. */
export function makeSharedDir() {
  const dir = join('C:\\Users\\Public', `throng-verify-${process.pid}`);
  mkdirSync(dir, { recursive: true });
  try {
    execFileSync('icacls.exe', [dir, '/grant', '*S-1-5-32-545:(OI)(CI)M', '/T'], { stdio: 'ignore', timeout: 30000 });
  } catch {
    /* the default inheritance from Public usually already allows it */
  }
  return dir;
}

export function removeSharedDir(dir) {
  rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 500 });
}

/** Run a program to completion and return its exit code (-1 when it could not start or timed out). */
export function runCommand(file, args, timeoutMs = 180000) {
  // msiexec will not create the folder its /l*v log goes in, and then writes no log at all.
  const at = args.indexOf('/l*v');
  if (at >= 0 && args[at + 1]) mkdirSync(dirname(args[at + 1]), { recursive: true });
  const result = spawnSync(file, args, { stdio: 'inherit', timeout: timeoutMs, windowsHide: true });
  return result.error ? -1 : (result.status ?? -1);
}

/**
 * Run `work` with the machine policy `DisableMsi` forced to 0, and put it back EXACTLY as it was
 * (the value, or its absence) afterwards. The hosted runner image sets it to 1, which blocks every
 * non-elevated Windows Installer install (exit 1625 "forbidden by policy") whatever the package says;
 * Windows leaves it unset by default, so that is the runner, not the product. Only the steps that
 * install as a standard account need it.
 */
export async function withInstallerPolicyEnabled(work, log) {
  const reg = (args) => execFileSync('reg.exe', args, { encoding: 'utf8', timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'] });
  let prior = null;
  let keyExisted = true;
  try {
    prior = parseRegDword(reg(['query', INSTALLER_POLICY_KEY, '/v', 'DisableMsi']));
  } catch {
    try {
      reg(['query', INSTALLER_POLICY_KEY]);
    } catch {
      keyExisted = false;
    }
  }
  log(`installer policy: DisableMsi is ${prior === null ? 'not set' : prior}; setting it to 0 for the standard-account installs`);
  try {
    reg(['add', INSTALLER_POLICY_KEY, '/v', 'DisableMsi', '/t', 'REG_DWORD', '/d', '0', '/f']);
  } catch (error) {
    log(`installer policy: could not set DisableMsi=0 (${error instanceof Error ? error.message : String(error)}); carrying on`);
  }
  try {
    return await work();
  } finally {
    try {
      if (prior !== null) reg(['add', INSTALLER_POLICY_KEY, '/v', 'DisableMsi', '/t', 'REG_DWORD', '/d', String(prior), '/f']);
      else if (keyExisted) reg(['delete', INSTALLER_POLICY_KEY, '/v', 'DisableMsi', '/f']);
      else reg(['delete', INSTALLER_POLICY_KEY, '/f']);
      log(`installer policy: DisableMsi restored to ${prior === null ? 'its absence' : prior}`);
    } catch (error) {
      log(`installer policy: could not restore DisableMsi (${error instanceof Error ? error.message : String(error)})`);
    }
  }
}

/**
 * After a failed MSI command: print the lines of its verbose logs that say which install context was
 * chosen into the CI log, and keep a copy under the workspace for the upload step (which refuses a
 * file outside its root).
 */
export function reportInstallLogs(dir, log) {
  const keep = join(process.cwd(), 'installer-logs');
  let names;
  try {
    names = readdirSync(dir).filter((n) => /\.log$/i.test(n));
  } catch {
    log(`no installer logs in ${dir}`);
    return;
  }
  for (const name of names) {
    const lines = scopeDiagnosticLines(decodeInstallerLog(readFileSync(join(dir, name))));
    log(`${name}: ${lines.length} scope line(s)\n${lines.join('\n')}`);
    if (resolve(dir) !== resolve(keep)) {
      mkdirSync(keep, { recursive: true });
      copyFileSync(join(dir, name), join(keep, name));
    }
  }
}

/** Registered `DisplayName`s under the Uninstall keys of a hive (both registry views for HKLM). */
export function registeredDisplayNames(hive, msi = false) {
  const roots = uninstallRegistryRoots(hive, msi);
  const script =
    `$sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value\n` +
    `$names = foreach ($path in @(${roots.map((r) => `"${r}"`).join(',')})) { Get-ItemProperty -Path $path -ErrorAction SilentlyContinue | ` +
    `ForEach-Object { $_.DisplayName } }\n` +
    `ConvertTo-Json -Compress -InputObject @($names | Where-Object { $_ })`;
  try {
    const out = execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', timeout: 60000 });
    const parsed = JSON.parse(out || '[]');
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return [];
  }
}

/** The Start-menu shortcut files this layout would have created, wherever the installer put them. */
export function shortcutCandidates(layout) {
  const places = [layout.startMenuDir, join(layout.startMenuDir, 'throng')];
  return places.flatMap((dir) => layout.shortcutNames.map((name) => join(dir, name)));
}

/** FR-017b — the registered entry and the shortcut carry the copy's scope and installer. */
export function installLabelsCorrect(layout) {
  const registered = registeredDisplayNames(layout.hive, layout.isMsi === true).includes(layout.displayName);
  const shortcut = shortcutCandidates(layout).some((p) => existsSync(p));
  if (!registered) console.error(`[verify-installer] install-labels: no ${layout.hive} entry named '${layout.displayName}'`);
  if (!shortcut) console.error(`[verify-installer] install-labels: none of ${shortcutCandidates(layout).join(', ')} exists`);
  return registered && shortcut;
}

/** FR-014 — some throng shortcut exists in the Start menu of this layout's scope. */
export function launchShortcutExistsFor(layout) {
  const dirs = [layout.startMenuDir, join(layout.startMenuDir, 'throng')];
  return dirs.some((dir) => {
    try {
      return readdirSync(dir).some((f) => /^throng.*\.lnk$/i.test(f));
    } catch {
      return false;
    }
  });
}

/** Copy a file where the second account can read it, and return the copy's path. */
function share(sharedDir, source, name = basename(source)) {
  const target = join(sharedDir, name);
  copyFileSync(source, target);
  return target;
}

/** Run `work` with a second account; a failure to create it is a failed step, with the reason. */
async function withAccountOrFail(work, log) {
  try {
    return await withSecondAccount(systemRunner, work, { onWarning: (m) => log(`warning: ${m}`) });
  } catch (err) {
    log(err instanceof SecondAccountError ? err.message : `the second-account step failed: ${err.message}`);
    return null;
  }
}

/**
 * FR-010 — `setup /S /allusers` run by a standard account does not prompt for elevation: it exits
 * 740 and installs nothing. Runs on the clean machine, BEFORE the real machine-wide install.
 */
export async function silentElevationRefused({ layout, artifactPath, sharedDir, log }) {
  const setup = share(sharedDir, artifactPath, 'setup-under-test.exe');
  const outcome = await withAccountOrFail(async (account) => {
    const result = await runAsAccount(systemRunner, account, sharedDir, { file: setup, args: ['/S', '/allusers'], timeoutMs: 120000 });
    return { code: result.code, output: `${result.stdout}${result.stderr}` };
  }, log);
  if (!outcome) return false;
  const nothingInstalled = !existsSync(layout.root);
  if (outcome.code !== 740) log(`silent-elevation-refused: expected exit 740, got ${outcome.code}`);
  if (!nothingInstalled) log(`silent-elevation-refused: ${layout.root} exists after a refused install`);
  return outcome.code === 740 && nothingInstalled;
}

/**
 * FR-006 — a per-user install as a REAL standard account succeeds, silently. A per-user path that
 * asked for elevation would fail outright here, with nobody to approve it, so a pass proves it.
 */
export async function standardAccountInstall({ role, artifactPath, version, sharedDir, log }) {
  const guarded = (work) => (role === 'msi' ? withInstallerPolicyEnabled(work, log) : work());
  const outcome = await guarded(() => withAccountOrFail(async (account) => {
    const profile = join('C:\\Users', account.name);
    const layout = installLayout({
      role,
      scope: 'per-user',
      version,
      artifactPath: share(sharedDir, artifactPath, role === 'msi' ? 'msi-under-test.msi' : 'setup-under-test.exe'),
      env: {
        LOCALAPPDATA: join(profile, 'AppData', 'Local'),
        APPDATA: join(profile, 'AppData', 'Roaming'),
        SystemRoot: process.env.SystemRoot,
        // the account's logs go where it can write and this process can read
        TEMP: sharedDir,
      },
    });
    // An unattended MSI install by a standard account that names no scope is REFUSED: without
    // MSIINSTALLPERUSER=1 Windows Installer asks for a machine-wide install, and under /qn it cannot
    // ask for the rights. It must fail and install nothing, in either scope — never quietly install a
    // different way (FR-010). Checked first, while there is nothing installed to confuse the answer.
    let refused = true;
    if (role === 'msi') {
      const machineRoot = installLayout({ role, scope: 'machine', version, artifactPath, env: process.env }).root;
      const bare = await runAsAccount(systemRunner, account, sharedDir, {
        file: layout.bareInstall.file,
        args: layout.bareInstall.args,
        timeoutMs: 300000,
      });
      await delay(2000);
      refused = bareInstallRefused({
        code: bare.code,
        okCodes: layout.bareInstall.okCodes,
        installedAnywhere: existsSync(join(layout.root, 'throng.exe')) || existsSync(join(machineRoot, 'throng.exe')),
      });
      if (!refused) log(`standard-account-install: a bare /qn install by a standard account exited ${bare.code} and installed something; it must be refused`);
    }

    // The per-user install a standard account can do needs no elevation: the standard property says so.
    const installed = await runAsAccount(systemRunner, account, sharedDir, {
      file: layout.install.file,
      args: layout.install.args,
      timeoutMs: 300000,
    });
    await delay(4000);
    const ok = refused && layout.install.okCodes.includes(installed.code) && existsSync(join(layout.root, 'throng.exe'));
    if (!ok) {
      log(`standard-account-install: exit ${installed.code}; throng.exe ${existsSync(join(layout.root, 'throng.exe')) ? 'present' : 'absent'} in ${layout.root}`);
      reportInstallLogs(sharedDir, log);
    }
    // Take it off again as the same account, so the run also shows a standard account can uninstall.
    await runAsAccount(systemRunner, account, sharedDir, { file: layout.uninstall.file, args: layout.uninstall.args, timeoutMs: 180000 }).catch(() => {});
    return ok;
  }, log));
  return outcome === true;
}

/** Process ids (and owners) of everything running from under `root`, via CIM. */
export function processesUnder(root) {
  const script =
    `$root = '${root.replace(/'/g, "''")}'\n` +
    `$rows = Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase) } | ForEach-Object {\n` +
    `  $o = Invoke-CimMethod -InputObject $_ -MethodName GetOwner -ErrorAction SilentlyContinue\n` +
    `  [pscustomobject]@{ pid = [int]$_.ProcessId; ppid = [int]$_.ParentProcessId; name = [string]$_.Name; owner = [string]$o.User }\n}\n` +
    `ConvertTo-Json -Compress -InputObject @($rows)`;
  try {
    const out = execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', timeout: 60000 });
    const parsed = JSON.parse(out || '[]');
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return [];
  }
}

/** FR-007 — the app started as an elevated installer starts it is not itself elevated. */
export async function notElevatedLaunch({ layout, throngPids, killTree, log }) {
  // This launches into the REAL per-user namespace (explorer.exe passes none of this harness's
  // environment), so it must not run where another throng is already open.
  const running = processesUnder(layout.root).length + throngPids('').length;
  if (running > 0) {
    log('not-elevated-launch: refusing — a throng is already running on this machine');
    return false;
  }
  const exe = join(layout.root, 'throng.exe');
  // explorer.exe starts its target at the desktop's integrity level — the mechanism both installers
  // use to start the app at the end of an elevated install (research D10).
  spawn('explorer.exe', [exe], { detached: true, stdio: 'ignore' }).unref();
  let mains = [];
  for (let attempt = 0; attempt < 20 && mains.length === 0; attempt++) {
    await delay(2000);
    mains = processesUnder(layout.root).filter((p) => /^throng\.exe$/i.test(p.name));
  }
  if (mains.length === 0) {
    log('not-elevated-launch: the app did not start');
    return false;
  }
  // Only the main process says what level the app was started at: its renderer and GPU children are
  // sandboxed to low (or unreadable) whatever the parent is.
  const main = findMainProcess(processesUnder(layout.root));
  let explorer = -1;
  try {
    explorer = Number(
      execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', '(Get-Process explorer -ErrorAction SilentlyContinue | Select-Object -First 1).Id'], { encoding: 'utf8' }).trim(),
    );
  } catch {
    // no desktop shell to compare with; the judgement copes with an unreadable level
  }
  const levels = integrityLevels([main?.pid, explorer].filter((p) => Number.isInteger(p) && p > 0));
  killTree(layout.root);
  const verdict = judgeNotElevated({ mainLevel: levels[main?.pid] ?? -1, explorerLevel: levels[explorer] ?? -1 });
  log(`not-elevated-launch: ${verdict.status} — ${verdict.reason}`);
  return verdict.status === 'passed' ? true : verdict.status === 'unproven' ? { unproven: verdict.reason } : false;
}

/**
 * FR-012/FR-013/FR-029 and FR-016a, in one account's lifetime: a second standard account uses the
 * shared installation, and then an unattended reinstall runs while that account's throng is up.
 *
 * `second-account` is `true` only when the whole thing was exercised. The daemon half is always
 * exercised and may not be waived; the GUI half is not attempted on a runner whose session is not
 * the second account's interactive desktop, and when the daemon half passes the step is `unproven`
 * with that reason (research D11) — reported on every run, never a pass.
 */
// Run as the account by the shared install's own runtime, rather than through `cmd /c`: cmd parses
// its command line by its own rules, not the C runtime's that runAsAccount quotes for.
const EXISTS = "process.exit(require('node:fs').existsSync(process.argv[1]) ? 0 : 1)";
const LISTS = "try { require('node:fs').readdirSync(process.argv[1]); process.exit(0) } catch { process.exit(1) }";

export async function secondAccountAndInUse({ layout, reinstall, sharedDir, killTree, log }) {
  const result = { secondAccount: false, inUseUpgrade: false, reasons: {} };
  const root = layout.root;

  const outcome = await withAccountOrFail(async (account) => {
    const profile = join('C:\\Users', account.name);
    const pipe = `\\\\.\\pipe\\throng-verify-second-${process.pid}`;
    const probe = share(sharedDir, join(here, 'daemon-probe.mjs'), 'daemon-probe.mjs');
    const node = join(root, 'resources', 'runtime', 'node.exe');

    // FR-004 — the account sees the shared shortcut, and can read the shared install.
    const shortcut = shortcutCandidates(layout).find((p) => existsSync(p));
    const sees = async (path) =>
      path !== undefined &&
      (await runAsAccount(systemRunner, account, sharedDir, { file: node, args: ['-e', EXISTS, path] })).code === 0;
    const seesShortcut = await sees(shortcut);
    const seesInstall = await sees(join(root, 'throng.exe'));

    // The daemon half: the account runs the shared install's own daemon under its own pipe and data.
    const config = join(profile, 'AppData', 'Roaming', 'throng-verify');
    // A file the account can write and this process can read, to catch the daemon's own output.
    const daemonLog = join(sharedDir, 'second-account-daemon.log');
    const probed = await runAsAccount(systemRunner, account, sharedDir, {
      file: node,
      args: [probe, '--pipe', pipe, '--spawn', root, '--config-root', join(config, 'config'), '--db', join(config, 'throng.db'), '--terminal', 'echo', '--log', daemonLog],
      timeoutMs: 120000,
    });
    let reported = {};
    try {
      reported = JSON.parse(probed.stdout.trim().split(/\r?\n/).pop() ?? '{}');
    } catch {
      /* reported stays empty, and the checks below fail with it */
    }
    if (reported.ok !== true) {
      // The daemon half failed: put everything that names the cause into the CI log.
      log(`second-account: probe exited ${probed.code}; error: ${reported.error ?? '(none reported)'}`);
      if (probed.stderr) log(`second-account: probe stderr:\n${String(probed.stderr).slice(-2000)}`);
      if (reported.daemonState) log(`second-account: daemon ${reported.daemonState}`);
      const tail = existsSync(daemonLog) ? readFileSync(daemonLog, 'utf8').split(/\r?\n/).slice(-40).join('\n') : '(no daemon log was written)';
      log(`second-account: daemon log tail (${daemonLog}):\n${tail}`);
      if (existsSync(daemonLog)) {
        // The upload step takes only files under the workspace.
        mkdirSync(join(process.cwd(), 'installer-logs'), { recursive: true });
        copyFileSync(daemonLog, join(process.cwd(), 'installer-logs', 'second-account-daemon.log'));
      }
    }

    const daemon = processesUnder(root).find((p) => p.pid === reported.pid);
    const ownedByAccount = daemon !== undefined && daemon.owner.toLowerCase() === account.name.toLowerCase();
    const level = daemon ? integrityLevels([daemon.pid])[daemon.pid] : -1;
    const medium = level >= 0x2000 && level < 0x3000;

    // Neither account can see the other's profile: the standard account cannot list this one's.
    const blocked =
      (await runAsAccount(systemRunner, account, sharedDir, { file: node, args: ['-e', LISTS, join(homedir(), 'AppData')] })).code !== 0;

    const checks = {
      'the shared Start-menu shortcut is visible to the account': seesShortcut,
      'the shared install is readable by the account': seesInstall,
      'the account’s daemon answered on its own pipe': reported.ok === true || typeof reported.pid === 'number',
      'a terminal ran in the account’s daemon': reported.terminal === true,
      'the daemon runs as the account, not as the installer': ownedByAccount,
      'the daemon runs at medium integrity': medium,
      'the account’s data is in its own profile': existsSync(join(config, 'throng.db')),
      'the account cannot read the installing account’s profile': blocked,
    };
    const failed = Object.entries(checks).filter(([, ok]) => !ok).map(([what]) => what);
    for (const what of failed) log(`second-account: FAILED — ${what}${reported.error ? ` (${reported.error})` : ''}`);
    if (failed.length === 0) {
      result.secondAccount = 'unproven';
      result.reasons['second-account'] =
        'the daemon half passed as a genuine standard account; the GUI half needs that account’s interactive desktop, which the hosted runner’s session is not';
    }

    // FR-016a — with that account's throng running, an unattended reinstall completes at restart.
    if (daemon) {
      const before = processesUnder(root).some((p) => p.pid === daemon.pid);
      // What the installer is about to be told: run the installed helper exactly as the setup does,
      // from this elevated process, and record all of it. An in-use-upgrade that does not return
      // 3010 is only explicable from this verdict.
      const helper = spawnSync(join(root, 'resources', 'runtime', 'node.exe'), [join(root, 'resources', 'in-use', 'in-use.mjs'), '--nsis', root], {
        encoding: 'utf8',
        timeout: 60000,
        windowsHide: true,
      });
      log(
        `in-use helper before the reinstall: exit ${helper.status}${helper.error ? ` (${helper.error.message})` : ''}; ` +
          `stdout ${JSON.stringify(String(helper.stdout ?? '').trim())}; stderr ${JSON.stringify(String(helper.stderr ?? '').trim())}`,
      );
      const code = reinstall();
      const stillThere = processesUnder(root).some((p) => p.pid === daemon.pid);
      const pending = pendingFileRenames().split('\n');
      // An MSI moves files in use aside into Config.Msi and deletes them at restart, so for it the
      // pending entries name that folder rather than the install root.
      const roots = [root, shortPathOf(root), ...(layout.isMsi ? [`${process.env.SystemDrive ?? 'C:'}\\Config.Msi`] : [])];
      const mentionsRoot = mentionsInstallRoot(pending, roots);
      result.inUseUpgrade = before && code === 3010 && stillThere && mentionsRoot;
      if (!result.inUseUpgrade) {
        log(`in-use-upgrade: exit ${code} (want 3010); the account's process ${stillThere ? 'survived' : 'was TERMINATED or exited'}; pending replacements ${mentionsRoot ? 'registered' : 'NOT registered'}`);
        if (!mentionsRoot) log(`in-use-upgrade: roots ${JSON.stringify(roots)}; pending entries (first 20): ${JSON.stringify(pending.slice(0, 20))}`);
      }
      for (const r of roots) if (r) clearPendingFileRenames(r);
    } else {
      log('in-use-upgrade: no account process to hold the install in use');
    }
    return true;
  }, log);

  killTree(root);
  if (outcome === null) result.secondAccount = false;
  return result;
}

export function pendingFileRenames() {
  try {
    return execFileSync(
      'powershell',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        "(Get-ItemProperty -Path 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Session Manager' -Name PendingFileRenameOperations -ErrorAction SilentlyContinue).PendingFileRenameOperations -join \"`n\"",
      ],
      { encoding: 'utf8', timeout: 30000 },
    );
  } catch {
    return '';
  }
}

/** The runner does not restart; drop the entries this step caused so a later step is not confused. */
/** The 8.3 form of a folder, or '' when the volume has none. */
function shortPathOf(dir) {
  try {
    return execFileSync(
      'powershell',
      ['-NoProfile', '-NonInteractive', '-Command', `(New-Object -ComObject Scripting.FileSystemObject).GetFolder('${dir.replace(/'/g, "''")}').ShortPath`],
      { encoding: 'utf8', timeout: 30000 },
    ).trim();
  } catch {
    return '';
  }
}

export function clearPendingFileRenames(root) {
  const script =
    `$key = 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Session Manager'\n` +
    `$cur = (Get-ItemProperty -Path $key -Name PendingFileRenameOperations -ErrorAction SilentlyContinue).PendingFileRenameOperations\n` +
    `if ($cur) { $root = '${root.replace(/'/g, "''")}'; $keep = @(); for ($i = 0; $i -lt $cur.Count; $i += 2) { ` +
    `if (-not ($cur[$i] -like ('*' + $root + '*'))) { $keep += $cur[$i]; $keep += $cur[$i + 1] } }; ` +
    `if ($keep.Count -gt 0) { Set-ItemProperty -Path $key -Name PendingFileRenameOperations -Value $keep } else { Remove-ItemProperty -Path $key -Name PendingFileRenameOperations -ErrorAction SilentlyContinue } }`;
  try {
    execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], { stdio: 'ignore', timeout: 30000 });
  } catch {
    /* best effort */
  }
}

