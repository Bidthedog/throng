// The manual test plan (MT-01..MT-08, .claude/.manual-test-plans/) run on a GitHub-hosted runner.
//
//   node scripts/verify-hand-tests.mjs --list
//   node scripts/verify-hand-tests.mjs --group MT-0N [--dir dist/installer] [--out-dir hand-test-evidence]
//        [--expected-version <v>] [--older-zip <alpha10.zip>] [--older-setup <older setup.exe>]
//
// Each group does what its steps say: it drives the real installers' dialogs through Windows UI
// Automation (ui-automation.ps1), as the account the step names, and checks what a person would look
// at — shortcuts, Installed apps, who owns the running process, whether a terminal works, what a
// message says. It writes `hand-test-MT-0N.json` (every step `passed`, `failed` or `runner-gap`, with
// the reason) and a full-screen PNG at each dialog, into --out-dir.
//
// A `runner-gap` is for what the runner physically cannot do — a restart, a UAC prompt on a machine
// with UAC off, a desktop that is not medium integrity — and it always names the stand-in done
// instead. It is never a way to skip a step that could be driven.
//
// Like the other harness scripts this only runs on a clean runner (it creates accounts and installs
// things). The decisions it makes are in hand-tests-model.mjs and are unit tested.
import { execFileSync, spawn } from 'node:child_process';
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { declareArtifactSet, resolveArtifact } from '@throng/core';
import {
  createRecorder,
  GROUPS,
  judgePendingRenames,
  parseHandTestArgs,
  refusalNamesAccount,
  renderList,
} from './hand-tests-model.mjs';
import { findMainProcess, integrityLevels, judgeNotElevated } from './process-integrity.mjs';
import { runAsAccount, startAsAccount, systemRunner, withSecondAccount } from './second-account.mjs';
import { clickButton, screenshot, ui, windowText } from './ui-driver.mjs';
import { installLayout } from './verify-installer-args.mjs';
import {
  clearPendingFileRenames,
  makeSharedDir,
  pendingFileRenames,
  registeredDisplayNames,
  removeSharedDir,
  runCommand,
  shortcutCandidates,
  withInstallerPolicyEnabled,
} from './verify-scope-steps.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
// NSIS names its main window "<name> Setup" and its message boxes "<name>"; Windows Installer's dialogs
// and the in-use popup carry the product name or "throng Setup". One pattern finds the topmost of them.
// The running app is "<project> - throng", which none of these match: a pattern loose enough to match
// it once let the driver press the app's own Close button after the wizard had finished.
const SETUP_WINDOW = 'Setup|Uninstall|Windows Installer|^throng$|^throng [0-9]|^throng \\(';
const ELEVATION_DECLINED = /needs administrator approval/i;

// ---------------------------------------------------------------------------------------------
// Machine helpers
// ---------------------------------------------------------------------------------------------

// The setup writes diagnostics here only when the file exists (packaging/installer.nsh); a path every
// account can write, because a setup's own temp folder is not the driver's.
const SETUP_LOG = 'C:\\Users\\Public\\throng-setup.log';
const psq = (s) => String(s).replace(/'/g, "''");

function powershell(script, timeout = 60000) {
  return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], {
    encoding: 'utf8',
    timeout,
    windowsHide: true,
  });
}

/** Processes whose image name matches, with their owners. */
function listProcs(namePattern) {
  const script =
    `$rows = @(Get-CimInstance Win32_Process | Where-Object { $_.Name -match '${namePattern}' } | ForEach-Object { ` +
    `$o = Invoke-CimMethod -InputObject $_ -MethodName GetOwner -ErrorAction SilentlyContinue; ` +
    `[pscustomobject]@{ pid = [int]$_.ProcessId; ppid = [int]$_.ParentProcessId; name = [string]$_.Name; path = [string]$_.ExecutablePath; owner = [string]$o.User } }); ` +
    `ConvertTo-Json -Compress -InputObject $rows`;
  try {
    const parsed = JSON.parse(powershell(script).trim() || '[]');
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return [];
  }
}

const procsUnder = (root) => listProcs('^(throng|node)\\.exe$').filter((p) => p.path.toLowerCase().startsWith(root.toLowerCase()));
const alive = (pid) => listProcs('.').some((p) => p.pid === pid);

function killUnder(...roots) {
  for (const root of roots.filter(Boolean)) {
    const script =
      `Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith('${psq(root)}', [System.StringComparison]::OrdinalIgnoreCase) } | ` +
      `ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`;
    try {
      powershell(script, 30000);
    } catch {
      /* best effort */
    }
  }
}

/** The daemon pipe a running throng of this account created (its name derives from the account). */
function pipeFor(accountName) {
  try {
    const out = powershell("[System.IO.Directory]::GetFiles('\\\\.\\pipe\\') | Where-Object { $_ -like '*throng.*.daemon' }", 30000);
    const token = `throng.${accountName}.`.toLowerCase();
    return out.split(/\r?\n/).map((l) => l.trim()).find((l) => l.toLowerCase().includes(token)) ?? null;
  } catch {
    return null;
  }
}

/** The DisplayNames in an account's Installed apps (its own hive, and the per-user MSI product list). */
function accountEntries(accountName) {
  const script = String.raw`
$ErrorActionPreference = 'SilentlyContinue'
$sid = (New-Object System.Security.Principal.NTAccount('${accountName}')).Translate([System.Security.Principal.SecurityIdentifier]).Value
$loaded = Test-Path "Registry::HKEY_USERS\$sid"
if (-not $loaded) { reg.exe load HKU\throng-hand "C:\Users\${accountName}\NTUSER.DAT" | Out-Null; $hive = 'HKEY_USERS\throng-hand' } else { $hive = "HKEY_USERS\$sid" }
$names = @()
$names += Get-ItemProperty -Path "Registry::$hive\Software\Microsoft\Windows\CurrentVersion\Uninstall\*" | ForEach-Object { $_.DisplayName }
$names += Get-ItemProperty -Path "Registry::HKEY_LOCAL_MACHINE\Software\Microsoft\Windows\CurrentVersion\Installer\UserData\$sid\Products\*\InstallProperties" | ForEach-Object { $_.DisplayName }
if (-not $loaded) { [gc]::Collect(); Start-Sleep -Milliseconds 500; reg.exe unload HKU\throng-hand | Out-Null }
ConvertTo-Json -Compress -InputObject @($names | Where-Object { $_ })`;
  try {
    const parsed = JSON.parse(powershell(script).trim() || '[]');
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return [];
  }
}

/** Is a window of this process (by pid) showing? Returns its title or null. */
function windowOf(pid, timeoutSec = 60) {
  const r = ui('find', { title: '.*', processId: pid, timeoutSec });
  return r.ok ? r.title : null;
}

// ---------------------------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------------------------

