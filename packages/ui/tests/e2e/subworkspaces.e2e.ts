import { test, expect } from '@playwright/test';
import { runApp, reloadWindow } from './harness.js';

// US7: the Sub-workspaces panel lists the user's first-class sub-workspaces and
// lets them be renamed and deleted (delete warns then destroys). Detach (which
// creates them) isn't built yet, so we seed one via the daemon and reload — which
// also exercises the lazy "listed at startup" behaviour.

const seedSub = `(() => window.throng.invoke('workspace.persistSubWorkspaces', { subWorkspaces: [
  { id: 'sw1', ownerUser: 'u', name: 'Detached A', colour: '#3fb950',
    bounds: { x: 0, y: 0, width: 400, height: 300 },
    tabs: [{ id: 't', title: 'T', root: { type: 'panel', id: 'p', originProjectId: 'x', title: 'P' } }] },
] }))()`;

const seedTwo = `(() => window.throng.invoke('workspace.persistSubWorkspaces', { subWorkspaces: [
  { id: 'swA', ownerUser: 'u', name: 'Detached A', colour: '#3fb950',
    bounds: { x: 0, y: 0, width: 400, height: 300 },
    tabs: [{ id: 'ta', title: 'T', root: { type: 'panel', id: 'pa', originProjectId: 'x', title: 'P' } }] },
  { id: 'swB', ownerUser: 'u', name: 'Detached B', colour: '#6aa3ff',
    bounds: { x: 0, y: 0, width: 400, height: 300 },
    tabs: [{ id: 'tb', title: 'T', root: { type: 'panel', id: 'pb', originProjectId: 'x', title: 'P' } }] },
] }))()`;

test('lists, renames and deletes sub-workspaces', async () => {
  await runApp(async (_app, win) => {
    await expect(win.getByTestId('subworkspaces-panel')).toBeVisible();
    await expect(win.getByTestId('subworkspaces-empty')).toBeVisible();

    // Seed via the daemon, then reload so the lazy list picks it up.
    await win.evaluate(seedSub);
    await reloadWindow(win);
    await expect(win.getByTestId('subworkspace-name-sw1')).toHaveText('Detached A');

    // Rename (double-click → edit).
    await win.getByTestId('subworkspace-name-sw1').dblclick();
    const input = win.getByTestId('subworkspace-rename-input-sw1');
    await input.fill('Renamed SW');
    await input.press('Enter');
    await expect(win.getByTestId('subworkspace-name-sw1')).toHaveText('Renamed SW');

    // Delete uses the configurable double confirmation (default) → summary + wry.
    await win.getByTestId('subworkspace-delete-sw1').click();
    await win.getByTestId('confirm-accept').click(); // summary
    await expect(win.getByTestId('confirm-dialog')).toContainText('absolutely sure');
    await win.getByTestId('confirm-accept').click(); // wry
    await expect(win.getByTestId('subworkspaces-empty')).toBeVisible();
  });
});

// US7 feedback: deleting an OPEN sub-workspace closes its window too.
test('deleting an open sub-workspace closes its window', async () => {
  await runApp(async (app, win) => {
    await win.evaluate(seedSub);
    await reloadWindow(win);
    await expect(win.getByTestId('subworkspace-name-sw1')).toHaveText('Detached A');

    const [child] = await Promise.all([
      app.waitForEvent('window'),
      win.getByTestId('subworkspace-open-sw1').click(),
    ]);
    await child.waitForLoadState('domcontentloaded');

    // Delete (double confirm) → the open window closes and the list empties.
    const childClosed = child.waitForEvent('close');
    await win.getByTestId('subworkspace-delete-sw1').click();
    await win.getByTestId('confirm-accept').click();
    await win.getByTestId('confirm-accept').click();
    await childClosed;
    expect(child.isClosed()).toBe(true);
    await expect(win.getByTestId('subworkspaces-empty')).toBeVisible();
  });
});

// US7 (T075/T078): clicking a listed sub-workspace opens a detached window that
// renders its tabs/panels by reusing the workspace renderer (lazy reopen, FR-013).
test('opens a sub-workspace window that renders its panels (lazy reopen)', async () => {
  await runApp(async (app, win) => {
    await win.evaluate(seedSub);
    await reloadWindow(win);
    await expect(win.getByTestId('subworkspace-name-sw1')).toHaveText('Detached A');

    // The Open button → a NEW window opens, mounting the sub-workspace shell.
    const [child] = await Promise.all([
      app.waitForEvent('window'),
      win.getByTestId('subworkspace-open-sw1').click(),
    ]);
    await child.waitForLoadState('domcontentloaded');

    // Opening marks it "loaded" for the session (green dot in the list).
    await expect(win.getByTestId('subworkspace-loaded-sw1')).toBeVisible();

    // It is the sub-workspace variant for sw1, and the seeded tab "T"/panel "P"
    // render through the same TabGroup the main workspace uses.
    await expect(child.getByTestId('subworkspace-window')).toHaveAttribute(
      'data-subworkspace',
      'sw1',
    );
    await expect(child.getByTestId('tab-t')).toBeVisible();
    await expect(child.locator('.panel-box')).toHaveCount(1);

    // The window adopts the sub-workspace's colour as its dominant accent (FR-004),
    // not the default blue.
    await expect
      .poll(() =>
        child.evaluate(() =>
          getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(),
        ),
      )
      .toBe('#3fb950');
    // Each Panel is labelled with its owner; the seeded panel has no real project,
    // so it shows the sub-workspace's name.
    await expect(child.getByTestId('panel-project-p')).toHaveText('Detached A');

    // Lazy guard: clicking again raises the SAME window — no second window opens.
    await win.getByTestId('subworkspace-open-sw1').click();
    await win.waitForTimeout(300);
    expect(app.windows().length).toBe(2); // main + the one sub-workspace window
  });
});

