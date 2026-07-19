import { test, expect } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { runApp, createProject } from './harness.js';
import { skipIfElevated } from './admin.js';

/**
 * US9 / FR-033/034 — window titles are suffix-form (`<identity> — throng`), and the Preferences
 * window is NON-MINIMISABLE: it renders no minimise affordance AND the OS window forbids minimise.
 *
 * Each fact is asserted SEPARATELY (F5): the control's absence (renderer) and `isMinimizable()===false`
 * (OS) are distinct, so a pass cannot hide one half.
 */

async function openPreferences(app: ElectronApplication, win: Page): Promise<Page> {
  await win.getByTestId('title-bar-cog').click();
  const [prefs] = await Promise.all([
    app.waitForEvent('window'),
    win.getByTestId('cog-menu-settings').click(),
  ]);
  await prefs.waitForLoadState('domcontentloaded');
  await expect(prefs.getByTestId('preferences-window')).toBeVisible();
  return prefs;
}

/** OS-level minimisable flag of the most-recently created window (the prefs window). */
function lastWindowMinimizable(app: ElectronApplication): Promise<boolean> {
  return app.evaluate(({ BrowserWindow }) => {
    const wins = BrowserWindow.getAllWindows().sort((a, b) => a.id - b.id);
    return wins[wins.length - 1].isMinimizable();
  });
}

test('Preferences title is suffix-form "Preferences — throng"', async () => {
  await runApp(async (app, win) => {
    const prefs = await openPreferences(app, win);
    // In-app titlebar identity.
    await expect(prefs.getByTestId('title-bar-identity')).toHaveText('Preferences — throng');
    // OS window title.
    const osTitle = await app.evaluate(({ BrowserWindow }) => {
      const wins = BrowserWindow.getAllWindows().sort((a, b) => a.id - b.id);
      return wins[wins.length - 1].getTitle();
    });
    expect(osTitle).toBe('Preferences — throng');
  });
});

test('Preferences renders NO minimise control (renderer)', async () => {
  await runApp(async (app, win) => {
    const prefs = await openPreferences(app, win);
    // Distinct from the OS-level assertion below: the affordance is simply not drawn.
    await expect(prefs.getByTestId('window-min')).toHaveCount(0);
    // Maximise + close remain.
    await expect(prefs.getByTestId('window-max')).toBeVisible();
    await expect(prefs.getByTestId('window-close')).toBeVisible();
  });
});

test('Preferences window is non-minimizable at the OS level', async () => {
  await runApp(async (app, win) => {
    await openPreferences(app, win);
    // Distinct from the renderer assertion above: the BrowserWindow itself forbids minimise.
    expect(await lastWindowMinimizable(app)).toBe(false);
  });
});

test('Main window keeps its minimise control and a suffix-form title', async () => {
  skipIfElevated(); // an elevated runner folds [ADMIN] before the suffix; endsWith still holds
  await runApp(async (app, win) => {
    await createProject(win, 'Suffixer', 'C:/c/suffixer');
    await expect(win.getByTestId('window-min')).toBeVisible();
    const title = await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().sort((a, b) => a.id - b.id)[0].getTitle(),
    );
    expect(title.endsWith(' — throng')).toBe(true);
    expect(title).toContain('Suffixer');
  });
});

test('a sub-workspace window keeps its minimise control and a suffix-form title', async () => {
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

    // Sub-workspace keeps minimise, and its in-app identity ends with the brand suffix.
    await expect(child.getByTestId('window-min')).toBeVisible();
    await expect
      .poll(() => child.getByTestId('title-bar-identity').textContent())
      .toMatch(/ — throng$/);
  });
});
