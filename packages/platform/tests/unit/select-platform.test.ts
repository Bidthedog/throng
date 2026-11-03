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
import { UnsupportedPlatformError, selectPlatform } from '@throng/platform';

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
    expect(() => selectPlatform('darwin')).toThrow(UnsupportedPlatformError);
    expect(() => selectPlatform('darwin')).toThrow(/darwin/);
  });
});

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
