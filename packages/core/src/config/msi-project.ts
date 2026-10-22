/**
 * The throng-specific rewrite of the WiX project electron-builder generates for the MSI
 * (058 research D1, D2, D4, D9, D10, D10a).
 *
 * electron-builder's `msi` target writes a WiX project (`project.wxs`) from its own template and then
 * hands the path to the `msiProjectCreated` hook before it compiles anything. The template with
 * `oneClick: false` already authors a dual-purpose package (`ALLUSERS=2`, `MSIINSTALLPERUSER=1`, the
 * `WixUI_InstallDir` dialogs with an install-scope page). What it cannot express is what this spec
 * needs on top:
 *
 *   - one scope default that follows who is running it, and one switch to override it (FR-003a);
 *   - a folder, an apps-list name and shortcuts that say which scope and installer they belong to,
 *     so a per-user and a machine-wide MSI never look like one entry (FR-017a, FR-017b);
 *   - a refusal to upgrade or remove a copy another account is using (FR-016a);
 *   - an app started at the end of an elevated install that is not itself elevated (FR-007);
 *   - elevation requested at the scope page, with a way back if it is declined (FR-010a).
 *
 * Every function here is a pure text transform over the template's output, so each is tested against
 * a captured copy of that output (`tests/unit/fixtures/msi-template-output.wxs`) rather than proved
 * only by building an MSI. **Each throws when its anchor is missing**, so an electron-builder upgrade
 * that reshapes the template fails the build loudly instead of silently skipping a transform, and
 * **each is idempotent**, keyed on the id of what it inserts.
 *
 * What is NOT here: anything that runs. The custom actions this inserts are small PowerShell command
 * lines (Windows Installer type 34), so no DLL or script host needs building or shipping; they are
 * proved by the verification matrix on a real machine, not by these tests.
 */

/** Names the transform writes. Every default is the spec's own wording. */
export interface MsiProjectOptions {
  /** The install folder's name under `Program Files` / `%LOCALAPPDATA%\Programs` (FR-017a). */
  folderName?: string;
  /** The apps-list entry's name for each scope (FR-017b). */
  productNameUser?: string;
  productNameMachine?: string;
  /** The Start-menu and desktop shortcut names for each scope (FR-017b). */
  shortcutNameUser?: string;
  shortcutNameMachine?: string;
  /** The registry key (under `Software`) that remembers where each scope's copy is installed. */
  registryKey?: string;
}

interface ResolvedOptions {
  folderName: string;
  productNameUser: string;
  productNameMachine: string;
  shortcutNameUser: string;
  shortcutNameMachine: string;
  registryKey: string;
}

const DEFAULTS: ResolvedOptions = {
  folderName: 'throng MSI',
  productNameUser: 'throng (MSI, per-user)',
  productNameMachine: 'throng (MSI, all users)',
  shortcutNameUser: 'throng MSI (per-user)',
  shortcutNameMachine: 'throng MSI (all users)',
  registryKey: 'Software\\throng MSI',
};

/**
 * "This install is machine-wide" as a Windows Installer condition: elevated, not forced per-user, and
 * the package's own `ALLUSERS=2` (or an explicit `ALLUSERS=1`).
 *
 * `MsiRunningElevated` is what makes it true, not `ALLUSERS`: for ANY run without `MSIINSTALLPERUSER`
 * the engine rewrites `ALLUSERS` from 2 to 1 before a single action runs (measured: a standard
 * account's wizard logged "Modifying ALLUSERS ... new value: 1"), so `ALLUSERS=1` alone says nothing
 * about the account, and a standard account's wizard opened on "all users" with "(MSI, all users)"
 * in its title. A machine-wide install needs elevation anyway, so requiring it loses nothing.
 */
export const MACHINE_SCOPE_CONDITION = '(MsiRunningElevated AND NOT MSIINSTALLPERUSER AND (ALLUSERS = "1" OR ALLUSERS = "2"))';
const USER_SCOPE_CONDITION = `(NOT ${MACHINE_SCOPE_CONDITION})`;

/** The text shown when elevation for a machine-wide install was not given (FR-010a, install-switches.md). */
export const ELEVATION_DECLINED_TEXT =
  'Installing throng for everyone on this computer needs administrator approval, which was not given. ' +
  'Nothing has been installed. Choose "Only for me" to install for yourself, or try again.';

