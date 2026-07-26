/**
 * US2 (#155, spec 024): drop a file/folder from Files & Folders onto a terminal → its absolute
 * path(s) are inserted at the shell cursor, quoted when they contain whitespace, several joined by a
 * space, and the line is never submitted. Driven through the throng:tree-drop seam (mirroring
 * throng:os-drop), since a real react-dnd → native drop cannot be driven from Playwright.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { runApp, createProject, firstPanelId } from './harness.js';
import { skipIfElevated } from './admin.js';

function treeDrop(win: Page, panelId: string, paths: string[]): Promise<void> {
  return win.evaluate(
    ([id, list]) => {
      window.dispatchEvent(new CustomEvent('throng:tree-drop', { detail: { panelId: id, paths: list } }));
    },
    [panelId, paths] as const,
  );
}

test('dropping tree paths onto a terminal inserts them at the prompt, quoted and space-joined (#155)', async () => {
  skipIfElevated();
  const root = mkdtempSync(join(tmpdir(), 'throng-tdrop-'));
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'DropProj', root);
      const pid = await firstPanelId(win);
      await win.getByTestId(`panel-type-select-${pid}`).selectOption('terminal');
      await win.getByTestId('terminal-flavour').selectOption('cmd');
      await win.getByTestId(`panel-type-confirm-${pid}`).click();
      await expect(win.getByTestId(`terminal-${pid}`)).toBeVisible();
      const term = win.getByTestId(`terminal-${pid}`);
      // Let the shell reach its first prompt.
      await expect(term).toContainText('>', { timeout: 10_000 });

      // A whitespace-free path is inserted bare and echoed by the shell.
      await treeDrop(win, pid, ['C:\\tmp\\alpha.txt']);
      await expect(term).toContainText('C:\\tmp\\alpha.txt', { timeout: 8000 });

      // A path with spaces arrives double-quoted; two items join with a single space.
      await treeDrop(win, pid, ['C:\\my dir\\b.txt', 'C:\\c.txt']);
      await expect(term).toContainText('"C:\\my dir\\b.txt" C:\\c.txt', { timeout: 8000 });
    });
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
  }
});
