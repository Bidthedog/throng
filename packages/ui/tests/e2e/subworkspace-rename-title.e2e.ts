import { test, expect } from '@playwright/test';
import type { ElectronApplication } from '@playwright/test';
import {
  createProject,
  firstPanelId,
  openApp,
  type AppOptions,
  type OpenApp,
} from './harness.js';

// Bug (2026-07-01): renaming a sub-workspace while its window is open did not update
// the window title. Root cause: the rename action persisted + refreshed the sidebar
// but never broadcast subWorkspace.notifyChanged, so the open window never re-read
// its identity (name/colour). The window title MUST update live.

const windowTitles = (app: ElectronApplication): Promise<string[]> =>
  app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => w.getTitle()));

/*
 * ONE app for this file, not one per test (034 FR-045, SC-027) — 2 launches -> 1.
 *
 * Nothing is seeded before launch; both projects sit on paths that never exist
 * (C:/c/renametitle, C:/c/recolourws), so there is no real root and no filesystem watcher to
 * outlive anything.
 *
 * DECLARATION ORDER IS LOAD-BEARING. Test 1 polls the window titles for "Sub-workspace 1"
 * (:31) — an ORDINAL, true only of the first sub-workspace this app ever makes. It is declared
 * first and must stay first. Test 2 makes the second one and asserts nothing about its name.
 *
 * The leftover to return is the CHILD WINDOW each test opens and never closes. It is not merely
 * untidy: `throng:subworkspace:open` is create-or-focus, so a window left standing for the SAME
 * sub-workspace makes the next waitForEvent('window') wait out its whole budget. Each test here
 * makes a NEW sub-workspace, so the event does fire — the afterEach is what keeps that true for
 * a test added later, and stops two child windows competing for focus. `bringToFront` then puts
 * the main window back, because throng closes menus on blur and test 2 opens one.
 */
test.describe.configure({ mode: 'serial' });

let shared: OpenApp;

test.beforeAll(async () => {
  shared = await openApp();
});

test.afterAll(async () => {
  await shared?.close();
});

test.afterEach(async () => {
  if (!shared) return;
  for (const page of shared.app.windows()) {
    if (!page.isClosed() && page.url().includes('sw=')) await page.close().catch(() => {});
  }
  await expect
    .poll(() => shared.app.windows().filter((w) => w.url().includes('sw=')).length, {
      timeout: 5000,
    })
    .toBe(0);
  await shared.win.bringToFront();
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

test('renaming a sub-workspace updates its open window title live', { tag: ['@extended', '@window'] }, async () => {
  await runApp(async (app, win) => {
    await createProject(win, 'RenameTitle', 'C:/c/renametitle');
    const pid = await firstPanelId(win);

    // Sync the Panel into a new sub-workspace and open its window.
    await win.getByTestId(`panel-handle-${pid}`).click({ button: 'right' });
    await win.getByTestId('menu-item-Sync to').click();
    const [child] = await Promise.all([
      app.waitForEvent('window'),
      win.getByTestId('menu-item-New Sub-workspace').click(),
    ]);
    await child.waitForLoadState('domcontentloaded');
    const subId = await child.getByTestId('subworkspace-window').getAttribute('data-subworkspace');
    if (!subId) throw new Error('no sub-workspace id');

    // The window title starts with the default sub-workspace name.
    await expect
      .poll(async () => (await windowTitles(app)).some((t) => t.includes('Sub-workspace 1')))
      .toBe(true);

    // Rename it from the main window's Sub-workspaces panel.
    await win.getByTestId(`subworkspace-name-${subId}`).dblclick();
    const input = win.getByTestId(`subworkspace-rename-input-${subId}`);
    await input.fill('Renamed WS');
    await input.press('Enter');

    // The open window's title updates live to the new name.
    await expect
      .poll(async () => (await windowTitles(app)).some((t) => t.includes('Renamed WS')))
      .toBe(true);
  });
});

test('recolouring a sub-workspace updates its open window accent live', { tag: ['@extended', '@window'] }, async () => {
  // Revision (2026-07-02): colour must sync to an open sub-workspace window just
  // like the name does — the window's dominant accent (--accent) follows the swatch.
  await runApp(async (app, win) => {
    await createProject(win, 'RecolourWS', 'C:/c/recolourws');
    const pid = await firstPanelId(win);

    await win.getByTestId(`panel-handle-${pid}`).click({ button: 'right' });
    await win.getByTestId('menu-item-Sync to').click();
    const [child] = await Promise.all([
      app.waitForEvent('window'),
      win.getByTestId('menu-item-New Sub-workspace').click(),
    ]);
    await child.waitForLoadState('domcontentloaded');
    const subId = await child.getByTestId('subworkspace-window').getAttribute('data-subworkspace');
    if (!subId) throw new Error('no sub-workspace id');

    const accent = (): Promise<string> =>
      child.evaluate(() =>
        document.documentElement.style.getPropertyValue('--accent').trim().toLowerCase(),
      );
    await expect.poll(accent).not.toBe(''); // initial colour applied

    // Recolour from the main window's swatch. The native colour dialog can't be
    // driven, so set the input's value the way the picker would (native setter +
    // input/change events, which React's onChange listens to).
    await win.getByTestId(`subworkspace-colour-${subId}`).evaluate((el) => {
      const input = el as HTMLInputElement;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setter.call(input, '#12ab34');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });

    // The open sub-workspace window's accent follows live.
    await expect.poll(accent).toBe('#12ab34');
  });
});
