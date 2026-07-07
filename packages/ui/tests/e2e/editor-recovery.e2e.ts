import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { runApp, createProject, firstPanelId } from './harness.js';
import { skipIfElevated } from './admin.js';

// US11 / FR-040/042 (Delivery E): closing the app with an unsaved editor shows NO
// warning; reopening restores the in-progress content from the recovery temp. The
// same dataDir (persisted layout) + userDataDir (recovery temps) span both sessions.

async function newEditor(win: Page): Promise<string> {
  const pid = await firstPanelId(win);
  await win.getByTestId(`panel-type-select-${pid}`).selectOption('editor');
  await win.getByTestId(`panel-type-confirm-${pid}`).click();
  await expect(win.getByTestId(`editor-${pid}`)).toBeVisible();
  return pid;
}

test('restores unsaved editor content after an app restart (no close warning)', async () => {
  skipIfElevated();
  const root = mkdtempSync(join(tmpdir(), 'throng-recroot-'));
  const dataDir = mkdtempSync(join(tmpdir(), 'throng-recdata-'));
  const userDataDir = mkdtempSync(join(tmpdir(), 'throng-recud-'));
  const marker = 'RECOVER-ME-42';
  try {
    // Session 1: type unsaved content and let the recovery temp flush, then close
    // (the harness destroys windows — no save).
    await runApp(
      async (_app, win) => {
        await createProject(win, 'RecProj', root);
        const pid = await newEditor(win);
        await win.getByTestId(`editor-${pid}`).locator('.cm-content').click();
        await win.keyboard.type(marker);
        await expect(win.getByTestId(`panel-unsaved-${pid}`)).toBeVisible();
        await win.waitForTimeout(800); // > recovery debounce (400ms) so the temp is written
      },
      { dataDir, userDataDir },
    );

    // Session 2: reopen the project → the editor restores its unsaved content.
    await runApp(
      async (_app, win) => {
        const projectItem = win.locator('.project-item', { hasText: 'RecProj' });
        await expect(projectItem).toBeVisible();
        await projectItem.locator('[data-testid^="project-switch-"]').click();

        const editor = win.locator('.editor-panel').first();
        await expect(editor).toBeVisible({ timeout: 10000 });
        await expect(editor.locator('.cm-content')).toContainText(marker, { timeout: 10000 });
        // Restored content is unsaved (dirty), so its dot shows.
        await expect(win.locator('.throng-unsaved-dot').first()).toBeVisible();
      },
      { dataDir, userDataDir },
    );
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
    rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
    rmSync(userDataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
  }
});
