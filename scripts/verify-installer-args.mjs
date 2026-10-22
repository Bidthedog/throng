// What `verify-installer.mjs` is asked to do, and where each combination lives on disk (058 FR-028).
//
// Pure on purpose: the harness drives real installers and cannot run anywhere but a clean runner, but
// "which arguments are legal" and "where does the machine-wide MSI put itself" are decisions, and a
// decision that can only be checked by cutting a release is checked too late.
//
//   node scripts/verify-installer.mjs <artifact> --role <role> [--scope per-user|machine]
//        --expected-version <v> [--verdict-out <file>] [--expected-sha <sha256>] [--keep-residue]
//   node scripts/verify-installer.mjs --coexistence [--dir dist/installer]
//        --expected-version <v> [--verdict-out <file>] [--allow-dirty-profile]
import { win32 } from 'node:path';
import { combinationsOf, declareArtifactSet } from '@throng/core';

/** Flags that take a value, so their value is never mistaken for the positional artifact. */
const VALUE_FLAGS = new Set(['--role', '--scope', '--expected-version', '--verdict-out', '--expected-sha', '--dir']);

function flag(argv, name) {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] !== undefined && !argv[i + 1].startsWith('--') ? argv[i + 1] : undefined;
}

function positional(argv) {
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      if (VALUE_FLAGS.has(argv[i])) i++;
      continue;
    }
    return argv[i];
  }
  return undefined;
}

const refuse = (message) => ({ ok: false, code: 2, message: `[verify-installer] ${message}` });

/**
 * @param {string[]} argv the arguments after `node verify-installer.mjs`.
 * @returns {object} `{ok: true, mode, ...}` or `{ok: false, code: 2, message}`.
 */
export function parseVerifyArgs(argv) {
  const expectedVersion = flag(argv, '--expected-version');

  if (argv.includes('--coexistence')) {
    if (argv.includes('--role') || argv.includes('--scope')) {
      return refuse('--coexistence verifies every copy together; it takes neither --role nor --scope');
    }
    return {
      ok: true,
      mode: 'coexistence',
      dir: flag(argv, '--dir') ?? 'dist/installer',
      expectedVersion,
      verdictOut: flag(argv, '--verdict-out') ?? 'verification-verdict-coexistence.json',
      allowDirtyProfile: argv.includes('--allow-dirty-profile'),
    };
  }

  const artifact = positional(argv);
  if (!artifact) {
    return refuse('usage: verify-installer.mjs <artifact> --role <role> [--scope per-user|machine] --expected-version <v>');
  }

  const set = declareArtifactSet(expectedVersion ?? '0.0.0');
  const role = flag(argv, '--role') ?? 'setup';
  const declared = set.artifacts.find((a) => a.role === role);
  if (!declared) {
    return refuse(`unknown role '${role}' — the declared set holds: ${set.artifacts.map((a) => a.role).join(', ')}`);
  }

  const scope = flag(argv, '--scope');
  if (declared.scopes.length === 0) {
    if (argv.includes('--scope')) {
      return refuse(`'${role}' has no install scope (valid scopes: none); --scope is not accepted for it`);
    }
  } else if (!scope || !declared.scopes.includes(scope)) {
    return refuse(
      `--scope is ${scope ? `'${scope}', which is not a scope of` : 'required for'} '${role}'; valid scopes: ${declared.scopes.join(', ')}`,
    );
  }

  const combination = combinationsOf(set).find((c) => c.role === role && c.scope === (scope ?? null));
  return {
    ok: true,
    mode: 'single',
    artifact,
    role,
    scope: scope ?? null,
    combination: combination.id,
    expectedVersion,
    expectedSha: flag(argv, '--expected-sha'),
    keepResidue: argv.includes('--keep-residue'),
    verdictOut: flag(argv, '--verdict-out') ?? combination.verdictFile,
  };
}

/** Where the machine policy that blocks non-elevated Windows Installer installs lives. */
export const INSTALLER_POLICY_KEY = 'HKLM\\Software\\Policies\\Microsoft\\Windows\\Installer';

/**
 * The DWORD from `reg query <key> /v <name>` output, or null when the value is absent.
 * @param {string} output
 * @returns {number | null}
 */
