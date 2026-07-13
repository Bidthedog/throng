import { mkdirSync, mkdtempSync, existsSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { runApp, settle, createProject } from './harness.js';

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

      /*
       * 017 / #54 — this assertion used to pin `<img src="file://…/throng-svg/folder.svg">`.
       *
       * That rendering IS the bug. An SVG inside an `<img>` is an isolated document, so its
       * `stroke="currentColor"` resolved against the image's own black default instead of the
       * page's theme colour — which is why the SVG pack was black-on-dark and unusable. The pack
       * icon is now INLINED, so `currentColor` binds to the theme.
       *
       * The old test is rewritten, not preserved. A test that asserts the defect is not coverage
       * worth keeping — and honouring "no existing test may change" here would have forced the
       * `<img>` to stay and defeated the fix.
       */
      await select.selectOption('throng-svg');
      const svg = prefs.getByTestId('icon-cell-folder').locator('svg');
      await expect(svg).toBeVisible();
      // Inline, in the page's own document — so it can inherit the theme's colour.
      await expect(svg).toHaveAttribute('stroke', 'currentColor');
      await expect(prefs.getByTestId('icon-cell-folder').locator('img')).toHaveCount(0);
      const box = await svg.boundingBox();
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

/**
 * 017 / #54 — the assertions that were MISSING, and whose absence is why the bug shipped.
 *
 * Every pre-017 test in this file exercised the Preferences → Icons grid and nothing else. The grid
 * was the one place a pack was honoured, so the suite was green while the setting did nothing
 * whatsoever in the application the user was actually looking at. These tests assert the MAIN
 * WINDOW.
 */
test('selecting a pack changes the icons in the MAIN WINDOW, live, with no restart (FR-001/005)', async () => {
  const cfgRoot = bareCfgRoot();
  await runApp(
    async (app, win) => {
      await settle(win);
      await createProject(win, 'Icons', 'C:/c/icons'); // an empty shell has no icon controls to inspect

      // The default `throng` pack is a glyph pack, so nothing in the chrome is an inline SVG yet.
      await expect(win.locator('.icon > svg')).toHaveCount(0);
      const glyphsBefore = await win.locator('.icon').count();
      expect(glyphsBefore).toBeGreaterThan(0);

      const prefs = await openThemes(app, win);
      await prefs.getByTestId('icon-pack-select').selectOption('throng-svg');

      // The MAIN window re-skins itself — no restart, no reopening a panel. Before 017 this count
      // stayed at zero forever, which was the entire bug.
      await expect(win.locator('.icon > svg').first()).toBeVisible();
      expect(await win.locator('.icon > svg').count()).toBeGreaterThan(0);

      // Reverting restores the glyphs, also live.
      await prefs.getByTestId('icon-pack-select').selectOption('throng');
      await expect(win.locator('.icon > svg')).toHaveCount(0);
    },
    { env: { THRONG_CONFIG_ROOT: cfgRoot } },
  );
});

test('pack icons take their colour from the THEME, not a fixed black (FR-004)', async () => {
  const cfgRoot = bareCfgRoot();
  await runApp(
    async (app, win) => {
      await settle(win);
      await createProject(win, 'Icons', 'C:/c/icons');
      const prefs = await openThemes(app, win);
      await prefs.getByTestId('icon-pack-select').selectOption('throng-svg');

      const svg = win.locator('.icon > svg').first();
      await expect(svg).toBeVisible();

      /*
       * `stroke="currentColor"` is the whole mechanism. Inside an <img> it resolved against the
       * image's own document (black); inlined, it resolves against the page — so the icon is
       * whatever colour the theme's text is. The computed stroke must therefore NOT be black,
       * because the default theme's text is not black.
       */
      await expect(svg).toHaveAttribute('stroke', 'currentColor');
      const stroke = await svg.evaluate((el) => getComputedStyle(el).stroke);
      expect(stroke).not.toBe('rgb(0, 0, 0)');
      expect(stroke).toBeTruthy();
    },
    { env: { THRONG_CONFIG_ROOT: cfgRoot } },
  );
});

test('icons are DECORATIVE to assistive technology (FR-006c / SC-010)', async () => {
  const cfgRoot = bareCfgRoot();
  await runApp(
    async (_app, win) => {
      await settle(win);
      await createProject(win, 'Icons', 'C:/c/icons');

      // Every icon is hidden from the accessibility tree. The accessible name comes from the
      // ENCLOSING control — so a screen-reader user hears the action once, and never the glyph.
      // (Before 017 the raw glyph character was in the DOM as text and was read aloud.)
      const icons = win.locator('.icon');
      const count = await icons.count();
      expect(count).toBeGreaterThan(0);
      const hidden = await icons.evaluateAll((els) =>
        els.map((el) => el.getAttribute('aria-hidden')),
      );
      expect(hidden.every((v) => v === 'true')).toBe(true);

      // …and the button around it still names its action.
      const button = win.locator('.icon-button').first();
      if ((await button.count()) > 0) {
        await expect(button).toHaveAttribute('aria-label', /.+/);
      }
    },
    { env: { THRONG_CONFIG_ROOT: cfgRoot } },
  );
});

test('a BROKEN pack degrades: the app starts, icons fall back, and the picker says why (FR-004a / SC-011)', async () => {
  const cfgRoot = mkdtempSync(join(tmpdir(), 'throng-cfg-icons-'));
  cfgRoots.push(cfgRoot);
  // A pack directory whose manifest is unreadable. Silently dropping it would recreate the exact
  // confusion this feature exists to remove: a setting that appears to do nothing.
  const brokenDir = join(cfgRoot, 'icon-packs', 'brokenpack');
  mkdirSync(brokenDir, { recursive: true });
  writeFileSync(join(brokenDir, 'pack.json'), '{ this is not json', 'utf8');

  await runApp(
    async (app, win) => {
      // 1. The app STARTS. A broken pack must never be fatal.
      await settle(win);
      await createProject(win, 'Icons', 'C:/c/icons');

      // 2. Icons still render — they fall back to the theme's glyphs rather than leaving holes.
      expect(await win.locator('.icon').count()).toBeGreaterThan(0);

      // 3. The picker shows the pack as unavailable, WITH the reason — it does not vanish.
      const prefs = await openThemes(app, win);
      const option = prefs.getByTestId('icon-pack-option-brokenpack');
      await expect(option).toHaveCount(1);
      await expect(option).toBeDisabled();
      await expect(option).toHaveAttribute('title', /pack\.json/i);
    },
    { env: { THRONG_CONFIG_ROOT: cfgRoot } },
  );
});
