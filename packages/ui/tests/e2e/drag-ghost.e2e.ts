import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import { commitTabRename, createProject, firstPanelId, panelIds, runApp, cleanupTemp, splitPanelViaMenu } from './harness.js';

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
  for (const dir of cfgRoots.splice(0)) cleanupTemp(dir);
});

test('the drag ghost and the New Tab (+) affordance follow the theme accent', { tag: ['@extended', '@window', '@reserve:window'] }, async () => {
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

test('shows a cursor-following ghost window during a drag, gone on drop', { tag: ['@extended', '@window', '@reserve:window'] }, async () => {
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

/*
 * 048 US6 — Escape cancels a drag with the same teardown as a drop (FR-080..FR-082).
 *
 * The ghost is an OS window, so whether it really went away is only visible here. Escape is pressed with
 * the button still down, then the button is released: the release after a cancel must change nothing.
 * The second drag in each test is FR-082's "the next drag behaves as a first one" — a ghost that
 * appears again, and goes again.
 */
test('Escape during a panel drag hides the ghost and leaves the layout alone', { tag: ['@extended', '@window', '@reserve:osdrag'] }, async () => {
  await runApp(async (app, win) => {
    await createProject(win, 'EscPanel', 'C:/c/escpanel');
    const first = await firstPanelId(win);
    await splitPanelViaMenu(win, first);
    await expect(win.locator('.panel-box')).toHaveCount(2);
    const idsBefore = await panelIds(win);
    const titleBefore = await win.getByTestId(`panel-title-${first}`).innerText();

    const drag = async (): Promise<void> => {
      const box = await win.getByTestId(`panel-handle-${first}`).boundingBox();
      if (!box) throw new Error('no panel handle');
      await win.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await win.mouse.down();
      await win.mouse.move(box.x + 60, box.y + 60, { steps: 8 });
      await expect.poll(() => app.evaluate(ghostVisible), { timeout: 3000 }).toBe(true);
      await win.keyboard.press('Escape');
      await expect.poll(() => app.evaluate(ghostVisible), { timeout: 3000 }).toBe(false);
      await win.mouse.up();
      // Nothing is left drawn: no drop zone of either kind survives the cancel.
      await expect(win.locator('.edge-zones')).toHaveCount(0);
      await expect(win.getByTestId('outer-edge-zones')).toHaveCount(0);
    };

    await drag();
    expect(await panelIds(win)).toEqual(idsBefore);
    await expect(win.getByTestId(`panel-title-${first}`)).toHaveText(titleBefore);
    // The next drag is a first one.
    await drag();
    expect(await panelIds(win)).toEqual(idsBefore);
  });
});

test('Escape cancels a drag that starts from a TERMINAL panel, whose textarea swallows Escape', { tag: ['@extended', '@window', '@reserve:osdrag'] }, async () => {
  // A REAL folder: a terminal starts in the project root, and a root that does not exist raises a
  // "could not be found" notice that sits over the panel's Confirm button.
  const root = mkdtempSync(join(tmpdir(), 'throng-escterm-'));
  try {
    await runApp(async (app, win) => {
      await createProject(win, 'EscTerm', root);
      const pid = await firstPanelId(win);
      await win.getByTestId(`panel-type-select-${pid}`).selectOption('terminal');
      await win.getByTestId('terminal-flavour').selectOption('cmd');
      await win.getByTestId(`panel-type-confirm-${pid}`).click();
      await expect(win.getByTestId(`terminal-${pid}`)).toBeVisible();
      await splitPanelViaMenu(win, pid);
      await expect(win.locator('.panel-box')).toHaveCount(2);
      const idsBefore = await panelIds(win);

      // Pressing the terminal's header focuses xterm's textarea, which stops Escape bubbling — the
      // cancel has to be taken before it gets there (FR-080).
      const box = await win.getByTestId(`panel-handle-${pid}`).boundingBox();
      if (!box) throw new Error('no panel handle');
      await win.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await win.mouse.down();
      await win.mouse.move(box.x + 60, box.y + 60, { steps: 8 });
      await expect.poll(() => app.evaluate(ghostVisible), { timeout: 3000 }).toBe(true);
      await win.keyboard.press('Escape');
      await expect.poll(() => app.evaluate(ghostVisible), { timeout: 3000 }).toBe(false);
      await win.mouse.up();
      await expect(win.getByTestId('outer-edge-zones')).toHaveCount(0);
      expect(await panelIds(win)).toEqual(idsBefore);
    });
  } finally {
    cleanupTemp(root);
  }
});

test('Escape during a tab drag hides the ghost and keeps the tab order', { tag: ['@extended', '@window', '@reserve:osdrag'] }, async () => {
  await runApp(async (app, win) => {
    await createProject(win, 'EscTab', 'C:/c/esctab');
    await win.getByTestId('tab-add').click();
    await commitTabRename(win);
    await expect(win.locator('.tab-chip')).toHaveCount(2);
    const order = async (): Promise<string[]> => win.locator('.tab-chip').evaluateAll((els) => els.map((el) => el.textContent ?? ''));
    const before = await order();

    const drag = async (): Promise<void> => {
      const box = await win.locator('.tab-chip').first().boundingBox();
      if (!box) throw new Error('no tab chip');
      await win.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await win.mouse.down();
      // Across the second chip — a drop here WOULD reorder, so an unchanged order is meaningful.
      await win.mouse.move(box.x + box.width * 1.8, box.y + box.height / 2, { steps: 8 });
      await expect.poll(() => app.evaluate(ghostVisible), { timeout: 3000 }).toBe(true);
      await win.keyboard.press('Escape');
      await expect.poll(() => app.evaluate(ghostVisible), { timeout: 3000 }).toBe(false);
      await win.mouse.up();
      await expect(win.getByTestId('tab-insert-indicator')).toHaveCount(0);
    };

    await drag();
    expect(await order()).toEqual(before);
    await drag();
    expect(await order()).toEqual(before);
  });
});
