import { test, expect } from '@playwright/test';
import {
  openApp,
  createProject,
  panelIds,
  commitPanelRename,
  commitTabRename,
  type AppOptions,
  type OpenApp,
} from './harness.js';

/*
 * ONE app for this file, not one per test (034 FR-045, SC-010) — 2 launches -> 1.
 *
 * Nothing is seeded before launch and neither test touches disk. The two projects (`Active`,
 * `PerTab`) sit on distinct fake roots, and `.panel-box` / `.tab-chip` render only for the ACTIVE
 * project — so every count and every id belongs to the test that made it. Order-independent.
 *
 * The shim below REFUSES launch options rather than ignoring them: a swallowed option does not fail,
 * it makes a test pass for the wrong reason.
 *
 * Serial mode is not optional — one window and one daemon, so a failure SKIPS the rest rather than
 * running them against what it left behind.
 */
test.describe.configure({ mode: 'serial' });

let shared: OpenApp;

test.beforeAll(async () => {
  shared = await openApp();
});

test.afterAll(async () => {
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

// US2 (FR-002): selecting a panel activates + highlights it; each tab remembers
// its own active panel. (The global-active-on-window-focus case needs a
// sub-workspace window and is asserted in sub-workspaces.e2e.ts / US7.)

test('clicking a panel makes it the active (highlighted) panel', { tag: ['@extended', '@window'] }, async () => {
  await runApp(async (_app, win) => {
    await createProject(win, 'Active', 'C:/c/active');

    const a = (await panelIds(win))[0];
    await win.getByTestId(`panel-add-${a}`).click();
    await commitPanelRename(win); // the new panel opens in rename mode
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

test('each tab remembers its own active panel', { tag: ['@extended', '@window'] }, async () => {
  await runApp(async (_app, win) => {
    await createProject(win, 'PerTab', 'C:/c/pertab');

    // Tab 1: two panels, make the first active.
    const a = (await panelIds(win))[0];
    await win.getByTestId(`panel-add-${a}`).click();
    await commitPanelRename(win);
    await expect(win.locator('.panel-box')).toHaveCount(2);
    const [first] = await panelIds(win);
    await win.getByTestId(`panel-${first}`).click();
    await expect(win.getByTestId(`panel-${first}`)).toHaveAttribute('data-active', 'true');

    // Open a second tab (its own panel becomes active there).
    await win.getByTestId('tab-add').click();
    await commitTabRename(win);
    await expect(win.locator('.tab-chip')).toHaveCount(2);

    // Back to Tab 1 → the first panel is still the remembered active one.
    await win.locator('.tab-chip').first().click();
    await expect(win.getByTestId(`panel-${first}`)).toHaveAttribute('data-active', 'true');
  });
});
