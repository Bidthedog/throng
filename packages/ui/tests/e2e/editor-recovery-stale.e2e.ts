import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { runApp, createProject, firstPanelId } from './harness.js';
import { skipIfElevated } from './admin.js';

// Repro: reusing an editor for a different file (edit A, discard & open B) must not
// leave A's recovery temp behind — otherwise a later restart restores A's content
// over B (the user saw editors "open CLAUDE.md" instead of the file they chose).

async function newEditor(win: Page): Promise<string> {
  const pid = await firstPanelId(win);
  await win.getByTestId(`panel-type-select-${pid}`).selectOption('editor');
  await win.getByTestId(`panel-type-confirm-${pid}`).click();
  await expect(win.getByTestId(`editor-${pid}`)).toBeVisible();
  return pid;
}

test('reusing an editor for another file clears the old file recovery temp (no stale restore)', async () => {
  skipIfElevated();
  const root = mkdtempSync(join(tmpdir(), 'throng-stale-'));
  const dataDir = mkdtempSync(join(tmpdir(), 'throng-stale-data-'));
  const userDataDir = mkdtempSync(join(tmpdir(), 'throng-stale-ud-'));
  writeFileSync(join(root, 'CLAUDE.md'), 'CLAUDE-DOC-BODY\n');
  writeFileSync(join(root, 'target.txt'), 'TARGET-BODY-42\n');
  try {
    // Session 1: open CLAUDE.md, edit it (writes a recovery temp), then DISCARD &
    // open target.txt into the same editor. Let recovery settle, then close.
    await runApp(
      async (_app, win) => {
        await createProject(win, 'Stale', root);
        const pid = await newEditor(win);
        await win.getByTestId(`editor-${pid}`).click();
        const tree = win.getByTestId('file-explorer-tree');

        await tree.getByText('CLAUDE.md', { exact: true }).click();
        await expect(win.getByTestId(`editor-${pid}`).locator('.cm-content')).toContainText(
          'CLAUDE-DOC-BODY',
          { timeout: 8000 },
        );
        await win.getByTestId(`editor-${pid}`).locator('.cm-content').click();
        await win.keyboard.type('EDIT');
        await expect(win.getByTestId(`panel-unsaved-${pid}`)).toBeVisible();
        await win.waitForTimeout(600); // > recovery debounce → temp written for CLAUDE

        // Reuse the editor for target.txt via discard & open.
        await tree.getByText('target.txt', { exact: true }).click();
        await expect(win.getByTestId('unsaved-open-dialog')).toBeVisible({ timeout: 8000 });
        await win.getByTestId('unsaved-open-discard').click();
        await expect(win.getByTestId(`editor-${pid}`).locator('.cm-content')).toContainText(
          'TARGET-BODY-42',
          { timeout: 8000 },
        );
        // Let the re-point's recovery-temp drop + layout persist settle before close.
        await win.waitForTimeout(700);
      },
      { dataDir, userDataDir },
    );

    // Session 2: restart → the editor must show target.txt, NOT the stale CLAUDE edit.
    await runApp(
      async (_app, win) => {
        const projectItem = win.locator('.project-item', { hasText: 'Stale' });
        await expect(projectItem).toBeVisible();
        await projectItem.locator('[data-testid^="project-switch-"]').click();

        const editor = win.locator('.editor-panel').first();
        await expect(editor).toBeVisible({ timeout: 10000 });
        await expect(editor.locator('.cm-content')).toContainText('TARGET-BODY-42', { timeout: 10000 });
        await expect(win.locator('.cm-content', { hasText: 'CLAUDE-DOC-BODY' })).toHaveCount(0);
      },
      { dataDir, userDataDir },
    );
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
    rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
    rmSync(userDataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
  }
});
