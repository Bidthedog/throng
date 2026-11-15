import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { WINDOWS_HOST_TRAITS, defaultPipeName, hostTraits, normaliseForCompare, shippedBindingsFor, trashTerm } from '@throng/core';
import { LinuxPlatformInfo, LinuxShellDetection } from '@throng/platform-linux';
import {
  NodePtyHost,
  WindowsDirectoryLock,
  WindowsOrphanProcesses,
  WindowsPlatformInfo,
  WindowsProcessCwd,
  WindowsShellDetection,
  WindowsUserDirectories,
} from '@throng/platform-windows';
import { runCommandLineInstallContract } from '@throng/core/testing';
import { MacosPlatformInfo, MacosUserDirectories } from '@throng/platform-macos';
import { PosixDirectoryLock, PosixPathForms, PosixShellDetection } from '@throng/platform-node';
import { UnsupportedPlatformError, selectPlatform, type PlatformServices } from '@throng/platform';

describe('selectPlatform (062 FR-007, FR-050)', () => {
  it('gives Windows the classes it has always had (FR-009)', () => {
    const windows = selectPlatform('win32');
    expect(windows.platformInfo()).toBeInstanceOf(WindowsPlatformInfo);
    expect(windows.shellDetection()).toBeInstanceOf(WindowsShellDetection);
    expect(windows.directoryLock()).toBeInstanceOf(WindowsDirectoryLock);
    expect(windows.processCwd()).toBeInstanceOf(WindowsProcessCwd);
    expect(windows.ptyHost()).toBeInstanceOf(NodePtyHost);
    expect(windows.orphanProcesses()).toBeInstanceOf(WindowsOrphanProcesses);
    expect(windows.userDirectories()).toBeInstanceOf(WindowsUserDirectories);
    expect(windows.traits()).toEqual(WINDOWS_HOST_TRAITS);
    expect(windows.startupRefusal()).toBeNull();
  });

  it('gives Linux its own', () => {
    const linux = selectPlatform('linux');
    expect(linux.platformInfo()).toBeInstanceOf(LinuxPlatformInfo);
    expect(linux.shellDetection()).toBeInstanceOf(LinuxShellDetection);
    expect(linux.elevation().isElevated()).toBe(false);
    expect(linux.deElevatedLauncher().isAvailable()).toBe(false);
    expect(linux.foregroundHandoff().allow()).toBe(false);
  });

  it('asks for XWayland on Linux unless the user chose native Wayland, and nothing on Windows (FR-028)', () => {
    expect(selectPlatform('linux').displaySwitches(false)).toEqual([['ozone-platform', 'x11']]);
    expect(selectPlatform('linux').displaySwitches(true)).toEqual([]);
    expect(selectPlatform('win32').displaySwitches(false)).toEqual([]);
  });

  it('offers a taskbar overlay only where Electron has one (FR-008)', () => {
    expect(selectPlatform('win32').hasTaskbarOverlay).toBe(true);
    expect(selectPlatform('linux').hasTaskbarOverlay).toBe(false);
  });

  it('refuses a platform with no set, naming it, rather than using another', () => {
    expect(() => selectPlatform('freebsd')).toThrow(UnsupportedPlatformError);
    expect(() => selectPlatform('freebsd')).toThrow(/freebsd/);
    expect(() => selectPlatform('aix')).toThrow(UnsupportedPlatformError);
  });
});

/** 070 FR-011, superseding 062 FR-050's darwin refusal: macOS has a set of its own, never another platform's. */
describe('selectPlatform on macOS', () => {
  const macos = selectPlatform('darwin');

  it('answers with the macOS set, not the Windows or Linux one', () => {
    expect(macos).not.toBe(selectPlatform('linux'));
    expect(macos).not.toBe(selectPlatform('win32'));
    expect(macos.platformInfo()).toBeInstanceOf(MacosPlatformInfo);
    expect(macos.platformInfo().osName()).toBe('macos');
    expect(macos.userDirectories()).toBeInstanceOf(MacosUserDirectories);
  });

  it('shares the POSIX classes Linux uses, under their neutral names', () => {
    expect(macos.shellDetection()).toBeInstanceOf(PosixShellDetection);
    expect(macos.directoryLock()).toBeInstanceOf(PosixDirectoryLock);
    expect(macos.pathForms()).toBeInstanceOf(PosixPathForms);
    expect(macos.elevation().isElevated()).toBe(false);
    expect(macos.deElevatedLauncher().isAvailable()).toBe(false);
    expect(macos.foregroundHandoff().allow()).toBe(false);
  });

  it('reports the concepts macOS lacks as absent (FR-013)', async () => {
    expect(macos.hasTaskbarOverlay).toBe(false);
    expect(macos.displaySwitches(false)).toEqual([]);
    expect(macos.displaySwitches(true)).toEqual([]);
    expect(macos.osPropertiesDialog().available).toBe(false);
    expect((await macos.fileManagerRegistration({ execPath: '/x', home: '/Users/dev', installed: true }).status()).state).toBe('unavailable');
    expect(await macos.lookupHolder('/Users/dev/p')).toBeUndefined();
  });

  it('ends a daemon whose bundle is gone, as Linux does (063 FR-013)', () => {
    expect(macos.exitWhenEntryRemoved).toBe(true);
  });

  it('has a class of its own behind every entry, with no stand-in left (T062)', () => {
    const built = buildEvery(macos);
    expect(built.length).toBeGreaterThan(25);
    for (const { name, made } of built) {
      expect(() => (made as { constructor?: unknown } | null)?.constructor, name).not.toThrow();
    }
    const source = readFileSync(resolve(import.meta.dirname, '../../src/index.ts'), 'utf8');
    expect(source).not.toMatch(/not yet implemented on macOS|notYetOnMacos/);
  });
});