// ---------------------------------------------------------------------------------------------
// The PowerShell the custom actions run. Each is stored in a PRIVATE Property row and substituted
// into the command line as `[Name]`: a Property value is stored verbatim, whereas the same text in a
// custom action's target would be run through Windows Installer's formatter, which reads `[x]` and
// `{ }`. The scripts contain no double quote for the same reason the command line cannot carry one
// (it would end the -Command argument); `[char]34` makes one where needed.
// ---------------------------------------------------------------------------------------------

/**
 * Starts the same MSI again, elevated, with the machine-wide scope chosen, and then closes the wizard
 * that asked. A declined prompt makes Start-Process throw, which is caught before anything is
 * closed — the wizard surviving is how the scope page knows to show the declined text and stay
 * (research D10a).
 */
const ELEVATE_SCRIPT =
  '& { param($db) ' +
  "try { Start-Process -FilePath (Join-Path $env:SystemRoot 'System32\\msiexec.exe') " +
  "-ArgumentList ('/i', ([char]34 + $db + [char]34), 'ALLUSERS=1') -Verb RunAs -ErrorAction Stop; " +
  // The elevated copy has started, so this wizard is finished. Its parent is the msiexec running it;
  // stopping that closes the window without the “installation was interrupted” page that every exit
  // through a dialog event shows (WixUI's UserExit follows any cancel). Nothing has been installed.
  '$parent = (Get-CimInstance Win32_Process -Filter (\'ProcessId=\' + $PID)).ParentProcessId; ' +
  '$owner = Get-Process -Id $parent -ErrorAction SilentlyContinue; ' +
  "if ($owner -and $owner.ProcessName -eq 'msiexec') { Stop-Process -Id $parent -Force } } catch { } }";

/**
 * Asks the existing copy's own helper who is using it (research D9). Exits 1 — failing the custom
 * action, which ends setup before anything is changed — only when another account is using the copy,
 * after showing who. Anything it cannot answer (no helper yet in a pre-058 copy, a failed query) lets
 * the install go ahead: unattended runs and unknowns fall back to Windows Installer's own in-use
 * handling, which replaces files at the next restart rather than ending anyone's session.
 */
const IN_USE_SCRIPT =
  '& { param($p) ' +
  '$root = ([System.IO.Path]::GetFullPath($p)).TrimEnd([char]92); ' +
  "$node = Join-Path $root 'resources\\runtime\\node.exe'; " +
  "$helper = Join-Path $root 'resources\\in-use\\in-use.mjs'; " +
  '$message = $null; ' +
  // The copy's own helper names the accounts using it. A copy from before this feature has no helper,
  // and a failed query answers nothing: neither ends the script early, because the check below does
  // not depend on the helper.
  'if ((Test-Path $node) -and (Test-Path $helper)) { ' +
  '$out = & $node $helper --nsis $root; ' +
  "if ($LASTEXITCODE -eq 0) { $parts = ([string]$out).Trim() -split '\\|', 2; if ($parts[0] -eq 'others') { $message = $parts[1] } } }; " +
  // Conservative, for a machine-wide copy. Run unelevated, this cannot read another account's process
  // paths — and the helper matches by path — so a throng or node process whose path is unreadable is
  // taken to belong to another account. Its name is always readable; its owner may not be.
  'if (-not $message -and $root.StartsWith($env:ProgramFiles, [System.StringComparison]::OrdinalIgnoreCase)) { ' +
  "$unreadable = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object { ($_.Name -eq 'throng.exe' -or $_.Name -eq 'node.exe') -and -not $_.ExecutablePath }); " +
  "if ($unreadable.Count -gt 0) { $message = 'throng may be in use by another account that could not be identified. Nothing has been changed. Ask the other people signed in to this computer to close throng, then try again.' } }; " +
  // Bounded, so a prompt nobody can see (no desktop) cannot hold setup forever.
  "if ($message) { $null = (New-Object -ComObject WScript.Shell).Popup($message, 300, 'throng Setup', 16); " +
  // The message was the notice. Failing the action would make the engine add its own ("a program run as
  // part of the setup did not finish as expected"), so end the session here, as the elevation script
  // does. Nothing has been changed yet. The failing exit remains for a parent that is not msiexec.
  '$parent = (Get-CimInstance Win32_Process -Filter (\'ProcessId=\' + $PID)).ParentProcessId; ' +
  '$owner = Get-Process -Id $parent -ErrorAction SilentlyContinue; ' +
  "if ($owner -and $owner.ProcessName -eq 'msiexec') { Stop-Process -Id $parent -Force }; " +
  'exit 1 }; ' +
  'exit 0 }';

