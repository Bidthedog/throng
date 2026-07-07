import { test, expect } from '@playwright/test';
import type { ElectronApplication } from '@playwright/test';
import { runApp, createProject } from './harness.js';

// On a narrow window the side panes auto-collapse to their rails (Explorer first,
// then the sidebar) so the app stays usable at half a 1920 screen; they restore to
// expanded when the window widens again (panes the user wants open). This is
// distinct from a manual collapse.

const resize = (app: ElectronApplication, w: number, h: number) =>
  app.evaluate(({ BrowserWindow }, [width, height]) => BrowserWindow.getAllWindows()[0].setSize(width, height), [w, h]);

test('side panes auto-collapse on a narrow window and restore when widened', async () => {
  await runApp(async (app: ElectronApplication, win) => {
    await createProject(win, 'Alpha', 'C:/code/alpha'); // activates the Explorer pane

    // Wide: both side panes expanded.
    await resize(app, 1500, 800);
    await win.waitForTimeout(300);
    await expect(win.getByTestId('pane-hide-left')).toBeVisible();
    await expect(win.getByTestId('pane-hide-right')).toBeVisible();

    // Half a 1920 screen: Explorer contracts first; the sidebar stays expanded.
    await resize(app, 960, 800);
    await win.waitForTimeout(300);
    await expect(win.getByTestId('pane-rail-right')).toBeVisible();
    await expect(win.getByTestId('pane-hide-left')).toBeVisible();

    // Narrower still (at the floor): the sidebar contracts too.
    await resize(app, 600, 800);
    await win.waitForTimeout(300);
    await expect(win.getByTestId('pane-rail-right')).toBeVisible();
    await expect(win.getByTestId('pane-rail-left')).toBeVisible();

    // Widen again: both restore to expanded (they were never manually collapsed).
    await resize(app, 1500, 800);
    await win.waitForTimeout(300);
    await expect(win.getByTestId('pane-hide-left')).toBeVisible();
    await expect(win.getByTestId('pane-hide-right')).toBeVisible();
    await expect(win.getByTestId('pane-rail-left')).toHaveCount(0);
    await expect(win.getByTestId('pane-rail-right')).toHaveCount(0);
  });
});

test('an auto-collapsed pane can be expanded at the minimum window size (and stays open)', async () => {
  await runApp(async (app: ElectronApplication, win) => {
    await createProject(win, 'Alpha', 'C:/code/alpha');

    // Shrink to the floor: both panes auto-collapse to rails.
    await resize(app, 600, 800);
    await win.waitForTimeout(300);
    await expect(win.getByTestId('pane-rail-left')).toBeVisible();
    await expect(win.getByTestId('pane-rail-right')).toBeVisible();

    // Expand the sidebar — it must open and STAY open (no flash / re-collapse),
    // even though there's no room for the workspace minimum.
    await win.getByTestId('pane-show-left').click();
    await expect(win.getByTestId('pane-hide-left')).toBeVisible();
    await win.waitForTimeout(400); // would re-collapse here if the bug were present
    await expect(win.getByTestId('pane-hide-left')).toBeVisible();
    await expect(win.locator('.pane--sidebar:not(.pane--collapsed)')).toBeVisible();

    // The Explorer can be expanded too.
    await win.getByTestId('pane-show-right').click();
    await expect(win.getByTestId('pane-hide-right')).toBeVisible();
    await win.waitForTimeout(400);
    await expect(win.getByTestId('pane-hide-right')).toBeVisible();
  });
});

test('a pane expands only to a sensible width when the window is too narrow, then restores', async () => {
  await runApp(async (app: ElectronApplication, win) => {
    await createProject(win, 'Alpha', 'C:/code/alpha');
    await resize(app, 1600, 800);
    await win.waitForTimeout(200);

    // Drag the sidebar out to its max (400) so its SET width is large.
    const h = await win.getByTestId('sidebar-hresize').boundingBox();
    if (!h) throw new Error('no sidebar handle');
    await win.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
    await win.mouse.down();
    await win.mouse.move(h.x + 600, h.y + h.height / 2, { steps: 10 });
    await win.mouse.up();
    const sideW = () =>
      win.evaluate(() => Math.round((document.querySelector('.pane--sidebar') as HTMLElement).getBoundingClientRect().width));
    expect(await sideW()).toBeGreaterThanOrEqual(390); // ~400 set width

    // Narrow so both panes auto-collapse, then manually expand the sidebar.
    await resize(app, 700, 800);
    await win.waitForTimeout(300);
    await win.getByTestId('pane-show-left').click();
    await expect(win.getByTestId('pane-hide-left')).toBeVisible();
    await win.waitForTimeout(200);
    // It expands to a sensible width (~its 250 min), NOT its 400 set width.
    const narrowW = await sideW();
    expect(narrowW).toBeLessThanOrEqual(270);
    expect(narrowW).toBeGreaterThanOrEqual(245);

    // Widen again: it restores to its full set width (the clamp is display-only).
    await resize(app, 1600, 800);
    await win.waitForTimeout(300);
    expect(await sideW()).toBeGreaterThanOrEqual(390);
  });
});

test('a manually-collapsed pane is NOT auto-restored when the window widens', async () => {
  await runApp(async (app: ElectronApplication, win) => {
    await createProject(win, 'Alpha', 'C:/code/alpha');
    await resize(app, 1500, 800);
    await win.waitForTimeout(300);

    // Manually collapse the Explorer.
    await win.getByTestId('pane-hide-right').click();
    await expect(win.getByTestId('pane-rail-right')).toBeVisible();

    // Narrow then widen — the manual collapse must persist (not auto-restore).
    await resize(app, 960, 800);
    await win.waitForTimeout(300);
    await resize(app, 1500, 800);
    await win.waitForTimeout(300);
    await expect(win.getByTestId('pane-rail-right')).toBeVisible();
    await expect(win.getByTestId('pane-show-right')).toBeVisible();
  });
});
