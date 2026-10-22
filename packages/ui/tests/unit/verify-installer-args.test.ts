import { describe, expect, it } from 'vitest';

import { combinationsOf, declareArtifactSet } from '@throng/core';

// @ts-expect-error — plain-JS build/CI script, imported for its pure decisions.
import { bareInstallRefused, decodeInstallerLog, INSTALLER_POLICY_KEY, installLayout, mentionsInstallRoot, parseRegDword, parseVerifyArgs, scopeDiagnosticLines, uninstallRegistryRoots } from '../../../../scripts/verify-installer-args.mjs';

// Rehearsal 8: the MSI's in-use reinstall exited 3010 with the account's daemon intact, yet the check
// read "pending replacements NOT registered" — Windows Installer can name the files by 8.3 path.
describe('pending replacements under an install root (058 FR-016a)', () => {
  const root = 'C:\\Program Files\\throng MSI';
  it('matches the long path, with or without the \\??\\ prefix, in any case', () => {
    expect(mentionsInstallRoot(['\\??\\C:\\PROGRAM FILES\\throng MSI\\throng.exe', ''], [root])).toBe(true);
  });
  it('matches the short path when it is one of the roots', () => {
    expect(mentionsInstallRoot(['\\??\\C:\\Config.Msi\\1a2b.rbf', '\\??\\C:\\PROGRA~1\\THRONG~1\\node.exe'], [root, 'C:\\PROGRA~1\\THRONG~1'])).toBe(true);
  });
  // Rehearsal 9, verbatim: the setup's renamed-aside files carry a `*1` delete marker before `\??\`.
  it('reads entries carrying the *N marker', () => {
    expect(mentionsInstallRoot(['*1\\??\\C:\\Program Files\\throng\\resources\\runtime\\node.exe.throng-old', ''], ['C:\\Program Files\\throng'])).toBe(true);
  });
  // Rehearsal 9, verbatim: the MSI moves in-use files into Config.Msi and deletes them at restart.
  it('matches the rollback files Windows Installer leaves in Config.Msi when it is one of the roots', () => {
    const pending = ['*1\\??\\C:\\Config.Msi\\1380a7.rbf', '', '*1\\??\\C:\\Config.Msi\\138504.rbf', '\r', ''];
    expect(mentionsInstallRoot(pending, [root])).toBe(false);
    expect(mentionsInstallRoot(pending, [root, 'C:\\Config.Msi'])).toBe(true);
  });
  it('does not match a sibling folder that merely starts the same way', () => {
    expect(mentionsInstallRoot(['\\??\\C:\\Program Files\\throng MSI old\\x.dll', ''], [root])).toBe(false);
  });
});
// @ts-expect-error — plain-JS build/CI script, imported for its pure orchestration.
import { buildRunAsScript, randomPassword, systemRunner, withSecondAccount } from '../../../../scripts/second-account.mjs';
// @ts-expect-error — plain-JS build/CI script, imported for its pure decision.
import { findMainProcess, integrityName, judgeNotElevated } from '../../../../scripts/process-integrity.mjs';
// @ts-expect-error — plain-JS build/CI script, imported for its pure decision.
import { watchdogVerdict } from '../../../../scripts/verify-watchdog.mjs';
// @ts-expect-error — plain-JS build/CI script, imported for its pure model.
import { accountOf, createRecorder, GROUPS, judgePendingRenames, parseHandTestArgs, refusalNamesAccount, renderList } from '../../../../scripts/hand-tests-model.mjs';
// @ts-expect-error — plain-JS build/CI script, imported for its pure argument builder.
import { uiArgs } from '../../../../scripts/ui-driver.mjs';

/**
 * 058 FR-028/FR-029 — the verification harness runs once per artifact-and-scope combination, on a
 * clean runner, with a genuine standard account created and removed around the steps that need one.
 * What a run actually does to a machine is proved by the release matrix; what these prove is the part
 * that decides it: which arguments are legal, where each combination lives, and that the second
 * account is ALWAYS deleted — a leaked account with a known password on a developer machine is the
 * failure worth a test.
 *
 * Layer: unit — pure functions and an injected command runner; nothing here touches the machine.
 */

const VERSION = '1.2.3';

