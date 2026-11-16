import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { VENDORED, mergeEntries, vendoredEntries } from '../../../../scripts/generate-licenses.mjs';

/**
 * Spec 069 T032 / FR-022 — the licence manifest records the Lucide art compiled into core, which the
 * lockfile walk cannot see, and carries its licence text for the About window.
 */
const root = join(process.cwd());
const SOURCES = JSON.parse(
  readFileSync(join(root, 'packages', 'core', 'src', 'icons', 'default-set', 'SOURCES.json'), 'utf8'),
) as { lucideVersion: string };

describe('the VENDORED list', () => {
  it('declares Lucide at the version the default set was compiled from, under ISC', () => {
    const lucide = VENDORED.find((v: { name: string }) => v.name === 'Lucide');
    expect(lucide).toMatchObject({
      version: SOURCES.lucideVersion,
      license: 'ISC',
      projectUrl: 'https://lucide.dev',
      licenseUrl: 'https://spdx.org/licenses/ISC.html',
    });
  });

  it('reads the licence text from the copy kept beside the art', () => {
    const [lucide] = vendoredEntries(root) as Array<{ licenseText: string }>;
    const onDisk = readFileSync(join(root, 'packages', 'core', 'src', 'icons', 'default-set', 'LICENSE'), 'utf8');
    expect(lucide.licenseText).toContain('ISC License');
    expect(lucide.licenseText).toBe(onDisk.replace(/\r\n?/g, '\n').trimEnd());
  });
});

describe('mergeEntries', () => {
  it('merges the vendored entries in before sorting by name', () => {
    const merged = mergeEntries(
      [{ name: 'zod' }, { name: 'react' }],
      [{ name: 'Lucide' }, { name: 'preact' }],
    ) as Array<{ name: string }>;
    expect(merged.map((e) => e.name)).toEqual(['Lucide', 'preact', 'react', 'zod']);
  });
});

/**
 * A throwaway checkout: the real script, a lockfile with no packages, and the Lucide files it reads.
 * `lucideVersion` is deliberately not the one in the real SOURCES.json.
 */
function makeCheckout(): string {
  const dir = mkdtempSync(join(tmpdir(), 'throng-licences-'));
  const art = join(dir, 'packages', 'core', 'src', 'icons', 'default-set');
  mkdirSync(join(dir, 'scripts'), { recursive: true });
  mkdirSync(art, { recursive: true });
  mkdirSync(join(dir, 'packages', 'ui', 'dist'), { recursive: true });
  copyFileSync(join(root, 'scripts', 'generate-licenses.mjs'), join(dir, 'scripts', 'generate-licenses.mjs'));
  writeFileSync(join(dir, 'package-lock.json'), JSON.stringify({ packages: {} }));
  writeFileSync(join(art, 'LICENSE'), 'ISC License\n');
  writeFileSync(join(art, 'SOURCES.json'), JSON.stringify({ lucideVersion: '9.9.9' }));
  return dir;
}

describe('the Lucide version', () => {
  it('is read from SOURCES.json, not restated in the script', () => {
    const dir = makeCheckout();
    try {
      const [lucide] = vendoredEntries(dir) as Array<{ version: string }>;
      expect(lucide.version).toBe('9.9.9');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('running as a script', () => {
  const outOf = (dir: string): string => join(dir, 'packages', 'ui', 'dist', 'third-party-licenses.json');

  it('writes the manifest when run by its own path', () => {
    const dir = makeCheckout();
    try {
      execFileSync(process.execPath, [join(dir, 'scripts', 'generate-licenses.mjs')], { stdio: 'pipe' });
      expect(existsSync(outOf(dir))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('writes the manifest when run through a symlinked checkout, rather than silently doing nothing', () => {
    const dir = makeCheckout();
    const link = join(dir, 'linked-scripts');
    try {
      symlinkSync(join(dir, 'scripts'), link, 'dir');
      execFileSync(process.execPath, [join(link, 'generate-licenses.mjs')], { stdio: 'pipe' });
      expect(existsSync(outOf(dir))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