// ---------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------

function attr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/\r?\n/g, ' ');
}

/** The text in the template that a transform keys on; an absent anchor throws, naming it. */
function requireMatch(wxs: string, pattern: RegExp, what: string): RegExpExecArray {
  const match = pattern.exec(wxs);
  if (!match) {
    throw new Error(
      `msi project transform: cannot find ${what} in the electron-builder template output — ` +
        'the template changed; review the transform before shipping an MSI.',
    );
  }
  return match;
}

function has(wxs: string, id: string): boolean {
  return wxs.includes(`Id="${id}"`);
}

/** Insert `block` immediately before the first match of `anchor`. */
function insertBefore(wxs: string, anchor: RegExp, block: string, what: string): string {
  const match = requireMatch(wxs, anchor, what);
  return wxs.slice(0, match.index) + block + wxs.slice(match.index);
}

const PRODUCT_COMPONENTS_END = /[ \t]*<\/ComponentGroup>/;

// ---------------------------------------------------------------------------------------------
// The transforms
// ---------------------------------------------------------------------------------------------

/** FR-017a — the MSI's own folder, distinct from the setup's `throng`. */
export function setInstallFolder(wxs: string, options: MsiProjectOptions = {}): string {
  const { folderName } = { ...DEFAULTS, ...options };
  const property = requireMatch(wxs, /<Property Id="ApplicationFolderName" Value="[^"]*"\s*\/>/, 'the ApplicationFolderName property');
  const directory = requireMatch(wxs, /<Directory Id="APPLICATIONFOLDER" Name="[^"]*"\s*\/>/, 'the APPLICATIONFOLDER directory');
  return wxs
    .replace(property[0], `<Property Id="ApplicationFolderName" Value="${attr(folderName)}"/>`)
    .replace(directory[0], `<Directory Id="APPLICATIONFOLDER" Name="${attr(folderName)}"/>`);
}

/**
 * FR-003a, research D2 — the scope is Windows Installer's own. The package is `ALLUSERS=2`, so a run
 * with administrator rights (an elevated administrator, or SYSTEM as managed deployment runs it) is
 * machine-wide and any other run is per-user, with nothing of ours involved. `ALLUSERS=1` forces
 * machine-wide and `MSIINSTALLPERUSER=1` forces per-user, from the command line.
 *
 * That is why this adds no action that sets either property: Windows Installer fixes the install
 * context from the command line or the UI sequence, so an execute-sequence action that changes it
 * installs in the context it started with (measured: an elevated `THRONG_SCOPE=user` installed
 * machine-wide). The template's own `MSIINSTALLPERUSER` default of `1` would make every run per-user,
 * so the property is declared secure with no value, which leaves it out of the Property table.
 *
 * What it does set is the scope page's default, from the resolved context: `MsiRunningElevated`, not
 * `Privileged` or `AdminUser`, which are true for an administrator's UNELEVATED token under UAC and
 * would make a double-click default to machine-wide.
 */