export async function runGroup(options) {
  const repoRoot = join(here, '..');
  const version = options.version ?? JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')).version;
  const set = declareArtifactSet(version);
  const artifact = (role) => resolve(options.dir, resolveArtifact(set, role).filename);
  const evidenceDir = resolve(options.outDir, options.group);
  try {
    writeFileSync(SETUP_LOG, '');
  } catch {
    /* diagnostics only */
  }
  mkdirSync(evidenceDir, { recursive: true });
  const rec = createRecorder(options.group, version);
  const log = (m) => console.error(`[hand-test ${options.group}] ${new Date().toISOString()} ${m}`);
  const sharedDir = makeSharedDir();
  copyFileSync(join(here, 'daemon-probe.mjs'), join(sharedDir, 'daemon-probe.mjs'));
  const shots = [];
  const shot = (label) => {
    const r = screenshot(evidenceDir, label);
    shots.push(r.path);
    return r.path;
  };

  /** Run a step: an exception is a failure of that step, never of the run. */
  const step = async (id, work) => {
    log(`step ${id} starting`);
    try {
      appendFileSync(SETUP_LOG, `=== step ${id}\r\n`);
    } catch {
      /* the marker is evidence only */
    }
    try {
      await work();
      if (!rec.has(id)) rec.fail(id, 'the step recorded no result');
    } catch (error) {
      rec.fail(id, `threw: ${error instanceof Error ? error.message : String(error)}`);
    }
    log(`step ${id}: ${rec.toJson().steps.find((s) => s.id === id)?.status}`);
  };

  // --- accounts and their environments ------------------------------------------------------
  const envOf = (name) => ({
    LOCALAPPDATA: `C:\\Users\\${name}\\AppData\\Local`,
    APPDATA: `C:\\Users\\${name}\\AppData\\Roaming`,
    SystemRoot: process.env.SystemRoot,
    ProgramFiles: process.env.ProgramFiles,
    ProgramData: process.env.ProgramData,
  });
  const adminEnv = process.env;
  const layoutFor = (role, scope, artifactPath, who = null) =>
    installLayout({ role, scope, version, artifactPath, env: who ? envOf(who.name) : adminEnv });
  const shareCopy = (path, name) => {
    const target = join(sharedDir, name);
    copyFileSync(path, target);
    return target;
  };

  const startAs = async (account, file, args = []) => {
    if (!account) {
      const child = spawn(file, args, { stdio: 'ignore', windowsHide: false });
      const exited = new Promise((done) => child.on('exit', (code) => done(code ?? -1)));
      return { pid: child.pid, exited };
    }
    const r = await startAsAccount(systemRunner, account, sharedDir, { file, args });
    if (r.pid === null) throw new Error(`could not start ${file} as ${account.name}: ${r.stderr}`);
    return { pid: r.pid, exited: null };
  };

  const probe = async (account, root, args, timeoutMs = 120000) => {
    const node = join(root, 'resources', 'runtime', 'node.exe');
    const script = join(sharedDir, 'daemon-probe.mjs');
    let out;
    if (account) {
      out = (await runAsAccount(systemRunner, account, sharedDir, { file: node, args: [script, ...args], timeoutMs })).stdout;
    } else {
      try {
        out = execFileSync(node, [script, ...args], { encoding: 'utf8', timeout: timeoutMs, windowsHide: true });
      } catch (error) {
        out = String(error.stdout ?? '');
      }
    }
    try {
      return JSON.parse(String(out).trim().split(/\r?\n/).pop());
    } catch {
      return { ok: false, error: `no probe answer: ${String(out).slice(0, 200)}` };
    }
  };

  /** Run a cmd test as an account: can it see this path? */
  const accountSees = async (account, path) =>
    // PowerShell, with the path single-quoted: an argument holding double quotes (which cmd's own
    // `if exist "..."` needs) is escaped by the command-line quoting and cmd then cannot read it, so
    // this answered "cannot see it" for everything.
    (await runAsAccount(systemRunner, account, sharedDir, {
      file: 'powershell.exe',
      args: ['-NoProfile', '-NonInteractive', '-Command', `if (Test-Path -LiteralPath '${psq(path)}') { exit 0 } else { exit 1 }`],
      timeoutMs: 60000,
    })).code === 0;

  /** A verbose Windows Installer log for an interactive msiexec run, where every account can write. */
  let logCount = 0;
  const msiArgs = (args, label) => [...args, '/l*v', join(sharedDir, `msi-${options.group}-${label}-${++logCount}.log`)];

  /**
   * What the setup's in-use helper says when run EXACTLY as the setup runs it: from a copy in a
   * short-named temp folder, with the installed copy's own runtime. Logged and kept as evidence, so a
   * refusal that does not appear can be told from a helper that does not answer.
   */
  const diagnoseHelper = (root) => {
    const record = { root };
    try {
      const dir = join(process.env.TEMP ?? 'C:\\Windows\\Temp', `nsdiag${process.pid}.tmp`);
      mkdirSync(dir, { recursive: true });
      for (const f of ['in-use.mjs', 'in-use-classify.js']) copyFileSync(join(root, 'resources', 'in-use', f), join(dir, f));
      const short = powershell(`(New-Object -ComObject Scripting.FileSystemObject).GetFolder('${psq(dir)}').ShortPath`).trim();
      record.shortPath = short;
      for (const [name, where] of [['long', dir], ['short', short]]) {
        try {
          const out = execFileSync(join(root, 'resources', 'runtime', 'node.exe'), [join(where, 'in-use.mjs'), '--nsis', root], { encoding: 'utf8', timeout: 60000, windowsHide: true });
          record[name] = { stdout: out.trim() };
        } catch (error) {
          record[name] = { error: error.message.slice(0, 300), stdout: String(error.stdout ?? '').trim(), stderr: String(error.stderr ?? '').trim().slice(0, 300) };
        }
      }
    } catch (error) {
      record.error = error.message;
    }
    log(`in-use helper, run as the setup runs it: ${JSON.stringify(record)}`);
    writeFileSync(join(evidenceDir, 'in-use-helper.json'), JSON.stringify(record, null, 2));
    return record;
  };

  const consentSeen = () => ui('windows', { title: 'User Account Control|Windows Security|Credential' }).windows?.length > 0;

  // --- the dialog loop -----------------------------------------------------------------------
  /**
   * Drive an installer's wizard to its end. `onPage` sees each page ({text, controls}) and may
   * return an action; otherwise the next sensible button is pressed. Returns what happened.
   */
  async function driveWizard({ label, alive: stillRunning, onPage, maxPages = 60 }) {
    const trace = [];
    // Every page, the action taken and what the helper answered, kept as evidence as the loop goes.
    const saveTrace = () => {
      try {
        writeFileSync(join(evidenceDir, `${label}-trace.json`), JSON.stringify(trace, null, 1));
      } catch {
        /* evidence only */
      }
    };
    for (let i = 0; i < maxPages; i++) {
      const page = ui('controls', { title: SETUP_WINDOW, timeoutSec: 20 });
      if (!page.ok) {
        if (!(await stillRunning())) return { outcome: 'ended', trace };
        await delay(2000);
        continue;
      }
      const text = windowText({ title: SETUP_WINDOW }) ?? '';
      const controls = page.controls ?? [];
      const names = controls.map((c) => `${c.type}:${c.name}${c.state ? `[${c.state}]` : ''}`);
      trace.push({ title: page.title, text: text.slice(0, 400), controls: names });
      shot(`${label}-${String(i).padStart(2, '0')}`);

      const action = (await onPage({ text, controls, title: page.title, index: i })) ?? defaultAction(controls);
      trace[trace.length - 1].action = JSON.stringify(action);
      saveTrace();
      if (action.stop) return { outcome: action.stop, trace, ...action };
      if (action.select) {
        const r = ui('select', { title: SETUP_WINDOW, name: action.select });
        trace[trace.length - 1].selected = JSON.stringify(r);
        saveTrace();
        if (!r.ok) return { outcome: 'ui-error', error: r.error, trace };
      }
      if (action.tick) {
        const r = ui('tick', { title: SETUP_WINDOW, name: action.tick });
        if (!r.ok) return { outcome: 'ui-error', error: r.error, trace };
      }
      if (action.click) {
        const r = await clickButton({ title: SETUP_WINDOW, name: action.click });
        trace[trace.length - 1].clicked = JSON.stringify(r);
        saveTrace();
        if (!r.ok && !(await stillRunning())) return { outcome: 'ended', trace };
        if (!r.ok) return { outcome: 'ui-error', error: r.error, trace };
        // Pressing Finish or Close ends the wizard; anything that appears next is not its page.
        if (/Finish|Close/.test(action.click)) {
          await delay(action.wait ?? 3000);
          return { outcome: 'finished', trace };
        }
      }
      await delay(action.wait ?? 1500);
    }
    return { outcome: 'too-many-pages', trace };
  }

  function defaultAction(controls) {
    const has = (re) => controls.some((c) => c.type === 'Button' && !c.titlebar && c.enabled && re.test(c.name));
    if (has(/^(Install|Uninstall)$/i)) return { click: '^(Install|Uninstall)$' };
    if (has(/^Next/i)) return { click: '^Next' };
    if (has(/^(Finish|Close)$/i)) return { click: '^(Finish|Close)$' };
    if (has(/^OK$/i)) return { click: '^OK$' };
    return { wait: 3000 };
  }

  const radios = (controls) => controls.filter((c) => c.type === 'RadioButton');
  const onScopePage = (controls) => radios(controls).some((c) => /only for|just for|anyone|all users/i.test(c.name));
  const isSelected = (controls, re) => radios(controls).some((c) => re.test(c.name) && /selected=True/i.test(c.state));
  const choose = (which) => (which === 'everyone' ? '(anyone|all users)' : '(only for|just for)');

  // ---------------------------------------------------------------------------------------------
  // Groups
  // ---------------------------------------------------------------------------------------------

  const groups = {
    // MT-01 -------------------------------------------------------------------------------------
    async 'MT-01'() {
      await withSecondAccount(systemRunner, async (a) => withSecondAccount(systemRunner, async (b) => {
        const setup = shareCopy(artifact('setup'), 'setup-under-test.exe');
        const layout = layoutFor('setup', 'per-user', setup, a);
        let scopeDefault = false;
        let state = 'start';
        const proc = await startAs(a, setup);
        const result = await driveWizard({
          label: 'setup-as-standard-account',
          alive: async () => alive(proc.pid),
          onPage: async ({ controls }) => {
            if (onScopePage(controls) && state === 'start') {
              scopeDefault = isSelected(controls, /only for/i);
              state = 'scope-seen';
            }
            return undefined;
          },
        });
        const prompted = consentSeen();
        if (scopeDefault) rec.pass('scope-page-defaults-to-only-me', 'the "Only for me" radio was selected on the scope page when it opened');
        else rec.fail('scope-page-defaults-to-only-me', `no selected "Only for me" radio on the scope page (outcome ${result.outcome}); pages: ${JSON.stringify(result.trace.map((t) => t.controls)).slice(0, 600)}`);

        await delay(5000);
        const installed = existsSync(join(layout.root, 'throng.exe'));
        if (installed && !prompted) rec.pass('installs-without-elevation', `finished as ${a.name} (a standard account, which cannot elevate); no consent or credential window appeared; installed to ${layout.root}`);
        else rec.fail('installs-without-elevation', `${installed ? 'installed' : 'NOT installed'}; consent window ${prompted ? 'appeared' : 'did not appear'}; outcome ${result.outcome}`);

        await step('shortcut-and-entry', async () => {
          const shortcut = shortcutCandidates(layout).find((p) => existsSync(p));
          const entries = accountEntries(a.name);
          const entry = entries.includes(layout.displayName);
          if (shortcut && entry) rec.pass('shortcut-and-entry', `${shortcut}; Installed apps lists "${layout.displayName}"`);
          else rec.fail('shortcut-and-entry', `shortcut ${shortcut ?? 'MISSING'}; entry "${layout.displayName}" ${entry ? 'present' : `MISSING among ${JSON.stringify(entries)}`}`);
        });

        await step('launches-as-the-account', async () => {
          // The wizard may already have started it (Run throng is ticked by default): that is the app to judge.
          await delay(8000);
          const running = () => procsUnder(layout.root).find((p) => /^throng\.exe$/i.test(p.name) && p.owner.toLowerCase() === a.name.toLowerCase());
          const app = running() ?? (await startAs(a, join(layout.root, 'throng.exe')));
          const title = windowOf(app.pid, 90);
          shot('app-as-standard-account');
          const mine = procsUnder(layout.root).filter((p) => p.owner.toLowerCase() === a.name.toLowerCase());
          if (title !== null && mine.length > 0) rec.pass('launches-as-the-account', `throng.exe runs as ${a.name} with a visible window "${title}"`);
          else rec.fail('launches-as-the-account', `window ${title ?? 'none'}; processes owned by the account: ${mine.length}`);
        });

        await step('terminal-works', async () => {
          await delay(5000);
          const pipe = pipeFor(a.name);
          if (!pipe) return rec.fail('terminal-works', 'the account\'s daemon pipe was not found');
          const r = await probe(a, layout.root, ['--pipe', pipe, '--terminal', 'echo']);
          if (r.ok && r.terminal) rec.pass('terminal-works', `a terminal ran in ${a.name}'s own daemon (pipe ${pipe})`);
          else rec.fail('terminal-works', `probe: ${JSON.stringify(r).slice(0, 300)}`);
        });

        await step('other-account-sees-nothing', async () => {
          const shortcut = shortcutCandidates(layout).find((p) => existsSync(p));
          const seesShortcut = shortcut ? await accountSees(b, shortcut) : false;
          const entries = accountEntries(b.name);
          const seesEntry = entries.includes(layout.displayName);
          if (!seesShortcut && !seesEntry) rec.pass('other-account-sees-nothing', `${b.name} cannot see ${shortcut ?? 'the shortcut'} and has no "${layout.displayName}" entry`);
          else rec.fail('other-account-sees-nothing', `${b.name}: shortcut visible ${seesShortcut}, entry visible ${seesEntry}`);
        });
        killUnder(layout.root);
      }));
    },

    // MT-02 -------------------------------------------------------------------------------------
    async 'MT-02'() {
      await withSecondAccount(systemRunner, async (a) => {
        const setup = shareCopy(artifact('setup'), 'setup-under-test.exe');
        const layout = layoutFor('setup', 'machine', setup);
        let chose = false;
        const proc = await startAs(null, setup);
        const result = await driveWizard({
          label: 'setup-as-admin',
          alive: async () => alive(proc.pid),
          onPage: async ({ controls }) => {
            if (onScopePage(controls) && !chose) {
              chose = true;
              return { select: choose('everyone'), click: '^Next' };
            }
            if (controls.some((c) => c.type === 'CheckBox' && /run|launch/i.test(c.name))) {
              return { tick: 'run|launch', click: '^Finish', wait: 4000 };
            }
            return undefined;
          },
        });
        const consent = consentSeen();
        const installed = existsSync(join(layout.root, 'throng.exe'));
        if (chose && installed) rec.pass('installs-for-everyone', `chose "Anyone who uses this computer" and finished with Run throng ticked; installed to ${layout.root}`);
        else rec.fail('installs-for-everyone', `chose ${chose}, installed ${installed}, outcome ${result.outcome}${result.error ? `: ${result.error}` : ''}`);

        await step('app-started-by-wizard', async () => {
          let main;
          let seen;
          for (let i = 0; i < 15 && !main; i++) {
            seen = procsUnder(layout.root);
            // The main process is the throng.exe that no other throng.exe started; failing that, any.
            main = findMainProcess(seen) ?? seen.find((p) => /^throng\.exe$/i.test(p.name));
            if (!main) await delay(2000);
          }
          if (main) rec.pass('app-started-by-wizard', `throng.exe (pid ${main.pid}) was started by the wizard`);
          else {
            // Name every throng and node process on the machine, so a miss can be told from a bad lookup.
            const everything = listProcs('^(throng|node)\\.exe$').map((p) => `${p.pid}<-${p.ppid} ${p.name} ${p.path} [${p.owner}]`);
            rec.fail('app-started-by-wizard', `no throng.exe under ${layout.root} after the wizard finished with Run throng ticked; processes: ${JSON.stringify(everything).slice(0, 700)}`);
          }
          ctx.main = main;
        });

        await step('integrity-not-high', async () => {
          if (!ctx.main) return rec.fail('integrity-not-high', 'no running app to measure');
          const level = integrityLevels([ctx.main.pid])[ctx.main.pid];
          const explorer = Number(powershell('(Get-Process explorer -ErrorAction SilentlyContinue | Select-Object -First 1).Id').trim());
          const explorerLevel = integrityLevels([explorer])[explorer] ?? -1;
          const verdict = judgeNotElevated({ mainLevel: level, explorerLevel });
          if (verdict.status === 'passed') rec.pass('integrity-not-high', verdict.reason);
          else if (verdict.status === 'unproven') {
            rec.gap('integrity-not-high', `measured 0x${level.toString(16)}: ${verdict.reason}`, 'the main process level was measured and reported; the app was started at the same level as the desktop, which is all a runner with UAC off can show');
          } else rec.fail('integrity-not-high', verdict.reason);
        });

        await step('labels-all-users', async () => {
          const shortcut = shortcutCandidates(layout).find((p) => existsSync(p));
          const entry = registeredDisplayNames('HKLM', false).includes(layout.displayName);
          if (shortcut && entry) rec.pass('labels-all-users', `${shortcut}; "${layout.displayName}" in Installed apps`);
          else rec.fail('labels-all-users', `shortcut ${shortcut ?? 'MISSING'}; entry ${entry ? 'present' : 'MISSING'}`);
        });

        await step('standard-account-launches', async () => {
          const shortcut = shortcutCandidates(layout).find((p) => existsSync(p));
          const sees = shortcut ? await accountSees(a, shortcut) : false;
          const app = await startAs(a, join(layout.root, 'throng.exe'));
          const title = windowOf(app.pid, 90);
          shot('app-as-standard-account');
          await delay(5000);
          const pipe = pipeFor(a.name);
          const r = pipe ? await probe(a, layout.root, ['--pipe', pipe, '--terminal', 'echo']) : { ok: false, error: 'no pipe' };
          if (sees && title !== null && r.ok && r.terminal) rec.pass('standard-account-launches', `${a.name} sees the shortcut, throng started first time ("${title}") and a terminal ran`);
          else rec.fail('standard-account-launches', `sees ${sees}; window ${title ?? 'none'}; terminal ${JSON.stringify(r).slice(0, 200)}`);
        });

        await step('isolation', async () => {
          const adminPipe = pipeFor(process.env.USERNAME ?? 'runneradmin');
          const theirPipe = pipeFor(a.name);
          if (!adminPipe || !theirPipe || adminPipe === theirPipe) {
            return rec.fail('isolation', `two daemons were not both up on their own pipes (admin ${adminPipe}, ${a.name} ${theirPipe})`);
          }
          const mine = await probe(null, layout.root, ['--pipe', adminPipe, '--project', 'Mine']);
          const theirs = await probe(a, layout.root, ['--pipe', theirPipe, '--project', 'Theirs']);
          const mineOnly = mine.ok && mine.projectNames?.includes('Mine') && !mine.projectNames.includes('Theirs');
          const theirsOnly = theirs.ok && theirs.projectNames?.includes('Theirs') && !theirs.projectNames.includes('Mine');
          if (mineOnly && theirsOnly) rec.pass('isolation', `both daemons up at once; admin lists ${JSON.stringify(mine.projectNames)}, ${a.name} lists ${JSON.stringify(theirs.projectNames)}`);
          else rec.fail('isolation', `admin ${JSON.stringify(mine).slice(0, 200)}; ${a.name} ${JSON.stringify(theirs).slice(0, 200)}`);
        });

        rec.gap('no-second-prompt', 'UAC is disabled on a hosted runner, so no administrator prompt is ever shown, in any step', `watched for a consent or credential window for the whole run: ${consent ? 'ONE APPEARED' : 'none appeared'}`);
        if (consent) rec.fail('no-second-prompt', 'a consent or credential window appeared');
        killUnder(layout.root);
      });
    },

    // MT-03 -------------------------------------------------------------------------------------
    async 'MT-03'() {
      await withSecondAccount(systemRunner, async (a) => {
        // Setup. Under UAC-off a standard account's elevation request fails (740) instead of
        // prompting: the setup reports it the way it reports a declined prompt.
        const setup = shareCopy(artifact('setup'), 'setup-under-test.exe');
        const layout = layoutFor('setup', 'per-user', setup, a);
        let phase = 'scope1';
        let declinedText = null;
        let snapshot = null;
        let scopeAgain = false;
        const proc = await startAs(a, setup);
        await driveWizard({
          label: 'setup-decline',
          alive: async () => alive(proc.pid),
          onPage: async ({ text, controls }) => {
            if (ELEVATION_DECLINED.test(text) && phase === 'chose-everyone') {
              declinedText = text;
              phase = 'declined';
              // Nothing is installed at this moment: take the snapshot now, not after "Only for me".
              snapshot = { shortcut: shortcutCandidates(layout).some((p) => existsSync(p)), entry: accountEntries(a.name).includes(layout.displayName) };
              return { click: '^OK$', wait: 2500 };
            }
            if (onScopePage(controls) && phase === 'scope1') {
              phase = 'chose-everyone';
              return { select: choose('everyone'), click: '^Next' };
            }
            if (onScopePage(controls) && phase === 'declined') {
              scopeAgain = true;
              phase = 'chose-me';
              return { select: choose('me'), click: '^Next' };
            }
            if (controls.some((c) => c.type === 'CheckBox' && /run|launch/i.test(c.name))) return { click: '^Finish' };
            return undefined;
          },
        });
        const before = snapshot ?? { shortcut: false, entry: false, missing: true };
        if (declinedText) {
          const ok = /Only for me/i.test(declinedText) && /nothing has been installed/i.test(declinedText);
          if (ok) rec.gap('setup-decline-message', 'UAC is disabled on the runner, so there is no prompt to decline: the standard account\'s elevation request fails (740) instead', `read the message the setup shows when elevation is not given: "${declinedText.replace(/\s+/g, ' ').slice(0, 220)}"`);
          else rec.fail('setup-decline-message', `a message appeared but not the explanation: "${declinedText.slice(0, 220)}"`);
        } else rec.fail('setup-decline-message', 'no explanation appeared after choosing "Anyone" as a standard account');
        if (scopeAgain) rec.pass('setup-scope-page-still-showing', 'the scope page was showing again after the message was closed');
        else rec.fail('setup-scope-page-still-showing', 'the scope page was not showing after the message was closed');
        await delay(5000);
        if (existsSync(join(layout.root, 'throng.exe')) && phase === 'chose-me') rec.pass('setup-only-me-installs', `"Only for me" installed to ${layout.root} with no prompt`);
        else rec.fail('setup-only-me-installs', `phase ${phase}; installed ${existsSync(join(layout.root, 'throng.exe'))}`);
        if (!before.missing && !before.shortcut && !before.entry) rec.pass('setup-nothing-before-install', 'no shortcut and no Installed apps entry after declining');
        else rec.fail('setup-nothing-before-install', `after declining: shortcut ${before.shortcut}, entry ${before.entry}`);

        // The MSI.
        const msi = shareCopy(artifact('msi'), 'msi-under-test.msi');
        const msiLayout = layoutFor('msi', 'per-user', msi, a);
        let msiPhase = 'start';
        let msiText = null;
        let msiScopeAgain = false;
        let msiPrompt = null;
        const m = await startAs(a, 'C:\\Windows\\System32\\msiexec.exe', msiArgs(['/i', msi], 'install'));
        await driveWizard({
          label: 'msi-decline',
          alive: async () => alive(m.pid),
          maxPages: 14,
          onPage: async ({ text, controls }) => {
            if (/Administrator approval needed|needs administrator approval/i.test(text)) {
              msiText = text;
              msiPhase = 'declined';
              return { click: '^OK$', wait: 2000 };
            }
            if (onScopePage(controls) && msiPhase === 'start') {
              msiPhase = 'chose-everyone';
              return { select: choose('everyone'), click: '^Next', wait: 4000 };
            }
            if (onScopePage(controls) && msiPhase === 'chose-everyone') {
              // The scope page is still up: the administrator request is waiting on something. With UAC
              // off, a standard account's "run as administrator" raises a credential window instead of
              // the consent one. Declining it is what a person who does not have the password does.
              const win = ui('windows', { title: 'User Account Control|Windows Security|Credential|Windows Installer' }).windows?.find((w) => !/Setup$/.test(w.title));
              shot('msi-prompt');
              // A standard account's request is answered on the SECURE desktop by consent.exe, which neither
              // UI Automation nor a screenshot can reach (the screenshots stop at this point). Its process
              // is the evidence that the request was raised; ending it is declining it.
              const consent = listProcs('^(consent|CredentialUIBroker)\\.exe$');
              if (!win && consent.length > 0) {
                msiPrompt = `${consent.map((p) => `${p.name} (pid ${p.pid})`).join(', ')} answering on the secure desktop`;
                for (const p of consent) {
                  try {
                    powershell(`Stop-Process -Id ${p.pid} -Force -ErrorAction Stop`, 15000);
                  } catch (e) {
                    log(`could not end ${p.name}: ${e instanceof Error ? e.message : e}`);
                  }
                }
                msiPhase = 'prompt-cancelled';
                return { wait: 4000 };
              }
              msiPrompt = win ? `${win.title}: ${windowText({ title: win.title.replace(/[^\w ]/g, '.') }) ?? ''}`.slice(0, 300) : null;
              if (win) {
                const closed = await clickButton({ title: win.title.replace(/[^\w ]/g, '.'), name: '^(Cancel|No)$' });
                log(`msi prompt "${win.title}" cancelled: ${JSON.stringify(closed)}`);
                msiPhase = 'prompt-cancelled';
              }
              return { wait: 4000 };
            }
            if (onScopePage(controls) && msiPhase === 'declined') {
              msiScopeAgain = true;
              return { stop: 'done' };
            }
            return undefined;
          },
        });
        if (msiText && ELEVATION_DECLINED.test(msiText) && msiPrompt) {
          rec.pass('msi-decline-message', `the administrator request showed "${msiPrompt}"; declining it showed: "${msiText.replace(/\s+/g, ' ').slice(0, 220)}"`);
        } else if (msiText && ELEVATION_DECLINED.test(msiText)) {
          rec.gap('msi-decline-message', 'UAC is disabled on the runner, so there is no prompt to decline: the relaunch request fails instead', `read the explanation the MSI shows when the relaunch did not start: "${msiText.replace(/\s+/g, ' ').slice(0, 220)}"`);
        } else rec.fail('msi-decline-message', `no explanation (phase ${msiPhase}; prompt ${msiPrompt ?? 'none seen'}): ${msiText ?? 'no text'}`);
        if (msiScopeAgain) rec.pass('msi-scope-page-still-showing', 'the scope choice was showing again after the explanation');
        else rec.fail('msi-scope-page-still-showing', 'the scope choice was not showing after the explanation');
        await clickButton({ title: SETUP_WINDOW, name: '^Cancel' }, 1);
        await clickButton({ title: 'Setup|throng', name: '^Yes$' }, 1);
        await delay(3000);
        const msiNothing = !existsSync(join(msiLayout.root, 'throng.exe')) && !accountEntries(a.name).includes(msiLayout.displayName);
        if (msiNothing) rec.pass('msi-nothing-before-install', 'nothing installed and no entry after declining');
        else rec.fail('msi-nothing-before-install', 'something was installed after the explanation');
        killUnder(layout.root);
      });
    },

    // MT-04 -------------------------------------------------------------------------------------
    async 'MT-04'() {
      await withSecondAccount(systemRunner, async (a) => {
        const msi = shareCopy(artifact('msi'), 'msi-under-test.msi');
        const userLayout = layoutFor('msi', 'per-user', msi, a);
        const machineLayout = layoutFor('msi', 'machine', msi);

        // 1. a standard account, default scope
        const first = await startAs(a, 'C:\\Windows\\System32\\msiexec.exe', msiArgs(['/i', msi], 'install'));
        await driveWizard({ label: 'msi-standard-account', alive: async () => alive(first.pid), onPage: async () => undefined });
        await delay(5000);
        const promptedFirst = consentSeen();
        await step('standard-account-per-user', async () => {
          const shortcut = shortcutCandidates(userLayout).find((p) => existsSync(p));
          const entry = accountEntries(a.name).includes(userLayout.displayName);
          if (shortcut && entry && !promptedFirst) rec.pass('standard-account-per-user', `no prompt; ${shortcut}; entry "${userLayout.displayName}"`);
          else rec.fail('standard-account-per-user', `shortcut ${shortcut ?? 'MISSING'}; entry ${entry}; consent window ${promptedFirst}`);
        });

        // 2 and 3. the administrator, all users, launch option ticked
        let chose = false;
        const second = await startAs(null, 'C:\\Windows\\System32\\msiexec.exe', msiArgs(['/i', msi], 'install'));
        await driveWizard({
          label: 'msi-admin',
          alive: async () => alive(second.pid),
          onPage: async ({ controls }) => {
            if (onScopePage(controls) && !chose) {
              chose = true;
              return { select: choose('everyone'), click: '^Next' };
            }
            if (controls.some((c) => c.type === 'CheckBox' && /launch|run/i.test(c.name))) return { tick: 'launch|run', click: '^Finish', wait: 4000 };
            return undefined;
          },
        });
        await delay(5000);
        await step('admin-all-users', async () => {
          const shortcut = shortcutCandidates(machineLayout).find((p) => existsSync(p));
          const entry = registeredDisplayNames('HKLM', true).includes(machineLayout.displayName);
          if (chose && shortcut && entry) rec.pass('admin-all-users', `${shortcut}; entry "${machineLayout.displayName}"`);
          else rec.fail('admin-all-users', `chose ${chose}; shortcut ${shortcut ?? 'MISSING'}; entry ${entry}`);
        });
        await step('launch-option', async () => {
          let main;
          for (let i = 0; i < 30 && !main; i++) {
            main = procsUnder(machineLayout.root).find((p) => /^throng\.exe$/i.test(p.name));
            if (!main) await delay(2000);
          }
          ctx.main = main;
          if (main) rec.pass('launch-option', `throng.exe (pid ${main.pid}) started by the final page`);
          else rec.fail('launch-option', 'throng did not start after finishing with the launch option ticked');
        });
        await step('integrity-not-high', async () => {
          if (!ctx.main) return rec.fail('integrity-not-high', 'no running app to measure');
          const level = integrityLevels([ctx.main.pid])[ctx.main.pid];
          const explorer = Number(powershell('(Get-Process explorer -ErrorAction SilentlyContinue | Select-Object -First 1).Id').trim());
          const verdict = judgeNotElevated({ mainLevel: level, explorerLevel: integrityLevels([explorer])[explorer] ?? -1 });
          if (verdict.status === 'passed') rec.pass('integrity-not-high', verdict.reason);
          else if (verdict.status === 'unproven') rec.gap('integrity-not-high', `measured 0x${level.toString(16)}: ${verdict.reason}`, 'the level was measured and reported');
          else rec.fail('integrity-not-high', verdict.reason);
        });
        await step('setup-folders-untouched', async () => {
          const touched = [join(envOf(a.name).LOCALAPPDATA, 'Programs', 'throng'), join(process.env.LOCALAPPDATA ?? '', 'Programs', 'throng'), join(process.env.ProgramFiles ?? '', 'throng')].filter((p) => existsSync(p));
          if (touched.length === 0) rec.pass('setup-folders-untouched', 'neither the per-user nor the machine-wide setup folder exists');
          else rec.fail('setup-folders-untouched', `exists: ${touched.join(', ')}`);
        });
        rec.gap(
          'elevated-wizard-closes-original',
          'a standard account approving an administrator prompt cannot happen: UAC is disabled on the runner, so the request fails instead of prompting',
          'the transform\'s unit tests assert the elevate script stops its parent msiexec only after Start-Process succeeds (msi-project.test.ts), and MT-03 shows the failure path',
        );
        killUnder(machineLayout.root, userLayout.root);
      });
    },

    // MT-05 -------------------------------------------------------------------------------------
    async 'MT-05'() {
      await withSecondAccount(systemRunner, async (a) => {
        const setup = shareCopy(artifact('setup'), 'setup-under-test.exe');
        const msi = shareCopy(artifact('msi'), 'msi-under-test.msi');
        const setupLayout = layoutFor('setup', 'machine', setup);
        const msiLayout = layoutFor('msi', 'machine', msi);

        const hold = async (layout) => {
          const config = join(`C:\\Users\\${a.name}`, 'AppData', 'Roaming', 'throng-hand');
          const pipe = `\\\\.\\pipe\\throng-hand-hold-${process.pid}`;
          const r = await probe(a, layout.root, ['--pipe', pipe, '--spawn', layout.root, '--config-root', join(config, 'config'), '--db', join(config, 'throng.db'), '--terminal', 'keep']);
          const mine = procsUnder(layout.root).filter((p) => p.owner.toLowerCase() === a.name.toLowerCase());
          return { r, mine };
        };

        // The setup.
        runCommand(setupLayout.install.file, setupLayout.install.args, 300000);
        const held = await hold(setupLayout);
        diagnoseHelper(setupLayout.root);
        if (held.r.ok && held.mine.length > 0) rec.pass('setup-holds-files', `${a.name}'s daemon (pid ${held.r.pid}) and terminal run from ${setupLayout.root}`);
        else rec.fail('setup-holds-files', `probe ${JSON.stringify(held.r).slice(0, 200)}; processes ${held.mine.length}`);
        const heldPaths = held.mine.map((p) => p.path);
        let setupSurvivedAll;
        const survives = () => procsUnder(setupLayout.root).some((p) => p.pid === held.r.pid);

        await step('setup-interactive-refusal', async () => {
          let text = null;
          let other = null;
          const proc = await startAs(null, setup);
          const result = await driveWizard({
            label: 'setup-refusal',
            alive: async () => alive(proc.pid),
            maxPages: 20,
            onPage: async ({ text: t, controls }) => {
              if (/in use by other people/i.test(t)) {
                text = t;
                return { click: '^OK$', wait: 2000 };
              }
              if (/currently running and must be closed/i.test(t)) {
                other = t;
                return { click: '^Cancel', wait: 2000 };
              }
              if (onScopePage(controls)) return { select: choose('everyone'), click: '^Next' };
              return undefined;
            },
          });
          const code = proc.exited ? await Promise.race([proc.exited, delay(20000).then(() => null)]) : null;
          if (text && refusalNamesAccount(text, a.name) && code === 2 && survives()) {
            rec.pass('setup-interactive-refusal', `refused before changing anything, naming ${a.name}, exit 2: "${text.replace(/\s+/g, ' ').slice(0, 200)}"`);
          } else rec.fail('setup-interactive-refusal', `message ${text ? `"${text.slice(0, 160)}"` : 'none'}${other ? `; the by-name prompt showed instead: "${other.replace(/\s+/g, ' ').slice(0, 120)}"` : ''}; exit ${code}; the account's daemon ${survives() ? 'survived' : 'is GONE'}; outcome ${result.outcome}`);
        });

        await step('setup-unattended-3010', async () => {
          const code = runCommand(setupLayout.reinstall.file, setupLayout.reinstall.args, 300000);
          const pending = pendingFileRenames();
          const judged = judgePendingRenames(pending, setupLayout.root, heldPaths);
          if (code === 3010 && survives()) rec.pass('setup-unattended-3010', `exit 3010; ${a.name}'s daemon and terminal still running; ${judged.underRoot.length} replacements queued`);
          else rec.fail('setup-unattended-3010', `exit ${code}; daemon ${survives() ? 'survived' : 'GONE'}`);
          ctx.setupJudged = judged;
          ctx.setupPending = pending;
        });

        await step('setup-restart-and-launch', async () => {
          const j = ctx.setupJudged;
          if (j?.ok) {
            rec.gap('setup-restart-and-launch', 'the runner cannot be restarted mid-job', `the files queued for replacement at the next restart are only the install root's, and include the running executables: ${j.underRoot.length} entries, none outside ${setupLayout.root}`);
          } else rec.fail('setup-restart-and-launch', `pending renames are not exactly the in-use files: ${JSON.stringify(j)}; raw: ${JSON.stringify(String(ctx.setupPending ?? "").slice(0, 500))}`);
        });
        setupSurvivedAll = survives();
        clearPendingFileRenames(setupLayout.root);
        killUnder(setupLayout.root);
        runCommand(setupLayout.uninstall.file, setupLayout.uninstall.args, 300000);

        // The MSI.
        runCommand(msiLayout.install.file, msiLayout.install.args, 300000);
        const heldMsi = await hold(msiLayout);
        const msiSurvives = () => procsUnder(msiLayout.root).some((p) => p.pid === heldMsi.r.pid);

        await step('msi-interactive-refusal', async () => {
          // A removal at full UI: the in-use check runs before anything is changed.
          let text = null;
          let engineNotice = false;
          const proc = await startAs(null, 'C:\\Windows\\System32\\msiexec.exe', msiArgs(['/x', msi], 'remove'));
          await driveWizard({
            label: 'msi-refusal',
            alive: async () => alive(proc.pid),
            maxPages: 20,
            onPage: async ({ text: t }) => {
              if (/Are you sure you want to uninstall/i.test(t)) return { click: '^Yes$', wait: 3000 };
              // Windows Installer's own notice that a custom action failed, which follows the refusal.
              if (/problem with this Windows Installer package/i.test(t)) {
                engineNotice = true;
                return { click: '^OK$', wait: 3000 };
              }
              if (/in use by other people/i.test(t)) {
                text = t;
                return { click: '^OK$', wait: 3000 };
              }
              return undefined;
            },
          });
          // One condition, one notice: after ours nothing else may appear, and the installer is gone.
          await delay(5000);
          const lateWindows = (ui('windows', { title: SETUP_WINDOW }).windows ?? []).filter((w) => !w.offscreen).map((w) => w.title);
          const ended = !alive(proc.pid);
          if (text && refusalNamesAccount(text, a.name) && !engineNotice && lateWindows.length === 0 && ended && msiSurvives() && existsSync(join(msiLayout.root, 'throng.exe'))) {
            rec.pass('msi-interactive-refusal', `only a message naming ${a.name} was shown: no second notice followed, the installer ended, nothing was removed, and the account's daemon is still running`);
          } else rec.fail('msi-interactive-refusal', `message ${text ? 'shown' : 'NOT shown'}; engine notice ${engineNotice}; windows after ours ${JSON.stringify(lateWindows)}; installer ${ended ? 'ended' : 'STILL RUNNING'}; daemon ${msiSurvives() ? 'survived' : 'GONE'}`);
        });

        await step('msi-unattended-3010', async () => {
          const code = runCommand(msiLayout.reinstall.file, msiLayout.reinstall.args, 300000);
          if (code === 3010 && msiSurvives()) rec.pass('msi-unattended-3010', `exit 3010 and ${a.name}'s daemon still running (the package suppresses the restart itself)`);
          else rec.fail('msi-unattended-3010', `exit ${code}; daemon ${msiSurvives() ? 'survived' : 'GONE'}`);
        });

        const alivePids = [held.r.pid, heldMsi.r.pid].filter(Boolean);
        const stillAll = rec.toJson().steps.filter((s) => /refusal|3010/.test(s.id)).every((s) => s.status === 'passed');
        if (stillAll && setupSurvivedAll && msiSurvives()) {
          rec.pass('nothing-closed', `${a.name}'s throng and terminal (pids ${alivePids.join(', ')}) were never closed in any step`);
        } else rec.fail('nothing-closed', 'the account\'s processes did not survive every step');
        clearPendingFileRenames(msiLayout.root);
        killUnder(msiLayout.root);
      });
    },

    // MT-06 -------------------------------------------------------------------------------------
    async 'MT-06'() {
      const url = process.env.GITHUB_RUN_ID ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}` : 'the release run';
      rec.gap('coexistence-verdict', 'steps 1-5 and 8 are the release workflow\'s coexistence job, not repeated here', `the "verdict-coexistence" artifact of ${url} (installs every copy, one running throng, reattach across copies, reinstall and uninstall one)`);
      if (!options.olderZip || !existsSync(options.olderZip)) {
        rec.fail('old-copy-defers', `no previous release zip was supplied (--older-zip ${options.olderZip ?? 'missing'})`);
        rec.fail('old-copy-alone-attaches', 'no previous release zip was supplied');
        return;
      }
      const setup = shareCopy(artifact('setup'), 'setup-under-test.exe');
      const layout = layoutFor('setup', 'per-user', setup);
      runCommand(layout.install.file, layout.install.args, 300000);
      const oldRoot = 'C:\\tools\\throng-old';
      mkdirSync(oldRoot, { recursive: true });
      powershell(`Expand-Archive -LiteralPath '${psq(options.olderZip)}' -DestinationPath '${psq(oldRoot)}' -Force`, 300000);
      const oldApp = existsSync(join(oldRoot, 'throng.exe')) ? oldRoot : join(oldRoot, readDirOne(oldRoot));
      const user = process.env.USERNAME ?? 'runneradmin';

      const current = await startAs(null, join(layout.root, 'throng.exe'));
      const currentTitle = windowOf(current.pid, 90);
      await delay(6000);
      const pipe = pipeFor(user);
      const before = pipe ? await probe(null, layout.root, ['--pipe', pipe]) : { ok: false };
      shot('current-running');
      const topLevelBefore = ui('windows', { title: '.*', processId: current.pid }).windows?.length ?? 0;

      await step('old-copy-defers', async () => {
        const old = await startAs(null, join(oldApp, 'throng.exe'));
        await delay(20000);
        shot('old-started-while-current-runs');
        const oldWindows = ui('windows', { title: '.*', processId: old.pid }).windows?.filter((w) => !w.offscreen).length ?? 0;
        const oldProcs = procsUnder(oldApp).filter((p) => /^throng\.exe$/i.test(p.name));
        const notice = windowText({ title: '.*', processId: current.pid }) ?? '';
        const noNotice = !/close it first|different copy/i.test(notice);
        if (currentTitle !== null && oldWindows === 0 && noNotice) {
          rec.pass('old-copy-defers', `no second window: the previous release shows ${oldWindows} windows (${oldProcs.length} processes), and the running window shows no notice`);
        } else rec.fail('old-copy-defers', `previous release windows ${oldWindows}; running window title ${currentTitle ?? 'none'}; notice shown ${!noNotice}; current top-level windows before ${topLevelBefore}`);
      });

      const closeApps = async () => {
        // Close the apps, leaving the daemon (a detached process) running as the plan does.
        for (const p of listProcs('^throng\\.exe$')) {
          try {
            powershell(`Stop-Process -Id ${p.pid} -Force -ErrorAction SilentlyContinue`, 15000);
          } catch {
            /* gone already */
          }
        }
        await delay(4000);
      };
      const daemonUnder = (root) => procsUnder(root).filter((p) => /^node\.exe$/i.test(p.name));

      await step('old-copy-alone-attaches', async () => {
        await closeApps();
        const alone = await startAs(null, join(oldApp, 'throng.exe'));
        const title = windowOf(alone.pid, 90);
        await delay(15000);
        shot('old-alone');
        // The previous release never retires a daemon that is not its own (#192): it attaches, and the
        // newer copy's daemon and the terminal in it are untouched. The newer daemon was probed above.
        const stillThere = before.ok && alive(before.pid);
        const ownDaemons = daemonUnder(oldApp);
        if (title !== null && stillThere && ownDaemons.length === 0) {
          rec.pass('old-copy-alone-attaches', `the previous release started ("${title}") and attached: the newer daemon (pid ${before.pid}) and its terminal are still running, and the previous release started no daemon of its own`);
        } else rec.fail('old-copy-alone-attaches', `window ${title ?? 'none'}; newer daemon ${before.ok ? (stillThere ? `pid ${before.pid} still running` : 'GONE') : 'was never probed'}; daemons started from ${oldApp}: ${ownDaemons.length}`);
      });
      killUnder(oldApp);

      // FR-021a's real case: another CURRENT copy whose build differs. It is the installed copy
      // duplicated elsewhere with its build id changed, started alone against the running daemon.
      await step('different-build-copy-replaces-daemon', async () => {
        await closeApps();
        const otherRoot = 'C:\\tools\\throng-other';
        powershell(`robocopy '${psq(layout.root)}' '${psq(otherRoot)}' /E /NFL /NDL /NJH /NJS /NP | Out-Null; $LASTEXITCODE -lt 8`, 300000);
        const idFile = join(otherRoot, 'resources', 'app', 'packages', 'daemon', 'dist', 'BUILD_ID');
        const original = existsSync(idFile) ? readFileSync(idFile, 'utf8').trim() : null;
        writeFileSync(idFile, 'ffffffffffffffff\n');
        const target = before.ok ? before.pid : null;
        if (target === null || !alive(target)) return rec.fail('different-build-copy-replaces-daemon', `no running daemon to replace (probe ${JSON.stringify(before).slice(0, 120)})`);
        const other = await startAs(null, join(otherRoot, 'throng.exe'));
        const title = windowOf(other.pid, 90);
        for (let i = 0; i < 20 && alive(target); i++) await delay(3000);
        await delay(3000);
        shot('different-build');
        const replaced = !alive(target);
        const newDaemons = daemonUnder(otherRoot);
        if (title !== null && replaced && newDaemons.length > 0) {
          rec.pass('different-build-copy-replaces-daemon', `a copy with build ${'ffffffffffffffff'} (installed copy's is ${original}) started ("${title}"); the running daemon (pid ${target}) was replaced by its own (pid ${newDaemons[0].pid}, ${newDaemons[0].path})`);
        } else rec.fail('different-build-copy-replaces-daemon', `window ${title ?? 'none'}; previous daemon pid ${target} ${replaced ? 'gone' : 'STILL RUNNING'}; daemons from the other copy: ${newDaemons.length}`);
        killUnder(otherRoot);
      });
      killUnder(layout.root);
    },

    // MT-07 -------------------------------------------------------------------------------------
    async 'MT-07'() {
      await withSecondAccount(systemRunner, async (a) => {
        const setup = shareCopy(artifact('setup'), 'setup-under-test.exe');
        const layout = layoutFor('setup', 'machine', setup);
        runCommand(layout.install.file, layout.install.args, 300000);
        const adminData = join(process.env.APPDATA ?? '', 'throng');
        const theirData = join(`C:\\Users\\${a.name}`, 'AppData', 'Roaming', 'throng');

        // Data in each account's REAL data folder: the daemon is started with no store paths given.
        const makeData = async () => {
          const mine = await probe(null, layout.root, ['--pipe', `\\\\.\\pipe\\throng-hand-admin-${process.pid}`, '--spawn', layout.root, '--project', 'Mine']);
          const theirs = await probe(a, layout.root, ['--pipe', `\\\\.\\pipe\\throng-hand-a-${process.pid}`, '--spawn', layout.root, '--project', 'Theirs']);
          await delay(2000);
          killUnder(layout.root);
          await delay(3000);
          return { mine, theirs };
        };
        const made = await makeData();
        const bothExist = existsSync(join(adminData, 'throng.db')) && existsSync(join(theirData, 'throng.db'));
        if (made.mine.ok !== false && made.mine.projectNames?.includes('Mine') && made.theirs.projectNames?.includes('Theirs') && bothExist) {
          rec.pass('both-accounts-have-data', `Mine is in ${adminData}; Theirs is in ${theirData}`);
        } else rec.fail('both-accounts-have-data', `admin ${JSON.stringify(made.mine).slice(0, 160)}; ${a.name} ${JSON.stringify(made.theirs).slice(0, 160)}; stores exist ${bothExist}`);

        await step('gui-uninstall-deletes-own-data-only', async () => {
          let asked = null;
          let chose = false;
          const proc = await startAs(null, layout.uninstall.file);
          await driveWizard({
            label: 'uninstall-gui',
            alive: async () => alive(proc.pid),
            maxPages: 30,
            onPage: async ({ text, controls }) => {
              if (/Also delete that data now|also delete/i.test(text)) {
                asked = text;
                // This is a Yes/No question, which is the "also delete my projects and settings" choice.
                return { click: '^Yes$', wait: 3000 };
              }
              if (onScopePage(controls) && !chose) {
                chose = true;
                return { select: choose('everyone'), click: '^Next' };
              }
              return undefined;
            },
          });
          await delay(5000);
          const adminGone = !existsSync(adminData);
          const theirsKept = existsSync(join(theirData, 'throng.db'));
          // Reinstall and read back, as the plan's step 4 does.
          runCommand(layout.install.file, layout.install.args, 300000);
          const reAdmin = await probe(null, layout.root, ['--pipe', `\\\\.\\pipe\\throng-hand-admin2-${process.pid}`, '--spawn', layout.root, '--list-projects']);
          const reTheirs = await probe(a, layout.root, ['--pipe', `\\\\.\\pipe\\throng-hand-a2-${process.pid}`, '--spawn', layout.root, '--list-projects']);
          killUnder(layout.root);
          const mineGone = !(reAdmin.projectNames ?? []).includes('Mine');
          const theirsListed = (reTheirs.projectNames ?? []).includes('Theirs');
          if (asked && adminGone && theirsKept && mineGone && theirsListed) {
            rec.pass('gui-uninstall-deletes-own-data-only', `answered Yes to "also delete": ${adminData} gone and "Mine" not listed after a reinstall; ${a.name}'s "Theirs" still listed`);
          } else rec.fail('gui-uninstall-deletes-own-data-only', `asked ${Boolean(asked)}; admin data gone ${adminGone}; theirs kept ${theirsKept}; Mine gone ${mineGone}; Theirs listed ${theirsListed}`);
        });

        await step('unattended-uninstall-deletes-nothing', async () => {
          // Both accounts have a store again after the reinstall's probes.
          const before = [adminData, theirData].map((d) => existsSync(join(d, 'throng.db')));
          const code = runCommand(layout.uninstall.file, layout.uninstall.args, 300000);
          await delay(3000);
          const after = [adminData, theirData].map((d) => existsSync(join(d, 'throng.db')));
          if (before.every(Boolean) && after.every(Boolean)) rec.pass('unattended-uninstall-deletes-nothing', `exit ${code}; both accounts' stores are still there`);
          else rec.fail('unattended-uninstall-deletes-nothing', `exit ${code}; stores before ${before}, after ${after}`);
        });
      });
    },

    // MT-08 -------------------------------------------------------------------------------------
    async 'MT-08'() {
      if (!options.olderSetup || !existsSync(options.olderSetup)) {
        for (const s of GROUPS['MT-08'].steps) rec.fail(s.id, `no older setup was supplied (--older-setup ${options.olderSetup ?? 'missing'})`);
        return;
      }
      const current = shareCopy(artifact('setup'), 'setup-under-test.exe');
      const older = shareCopy(options.olderSetup, 'setup-older.exe');
      const machine = layoutFor('setup', 'machine', current);
      const perUser = layoutFor('setup', 'per-user', older);
      runCommand(machine.install.file, machine.install.args, 300000);
      const manifestVersion = (root) => {
        try {
          return JSON.parse(readFileSync(join(root, 'resources', 'app', 'package.json'), 'utf8')).version;
        } catch {
          return null;
        }
      };
      const installedBefore = manifestVersion(machine.root);

      await step('older-setup-refuses', async () => {
        let text = null;
        const proc = await startAs(null, older);
        await driveWizard({
          label: 'older-setup-everyone',
          alive: async () => alive(proc.pid),
          maxPages: 20,
          onPage: async ({ text: t, controls }) => {
            if (/newer version of throng/i.test(t)) {
              text = t;
              return { click: '^OK$', wait: 2000 };
            }
            if (onScopePage(controls)) return { select: choose('everyone'), click: '^Next' };
            return undefined;
          },
        });
        const code = proc.exited ? await Promise.race([proc.exited, delay(20000).then(() => null)]) : null;
        if (text && code === 2) rec.pass('older-setup-refuses', `refused, saying a newer version is installed, exit 2: "${text.replace(/\s+/g, ' ').slice(0, 160)}"`);
        else rec.fail('older-setup-refuses', `message ${text ? 'shown' : 'NOT shown'}; exit ${code}`);
      });

      if (existsSync(join(machine.root, 'throng.exe')) && manifestVersion(machine.root) === installedBefore) {
        rec.pass('refusal-removes-nothing', `this build (${installedBefore}) is still installed in ${machine.root}`);
      } else rec.fail('refusal-removes-nothing', 'the installed copy changed or is gone');

      await step('older-setup-installs-alongside', async () => {
        let chose = false;
        const proc = await startAs(null, older);
        await driveWizard({
          label: 'older-setup-only-me',
          alive: async () => alive(proc.pid),
          onPage: async ({ controls }) => {
            if (onScopePage(controls) && !chose) {
              chose = true;
              return { select: choose('me'), click: '^Next' };
            }
            if (controls.some((c) => c.type === 'CheckBox' && /run|launch/i.test(c.name))) return { click: '^Finish' };
            return undefined;
          },
        });
        await delay(5000);
        const both = existsSync(join(machine.root, 'throng.exe')) && existsSync(join(perUser.root, 'throng.exe'));
        if (both) rec.pass('older-setup-installs-alongside', `both copies are installed: ${machine.root} and ${perUser.root}`);
        else rec.fail('older-setup-installs-alongside', `machine copy ${existsSync(join(machine.root, 'throng.exe'))}; per-user copy ${existsSync(join(perUser.root, 'throng.exe'))}`);
      });

      await step('each-copy-reports-its-version', async () => {
        // Each copy launched ALONE, and asked what the running app reports (app.getVersion(), which
        // About throng shows) — not a manifest on disk.
        killUnder(machine.root, perUser.root);
        await delay(3000);
        const ask = (root) => {
          try {
            const out = execFileSync(process.execPath, [join(here, 'app-version-probe.mjs'), join(root, 'throng.exe')], { encoding: 'utf8', timeout: 120000, windowsHide: false });
            return JSON.parse(out.trim().split(/\r?\n/).pop());
          } catch (error) {
            try {
              return JSON.parse(String(error.stdout ?? '').trim().split(/\r?\n/).pop());
            } catch {
              return { ok: false, error: error.message };
            }
          }
        };
        const current = ask(machine.root);
        killUnder(machine.root);
        await delay(3000);
        const older = ask(perUser.root);
        killUnder(perUser.root);
        if (current.ok && older.ok && current.version === version && older.version === '0.9.0') {
          rec.pass('each-copy-reports-its-version', `launched alone, the all-users copy reports ${current.version} and the per-user copy reports ${older.version}`);
        } else rec.fail('each-copy-reports-its-version', `all-users copy: ${JSON.stringify(current).slice(0, 200)}; per-user copy: ${JSON.stringify(older).slice(0, 200)}`);
      });
    },
  };

  const ctx = {};
  let failure = null;
  try {
    if (options.group === 'MT-06') {
      await groups[options.group]();
    } else {
      await withInstallerPolicyEnabled(() => groups[options.group](), log);
    }
  } catch (error) {
    failure = error instanceof Error ? (error.stack ?? error.message) : String(error);
    log(`the group stopped: ${failure}`);
  } finally {
    shot('final-screen');
    try {
      // Keep the installers' own logs: the upload step takes only files under the workspace.
      const keep = resolve('installer-logs');
      mkdirSync(keep, { recursive: true });
      for (const name of readdirSync(sharedDir).filter((n) => /\.log$/i.test(n))) copyFileSync(join(sharedDir, name), join(keep, name));
      // The setup's own record of what its in-use helper said (written by packaging/installer.nsh).
      if (existsSync(SETUP_LOG)) copyFileSync(SETUP_LOG, join(keep, `${options.group}-throng-setup.log`));
    } catch (error) {
      log(`could not keep the installer logs: ${error.message}`);
    }
    try {
      removeSharedDir(sharedDir);
    } catch (error) {
      log(`could not remove the shared folder: ${error.message}`);
    }
  }

  const report = { ...rec.toJson(), ...(failure ? { harnessError: failure.split('\n')[0] } : {}), screenshots: shots.map((p) => p.replace(`${resolve(options.outDir)}\\`, '')) };
  const file = resolve(options.outDir, `hand-test-${options.group}.json`);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  return report.passed ? 0 : 1;
}

function readDirOne(dir) {
  const out = powershell(`(Get-ChildItem -LiteralPath '${psq(dir)}' -Directory | Select-Object -First 1).Name`).trim();
  return out;
}

// ---------------------------------------------------------------------------------------------

if (process.argv[1] && fileURLToPath(import.meta.url).toLowerCase() === resolve(process.argv[1]).toLowerCase()) {
  const parsed = parseHandTestArgs(process.argv.slice(2));
  if (!parsed.ok) {
    console.error(`[verify-hand-tests] ${parsed.message}`);
    process.exit(2);
  }
  if (parsed.mode === 'list') {
    console.log(renderList());
    process.exit(0);
  }
  process.exit(await runGroup(parsed));
}