export function parseRegDword(output) {
  const match = /REG_DWORD\s+(0x[0-9a-f]+|\d+)/i.exec(output);
  return match ? Number(match[1]) : null;
}

/**
 * Was an unattended, scope-less install by a standard account refused as it must be? It exits with a
 * failure (1625 "forbidden by policy" or 1603) and installs nothing, in either scope.
 * @param {{code: number, okCodes: number[], installedAnywhere: boolean}} outcome
 */
export function bareInstallRefused({ code, okCodes, installedAnywhere }) {
  return !okCodes.includes(code) && code !== 0 && !installedAnywhere;
}

/**
 * Does any PendingFileRenameOperations entry fall under one of `roots`? Windows Installer may name the
 * files by their 8.3 path, so the caller passes the long root and its short form.
 * @param {string[]} entries the raw multi-string, source/destination pairs flattened
 * @param {string[]} roots
 */
export function mentionsInstallRoot(entries, roots) {
  // Entries read `*1\??\C:\…` (the delete marker) or `\??\C:\…`.
  const norm = (p) => p.trim().replace(/^\*\d+/, '').replace(/^\\\?\?\\/, '').replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase();
  const wanted = roots.filter(Boolean).map((r) => `${norm(r)}\\`);
  return entries.some((e) => {
    const path = norm(e);
    return path !== '' && wanted.some((r) => path.startsWith(r));
  });
}

/**
 * A verbose Windows Installer log as text. `msiexec /l*v` writes UTF-16LE with a byte-order mark; read
 * as UTF-8 it is NUL-separated noise that no pattern matches ("0 scope lines" from a full log).
 * @param {Buffer} buffer
 */
export function decodeInstallerLog(buffer) {
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) return buffer.subarray(2).toString('utf16le');
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    return Buffer.from(buffer.subarray(2)).swap16().toString('utf16le');
  }
  return buffer.toString('utf8');
}

/**
 * The registry locations (PowerShell paths) that list an installation's `DisplayName` for a hive.
 * A per-user MSI has no entry under HKCU's Uninstall key: Windows Installer keeps a per-user product,
 * for the account that installed it, under HKLM\…\Installer\UserData\<SID>\Products\*\InstallProperties.
 * `$sid` in the paths is the PowerShell variable the caller defines (the account's SID).
 * @param {'HKCU'|'HKLM'} hive
 * @param {boolean} [msi] true when the copy under test is an MSI
 */
export function uninstallRegistryRoots(hive, msi = false) {
  if (hive === 'HKLM') {
    return [
      'Registry::HKEY_LOCAL_MACHINE\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
      'Registry::HKEY_LOCAL_MACHINE\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
    ];
  }
  const roots = ['Registry::HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'];
  if (msi) {
    roots.push('Registry::HKEY_LOCAL_MACHINE\\Software\\Microsoft\\Windows\\CurrentVersion\\Installer\\UserData\\$sid\\Products\\*\\InstallProperties');
  }
  return roots;
}

/**
 * The lines of a verbose Windows Installer log that say which install context was chosen and where
 * the files went — the few that explain a copy landing in the wrong scope.
 * @param {string} text
 * @param {number} [limit]
 */
export function scopeDiagnosticLines(text, limit = 60) {
  return text
    .split(/\r?\n/)
    .filter((line) => /ALLUSERS|MSIINSTALLPERUSER|APPLICATIONFOLDER|Privileged|MsiRunningElevated/.test(line))
    .slice(0, limit);
}

/**
 * Where a combination installs, what it is called there, and how to put it on and take it off
 * silently (058 research D4; contracts/install-switches.md). `null` for a format that installs
 * nothing.
 *
 * @returns {null | {
 *   root: string, hive: 'HKCU'|'HKLM', displayName: string, startMenuDir: string,
 *   shortcutNames: string[], install: {file: string, args: string[], okCodes: number[]},
 *   uninstall: {file: string, args: string[], okCodes: number[]},
 * }}
 */
