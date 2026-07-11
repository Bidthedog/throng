import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { runApp, createProject, firstPanelId } from './harness.js';
import { skipIfElevated } from './admin.js';

// 011 US4 (FR-010): the "file changed on disk" warning NAMES the containing tab, the
// panel, and the file's full path — not a generic message.

async function openFileEditor(win: Page, fileName: string, panelName: string): Promise<string> {
  const pid = await firstPanelId(win);
  await win.getByTestId(`panel-type-select-${pid}`).selectOption('editor');
  await win.getByTestId(`panel-type-confirm-${pid}`).click();
  await expect(win.getByTestId(`editor-${pid}`)).toBeVisible();
  // Rename the panel to a known name so we can assert the notice names it.
  await win.getByTestId(`panel-handle-${pid}`).dblclick();
  const rename = win.getByTestId(`panel-rename-input-${pid}`);
  await rename.fill(panelName);
  await rename.press('Enter');
  // Open the file into this editor via the tree.
  await win.getByTestId('file-explorer-tree').getByText(fileName, { exact: true }).click();
  await expect(win.getByTestId(`editor-${pid}`)).toBeVisible();
  return pid;
}

test('the file-changed warning names the tab, panel and full path', async () => {
  skipIfElevated();
  const root = mkdtempSync(join(tmpdir(), 'throng-extnamed-'));
  const file = join(root, 'watched.txt');
  writeFileSync(file, 'original\n');
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'ExtNamed', root);
      const pid = await openFileEditor(win, 'watched.txt', 'Scratchpad');

      // Make the editor dirty (a soft external-change notice only fires while dirty).
      await win.getByTestId(`editor-${pid}`).locator('.cm-content').click();
      await win.keyboard.type('my unsaved edit');

      // Another program changes the file on disk.
      writeFileSync(file, 'changed by another program\n');

      const dialog = win.getByTestId('editor-notice-dialog');
      await expect(dialog).toBeVisible({ timeout: 8000 });
      await expect(dialog).toContainText('File changed on disk');
      const files = win.getByTestId('editor-notice-files');
      await expect(files).toContainText('watched.txt'); // the name
      await expect(files).toContainText(root.split(/[\\/]/).pop() as string); // part of the full dir path
      await expect(files).toContainText('Panel: Scratchpad'); // the panel
      await expect(files).toContainText('Tab:'); // the containing tab
    });
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
  }
});