describe('verify-installer arguments (058 FR-028)', () => {
  it('requires --scope for the setup and the MSI, exit 2 naming the valid scopes', () => {
    for (const role of ['setup', 'msi']) {
      const r = parseVerifyArgs(['x.exe', '--role', role]);
      expect(r.ok).toBe(false);
      expect(r.code).toBe(2);
      expect(r.message).toContain(role);
      expect(r.message).toContain('per-user');
      expect(r.message).toContain('machine');
    }
  });

  it('refuses --scope for portable and archive, naming that they have none', () => {
    for (const role of ['portable', 'archive']) {
      const r = parseVerifyArgs(['x.zip', '--role', role, '--scope', 'machine']);
      expect(r.ok).toBe(false);
      expect(r.code).toBe(2);
      expect(r.message).toContain(role);
      expect(r.message).toMatch(/no install scope|none/i);
    }
  });

  it('refuses a scope the role does not offer, and an unknown role', () => {
    expect(parseVerifyArgs(['x.exe', '--role', 'setup', '--scope', 'everyone']).code).toBe(2);
    const unknown = parseVerifyArgs(['x.exe', '--role', 'nonesuch']);
    expect(unknown.code).toBe(2);
    expect(unknown.message).toMatch(/setup/);
  });

  it('resolves the combination id for each legal pair, matching the declared set', () => {
    const wanted = combinationsOf(declareArtifactSet(VERSION));
    for (const c of wanted) {
      const argv = ['x', '--role', c.role, ...(c.scope ? ['--scope', c.scope] : [])];
      const r = parseVerifyArgs(argv);
      expect(r.ok).toBe(true);
      expect(r.combination).toBe(c.id);
    }
  });

  it('writes the verdict to the combination’s own file by default, and honours --verdict-out', () => {
    const byDefault = parseVerifyArgs(['x.msi', '--role', 'msi', '--scope', 'machine']);
    expect(byDefault.verdictOut).toMatch(/verification-verdict-msi-machine\.json$/);
    const given = parseVerifyArgs(['x.msi', '--role', 'msi', '--scope', 'per-user', '--verdict-out', 'out.json']);
    expect(given.verdictOut).toBe('out.json');
  });

  it('needs the artifact path in single mode, exit 2', () => {
    expect(parseVerifyArgs(['--role', 'archive']).code).toBe(2);
  });

  it('carries the other flags through unchanged', () => {
    const r = parseVerifyArgs(['x.zip', '--role', 'archive', '--expected-version', VERSION, '--keep-residue', '--expected-sha', 'ab']);
    expect(r).toMatchObject({ artifact: 'x.zip', expectedVersion: VERSION, keepResidue: true, expectedSha: 'ab' });
  });

  describe('--coexistence', () => {
    it('needs no artifact: it takes the directory holding all of them', () => {
      const r = parseVerifyArgs(['--coexistence', '--dir', 'dist/installer', '--expected-version', VERSION]);
      expect(r).toMatchObject({ ok: true, mode: 'coexistence', dir: 'dist/installer', expectedVersion: VERSION });
    });

    it('writes verification-verdict-coexistence.json by default', () => {
      expect(parseVerifyArgs(['--coexistence']).verdictOut).toMatch(/verification-verdict-coexistence\.json$/);
    });

    it('refuses --role and --scope, which belong to one combination', () => {
      expect(parseVerifyArgs(['--coexistence', '--role', 'setup']).code).toBe(2);
      expect(parseVerifyArgs(['--coexistence', '--scope', 'machine']).code).toBe(2);
    });

    it('refuses a dirty profile unless told otherwise', () => {
      expect(parseVerifyArgs(['--coexistence']).allowDirtyProfile).toBe(false);
      expect(parseVerifyArgs(['--coexistence', '--allow-dirty-profile']).allowDirtyProfile).toBe(true);
    });
  });
});