export function addScopeSelection(wxs: string): string {
  if (has(wxs, 'ThrongAppFolderMachine')) return wxs;
  const perUser = requireMatch(
    wxs,
    /[ \t]*<Property Id="MSIINSTALLPERUSER"[^>]*\/>[ \t]*\r?\n?/,
    'the MSIINSTALLPERUSER property',
  );
  let out = wxs.replace(perUser[0], '');

  const properties = [
    '    <!-- 058 FR-003a: MSIINSTALLPERUSER has no default in the table, so ALLUSERS=2 resolves by elevation. -->',
    '    <Property Id="MSIINSTALLPERUSER" Secure="yes"/>',
    '    <Property Id="MSIRESTARTMANAGERCONTROL" Value="Disable"/>',
    // The package never restarts the computer by itself (FR-016a): files another account holds are
    // replaced at the next restart and the run ends 3010. Unset, /qn restarts the machine on its own.
    '    <Property Id="REBOOT" Value="ReallySuppress"/>',
  ].join('\n');

  const actions = [
    '    <CustomAction Id="ThrongAppFolderMachine" Property="WixAppFolder" Value="WixPerMachineFolder"/>',
    '    <CustomAction Id="ThrongAppFolderUser" Property="WixAppFolder" Value="WixPerUserFolder"/>',
  ].join('\n');

  // The scope page's own default follows the resolved context, so an elevated run (or ALLUSERS=1)
  // opens on "all users" and a per-user run (or MSIINSTALLPERUSER=1) on "just me".
  const ui = [
    '    <InstallUISequence>',
    `      <Custom Action="ThrongAppFolderMachine" Before="FindRelatedProducts">${MACHINE_SCOPE_CONDITION}</Custom>`,
    `      <Custom Action="ThrongAppFolderUser" Before="FindRelatedProducts">${USER_SCOPE_CONDITION}</Custom>`,
    '    </InstallUISequence>',
  ].join('\n');

  out = insertBefore(out, /[ \t]*<Directory Id="TARGETDIR"/, `${properties}\n${actions}\n${ui}\n\n`, 'the TARGETDIR directory');
  return out;
}

/**
 * FR-017b, research D4 — the apps-list entry says which scope it is. `ProductName` is set by a
 * type-51 action in both sequences before costing; the execute-sequence one is what the registered
 * entry reads, so it runs after the scope is final.
 */
export function addProductNames(wxs: string, options: MsiProjectOptions = {}): string {
  if (has(wxs, 'ThrongProductNameUser')) return wxs;
  const { productNameUser, productNameMachine } = { ...DEFAULTS, ...options };
  const actions = [
    `    <CustomAction Id="ThrongProductNameUser" Property="ProductName" Value="${attr(productNameUser)}"/>`,
    `    <CustomAction Id="ThrongProductNameMachine" Property="ProductName" Value="${attr(productNameMachine)}"/>`,
  ].join('\n');
  const sequence = (name: string): string =>
    [
      `    <${name}>`,
      `      <Custom Action="ThrongProductNameUser" Before="CostInitialize">${USER_SCOPE_CONDITION}</Custom>`,
      `      <Custom Action="ThrongProductNameMachine" Before="CostInitialize">${MACHINE_SCOPE_CONDITION}</Custom>`,
      `    </${name}>`,
    ].join('\n');
  return insertBefore(
    wxs,
    /[ \t]*<Directory Id="TARGETDIR"/,
    `${actions}\n${sequence('InstallExecuteSequence')}\n${sequence('InstallUISequence')}\n\n`,
    'the TARGETDIR directory',
  );
}

/**
 * FR-017b — the Start-menu and desktop shortcuts carry the scope. A shortcut's name is fixed in its
 * table row, so the template's two advertised shortcuts are replaced by one pair per scope, each in a
 * component installed only for its scope.
 *
 * The key path is under HKCU for both scopes. A shortcut is per-user data to Windows Installer's
 * validation (ICE43/ICE57), which rejects any other hive for a non-advertised one; for a machine-wide
 * copy it records the installing account only, and nothing reads it back.
 */
