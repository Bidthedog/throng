/**
 * US6 (#137) — the editor panel title menu's "Reveal File" reveals the open file in throng's own
 * Files & Folders tree (expanding ancestors and selecting it), and offers "Open in OS Explorer".
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import { runApp, createProject } from './harness.js';

function makeProject(): string {
  const root = mkdtempSync(join(tmpdir(), 'throng-us6-'));
  mkdirSync(join(root, 'src'));
  writeFileSync(join(root, 'src', 'deep.txt'), 'DEEP_BODY\n');
  return root;
}

test('editor "Reveal File" selects the open file in the Files & Folders tree (#137)', async () => {
  const root = makeProject();
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'US6', root);
      const tree = win.getByTestId('file-explorer-tree');

      // Expand src and open the file into an editor.
      await tree.getByTestId('tree-twisty-src').click();
      await tree.getByText('deep.txt', { exact: true }).click();
      await expect(win.locator('.cm-content').first()).toContainText('DEEP_BODY');

      const editorPid = await win
        .locator('.panel-box:has(.cm-content)')
        .first()
        .evaluate((el) => (el as HTMLElement).dataset.panelId ?? '');

      // Collapse src so the file is no longer shown in the tree.
      await tree.getByTestId('tree-twisty-src').click();
      await expect(tree.getByText('deep.txt', { exact: true })).toHaveCount(0);

      // Editor title menu → "Reveal File" → the tree re-expands to and selects the file.
      await win.getByTestId(`panel-handle-${editorPid}`).click({ button: 'right' });
      await expect(win.getByTestId('menu-item-Reveal File')).toBeVisible();
      await expect(win.getByTestId('menu-item-Open in OS Explorer')).toBeVisible();
      await win.getByTestId('menu-item-Reveal File').click();

      await expect(tree.getByText('deep.txt', { exact: true })).toBeVisible();
      await expect(tree.locator('.tree-row--selected')).toContainText('deep.txt');
    });
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