describe('where each combination lives (058 research D4)', () => {
  const env = {
    LOCALAPPDATA: 'C:\\Users\\run\\AppData\\Local',
    APPDATA: 'C:\\Users\\run\\AppData\\Roaming',
    ProgramFiles: 'C:\\Program Files',
    ProgramData: 'C:\\ProgramData',
  };
  const layout = (role: string, scope: string | null) =>
    installLayout({ role, scope, version: VERSION, artifactPath: `C:\\a\\throng.${role}`, env });

  it('the per-user setup keeps its folder and says per-user in its name', () => {
    const l = layout('setup', 'per-user');
    expect(l.root).toBe('C:\\Users\\run\\AppData\\Local\\Programs\\throng');
    expect(l.install.args).toEqual(['/S']);
    expect(l.displayName).toBe(`throng ${VERSION} (per-user)`);
    expect(l.shortcutNames).toContain('throng (per-user).lnk');
    expect(l.startMenuDir).toContain('AppData\\Roaming');
    expect(l.hive).toBe('HKCU');
  });

  it('the machine-wide setup goes to Program Files, asks for /allusers, and uses the common Start menu', () => {
    const l = layout('setup', 'machine');
    expect(l.root).toBe('C:\\Program Files\\throng');
    expect(l.install.args).toEqual(['/S', '/allusers']);
    expect(l.uninstall.args).toEqual(['/S', '/allusers']);
    expect(l.displayName).toBe(`throng ${VERSION} (all users)`);
    expect(l.startMenuDir).toContain('ProgramData');
    expect(l.hive).toBe('HKLM');
  });

  it('the MSI has its own folders and labels, and picks its scope with the standard properties', () => {
    const user = layout('msi', 'per-user');
    const machine = layout('msi', 'machine');
    expect(user.root).toBe('C:\\Users\\run\\AppData\\Local\\Programs\\throng MSI');
    expect(machine.root).toBe('C:\\Program Files\\throng MSI');
    expect(user.install.file).toMatch(/msiexec/i);
    expect(user.install.args).toEqual(expect.arrayContaining(['/qn', 'MSIINSTALLPERUSER=1']));
    expect(machine.install.args).toEqual(expect.arrayContaining(['/qn', 'ALLUSERS=1']));
    expect(machine.uninstall.args.slice(0, 1)).toEqual(['/x']);
    expect(user.displayName).toBe('throng (MSI, per-user)');
    expect(machine.displayName).toBe('throng (MSI, all users)');
    expect(machine.shortcutNames).toContain('throng MSI (all users).lnk');
  });

  it('accepts 3010 (restart required) as an MSI success, and only 0 for the setup', () => {
    expect(layout('msi', 'machine').install.okCodes).toEqual([0, 3010]);
    expect(layout('setup', 'machine').install.okCodes).toEqual([0]);
  });

  it('reinstalls the MSI in a way that forces file replacement: a plain /i on an installed product is maintenance', () => {
    const { args } = layout('msi', 'machine').reinstall;
    expect(args).toEqual(expect.arrayContaining(['/qn', 'REINSTALL=ALL', 'REINSTALLMODE=amus', 'ALLUSERS=1']));
    // a = all files reinstalled whatever their version; without it nothing is replaced, so nothing is
    // ever in use and 3010 can never be returned.
    expect(args.join(' ')).toMatch(/REINSTALLMODE=amus/);
  });

  it('reinstalls the setup exactly as it installs it, and accepts 3010 from either', () => {
    expect(layout('setup', 'machine').reinstall.args).toEqual(layout('setup', 'machine').install.args);
    expect(layout('msi', 'machine').reinstall.okCodes).toEqual([0, 3010]);
  });

  it('has no layout for a format that installs nothing', () => {
    expect(layout('portable', null)).toBeNull();
    expect(layout('archive', null)).toBeNull();
  });
});

