import { test, expect } from '@playwright/test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runApp, createProject } from './harness.js';

/**
 * US10 / FR-035 — the STRANDED HOVER never lingers when the window is blurred.
 *
 * The reported path: the cog menu's "Themes" item sits over the Files & Folders root; clicking it
 * opens Preferences (which blurs the main window) and closes the menu with NO pointer movement, so the
 * root is left painted with its `:hover` background. The general case: any element left under the
 * pointer while the window loses focus must not keep a hover background until a real pointermove with
 * the window focused restores it.
 */

const BG = (el: Element): string => getComputedStyle(el).backgroundColor;
const TRANSPARENT = 'rgba(0, 0, 0, 0)';

/** A project folder on disk so the file tree renders real rows. */
function makeProjectFolder(): string {
  const root = mkdtempSync(join(tmpdir(), 'throng-hover-'));
  mkdirSync(join(root, 'src'));
  writeFileSync(join(root, 'README.md'), '# demo\n');
  return root;
}

test('the Files & Folders root drops its hover background while Preferences is open (FR-035)', async () => {
  const projectRoot = makeProjectFolder();
  try {
    await runApp(async (app, win) => {
      await createProject(win, 'Hoverer', projectRoot);
      await expect(win.getByTestId('file-explorer-tree')).toBeVisible();
      const root = win.locator('.tree-row--root');
      await expect(root).toBeVisible();

      // Hover it: the row paints its hover background while the window is focused.
      await root.hover();
      const hoveredBg = await root.evaluate(BG);
      expect(hoveredBg).not.toBe(TRANSPARENT);

      // Open Preferences WITHOUT moving the pointer (via the bridge, as the cog click ultimately does)
      // — the root stays geometrically `:hover`, but the main window blurs. This is the exact bug.
      const [prefs] = await Promise.all([
        app.waitForEvent('window'),
        win.evaluate(() => window.throng?.openPreferences?.('themes')),
      ]);
      await prefs.waitForLoadState('domcontentloaded');

      // The main window is now flagged blurred, and the stranded hover no longer paints.
      await expect
        .poll(() => win.evaluate(() => document.body.hasAttribute('data-window-blurred')))
        .toBe(true);
      await expect.poll(() => root.evaluate(BG)).not.toBe(hoveredBg);
      expect(await root.evaluate(BG)).toBe(TRANSPARENT);
    });
  } finally {
    rmSync(projectRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
  }
});

test('a stranded element keeps no hover background until a real pointermove refocuses it (FR-035)', async () => {
  await runApp(async (_app, win) => {
    // Any element with a gated hover background left under the pointer. The main window control is
    // always present and its hover paints `hoverSurface`.
    const control = win.getByTestId('window-min');
    await expect(control).toBeVisible();

    await control.hover();
    const hoveredBg = await control.evaluate(BG);
    expect(hoveredBg).not.toBe(TRANSPARENT); // hovered while focused

    // The window loses focus with the pointer still stranded over the control (no pointer movement).
    await win.evaluate(() => window.dispatchEvent(new Event('blur')));
    await expect.poll(() => control.evaluate(BG)).toBe(TRANSPARENT); // hover suppressed

    // Focus ALONE must not restore it — the pointer has not genuinely moved onto anything yet.
    await win.evaluate(() => window.dispatchEvent(new Event('focus')));
    expect(await control.evaluate(BG)).toBe(TRANSPARENT);

    // A genuine pointer movement in the focused window clears the flag; hover paints again.
    await win.evaluate(() => window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true })));
    await expect
      .poll(() => win.evaluate(() => document.body.hasAttribute('data-window-blurred')))
      .toBe(false);
    await control.hover();
    await expect.poll(() => control.evaluate(BG)).not.toBe(TRANSPARENT);
  });
});
