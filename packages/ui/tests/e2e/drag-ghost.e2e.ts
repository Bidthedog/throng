import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import {
  commitTabRename,
  createProject as newProject,
  firstPanelId,
  panelGrip,
  panelIds,
  openApp,
  runApp as runOwnApp,
  cleanupTemp,
  splitPanelViaMenu,
  type OpenApp,
} from './harness.js';

/*
 * ONE app for the drag tests, not one per test. Only the theme-accent test seeds a config root BEFORE
 * launch, so it keeps its own app via `runOwnApp`; the rest share `shared`.
 *
 *   runApp        runs the body against the shared window (refuses launch options).
 *   createProject appends a counter, because a shared app accumulates projects and duplicate names
 *                 make `.project-item` ambiguous.
 *
 * Serial mode is required - shared window, shared database - and a failure skips the rest rather
 * than running them against whatever state the failure left behind. Every drag ends with the button
 * released and the ghost hidden, so a test leaves no drag in flight for the next one.
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
  opts?: unknown,
): Promise<void> => {
  if (opts) {
    throw new Error('this file shares one app; a test needing launch options must call runOwnApp instead');
  }
  return fn(shared.app, shared.win);
};

let projectSeq = 0;
const createProject = (win: OpenApp['win'], name: string, root: string): Promise<void> =>
  newProject(win, `${name}-${(projectSeq += 1)}`, root);

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
  await runOwnApp(
    async (app, win) => {
      await newProject(win, 'Themed', 'C:/c/themed');
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
      const box = await panelGrip(win, pid).boundingBox();
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
    const box = await panelGrip(win, pid).boundingBox();
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
      const box = await panelGrip(win, first).boundingBox();
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

// MOVED DOWN: "Escape cancels a drag that starts from a TERMINAL panel, whose textarea swallows Escape" -
// component/drag-cancel.test.ts ('cancels even when the focused element swallows Escape, as a terminal does').

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

// Probe: dragging a Panel/Tab must not spew Chromium widget-rejection errors from
// the drag-ghost OS window (`Message N rejected by interface blink.mojom.Widget`).
// (Folded in from ghost-drag-noise.e2e.ts.)
test('dragging does not emit blink.mojom.Widget rejections', { tag: ['@extended', '@window', '@reserve:osdrag'] }, async () => {
  await runApp(async (app, win) => {
    const stderr: string[] = [];
    const proc = app.process();
    proc.stderr?.setEncoding('utf8');
    proc.stderr?.on('data', (c: string) => stderr.push(c));

    await createProject(win, 'GhostNoise', 'C:/c/ghostnoise');
    await expect(win.locator('.panel-box')).toHaveCount(1);
    const pid = await firstPanelId(win);

    // Start + wiggle + end a Panel drag several times (each triggers ghost start/stop).
    for (let i = 0; i < 5; i += 1) {
      const handle = panelGrip(win, pid);
      const box = await handle.boundingBox();
      if (!box) throw new Error('no handle box');
      await win.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await win.mouse.down();
      await win.mouse.move(box.x + box.width / 2 + 12, box.y + box.height / 2 + 12, { steps: 4 });
      await win.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2 + 40, { steps: 6 });
      await win.mouse.up();
      // sleep-justified: the thing under test is Chromium's own native drag-ghost widget teardown
      // sleep-justified: writing (or not) a `blink.mojom.Widget` rejection to the app's stderr - a
      // sleep-justified: process-level, native-window race with nothing on the DOM or app state to
      // sleep-justified: observe, so there is no condition to await between repetitions.
      await win.waitForTimeout(250);
    }

    const joined = stderr.join('');
    const hits = (joined.match(/blink.mojom.Widget/g) ?? []).length;
    console.log(`[probe] blink.mojom.Widget hits: ${hits}`);
    expect(hits, joined).toBe(0);
  });
});

// Moved here from performance.e2e.ts: it measures drag feedback, and shares this file's app.
test('shows drop-target feedback promptly once a Panel drag starts (NFR-001/SC-012)', { tag: ['@extended', '@window', '@reserve:layout'] }, async () => {
  await runApp(async (_app, win) => {
    await createProject(win, 'Feedback', 'C:/c/feedback');
    const firstId = await firstPanelId(win);
    await splitPanelViaMenu(win, firstId);
    await expect(win.locator('.panel-box')).toHaveCount(2);

    const ids = await panelIds(win);
    const [a, b] = ids;

    const handle = panelGrip(win, b);
    const box = await handle.boundingBox();
    if (!box) throw new Error('handle has no box');
    await win.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await win.mouse.down();
    // Pass the activation distance; edge drop-zones for the other panel must
    // appear quickly (NFR-001 target 100 ms; the bound absorbs polling overhead).
    await win.mouse.move(box.x + box.width / 2 + 8, box.y + box.height / 2 + 8, { steps: 2 });
    await expect(win.getByTestId(`edge-right-${a}`)).toBeVisible({ timeout: 200 });
    await win.mouse.up();
  });
});