describe('the second, standard account (058 FR-029, research D11)', () => {
  /** A runner that records every command and can be told to fail one. */
  function recorder(failOn?: RegExp) {
    const calls: string[] = [];
    const run = async (command: string, args: string[]) => {
      const decoded = args.map((a, i) => (args[i - 1] === '-EncodedCommand' ? Buffer.from(a, 'base64').toString('utf16le') : a));
      const line = [command, ...decoded].join(' ');
      calls.push(line);
      if (failOn?.test(line)) return { code: 1, stdout: '', stderr: 'boom' };
      return { code: 0, stdout: '', stderr: '' };
    };
    return { calls, run };
  }

  it('creates the account, runs the work with it, then deletes the account and its profile', async () => {
    const { calls, run } = recorder();
    const result = await withSecondAccount(run, async (account: { name: string }) => {
      calls.push(`WORK ${account.name}`);
      return 42;
    });
    expect(result).toBe(42);
    const create = calls.findIndex((c) => /net(\.exe)? user .* \/add/.test(c));
    const work = calls.findIndex((c) => c.startsWith('WORK'));
    const remove = calls.findIndex((c) => /net(\.exe)? user .* \/delete/.test(c));
    const profile = calls.findIndex((c) => /Win32_UserProfile/.test(c));
    expect(create).toBeGreaterThanOrEqual(0);
    expect(create).toBeLessThan(work);
    expect(work).toBeLessThan(remove);
    expect(remove).toBeLessThan(profile);
  });

  it('deletes the account when the work throws, and lets the error through', async () => {
    const { calls, run } = recorder();
    await expect(
      withSecondAccount(run, async () => {
        throw new Error('the step failed');
      }),
    ).rejects.toThrow('the step failed');
    expect(calls.some((c) => /\/delete/.test(c))).toBe(true);
    expect(calls.some((c) => /Win32_UserProfile/.test(c))).toBe(true);
  });

  it('still removes the profile when deleting the account reports a failure, and does not mask the work’s result', async () => {
    const { calls, run } = recorder(/\/delete/);
    const warnings: string[] = [];
    const result = await withSecondAccount(run, async () => 'done', { onWarning: (m: string) => warnings.push(m) });
    expect(result).toBe('done');
    expect(calls.some((c) => /Win32_UserProfile/.test(c))).toBe(true);
    expect(warnings.join('\n')).toMatch(/delete/i);
  });

  it('records a failure to create as a failure, with the reason, and never runs the work', async () => {
    const { run } = recorder(/\/add/);
    let ran = false;
    await expect(
      withSecondAccount(run, async () => {
        ran = true;
      }),
    ).rejects.toThrow(/could not create.*boom|boom/i);
    expect(ran).toBe(false);
  });

  it('gives the account a name within the 20-character limit and a password it can log on with', async () => {
    const seen: { name: string; password: string }[] = [];
    await withSecondAccount(recorder().run, async (account: { name: string; password: string }) => {
      seen.push(account);
    });
    expect(seen[0].name.length).toBeLessThanOrEqual(20);
    expect(seen[0].password.length).toBeGreaterThanOrEqual(16);
    // Windows' complexity rule: three of upper, lower, digit, symbol.
    expect(seen[0].password).toMatch(/[A-Z]/);
    expect(seen[0].password).toMatch(/[a-z]/);
    expect(seen[0].password).toMatch(/\d/);
  });

  it('never repeats a password', () => {
    expect(randomPassword()).not.toBe(randomPassword());
  });

  it('hands the password to PowerShell through the environment, never inside the script text', () => {
    const script = buildRunAsScript({ file: 'C:\\x\\tool.exe', args: ['/S'], cwd: 'C:\\Users\\Public' });
    expect(script).toContain('$env:THRONG_VERIFY_PASSWORD');
    expect(script).toContain('Credential = $credential');
    expect(script).not.toMatch(/ConvertTo-SecureString\s+'/);
  });

  // `Start-Process -Wait` waits for the process TREE, so a probe that leaves the account's daemon
  // running (as it must) never returned: the fourth rehearsal timed out at exit -1.
  it('waits for the program itself, not for the daemon it leaves running', () => {
    const script = buildRunAsScript({ file: 'C:\\x\\node.exe', args: ['probe.mjs'] });
    expect(script).not.toMatch(/Wait\s*=\s*\$true/);
    expect(script).toContain('$process.WaitForExit()');
  });

  // Start-Process joins an -ArgumentList ARRAY with bare spaces, so `C:\Program Files\throng` reached
  // the second account's runtime as `C:\Program` — the first rehearsal's second-account failure.
  it('passes the arguments as one command line, each quoted so a path with spaces stays one argument', () => {
    const script = buildRunAsScript({
      file: 'C:\\x\\node.exe',
      args: ['probe.mjs', '--spawn', 'C:\\Program Files\\throng', '--empty', '', 'say "hi"', 'C:\\dir with space\\'],
    });
    expect(script).toContain(
      `$start.ArgumentList = 'probe.mjs --spawn "C:\\Program Files\\throng" --empty "" "say \\"hi\\"" "C:\\dir with space\\\\"'`,
    );
  });
});

describe('process integrity (058 FR-007, FR-029)', () => {
  it('names the levels the checks care about', () => {
    expect(integrityName(0x2000)).toBe('medium');
    expect(integrityName(0x3000)).toBe('high');
    expect(integrityName(0x4000)).toBe('system');
    expect(integrityName(0x1000)).toBe('low');
    expect(integrityName(-1)).toBe('unknown');
  });
});

describe('the not-elevated-launch decision (058 FR-007)', () => {
  const MEDIUM = 0x2000;
  const HIGH = 0x3000;

  it('judges only the main process: the throng.exe whose parent is not a throng.exe', () => {
    const procs = [
      { pid: 7900, ppid: 2000, name: 'throng.exe' },
      { pid: 2600, ppid: 7900, name: 'throng.exe' },
      { pid: 1064, ppid: 7900, name: 'throng.exe' },
      { pid: 1284, ppid: 7900, name: 'throng.exe' },
    ];
    expect(findMainProcess(procs)?.pid).toBe(7900);
    expect(findMainProcess([])).toBeUndefined();
  });

  it('passes when the main process is at medium and the desktop is medium', () => {
    expect(judgeNotElevated({ mainLevel: MEDIUM, explorerLevel: MEDIUM }).status).toBe('passed');
  });

  it('is unproven, with the reason, when the desktop itself is above medium (a hosted runner has UAC off)', () => {
    const v = judgeNotElevated({ mainLevel: MEDIUM, explorerLevel: HIGH });
    expect(v.status).toBe('unproven');
    expect(v.reason).toMatch(/explorer/i);
    expect(judgeNotElevated({ mainLevel: HIGH, explorerLevel: HIGH }).status).toBe('unproven');
  });

  it('fails when the main process runs above the desktop that started it', () => {
    expect(judgeNotElevated({ mainLevel: HIGH, explorerLevel: MEDIUM }).status).toBe('failed');
    expect(judgeNotElevated({ mainLevel: 0x4000, explorerLevel: HIGH }).status).toBe('failed');
  });

  it('fails when the main process is not at medium on a medium desktop, or cannot be read', () => {
    expect(judgeNotElevated({ mainLevel: 0x1000, explorerLevel: MEDIUM }).status).toBe('failed');
    expect(judgeNotElevated({ mainLevel: -1, explorerLevel: MEDIUM }).status).toBe('failed');
    expect(judgeNotElevated({ mainLevel: -1, explorerLevel: HIGH }).status).toBe('failed');
  });

  it('passes a medium main process when the desktop level cannot be read', () => {
    expect(judgeNotElevated({ mainLevel: MEDIUM, explorerLevel: -1 }).status).toBe('passed');
  });
});

describe('the MSI harness names its scope explicitly, whoever runs it (058 FR-003a)', () => {
  const layout = (role: string, scope: string | null) =>
    installLayout({ role, scope, version: VERSION, artifactPath: `C:\\a\\throng.${role}`, env: { SystemRoot: 'C:\\Windows' } });

  it('passes the standard scope property on install, reinstall and uninstall, so an elevated runner cannot turn per-user into machine-wide', () => {
    // Windows Installer reads the install context from the command line, so these are the switches.
    for (const [scope, property] of [['per-user', 'MSIINSTALLPERUSER=1'], ['machine', 'ALLUSERS=1']] as const) {
      const l = layout('msi', scope);
      for (const command of [l.install, l.reinstall, l.uninstall]) {
        expect(command.args, `${scope} ${command.args[0]}`).toContain(property);
      }
    }
  });

  it('never uses THRONG_SCOPE, which does not exist, and keeps the per-user and machine properties apart', () => {
    for (const scope of ['per-user', 'machine'] as const) {
      const l = layout('msi', scope);
      for (const command of [l.install, l.reinstall, l.uninstall, l.bareInstall]) expect(command.args.join(' ')).not.toContain('THRONG_SCOPE');
    }
    expect(layout('msi', 'per-user').install.args.join(' ')).not.toContain('ALLUSERS');
    expect(layout('msi', 'machine').install.args.join(' ')).not.toContain('MSIINSTALLPERUSER');
  });

  it('offers a bare install with no scope at all, to prove the non-elevated default (FR-003a)', () => {
    const bare = layout('msi', 'per-user').bareInstall;
    expect(bare.args.slice(0, 3)).toEqual(['/i', 'C:\\a\\throng.msi', '/qn']);
    expect(bare.args.join(' ')).not.toMatch(/ALLUSERS|MSIINSTALLPERUSER|THRONG_SCOPE/);
  });

  it('writes a verbose log for each MSI command inside the workspace, which is all the upload step will take', () => {
    // The first rehearsal wrote them to RUNNER_TEMP and the upload failed: "The rootDirectory … is not a
    // parent directory of the file".
    const l = installLayout({
      role: 'msi', scope: 'per-user', version: VERSION, artifactPath: 'C:\\a\\throng.msi',
      env: { SystemRoot: 'C:\\Windows', GITHUB_WORKSPACE: 'D:\\a\\throng\\throng', RUNNER_TEMP: 'D:\\a\\_temp' },
    });
    for (const command of [l.install, l.reinstall, l.uninstall, l.bareInstall]) {
      const at = command.args.indexOf('/l*v');
      expect(at, command.args.join(' ')).toBeGreaterThan(-1);
      expect(command.args[at + 1]).toMatch(/^D:\\a\\throng\\throng\\installer-logs\\throng-msi-.*\.log$/);
    }
  });

  it('picks out the log lines that explain the chosen context', () => {
    const log = [
      'MSI (s) (A4:B0) [20:08:44:123]: PROPERTY CHANGE: Adding ALLUSERS property. Its value is \'1\'.',
      'MSI (s) (A4:B0) [20:08:44:124]: Doing action: CostInitialize',
      'Property(S): APPLICATIONFOLDER = C:\\Program Files\\throng MSI\\',
      'Property(S): MsiRunningElevated = 1',
      'Property(S): Privileged = 1',
      'Property(S): ProductName = throng',
    ].join('\n');
    const lines = scopeDiagnosticLines(log);
    expect(lines).toHaveLength(4);
    expect(lines.join('\n')).not.toContain('ProductName');
  });

  it('decodes a verbose log by its byte-order mark: msiexec writes UTF-16LE', () => {
    const text = 'Property(S): ALLUSERS = 1\r\nProperty(S): ProductName = throng';
    const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]);
    expect(decodeInstallerLog(utf16)).toBe(text);
    expect(scopeDiagnosticLines(decodeInstallerLog(utf16))).toHaveLength(1);
    expect(decodeInstallerLog(Buffer.from(text, 'utf8'))).toBe(text);
    // read as UTF-8 it matches nothing, which is how a full log once reported "0 scope lines"
    expect(scopeDiagnosticLines(utf16.toString('utf8'))).toHaveLength(0);
  });
});

