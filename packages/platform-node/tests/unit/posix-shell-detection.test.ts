import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { MACOS_SHELL_SEARCH_DIRS, PosixShellDetection } from '../../src/posix/posix-shell-detection.js';
import { skipOnWindows } from '@throng/core/testing';

const made: string[] = [];
const tempDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'throng-shells-'));
  made.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('POSIX shell detection: folders beyond PATH (070 FR-017, research R9)', () => {
  it('searches the Homebrew folders on macOS, Apple silicon first', () => {
    expect(MACOS_SHELL_SEARCH_DIRS).toEqual(['/opt/homebrew/bin', '/usr/local/bin']);
  });

  it.skipIf(skipOnWindows('needs a POSIX filesystem: execute bits and /-rooted paths'))('finds a shell in an extra folder that neither /etc/shells nor PATH names, as a Dock launch would have it', async () => {
    const brew = tempDir();
    writeFileSync(join(brew, 'fish'), '#!/bin/sh\n', { mode: 0o755 });
    const shells = await new PosixShellDetection({
      readShellsFile: async () => '',
      // An empty folder, not the host's /usr/bin: a runner with fish installed there would find that copy first.
      env: { PATH: tempDir() },
      passwdShell: () => undefined,
      extraSearchDirs: [brew],
    }).detectInstalledShells();
    expect(shells.find((s) => s.id === 'fish')?.file).toBe(join(brew, 'fish'));
  });

  it('searches PATH first, and an extra folder already on PATH only once', () => {
    const detection = new PosixShellDetection({ env: { PATH: '/a:/opt/homebrew/bin' }, extraSearchDirs: MACOS_SHELL_SEARCH_DIRS });
    expect(detection.searchDirs()).toEqual(['/a', '/opt/homebrew/bin', '/usr/local/bin']);
  });

  it.skipIf(skipOnWindows('needs a POSIX filesystem: execute bits and /-rooted paths'))('reports the login shell’s own file first when /etc/shells lists the system copy of it earlier (chsh to Homebrew bash)', async () => {
    const system = tempDir();
    const brew = tempDir();
    for (const dir of [system, brew]) writeFileSync(join(dir, 'bash'), '#!/bin/sh\n', { mode: 0o755 });
    const shells = await new PosixShellDetection({
      readShellsFile: async () => `${join(system, 'bash')}\n${join(brew, 'bash')}\n`,
      env: { PATH: '', SHELL: join(brew, 'bash') },
      passwdShell: () => undefined,
    }).detectInstalledShells();
    expect(shells[0]?.file).toBe(join(brew, 'bash'));
    expect(shells.filter((s) => s.id === 'bash')).toHaveLength(1);
  });

  // 062 FR-014: the default is the user's login shell — even one throng has no flavour for (`chsh -s /usr/bin/xonsh`).
  it.skipIf(skipOnWindows('needs a POSIX filesystem: execute bits and /-rooted paths'))('reports a login shell throng does not know first, by its file name', async () => {
    const dir = tempDir();
    for (const name of ['bash', 'xonsh']) writeFileSync(join(dir, name), '#!/bin/sh\n', { mode: 0o755 });
    const shells = await new PosixShellDetection({
      readShellsFile: async () => `${join(dir, 'bash')}\n${join(dir, 'xonsh')}\n`,
      env: { PATH: '', SHELL: join(dir, 'xonsh') },
      passwdShell: () => undefined,
    }).detectInstalledShells();
    expect(shells.map((s) => s.file)).toEqual([join(dir, 'xonsh'), join(dir, 'bash')]);
    expect(shells[0]).toMatchObject({ id: 'xonsh', label: 'xonsh' });
  });

  it.skipIf(skipOnWindows('needs a POSIX filesystem: execute bits and /-rooted paths'))('falls back to the passwd shell, and ignores a login shell that is not an absolute path', async () => {
    const system = tempDir();
    const brew = tempDir();
    for (const dir of [system, brew]) writeFileSync(join(dir, 'zsh'), '#!/bin/sh\n', { mode: 0o755 });
    const listed = async (): Promise<string> => `${join(system, 'zsh')}\n${join(brew, 'zsh')}\n`;
    const viaPasswd = await new PosixShellDetection({ readShellsFile: listed, env: { PATH: '' }, passwdShell: () => join(brew, 'zsh') });
    expect((await viaPasswd.detectInstalledShells())[0]?.file).toBe(join(brew, 'zsh'));
    const relative = new PosixShellDetection({ readShellsFile: listed, env: { PATH: '', SHELL: 'zsh' }, passwdShell: () => undefined });
    expect((await relative.detectInstalledShells())[0]?.file).toBe(join(system, 'zsh'));
  });

  it('searches nothing beyond PATH unless asked, so Linux finds what it always found (FR-039)', () => {
    expect(new PosixShellDetection({ env: { PATH: '/a:/b' } }).searchDirs()).toEqual(['/a', '/b']);
  });
});
