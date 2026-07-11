import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildShippedDefaults, reservedThemeNames, type Theme } from '@throng/core';
import { FileConfigStore } from '../../src/main/config-store.js';
import { ShippedDefaultsService } from '../../src/main/shipped-defaults-service.js';

/** Restore-all-themes (010, US2 / FR-008/012/012a). */
const tempDirs: string[] = [];
function freshRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'throng-restore-all-'));
  tempDirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const SHIPPED = buildShippedDefaults();

function makeService(root: string): { store: FileConfigStore; service: ShippedDefaultsService } {
  const store = new FileConfigStore(root);
  return { store, service: new ShippedDefaultsService(store, SHIPPED) };
}

const customTheme: Theme = {
  name: 'MyTheme',
  colours: { accent: '#abcabc' },
  fonts: { family: 'x', baseSizePx: 13, weights: { normal: 400, bold: 600 } },
  icons: {},
};

describe('ShippedDefaultsService.restoreAllThemes', () => {
  it('leaves a custom theme byte-identical', async () => {
    const root = freshRoot();
    const { store, service } = makeService(root);
    await service.seed();
    await store.write({ kind: 'theme', name: 'MyTheme' }, customTheme);
    const before = readFileSync(join(root, 'themes', 'MyTheme.json'), 'utf8');

    const res = await service.restoreAllThemes();
    expect(res.ok).toBe(true);
    expect(readFileSync(join(root, 'themes', 'MyTheme.json'), 'utf8')).toBe(before);
  });

  it('recreates a deleted built-in theme', async () => {
    const root = freshRoot();
    const { store, service } = makeService(root);
    await service.seed();
    await store.deleteTheme('Matrix');
    expect(() => readFileSync(join(root, 'themes', 'Matrix.json'), 'utf8')).toThrow();

    const res = await service.restoreAllThemes();
    expect(res.ok).toBe(true);
    const restored = JSON.parse(readFileSync(join(root, 'themes', 'Matrix.json'), 'utf8')) as Theme;
    expect(restored).toEqual(SHIPPED.themes.Matrix);
  });

  it('resets an edited built-in theme to its shipped values', async () => {
    const root = freshRoot();
    const { store, service } = makeService(root);
    await service.seed();
    await store.write({ kind: 'theme', name: 'Debian' }, { ...SHIPPED.themes.Debian, colours: { ...SHIPPED.themes.Debian.colours, accent: '#ffffff' } });

    const res = await service.restoreAllThemes();
    expect(res.ok).toBe(true);
    const debian = JSON.parse(readFileSync(join(root, 'themes', 'Debian.json'), 'utf8')) as Theme;
    expect(debian).toEqual(SHIPPED.themes.Debian);
  });

  it('rolls back the whole operation when one theme file is unwritable (locked)', async () => {
    const root = freshRoot();
    const { service } = makeService(root);
    await service.seed();

    // Edit two built-ins so we can prove they are restored to shipped IF it committed,
    // but rolled back to the EDITED bytes when the op fails.
    const themesDir = join(root, 'themes');
    const editedLight = `${JSON.stringify({ ...SHIPPED.themes.Light, colours: { ...SHIPPED.themes.Light.colours, accent: '#111111' } }, null, 2)}\n`;
    writeFileSync(join(themesDir, 'Light.json'), editedLight);

    // Make Matrix.json unwritable by replacing it with a non-empty directory.
    rmSync(join(themesDir, 'Matrix.json'));
    mkdirSync(join(themesDir, 'Matrix.json'));
    writeFileSync(join(themesDir, 'Matrix.json', 'child'), 'x');

    // SC-013: snapshot EVERY reserved theme file (Matrix is the locked directory)
    // so we can prove none was left partially applied after the failed restore.
    const snapshot = new Map<string, string>();
    for (const name of reservedThemeNames(SHIPPED)) {
      if (name === 'Matrix') continue;
      snapshot.set(name, readFileSync(join(themesDir, `${name}.json`), 'utf8'));
    }

    const res = await service.restoreAllThemes();
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.failedPath).toBe(join(themesDir, 'Matrix.json'));

    // Every reserved theme file is byte-identical to before the failed restore
    // (the edited Light stays edited; nothing was reset to shipped values).
    for (const [name, before] of snapshot) {
      expect(readFileSync(join(themesDir, `${name}.json`), 'utf8')).toBe(before);
    }
  });
});
