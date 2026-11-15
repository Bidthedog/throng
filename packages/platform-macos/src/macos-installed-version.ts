import { readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path/posix';
import { logExpected, type IInstalledVersion, type InstalledCopy } from '@throng/core';
import { unescapeXml } from './xml-text.js';

/** The bundle identifier throng ships with (`electron-builder.yml` `appId`). */
export const THRONG_BUNDLE_ID = 'com.throng.throng';

/** A `<key>` whose value is a `<string>`, from an XML property list. Undefined when absent. */
export function plistString(xml: string, key: string): string | undefined {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`<key>${escaped}</key>\\s*<string>([^<]*)</string>`).exec(xml);
  return match ? unescapeXml(match[1]!) : undefined;
}

/**
 * The version of the throng bundle now on disk where this copy runs from (063 FR-010, 070 FR-005, R12). The user
 * upgrades by replacing the app in Applications while it runs; the running copy keeps its own files, and the bundle's
 * on-disk `Info.plist` then names the new version, which is what raises the upgrade notice. Relaunching the same
 * executable path starts the new copy.
 *
 * A copy outside a bundle, a bundle that is not throng's (a source run inside `Electron.app`), and one that cannot be
 * read (mid-replace, or removed) answer null, and none of those is worth a notice.
 */
export class MacosInstalledVersion implements IInstalledVersion {
  constructor(private readonly execPath: string) {}

  installed(): InstalledCopy | null {
    const macos = dirname(this.execPath);
    const contents = dirname(macos);
    if (basename(macos) !== 'MacOS' || basename(contents) !== 'Contents' || !dirname(contents).endsWith('.app')) return null;
    let xml: string;
    try {
      xml = readFileSync(join(contents, 'Info.plist'), 'utf8');
    } catch (error) {
      logExpected('macos-installed-version: read Info.plist', 'the bundle may be mid-replace or removed; neither is worth a notice', error);
      return null;
    }
    if (plistString(xml, 'CFBundleIdentifier') !== THRONG_BUNDLE_ID) return null;
    const version = plistString(xml, 'CFBundleShortVersionString');
    return version ? { version, launcher: this.execPath } : null;
  }
}
