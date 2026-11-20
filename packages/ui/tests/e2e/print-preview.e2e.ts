/**
 * 075 SC-012, SC-013, FR-064, FR-068, FR-068a, FR-070, FR-071 — Print Preview as a real window.
 *
 * ══ WHY THIS IS AN E2E ══
 *
 * What is under test is a second BrowserWindow: that Ctrl+P in a preview opens exactly one, that a second Ctrl+P
 * opens no other, that Chromium's print engine lays pages out inside it, and that what was chosen there is on disk
 * for the next launch. The controller's rules (one job, nothing printed unseen, settings saved on close) are
 * proven against a recording engine in `integration/print-controller.test.ts`; the controls in
 * `component/print-preview-app.test.ts`. This only asks the real window to agree, once. It never prints: a hosted
 * runner may have no printer, and Print Preview says so rather than failing.
 *
 * Its own app, launched twice over one user-data folder, because the second launch is the assertion.
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import { openApp, createProject, firstPanelId, cleanupTemp, pressAction, type OpenApp } from './harness.js';

let root = '';
let userDataDir = '';

test.beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'throng-print-preview-'));
  userDataDir = mkdtempSync(join(tmpdir(), 'throng-print-preview-ud-'));
  writeFileSync(join(root, 'doc.md'), `# Printable\n\n${'A paragraph of words to lay out on paper. '.repeat(400)}\n\n> [!note] Kept\n> Inside a callout.\n`);
});

test.afterAll(() => {
  if (root) cleanupTemp(root);
  if (userDataDir) cleanupTemp(userDataDir);
});

/** Open `doc.md` in an editor, then its preview; the preview panel's id. */
async function openPreview(win: Page): Promise<string> {
  const editorId = await firstPanelId(win);
  await win.getByTestId(`panel-type-select-${editorId}`).selectOption('editor');
  await win.getByTestId(`panel-type-confirm-${editorId}`).click();
  await win.getByTestId('file-explorer-tree').getByText('doc.md', { exact: true }).click();
  await expect(win.getByTestId(`editor-${editorId}`).locator('.cm-content')).toContainText('Printable', { timeout: 8000 });
  await win.getByTestId(`editor-preview-${editorId}`).click();
  const body = win.locator('[data-testid^="preview-body-"]').first();
  await expect(body).toContainText('Inside a callout.', { timeout: 8000 });
  return ((await body.getAttribute('data-testid')) ?? '').replace('preview-body-', '');
}

/** The Print Preview windows open now. */
function printWindows(app: ElectronApplication): Page[] {
  return app.windows().filter((w) => w.url().includes('printPreview='));
}

async function openPrintPreview(app: ElectronApplication, win: Page, previewId: string): Promise<Page> {
  await win.getByTestId(`preview-body-${previewId}`).click();
  const next = app.waitForEvent('window', { predicate: (w) => w.url().includes('printPreview='), timeout: 10_000 });
  // The chord throng ships on this platform: Cmd+P on macOS, where a literal Control+P is nothing.
  await pressAction(win, 'preview.print');
  const print = await next;
  await expect(print.getByTestId('print-preview')).toBeVisible({ timeout: 10_000 });
  return print;
}

