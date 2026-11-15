import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MacosInstalledVersion, plistString } from '../../src/macos-installed-version.js';
import { skipOnWindows } from '@throng/core/testing';

const infoPlist = (entries: Record<string, string>): string =>
  [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    '<dict>',
    ...Object.entries(entries).flatMap(([k, v]) => [`\t<key>${k}</key>`, `\t<string>${v}</string>`]),
    '\t<key>LSMinimumSystemVersion</key>',
    '\t<string>14.0</string>',
    '</dict>',
    '</plist>',
  ].join('\n');

/** Layer: unit — the bundle is a real folder with a real Info.plist, which is all the seam reads (070 FR-005, R12). */
describe('MacosInstalledVersion', () => {
  let root: string;
  let bundle: string;
  let execPath: string;

  const writeInfo = (entries: Record<string, string>): void => {
    writeFileSync(join(bundle, 'Contents', 'Info.plist'), infoPlist(entries));
  };

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'throng-bundle-'));
    bundle = join(root, 'throng.app');
    mkdirSync(join(bundle, 'Contents', 'MacOS'), { recursive: true });
    execPath = join(bundle, 'Contents', 'MacOS', 'throng');
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it.skipIf(skipOnWindows('needs a POSIX filesystem: execute bits and /-rooted paths'))('reads the version of the bundle now on disk, so replacing the app in Applications is seen', () => {
    writeInfo({ CFBundleIdentifier: 'com.throng.throng', CFBundleShortVersionString: '1.0.0' });
    const seam = new MacosInstalledVersion(execPath);
    expect(seam.installed()).toEqual({ version: '1.0.0', launcher: execPath });
    writeInfo({ CFBundleIdentifier: 'com.throng.throng', CFBundleShortVersionString: '1.1.0-rc.1' });
    expect(seam.installed()?.version).toBe('1.1.0-rc.1');
  });

  it('answers null for another app’s bundle, so a source run inside Electron.app raises no upgrade notice', () => {
    writeInfo({ CFBundleIdentifier: 'com.github.Electron', CFBundleShortVersionString: '39.0.0' });
    expect(new MacosInstalledVersion(execPath).installed()).toBeNull();
  });

  it('answers null for a copy not in a bundle, and for a bundle it cannot read (mid-replace or removed)', () => {
    expect(new MacosInstalledVersion('/usr/local/bin/node').installed()).toBeNull();
    expect(new MacosInstalledVersion(execPath).installed()).toBeNull();
    writeFileSync(join(bundle, 'Contents', 'Info.plist'), 'not a plist');
    expect(new MacosInstalledVersion(execPath).installed()).toBeNull();
  });

  it('reads a string value from a plist, unescaping it', () => {
    expect(plistString(infoPlist({ A: 'x &amp; y' }), 'A')).toBe('x & y');
    // A plist writer may spell any character as a numeric reference; the value is read as the bundle meant it.
    expect(plistString(infoPlist({ A: '1.0.0-alpha&#x31;&#54; &amp;#38;' }), 'A')).toBe('1.0.0-alpha16 &#38;');
    expect(plistString(infoPlist({}), 'A')).toBeUndefined();
  });
});
