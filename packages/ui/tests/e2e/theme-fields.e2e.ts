import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { runApp, createProject } from './harness.js';

/**
 * 021 / US6, FR-023–026 — the surface consolidation, proven in the running app.
 *
 * The token model changed underneath the renderer; this proves the RENDER honours it. Distinct hex
 * values are written into the active theme, then real elements' computed backgrounds are read back:
 *  - every `.ctl` field (a settings input + the Themes dropdown) resolves to `inputSurface`;
 *  - a menu/dropdown card (the context menu) resolves to `surfaceActive`;
 *  - a dialog card (a modal) resolves to `surface`;
 *  - the Files & Folders pane (`.pane--explorer`) resolves to the SAME background as the sidebar.
 * It also proves the US5 relabel reached the UI: the Themes editor shows the renamed rows.
 */

// Distinct, collision-free values so a wrong token can't accidentally match the right colour.
const VALUES = {
  inputSurface: '#113355',
  surface: '#224466',
  surfaceActive: '#335577',
  sidebarBg: '#446688',
};
const rgb = (hex: string): string => {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
};

const cfgRoots: string[] = [];
function freshCfgRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'throng-cfg-fields-'));
  cfgRoots.push(dir);
  mkdirSync(join(dir, 'themes'), { recursive: true });
  writeFileSync(
    join(dir, 'themes', 'throng.json'),
    JSON.stringify({ name: 'throng', colours: { ...VALUES } }, null, 2),
    'utf8',
  );
  return dir;
}
test.afterAll(() => {
  for (const dir of cfgRoots.splice(0)) rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
});

const rootVar = (page: Page, name: string): Promise<string> =>
  page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name);

const bgOf = (page: Page, selector: string): Promise<string> =>
  page.locator(selector).first().evaluate((el) => getComputedStyle(el).backgroundColor);

async function openThemes(app: ElectronApplication, win: Page): Promise<Page> {
  await win.getByTestId('title-bar-cog').click();
  const [prefs] = await Promise.all([app.waitForEvent('window'), win.getByTestId('cog-menu-themes').click()]);
  await prefs.waitForLoadState('domcontentloaded');
  await expect(prefs.getByTestId('themes-tab')).toBeVisible();
  return prefs;
}

test('every surface resolves to its consolidated token + the relabel renders', async () => {
  const cfgRoot = freshCfgRoot();
  await runApp(
    async (app, win) => {
      await createProject(win, 'Fields', 'C:/c/fields');
      // Wait for the written theme to actually apply before reading any computed colour.
      await expect.poll(() => rootVar(win, '--throng-colour-inputSurface'), { timeout: 8000 }).toBe(VALUES.inputSurface);

      // --- Files & Folders pane == the sidebar (both are Side Panel Background). The `.pane--explorer`
      // element is always in the DOM (collapsed or not), so its background is readable without toggling. ---
      const sidebarBg = await bgOf(win, '.pane--sidebar');
      const explorerBg = await bgOf(win, '.pane--explorer');
      expect(sidebarBg).toBe(rgb(VALUES.sidebarBg));
      expect(explorerBg).toBe(sidebarBg);

      // --- A menu/dropdown card == surfaceActive. ---
      const panelBox = win.locator('.panel-box').first();
      const pid = await panelBox.evaluate((el) => (el as HTMLElement).dataset.panelId ?? '');
      await win.getByTestId(`panel-handle-${pid}`).click({ button: 'right' });
      await expect(win.getByTestId('context-menu')).toBeVisible();
      expect(await bgOf(win, '.context-menu')).toBe(rgb(VALUES.surfaceActive));
      await win.keyboard.press('Escape');

      // --- A dialog card == surface. ---
      await win.getByTestId('project-settings-open').click();
      const dialog = win.getByTestId('project-settings-dialog');
      await expect(dialog).toBeVisible();
      expect(await dialog.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(rgb(VALUES.surface));
      await win.keyboard.press('Escape');

      // --- The preferences fields: a settings input + the Themes dropdown == inputSurface. ---
      const prefs = await openThemes(app, win);
      await expect.poll(() => rootVar(prefs, '--throng-colour-inputSurface'), { timeout: 8000 }).toBe(VALUES.inputSurface);
      expect(await bgOf(prefs, '[data-testid="theme-select"]')).toBe(rgb(VALUES.inputSurface));

      // The renamed US5 labels render in the Themes editor (E2E evidence, not unit-only).
      await expect(prefs.locator('.settings-row', { hasText: 'Confirm Button Background' }).first()).toBeVisible();
      await expect(prefs.locator('.settings-row', { hasText: 'Editor Font Size' }).first()).toBeVisible();

      // A Settings-tab field resolves to the field surface too.
      await prefs.getByTestId('prefs-tab-settings').click();
      await expect(prefs.getByTestId('settings-tab')).toBeVisible();
      const field = prefs.getByTestId('control-behaviour.submenuHoverMs');
      await expect(field).toBeVisible();
      expect(await field.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(rgb(VALUES.inputSurface));
    },
    { env: { THRONG_CONFIG_ROOT: cfgRoot } },
  );
});
