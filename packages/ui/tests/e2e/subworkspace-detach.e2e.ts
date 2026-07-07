import { test, expect } from '@playwright/test';
import { createProject, firstPanelId, runApp } from './harness.js';

// US7 / T074: detach a Tab or Panel out of the main workspace into a brand-new
// sub-workspace window. The reliable, discoverable trigger is the context-menu
// "Detach to new window" action (the same handler also fires on a drag that drops
// beyond the window edge). After detach: a new window renders the detached
// content, the main workspace is trimmed, and the sub-workspace is listed in the
// sidebar with an auto name ("Sub-workspace 1").

test('detaches a Tab into a new sub-workspace window', async () => {
  await runApp(async (app, win) => {
    await createProject(win, 'Detacher', 'C:/c/detacher');
    await expect(win.getByTestId('tab-strip')).toBeVisible();

    // Two Tabs (to prove the *cloned* one is left behind, not the only one).
    await win.getByTestId('tab-add').click();
    await expect(win.locator('.tab-chip')).toHaveCount(2);

    // Switch to the first Tab (also commits the new Tab's rename input), then
    // open its context menu and detach it.
    const firstTab = win.locator('.tab-chip').first();
    await firstTab.click();
    await firstTab.click({ button: 'right' });
    await expect(win.getByTestId('context-menu')).toBeVisible();
    await win.getByTestId('menu-item-Sync to').click(); // open the submenu

    const [child] = await Promise.all([
      app.waitForEvent('window'),
      win.getByTestId('menu-item-New Sub-workspace').click(),
    ]);
    await child.waitForLoadState('domcontentloaded');

    // The detached Tab's Panel renders in the new sub-workspace window.
    await expect(child.getByTestId('subworkspace-window')).toBeVisible();
    await expect(child.locator('.panel-box')).toHaveCount(1);

    // Clone, not move: the main workspace KEEPS both Tabs, and the sidebar lists
    // the new sub-workspace with its tab/panel counts (1 tab · 1 panel).
    await expect(win.locator('.tab-chip')).toHaveCount(2);
    await expect(win.getByTestId('subworkspace-list')).toContainText('Sub-workspace 1');
    await expect(win.getByTestId('subworkspace-list')).toContainText('1T·1P');
  });
});

test('detaches a Panel into a new sub-workspace window', async () => {
  await runApp(async (app, win) => {
    await createProject(win, 'PanelDetach', 'C:/c/paneldetach');
    await expect(win.getByTestId('tab-strip')).toBeVisible();

    // Two Panels (to prove the *cloned* one stays in the project).
    const pid = await firstPanelId(win);
    await win.getByTestId(`panel-add-${pid}`).click();
    await expect(win.locator('.panel-box')).toHaveCount(2);
    await win.keyboard.press('Escape'); // dismiss the new Panel's rename input

    // Detach the first Panel via its header context menu.
    await win.getByTestId(`panel-handle-${pid}`).click({ button: 'right' });
    await expect(win.getByTestId('context-menu')).toBeVisible();
    await win.getByTestId('menu-item-Sync to').click(); // open the submenu

    const [child] = await Promise.all([
      app.waitForEvent('window'),
      win.getByTestId('menu-item-New Sub-workspace').click(),
    ]);
    await child.waitForLoadState('domcontentloaded');

    await expect(child.getByTestId('subworkspace-window')).toBeVisible();
    await expect(child.locator('.panel-box')).toHaveCount(1);

    // Clone, not move: the main project KEEPS both Panels; the sub-workspace is listed.
    await expect(win.locator('.panel-box')).toHaveCount(2);
    await expect(win.getByTestId('subworkspace-list')).toContainText('Sub-workspace 1');
  });
});
