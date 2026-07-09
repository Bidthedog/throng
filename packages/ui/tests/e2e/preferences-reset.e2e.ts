import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { runApp } from './harness.js';

/**
 * US6 (007 Phase G): reset-current restores the tab's defaults (disabled for a
 * user theme), reset-all reverts the session to the on-entry snapshot, and both
 * require an explicit confirmation (cancel is a no-op).
 */
const cfgRoots: string[] = [];
function freshCfgRoot(seedThemes: Record<string, unknown> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'throng-cfg-reset-'));
  cfgRoots.push(dir);
  if (Object.keys(seedThemes).length) {
    const themesDir = join(dir, 'themes');
    mkdirSync(themesDir, { recursive: true });
    for (const [name, theme] of Object.entries(seedThemes)) {
      writeFileSync(join(themesDir, `${name}.json`), JSON.stringify(theme, null, 2), 'utf8');
    }
  }
  return dir;
}
test.afterAll(() => {
  for (const dir of cfgRoots.splice(0)) rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
});
function readSettings(cfgRoot: string): any {
  try {
    return JSON.parse(readFileSync(join(cfgRoot, 'settings.json'), 'utf8'));
  } catch {
    return null;
  }
}
async function openPrefs(app: ElectronApplication, win: Page, tab: 'settings' | 'themes'): Promise<Page> {
  await win.getByTestId('title-bar-cog').click();
  const [prefs] = await Promise.all([
    app.waitForEvent('window'),
    win.getByTestId(`cog-menu-${tab === 'settings' ? 'settings' : 'themes'}`).click(),
  ]);
  await prefs.waitForLoadState('domcontentloaded');
  return prefs;
}

test('reset-current restores the settings tab defaults (with confirm)', async () => {
  const cfgRoot = freshCfgRoot();
  await runApp(
    async (app, win) => {
      const prefs = await openPrefs(app, win, 'settings');
      await expect(prefs.getByTestId('settings-tab')).toBeVisible();
      // Change a setting away from default.
      await prefs.getByTestId('control-editor.autoSave').click();
      await expect.poll(() => readSettings(cfgRoot)?.editor?.autoSave).toBe(true);
      // Reset-current → confirm.
      await prefs.getByTestId('prefs-reset-current').click();
      await expect(prefs.getByTestId('prefs-reset-confirm')).toBeVisible();
      await prefs.getByTestId('prefs-reset-confirm-yes').click();
      await expect.poll(() => readSettings(cfgRoot)?.editor?.autoSave).toBe(false); // default
    },
    { env: { THRONG_CONFIG_ROOT: cfgRoot } },
  );
});

test('reset-current is disabled for a user-created theme', async () => {
  const cfgRoot = freshCfgRoot({
    MyUser: { name: 'MyUser', colours: {}, fonts: { family: 'x', baseSizePx: 13, weights: { normal: 400, bold: 600 } }, icons: {} },
  });
  await runApp(
    async (app, win) => {
      const prefs = await openPrefs(app, win, 'themes');
      await expect(prefs.getByTestId('themes-tab')).toBeVisible();
      await prefs.getByTestId('theme-select').selectOption('MyUser');
      await expect(prefs.getByTestId('theme-select')).toHaveValue('MyUser');
      await expect(prefs.getByTestId('prefs-reset-current')).toBeDisabled();
      // A built-in theme re-enables it.
      await prefs.getByTestId('theme-select').selectOption('throng');
      await expect(prefs.getByTestId('theme-select')).toHaveValue('throng');
      await expect(prefs.getByTestId('prefs-reset-current')).toBeEnabled();
    },
    { env: { THRONG_CONFIG_ROOT: cfgRoot } },
  );
});

test('reset controls are icon buttons with title tooltips (H3, FR-023/024)', async () => {
  const cfgRoot = freshCfgRoot();
  await runApp(
    async (app, win) => {
      const prefs = await openPrefs(app, win, 'settings');
      await expect(prefs.getByTestId('settings-tab')).toBeVisible();
      const resetCurrent = prefs.getByTestId('prefs-reset-current');
      const resetAll = prefs.getByTestId('prefs-reset-all');
      // Labelled tooltips (title-hover), not text-only buttons.
      await expect(resetCurrent).toHaveAttribute('title', 'Reset to Defaults');
      await expect(resetAll).toHaveAttribute('title', 'Revert All');
      // Rendered as icons: each carries an <svg> glyph and shows no visible text label.
      await expect(resetCurrent.locator('svg')).toHaveCount(1);
      await expect(resetAll.locator('svg')).toHaveCount(1);
      expect((await resetCurrent.innerText()).trim()).toBe('');
      expect((await resetAll.innerText()).trim()).toBe('');
    },
    { env: { THRONG_CONFIG_ROOT: cfgRoot } },
  );
});

test('reset-all reverts the session to on-entry; cancel is a no-op', async () => {
  const cfgRoot = freshCfgRoot();
  await runApp(
    async (app, win) => {
      const prefs = await openPrefs(app, win, 'settings');
      await expect(prefs.getByTestId('settings-tab')).toBeVisible();
      // Edit a setting.
      await prefs.getByTestId('control-editor.autoSave').click();
      await expect.poll(() => readSettings(cfgRoot)?.editor?.autoSave).toBe(true);
      // Reset-all → cancel: no change.
      await prefs.getByTestId('prefs-reset-all').click();
      await prefs.getByTestId('prefs-reset-confirm-no').click();
      expect(readSettings(cfgRoot)?.editor?.autoSave).toBe(true);
      // Reset-all → confirm: reverts to on-entry (autoSave false).
      await prefs.getByTestId('prefs-reset-all').click();
      await prefs.getByTestId('prefs-reset-confirm-yes').click();
      await expect.poll(() => readSettings(cfgRoot)?.editor?.autoSave).toBe(false);
    },
    { env: { THRONG_CONFIG_ROOT: cfgRoot } },
  );
});
