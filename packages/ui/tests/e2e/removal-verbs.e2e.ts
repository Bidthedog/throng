import { test, expect } from '@playwright/test';
import { createProject, runApp, reloadWindow } from './harness.js';

// A sub-workspace seeded with one Panel it OWNS (originProjectId names no real project,
// so it is not a mirrored project view).
const seedOwnedSub = `(() => window.throng.invoke('workspace.persistSubWorkspaces', { subWorkspaces: [
  { id: 'sw1', ownerUser: 'u', name: 'Owned', colour: '#3fb950',
    bounds: { x: 0, y: 0, width: 500, height: 400 },
    tabs: [{ id: 't', title: 'T', root: { type: 'panel', id: 'p', originProjectId: 'x', title: 'P' } }] },
] }))()`;

// 011 US2 (FR-030..037): the four removal verbs (Close / Destroy / Remove / Delete)
// are applied per target+location. A project is REMOVED (unregistered; no files
// deleted). This spec walks the parts of the verb matrix reachable without a live
// terminal; the session-termination-vs-keeps-running rows are covered by the
// destroy/destroy-cascade specs (behaviour unchanged) plus the assertions here.

test('a project uses the Remove verb and states no files are deleted', async () => {
  await runApp(async (_app, win) => {
    await createProject(win, 'Verbs', 'C:/c/verbs');

    const del = win.locator('[data-testid^="project-delete-"]').first();
    // Control tooltip/aria uses "Remove".
    await expect(del).toHaveAttribute('title', /remove/i);

    await del.click();
    const dialog = win.getByTestId('confirm-dialog');
    await expect(dialog).toBeVisible();
    // Confirmation names the Remove verb AND states no files on disk are deleted.
    await expect(dialog).toContainText(/remove/i);
    await expect(dialog).toContainText(/no files/i);
    // No forbidden verb leaks in.
    await expect(dialog).not.toContainText(/destroy/i);
    await win.getByTestId('confirm-cancel').click();
  });
});

test('a tab uses the Destroy verb', async () => {
  await runApp(async (_app, win) => {
    await createProject(win, 'TabVerbs', 'C:/c/tabverbs');
    await win.getByTestId('tab-add').click();
    await expect(win.locator('.tab-chip')).toHaveCount(2);
    const firstTab = win.locator('.tab-chip').first();
    await firstTab.click();
    await firstTab.click({ button: 'right' });
    await expect(win.getByTestId('menu-item-Destroy Tab')).toBeVisible();
    await win.keyboard.press('Escape');
  });
});

test('a project-owned panel in the MAIN window uses Destroy', async () => {
  await runApp(async (_app, win) => {
    await createProject(win, 'PanelVerbs', 'C:/c/panelverbs');
    const pid = await win
      .locator('.panel-box')
      .first()
      .evaluate((el) => (el as HTMLElement).dataset.panelId ?? '');
    await expect(win.getByTestId(`panel-close-${pid}`)).toHaveAttribute('title', /destroy/i);
  });
});

test('a sub-workspace-OWNED panel uses Destroy in its sub-workspace window', async () => {
  await runApp(async (app, win) => {
    await win.evaluate(seedOwnedSub);
    await reloadWindow(win);
    await createProject(win, 'HostProj', 'C:/c/hostproj');

    const [child] = await Promise.all([
      app.waitForEvent('window'),
      win.getByTestId('subworkspace-open-sw1').click(),
    ]);
    await child.waitForLoadState('domcontentloaded');

    // The sub-workspace OWNS panel 'p' (no backing project) → Destroy, not Close.
    await expect(child.getByTestId('panel-close-p')).toHaveAttribute('title', /destroy/i);
    await child.getByTestId('panel-handle-p').click({ button: 'right' });
    await expect(child.getByTestId('menu-item-Destroy Panel')).toBeVisible();
    await expect(child.getByTestId('menu-item-Close Panel')).toHaveCount(0);
  });
});
