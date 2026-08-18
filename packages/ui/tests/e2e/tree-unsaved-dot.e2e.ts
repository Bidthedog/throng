/**
 * The shared unsaved dot, on the FILE (024 follow-up).
 *
 * The dot already marks the panel header, the tab and the project — every container of the unsaved
 * work, and not the work itself. A user who edited a file and looked elsewhere had to find the panel
 * holding it to learn that; Files & Folders, the place they actually think about files, said nothing.
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import { runApp, createProject, firstPanelId, cleanupTemp} from './harness.js';

/**
 * Close the app the way a user with a live terminal must: answer the close prompt.
 *
 * A spec that creates a terminal and then simply ends leaves the app sitting on the "terminals are
 * running" dialog — the window never closes, teardown force-kills it, and the run leaves stray
 * processes behind. Any spec that starts a terminal owes it this.
 */
async function terminateAllClose(app: ElectronApplication, win: Page): Promise<void> {
  const closed = app.waitForEvent('close', { timeout: 20_000 });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.close());
  await expect(win.getByTestId('app-close-dialog')).toBeVisible({ timeout: 15_000 });
  await win.getByTestId('app-close-terminate').click();
  await closed;
}

test('a file with unsaved editor changes is marked in the tree, and unmarked when saved', { tag: ['@extended', '@editor'] }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'throng-treedot-'));
  writeFileSync(join(root, 'edited.txt'), 'original\n');
  writeFileSync(join(root, 'untouched.txt'), 'other\n');
  try {
    await runApp(async (app, win) => {
      await createProject(win, 'TreeDotProj', root);
      const pid = await firstPanelId(win);
      await win.getByTestId(`panel-type-select-${pid}`).selectOption('editor');
      await win.getByTestId(`panel-type-confirm-${pid}`).click();
      await win.getByTestId(`editor-${pid}`).click();

      const tree = win.getByTestId('file-explorer-tree');
      await tree.getByText('edited.txt', { exact: true }).click();
      await expect(win.getByTestId(`editor-${pid}`).locator('.cm-content')).toContainText(
        'original',
        { timeout: 8000 },
      );

      // Clean: no mark on either file.
      await expect(win.getByTestId('tree-unsaved-edited.txt')).toHaveCount(0);

      // Dirty: the FILE is marked, and only that file.
      await win.getByTestId(`editor-${pid}`).locator('.cm-content').click();
      await win.keyboard.type('CHANGED');
      await expect(win.getByTestId(`panel-unsaved-${pid}`)).toBeVisible({ timeout: 8000 });
      await expect(win.getByTestId('tree-unsaved-edited.txt')).toBeVisible();
      await expect(win.getByTestId('tree-unsaved-untouched.txt')).toHaveCount(0);

      // A TERMINAL never wears an editor's unsaved mark. Editor state is keyed by panel id and
      // outlives an editor's unmount by design, so the header must gate the dot on the panel being
      // an editor NOW — reporting unsaved work from a panel that cannot open or save it is a lie
      // the user can act on.
      await win.getByTestId(`panel-add-${pid}`).click();
      const termId = (
        await win
          .locator('[data-testid^="panel-type-select-"]')
          .evaluateAll((els) =>
            els.map((e) => (e.getAttribute('data-testid') ?? '').replace('panel-type-select-', '')),
          )
      )[0];
      expect(termId).toBeTruthy();
      await win.getByTestId(`panel-type-select-${termId}`).selectOption('terminal');
      await win.getByTestId('terminal-flavour').selectOption('cmd');
      await win.getByTestId(`panel-type-confirm-${termId}`).click();
      await expect(win.getByTestId(`terminal-${termId}`)).toBeVisible({ timeout: 8000 });
      await expect(win.getByTestId(`panel-unsaved-${termId}`)).toHaveCount(0);
      await expect(win.getByTestId(`panel-unsaved-${pid}`)).toBeVisible(); // the editor still has it

      // Saved: the mark goes with the dirtiness it was reporting.
      await win.getByTestId(`editor-${pid}`).locator('.cm-content').click();
      await win.keyboard.press('Control+s');
      await expect(win.getByTestId(`panel-unsaved-${pid}`)).toHaveCount(0, { timeout: 8000 });
      await expect(win.getByTestId('tree-unsaved-edited.txt')).toHaveCount(0);

      // This spec started a terminal, so it closes the app properly rather than leaving it stranded
      // on the "terminals are running" prompt for teardown to force-kill.
      await terminateAllClose(app, win);
    });
  } finally {
    cleanupTemp(root);
  }
});
