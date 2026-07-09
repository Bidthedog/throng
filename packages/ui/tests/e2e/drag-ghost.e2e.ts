import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

// The visible ghost's `.g` border colour — proves the ghost is styled from the
// active theme (not a hardcoded blue).
const ghostBorderColor = (electronApi: typeof import('electron')): Promise<string> => {
  const { BrowserWindow } = electronApi;
  const w = BrowserWindow.getAllWindows().find(
    (win) => win.webContents.getURL().startsWith('data:text/html') && win.isVisible(),
  );
  if (!w) return Promise.resolve('');
  return w.webContents.executeJavaScript(
    "(()=>{const g=document.querySelector('.g');return g?getComputedStyle(g).borderTopColor:''})()",
  ) as Promise<string>;
};

const cfgRoots: string[] = [];
function seedThemeAccent(accentHex: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'throng-cfg-ghost-'));
  cfgRoots.push(dir);
  mkdirSync(join(dir, 'themes'), { recursive: true });
  writeFileSync(
    join(dir, 'themes', 'throng.json'),
    JSON.stringify({ name: 'throng', colours: { accent: accentHex } }, null, 2),
    'utf8',
  );
  return dir;
}
test.afterAll(() => {
  for (const dir of cfgRoots.splice(0)) rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
});

test('the drag ghost and the New Tab (+) affordance follow the theme accent', async () => {
  const cfgRoot = seedThemeAccent('#ff00aa'); // a distinctive magenta, unlike any default
  const ACCENT = 'rgb(255, 0, 170)';
  await runApp(
    async (app, win) => {
      await createProject(win, 'Themed', 'C:/c/themed');
      await expect(win.getByTestId('tab-strip')).toBeVisible();

      // The New Tab (+) hover uses the THEME accent, not the active project's
      // dominant colour (which overrides --accent).
      const add = win.getByTestId('tab-add');
      await add.hover();
      await expect
        .poll(() => add.evaluate((el) => getComputedStyle(el).borderTopColor))
        .toBe(ACCENT);

      // Begin a drag → the ghost window paints with the theme accent border.
      const pid = await firstPanelId(win);
      const box = await win.getByTestId(`panel-handle-${pid}`).boundingBox();
      if (!box) throw new Error('no panel handle');
      await win.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await win.mouse.down();
      await win.mouse.move(box.x + 60, box.y + 60, { steps: 8 });
      await expect.poll(() => app.evaluate(ghostBorderColor), { timeout: 3000 }).toBe(ACCENT);
      await win.mouse.up();
    },
    { env: { THRONG_CONFIG_ROOT: cfgRoot } },
  );
});

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
