import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { transformMsiProject } from '@throng/core';

/** 067 FR-029, FR-031, FR-032. Read from the script: what it does at install time is the hand-test plan's. */
const nsis = readFileSync(resolve(import.meta.dirname, '../../../../packaging/installer.nsh'), 'utf8');
const wxs = readFileSync(resolve(import.meta.dirname, '../../../core/tests/unit/fixtures/msi-template-output.wxs'), 'utf8');

describe('the NSIS setup (067)', () => {
  it('writes both verbs at the install scope, with the quoted path form', () => {
    expect(nsis).toContain('throngRegisterVerb "Software\\Classes\\Directory\\shell\\throng.OpenProject"');
    expect(nsis).toContain('throngRegisterVerb "Software\\Classes\\Directory\\Background\\shell\\throng.OpenProject"');
    expect(nsis).toContain('WriteRegStr SHELL_CONTEXT "${key}\\command" "" \'"$INSTDIR\\${APP_EXECUTABLE_FILENAME}" "%V"\'');
  });

  it('offers both options on a page, ticked unless unticked, and takes both when silent', () => {
    expect(nsis).toContain('Page custom throngOptionsShow throngOptionsLeave');
    expect(nsis.match(/\${NSD_Check}/g)).toHaveLength(2);
    expect(nsis).toContain('${If} $throngNoVerb != "1"');
    expect(nsis).toContain('${If} $throngNoPath != "1"');
    expect(nsis).toMatch(/!macro customInstall\r?\n[\s\S]*?throngEditPath "add"/);
  });

  it('removes all of it on uninstall, at the same scope', () => {
    const uninstall = nsis.slice(nsis.indexOf('!macro customUnInstall'));
    expect(uninstall).toContain('DeleteRegKey SHELL_CONTEXT "Software\\Classes\\Directory\\shell\\throng.OpenProject"');
    expect(uninstall).toContain('DeleteRegKey SHELL_CONTEXT "Software\\Classes\\Directory\\Background\\shell\\throng.OpenProject"');
    expect(uninstall).toContain('throngEditPath "remove"');
  });
});

describe('the MSI (067)', () => {
  const out = transformMsiProject(wxs);

  it('declares both properties, defaulting to on', () => {
    expect(out).toContain('<Property Id="THRONG_OPEN_AS_PROJECT" Value="1" Secure="yes"/>');
    expect(out).toContain('<Property Id="THRONG_ADD_TO_PATH" Value="1" Secure="yes"/>');
  });

  it('conditions the registration and PATH components on them', () => {
    expect(out).toMatch(/Id="ThrongOpenAsProject"[\s\S]*?THRONG_OPEN_AS_PROJECT/);
    expect(out).toMatch(/Id="ThrongAddToPathUser"[\s\S]*?THRONG_ADD_TO_PATH/);
    expect(out).toMatch(/Id="ThrongAddToPathMachine"[\s\S]*?THRONG_ADD_TO_PATH/);
  });

  it('writes both verbs, at the install scope', () => {
    expect(out).toContain('Root="HKMU" Key="Software\\Classes\\Directory\\shell\\throng.OpenProject\\command"');
    expect(out).toContain('Root="HKMU" Key="Software\\Classes\\Directory\\Background\\shell\\throng.OpenProject\\command"');
  });

  it('gives every registry-keyed component its own key path, so no two Guid="*" components collide', () => {
    // WiX derives a `Guid="*"` component's GUID from its key path. Two components keyed on the same
    // registry value get the same GUID, and light.exe refuses the package (LGHT1137) — alpha16's
    // release build failed exactly so, on the user and machine PATH components.
    const keyPaths = [...out.matchAll(/<RegistryValue\b(?=[^>]*KeyPath="yes")[^>]*>/g)].map((m) => {
      const attr = (name: string): string => new RegExp(`${name}="([^"]*)"`).exec(m[0])?.[1] ?? '';
      return `${attr('Root')}\\${attr('Key')}\\${attr('Name')}`;
    });
    expect(keyPaths.length).toBeGreaterThanOrEqual(3);
    expect(new Set(keyPaths).size).toBe(keyPaths.length);
  });

  it('is idempotent', () => {
    expect(transformMsiProject(out)).toBe(out);
  });
});
