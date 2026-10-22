/**
 * Layer: unit. The setup's behaviour is NSIS source text, and no cheaper layer can see it: this is
 * the guard that the vendored copies of electron-builder's NSIS templates (058 research D3) still
 * match the upstream they were taken from, and still carry the changes the spec needs. Tier: none
 * (unit); no shared setup, it only reads files.
 *
 * - The pinned upstream (version + SHA-256 of the files we shadow or depend on) lives in
 *   packaging/nsis/UPSTREAM.md. An electron-builder upgrade moves a hash; this fails; whoever
 *   upgrades re-reviews the vendored files against the new upstream and re-pins. It never drifts.
 * - packaging/installer.nsh must keep the `!addincludedir` + `!cd` lines that make the template's
 *   own `!include installSection.nsh` / `multiUserUi.nsh` resolve to the vendored copies; without
 *   them the copies are silently ignored.
 * - The vendored installSection.nsh / multiUserUi.nsh / packaging/installer.nsh carry the 058
 *   behaviours as text: no cross-scope uninstall (FR-017), the downgrade refusal after the scope is
 *   known (FR-015, FR-022), the elevation-declined message (FR-010a), no prompt for a silent
 *   machine-wide install without elevation (FR-010), no process killing (FR-015, FR-016a), and data
 *   deletion confined to the performing account (FR-016).
 *
 * The NSIS itself is compiled by `npm run package` (T021) and exercised by the release matrix.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const read = (p: string): string => readFileSync(join(ROOT, p), 'utf8');
const TEMPLATES = 'node_modules/app-builder-lib/templates/nsis';

const upstream = read('packaging/nsis/UPSTREAM.md');
const installSection = read('packaging/nsis/installSection.nsh');
const multiUserUi = read('packaging/nsis/multiUserUi.nsh');
const installerNsh = read('packaging/installer.nsh');

/** The text with NSIS line continuations folded and comment lines stripped, so assertions read code. */
function code(src: string): string {
  return src
    .replace(/\\\r?\n\s*/g, '')
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*[;#].*$/, ''))
    .join('\n');
}

/** The body of the first `${Case} <n>` branch of a `${Switch}` in `src`, up to the next Case/Default. */
function caseBody(src: string, n: number): string {
  const start = src.indexOf('${Case} ' + n);
  expect(start, '${Case} ' + n + ' present').toBeGreaterThan(-1);
  const rest = src.slice(start + 1);
  const end = rest.search(/\$\{(Case|Default|EndSwitch)\}/);
  return rest.slice(0, end === -1 ? undefined : end);
}

describe('the pinned upstream (UPSTREAM.md)', () => {
  it('pins the app-builder-lib version that is installed', () => {
    const pinned = /^Version:\s*(\S+)/m.exec(upstream)?.[1];
    expect(pinned, 'UPSTREAM.md has a "Version:" line').toBeTruthy();
    const installed = (JSON.parse(read('node_modules/app-builder-lib/package.json')) as { version: string }).version;
    expect(installed).toBe(pinned);
  });

  it.each(['installer.nsi', 'installSection.nsh', 'multiUserUi.nsh'])(
    'pins the SHA-256 of upstream %s',
    (file) => {
      const pinned = new RegExp('\\|\\s*`' + file.replace('.', '\\.') + '`\\s*\\|\\s*`([0-9a-f]{64})`').exec(upstream)?.[1];
      expect(pinned, file + ' has a hash row in UPSTREAM.md').toBeTruthy();
      const actual = createHash('sha256')
        .update(readFileSync(join(ROOT, TEMPLATES, file)))
        .digest('hex');
      expect(actual).toBe(pinned);
    },
  );
});

describe('vendored installSection.nsh', () => {
  const src = code(installSection);

  it('does not uninstall the per-user copy when installing machine-wide (FR-017)', () => {
    expect(src).not.toMatch(/uninstallOldVersion\s+HKEY_CURRENT_USER/);
  });

  it("refuses a downgrade of THIS scope's copy, after the scope is known and before replacing it (FR-015, FR-022)", () => {
    const compare = src.indexOf('VersionCompare');
    const refusal = src.indexOf('SetErrorLevel 2');
    const uninstall = src.indexOf('uninstallOldVersion SHELL_CONTEXT');
    expect(compare, 'compares versions').toBeGreaterThan(-1);
    expect(refusal, 'refuses with exit code 2').toBeGreaterThan(compare);
    expect(uninstall, 'replaces the old copy').toBeGreaterThan(refusal);
    // The version it compares against is read from the hive of the CHOSEN scope.
    expect(src.slice(0, compare)).toMatch(/ReadRegStr\s+\$\w+\s+SHELL_CONTEXT\s+"\$\{UNINSTALL_REGISTRY_KEY\}"\s+"?DisplayVersion"?/);
  });

  it('labels the entry and the shortcuts with the scope (FR-017b)', () => {
    expect(src).toMatch(/DisplayName/);
    expect(src).toMatch(/"all users"/);
    expect(src).toMatch(/"per-user"/);
    expect(src).toMatch(/DisplayName\s+"[^"]*\(\$throngScopeLabel\)"/);
  });
});

describe('packaging/installer.nsh', () => {
  const src = code(installerNsh);

  it("shadows the template's two files with the vendored copies (research D3)", () => {
    expect(src).toMatch(/!addincludedir\s+"[^"]*app-builder-lib[\\/]templates[\\/]nsis"/);
    expect(src).toMatch(/!cd\s+"\$\{__FILEDIR__\}[\\/]nsis"/);
  });

  it("forwards the one template file whose name NSIS's own Include directory also has (multiUser.nsh)", () => {
    // NSIS searches its Include directory before added include directories, so the template's
    // `!include "multiUser.nsh"` would otherwise open NSIS's stock file after the `!cd`.
    expect(code(read('packaging/nsis/multiUser.nsh'))).toMatch(
      /!include\s+"\$\{__FILEDIR__\}[\\/]\.\.[\\/]\.\.[\\/]node_modules[\\/]app-builder-lib[\\/]templates[\\/]nsis[\\/]multiUser\.nsh"/,
    );
  });

  it('no longer carries the downgrade refusal in customInit, which runs before the scope is chosen (T058)', () => {
    const init = /!macro customInit([\s\S]*?)!macroend/.exec(src)?.[1] ?? '';
    expect(init).not.toMatch(/DisplayVersion/);
    expect(init).not.toMatch(/VersionCompare/);
  });

  it('runs the in-use helper through cmd.exe, because nsExec starting the runtime directly returned nothing from the setup', () => {
    // Measured on a runner (hand test MT-05, the setup's own log): from the installer, nsExec::ExecToStack
    // on node.exe gave exit 0 and an EMPTY output even for `--version`, while the identical command
    // through cmd.exe answered, and so did the uninstaller's direct call. An empty answer is "no answer".
    const macro = /!macro customCheckAppRunning([\s\S]*?)!macroend/.exec(src)?.[1] ?? '';
    expect(macro).toMatch(/nsExec::ExecToStack\s+'"\$SYSDIR\\cmd\.exe" \/c ""\$INSTDIR\\resources\\runtime\\node\.exe" "\$R3" --nsis "\$INSTDIR""'/);
  });

  it('never reads an unanswered in-use question as "free" when nobody can be asked (silent)', () => {
    const macro = /!macro customCheckAppRunning([\s\S]*?)!macroend/.exec(src)?.[1] ?? '';
    // an empty or unrecognised helper answer is discarded, not parsed as a decision
    expect(macro).toMatch(/\$R2 != "free"[\s\S]*?\$R2 != "own-"[\s\S]*?\$R2 != "othe"[\s\S]*?StrCpy \$R2 ""/);
    // …and the by-name fallback, which cannot see another account's node.exe, marks a silent run as
    // "others may be using it" rather than carrying on as if free
    expect(macro).toMatch(/\$\{ElseIf\} \$\{Silent\}\s*StrCpy \$throngInUseOthers "1"/);
  });

  it('defines customCheckAppRunning and never terminates a process (T018, FR-015, FR-016a)', () => {
    expect(src).toMatch(/!macro customCheckAppRunning/);
    expect(src).not.toMatch(/taskkill/i);
    expect(src).not.toMatch(/KillProcess|KILL_PROCESS/i);
    expect(src).not.toMatch(/Stop-Process/i);
  });

  it("wraps the \"also delete my data\" deletion in the performing account's shell context (T019, FR-016)", () => {
    const un = /!macro customUnInstall([\s\S]*?)!macroend/.exec(src)?.[1] ?? '';
    const current = un.indexOf('SetShellVarContext current');
    const del = un.indexOf('RMDir /r "$APPDATA\\throng"');
    const restore = un.lastIndexOf('SetShellVarContext all');
    expect(current, 'switches to the current account').toBeGreaterThan(-1);
    expect(del).toBeGreaterThan(current);
    expect(restore).toBeGreaterThan(del);
    // An unattended uninstall must keep every user's data.
    expect(un).toMatch(/IfSilent\s+\w+/);
  });

  it('carries the elevation-declined text the contract fixes (FR-010a)', () => {
    expect(installerNsh).toContain(
      'Installing throng for everyone on this computer needs administrator approval, which was not given. ' +
        'Nothing has been installed. Choose Only for me to install for yourself, or try again.',
    );
  });
});

describe('vendored multiUserUi.nsh', () => {
  const src = code(multiUserUi);

  it('says why when the administrator prompt is declined, and stays on the scope page (FR-010a)', () => {
    const declined = caseBody(src, 1223);
    expect(declined).toContain('${THRONG_MSG_ELEVATION_DECLINED}');
    expect(declined).toMatch(/MessageBox/);
  });

  it('refuses a silent machine-wide install without administrator rights, with no prompt (FR-010, T043)', () => {
    // The first elevation attempt in the "all users" branch of the page's pre-function.
    const branchStart = src.indexOf('${OrIf} ${isForAllUsers}');
    expect(branchStart).toBeGreaterThan(-1);
    const elevate = src.indexOf('!insertmacro UAC_RunElevated', branchStart);
    const guarded = src.slice(branchStart, elevate);
    expect(guarded).toMatch(/\$\{If\}\s+\$\{Silent\}/);
    expect(guarded).toContain('!insertmacro throngRefuseSilentMachineWide');
    expect(guarded).not.toContain('UAC_RunElevated');
  });
});

describe('the silent machine-wide refusal (installer.nsh)', () => {
  const src = code(installerNsh);
  const refusal = /!macro throngRefuseSilentMachineWide([\s\S]*?)!macroend/.exec(src)?.[1] ?? '';

  it('writes to the parent console, exits 740 and never starts an elevation (FR-010)', () => {
    expect(refusal).toMatch(/AttachConsole/);
    expect(refusal).toMatch(/WriteFile/);
    expect(refusal).toMatch(/SetErrorLevel 740/);
    expect(refusal).toMatch(/\bQuit\b/);
    expect(refusal).not.toMatch(/UAC_RunElevated/);
  });

  it("runs from customInit, so the template's own silent auto-elevation can never be reached", () => {
    const init = /!macro customInit([\s\S]*?)!macroend/.exec(src)?.[1] ?? '';
    expect(init).toContain('throngRefuseSilentMachineWide');
  });
});