export function renameShortcuts(wxs: string, options: MsiProjectOptions = {}): string {
  if (has(wxs, 'ThrongShortcutStartUser')) return wxs;
  const { shortcutNameUser, shortcutNameMachine, registryKey } = { ...DEFAULTS, ...options };

  const start = requireMatch(
    wxs,
    /[ \t]*<Shortcut Id="startMenuShortcut"[\s\S]*?<\/Shortcut>[ \t]*\r?\n?/,
    'the Start-menu shortcut',
  );
  let out = wxs.replace(start[0], '');
  // The desktop shortcut is optional in the template; replace it only when it is there.
  const desktop = /[ \t]*<Shortcut Id="desktopShortcut"[^>]*\/>[ \t]*\r?\n?/.exec(out);
  if (desktop) out = out.replace(desktop[0], '');

  const component = (kind: 'Start' | 'Desktop', scope: 'User' | 'Machine'): string => {
    const folder = kind === 'Start' ? 'ProgramMenuFolder' : 'DesktopFolder';
    const name = scope === 'User' ? shortcutNameUser : shortcutNameMachine;
    const condition = scope === 'User' ? USER_SCOPE_CONDITION : MACHINE_SCOPE_CONDITION;
    return [
      `      <Component Id="ThrongShortcut${kind}${scope}" Guid="*" Directory="APPLICATIONFOLDER">`,
      `        <Condition>${condition}</Condition>`,
      `        <Shortcut Id="Throng${kind}Shortcut${scope}" Directory="${folder}" Name="${attr(name)}" Target="[APPLICATIONFOLDER]throng.exe" WorkingDirectory="APPLICATIONFOLDER" Icon="throngIcon.exe" Advertise="no">`,
      '          <ShortcutProperty Key="System.AppUserModel.ID" Value="com.throng.throng"/>',
      '        </Shortcut>',
      `        <RegistryValue Root="HKCU" Key="${attr(registryKey)}" Name="${kind}Shortcut${scope}" Type="integer" Value="1" KeyPath="yes"/>`,
      '      </Component>',
    ].join('\n');
  };

  const components = [
    component('Start', 'User'),
    component('Start', 'Machine'),
    ...(desktop ? [component('Desktop', 'User'), component('Desktop', 'Machine')] : []),
  ].join('\n');

  return insertBefore(out, PRODUCT_COMPONENTS_END, `${components}\n`, 'the end of the ProductComponents group');
}

/**
 * FR-007, research D10 — the app started at the end of an elevated install is not elevated. The
 * template launches `throng.exe` straight from the installer's own (possibly elevated) process;
 * `explorer.exe` starts its target at the desktop's integrity level instead.
 */
export function launchThroughExplorer(wxs: string): string {
  const action = requireMatch(wxs, /<CustomAction Id="runAfterFinish"[^>]*\/>/, 'the runAfterFinish custom action');
  if (action[0].includes('explorer.exe')) return wxs;
  return wxs.replace(
    action[0],
    '<CustomAction Id="runAfterFinish" Directory="WindowsFolder" ExeCommand="&quot;[WindowsFolder]explorer.exe&quot; &quot;[APPLICATIONFOLDER]\\throng.exe&quot;" Execute="immediate" Impersonate="yes" Return="asyncNoWait"/>',
  );
}

/**
 * FR-016a, research D9 — the copy this one replaces or removes is asked who is using it, and setup
 * ends before changing anything when another account is. Where each scope's copy lives is remembered
 * in the registry (HKCU or HKLM, the hive of the scope), written by a component of this package and
 * read back by AppSearch before the dialogs. Skipped for an unattended run (`UILevel` 2): there the
 * restart-completion path applies, and no account's session is ended.
 */
