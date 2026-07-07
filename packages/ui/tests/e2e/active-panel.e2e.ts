import { test, expect } from '@playwright/test';
import { runApp, createProject, panelIds } from './harness.js';

// US2 (FR-002): selecting a panel activates + highlights it; each tab remembers
// its own active panel. (The global-active-on-window-focus case needs a
// sub-workspace window and is asserted in sub-workspaces.e2e.ts / US7.)

test('clicking a panel makes it the active (highlighted) panel', async () => {
  await runApp(async (_app, win) => {
    await createProject(win, 'Active', 'C:/c/active');

    const a = (await panelIds(win))[0];
    await win.getByTestId(`panel-add-${a}`).click();
    await win.keyboard.press('Enter'); // commit the new panel's inline rename
    await expect(win.locator('.panel-box')).toHaveCount(2);
    const [first, second] = await panelIds(win);

    await win.getByTestId(`panel-${first}`).click();
    await expect(win.getByTestId(`panel-${first}`)).toHaveAttribute('data-active', 'true');
    await expect(win.getByTestId(`panel-${first}`)).toHaveClass(/panel-box--active/);
    await expect(win.getByTestId(`panel-${second}`)).toHaveAttribute('data-active', 'false');

    await win.getByTestId(`panel-${second}`).click();
    await expect(win.getByTestId(`panel-${second}`)).toHaveAttribute('data-active', 'true');
    await expect(win.getByTestId(`panel-${first}`)).toHaveAttribute('data-active', 'false');
  });
});

test('each tab remembers its own active panel', async () => {
  await runApp(async (_app, win) => {
    await createProject(win, 'PerTab', 'C:/c/pertab');

    // Tab 1: two panels, make the first active.
    const a = (await panelIds(win))[0];
    await win.getByTestId(`panel-add-${a}`).click();
    await win.keyboard.press('Enter');
    await expect(win.locator('.panel-box')).toHaveCount(2);
    const [first] = await panelIds(win);
    await win.getByTestId(`panel-${first}`).click();
    await expect(win.getByTestId(`panel-${first}`)).toHaveAttribute('data-active', 'true');

    // Open a second tab (its own panel becomes active there).
    await win.getByTestId('tab-add').click();
    await win.keyboard.press('Enter');
    await expect(win.locator('.tab-chip')).toHaveCount(2);

    // Back to Tab 1 → the first panel is still the remembered active one.
    await win.locator('.tab-chip').first().click();
    await expect(win.getByTestId(`panel-${first}`)).toHaveAttribute('data-active', 'true');
  });
});
