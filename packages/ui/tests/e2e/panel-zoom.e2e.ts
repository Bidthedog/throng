import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { runApp, createProject, firstPanelId, panelIds, installResizeProbe, reloadWindow, commitPanelRename } from './harness.js';
import { skipIfElevated } from './admin.js';

// 012 US2 (per-instance revision, FR-009/012/013, SC-003/005): each panel has its
// OWN text zoom — every editor and every terminal zoom independently. Zoom composes
// on top of the app-wide global zoom, persists per panel, and recomputes the
// terminal grid; it never alters editor file content.

/** The computed px font-size of an editor panel's CodeMirror surface. */
function editorFontPx(win: Page, pid: string): Promise<number> {
  return win
    .getByTestId(`editor-${pid}`)
    .locator('.cm-editor')
    .evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
}

/** A panel's stored zoom level (the `data-zoom` attribute on its panel box). */
function panelZoom(win: Page, pid: string): Promise<number> {
  return win.getByTestId(`panel-${pid}`).evaluate((el) => Number((el as HTMLElement).dataset.zoom));
}

async function newEditor(win: Page, pid: string): Promise<void> {
  await win.getByTestId(`panel-type-select-${pid}`).selectOption('editor');
  await win.getByTestId(`panel-type-confirm-${pid}`).click();
  await expect(win.getByTestId(`editor-${pid}`)).toBeVisible();
}

test('zooming one editor scales only that editor — its sibling editor and a terminal are untouched; content preserved (FR-013)', async () => {
  skipIfElevated();
  const root = mkdtempSync(join(tmpdir(), 'throng-pz-ed-'));
  try {
    await runApp(async (app, win) => {
      await createProject(win, 'ZoomEd', root);
      const p1 = await firstPanelId(win);
      await newEditor(win, p1);

      // A second editor and a terminal, so we can prove per-INSTANCE isolation.
      await win.getByTestId(`panel-add-${p1}`).click();
      await commitPanelRename(win);
      await win.getByTestId(`panel-add-${p1}`).click();
      await commitPanelRename(win);
      await expect(win.locator('.panel-box')).toHaveCount(3);
      const [, p2, p3] = await panelIds(win);
      await newEditor(win, p2);
      await win.getByTestId(`panel-type-select-${p3}`).selectOption('terminal');
      await win.getByTestId('terminal-flavour').selectOption('cmd');
      await win.getByTestId(`panel-type-confirm-${p3}`).click();
      await expect(win.getByTestId(`terminal-${p3}`)).toContainText(basename(root), { timeout: 15000 });

      const content = win.getByTestId(`editor-${p1}`).locator('.cm-content');
      await content.click();
      await win.keyboard.type('const answer = 42;');
      await expect(content).toContainText('const answer = 42;');

      const baseP1 = await editorFontPx(win, p1);
      const baseP2 = await editorFontPx(win, p2);
      expect(baseP2).toBeCloseTo(baseP1, 1);

      // Focus the FIRST editor and zoom it in. Install + reset the resize probe so we
      // can assert the terminal (a different panel) is not resized.
      await win.getByTestId(`panel-${p1}`).click();
      const probe = await installResizeProbe(app);
      await probe.reset();
      await win.keyboard.press('Control+Alt+Equal');
      await win.keyboard.press('Control+Alt+Equal');

      // Only p1 grew. p2 (the other editor) is unchanged — the whole point of per-instance.
      await expect.poll(() => editorFontPx(win, p1)).toBeGreaterThan(baseP1);
      expect(await panelZoom(win, p1)).toBeGreaterThan(0);
      expect(await editorFontPx(win, p2)).toBeCloseTo(baseP2, 1);
      expect(await panelZoom(win, p2)).toBe(0);

      // The terminal (a third panel) got zero resizes — it was not the zoom target.
      await win.waitForTimeout(300);
      expect(await probe.count()).toBe(0);

      // Content is unchanged — zoom never touches the buffer (FR-013).
      await expect(content).toContainText('const answer = 42;');

      // Reset returns only p1 to its default size.
      await win.keyboard.press('Control+Alt+Digit0');
      await expect.poll(() => editorFontPx(win, p1)).toBeCloseTo(baseP1, 1);
      expect(await panelZoom(win, p1)).toBe(0);
    });
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
  }
});