describe('where a per-user MSI is registered (058 FR-017b)', () => {
  it('looks for a per-user MSI under Windows Installer’s own per-user product list, not only HKCU’s Uninstall key', () => {
    const roots = uninstallRegistryRoots('HKCU', true);
    expect(roots.some((r: string) => /HKEY_LOCAL_MACHINE.*Installer\\UserData\\\$sid\\Products\\\*\\InstallProperties$/.test(r))).toBe(true);
    expect(roots.some((r: string) => /HKEY_CURRENT_USER.*Uninstall/.test(r))).toBe(true);
  });

  it('leaves the setup’s per-user lookup and both machine lookups as they were', () => {
    expect(uninstallRegistryRoots('HKCU', false)).toHaveLength(1);
    expect(uninstallRegistryRoots('HKLM', true).every((r: string) => /Uninstall\\\*$/.test(r))).toBe(true);
    expect(uninstallRegistryRoots('HKLM', true)).toHaveLength(2);
  });

  it('marks the MSI layouts, so the harness knows to look there', () => {
    const l = installLayout({ role: 'msi', scope: 'per-user', version: VERSION, artifactPath: 'C:\\a\\x.msi', env: {} });
    expect(l.isMsi).toBe(true);
    expect(installLayout({ role: 'setup', scope: 'per-user', version: VERSION, artifactPath: 'C:\\a\\x.exe', env: {} }).isMsi).toBeUndefined();
  });
});

