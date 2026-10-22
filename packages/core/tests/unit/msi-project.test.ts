import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  addElevationRelaunch,
  addInUseCheck,
  addProductNames,
  addScopeSelection,
  allowUnelevatedStart,
  declareStandardFolders,
  ELEVATION_DECLINED_TEXT,
  MACHINE_SCOPE_CONDITION,
  launchThroughExplorer,
  renameShortcuts,
  setInstallFolder,
  transformMsiProject,
} from '../../src/config/msi-project.js';

/**
 * 058 research D1 — the MSI is electron-builder's template output, rewritten by `transformMsiProject`.
 * These tests run it over a captured copy of that output (`fixtures/msi-template-output.wxs`, taken
 * from app-builder-lib 26.17.0), so each transform is proved against the real template rather than
 * only by building an MSI. What they cannot prove is behaviour at install time: the verification
 * matrix does that on a real machine.
 *
 * Layer: unit — pure text in, text out. Compiling the result with WiX is what T041 does.
 */

const FIXTURE = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'msi-template-output.wxs'),
  'utf8',
);
const out = transformMsiProject(FIXTURE);

/** The `<Custom …>` rows of one sequence, as `{ action, before, condition }`. */
function sequenceRows(wxs: string, name: 'InstallUISequence' | 'InstallExecuteSequence') {
  const blocks = [...wxs.matchAll(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, 'g'))].map((m) => m[1]);
  return blocks
    .join('\n')
    .split('\n')
    .map((line) => /<Custom Action="([^"]+)" (Before|After)="([^"]+)">([^<]*)<\/Custom>/.exec(line))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => ({ action: m[1], position: m[2], anchor: m[3], condition: m[4] }));
}

/** An element's whole opening tag by Id. */
function tag(wxs: string, element: string, id: string): string {
  const match = new RegExp(`<${element} Id="${id}"[^>]*>`).exec(wxs);
  if (!match) throw new Error(`no <${element} Id="${id}"> in the output`);
  return match[0];
}

describe('the fixture is the template output these transforms were written against', () => {
  it('names the template version it came from', () => {
    expect(FIXTURE).toMatch(/app-builder-lib 26\.17\.0/);
  });
});

describe('the install folder (FR-017a)', () => {
  it('is “throng MSI”, in the property and in the directory', () => {
    expect(out).toContain('<Property Id="ApplicationFolderName" Value="throng MSI"/>');
    expect(out).toContain('<Directory Id="APPLICATIONFOLDER" Name="throng MSI"/>');
  });

  it('is overridable', () => {
    expect(setInstallFolder(FIXTURE, { folderName: 'x' })).toContain('<Directory Id="APPLICATIONFOLDER" Name="x"/>');
  });
});