test('a panel keeps its own zoom across a reload (SC-003)', async () => {
  skipIfElevated();
  const root = mkdtempSync(join(tmpdir(), 'throng-pz-persist-'));
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'ZoomPersist', root);
      const pid = await firstPanelId(win);
      await newEditor(win, pid);

      await win.getByTestId(`panel-${pid}`).click();
      await win.keyboard.press('Control+Alt+Equal');
      await win.keyboard.press('Control+Alt+Equal');
      await expect.poll(() => panelZoom(win, pid)).toBeGreaterThan(0);
      const level = await panelZoom(win, pid);

      // Let the debounced save flush, drop all in-memory state, then re-open the
      // project → its layout (with this panel's zoom) is re-read from the store.
      await win.waitForTimeout(700);
      await reloadWindow(win);
      await win.locator('.project-item', { hasText: 'ZoomPersist' }).click();
      await expect(win.getByTestId(`panel-${pid}`)).toBeVisible({ timeout: 15000 });
      await expect.poll(() => panelZoom(win, pid)).toBe(level);
    });
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
  }
});

test('the panel right-click menu zooms that panel in and out', async () => {
  await runApp(async (_app, win) => {
    await createProject(win, 'MenuZoom', 'C:/c/mz');
    const pid = await firstPanelId(win);

    // Zoom In via the context menu → the panel's level rises.
    await win.getByTestId(`panel-handle-${pid}`).click({ button: 'right' });
    await win.getByTestId('menu-item-Zoom').click(); // open the flyout
    await win.getByTestId('menu-item-Zoom In').click();
    await expect.poll(() => panelZoom(win, pid)).toBeGreaterThan(0);
    const inLevel = await panelZoom(win, pid);

    // Zoom Out brings it back down.
    await win.getByTestId(`panel-handle-${pid}`).click({ button: 'right' });
    await win.getByTestId('menu-item-Zoom').click();
    await win.getByTestId('menu-item-Zoom Out').click();
    await expect.poll(() => panelZoom(win, pid)).toBeLessThan(inLevel);

    // Reset Zoom returns it to the default (0). Zoom in once more first so reset has
    // something to undo, then reset.
    await win.getByTestId(`panel-handle-${pid}`).click({ button: 'right' });
    await win.getByTestId('menu-item-Zoom').click();
    await win.getByTestId('menu-item-Zoom In').click();
    await expect.poll(() => panelZoom(win, pid)).toBeGreaterThan(0);
    await win.getByTestId(`panel-handle-${pid}`).click({ button: 'right' });
    await win.getByTestId('menu-item-Zoom').click();
    await win.getByTestId('menu-item-Reset Zoom').click();
    await expect.poll(() => panelZoom(win, pid)).toBe(0);
  });
});

test('zooming a terminal recomputes its grid (SC-005)', async () => {
  skipIfElevated();
  const root = mkdtempSync(join(tmpdir(), 'throng-pz-term-'));
  try {
    await runApp(async (app, win) => {
      await createProject(win, 'ZoomTerm', root);
      const pid = await firstPanelId(win);
      await win.getByTestId(`panel-type-select-${pid}`).selectOption('terminal');
      await win.getByTestId('terminal-flavour').selectOption('cmd');
      await win.getByTestId(`panel-type-confirm-${pid}`).click();
      await expect(win.getByTestId(`terminal-${pid}`)).toContainText(basename(root), { timeout: 15000 });
      await win.waitForTimeout(500); // let the initial fit settle

      const probe = await installResizeProbe(app);
      await probe.reset();

      await win.getByTestId(`panel-${pid}`).click();
      await win.keyboard.press('Control+Alt+Equal');
      await win.keyboard.press('Control+Alt+Equal');
      await expect.poll(() => probe.count(), { timeout: 10000 }).toBeGreaterThan(0);
    });
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
  }
});
