import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * 020 FR-001/005/006 — the single-source version guard.
 *
 * There is exactly ONE authoritative product version: the root package.json `version`. Every
 * workspace package MUST carry the same value (so changing the version is a single edit), the
 * generated daemon `VERSION` (if built) MUST equal it, and it MUST stay DISTINCT from the
 * content-hash `BUILD_ID`.
 */
const repoRoot = process.cwd();
const rootVersion: string = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')).version;

describe('product version is single-sourced (020 FR-001/005)', () => {
  it('every workspace package declares the same version as the root', () => {
    const packagesDir = join(repoRoot, 'packages');
    const pkgDirs = readdirSync(packagesDir, { withFileTypes: true }).filter((e) => e.isDirectory());
    const mismatches: string[] = [];
    for (const dir of pkgDirs) {
      const manifest = join(packagesDir, dir.name, 'package.json');
      if (!existsSync(manifest)) continue;
      const version: string = JSON.parse(readFileSync(manifest, 'utf8')).version;
      if (version !== rootVersion) mismatches.push(`${dir.name}: ${version} !== ${rootVersion}`);
    }
    expect(mismatches, `workspace versions must equal the root (${rootVersion})`).toEqual([]);
  });

  it('the generated daemon VERSION, when built, equals the root version', () => {
    const versionFile = join(repoRoot, 'packages', 'daemon', 'dist', 'VERSION');
    if (!existsSync(versionFile)) return; // not built yet — the guard applies once dist exists
    expect(readFileSync(versionFile, 'utf8').trim()).toBe(rootVersion);
  });

  it('the product version is DISTINCT from BUILD_ID (FR-006)', () => {
    const buildIdFile = join(repoRoot, 'packages', 'daemon', 'dist', 'BUILD_ID');
    if (!existsSync(buildIdFile)) return; // not built yet
    const buildId = readFileSync(buildIdFile, 'utf8').trim();
    // BUILD_ID is a 16-hex content hash; the version is SemVer. They must not be the same string.
    expect(buildId).not.toBe(rootVersion);
    expect(buildId).toMatch(/^[0-9a-f]{16}$/);
  });
});