describe('the scope (FR-003a, research D2)', () => {
  // Windows Installer fixes the install context from the command line or the UI sequence, never from
  // an execute-sequence action — a measured result (rehearsal 39488425858): an elevated
  // `THRONG_SCOPE=user` still installed machine-wide. So the unattended switches are the standard
  // ones, and the default is Windows Installer's own ALLUSERS=2 behaviour.
  it('has no private scope switch: no THRONG_SCOPE property, no ThrongScope actions', () => {
    expect(out).not.toContain('THRONG_SCOPE');
    expect(out).not.toMatch(/Id="ThrongScope/);
  });

  it('leaves MSIINSTALLPERUSER out of the Property table (secure, no value), so an elevated run is machine-wide natively', () => {
    expect(out).toContain('<Property Id="MSIINSTALLPERUSER" Secure="yes"/>');
    expect(out).not.toMatch(/<Property Id="MSIINSTALLPERUSER"[^>]*Value=/);
  });

  it('treats the resolved context as machine-wide only when elevated, not forced per-user, and ALLUSERS is 1 or 2', () => {
    expect(MACHINE_SCOPE_CONDITION).toBe('(MsiRunningElevated AND NOT MSIINSTALLPERUSER AND (ALLUSERS = "1" OR ALLUSERS = "2"))');
    // the folder, the product name and the shortcuts all key off that, not off a private switch
    const names = sequenceRows(out, 'InstallExecuteSequence').find((r) => r.action === 'ThrongProductNameMachine')!;
    expect(names.condition).toBe(MACHINE_SCOPE_CONDITION);
  });

  it('does not change the scope from any execute-sequence action', () => {
    const changes = (id: string) =>
      new RegExp(`<CustomAction Id="${id}"[^>]*Property="(ALLUSERS|MSIINSTALLPERUSER)"`).test(out);
    for (const sequence of ['InstallUISequence', 'InstallExecuteSequence'] as const) {
      for (const row of sequenceRows(out, sequence)) expect(changes(row.action), row.action).toBe(false);
    }
  });

  it('opens the scope page on “all users” only for an elevated run, and on per-user for a standard account (whatever the engine did to ALLUSERS)', () => {
    const rows = sequenceRows(out, 'InstallUISequence');
    const machine = rows.find((r) => r.action === 'ThrongAppFolderMachine')!;
    const user = rows.find((r) => r.action === 'ThrongAppFolderUser')!;
    expect(machine).toMatchObject({ position: 'Before', anchor: 'FindRelatedProducts' });
    expect(machine.condition).toContain('MsiRunningElevated');
    expect(machine.condition).toBe(MACHINE_SCOPE_CONDITION);
    expect(machine.condition).toContain('NOT MSIINSTALLPERUSER');
    expect(user.condition).toContain('NOT');
    expect(tag(out, 'CustomAction', 'ThrongAppFolderMachine')).toContain('Value="WixPerMachineFolder"');
    expect(tag(out, 'CustomAction', 'ThrongAppFolderUser')).toContain('Value="WixPerUserFolder"');
  });

  it('keys on MsiRunningElevated and never on Privileged or AdminUser, which are true for an unelevated administrator', () => {
    const all = sequenceRows(out, 'InstallUISequence').map((r) => r.condition).join(' ');
    expect(all).not.toMatch(/\bPrivileged\b|\bAdminUser\b/);
  });

  it('never restarts the computer itself: REBOOT=ReallySuppress is the package default (FR-016a)', () => {
    // Under /qn with REBOOT unset, Windows Installer restarts the machine when files are in use, which
    // ends every other account’s terminals — what FR-016a forbids. 3010 reports a restart is needed;
    // an administrator can still pass REBOOT=Force.
    expect(out).toContain('<Property Id="REBOOT" Value="ReallySuppress"/>');
  });

  it('stops Restart Manager shutting down another account’s throng (FR-015)', () => {
    expect(out).toContain('<Property Id="MSIRESTARTMANAGERCONTROL" Value="Disable"/>');
  });
});

describe('the registered name (FR-017b)', () => {
  it('sets ProductName per scope before costing, in both sequences', () => {
    for (const sequence of ['InstallUISequence', 'InstallExecuteSequence'] as const) {
      const rows = sequenceRows(out, sequence);
      const user = rows.find((r) => r.action === 'ThrongProductNameUser')!;
      const machine = rows.find((r) => r.action === 'ThrongProductNameMachine')!;
      expect(user).toMatchObject({ position: 'Before', anchor: 'CostInitialize' });
      expect(machine).toMatchObject({ position: 'Before', anchor: 'CostInitialize' });
      expect(user.condition).toContain('NOT');
      expect(machine.condition).not.toMatch(/^\(NOT /);
    }
    expect(tag(out, 'CustomAction', 'ThrongProductNameUser')).toContain('Property="ProductName" Value="throng (MSI, per-user)"');
    expect(tag(out, 'CustomAction', 'ThrongProductNameMachine')).toContain('Property="ProductName" Value="throng (MSI, all users)"');
  });

  it('names the shortcuts for the scope, one component per scope, replacing the template’s single pair', () => {
    expect(out).not.toContain('Id="startMenuShortcut"');
    expect(out).not.toContain('Id="desktopShortcut"');
    expect(out).toMatch(/Name="throng MSI \(per-user\)"/);
    expect(out).toMatch(/Name="throng MSI \(all users\)"/);
    for (const id of ['ThrongShortcutStartUser', 'ThrongShortcutStartMachine', 'ThrongShortcutDesktopUser', 'ThrongShortcutDesktopMachine']) {
      expect(out).toContain(`<Component Id="${id}"`);
    }
  });

  it('installs each shortcut component only in its own scope', () => {
    const user = /<Component Id="ThrongShortcutStartUser"[\s\S]*?<Condition>([^<]*)<\/Condition>/.exec(out)![1];
    const machine = /<Component Id="ThrongShortcutStartMachine"[\s\S]*?<Condition>([^<]*)<\/Condition>/.exec(out)![1];
    expect(user).toContain('NOT');
    expect(machine).toContain('ALLUSERS = "1"');
  });

  it('keeps the application user model id on the new shortcuts, so a pinned taskbar item still resolves', () => {
    expect(out.match(/System\.AppUserModel\.ID" Value="com\.throng\.throng"/g)?.length).toBe(4);
  });

  it('leaves every other file component alone', () => {
    expect(out).toContain('Id="mainExecutable"');
    expect((out.match(/<Component[ >]/g) ?? []).length).toBe((FIXTURE.match(/<Component[ >]/g) ?? []).length + 5);
  });
});

describe('the app started at the end of the install (FR-007, research D10)', () => {
  it('is launched through explorer.exe, so it runs at the desktop’s integrity level', () => {
    const action = tag(out, 'CustomAction', 'runAfterFinish');
    expect(action).toContain('explorer.exe');
    // The folder has no trailing backslash once the folder page has set it (measured: "...\throng MSI"
    // + "throng.exe" made "...\throng MSIthrong.exe" and explorer opened Documents instead), so the
    // separator is written out; a doubled one is harmless.
    expect(action).toContain('[APPLICATIONFOLDER]\\throng.exe');
    expect(action).not.toContain('FileKey=');
  });
});

describe('another account using the copy (FR-016a, research D9)', () => {
  it('runs the existing copy’s own runtime on its own in-use helper', () => {
    const script = /Id="ThrongInUseScript" Value="([^"]*)"/.exec(out)![1];
    expect(script).toContain('resources\\runtime\\node.exe');
    expect(script).toContain('resources\\in-use\\in-use.mjs');
  });

  it('is skipped when no copy of this scope is installed: the helper is only asked about a root that exists', () => {
    const rows = sequenceRows(out, 'InstallUISequence');
    expect(rows.find((r) => r.action === 'ThrongInUseRootMachine')!.condition).toContain('THRONG_PREV_MACHINE');
    expect(rows.find((r) => r.action === 'ThrongInUseRootUser')!.condition).toContain('THRONG_PREV_USER');
    expect(rows.find((r) => r.action === 'ThrongInUseCheck')!.condition).toContain('THRONG_INUSE_ROOT');
  });

  it('checks the machine-wide copy only for a machine-wide install, and the per-user copy only for a per-user one', () => {
    const rows = sequenceRows(out, 'InstallUISequence');
    expect(rows.find((r) => r.action === 'ThrongInUseRootMachine')!.condition).toContain('ALLUSERS = "1"');
    expect(rows.find((r) => r.action === 'ThrongInUseRootUser')!.condition).toContain('NOT (MsiRunningElevated');
  });

  it('also checks the copy being removed', () => {
    expect(sequenceRows(out, 'InstallUISequence').find((r) => r.action === 'ThrongInUseRootRemove')!.condition).toBe('REMOVE ~= "ALL"');
  });

  it('runs in an unattended run never: it needs a person to read the refusal', () => {
    for (const sequence of ['InstallUISequence', 'InstallExecuteSequence'] as const) {
      const check = sequenceRows(out, sequence).find((r) => r.action === 'ThrongInUseCheck')!;
      expect(check.condition, sequence).toContain('UILevel &gt; 2');
    }
  });

  it('runs in the UI sequence, after the wizard and before anything is changed', () => {
    const check = sequenceRows(out, 'InstallUISequence').find((r) => r.action === 'ThrongInUseCheck')!;
    expect(check.anchor).toBe('ExecuteAction');
  });

  it('also runs in the execute sequence, for a basic-UI removal or upgrade the UI sequence does not reach', () => {
    const check = sequenceRows(out, 'InstallExecuteSequence').find((r) => r.action === 'ThrongInUseCheck')!;
    // Before the major upgrade removes the old product (RemoveExistingProducts follows InstallValidate),
    // so “refuse before changing anything” holds on this path too.
    expect(check).toMatchObject({ position: 'Before', anchor: 'InstallValidate' });
    // …but not a second time when the UI sequence already ran it and let the install through.
    expect(check.condition).toContain('NOT THRONG_INUSE_CHECKED');
    const marked = sequenceRows(out, 'InstallUISequence').find((r) => r.action === 'ThrongInUseChecked')!;
    expect(marked).toMatchObject({ position: 'After', anchor: 'ThrongInUseCheck' });
    expect(out).toContain('<Property Id="THRONG_INUSE_CHECKED" Secure="yes"/>');
  });

  it('works out which copy to ask about in the execute sequence too', () => {
    const actions = sequenceRows(out, 'InstallExecuteSequence').map((r) => r.action);
    for (const root of ['ThrongInUseRootRemove', 'ThrongInUseRootMachine', 'ThrongInUseRootUser']) expect(actions).toContain(root);
  });

  it('counts a throng or node process whose path cannot be read as another account, for a machine-wide copy', () => {
    // An unelevated caller cannot read another account's process path, so the helper — which matches
    // by path — would see nothing. Name is always readable.
    const script = /Id="ThrongInUseScript" Value="([^"]*)"/.exec(out)![1];
    expect(script).toContain('throng.exe');
    expect(script).toContain('node.exe');
    expect(script).toMatch(/-not \$_\.ExecutablePath/);
    expect(script).toMatch(/ProgramFiles/);
    expect(script).toMatch(/could not be identified/);
  });

  it('applies that conservative check even when the copy has no helper to ask (a pre-058 copy)', () => {
    const script = /Id="ThrongInUseScript" Value="([^"]*)"/.exec(out)![1];
    expect(script.indexOf('Test-Path $helper')).toBeLessThan(script.indexOf('could not be identified'));
    // The helper's absence must not be an early `exit 0` ahead of the conservative check.
    expect(script.slice(0, script.indexOf('could not be identified'))).not.toMatch(/exit 0/);
  });

  it('ends the session itself after showing who, so the engine raises no second notice (one condition, one notice)', () => {
    // Failing the action made Windows Installer add its own "a program run as part of the setup did not
    // finish as expected" notice after ours (hand test MT-05). Like the elevation script, this one stops
    // its parent msiexec once the message has been shown; the failing exit stays only as the fallback
    // for a parent that is not msiexec, so nothing is ever changed.
    const script = /Id="ThrongInUseScript" Value="([^"]*)"/.exec(out)![1];
    const popup = script.indexOf('Popup');
    const stop = script.indexOf('Stop-Process');
    const failing = script.indexOf('exit 1');
    expect(popup).toBeGreaterThan(-1);
    expect(stop).toBeGreaterThan(popup);
    expect(failing).toBeGreaterThan(stop);
    expect(script).toMatch(/ProcessName -eq 'msiexec'/);
  });

  it('fails the setup, rather than ignoring the result, so nothing is changed when another account is in use', () => {
    expect(tag(out, 'CustomAction', 'ThrongInUseCheck')).toContain('Return="check"');
  });

  it('remembers where each scope’s copy is installed, and searches the hive of that scope', () => {
    expect(out).toMatch(/<RegistryValue Root="HKMU" Key="Software\\throng MSI" Name="InstallLocation" Type="string" Value="\[APPLICATIONFOLDER\]" KeyPath="yes"\/>/);
    expect(out).toMatch(/Id="ThrongPrevUser" Root="HKCU"/);
    expect(out).toMatch(/Id="ThrongPrevMachine" Root="HKLM"[^>]*Win64="yes"/);
  });
});