describe('a bare unattended install by a standard account (058 FR-010)', () => {
  it('is refused only by a failure exit that installed nothing', () => {
    const okCodes = [0, 3010];
    expect(bareInstallRefused({ code: 1625, okCodes, installedAnywhere: false })).toBe(true);
    expect(bareInstallRefused({ code: 1603, okCodes, installedAnywhere: false })).toBe(true);
    expect(bareInstallRefused({ code: 0, okCodes, installedAnywhere: true })).toBe(false);
    expect(bareInstallRefused({ code: 0, okCodes, installedAnywhere: false })).toBe(false);
    expect(bareInstallRefused({ code: 3010, okCodes, installedAnywhere: false })).toBe(false);
    // an exit that failed but left a copy behind is not a refusal
    expect(bareInstallRefused({ code: 1603, okCodes, installedAnywhere: true })).toBe(false);
  });
});

describe('the installer policy the hosted runner sets (058 FR-006)', () => {
  it('reads DisableMsi from reg.exe output, and null when the value is absent', () => {
    expect(parseRegDword('\r\nHKEY_LOCAL_MACHINE\\Software\\Policies\\Microsoft\\Windows\\Installer\r\n    DisableMsi    REG_DWORD    0x1\r\n')).toBe(1);
    expect(parseRegDword('    DisableMsi    REG_DWORD    0x0')).toBe(0);
    expect(parseRegDword('ERROR: The system was unable to find the specified registry key or value.')).toBeNull();
    expect(INSTALLER_POLICY_KEY).toBe('HKLM\\Software\\Policies\\Microsoft\\Windows\\Installer');
  });

  it('never passes REBOOT or /norestart, so the harness proves the package’s own default', () => {
    for (const scope of ['per-user', 'machine'] as const) {
      const l = installLayout({ role: 'msi', scope, version: VERSION, artifactPath: 'C:\\a\\x.msi', env: {} });
      for (const command of [l.install, l.reinstall, l.uninstall, l.bareInstall]) {
        expect(command.args.join(' ')).not.toMatch(/REBOOT|norestart|forcerestart|promptrestart/i);
      }
    }
  });
});

