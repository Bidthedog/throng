import { basename } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { runApp, createProject, firstPanelId } from './harness.js';
import { skipIfElevated } from './admin.js';

// Regression (005 Phase C·1 UX): enlarging a Panel must NOT wipe the terminal's
// contents. ConPTY repaints the whole enlarged viewport on resize (cursor-home +
// one line-erase per row) — the same shape as a `cls` — so the cls-detection used
// to fire and drop the scrollback, losing all terminal text when a Panel grew.

/** Resize the app's main window to a fixed content size (drives the grid resize). */
async function setWindowSize(app: ElectronApplication, w: number, h: number): Promise<void> {
  await app.evaluate(({ BrowserWindow }, size) => {
    const win = BrowserWindow.getAllWindows()[0];
    win?.setContentSize(size.w, size.h);
  }, { w, h });
}

/** The number of rows xterm currently renders for the panel's terminal. */
function xtermRows(win: Page, pid: string): Promise<number> {
  return win
    .getByTestId(`terminal-${pid}`)
    .evaluate((el) => el.querySelector('.xterm-rows')?.children.length ?? -1);
}

test('enlarging a Terminal Panel keeps its scrollback (does not clear on resize)', async () => {
  skipIfElevated();
  const root = mkdtempSync(join(tmpdir(), 'throng-term-resize-'));
  try {
    await runApp(async (app, win) => {
      // Start with a short window so growing it adds many rows (a real enlarge).
      await setWindowSize(app, 1100, 560);

      await createProject(win, 'Resize', root);
      const pid = await firstPanelId(win);

      await win.getByTestId(`panel-type-select-${pid}`).selectOption('terminal');
      // cmd.exe: plain echo, no PSReadLine repainting — straightforward to assert.
      await win.getByTestId('terminal-flavour').selectOption('cmd');
      const confirm = win.getByTestId(`panel-type-confirm-${pid}`);
      await expect(confirm).toBeEnabled();
      await confirm.click();

      const term = win.getByTestId(`terminal-${pid}`);
      await expect(term).toBeVisible();
      await expect(term).toContainText(basename(root), { timeout: 15000 });

      // Produce a distinctive line, then confirm it is on screen before resizing.
      await term.click();
      await win.keyboard.type('echo RESIZE_CANARY_777');
      await win.keyboard.press('Enter');
      await expect(term).toContainText('RESIZE_CANARY_777', { timeout: 15000 });
      const smallRows = await xtermRows(win, pid);

      // Enlarge the window → the terminal grid grows → ConPTY repaints the viewport.
      // Wait until the grid has actually grown (the resize propagated), THEN give the
      // async ConPTY repaint time to arrive — that repaint is what used to trigger the
      // erroneous clear. Asserting before it lands would race past the bug.
      await setWindowSize(app, 1100, 1040);
      await expect.poll(() => xtermRows(win, pid), { timeout: 10000 }).toBeGreaterThan(smallRows);
      await win.waitForTimeout(1500);

      // The canary text must survive the enlarge (before the fix it was wiped).
      await expect(term).toContainText('RESIZE_CANARY_777', { timeout: 10000 });

      // Shrinking back must also keep it (the other half of the reported symptom).
      await setWindowSize(app, 1100, 560);
      await expect.poll(() => xtermRows(win, pid), { timeout: 10000 }).toBeLessThan(smallRows + 1);
      await win.waitForTimeout(1500);
      await expect(term).toContainText('RESIZE_CANARY_777', { timeout: 10000 });

      // Clean up: close the shell so the project root unlocks for teardown.
      await term.click();
      await win.keyboard.type('exit');
      await win.keyboard.press('Enter');
      await expect(win.getByTestId(`panel-type-form-${pid}`)).toBeVisible({ timeout: 15000 });
    });
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 });
  }
});