describe('starting without elevation (FR-006)', () => {
  it('declares the package as needing no elevation, so a per-user run never prompts', () => {
    expect(FIXTURE).not.toContain('InstallPrivileges');
  });

  it('adds InstallPrivileges="limited" to the Package element only', () => {
    expect(out).toMatch(/<Package [^>]*InstallPrivileges="limited"[^>]*\/>/);
    expect(out.match(/InstallPrivileges=/g)?.length).toBe(1);
  });
});

describe('the embedded PowerShell (058 research D9, D10a)', () => {
  /** Every Property row the transform adds to carry a script. */
  const scripts = [...out.matchAll(/<Property Id="(Throng\w*Script)" Value="([^"]*)"/g)].map((m) => ({
    id: m[1],
    text: m[2],
  }));

  it('carries each script in a private Property, so Windows Installer’s formatter never rewrites it', () => {
    expect(scripts.map((s) => s.id).sort()).toEqual(['ThrongElevateScript', 'ThrongInUseScript']);
  });

  it('holds no double quote in any script: one would end the -Command argument it is substituted into', () => {
    for (const { id, text } of scripts) {
      expect(text, id).not.toContain('&quot;');
      expect(text, id).not.toContain('"');
    }
  });
});

describe('downgrade (FR-025)', () => {
  it('keeps the template’s MajorUpgrade refusal and its message, so an older MSI over this copy is refused', () => {
    expect(out).toMatch(/<MajorUpgrade [^>]*DowngradeErrorMessage='A newer version of "\[ProductName\]" is already installed\.'/);
  });
});

