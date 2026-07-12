import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import type { ElectronApplication, Page, Locator } from '@playwright/test';
import { runApp } from './harness.js';

/**
 * Per-tab scroll position in the preferences window.
 *
 * The three editors (Settings / Key Bindings / Themes) render into ONE scrolling element — the tab
 * panel is a single DOM node whose children swap — so the browser used to carry one tab's scroll
 * offset straight over to the next: scroll deep into Settings, switch to Themes, and you landed
 * mid-way down Themes. Each editor must keep its OWN offset, restored when you come back to it.
 */
const cfgRoots: string[] = [];
function freshCfgRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'throng-cfg-scroll-'));
  cfgRoots.push(dir);
  return dir;
}
test.afterAll(() => {
  for (const dir of cfgRoots.splice(0)) rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
});

const scrollTopOf = (panel: Locator): Promise<number> =>
  panel.evaluate((el) => (el as HTMLElement).scrollTop);

const scrollTo = (panel: Locator, top: number): Promise<void> =>
  panel.evaluate((el, t) => {
    (el as HTMLElement).scrollTop = t;
  }, top);

async function openPrefs(app: ElectronApplication, win: Page): Promise<Page> {
  await win.getByTestId('title-bar-cog').click();
  const [prefs] = await Promise.all([
    app.waitForEvent('window'),
    win.getByTestId('cog-menu-settings').click(),
  ]);
  await prefs.waitForLoadState('domcontentloaded');
  await expect(prefs.getByTestId('settings-tab')).toBeVisible();
  return prefs;
}

test('each preferences tab keeps its own scroll position across tab switches', async () => {
  const cfgRoot = freshCfgRoot();
  await runApp(
    async (app, win) => {
      const prefs = await openPrefs(app, win);

      // Scroll the Settings editor down.
      const settingsPanel = prefs.getByTestId('prefs-panel-settings');
      await scrollTo(settingsPanel, 240);
      const settingsTop = await scrollTopOf(settingsPanel);
      expect(settingsTop).toBeGreaterThan(0);

      // Switching to Themes must NOT inherit Settings' offset — it starts at its own top.
      await prefs.getByTestId('prefs-tab-themes').click();
      await expect(prefs.getByTestId('themes-tab')).toBeVisible();
      const themesPanel = prefs.getByTestId('prefs-panel-themes');
      await expect.poll(() => scrollTopOf(themesPanel)).toBe(0);

      // Scroll Themes to its own position.
      await scrollTo(themesPanel, 120);
      const themesTop = await scrollTopOf(themesPanel);
      expect(themesTop).toBeGreaterThan(0);

      // Back to Settings → its own offset is restored (not Themes').
      await prefs.getByTestId('prefs-tab-settings').click();
      await expect(prefs.getByTestId('settings-tab')).toBeVisible();
      await expect.poll(() => scrollTopOf(prefs.getByTestId('prefs-panel-settings'))).toBe(settingsTop);

      // And back to Themes → its offset is restored too.
      await prefs.getByTestId('prefs-tab-themes').click();
      await expect(prefs.getByTestId('themes-tab')).toBeVisible();
      await expect.poll(() => scrollTopOf(prefs.getByTestId('prefs-panel-themes'))).toBe(themesTop);
    },
    { env: { THRONG_CONFIG_ROOT: cfgRoot } },
  );
});
