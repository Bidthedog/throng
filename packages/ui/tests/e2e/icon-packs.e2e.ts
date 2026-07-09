import { mkdirSync, mkdtempSync, existsSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { runApp } from './harness.js';

/**
 * US4 (007 Phase F): icon packs — a pack dropped under icon-packs\ is selectable
 * and re-skins tokens; a per-token override wins; a token missing from the pack
 * falls back to the throng glyph. Uses glyph tokens (no file:// images) so the
 * sandboxed renderer needs no external resources. The pack-format README is seeded.
 */
const cfgRoots: string[] = [];
function freshCfgRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'throng-cfg-icons-'));
  cfgRoots.push(dir);
  // Seed a glyph-only icon pack.
  const packDir = join(dir, 'icon-packs', 'mypack');
  mkdirSync(packDir, { recursive: true });
  writeFileSync(
    join(packDir, 'pack.json'),
    JSON.stringify({ name: 'mypack', tokens: { folder: 'FF', add: 'AA' } }, null, 2),
    'utf8',
  );
  return dir;
}
/** A truly empty config root so the app seeds the bundled packs on first run. */
function bareCfgRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'throng-cfg-icons-'));
  cfgRoots.push(dir);
  return dir;
}
test.afterAll(() => {
  for (const dir of cfgRoots.splice(0)) rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
});

async function openThemes(app: ElectronApplication, win: Page): Promise<Page> {
  await win.getByTestId('title-bar-cog').click();
  const [prefs] = await Promise.all([
    app.waitForEvent('window'),
    win.getByTestId('cog-menu-themes').click(),
  ]);
  await prefs.waitForLoadState('domcontentloaded');
  await expect(prefs.getByTestId('themes-tab')).toBeVisible();
  return prefs;
}

test('a user pack is selectable, re-skins its tokens, and missing tokens fall back', async () => {
  const cfgRoot = freshCfgRoot();
  await runApp(
    async (app, win) => {
      const prefs = await openThemes(app, win);
      // The pack is discovered and selectable.
      await expect(prefs.getByTestId('icon-pack-select').locator('option', { hasText: 'mypack' })).toHaveCount(1);
      await prefs.getByTestId('icon-pack-select').selectOption('mypack');
      // Pack tokens render the pack glyph; a token absent from the pack keeps the throng glyph.
      await expect(prefs.getByTestId('icon-cell-folder')).toContainText('FF');
      await expect(prefs.getByTestId('icon-cell-add')).toContainText('AA');
      await expect(prefs.getByTestId('icon-cell-terminal')).toContainText('▣'); // throng fallback
    },
    { env: { THRONG_CONFIG_ROOT: cfgRoot } },
  );
});

test('overriding a single token changes only that token', async () => {
  const cfgRoot = freshCfgRoot();
  await runApp(
    async (app, win) => {
      const prefs = await openThemes(app, win);
      await prefs.getByTestId('icon-pack-select').selectOption('mypack');
      await expect(prefs.getByTestId('icon-pack-select')).toHaveValue('mypack'); // pack applied
      const override = prefs.getByTestId('icon-override-add');
      await override.fill('ZZ');
      await override.blur();
      await expect(prefs.getByTestId('icon-cell-add')).toContainText('ZZ');
      // folder still from the pack
      await expect(prefs.getByTestId('icon-cell-folder')).toContainText('FF');
    },
    { env: { THRONG_CONFIG_ROOT: cfgRoot } },
  );
});

test('a fresh install seeds the throng glyph pack + an SVG image pack (H6, FR-040b)', async () => {
  const cfgRoot = bareCfgRoot();
  await runApp(
    async (app, win) => {
      const prefs = await openThemes(app, win);
      const select = prefs.getByTestId('icon-pack-select');
      // Both bundled packs are discovered + selectable (≥2, incl. throng + throng-svg).
      await expect.poll(() => select.locator('option[value="throng"]').count()).toBe(1);
      await expect.poll(() => select.locator('option[value="throng-svg"]').count()).toBe(1);
      // The throng glyph pack is selected by default (FR-040b).
      await expect(select).toHaveValue('throng');
      // Its files are on disk under icon-packs/.
      expect(existsSync(join(cfgRoot, 'icon-packs', 'throng', 'pack.json'))).toBe(true);
      expect(existsSync(join(cfgRoot, 'icon-packs', 'throng-svg', 'folder.svg'))).toBe(true);

      // Selecting the SVG pack renders images (24px) instead of glyph text.
      await select.selectOption('throng-svg');
      const img = prefs.getByTestId('icon-cell-folder').locator('img.icon-cell__img');
      await expect(img).toBeVisible();
      await expect(img).toHaveAttribute('src', /throng-svg\/folder\.svg$/);
      const box = await img.boundingBox();
      expect(box).not.toBeNull();
      expect(Math.round(box!.width)).toBe(24);
      expect(Math.round(box!.height)).toBe(24);
    },
    { env: { THRONG_CONFIG_ROOT: cfgRoot } },
  );
});

test('the pack-format README is seeded under icon-packs/', async () => {
  const cfgRoot = freshCfgRoot();
  await runApp(
    async (app, win) => {
      await openThemes(app, win);
      await expect.poll(() => existsSync(join(cfgRoot, 'icon-packs', 'README.md'))).toBe(true);
    },
    { env: { THRONG_CONFIG_ROOT: cfgRoot } },
  );
});