describe('the scope choice is offered to a standard account (FR-010a, research D10a)', () => {
  // WiX's scope page shows its radio buttons only when `Privileged` is set, so a standard account got
  // a page with no choice at all ("will be installed in a per-user folder", no way to ask for all
  // users) and the elevate-at-the-scope-page flow was unreachable. Measured on a hosted runner: the
  // built package's ControlCondition for BothScopes is `Privileged AND (1 AND 1)`.
  it('sets Privileged for the dialogs, before the wizard opens, in the UI sequence only', () => {
    expect(tag(out, 'CustomAction', 'ThrongOfferBothScopes')).toContain('Property="Privileged" Value="1"');
    const row = sequenceRows(out, 'InstallUISequence').find((r) => r.action === 'ThrongOfferBothScopes')!;
    expect(row).toMatchObject({ position: 'After', anchor: 'CostFinalize' });
    expect(sequenceRows(out, 'InstallExecuteSequence').some((r) => r.action === 'ThrongOfferBothScopes')).toBe(false);
  });

  it('re-points the install folder when the scope is chosen, because it was costed before the choice', () => {
    // The engine costs the folder tree before the dialogs, with ALLUSERS already rewritten to 1, so
    // APPLICATIONFOLDER was "C:\Program Files\throng MSI\" for a standard account that then chose
    // per-user: the install ran as that account into a folder it cannot write, and nothing installed.
    const events = [...out.matchAll(/<Publish Dialog="InstallScopeDlg" Control="Next" Property="APPLICATIONFOLDER" Value="([^"]*)"[^>]*>([^<]*)<\/Publish>/g)].map((m) => ({ value: m[1], condition: m[2] }));
    const user = events.find((e) => e.condition === 'WixAppFolder = "WixPerUserFolder"')!;
    expect(user.value).toBe('[LocalAppDataFolder]Programs\\[ApplicationFolderName]');
    const machine = events.find((e) => e.condition.includes('WixPerMachineFolder'))!;
    expect(machine.value).toBe('[ProgramFiles64Folder][ApplicationFolderName]');
    expect(machine.condition).toContain('MsiRunningElevated');
  });

  it('is not used to decide elevation: that is MsiRunningElevated, never the property the dialogs read', () => {
    for (const event of out.matchAll(/<Publish Dialog="InstallScopeDlg" Control="Next"[^>]*>([^<]*)<\/Publish>/g)) {
      expect(event[1]).not.toMatch(/\bPrivileged\b/);
    }
  });
});