export function addInUseCheck(wxs: string, options: MsiProjectOptions = {}): string {
  if (has(wxs, 'ThrongInUseCheck')) return wxs;
  const { registryKey } = { ...DEFAULTS, ...options };
  const key = attr(registryKey);

  const properties = [
    `    <Property Id="ThrongInUseScript" Value="${attr(IN_USE_SCRIPT)}"/>`,
    `    <Property Id="THRONG_PREV_USER"><RegistrySearch Id="ThrongPrevUser" Root="HKCU" Key="${key}" Name="InstallLocation" Type="directory"/></Property>`,
    `    <Property Id="THRONG_PREV_MACHINE"><RegistrySearch Id="ThrongPrevMachine" Root="HKLM" Key="${key}" Name="InstallLocation" Type="directory" Win64="yes"/></Property>`,
    '    <Property Id="THRONG_INUSE_ROOT" Secure="yes"/>',
    // Set by the UI sequence once it has asked, so the execute sequence does not ask again.
    '    <Property Id="THRONG_INUSE_CHECKED" Secure="yes"/>',
  ].join('\n');

  const powershell = '&quot;[WindowsFolder]System32\\WindowsPowerShell\\v1.0\\powershell.exe&quot;';
  const actions = [
    // Which copy is being replaced or removed. The trailing "." keeps a path that ends in a backslash
    // from escaping the closing quote on the command line; the script normalises it away.
    '    <CustomAction Id="ThrongInUseRootRemove" Property="THRONG_INUSE_ROOT" Value="[APPLICATIONFOLDER]"/>',
    '    <CustomAction Id="ThrongInUseRootMachine" Property="THRONG_INUSE_ROOT" Value="[THRONG_PREV_MACHINE]"/>',
    '    <CustomAction Id="ThrongInUseRootUser" Property="THRONG_INUSE_ROOT" Value="[THRONG_PREV_USER]"/>',
    `    <CustomAction Id="ThrongInUseCheck" Directory="TempFolder" ExeCommand="${powershell} -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -Command &quot;[ThrongInUseScript] \\&quot;[THRONG_INUSE_ROOT].\\&quot;&quot;" Execute="immediate" Return="check"/>`,
    '    <CustomAction Id="ThrongInUseChecked" Property="THRONG_INUSE_CHECKED" Value="1"/>',
  ].join('\n');

  // Which copy is being replaced or removed — the same three rows in both sequences.
  const roots = [
    '      <Custom Action="ThrongInUseRootRemove" Before="ThrongInUseCheck">REMOVE ~= "ALL"</Custom>',
    `      <Custom Action="ThrongInUseRootMachine" Before="ThrongInUseCheck">NOT Installed AND THRONG_PREV_MACHINE AND ${MACHINE_SCOPE_CONDITION}</Custom>`,
    `      <Custom Action="ThrongInUseRootUser" Before="ThrongInUseCheck">NOT Installed AND THRONG_PREV_USER AND ${USER_SCOPE_CONDITION}</Custom>`,
  ];

  // Two places, because the UI sequence is not reached on every interactive path (a removal begun from
  // Settings runs at basic UI). The execute sequence's immediate actions before InstallValidate run in
  // the client, in the user's session, and still ahead of the major upgrade's RemoveExistingProducts,
  // so a refusal there too changes nothing. It is skipped when the UI sequence has already asked.
  const sequence = [
    '    <InstallUISequence>',
    ...roots,
    '      <Custom Action="ThrongInUseCheck" Before="ExecuteAction">UILevel &gt; 2 AND THRONG_INUSE_ROOT</Custom>',
    '      <Custom Action="ThrongInUseChecked" After="ThrongInUseCheck">UILevel &gt; 2 AND THRONG_INUSE_ROOT</Custom>',
    '    </InstallUISequence>',
    '    <InstallExecuteSequence>',
    ...roots,
    '      <Custom Action="ThrongInUseCheck" Before="InstallValidate">UILevel &gt; 2 AND THRONG_INUSE_ROOT AND NOT THRONG_INUSE_CHECKED</Custom>',
    '    </InstallExecuteSequence>',
  ].join('\n');

  const location = [
    '      <Component Id="ThrongInstallLocation" Guid="*" Directory="APPLICATIONFOLDER">',
    `        <RegistryValue Root="HKMU" Key="${key}" Name="InstallLocation" Type="string" Value="[APPLICATIONFOLDER]" KeyPath="yes"/>`,
    '      </Component>',
  ].join('\n');

  const out = insertBefore(
    wxs,
    /[ \t]*<Directory Id="TARGETDIR"/,
    `${properties}\n${actions}\n${sequence}\n\n`,
    'the TARGETDIR directory',
  );
  return insertBefore(out, PRODUCT_COMPONENTS_END, `${location}\n`, 'the end of the ProductComponents group');
}

/**
 * FR-010a, research D10a — choosing "all users" while not elevated relaunches this MSI elevated, at
 * the scope page. Windows Installer would otherwise raise its prompt at the Install button, after
 * every dialog, and a declined prompt there ends the session; here a decline returns to the scope
 * page with the reason.
 *
 * When the elevated copy starts, {@link ELEVATE_SCRIPT} closes this wizard itself; when it does
 * not, this wizard is still here and the next event shows the declined dialog. No record of the
 * relaunch is kept: ending the session through a dialog event (`EndDialog Exit`) would show WixUI's
 * “installation was interrupted” page, and surviving the call is itself the signal. The template's
 * own scope-page events are replaced, because one of them (`NOT Privileged` forces per-user) would
 * silently override the choice.
 */
