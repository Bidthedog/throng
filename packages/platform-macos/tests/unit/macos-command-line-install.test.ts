import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runCommandLineInstallContract, skipOnWindows } from '@throng/core/testing';
import {
  MacosCommandLineInstall,
  appleScriptString,
  bundleOf,
  shQuote,
  type PrivilegedRunner,
} from '../../src/macos-command-line-install.js';

/**
 * The privilege step is injected as a plain `sh -c`, so every state transition runs here against a real temporary
 * prefix (070 FR-024a, research R20). Only the administrator prompt itself is the system's, and is not tested.
 */
const asUser: PrivilegedRunner = (command) =>
  new Promise((resolve, reject) => execFile('/bin/sh', ['-c', command], (error) => (error ? reject(error) : resolve())));

describe.skipIf(skipOnWindows('installs a POSIX symlink into a real temporary prefix; Windows has no such link or path form'))('MacosCommandLineInstall', () => {
  let root: string;
  let linkPath: string;
  const bundleAt = (name: string): string => join(root, 'My Apps', name);
  const execIn = (bundle: string): string => join(bundle, 'Contents', 'MacOS', 'throng');

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "throng-cli-it's-"));
    const bundle = bundleAt('throng.app');
    mkdirSync(join(bundle, 'Contents', 'MacOS'), { recursive: true });
    mkdirSync(join(bundle, 'Contents', 'Resources', 'bin'), { recursive: true });
    writeFileSync(join(bundle, 'Contents', 'Resources', 'bin', 'throng'), '#!/bin/sh\n', { mode: 0o755 });
    writeFileSync(execIn(bundle), '', { mode: 0o755 });
    // A prefix whose bin folder does not exist yet, as on a Mac with nothing in /usr/local.
    linkPath = join(root, 'prefix', 'bin', 'throng');
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('walks every state the data model names, into a temporary prefix', async () => {
    const make = (bundle: string) => new MacosCommandLineInstall({ execPath: execIn(bundle), linkPath, privileged: asUser });
    await runCommandLineInstallContract(() => make(bundleAt('throng.app')), {
      make: () => make(bundleAt('throng.app')),
      plantOther: async () => {
        mkdirSync(join(root, 'prefix', 'bin'), { recursive: true });
        rmSync(linkPath, { force: true });
        symlinkSync('/bin/sh', linkPath);
      },
      moveBundle: async () => {
        renameSync(bundleAt('throng.app'), bundleAt('Moved.app'));
        return make(bundleAt('Moved.app'));
      },
      restoreBundle: async () => {
        if (existsSync(bundleAt('Moved.app'))) renameSync(bundleAt('Moved.app'), bundleAt('throng.app'));
      },
      clear: async () => rmSync(linkPath, { force: true }),
    });
  });

  it('reports a plain file at the name as another program, and leaves it alone', async () => {
    mkdirSync(join(root, 'prefix', 'bin'), { recursive: true });
    writeFileSync(linkPath, 'someone else');
    const install = new MacosCommandLineInstall({ execPath: execIn(bundleAt('throng.app')), linkPath, privileged: asUser });
    expect((await install.status()).kind).toBe('other');
    expect((await install.uninstall()).kind).toBe('other');
    expect(existsSync(linkPath)).toBe(true);
  });

  it('says the user declined when the administrator prompt is cancelled, in a sentence for the notice', async () => {
    const declined: PrivilegedRunner = () => Promise.reject(Object.assign(new Error('User canceled. (-128)'), { declined: true }));
    const install = new MacosCommandLineInstall({ execPath: execIn(bundleAt('throng.app')), linkPath, privileged: declined });
    await expect(install.install({ replaceOther: false })).rejects.toMatchObject({
      declined: true,
      message: 'You declined the administrator prompt, so the command was not installed.',
    });
  });

  it('turns a system refusal into a plain sentence, with no AppleScript code and no errno', async () => {
    const refused: PrivilegedRunner = () =>
      Promise.reject(new Error(`0:120: execution error: ln: ${linkPath}: EACCES: Permission denied (1)\n    at stack`));
    const install = new MacosCommandLineInstall({ execPath: execIn(bundleAt('throng.app')), linkPath, privileged: refused });
    const failure = await install.install({ replaceOther: false }).then(
      () => '',
      (error: Error) => error.message,
    );
    expect(failure).toBe(`The 'throng' command could not be installed: ln: ${linkPath}: Permission denied.`);
    // The temp folder's random suffix can itself read as an errno ("ESZJEN"), so the path is taken out first.
    expect(failure.replace(linkPath, '<link>')).not.toMatch(/\bE[A-Z]{3,}\b|execution error|\(1\)|at stack/);
  });

  it('refuses to replace another program in words the notice can show as they are', async () => {
    mkdirSync(join(root, 'prefix', 'bin'), { recursive: true });
    symlinkSync('/bin/sh', linkPath);
    const install = new MacosCommandLineInstall({ execPath: execIn(bundleAt('throng.app')), linkPath, privileged: asUser });
    await expect(install.install({ replaceOther: false })).rejects.toThrow(`${linkPath} already points at another program.`);
  });

  it('is unavailable for a copy not running from a bundle (a source run)', async () => {
    await runCommandLineInstallContract(() => new MacosCommandLineInstall({ execPath: '/opt/node/bin/node', linkPath }));
  });

  it('finds the bundle from the executable path', () => {
    expect(bundleOf('/Applications/throng.app/Contents/MacOS/throng')).toBe('/Applications/throng.app');
    expect(bundleOf('/usr/local/bin/node')).toBeNull();
  });

  it('quotes every path for sh and the command for AppleScript', () => {
    expect(shQuote("/Users/o'neil/My Apps")).toBe("'/Users/o'\\''neil/My Apps'");
    expect(appleScriptString('ln -s "a\\b"')).toBe('"ln -s \\"a\\\\b\\""');
  });
});
