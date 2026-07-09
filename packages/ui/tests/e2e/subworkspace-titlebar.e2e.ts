import { test, expect } from '@playwright/test';
import { createProject, runApp } from './harness.js';

/**
 * US8 (007 Phase A parity): a detached sub-workspace window carries the same
 * custom title bar as the main window — its own identity (name/colour) + window
 * controls — but NObar cog (the preferences entry point is main-window only, FR-007).
 */
test('a sub-workspace window shows the custom title bar with identity + controls and NO cog', async () => {
  await runApp(async (app, win) => {
    await createProject(win, 'Detacher', 'C:/c/detacher');
    await expect(win.getByTestId('tab-strip')).toBeVisible();
    await win.getByTestId('tab-add').click();
    await expect(win.locator('.tab-chip')).toHaveCount(2);

    const firstTab = win.locator('.tab-chip').first();
    await firstTab.click();
    await firstTab.click({ button: 'right' });
    await expect(win.getByTestId('context-menu')).toBeVisible();
    await win.getByTestId('menu-item-Sync to').click();

    const [child] = await Promise.all([
      app.waitForEvent('window'),
      win.getByTestId('menu-item-New Sub-workspace').click(),
    ]);
    await child.waitForLoadState('domcontentloaded');
    await expect(child.getByTestId('subworkspace-window')).toBeVisible();

    // Custom title bar present at the very top (no OS bar above it).
    const bar = child.getByTestId('title-bar');
    await expect(bar).toBeVisible();
    const box = await bar.boundingBox();
    expect(box?.y ?? 99).toBeLessThanOrEqual(1);

    // Identity shows the sub-workspace name; window controls work; NO cog.
    await expect(child.getByTestId('title-bar-identity')).toContainText('Sub-workspace 1');
    await expect(child.getByTestId('window-min')).toBeVisible();
    await expect(child.getByTestId('window-max')).toBeVisible();
    await expect(child.getByTestId('window-close')).toBeVisible();
    await expect(child.getByTestId('title-bar-cog')).toHaveCount(0);
  });
});