export function installLayout({ role, scope, version, artifactPath, env }) {
  if (role !== 'setup' && role !== 'msi') return null;
  const machine = scope === 'machine';
  const localAppData = env.LOCALAPPDATA ?? 'C:\\Users\\Default\\AppData\\Local';
  const appData = env.APPDATA ?? 'C:\\Users\\Default\\AppData\\Roaming';
  const programFiles = env.ProgramFiles ?? 'C:\\Program Files';
  const programData = env.ProgramData ?? 'C:\\ProgramData';
  const startMenuDir = machine
    ? win32.join(programData, 'Microsoft', 'Windows', 'Start Menu', 'Programs')
    : win32.join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs');
  const folder = role === 'setup' ? 'throng' : 'throng MSI';
  const root = machine ? win32.join(programFiles, folder) : win32.join(localAppData, 'Programs', folder);
  const label = machine ? 'all users' : 'per-user';

  if (role === 'setup') {
    return {
      root,
      hive: machine ? 'HKLM' : 'HKCU',
      displayName: `throng ${version} (${label})`,
      startMenuDir,
      shortcutNames: [`throng (${label}).lnk`],
      install: { file: artifactPath, args: machine ? ['/S', '/allusers'] : ['/S'], okCodes: [0] },
      // The setup's installer is its own upgrade: run again over an installed copy, it replaces it.
      reinstall: { file: artifactPath, args: machine ? ['/S', '/allusers'] : ['/S'], okCodes: [0, 3010] },
      uninstall: {
        file: win32.join(root, 'Uninstall throng.exe'),
        args: machine ? ['/S', '/allusers'] : ['/S'],
        okCodes: [0],
      },
    };
  }

  // The documented switches (docs/installation.md, contracts/install-switches.md): the standard
  // properties, because Windows Installer fixes the install context from the command line (or the UI
  // sequence), never from an action in the package.
  const scopeArgs = machine ? ['ALLUSERS=1'] : ['MSIINSTALLPERUSER=1'];
  const msiexec = win32.join(env.SystemRoot ?? 'C:\\Windows', 'System32', 'msiexec.exe');
  // A verbose Windows Installer log for every MSI command: why a scope or an in-use decision went the
  // way it did is only in there. Inside the workspace, because the upload step refuses a file outside
  // its root directory (it failed on exactly that, with the logs sitting in the runner's temp folder).
  const logDir = env.GITHUB_WORKSPACE ? win32.join(env.GITHUB_WORKSPACE, 'installer-logs') : (env.RUNNER_TEMP ?? env.TEMP);
  const logArgs = (verb) =>
    logDir ? ['/l*v', win32.join(logDir, `throng-msi-${machine ? 'machine' : 'user'}-${verb}-${Date.now()}.log`)] : [];
  return {
    root,
    isMsi: true,
    hive: machine ? 'HKLM' : 'HKCU',
    displayName: `throng (MSI, ${label})`,
    startMenuDir,
    shortcutNames: [`throng MSI (${label}).lnk`],
    // 3010 is success-with-restart: files another account was using are replaced at the next restart.
    //
    // Every command names its scope. The runner's account is an administrator, and an elevated run
    // with no scope goes machine-wide (FR-003a): an unqualified per-user command would put the copy in
    // Program Files, and a standard account's per-user install would then be maintenance of it (one
    // product code).
    //
    // `bareInstall` names none: what a double-click or a plain `msiexec /i` does. Run by a standard
    // account it proves the non-elevated default is per-user.
    bareInstall: { file: msiexec, args: ['/i', artifactPath, '/qn', ...logArgs('bare-install')], okCodes: [0, 3010] },
    install: { file: msiexec, args: ['/i', artifactPath, '/qn', ...scopeArgs, ...logArgs('install')], okCodes: [0, 3010] },
    // `msiexec /i` on a product that is already installed is MAINTENANCE: it repairs nothing, replaces
    // no file, so no file is ever in use and 3010 can never come back. REINSTALL=ALL with the `a`
    // mode forces every file to be replaced, which is what an upgrade does and what the in-use
    // handling is about.
    reinstall: {
      file: msiexec,
      args: ['/i', artifactPath, '/qn', ...scopeArgs, 'REINSTALL=ALL', 'REINSTALLMODE=amus', ...logArgs('reinstall')],
      okCodes: [0, 3010],
    },
    uninstall: { file: msiexec, args: ['/x', artifactPath, '/qn', ...scopeArgs, ...logArgs('uninstall')], okCodes: [0, 3010] },
  };
}