describe('elevation at the scope page (FR-010a, research D10a)', () => {
  const nextEvents = [...out.matchAll(/<Publish Dialog="InstallScopeDlg" Control="Next" ([^>]*)>([^<]*)<\/Publish>/g)].map((m) => ({
    attrs: m[1],
    condition: m[2],
    order: Number(/Order="(\d+)"/.exec(m[1])![1]),
  }));
  const event = (value: string) => nextEvents.find((e) => e.attrs.includes(`Value="${value}"`) && e.attrs.includes('Event='))!;

  it('replaces the template’s events: none forces per-user for a non-elevated run', () => {
    expect(nextEvents.length).toBeGreaterThan(0);
    expect(nextEvents.some((e) => e.condition.includes('Privileged'))).toBe(false);
  });

  it('relaunches elevated, with the machine scope, when “all users” is chosen without elevation', () => {
    const relaunch = event('ThrongElevate');
    expect(relaunch.condition).toBe('WixAppFolder = "WixPerMachineFolder" AND NOT MsiRunningElevated');
    const script = /Id="ThrongElevateScript" Value="([^"]*)"/.exec(out)![1];
    expect(script).toContain('-Verb RunAs');
    expect(script).toContain('ALLUSERS=1');
    expect(script).not.toContain('THRONG_SCOPE');
  });

  it('ends the unelevated session itself, only once the elevated one has started', () => {
    const script = /Id="ThrongElevateScript" Value="([^"]*)"/.exec(out)![1];
    expect(script).toContain('catch');
    // The parent is the msiexec that is running this wizard: stopping it closes the wizard without
    // WixUI's “installation was interrupted” page, which every dialog-driven exit shows.
    expect(script).toMatch(/ParentProcessId/);
    expect(script).toMatch(/msiexec/);
    expect(script.indexOf('Start-Process')).toBeLessThan(script.indexOf('Stop-Process'));
    // …and only after Start-Process, inside the try, so a declined prompt (which throws) skips it.
    expect(script.indexOf('Stop-Process')).toBeLessThan(script.indexOf('catch'));
  });

  it('does not end the session through a dialog event, which would show the interrupted page', () => {
    expect(nextEvents.some((e) => e.attrs.includes('Event="EndDialog"'))).toBe(false);
  });

  it('needs no record of the relaunch: reaching the next event means it was declined', () => {
    expect(out).not.toContain('THRONG_ELEVATION_STARTED');
    expect(out).not.toContain('throng-msi-setup');
    expect(out).not.toContain('ThrongElevateCleanup');
  });

  it('shows the declined text and comes back to the scope page when it was declined', () => {
    const declined = event('ThrongElevationDeclinedDlg');
    expect(declined.condition).toBe('WixAppFolder = "WixPerMachineFolder" AND NOT MsiRunningElevated');
    expect(event('ThrongElevate').order).toBeLessThan(declined.order);
    expect(out).toContain(attrEscaped(ELEVATION_DECLINED_TEXT));
    expect(out).toMatch(/Dialog Id="ThrongElevationDeclinedDlg"[\s\S]*?<Publish Event="NewDialog" Value="InstallScopeDlg">/);
  });

  it('never carries on to the next page in the same click when elevation was needed and not given', () => {
    for (const value of ['VerifyReadyDlg', 'InstallDirDlg']) {
      const next = event(value);
      expect(next.condition).toMatch(/WixPerUserFolder|MsiRunningElevated/);
    }
    expect(event('InstallDirDlg').condition).toContain('MsiRunningElevated');
  });

});

describe('every transform, on its own', () => {
  const each: [string, (w: string) => string][] = [
    ['setInstallFolder', (w) => setInstallFolder(w)],
    ['addScopeSelection', addScopeSelection],
    ['addProductNames', (w) => addProductNames(w)],
    ['renameShortcuts', (w) => renameShortcuts(w)],
    ['launchThroughExplorer', launchThroughExplorer],
    ['addInUseCheck', (w) => addInUseCheck(w)],
    ['addElevationRelaunch', addElevationRelaunch],
    ['declareStandardFolders', declareStandardFolders],
    ['allowUnelevatedStart', allowUnelevatedStart],
  ];

  it.each(each)('%s is idempotent', (_name, transform) => {
    const once = transform(FIXTURE);
    expect(once).not.toBe(FIXTURE);
    expect(transform(once)).toBe(once);
  });

  it('the whole transform is idempotent', () => {
    expect(transformMsiProject(out)).toBe(out);
  });

  it.each(each)('%s throws, naming what it could not find, when the template has changed', (_name, transform) => {
    expect(() => transform('<Wix><Product Id="*"></Product></Wix>')).toThrowError(/cannot find|template/i);
  });
});

/** The text as it appears inside an XML attribute. */
function attrEscaped(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
