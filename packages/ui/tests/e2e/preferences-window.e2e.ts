import { test, expect } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { openApp, createProject, type AppOptions, type OpenApp } from './harness.js';
import { skipIfElevated } from './admin.js';

/**
 * US9 / FR-033/034 — window titles are suffix-form (`<identity> — throng`), and the Preferences
 * window is NON-MINIMISABLE: it renders no minimise affordance AND the OS window forbids minimise.
 *
 * Each fact is asserted SEPARATELY (F5): the control's absence (renderer) and `isMinimizable()===false`
 * (OS) are distinct, so a pass cannot hide one half.
 *
 * ══ ONE LAUNCH FOR THE THREE THAT ONLY LOOK (034 FR-045) ══
 *
 * Those three facts about the preferences window used to cost three `runApp()` calls — three Electron
 * launches, three daemons — to open the same window three times and read it without touching it. They
 * now share one app and one preferences window, opened in `beforeAll`.
 *
 * They stay three TESTS rather than becoming one, which is the point of the paragraph above: merged,
 * a failed renderer assertion would abort before the OS one ran, and "the minimise control is drawn"
 * would arrive without saying whether the window is minimisable underneath it. Sharing the app costs
 * nothing there, because none of the three writes anything.
 *
 * The two below still launch their own app: both create a project, and one opens a second window.
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

let shared: OpenApp;
let prefs: Page;

/*
 * ONE app for the WHOLE file now (SC-027) — 3 launches -> 1.
 *
 * The three read-only tests already shared one app and one preferences window. The two below
 * them each launched their own, for a reason the file stated: they create a project and one of
 * them opens a second window. Neither is a claim about the STARTUP path, and neither reads
 * anything the preferences tests write — they write nothing at all.
 *
 * What actually separated them was the PREFERENCES WINDOW standing open. It is a singleton, it
 * takes focus, and the last of these tests drives a CONTEXT MENU — which throng closes on blur.
 * So the three that need that window are grouped, and the group closes it and hands focus back
 * to the main window on the way out. `lastWindowMinimizable` reads the newest window, which is
 * only the preferences window while the group owns it; that is why the grouping is a describe
 * and not merely an ordering.
 *
 * Serial mode is not optional — one window, one daemon.
 */
test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  shared = await openApp();
});

test.afterAll(async () => {
  // Test 5 opens a sub-workspace window; close it before the app goes, so teardown has one
  // window to destroy rather than two.
  for (const page of shared?.app.windows() ?? []) {
    if (!page.isClosed() && page.url().includes('sw=')) await page.close().catch(() => {});
  }
  await shared?.close();
});

const runApp = (
  fn: (app: OpenApp['app'], win: OpenApp['win']) => Promise<void>,
  opts?: AppOptions,
): Promise<void> => {
  if (opts) {
    throw new Error(
      'this file shares one app; a test needing launch options must call runOwnApp instead',
    );
  }
  return fn(shared.app, shared.win);
};

test.describe('the preferences window itself', () => {
  test.beforeAll(async () => {
    prefs = await openPreferences(shared.app, shared.win);
  });

  /*
   * Close it, and WAIT for the window to be gone rather than for the Page to be closed — the
   * two are not the same moment. Everything after this group drives the main window, and one of
   * them opens a context menu, which a focus change would close underneath it.
   */
  test.afterAll(async () => {
    if (!prefs || prefs.isClosed()) return; // beforeAll failed; there is nothing to close
    await prefs.close().catch(() => {});
    await expect
      .poll(() => shared.app.windows().filter((w) => w.url().includes('prefs=')).length, {
        timeout: 5000,
      })
      .toBe(0);
    await shared.win.bringToFront();
  });

  test('Preferences title is suffix-form "Preferences — throng"', { tag: ['@extended', '@prefs'] }, async () => {
    // In-app titlebar identity.
    await expect(prefs.getByTestId('title-bar-identity')).toHaveText('Preferences — throng');
    // OS window title — set by the main process, which is why this half needs a real window.
    const osTitle = await shared.app.evaluate(({ BrowserWindow }) => {
      const wins = BrowserWindow.getAllWindows().sort((a, b) => a.id - b.id);
      return wins[wins.length - 1].getTitle();
    });
    expect(osTitle).toBe('Preferences — throng');
  });

  test('Preferences renders NO minimise control (renderer)', { tag: ['@extended', '@prefs'] }, async () => {
    // Distinct from the OS-level assertion below: the affordance is simply not drawn.
    await expect(prefs.getByTestId('window-min')).toHaveCount(0);
    // Maximise + close remain.
    await expect(prefs.getByTestId('window-max')).toBeVisible();
    await expect(prefs.getByTestId('window-close')).toBeVisible();
  });

  test('Preferences window is non-minimizable at the OS level', { tag: ['@extended', '@prefs'] }, async () => {
    // Distinct from the renderer assertion above: the BrowserWindow itself forbids minimise.
    expect(await lastWindowMinimizable(shared.app)).toBe(false);
  });
});


test('Main window keeps its minimise control and a suffix-form title', { tag: ['@extended', '@prefs'] }, async () => {
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

test('a sub-workspace window keeps its minimise control and a suffix-form title', { tag: ['@extended', '@prefs'] }, async () => {
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
