import { test, expect } from '@playwright/test';
import type { ElectronApplication } from '@playwright/test';
import { createProject, firstPanelId, runApp } from './harness.js';

// Bug (2026-07-01): renaming a sub-workspace while its window is open did not update
// the window title. Root cause: the rename action persisted + refreshed the sidebar
// but never broadcast subWorkspace.notifyChanged, so the open window never re-read
// its identity (name/colour). The window title MUST update live.

const windowTitles = (app: ElectronApplication): Promise<string[]> =>
  app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => w.getTitle()));

test('renaming a sub-workspace updates its open window title live', async () => {
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

test('recolouring a sub-workspace updates its open window accent live', async () => {
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
