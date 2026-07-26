/**
 * F2 renames the active panel (024 follow-up, `panel.rename`).
 *
 * F2 is the rename key everywhere else in throng — the file tree already uses it — and everywhere
 * else in Windows. A panel header that could only be renamed by double-clicking it or hunting
 * through a context menu was the odd one out. In a TERMINAL it must also be TAKEN: a chord throng
 * advertises must not simultaneously be handed to the running program.
 */
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import { runApp, createProject, firstPanelId } from './harness.js';
import { skipIfElevated } from './admin.js';

/** Close an app that has a live terminal by answering the prompt it earns. */
async function terminateAllClose(app: ElectronApplication, win: Page): Promise<void> {
  const closed = app.waitForEvent('close', { timeout: 20_000 });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.close());
  await expect(win.getByTestId('app-close-dialog')).toBeVisible({ timeout: 15_000 });
  await win.getByTestId('app-close-terminate').click();
  await closed;
}

test('F2 renames an editor panel, and the menu advertises the chord', async () => {
  skipIfElevated();
  const root = mkdtempSync(join(tmpdir(), 'throng-f2-'));
  writeFileSync(join(root, 'a.txt'), 'x\n');
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'F2Proj', root);
      const pid = await firstPanelId(win);
      await win.getByTestId(`panel-type-select-${pid}`).selectOption('editor');
      await win.getByTestId(`panel-type-confirm-${pid}`).click();
      await win.getByTestId(`editor-${pid}`).click();

      // The menu NAMES the key — a menu that offers an action without naming its chord teaches
      // nobody the chord.
      await win.getByTestId(`panel-handle-${pid}`).click({ button: 'right' });
      await expect(win.getByTestId('menu-item-Rename')).toContainText('F2');
      // …and so do the zoom items, which had no shortcut shown at all.
      await win.getByTestId('menu-item-Zoom').hover();
      await expect(win.getByTestId('menu-item-Zoom In')).toContainText('Ctrl');
      // Two Escapes: the first steps out of the Zoom sub-menu, the second closes the root (FR-018b).
      await win.keyboard.press('Escape');
      await win.keyboard.press('Escape');
      await expect(win.getByTestId('context-menu')).toHaveCount(0);

      // F2 opens the rename box on the ACTIVE panel.
      await win.getByTestId(`editor-${pid}`).click();
      await win.keyboard.press('F2');
      const input = win.getByTestId(`panel-rename-input-${pid}`);
      await expect(input).toBeVisible();
      await input.fill('Renamed by key');
      await input.press('Enter');
      await expect(win.getByTestId(`panel-title-${pid}`)).toHaveText('Renamed by key');

      // The Enter that CONFIRMED the name must not also reach the document behind it. Focusing the
      // panel synchronously from inside that keydown let the rest of the keystroke land in the newly
      // focused editor and type a newline into the user's file.
      const content = win.getByTestId(`editor-${pid}`).locator('.cm-content');
      await expect(content).toHaveText('');
      // …and focus DID come back, so the next keystroke goes where the user expects.
      await expect
        .poll(() => win.evaluate(() => document.activeElement?.closest('.cm-editor') != null))
        .toBe(true);
      await win.keyboard.type('typed');
      await expect(content).toContainText('typed');
    });
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
  }
});

test('F2 renames a terminal panel, and is not delivered to the shell', async () => {
  skipIfElevated();
  const root = mkdtempSync(join(tmpdir(), 'throng-f2t-'));
  try {
    await runApp(async (app, win) => {
      await createProject(win, 'F2TermProj', root);
      const pid = await firstPanelId(win);
      await win.getByTestId(`panel-type-select-${pid}`).selectOption('terminal');
      await win.getByTestId('terminal-flavour').selectOption('cmd');
      await win.getByTestId(`panel-type-confirm-${pid}`).click();
      await expect(win.getByTestId(`terminal-${pid}`)).toBeVisible({ timeout: 15000 });

      // Focus the terminal, then press F2. In cmd, F2 is a console editing key ("copy up to
      // character") — throng must take it before the program ever sees it.
      await win.getByTestId(`terminal-${pid}`).click();
      await win.keyboard.press('F2');
      const input = win.getByTestId(`panel-rename-input-${pid}`);
      await expect(input).toBeVisible({ timeout: 8000 });
      await input.fill('Build shell');
      await input.press('Enter');
      await expect(win.getByTestId(`panel-title-${pid}`)).toHaveText('Build shell');

      await terminateAllClose(app, win);
    });
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
  }
});
