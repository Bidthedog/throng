import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { runApp, createProject, firstPanelId } from './harness.js';
import { skipIfElevated } from './admin.js';

// US2/US9 (Delivery B): open files from the tree into the last active editor
// (openOnClick single default); an already-open file focuses the one editor;
// opening into a dirty editor shows the four-choice prompt.

function makeProject(): string {
  const root = mkdtempSync(join(tmpdir(), 'throng-open-'));
  writeFileSync(join(root, 'alpha.txt'), 'ALPHA-CONTENT\n');
  writeFileSync(join(root, 'beta.txt'), 'BETA-CONTENT\n');
  return root;
}

async function newEditor(win: Page): Promise<string> {
  const pid = await firstPanelId(win);
  await win.getByTestId(`panel-type-select-${pid}`).selectOption('editor');
  await win.getByTestId(`panel-type-confirm-${pid}`).click();
  await expect(win.getByTestId(`editor-${pid}`)).toBeVisible();
  return pid;
}

test('clicking a file opens it into the editor; another file replaces a clean doc', async () => {
  skipIfElevated();
  const root = makeProject();
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'OpenProj', root);
      const pid = await newEditor(win);
      await win.getByTestId(`editor-${pid}`).click(); // make it the active editor

      const tree = win.getByTestId('file-explorer-tree');
      await tree.getByText('alpha.txt', { exact: true }).click();
      const content = win.getByTestId(`editor-${pid}`).locator('.cm-content');
      await expect(content).toContainText('ALPHA-CONTENT', { timeout: 8000 });
      await expect(win.getByTestId(`panel-file-${pid}`)).toContainText('alpha.txt');

      // A clean editor takes the next file, replacing the document (no 2nd editor).
      await tree.getByText('beta.txt', { exact: true }).click();
      await expect(content).toContainText('BETA-CONTENT', { timeout: 8000 });
      await expect(content).not.toContainText('ALPHA-CONTENT');
      // Still exactly one editor panel (no duplicate buffer).
      expect(await win.locator('.editor-panel').count()).toBe(1);
    });
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
  }
});

test('opening a file into a dirty editor shows the four-choice prompt; cancel is a no-op', async () => {
  skipIfElevated();
  const root = makeProject();
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'OpenProj', root);
      const pid = await newEditor(win);
      await win.getByTestId(`editor-${pid}`).click();

      const tree = win.getByTestId('file-explorer-tree');
      const content = win.getByTestId(`editor-${pid}`).locator('.cm-content');

      // Open alpha, then make an unsaved edit.
      await tree.getByText('alpha.txt', { exact: true }).click();
      await expect(content).toContainText('ALPHA-CONTENT', { timeout: 8000 });
      await content.click();
      await win.keyboard.type('EDIT');
      await expect(win.getByTestId(`panel-unsaved-${pid}`)).toBeVisible();

      // Opening another file into the dirty editor prompts (US9).
      await tree.getByText('beta.txt', { exact: true }).click();
      await expect(win.getByTestId('unsaved-open-dialog')).toBeVisible();

      // Cancel → nothing changes: editor still shows the edited alpha, still dirty.
      await win.getByTestId('unsaved-open-cancel').click();
      await expect(win.getByTestId('unsaved-open-dialog')).toHaveCount(0);
      await expect(content).toContainText('EDIT');
      await expect(win.getByTestId(`panel-unsaved-${pid}`)).toBeVisible();

      // Try again → Discard & open → beta replaces the buffer (edits dropped).
      await tree.getByText('beta.txt', { exact: true }).click();
      await expect(win.getByTestId('unsaved-open-dialog')).toBeVisible();
      await win.getByTestId('unsaved-open-discard').click();
      await expect(content).toContainText('BETA-CONTENT', { timeout: 8000 });
      await expect(content).not.toContainText('EDIT');
    });
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
  }
});
