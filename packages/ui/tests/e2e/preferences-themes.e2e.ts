import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { runApp } from './harness.js';

/**
 * US4 (007 Phase E): the Themes tab — select=activate, colour/enum edits apply +
 * persist, rename-collision rejected, delete with a single confirm, and restore
 * defaults. Chords/fonts pickers are unit-covered; this exercises the file + apply
 * behaviour end-to-end.
 */
const cfgRoots: string[] = [];
function freshCfgRoot(seedThemes: Record<string, unknown> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'throng-cfg-themes-'));
  cfgRoots.push(dir);
  const themesDir = join(dir, 'themes');
  mkdirSync(themesDir, { recursive: true });
  for (const [name, theme] of Object.entries(seedThemes)) {
    writeFileSync(join(themesDir, `${name}.json`), JSON.stringify(theme, null, 2), 'utf8');
  }
  return dir;
}
test.afterAll(() => {
  for (const dir of cfgRoots.splice(0)) rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
});

function readTheme(cfgRoot: string, name: string): any {
  try {
    return JSON.parse(readFileSync(join(cfgRoot, 'themes', `${name}.json`), 'utf8'));
  } catch {
    return null;
  }
}
function readActiveTheme(cfgRoot: string): string | null {
  try {
    return JSON.parse(readFileSync(join(cfgRoot, 'settings.json'), 'utf8')).appearance?.theme ?? null;
  } catch {
    return null;
  }
}

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

test('editing a colour token applies to the active theme file and reflects live', async () => {
  const cfgRoot = freshCfgRoot();
  await runApp(
    async (app, win) => {
      const prefs = await openThemes(app, win);
      await prefs.getByTestId('control-colours.accent-hex').fill('#123456');
      await expect.poll(() => readTheme(cfgRoot, 'throng')?.colours?.accent).toBe('#123456');
      // Live: the prefs window repaints from the active theme.
      await expect
        .poll(() =>
          prefs.evaluate(() =>
            getComputedStyle(document.documentElement).getPropertyValue('--throng-colour-accent').trim(),
          ),
        )
        .toBe('#123456');
    },
    { env: { THRONG_CONFIG_ROOT: cfgRoot } },
  );
});

test('select = activate: choosing a theme updates appearance.theme', async () => {
  const cfgRoot = freshCfgRoot({
    matrix: { name: 'matrix', colours: { accent: '#00ff41' }, fonts: { family: 'Consolas', baseSizePx: 13, weights: { normal: 400, bold: 600 } }, icons: {} },
  });
  await runApp(
    async (app, win) => {
      const prefs = await openThemes(app, win);
      await prefs.getByTestId('theme-select').selectOption('matrix');
      await expect.poll(() => readActiveTheme(cfgRoot)).toBe('matrix');
    },
    { env: { THRONG_CONFIG_ROOT: cfgRoot } },
  );
});

test('renaming to an existing name is rejected with inline validation', async () => {
  const cfgRoot = freshCfgRoot({
    matrix: { name: 'matrix', colours: {}, fonts: { family: 'x', baseSizePx: 13, weights: { normal: 400, bold: 600 } }, icons: {} },
  });
  await runApp(
    async (app, win) => {
      const prefs = await openThemes(app, win);
      // Active theme is 'throng'; try to rename it to the existing 'matrix'.
      await prefs.getByTestId('theme-rename-input').fill('matrix');
      await prefs.getByTestId('theme-rename-apply').click();
      await expect(prefs.getByTestId('theme-rename-error')).toBeVisible();
      // throng.json still exists; no matrix overwrite.
      expect(existsSync(join(cfgRoot, 'themes', 'throng.json'))).toBe(true);
    },
    { env: { THRONG_CONFIG_ROOT: cfgRoot } },
  );
});

test('deleting a theme requires a single confirm and removes the file', async () => {
  const cfgRoot = freshCfgRoot({
    matrix: { name: 'matrix', colours: {}, fonts: { family: 'x', baseSizePx: 13, weights: { normal: 400, bold: 600 } }, icons: {} },
  });
  await runApp(
    async (app, win) => {
      const prefs = await openThemes(app, win);
      await prefs.getByTestId('theme-select').selectOption('matrix');
      // Wait for select=activate to propagate so delete targets the active theme.
      await expect(prefs.getByTestId('theme-select')).toHaveValue('matrix');
      await prefs.getByTestId('theme-delete').click();
      await expect(prefs.getByTestId('theme-delete-confirm')).toBeVisible();
      await prefs.getByTestId('theme-delete-confirm-yes').click();
      await expect.poll(() => existsSync(join(cfgRoot, 'themes', 'matrix.json'))).toBe(false);
    },
    { env: { THRONG_CONFIG_ROOT: cfgRoot } },
  );
});