export function addElevationRelaunch(wxs: string): string {
  if (has(wxs, 'ThrongElevate')) return wxs;

  const nextEvents = /[ \t]*<Publish Dialog="InstallScopeDlg" Control="Next"[^\n]*\n/g;
  const first = requireMatch(wxs, /[ \t]*<Publish Dialog="InstallScopeDlg" Control="Next"[^\n]*\n/, 'the scope page Next events');
  requireMatch(wxs, /<UIRef Id="WixUI_InstallDir"\s*\/>/, 'the WixUI_InstallDir reference');

  // The template's comment about re-running FindRelatedProducts goes with its events.
  let out = wxs.replace(/[ \t]*<!-- Run 'FindRelatedProducts' again[^\n]*-->\r?\n/, '');
  const at = out.search(/[ \t]*<Publish Dialog="InstallScopeDlg" Control="Next"/);
  void first;
  out = out.replace(nextEvents, '');

  const machine = 'WixAppFolder = "WixPerMachineFolder"';
  const needsElevation = `${machine} AND NOT MsiRunningElevated`;
  const publish = (order: number, body: string, condition: string): string =>
    `        <Publish Dialog="InstallScopeDlg" Control="Next" ${body} Order="${order}">${condition}</Publish>`;

  const events = [
    '        <!-- 058 FR-010a: elevate at the scope page. A decline comes back here, with the reason. -->',
    // If the elevated copy starts, ThrongElevate closes this wizard from inside and nothing below runs.
    // So reaching the next event means the prompt was declined (or could not be shown).
    publish(2, 'Event="DoAction" Value="ThrongElevate"', needsElevation),
    publish(6, 'Event="NewDialog" Value="ThrongElevationDeclinedDlg"', needsElevation),
    publish(7, 'Property="ALLUSERS" Value="{}"', 'WixAppFolder = "WixPerUserFolder"'),
    publish(8, 'Property="ALLUSERS" Value="1"', `${machine} AND MsiRunningElevated`),
    // The folder tree was costed before this page, with ALLUSERS already rewritten to 1 by the engine,
    // so APPLICATIONFOLDER is the per-machine one whatever is chosen here. Re-point it for the choice.
    publish(9, 'Property="APPLICATIONFOLDER" Value="[LocalAppDataFolder]Programs\\[ApplicationFolderName]"', 'WixAppFolder = "WixPerUserFolder"'),
    publish(10, 'Property="APPLICATIONFOLDER" Value="[ProgramFiles64Folder][ApplicationFolderName]"', `${machine} AND MsiRunningElevated`),
    '        <!-- Run \'FindRelatedProducts\' again after changing the install scope, because its first run might have ignored an existing installation based on the default scope at the time. https://stackoverflow.com/a/35064434 -->',
    publish(11, 'Event="DoAction" Value="FindRelatedProducts"', `WixAppFolder = "WixPerUserFolder" OR MsiRunningElevated`),
    publish(12, 'Event="NewDialog" Value="VerifyReadyDlg"', 'WixAppFolder = "WixPerUserFolder"'),
    publish(13, 'Event="NewDialog" Value="InstallDirDlg"', `${machine} AND MsiRunningElevated`),
  ].join('\n');

  const insertAt = at === -1 ? out.search(/[ \t]*<Publish Dialog="InstallScopeDlg" Control="Back"/) : at;
  if (insertAt === -1) throw new Error('msi project transform: cannot find where the scope page events go');
  // After the Back event, which is kept; the Next events were removed from after it.
  const backEnd = out.indexOf('</Publish>', out.search(/<Publish Dialog="InstallScopeDlg" Control="Back"/));
  if (backEnd === -1) throw new Error('msi project transform: cannot find the scope page Back event');
  const lineEnd = out.indexOf('\n', backEnd);
  out = `${out.slice(0, lineEnd + 1)}\n${events}\n${out.slice(lineEnd + 1)}`;

  const powershell = '&quot;[WindowsFolder]System32\\WindowsPowerShell\\v1.0\\powershell.exe&quot;';
  const declined = [
    '      <Dialog Id="ThrongElevationDeclinedDlg" Width="370" Height="270" Title="[ProductName] Setup">',
    '        <Control Id="Title" Type="Text" X="15" Y="12" Width="340" Height="20" Transparent="yes" NoPrefix="yes" Text="{\\WixUI_Font_Title}Administrator approval needed"/>',
    `        <Control Id="Message" Type="Text" X="25" Y="50" Width="320" Height="90" Transparent="yes" NoPrefix="yes" Text="${attr(ELEVATION_DECLINED_TEXT)}"/>`,
    '        <Control Id="Back" Type="PushButton" X="236" Y="243" Width="56" Height="17" Default="yes" Cancel="yes" Text="OK">',
    '          <Publish Event="NewDialog" Value="InstallScopeDlg">1</Publish>',
    '        </Control>',
    '      </Dialog>',
  ].join('\n');

  const actions = [
    `    <Property Id="ThrongElevateScript" Value="${attr(ELEVATE_SCRIPT)}"/>`,
    `    <CustomAction Id="ThrongElevate" Directory="TempFolder" ExeCommand="${powershell} -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -Command &quot;[ThrongElevateScript] \\&quot;[OriginalDatabase]\\&quot;&quot;" Execute="immediate" Return="ignore"/>`,
    // WiX's scope page shows its two radio buttons only when `Privileged` is set (its ControlCondition
    // for BothScopes is `Privileged AND (1 AND 1)`), so a standard account saw a page with no choice
    // and could never ask for "all users" — which made this whole flow unreachable. Set for the
    // dialogs only (the UI sequence); whether elevation is needed is decided by MsiRunningElevated.
    '    <CustomAction Id="ThrongOfferBothScopes" Property="Privileged" Value="1"/>',
    '    <InstallUISequence>',
    '      <Custom Action="ThrongOfferBothScopes" After="CostFinalize">NOT Installed</Custom>',
    '    </InstallUISequence>',
    '    <UI>',
    declined,
    '    </UI>',
  ].join('\n');

  return insertBefore(out, /[ \t]*<Directory Id="TARGETDIR"/, `${actions}\n\n`, 'the TARGETDIR directory');
}

