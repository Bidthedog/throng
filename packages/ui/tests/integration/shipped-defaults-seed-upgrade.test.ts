import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_APP_SETTINGS,
  DEFAULT_KEYBINDINGS,
  SHIPPED_DEFAULTS_VERSION,
  buildShippedDefaults,
  reservedThemeNames,
  type ShippedDefaults,
  type Theme,
} from '@throng/core';
import { FileConfigStore } from '../../src/main/config-store.js';
import { ShippedDefaultsService } from '../../src/main/shipped-defaults-service.js';

/** First-run seeding + additive upgrade (010, US6 / FR-015/015a). */
const tempDirs: string[] = [];
function freshRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'throng-seed-'));
  tempDirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const SHIPPED = buildShippedDefaults();
const readJson = (p: string): unknown => JSON.parse(readFileSync(p, 'utf8'));

describe('ShippedDefaultsService.seed (first run)', () => {
  it('writes settings + keybindings + all built-in themes + version marker, equal to the record', async () => {
    const root = freshRoot();
    const service = new ShippedDefaultsService(new FileConfigStore(root), SHIPPED);
    const res = await service.seed();
    expect(res.ok).toBe(true);

    expect(readJson(join(root, 'settings.json'))).toEqual(DEFAULT_APP_SETTINGS);
    expect(readJson(join(root, 'keybindings.json'))).toEqual(DEFAULT_KEYBINDINGS);
    for (const name of reservedThemeNames(SHIPPED)) {
      expect(readJson(join(root, 'themes', `${name}.json`)), name).toEqual(SHIPPED.themes[name]);
    }
    expect(readJson(join(root, 'defaults-state.json'))).toEqual({ version: SHIPPED_DEFAULTS_VERSION });
    expect(await service.readAppliedVersion()).toBe(SHIPPED_DEFAULTS_VERSION);
  });

  it('is non-destructive: preserves a document the user pre-placed (create-if-absent)', async () => {
    const root = freshRoot();
    const store = new FileConfigStore(root);
    // A partial config: only keybindings.json exists (mirrors the e2e harness).
    await store.write({ kind: 'keybindings' }, { version: 1, bindings: { 'zoom.in': ['F8'] } });
    const kbBefore = readFileSync(join(root, 'keybindings.json'), 'utf8');

    const res = await new ShippedDefaultsService(store, SHIPPED).seed();
    expect(res.ok).toBe(true);
    // The pre-placed keybindings are untouched; the absent documents were written.
    expect(readFileSync(join(root, 'keybindings.json'), 'utf8')).toBe(kbBefore);
    expect(readJson(join(root, 'settings.json'))).toEqual(DEFAULT_APP_SETTINGS);
    expect(readJson(join(root, 'themes', 'Matrix.json'))).toEqual(SHIPPED.themes.Matrix);
  });
});

describe('ShippedDefaultsService.upgrade (additive only)', () => {
  it('adds a newly-shipped theme without touching existing values', async () => {
    const root = freshRoot();
    const store = new FileConfigStore(root);
    // A "previous version" record that lacks the Ubuntu theme.
    const prevThemes = { ...SHIPPED.themes };
    delete (prevThemes as Record<string, Theme>).Ubuntu;
    const prev: ShippedDefaults = { ...SHIPPED, themes: prevThemes };
    await new ShippedDefaultsService(store, prev).seed();
    // The user edits a built-in; it must survive the upgrade.
    await store.write({ kind: 'theme', name: 'Matrix' }, { ...SHIPPED.themes.Matrix, colours: { ...SHIPPED.themes.Matrix.colours, accent: '#123456' } });
    const matrixBefore = readFileSync(join(root, 'themes', 'Matrix.json'), 'utf8');

    // Upgrade to the current record (which adds Ubuntu).
    const res = await new ShippedDefaultsService(store, SHIPPED).upgrade();
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.added).toContain('Ubuntu');
    expect(readJson(join(root, 'themes', 'Ubuntu.json'))).toEqual(SHIPPED.themes.Ubuntu);
    // The user's edited Matrix is byte-identical (upgrade never overwrites a value).
    expect(readFileSync(join(root, 'themes', 'Matrix.json'), 'utf8')).toBe(matrixBefore);
  });

  it('materialises a newly-added property into a built-in AND a custom theme, without changing existing values', async () => {
    const root = freshRoot();
    const store = new FileConfigStore(root);
    await new ShippedDefaultsService(store, SHIPPED).seed();

    // Simulate "the theme shape gained a new colour token" by STRIPPING an existing
    // token from a built-in and a custom theme (as an old-version config would lack it).
    const matrixNoAppBg = { ...SHIPPED.themes.Matrix, colours: { ...SHIPPED.themes.Matrix.colours } };
    delete (matrixNoAppBg.colours as Record<string, string>).appBg;
    await store.write({ kind: 'theme', name: 'Matrix' }, matrixNoAppBg);

    const custom: Theme = { name: 'Mine', colours: { accent: '#mine0' }, fonts: SHIPPED.themes.throng.fonts, icons: {} };
    await store.write({ kind: 'theme', name: 'Mine' }, custom);

    const res = await new ShippedDefaultsService(store, SHIPPED).upgrade();
    expect(res.ok).toBe(true);

    const matrix = readJson(join(root, 'themes', 'Matrix.json')) as Theme;
    // The stripped token is materialised from Matrix's OWN shipped value; accent (present) unchanged.
    expect(matrix.colours.appBg).toBe(SHIPPED.themes.Matrix.colours.appBg);
    expect(matrix.colours.accent).toBe(SHIPPED.themes.Matrix.colours.accent);

    const mine = readJson(join(root, 'themes', 'Mine.json')) as Theme;
    // The custom theme gains missing tokens from the THRONG base; its own accent is kept.
    expect(mine.colours.accent).toBe('#mine0');
    expect(mine.colours.appBg).toBe(SHIPPED.themes.throng.colours.appBg);
  });

  it('is idempotent: a second upgrade changes nothing and records the version', async () => {
    const root = freshRoot();
    const store = new FileConfigStore(root);
    await new ShippedDefaultsService(store, SHIPPED).seed();
    const service = new ShippedDefaultsService(store, SHIPPED);

    const first = await service.upgrade();
    expect(first.ok).toBe(true);
    const snapshot = reservedThemeNames(SHIPPED).map((n) => readFileSync(join(root, 'themes', `${n}.json`), 'utf8'));

    const second = await service.upgrade();
    expect(second.ok).toBe(true);
    if (second.ok) {
      expect(second.added).toEqual([]);
      expect(second.filled).toEqual([]);
    }
    reservedThemeNames(SHIPPED).forEach((n, i) => {
      expect(readFileSync(join(root, 'themes', `${n}.json`), 'utf8'), n).toBe(snapshot[i]);
    });
    expect(await service.readAppliedVersion()).toBe(SHIPPED_DEFAULTS_VERSION);
  });
});
