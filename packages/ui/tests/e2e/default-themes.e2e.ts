import { mkdtempSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { runApp } from './harness.js';

/**
 * US7 (007 Phase E data, SC-007): a fresh install ships all 14 default themes plus
 * `throng` (15 total) in the Themes selector, and a delete → restore cycle brings a
 * default back.
 */
const EXPECTED_15 = [
  'throng', 'Light', 'Snake', 'Gothic', 'Windows Terminal', 'Bash', 'SUBNET',
  'VSCode', 'VI-VIM', 'English Garden', 'Matrix', 'Cyberpunk', 'Claude', 'Debian', 'Ubuntu',
];

const cfgRoots: string[] = [];
function freshCfgRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'throng-cfg-def-'));
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

test('a fresh install lists all 14 default themes plus throng (15) and restores after delete', async () => {
  const cfgRoot = freshCfgRoot();
  await runApp(
    async (app, win) => {
      const prefs = await openThemes(app, win);
      const select = prefs.getByTestId('theme-select');
      await expect.poll(() => select.locator('option').count()).toBe(15);
      const options = await select.locator('option').allTextContents();
      for (const name of EXPECTED_15) expect(options).toContain(name);

      // Select Matrix and delete it; the toolbar acts on the selected theme.
      await select.selectOption('Matrix');
      await expect(select).toHaveValue('Matrix'); // select = activate; wait for it to land
      await prefs.getByTestId('theme-delete').click();
      await prefs.getByTestId('theme-confirm-yes').click();
      await expect.poll(() => existsSync(join(cfgRoot, 'themes', 'Matrix.json'))).toBe(false);
      // A deleted built-in leaves the list entirely; Restore All is the only way back (FR-005a).
      await expect
        .poll(() => select.locator('option').allTextContents())
        .not.toContain('Matrix');

      await prefs.getByTestId('theme-restore-all').click();
      await prefs.getByTestId('theme-confirm-yes').click();
      await expect.poll(() => existsSync(join(cfgRoot, 'themes', 'Matrix.json'))).toBe(true);
    },
    { env: { THRONG_CONFIG_ROOT: cfgRoot } },
  );
});
