import { test, expect } from '@playwright/test';
import { createProject, firstPanelId, runApp } from './harness.js';

// US7 / 003 clone-sync: renaming a Panel in a sub-workspace window renames the
// same Panel (shared id) in the parent project in real time, and vice-versa.
test('renaming a Panel in a sub-workspace renames it in the parent project (live)', async () => {
  await runApp(async (app, win) => {
    await createProject(win, 'RenameSync', 'C:/c/renamesync');
    const pid = await firstPanelId(win);

    // Sync the Panel into a new sub-workspace (clone keeps it in the project).
    await win.getByTestId(`panel-handle-${pid}`).click({ button: 'right' });
    await win.getByTestId('menu-item-Sync to').click();
    const [child] = await Promise.all([
      app.waitForEvent('window'),
      win.getByTestId('menu-item-New Sub-workspace').click(),
    ]);
    await child.waitForLoadState('domcontentloaded');
    await expect(child.locator('.panel-box')).toHaveCount(1);

    // Rename the Panel in the CHILD window.
    await child.getByTestId(`panel-handle-${pid}`).dblclick();
    const input = child.getByTestId(`panel-rename-input-${pid}`);
    await input.fill('Renamed Live');
    await input.press('Enter');

    // The MAIN window's Panel updates in real time (same logical Panel).
    await expect(
      win.getByTestId(`panel-${pid}`).locator('.panel-box__title'),
    ).toHaveText('Renamed Live');

    // And the reverse: renaming in the main window flows back to the sub-workspace.
    await win.getByTestId(`panel-handle-${pid}`).dblclick();
    const mainInput = win.getByTestId(`panel-rename-input-${pid}`);
    await mainInput.fill('Back Again');
    await mainInput.press('Enter');
    await expect(
      child.getByTestId(`panel-${pid}`).locator('.panel-box__title'),
    ).toHaveText('Back Again');
  });
});
