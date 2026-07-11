import { test, expect } from '@playwright/test';
import { createProject, firstPanelId, runApp, reloadWindow } from './harness.js';

// US7 / 003 clone-sync — feedback: a sub-workspace edited in ITS OWN window must
// propagate back to the main window so the "Sync to" menu (and the cross-window
// drop hint / active-tab target it shares, via `fullSubs`) stays accurate. The bug:
// after a Panel was synced into a sub-workspace and then DELETED inside the
// sub-workspace's window, the main window still believed the Panel was there — it
// kept the entry greyed ("already in it") even though re-adding was actually
// allowed. Root cause: the sub-workspace window never broadcast its content change.

const seedSub = `(() => window.throng.invoke('workspace.persistSubWorkspaces', { subWorkspaces: [
  { id: 'sw1', ownerUser: 'u', name: 'Detached A', colour: '#3fb950',
    bounds: { x: 0, y: 0, width: 400, height: 300 },
    tabs: [{ id: 't', title: 'T', root: { type: 'panel', id: 'p', originProjectId: 'x', title: 'P' } }] },
] }))()`;

test('a sub-workspace edited in its own window updates the main window’s sync menu', async () => {
  await runApp(async (app, win) => {
    await win.evaluate(seedSub);
    await reloadWindow(win);
    await createProject(win, 'Stale', 'C:/c/stale');
    const pid = await firstPanelId(win);
    await expect(win.getByTestId('subworkspace-counts-sw1')).toContainText('1T·1P');

    // Open Detached A's window up front (clean, before any menu interaction).
    const [child] = await Promise.all([
      app.waitForEvent('window'),
      win.getByTestId('subworkspace-open-sw1').click(),
    ]);
    await child.waitForLoadState('domcontentloaded');
    await expect(child.getByTestId('subworkspace-window')).toHaveAttribute('data-subworkspace', 'sw1');
    await expect(child.locator('.panel-box')).toHaveCount(1);

    // Sync the project Panel into Detached A's existing Tab "T". The child window
    // re-reads (cross-window content sync) and now shows both panels.
    await win.getByTestId(`panel-handle-${pid}`).click({ button: 'right' });
    await win.getByTestId('menu-item-Sync to').click();
    await win.getByTestId('menu-item-Detached A').click();
    await win.getByTestId('menu-item-T').click();
    await expect(win.getByTestId('subworkspace-counts-sw1')).toContainText('1T·2P');
    await expect(child.getByTestId(`panel-${pid}`)).toBeVisible();

    // The menu now greys "Detached A" — the Panel is already in it (correct).
    await win.getByTestId(`panel-handle-${pid}`).click({ button: 'right' });
    await win.getByTestId('menu-item-Sync to').click();
    await expect(win.getByTestId('menu-item-Detached A')).toHaveClass(
      /context-menu__item--disabled/,
    );
    await win.keyboard.press('Escape');

    // Delete the synced Panel INSIDE Detached A's window (empty Panel → no
    // confirmation, removed immediately). A sub-workspace destroy is LOCAL (FR-026):
    // it only leaves this sub-workspace — the project keeps its Panel.
    await child.getByTestId(`panel-handle-${pid}`).click({ button: 'right' });
    await child.getByTestId('menu-item-Close Panel').click();
    await expect(child.getByTestId(`panel-${pid}`)).toHaveCount(0);

    // The main window must SEE the change: counts drop back to 1T·1P …
    await expect(win.getByTestId('subworkspace-counts-sw1')).toContainText('1T·1P');

    // … and the sync menu no longer greys "Detached A" (re-adding is allowed now).
    await win.getByTestId(`panel-handle-${pid}`).click({ button: 'right' });
    await win.getByTestId('menu-item-Sync to').click();
    await expect(win.getByTestId('menu-item-Detached A')).not.toHaveClass(
      /context-menu__item--disabled/,
    );
  });
});
