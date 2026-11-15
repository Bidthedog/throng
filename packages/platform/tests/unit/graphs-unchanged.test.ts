import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  WINDOWS_HOST_TRAITS,
  linuxHostTraits,
  pathCompareKey,
  resolveIpcAddress,
  shippedBindingsFor,
  trashTerm,
  type OsName,
} from '@throng/core';
import { withHostTraits } from '@throng/core/testing';
import { LinuxUserDirectories } from '@throng/platform-linux';
import { selectPlatform } from '@throng/platform';
import { appMenuTemplate } from '../../../ui/src/main/app-menu-template.js';

/**
 * 070 FR-013, SC-008: adding macOS changes nothing a Windows or Linux user has. Every figure here was computed from
 * master's own core before 070 and is pinned, so a macOS change that leaks into a shared rule fails here, not on a
 * user's machine. The classes each set selects are pinned in `select-platform.test.ts`.
 */

/** Sorted-key JSON, so the digest is of the content and not of the order keys were written in. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(record[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

/** Every chord shipped before 070. Commands 070 adds unbound on these platforms (`app.settings` and the like) are left out. */
function boundDigest(os: OsName): string {
  const shipped = shippedBindingsFor(os);
  const bound = Object.fromEntries(Object.entries(shipped.bindings).filter(([, chords]) => chords.length > 0));
  return createHash('sha256').update(canonical({ ...shipped, bindings: bound })).digest('hex');
}

/** master's digest, the same for both platforms. */
const MASTER_BINDINGS = '7b7fca5e82b975582dc3d238c92ca34060bfb997f3564350d4fc9cf81f0f1d62';
const SAMPLES = ['C:\\Users\\Dev\\A.md', '/home/dev/A.md', '/home/dev/a/../B/'];

describe('Windows and Linux are unchanged by macOS (070 FR-013, SC-008)', () => {
  it.each(['windows', 'linux'] as const)('%s ships every chord it shipped before', (os) => {
    expect(boundDigest(os)).toBe(MASTER_BINDINGS);
  });

  it('compares paths as before: Windows folds case and separators, Linux compares them as written', () => {
    withHostTraits(WINDOWS_HOST_TRAITS, () => {
      expect(SAMPLES.map(pathCompareKey)).toEqual(['c:/users/dev/a.md', '/home/dev/a.md', '/home/dev/a/../b/']);
    });
    withHostTraits(linuxHostTraits('/run/user/1000/throng'), () => {
      expect(SAMPLES.map(pathCompareKey)).toEqual(SAMPLES);
    });
  });

  it('reaches the daemon at the same address', () => {
    withHostTraits(WINDOWS_HOST_TRAITS, () => expect(resolveIpcAddress('throng.dev.x.daemon')).toBe('throng.dev.x.daemon'));
    withHostTraits(linuxHostTraits('/run/user/1000/throng'), () => {
      expect(resolveIpcAddress('throng.dev.x.daemon')).toBe('/run/user/1000/throng/throng.dev.x.daemon.sock');
    });
  });

  it('calls the bin by the same name', () => {
    expect(trashTerm('windows')).toBe('Recycle Bin');
    expect(trashTerm('linux')).toBe('Trash');
  });

  it('keeps Linux data, settings and logs where they were', () => {
    const dirs = new LinuxUserDirectories({}, () => '/home/dev');
    expect(dirs.dataDir(false)).toBe(join('/home/dev', '.local', 'share', 'throng'));
    expect(dirs.configRoot(true)).toBe(join('/home/dev', '.config', 'throng-dev'));
    // No logDir of its own: logs stay in `<dataDir>/logs`.
    expect(selectPlatform('linux').userDirectories().logDir).toBeUndefined();
    expect(selectPlatform('win32').userDirectories().logDir).toBeUndefined();
  });

  it.each(['windows', 'linux'] as const)('%s has the one menu it had: Help, About throng', (os) => {
    const menu = appMenuTemplate(os, { onAbout: () => {}, onSettings: () => {} });
    expect(menu.map((m) => ({ label: m.label, role: m.role, items: (m.submenu as { label?: string }[]).map((i) => i.label) }))).toEqual([
      { label: 'Help', role: 'help', items: ['About throng'] },
    ]);
  });
});