test('Ctrl+P opens one modal Print Preview whose pages render, and its settings outlive a relaunch', { tag: ['@extended', '@window', '@reserve:window'] }, async () => {
  let first: OpenApp | undefined = await openApp({ userDataDir });
  try {
    await createProject(first.win, 'PrintPreview', root);
    const previewId = await openPreview(first.win);
    const print = await openPrintPreview(first.app, first.win, previewId);
    // FR-068, FR-073 — the pages are laid out by the print engine and counted; a document longer than a page runs
    // onto more than one (the app's own `overflow: hidden` once clipped every print to its first page).
    await expect(print.getByTestId('print-status')).toHaveText(/^Page 1 of ([2-9]|\d{2,})$/, { timeout: 15_000 });

    // FR-068a — one page at a time, drawn by PDF.js in the real window: a canvas with something on it.
    const pageShown = (n: number) => print.getByTestId('print-page-view').locator(`canvas[aria-label="Page ${n}"]`);
    await expect(pageShown(1)).toBeVisible({ timeout: 15_000 });
    expect((await pageShown(1).boundingBox())!.width).toBeGreaterThan(100);
    const pageCount = Number(/of (\d+)$/.exec((await print.getByTestId('print-status').textContent()) ?? '')![1]);

    // Forward, then the keys and the wheel, step through the pages.
    await print.getByTestId('print-page-forward').click();
    await expect(pageShown(2)).toBeVisible({ timeout: 10_000 });
    await expect(print.getByTestId('print-page-back')).toBeEnabled();
    await print.keyboard.press('End');
    await expect(pageShown(pageCount)).toBeVisible({ timeout: 10_000 });
    await expect(print.getByTestId('print-status')).toHaveText(`Page ${pageCount} of ${pageCount}`);
    await print.keyboard.press('Home');
    await expect(pageShown(1)).toBeVisible({ timeout: 10_000 });
    const view = (await print.getByTestId('print-page-view').boundingBox())!;
    await print.mouse.move(view.x + view.width / 2, view.y + view.height / 2);
    await print.mouse.wheel(0, 120);
    await expect(pageShown(2)).toBeVisible({ timeout: 10_000 });
    await expect(print.getByTestId('print-status')).toHaveText(/^Page 2 of \d+$/);

    // FR-071 — a second Print… opens no second window.
    await pressAction(first.win, 'preview.print');
    await expect.poll(() => printWindows(first!.app).length, { timeout: 3000 }).toBe(1);

    // FR-070 — what was chosen is saved on close (Cancel), the page range excepted.
    await print.getByTestId('print-orientation').selectOption('landscape');
    // FR-068a — laid out again, it stays on the page the reader was on.
    await expect(print.getByTestId('print-status')).toHaveText(/^Page 2 of \d+$/, { timeout: 15_000 });
    await print.getByTestId('print-close').click();
    await expect.poll(() => printWindows(first!.app).length, { timeout: 5000 }).toBe(0);
  } finally {
    await first?.close();
    first = undefined;
  }

  const second = await openApp({ userDataDir });
  try {
    await createProject(second.win, 'PrintPreview2', root);
    const previewId = await openPreview(second.win);
    const print = await openPrintPreview(second.app, second.win, previewId);
    await expect(print.getByTestId('print-orientation')).toHaveValue('landscape');

    // FR-071 (2026-11-20) — it stays above other windows, where the platform allows.
    const onTop = await second.app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('printPreview='))?.isAlwaysOnTop(),
    );
    expect(onTop, 'Print Preview is not kept above other windows').toBe(true);

    // FR-069 (2026-11-20) — the settings never scroll: with every control shown (custom margins and scale, a range)
    // in the smallest window Print Preview allows, nothing overflows the pane either way.
    await print.getByTestId('print-margins').selectOption('custom');
    await print.getByTestId('print-pages-range').check();
    await print.getByTestId('print-fit-width').uncheck();
    await print.getByTestId('print-scale').selectOption('custom');
    await second.app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows().find((b) => b.webContents.getURL().includes('printPreview='))!;
      const [minWidth, minHeight] = w.getMinimumSize();
      w.setSize(minWidth!, minHeight!);
    });
    await expect
      .poll(
        () =>
          print.locator('.print-preview__controls').evaluate((pane) => ({
            overflowX: pane.scrollWidth - pane.clientWidth,
            overflowY: pane.scrollHeight - pane.clientHeight,
            scrolls: getComputedStyle(pane).overflowY !== 'hidden' || getComputedStyle(pane).overflowX !== 'hidden',
          })),
        { timeout: 5000, message: 'the settings pane overflows, or would offer a scrollbar' },
      )
      .toEqual({ overflowX: 0, overflowY: 0, scrolls: false });

    // FR-068b (the maintainer, 2026-11-20 17:21) — the left and right boxes carry "mm" BELOW them, so they take no
    // width beside the page; and the page fills the space between the four boxes, the same gap on every side.
    const geometry = await print.getByTestId('print-margins-page').evaluate((diagram) => {
      const box = (el: Element | null) => el!.getBoundingClientRect();
      const sheet = box(diagram.querySelector('.print-preview__margins-sheet'));
      const edge = (side: string) => diagram.querySelector(`[data-edge="${side}"]`)!;
      const input = (side: string) => box(edge(side).querySelector('input'));
      const unit = (side: string) => box(edge(side).querySelector('.print-preview__margin-unit'));
      const centre = (r: DOMRect) => r.left + r.width / 2;
      return {
        // 18:00 — the top and bottom boxes centred on the page by the box alone, their "mm" after them.
        offCentre: (['top', 'bottom'] as const).map((s) => Math.round(Math.abs(centre(input(s)) - centre(sheet)))),
        unitAfter: (['top', 'bottom'] as const).map((s) => Math.round(unit(s).left - input(s).right) >= 0),
        unitBelow: (['left', 'right'] as const).map((s) => Math.round(unit(s).top - input(s).bottom) >= 0),
        gaps: [
          Math.round(sheet.top - box(edge('top')).bottom),
          Math.round(box(edge('right')).left - sheet.right),
          Math.round(box(edge('bottom')).top - sheet.bottom),
          Math.round(sheet.left - box(edge('left')).right),
        ],
      };
    });
    console.log(`[print margins] gaps top/right/bottom/left: ${geometry.gaps.join('/')}`);
    expect(geometry.unitBelow, 'a side margin’s "mm" is not below its box').toEqual([true, true]);
    expect(geometry.unitAfter, 'a top or bottom margin’s "mm" does not follow its box').toEqual([true, true]);
    expect(Math.max(...geometry.offCentre), `top/bottom boxes off the page's centre by ${geometry.offCentre.join('/')} px`).toBeLessThanOrEqual(1);
    expect(Math.max(...geometry.gaps) - Math.min(...geometry.gaps), `uneven gaps round the page: ${geometry.gaps.join('/')}`).toBeLessThanOrEqual(1);
  } finally {
    await second.close();
  }
});