// US7 / T078 / Constitution XI: closing the main window closes every
// sub-workspace window (the focus/raise group is also a lifecycle group).
test('closing the main window closes all sub-workspace windows', async () => {
  await runApp(async (app, win) => {
    await win.evaluate(seedSub);
    await reloadWindow(win);
    await expect(win.getByTestId('subworkspace-name-sw1')).toHaveText('Detached A');

    const [child] = await Promise.all([
      app.waitForEvent('window'),
      win.getByTestId('subworkspace-open-sw1').click(),
    ]);
    await child.waitForLoadState('domcontentloaded');

    // Close the main window → the sub-workspace window closes with it.
    const childClosed = child.waitForEvent('close');
    await win.close();
    await childClosed;
    expect(child.isClosed()).toBe(true);
  });
});

// US7 / T079 / FR-017a: a sub-workspace window's bounds are persisted on
// move/resize/close and restored (clamped onto a visible display) on reopen.
test('persists and restores a sub-workspace window size on reopen', async () => {
  await runApp(async (app, win) => {
    await win.evaluate(seedSub);
    await reloadWindow(win);
    await expect(win.getByTestId('subworkspace-name-sw1')).toHaveText('Detached A');

    const urlMatch = 'sw=sw1';
    // A target size that fits the primary display and respects the 600x560 minimum.
    const target = await app.evaluate(({ screen }) => {
      const { width, height } = screen.getPrimaryDisplay().workAreaSize;
      return { x: 40, y: 40, width: Math.min(720, width - 80), height: Math.min(600, height - 80) };
    });

    // Open, resize, then close (close persists the bounds immediately).
    const [child] = await Promise.all([
      app.waitForEvent('window'),
      win.getByTestId('subworkspace-open-sw1').click(),
    ]);
    await child.waitForLoadState('domcontentloaded');
    await app.evaluate(({ BrowserWindow }, { urlMatch, target }) => {
      const w = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes(urlMatch));
      w?.setBounds(target);
    }, { urlMatch, target });
    await win.waitForTimeout(200);
    await app.evaluate(({ BrowserWindow }, urlMatch) => {
      BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes(urlMatch))?.close();
    }, urlMatch);
    await win.waitForTimeout(400); // let the bounds write land

    // Reopen → the window comes back at the saved size, not the default.
    await Promise.all([
      app.waitForEvent('window'),
      win.getByTestId('subworkspace-open-sw1').click(),
    ]);
    const restored = await app.evaluate(({ BrowserWindow }, urlMatch) => {
      const w = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes(urlMatch));
      return w?.getBounds() ?? null;
    }, urlMatch);
    expect(restored?.width).toBe(target.width);
    expect(restored?.height).toBe(target.height);
  });
});

// US7: the sub-workspace list reorders by dragging its grip (parity with the
// project list), and the new order persists across a restart (position column).
test('reorders sub-workspaces by dragging, and the order persists', async () => {
  await runApp(async (_app, win) => {
    await win.evaluate(seedTwo);
    await reloadWindow(win);
    const names = () => win.locator('.subworkspace-item__name').allInnerTexts();
    await expect(async () => {
      expect(await names()).toEqual(['Detached A', 'Detached B']);
    }).toPass({ timeout: 5000 });

    // Drag B's grip above A.
    const grip = win.locator('.subworkspace-item', { hasText: 'Detached B' }).locator('.subworkspace-item__grip');
    const target = win.locator('.subworkspace-item', { hasText: 'Detached A' });
    const gbox = await grip.boundingBox();
    const tbox = await target.boundingBox();
    if (!gbox || !tbox) throw new Error('boxes missing');
    await win.mouse.move(gbox.x + gbox.width / 2, gbox.y + gbox.height / 2);
    await win.mouse.down();
    await win.mouse.move(gbox.x + gbox.width / 2, gbox.y - 8, { steps: 3 });
    await win.mouse.move(tbox.x + tbox.width / 2, tbox.y + 2, { steps: 8 });
    await win.mouse.up();

    await expect(async () => {
      expect(await names()).toEqual(['Detached B', 'Detached A']);
    }).toPass({ timeout: 5000 });

    // Reload → the reordered order survives (persisted via the position column).
    await reloadWindow(win);
    await expect(async () => {
      expect(await names()).toEqual(['Detached B', 'Detached A']);
    }).toPass({ timeout: 5000 });
  });
});
