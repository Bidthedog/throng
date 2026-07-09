import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ALL_DEFAULT_THEMES } from '@throng/core';
import { FileConfigStore } from '../../src/main/config-store.js';

/**
 * Restore-default-themes (007, FR-037/045). Seeding writes all bundled defaults;
 * deleting one then restoring re-creates it identically; user themes are untouched.
 */
const tempDirs: string[] = [];
function freshRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'throng-restore-'));
  tempDirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('restoreDefaultThemes', () => {
  it('seeds every bundled default theme (throng + 14)', async () => {
    const store = new FileConfigStore(freshRoot());
    const names = await store.restoreDefaultThemes();
    for (const expected of Object.keys(ALL_DEFAULT_THEMES)) {
      expect(names, expected).toContain(expected);
    }
  });

  it('re-creates a deleted default identically and leaves user themes untouched', async () => {
    const root = freshRoot();
    const store = new FileConfigStore(root);
    await store.restoreDefaultThemes();
    // A user theme coexists.
    await store.write({ kind: 'theme', name: 'MyTheme' }, { name: 'MyTheme', colours: { accent: '#abc' }, fonts: { family: 'x', baseSizePx: 13, weights: { normal: 400, bold: 600 } }, icons: {} });

    const matrixBefore = readFileSync(join(root, 'themes', 'Matrix.json'), 'utf8');
    await store.deleteTheme('Matrix');
    expect(() => readFileSync(join(root, 'themes', 'Matrix.json'), 'utf8')).toThrow();

    await store.restoreDefaultThemes();
    expect(readFileSync(join(root, 'themes', 'Matrix.json'), 'utf8')).toBe(matrixBefore); // identical
    // The user theme is still present and untouched.
    expect(JSON.parse(readFileSync(join(root, 'themes', 'MyTheme.json'), 'utf8')).name).toBe('MyTheme');
  });

  it('does not overwrite an existing (possibly user-edited) default', async () => {
    const root = freshRoot();
    const store = new FileConfigStore(root);
    await store.restoreDefaultThemes();
    // Edit a default in place.
    await store.write({ kind: 'theme', name: 'Debian' }, { name: 'Debian', colours: { accent: '#ffffff' }, fonts: { family: 'x', baseSizePx: 13, weights: { normal: 400, bold: 600 } }, icons: {} });
    await store.restoreDefaultThemes(); // present → must not clobber
    expect(JSON.parse(readFileSync(join(root, 'themes', 'Debian.json'), 'utf8')).colours.accent).toBe('#ffffff');
  });
});
