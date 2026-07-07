import { mkdtempSync, writeFileSync, rmSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { runApp, createProject, firstPanelId } from './harness.js';
import { skipIfElevated } from './admin.js';

// Repro: a dirty editor whose file was DELETED is active; clicking another file shows
// the unsaved-changes prompt; "Open in new editor" MUST open the CLICKED file — not
// some other file (bug: it opened CLAUDE.md / the wrong file).

function makeProject(): string {
  const root = mkdtempSync(join(tmpdir(), 'throng-newed-'));
  writeFileSync(join(root, 'CLAUDE.md'), 'CLAUDE-DOC-CONTENT\n');
  writeFileSync(join(root, 'gone.txt'), 'GONE-BODY\n');
  writeFileSync(join(root, 'target.txt'), 'TARGET-BODY-99\n');
  return root;
}

async function newEditor(win: Page): Promise<string> {
  const pid = await firstPanelId(win);
  await win.getByTestId(`panel-type-select-${pid}`).selectOption('editor');
  await win.getByTestId(`panel-type-confirm-${pid}`).click();
  await expect(win.getByTestId(`editor-${pid}`)).toBeVisible();
  return pid;
}

test('"Open in new editor" from the unsaved prompt opens the CLICKED file (not CLAUDE.md)', async () => {
  skipIfElevated();
  const root = makeProject();
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'NewEd', root);
      const pid = await newEditor(win);
      await win.getByTestId(`editor-${pid}`).click();
      const tree = win.getByTestId('file-explorer-tree');

      // Open gone.txt, then delete it EXTERNALLY (as the user did in Explorer) →
      // the soft-detection watcher marks the editor dirty + file-missing.
      await tree.getByText('gone.txt', { exact: true }).click();
      await expect(win.getByTestId(`editor-${pid}`).locator('.cm-content')).toContainText('GONE-BODY', {
        timeout: 8000,
      });
      unlinkSync(join(root, 'gone.txt'));
      await expect(win.getByTestId(`panel-unsaved-${pid}`)).toBeVisible({ timeout: 8000 });

      // Click target.txt → the unsaved prompt → "Open in new editor".
      await tree.getByText('target.txt', { exact: true }).click();
      await expect(win.getByTestId('unsaved-open-dialog')).toBeVisible({ timeout: 8000 });
      await win.getByTestId('unsaved-open-new').click();

      // A second editor exists and shows TARGET's content — NOT CLAUDE.md, NOT gone's.
      await expect(win.locator('.editor-panel')).toHaveCount(2, { timeout: 8000 });
      const contents = win.locator('.editor-panel .cm-content');
      await expect(contents.filter({ hasText: 'TARGET-BODY-99' })).toHaveCount(1, { timeout: 8000 });
      await expect(win.locator('.cm-content', { hasText: 'CLAUDE-DOC-CONTENT' })).toHaveCount(0);
    });
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
  }
});
