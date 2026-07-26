/**
 * 024 US10 follow-up (#7): a terminal's live window title must SURVIVE an in-session remount — a tab
 * switch, a layout change — not just show on first mount. The title is module-level renderer state
 * (title-store), so it persists across remounts; the defect was that it was cleared on every unmount
 * (dispose), leaving the header showing the bare panel name until the shell happened to re-emit a
 * title. Here: open a terminal, switch away to a new tab (unmounting it), switch back, and assert the
 * header still shows the shell's reported title rather than falling back to "Panel 1".
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import { runApp, createProject, firstPanelId, commitTabRename } from './harness.js';
import { skipIfElevated } from './admin.js';

test('a terminal keeps its window title across a tab switch (#7)', async () => {
  test.setTimeout(60000);
  skipIfElevated();
  const root = mkdtempSync(join(tmpdir(), 'throng-titlep-'));
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'TitleP', root);
      const pid = await firstPanelId(win);
      await win.getByTestId(`panel-type-select-${pid}`).selectOption('terminal');
      await win.getByTestId('terminal-flavour').selectOption('cmd');
      await win.getByTestId(`panel-type-confirm-${pid}`).click();
      await expect(win.getByTestId(`terminal-${pid}`)).toBeVisible();

      const header = win.getByTestId(`panel-title-${pid}`);
      // The live title appears (cmd announces "…cmd.exe"); confirm before switching away.
      await expect(header).toContainText('cmd.exe', { timeout: 10_000 });

      // Remember the first tab, add a second (opens active + in rename mode → commit), then switch back.
      const firstTabId = await win.evaluate(() => {
        const el = document.querySelector(
          '.tab-strip [data-testid^="tab-"]:not([data-testid="tab-add"]):not([data-testid="tab-insert-indicator"])',
        );
        return el?.getAttribute('data-testid') ?? null;
      });
      await win.getByTestId('tab-add').click();
      await commitTabRename(win);
      // The terminal in tab 1 is now unmounted. Switch back to tab 1.
      if (firstTabId) await win.getByTestId(firstTabId).click();
      await expect(win.getByTestId(`terminal-${pid}`)).toBeVisible();

      // The header must STILL show the shell title, immediately on return — not the bare panel name.
      await expect(header).toContainText('cmd.exe', { timeout: 5_000 });
    });
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