/** 070's three new entries carry every platform's value at once, so none needs a stand-in. */
describe('the entries 070 adds', () => {
  it('give Windows and Linux their frameless window and macOS the native traffic lights (FR-026, R16)', () => {
    expect(selectPlatform('win32').windowChrome()).toEqual({ frame: false });
    expect(selectPlatform('linux').windowChrome()).toEqual({ frame: false });
    const chrome = selectPlatform('darwin').windowChrome();
    expect(chrome.titleBarStyle).toBe('hidden');
    expect(chrome.frame).toBeUndefined();
    expect(chrome.trafficLightPosition).toEqual({ x: expect.any(Number), y: expect.any(Number) });
  });

  it('name the privacy-protected folders on macOS only (FR-025, R14)', () => {
    expect(selectPlatform('win32').privacyProtectedRoots('C:\\Users\\dev')).toEqual([]);
    expect(selectPlatform('linux').privacyProtectedRoots('/home/dev')).toEqual([]);
    expect(selectPlatform('darwin').privacyProtectedRoots('/Users/dev/')).toEqual([
      '/Users/dev/Desktop',
      '/Users/dev/Documents',
      '/Users/dev/Downloads',
      '/Users/dev/Library/Mobile Documents/com~apple~CloudDocs',
      '/Volumes',
    ]);
  });

  it('offer no command install where the installer owns the command (FR-024a, R20)', async () => {
    for (const os of ['win32', 'linux']) {
      await runCommandLineInstallContract(() => selectPlatform(os).commandLineInstall({ execPath: '/x' }));
      const install = selectPlatform(os).commandLineInstall({ execPath: '/x' });
      expect(install.available).toBe(false);
      expect(install.unavailableReason).toMatch(/installer/);
      await expect(install.install({ replaceOther: false })).rejects.toThrow(/installer/);
    }
  });
});

/** What each factory entry of a set builds. `traits` makes this process's socket folder, so it is left out. */
function buildEvery(services: PlatformServices): { name: string; made: unknown }[] {
  const built: { name: string; made: unknown }[] = [];
  for (const [name, entry] of Object.entries(services)) {
    if (typeof entry !== 'function' || name === 'traits') continue;
    const arg =
      name === 'privacyProtectedRoots' || name === 'lookupHolder' ? '/Users/dev' : { execPath: '/x', home: '/Users/dev', installed: false };
    built.push({ name, made: (entry as (arg: unknown) => unknown)(arg) });
  }
  return built;
}

describe('Windows values are byte-identical (062 FR-009, US6)', () => {
  it('path identity folds case and separators', () => {
    expect(normaliseForCompare('C:\\Users\\Dev\\')).toBe('c:/users/dev');
  });

  it('the default pipe keeps its name', () => {
    expect(defaultPipeName('dev')).toMatch(/^\\\\\.\\pipe\\throng\.dev\.[0-9a-f]{8}\.daemon$/);
  });

  it('the bindings and the word for the bin are unchanged', () => {
    expect(shippedBindingsFor('windows').bindings['focus.up']).toEqual(['Ctrl+Shift+Alt+ArrowUp']);
    expect(trashTerm('windows')).toBe('Recycle Bin');
  });

  it('this test ran under the Windows defaults', () => {
    expect(hostTraits()).toEqual(WINDOWS_HOST_TRAITS);
  });
});

/** T049: a forgotten entry would silently run Windows rules on Linux, so every entry is read and checked (FR-050). */
describe('every process entry starts its platform first', () => {
  const ui = resolve(import.meta.dirname, '../../../ui/src');
  const daemon = resolve(import.meta.dirname, '../../../daemon/src');
  const entries: readonly (readonly [string, string])[] = [
    ['UI main', join(ui, 'main/main.ts')],
    ['daemon', join(daemon, 'composition-root.ts')],
    ['PTY agent', join(daemon, 'pty-agent-entry.ts')],
    ['resource collector', join(ui, 'collector/composition-root.ts')],
  ];

  it.each(entries)('%s', (_name, file) => {
    expect(readFileSync(file, 'utf8')).toMatch(/\bstartPlatform\(\)/);
  });

  it('renderer entries configure from what preload exposes', () => {
    expect(readFileSync(join(ui, 'renderer/configure-host.ts'), 'utf8')).toMatch(/configureHostTraits/);
  });

  it('no product code outside the composition layer names a concrete platform package', () => {
    for (const [, file] of entries) {
      expect(readFileSync(file, 'utf8')).not.toContain('@throng/platform-windows');
      expect(readFileSync(file, 'utf8')).not.toContain('@throng/platform-linux');
    }
  });
});