describe('the hand-test driver’s model (058 manual test plan)', () => {
  it('declares every group of the manual test plan, MT-01 to MT-08, each with steps', () => {
    expect(Object.keys(GROUPS)).toEqual(['MT-01', 'MT-02', 'MT-03', 'MT-04', 'MT-05', 'MT-06', 'MT-07', 'MT-08']);
    for (const g of Object.values(GROUPS) as { steps: unknown[] }[]) expect(g.steps.length).toBeGreaterThan(0);
  });

  it('lists the steps without running anything', () => {
    expect(parseHandTestArgs(['--list'])).toEqual({ ok: true, mode: 'list' });
    const text = renderList();
    expect(text).toContain('MT-05');
    expect(text).toContain('setup-unattended-3010');
  });

  it('requires a known group to run', () => {
    expect(parseHandTestArgs([]).ok).toBe(false);
    expect(parseHandTestArgs(['--group', 'MT-99']).ok).toBe(false);
    const run = parseHandTestArgs(['--group', 'MT-03', '--expected-version', '1.2.3', '--out-dir', 'e']);
    expect(run).toMatchObject({ ok: true, mode: 'run', group: 'MT-03', version: '1.2.3', outDir: 'e', dir: 'dist/installer' });
  });

  it('counts a step that never ran as failed, so a run that stopped early cannot read green', () => {
    const rec = createRecorder('MT-01', '1.2.3');
    rec.pass('scope-page-defaults-to-only-me', 'ok');
    const json = rec.toJson();
    expect(json.passed).toBe(false);
    expect(json.steps.find((s: { id: string }) => s.id === 'terminal-works')).toMatchObject({ status: 'failed', reason: 'did not run' });
  });

  it('passes when every step passed or is a named runner gap, and fails on one failure', () => {
    const rec = createRecorder('MT-08', '1.2.3');
    for (const s of GROUPS['MT-08'].steps) rec.pass(s.id, 'ok');
    expect(rec.toJson().passed).toBe(true);
    rec.gap('refusal-removes-nothing', 'cannot', 'checked the files instead');
    expect(rec.toJson()).toMatchObject({ passed: true, counts: { runnerGap: 1, failed: 0 } });
    rec.fail('older-setup-refuses', 'no message');
    expect(rec.toJson().passed).toBe(false);
  });

  it('refuses a runner gap that names no stand-in, and a step the group does not have', () => {
    const rec = createRecorder('MT-02', null);
    expect(() => rec.gap('integrity-not-high', 'the desktop is High', '')).toThrow(/stand-in/);
    expect(() => rec.pass('no-such-step', 'x')).toThrow(/no step/);
  });

  it('judges the pending renames: only the install root, and the held executable among them', () => {
    const root = 'C:\\Program Files\\throng';
    const held = [`${root}\\resources\\runtime\\node.exe`];
    const pending = ['\\??\\C:\\Program Files\\throng\\resources\\runtime\\node.exe', '', '\\??\\C:\\Program Files\\throng\\resources\\app\\x.js', ''].join('\n');
    expect(judgePendingRenames(pending, root, held).ok).toBe(true);
    expect(judgePendingRenames('', root, held).ok).toBe(false);
    const stray = `${pending}\n\\??\\C:\\Program Files\\throng MSI\\resources\\runtime\\node.exe\n`;
    expect(judgePendingRenames(stray, root, held)).toMatchObject({ ok: false, outside: ['c:\\program files\\throng msi\\resources\\runtime\\node.exe'] });
    expect(judgePendingRenames('\\??\\C:\\Program Files\\throng\\resources\\app\\x.js\n', root, held).missing).toHaveLength(1);
  });

  it('reads the setup’s own queue entries: a "*1" flag in front, and the file renamed aside with a .throng-old suffix', () => {
    const root = 'C:\\Program Files\\throng';
    const held = [`${root}\\resources\\runtime\\node.exe`];
    const pending = [
      '*1\\??\\C:\\Program Files\\throng\\resources\\app\\node_modules\\better-sqlite3\\build\\Release\\better_sqlite3.node.throng-old',
      '',
      '*1\\??\\C:\\Program Files\\throng\\resources\\runtime\\node.exe.throng-old',
      '',
    ].join('\n');
    const judged = judgePendingRenames(pending, root, held);
    expect(judged).toMatchObject({ ok: true, outside: [], missing: [] });
    expect(judged.underRoot).toHaveLength(2);
  });

  it('finds the account in a refusal and reads it out of an owner string', () => {
    expect(refusalNamesAccount('throng is in use by other people: PC\\thr1234. Nothing has been changed.', 'thr1234')).toBe(true);
    expect(refusalNamesAccount('Nothing has been changed.', 'thr1234')).toBe(false);
    expect(accountOf('PC\\thr1234')).toBe('thr1234');
  });
});

