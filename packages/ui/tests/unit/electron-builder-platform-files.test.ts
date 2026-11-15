import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import picomatch from 'picomatch';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import { artifactSetForPlatform, declareArtifactSet } from '@throng/core';

/**
 * 070 FR-003, FR-042 to FR-044, FR-039 — what `electron-builder.yml` packs on each platform.
 *
 * One shared `files` list serves all three. A platform's own `files:` list does not add to it: electron-builder then
 * packs that list alone, and a list of nothing but exclusions packs the whole repository (the macOS, Windows and Linux
 * builds all shipped `specs/`, `scripts/` and `.claude/` the one time it was tried). So the native prebuild filters
 * keep `${platform}-${arch}`, which electron-builder expands per build.
 */

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

interface FileSet {
  from: string;
  to: string;
  filter: string[];
}
type FileEntry = string | FileSet;
interface Config {
  files: FileEntry[];
  afterSign?: string;
  win: { files?: FileEntry[] };
  linux: { files?: FileEntry[] };
  mac?: {
    files?: FileEntry[];
    target: { target: string; arch: string[] }[];
    identity: string | null;
    hardenedRuntime: boolean;
    gatekeeperAssess: boolean;
    artifactName: string;
    extraResources?: { from: string; to: string }[];
    extendInfo: { CFBundleDocumentTypes: Record<string, unknown>[] };
  };
  dmg?: { artifactName: string; contents: Record<string, unknown>[] };
}

const config = parse(readFileSync(`${ROOT}electron-builder.yml`, 'utf8')) as Config;

/** The build each copy is made for: electron-builder's `${platform}` and `${arch}`. */
const BUILDS = { win: ['win32', 'x64'], linux: ['linux', 'x64'], mac: ['darwin', 'arm64'] } as const;
type Platform = keyof typeof BUILDS;

/** The shared patterns with the macros expanded as electron-builder expands them for that build. */
const patternsFor = (platform: Platform): string[] =>
  config.files
    .filter((entry): entry is string => typeof entry === 'string')
    .map((pattern) => pattern.replaceAll('${platform}', BUILDS[platform][0]).replaceAll('${arch}', BUILDS[platform][1]));

/** Does a file survive the platform's patterns? A later pattern overrides an earlier one, as electron-builder reads them. */
function packs(platform: Platform, path: string): boolean {
  let kept = false;
  for (const pattern of patternsFor(platform)) {
    const negated = pattern.startsWith('!');
    if (picomatch(negated ? pattern.slice(1) : pattern, { dot: true })(path)) kept = !negated;
  }
  return kept;
}

const SQLITE = ['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64', 'linuxmusl-arm64', 'linuxmusl-x64', 'win32-arm64', 'win32-x64'].map(
  (name) => `node_modules/better-sqlite3/prebuilds/${name}.node`,
);
const PTY = ['darwin-arm64', 'darwin-x64', 'win32-arm64', 'win32-x64'].map((name) => `node_modules/node-pty/prebuilds/${name}/pty.node`);

describe('what each platform packs (070 FR-039, FR-043)', () => {
  it('gives no platform a files list of its own, which would pack the whole repository', () => {
    expect([config.win.files, config.linux.files, config.mac?.files]).toEqual([undefined, undefined, undefined]);
  });

  it('packs the built app and its modules, and none of the repository around them', () => {
    for (const platform of Object.keys(BUILDS) as Platform[]) {
      expect(packs(platform, 'packages/ui/dist/main/main.js')).toBe(true);
      expect(packs(platform, 'node_modules/inversify/package.json')).toBe(true);
      for (const stray of ['specs/070-macos-support/spec.md', '.claude/settings.json', 'scripts/gate.mjs', 'docs/README.md', 'CLAUDE.md']) {
        expect(packs(platform, stray)).toBe(false);
      }
    }
  });

  it('keeps only the database binary each copy loads', () => {
    expect(SQLITE.filter((path) => packs('win', path))).toEqual(['node_modules/better-sqlite3/prebuilds/win32-x64.node']);
    expect(SQLITE.filter((path) => packs('linux', path))).toEqual(['node_modules/better-sqlite3/prebuilds/linux-x64.node']);
    expect(SQLITE.filter((path) => packs('mac', path))).toEqual(['node_modules/better-sqlite3/prebuilds/darwin-arm64.node']);
  });

  it('keeps only the terminal-host prebuild each copy loads; Linux builds its own (FR-043)', () => {
    expect(PTY.filter((path) => packs('win', path))).toEqual(['node_modules/node-pty/prebuilds/win32-x64/pty.node']);
    expect(PTY.filter((path) => packs('linux', path))).toEqual([]);
    expect(PTY.filter((path) => packs('mac', path))).toEqual(['node_modules/node-pty/prebuilds/darwin-arm64/pty.node']);
    expect(packs('mac', 'node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper')).toBe(true);
    expect(packs('linux', 'node_modules/node-pty/build/Release/pty.node')).toBe(true);
  });

  it('maps the macOS platform package into node_modules as it maps the others (T002)', () => {
    const sets = config.files.filter((entry): entry is FileSet => typeof entry !== 'string');
    expect(sets).toContainEqual({
      from: 'packages/platform-macos',
      to: 'node_modules/@throng/platform-macos',
      filter: ['package.json', 'dist/**/*'],
    });
  });
});

describe('the macOS build (070 FR-003, FR-044, research R23)', () => {
  const mac = config.mac;

  it('builds a disk image and an archive for Apple silicon only', () => {
    expect(mac?.target).toEqual([
      { target: 'dmg', arch: ['arm64'] },
      { target: 'zip', arch: ['arm64'] },
    ]);
  });

  it('signs ad hoc, with no hardened runtime and no Gatekeeper assessment', () => {
    expect(mac?.identity).toBe('-');
    expect(mac?.hardenedRuntime).toBe(false);
    expect(mac?.gatekeeperAssess).toBe(false);
    expect(config.afterSign).toBe('packaging/macos/after-sign.cjs');
  });

  it('names each file as the declared artifact set does', () => {
    const version = '1.2.3-alpha4';
    const expand = (pattern: string, ext: string): string =>
      pattern.replaceAll('${version}', version).replaceAll('${arch}', 'arm64').replaceAll('${ext}', ext);
    const declared = artifactSetForPlatform(declareArtifactSet(version), 'darwin').artifacts.map((a) => a.filename);
    expect([expand(config.dmg?.artifactName ?? '', 'dmg'), expand(mac?.artifactName ?? '', 'zip')]).toEqual(declared);
  });

  it('lays the disk image out with a link to Applications', () => {
    expect(config.dmg?.contents).toContainEqual(expect.objectContaining({ type: 'link', path: '/Applications' }));
  });

  it('declares that it opens folders, as a viewer, without claiming to be their default (FR-024, research R19)', () => {
    const types = mac?.extendInfo.CFBundleDocumentTypes ?? [];
    expect(types).toHaveLength(1);
    expect(types[0]).toMatchObject({ CFBundleTypeRole: 'Viewer', LSItemContentTypes: ['public.folder'], LSHandlerRank: 'Alternate' });
  });

  it('ships the command-line script inside the bundle (FR-024a, research R20)', () => {
    expect(mac?.extraResources).toContainEqual({ from: 'packaging/macos/throng-cli.sh', to: 'bin/throng' });
  });
});
