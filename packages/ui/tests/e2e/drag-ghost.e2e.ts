import { test, expect } from '@playwright/test';
import { createProject, firstPanelId, runApp } from './harness.js';

// US1 / SC-001: a translucent ghost follows the cursor during a drag. It is a
// real frameless/transparent OS window (so it can paint at and beyond the app
// edge) loaded from a data: URL — visible while dragging, hidden on drop.
const ghostVisible = ({ BrowserWindow }: typeof import('electron')): boolean =>
  BrowserWindow.getAllWindows().some(
    (w) => w.webContents.getURL().startsWith('data:text/html') && w.isVisible(),
  );

// The visible ghost's rendered text — proves the per-drag content swap
// (`__renderGhost`, executeJavaScript on the once-loaded shell) actually paints.
const ghostText = (electronApi: typeof import('electron')): Promise<string> => {
  const { BrowserWindow } = electronApi;
  const w = BrowserWindow.getAllWindows().find(
    (win) => win.webContents.getURL().startsWith('data:text/html') && win.isVisible(),
  );
  if (!w) return Promise.resolve('');
  return w.webContents.executeJavaScript(
    "document.getElementById('ghost-root') ? document.getElementById('ghost-root').innerText : ''",
  ) as Promise<string>;
};

test('shows a cursor-following ghost window during a drag, gone on drop', async () => {
  await runApp(async (app, win) => {
    await createProject(win, 'Ghost', 'C:/c/ghost');
    await expect(win.getByTestId('tab-strip')).toBeVisible();

    const pid = await firstPanelId(win);
    const title = (await win.getByTestId(`panel-${pid}`).locator('.panel-box__title').innerText()).trim();
    const box = await win.getByTestId(`panel-handle-${pid}`).boundingBox();
    if (!box) throw new Error('no panel handle');

    // Begin a drag (past the 4px activation distance) — the ghost window appears.
    await win.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await win.mouse.down();
    await win.mouse.move(box.x + 60, box.y + 60, { steps: 8 });
    await expect.poll(() => app.evaluate(ghostVisible), { timeout: 3000 }).toBe(true);
    // The ghost shows the dragged Panel's title (content rendered into the shell).
    await expect.poll(() => app.evaluate(ghostText), { timeout: 3000 }).toContain(title);

    // Drop → the ghost is hidden again.
    await win.mouse.up();
    await expect.poll(() => app.evaluate(ghostVisible), { timeout: 3000 }).toBe(false);
  });
});