describe('the UI Automation helper', () => {
  it('builds one stable command line per request', () => {
    expect(uiArgs('click', { title: 'throng Setup', name: '^Next', processId: 12 })).toEqual([
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', expect.stringMatching(/ui-automation\.ps1$/),
      '-Command', 'click', '-Title', 'throng Setup', '-ProcessId', '12', '-Name', '^Next',
    ]);
    expect(uiArgs('gone', { title: 'x', timeoutSec: 5 })).toEqual(expect.arrayContaining(['-TimeoutSec', '5']));
    expect(uiArgs('windows', {})).not.toContain('-Title');
  });
});

describe('the harness cannot hang without saying where (058 FR-028)', () => {
  it('writes a failing verdict naming the step that was running when time ran out', () => {
    const v = watchdogVerdict(
      {
        version: VERSION,
        combinationId: 'msi-machine',
        sha256: 'a'.repeat(64),
        current: 'in-use-upgrade',
        results: { install: true, launch: true },
      },
      30,
    );
    expect(v.passed).toBe(false);
    expect(v.failedStep).toBe('in-use-upgrade');
    expect(v.steps['in-use-upgrade']).toBe('failed');
    expect(v.steps.install).toBe('passed');
    expect(v.combination).toBe('msi-machine');
    expect(v.harnessError).toMatch(/in-use-upgrade.*30 minutes/);
  });

  it('answers when a run times out even though a grandchild still holds the output pipes open', { timeout: 30_000 }, async () => {
    // `close` waits for every pipe: a killed program's child (an installer, a daemon) kept them open and
    // the run never resolved. The runner must answer at its own deadline.
    const script = "require('child_process').spawn(process.execPath,['-e','setTimeout(()=>{},20000)'],{stdio:'inherit'});setTimeout(()=>{},20000)";
    const started = Date.now();
    const r = await systemRunner(process.execPath, ['-e', script], { timeoutMs: 1500 });
    expect(r.code).toBe(-1);
    expect(r.stderr).toMatch(/timed out/);
    expect(Date.now() - started).toBeLessThan(15_000);
  });
});
