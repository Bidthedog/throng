import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import { runApp, createProject, commitTabRename } from './harness.js';

/**
 * The main-window status bar — FR-003/004 **as narrowed by 026 / #166**.
 *
 * This spec used to assert the bar showed the active project (dot + name) on the left and the active
 * `Tab · Panel` context beside it. All of that was a second copy of what the frameless title bar
 * already shows from the same source, so #166 removed it. What remains is the project's ROOT FOLDER
 * PATH — the one thing the title bar deliberately does not carry.
 *
 * The identity assertions did not disappear; they moved to where the identity now lives. See
 * `title-statusbar.e2e.ts` and `status-bar-deduped.e2e.ts`.
 */

test('shows nothing but the bar itself when no project is active', async () => {
  await runApp(async (_app, win) => {
    await expect(win.getByTestId('status-bar')).toBeVisible();
    // No project → no path, and none of the removed identity content.
    await expect(win.getByTestId('status-project-path')).toHaveCount(0);
    await expect(win.getByTestId('status-project-dot')).toHaveCount(0);
    await expect(win.getByTestId('status-context')).toHaveCount(0);
    await expect(win.getByTestId('status-bar')).not.toContainText('No project');
  });
});

test('shows the active project’s root folder path, and only that', async () => {
  const root = mkdtempSync(join(tmpdir(), 'throng-statusbar-'));
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'Bartholomew', root);

      await expect(win.getByTestId('status-project-path')).toHaveText(`(${root})`);
      await expect(win.getByTestId('status-project-dot')).toHaveCount(0);
      await expect(win.getByTestId('status-context')).toHaveCount(0);
      await expect(win.getByTestId('status-bar')).not.toContainText('Bartholomew');

      // Changing the active tab used to move the status bar's context label. It no longer has one —
      // and the bar must not start echoing the tab by some other route.
      await win.getByTestId('tab-add').click();
      await commitTabRename(win);
      const activeTabTitle = await win.locator('.tab-chip--active').evaluate((el) => {
        const count = el.querySelector('.tab-chip__count');
        return (el.textContent ?? '').replace(count?.textContent ?? '', '').trim();
      });
      await expect(win.getByTestId('status-bar')).not.toContainText(activeTabTitle);
      // …while the path is unaffected by the tab change.
      await expect(win.getByTestId('status-project-path')).toHaveText(`(${root})`);
    });
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
  }
});