test('the font control is a pill editor saving a comma stack; a non-family role exposes it (H4)', async () => {
  const cfgRoot = freshCfgRoot();
  await runApp(
    async (app, win) => {
      const prefs = await openThemes(app, win);
      // paneTitle does NOT pin a family in the default theme, yet now exposes the
      // font control (T106).
      const key = 'typography.paneTitle.family';
      const control = prefs.getByTestId(`control-${key}`);
      await expect(control).toBeVisible();

      // Click opens a dropdown; type to filter, then pick two families → two pills.
      await control.click();
      await control.fill('Arial');
      await prefs.getByTestId(`control-${key}-option-Arial`).click();
      await expect(prefs.getByTestId(`control-${key}-pill-0`)).toContainText('Arial');
      await control.fill('Georgia');
      await prefs.getByTestId(`control-${key}-option-Georgia`).click();
      await expect(prefs.getByTestId(`control-${key}-pill-1`)).toContainText('Georgia');

      // Saved to the theme file as a comma-separated stack.
      await expect
        .poll(() => readTheme(cfgRoot, 'throng')?.typography?.paneTitle?.family)
        .toBe('Arial, Georgia');

      // Deleting the first pill updates the saved stack.
      await prefs.getByTestId(`control-${key}-remove-0`).click();
      await expect
        .poll(() => readTheme(cfgRoot, 'throng')?.typography?.paneTitle?.family)
        .toBe('Georgia');
    },
    { env: { THRONG_CONFIG_ROOT: cfgRoot } },
  );
});

test('an existing comma stack loads back as ordered pills (H4, FR-038b)', async () => {
  const cfgRoot = freshCfgRoot({
    stacky: {
      name: 'stacky',
      colours: {},
      fonts: { family: "'Segoe UI', system-ui, sans-serif", baseSizePx: 13, weights: { normal: 400, bold: 600 } },
      icons: {},
    },
  });
  await runApp(
    async (app, win) => {
      const prefs = await openThemes(app, win);
      await prefs.getByTestId('theme-select').selectOption('stacky');
      await expect(prefs.getByTestId('theme-select')).toHaveValue('stacky');
      const key = 'fonts.family';
      await expect(prefs.getByTestId(`control-${key}-pill-0`)).toContainText('Segoe UI');
      await expect(prefs.getByTestId(`control-${key}-pill-1`)).toContainText('system-ui');
      await expect(prefs.getByTestId(`control-${key}-pill-2`)).toContainText('sans-serif');
    },
    { env: { THRONG_CONFIG_ROOT: cfgRoot } },
  );
});

test('button colour + font tokens appear in the editor and apply live to buttons (H5, FR-046a)', async () => {
  const cfgRoot = freshCfgRoot();
  await runApp(
    async (app, win) => {
      const prefs = await openThemes(app, win);
      // The four button colour tokens are exposed as colour controls; the button
      // typography role exposes the (pill) font control.
      await expect(prefs.getByTestId('control-colours.buttonBg-hex')).toBeVisible();
      await expect(prefs.getByTestId('control-colours.buttonHoverBg-hex')).toBeVisible();
      await expect(prefs.getByTestId('control-typography.button.family')).toBeVisible();

      // Edit buttonBg → saved + reflected in the live CSS var + a real button.
      await prefs.getByTestId('control-colours.buttonBg-hex').fill('#123456');
      await expect.poll(() => readTheme(cfgRoot, 'throng')?.colours?.buttonBg).toBe('#123456');
      await expect
        .poll(() =>
          prefs.evaluate(() =>
            getComputedStyle(document.documentElement).getPropertyValue('--throng-colour-buttonBg').trim(),
          ),
        )
        .toBe('#123456');
      // A toolbar button (a .prefs-toolbtn) now renders with the button background.
      await expect
        .poll(() => prefs.getByTestId('theme-restore').evaluate((el) => getComputedStyle(el).backgroundColor))
        .toBe('rgb(18, 52, 86)');
    },
    { env: { THRONG_CONFIG_ROOT: cfgRoot } },
  );
});

test('restore defaults re-creates a missing throng theme', async () => {
  const cfgRoot = freshCfgRoot();
  await runApp(
    async (app, win) => {
      const prefs = await openThemes(app, win);
      // Delete throng, then restore.
      await prefs.getByTestId('theme-delete').click();
      await prefs.getByTestId('theme-delete-confirm-yes').click();
      await expect.poll(() => existsSync(join(cfgRoot, 'themes', 'throng.json'))).toBe(false);
      await prefs.getByTestId('theme-restore').click();
      await expect.poll(() => existsSync(join(cfgRoot, 'themes', 'throng.json'))).toBe(true);
    },
    { env: { THRONG_CONFIG_ROOT: cfgRoot } },
  );
});