/**
 * FR-006 — a per-user install never asks for elevation. A package's summary information says whether
 * it needs elevated privileges, and the template leaves that at the default (needed), so Windows
 * would raise a prompt for EVERY run of this package, per-user included, before any dialog.
 * `InstallPrivileges="limited"` is what makes the dual-purpose scheme work: the package starts
 * unelevated, and a machine-wide install is elevated on demand (the scope page, or an elevated
 * caller). Measured on the template's output: summary word count 2 (elevation required), 10 once
 * limited.
 */
export function allowUnelevatedStart(wxs: string): string {
  const pkg = requireMatch(wxs, /<Package\b[^>]*\/?>/, 'the Package element');
  if (pkg[0].includes('InstallPrivileges=')) return wxs;
  return wxs.replace(pkg[0], pkg[0].replace(/\s*(\/?)>$/, ' InstallPrivileges="limited"$1>'));
}

/**
 * The custom actions above run from `TempFolder` and call tools by `WindowsFolder`; the template
 * declares neither, and the linker does not know them without a declaration.
 */
export function declareStandardFolders(wxs: string): string {
  if (has(wxs, 'TempFolder')) return wxs;
  const root = requireMatch(wxs, /<Directory Id="TARGETDIR" Name="SourceDir">[ \t]*\r?\n/, 'the TARGETDIR directory');
  const declared = '      <Directory Id="TempFolder"/>\n      <Directory Id="WindowsFolder"/>\n';
  return wxs.replace(root[0], root[0] + declared);
}

/**
 * Apply every throng-specific change to the project electron-builder generated.
 *
 * Order matters in one place only: the scope-page events are rewritten after the properties they
 * reference exist. Each step is independent otherwise.
 */
export function transformMsiProject(wxs: string, options: MsiProjectOptions = {}): string {
  let out = wxs;
  out = setInstallFolder(out, options);
  out = addScopeSelection(out);
  out = addProductNames(out, options);
  out = renameShortcuts(out, options);
  out = launchThroughExplorer(out);
  out = addInUseCheck(out, options);
  out = addElevationRelaunch(out);
  out = declareStandardFolders(out);
  out = allowUnelevatedStart(out);
  return out;
}
