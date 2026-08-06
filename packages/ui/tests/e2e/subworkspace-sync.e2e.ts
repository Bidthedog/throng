import { test, expect } from '@playwright/test';
import {
  openApp,
  createProject as newProject,
  firstPanelId,
  reloadWindow,
  type AppOptions,
  type OpenApp,
} from './harness.js';

/*
 * ONE app for this file, not one per test.
 *
 * Each test used to launch its own Electron app, daemon and window — roughly two seconds apiece, and
 * 604 such launches across the suite — to run assertions that never needed a pristine app. Only a
 * test that seeds state BEFORE launch genuinely does, and those keep their own app via `runOwnApp`.
 *
 * The shims below exist so the test bodies below are unchanged:
 *   runApp        runs the body against the shared window. It refuses options rather than ignoring
 *                 them: a dropped config root does not fail, it passes for the wrong reason.
 *   createProject appends a counter, because a shared app accumulates projects and duplicate names
 *                 make `.project-item` ambiguous.
 *
 * Serial mode is required — shared window, shared database — and it means a failure skips the rest
 * rather than running them against whatever state the failure left behind.
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
  fn: (app: OpenApp['app'], win: OpenApp['win'], ctx: { pipeName: string; userDataDir: string }) => Promise<void>,
  opts?: AppOptions,
): Promise<void> => {
  if (opts) {
    throw new Error(
      'this file shares one app; a test needing launch options must call runOwnApp instead',
    );
  }
  return fn(shared.app, shared.win, {
    pipeName: shared.pipeName,
    userDataDir: shared.userDataDir,
  });
};

let projectSeq = 0;
const createProject = (win: OpenApp['win'], name: string, root: string): Promise<void> =>
  newProject(win, `${name}-${(projectSeq += 1)}`, root);


// US7 / 003 clone-and-sync (feedback items 3-5): a Tab/Panel can be "Sync to"-ed
// into an EXISTING sub-workspace from the context menu (and, via drag, by dropping
// onto its window). Cloning leaves the original in place.

// Seed one sub-workspace "Detached A" (id sw1) with a single Tab "T" / Panel "p".
const seedSub = `(() => window.throng.invoke('workspace.persistSubWorkspaces', { subWorkspaces: [
  { id: 'sw1', ownerUser: 'u', name: 'Detached A', colour: '#3fb950',
    bounds: { x: 0, y: 0, width: 400, height: 300 },
    tabs: [{ id: 't', title: 'T', root: { type: 'panel', id: 'p', originProjectId: 'x', title: 'P' } }] },
] }))()`;

test('syncs a Tab into an existing sub-workspace via the menu', async () => {
  await runApp(async (_app, win) => {
    await win.evaluate(seedSub);
    await reloadWindow(win);
    await createProject(win, 'Syncer', 'C:/c/syncer');
    await expect(win.getByTestId('tab-strip')).toBeVisible();
    await expect(win.getByTestId('subworkspace-counts-sw1')).toContainText('1T');

    // Right-click the Tab → Sync to → Detached A.
    await win.locator('.tab-chip').first().click({ button: 'right' });
    await win.getByTestId('menu-item-Sync to').click(); // opens the submenu
    await win.getByTestId('menu-item-Detached A').click();

    // The sub-workspace gains a second Tab (the clone) — original stays in the main.
    await expect(win.getByTestId('subworkspace-counts-sw1')).toContainText('2T');
    await expect(win.locator('.tab-chip')).toHaveCount(1); // main unchanged
  });
});

test('syncs a Panel into a chosen Tab of an existing sub-workspace (third level)', async () => {
  await runApp(async (_app, win) => {
    await win.evaluate(seedSub);
    await reloadWindow(win);
    await createProject(win, 'PanelSync', 'C:/c/panelsync');
    const pid = await firstPanelId(win);
    await expect(win.getByTestId('subworkspace-counts-sw1')).toContainText('1T·1P');

    // Right-click the Panel → Sync to → Detached A → its Tab "T".
    await win.getByTestId(`panel-handle-${pid}`).click({ button: 'right' });
    await win.getByTestId('menu-item-Sync to').click();
    await win.getByTestId('menu-item-Detached A').click();
    // The third-level flyout must be fully on-screen (not clipped to a scrollbar).
    await expect(win.getByTestId('menu-item-New Tab')).toBeInViewport();
    await expect(win.getByTestId('menu-item-T')).toBeInViewport();
    await win.getByTestId('menu-item-T').click();

    // The Panel is cloned into that Tab → still 1 Tab, now 2 Panels.
    await expect(win.getByTestId('subworkspace-counts-sw1')).toContainText('1T·2P');
    await expect(win.locator('.panel-box')).toHaveCount(1); // main project unchanged
  });
});

test('syncing a Panel as a "New" Tab adds a Tab to the sub-workspace', async () => {
  await runApp(async (_app, win) => {
    await win.evaluate(seedSub);
    await reloadWindow(win);
    await createProject(win, 'NewTabSync', 'C:/c/newtabsync');
    const pid = await firstPanelId(win);

    await win.getByTestId(`panel-handle-${pid}`).click({ button: 'right' });
    await win.getByTestId('menu-item-Sync to').click();
    await win.getByTestId('menu-item-Detached A').click();
    await win.getByTestId('menu-item-New Tab').click(); // a fresh Tab in the sub-workspace

    await expect(win.getByTestId('subworkspace-counts-sw1')).toContainText('2T·2P');
  });
});

test('a Panel cannot be synced to a sub-workspace twice (greyed out)', async () => {
  await runApp(async (_app, win) => {
    await win.evaluate(seedSub);
    await reloadWindow(win);
    await createProject(win, 'OnceOnly', 'C:/c/onceonly');
    const pid = await firstPanelId(win);

    // Sync the Panel into Detached A as a new Tab.
    await win.getByTestId(`panel-handle-${pid}`).click({ button: 'right' });
    await win.getByTestId('menu-item-Sync to').click();
    await win.getByTestId('menu-item-Detached A').click();
    await win.getByTestId('menu-item-New Tab').click();
    await expect(win.getByTestId('subworkspace-counts-sw1')).toContainText('2P');

    // Re-open the menu → Detached A is disabled (the Panel is already in it).
    await win.getByTestId(`panel-handle-${pid}`).click({ button: 'right' });
    await win.getByTestId('menu-item-Sync to').click();
    await expect(win.getByTestId('menu-item-Detached A')).toHaveClass(
      /context-menu__item--disabled/,
    );
  });
});

// Item 5 (drag a Tab/Panel past the main window's edge ONTO an open sub-workspace
// window → it is cloned there) is implemented via the main-process cursor
// hit-test (`subWorkspace.atPoint`) + `syncToExisting` on a drop-outside. It is
// NOT exercised here because Playwright clamps the mouse to the page viewport and
// can't move the OS cursor onto another window — the same limitation that blocks
// an E2E for the drag-past-edge "Sync to new window" gesture. The identical
// add-to-existing OUTCOME is covered by the "Sync to" menu tests above.
