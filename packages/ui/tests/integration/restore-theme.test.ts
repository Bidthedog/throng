import { mkdirSync, mkdtempSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildShippedDefaults } from '@throng/core';
import { FileConfigStore } from '../../src/main/config-store.js';
import { ShippedDefaultsService } from '../../src/main/shipped-defaults-service.js';

/**
 * Feature 014, FR-005/FR-005a — single-theme restore/recreate. A thin operation on top of
 * feature 010's shipped record + atomic write: writes exactly one built-in's shipped value,
 * recreating a deleted one, touching no other theme.
 */
const tempDirs: string[] = [];
function freshService(): { store: FileConfigStore; svc: ShippedDefaultsService; root: string } {
  const root = mkdtempSync(join(tmpdir(), 'throng-restore-theme-'));
  tempDirs.push(root);
  const store = new FileConfigStore(root);
  return { store, svc: new ShippedDefaultsService(store, buildShippedDefaults()), root };
}
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const shippedMatrix = FileConfigStore.serialize(buildShippedDefaults().themes.Matrix);

describe('ShippedDefaultsService.restoreTheme (FR-005)', () => {
  it('overwrites an edited built-in back to its shipped value', async () => {
    const { store, svc, root } = freshService();
    await store.restoreDefaultThemes(); // seed all
    await store.write({ kind: 'theme', name: 'Matrix' }, { name: 'Matrix', colours: { accent: '#ffffff' }, fonts: { family: 'x', baseSizePx: 13, weights: { normal: 400, bold: 600 } }, icons: {} });

    const res = await svc.restoreTheme('Matrix');

    expect(res).toEqual({ ok: true });
    expect(readFileSync(join(root, 'themes', 'Matrix.json'), 'utf8')).toBe(shippedMatrix);
  });

  it('recreates a deleted built-in at its shipped value', async () => {
    const { store, svc, root } = freshService();
    await store.restoreDefaultThemes();
    await store.deleteTheme('Matrix');
    expect(existsSync(join(root, 'themes', 'Matrix.json'))).toBe(false);

    const res = await svc.restoreTheme('Matrix');

    expect(res).toEqual({ ok: true });
    expect(readFileSync(join(root, 'themes', 'Matrix.json'), 'utf8')).toBe(shippedMatrix);
  });

  it('touches no other theme (built-in or custom)', async () => {
    const { store, svc, root } = freshService();
    await store.restoreDefaultThemes();
    await store.write({ kind: 'theme', name: 'Debian' }, { name: 'Debian', colours: { accent: '#123456' }, fonts: { family: 'x', baseSizePx: 13, weights: { normal: 400, bold: 600 } }, icons: {} });
    await store.write({ kind: 'theme', name: 'MyCustom' }, { name: 'MyCustom', colours: { accent: '#abcabc' }, fonts: { family: 'x', baseSizePx: 13, weights: { normal: 400, bold: 600 } }, icons: {} });

    await svc.restoreTheme('Matrix');

    expect(JSON.parse(readFileSync(join(root, 'themes', 'Debian.json'), 'utf8')).colours.accent).toBe('#123456');
    expect(JSON.parse(readFileSync(join(root, 'themes', 'MyCustom.json'), 'utf8')).colours.accent).toBe('#abcabc');
  });

  it('refuses a non-reserved (custom) name and writes nothing', async () => {
    const { store, svc, root } = freshService();
    await store.restoreDefaultThemes();

    const res = await svc.restoreTheme('MyCustom');

    expect(res).toEqual({ ok: false, failedPath: '', error: 'not-reserved' });
    expect(existsSync(join(root, 'themes', 'MyCustom.json'))).toBe(false);
  });

  it('fails as a whole (leaving every other theme untouched) when the target file is unwritable', async () => {
    const { store, svc, root } = freshService();
    await store.restoreDefaultThemes();
    const themesDir = join(root, 'themes');
    // Edit another built-in so we can prove a failed restore of Matrix does not disturb it.
    await store.write({ kind: 'theme', name: 'Debian' }, { name: 'Debian', colours: { accent: '#123456' }, fonts: { family: 'x', baseSizePx: 13, weights: { normal: 400, bold: 600 } }, icons: {} });

    // Make Matrix.json unwritable by replacing it with a NON-EMPTY directory.
    rmSync(join(themesDir, 'Matrix.json'));
    mkdirSync(join(themesDir, 'Matrix.json'));
    writeFileSync(join(themesDir, 'Matrix.json', 'child'), 'x', 'utf8');

    const res = await svc.restoreTheme('Matrix');

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.failedPath).toContain('Matrix.json');
    // Nothing else was touched: the edited built-in keeps its edit.
    expect(JSON.parse(readFileSync(join(themesDir, 'Debian.json'), 'utf8')).colours.accent).toBe('#123456');
    // The obstruction is still there — no partial write happened.
    expect(existsSync(join(themesDir, 'Matrix.json', 'child'))).toBe(true);
  });

  it('is idempotent across repeated recreate calls', async () => {
    const { store, svc, root } = freshService();
    await store.restoreDefaultThemes();
    await store.deleteTheme('Matrix');

    const first = await svc.restoreTheme('Matrix');
    const firstContent = readFileSync(join(root, 'themes', 'Matrix.json'), 'utf8');
    const second = await svc.restoreTheme('Matrix');

    expect(first).toEqual({ ok: true });
    expect(second).toEqual({ ok: true });
    expect(readFileSync(join(root, 'themes', 'Matrix.json'), 'utf8')).toBe(firstContent);
  });
});
