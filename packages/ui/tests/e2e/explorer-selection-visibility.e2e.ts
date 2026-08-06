/**
 * The Files & Folders selection highlight belongs to the ACTIVE pane (024 follow-up).
 *
 * The tree always HAS a selection — it is what every file operation acts on, and it tracks the open
 * editor — but drawing it from an inactive pane made the application look as though two things were
 * current at once: a highlighted row here, a highlighted panel there, and nothing to say which the
 * next keystroke would reach. The highlight now goes when the pane does, and comes back with it.
 * The selection underneath is never touched.
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { runApp, createProject, firstPanelId, cleanupTemp} from './harness.js';

const TRANSPARENT = 'rgba(0, 0, 0, 0)';

/** The computed background of the selected row — the highlight itself, not the class that names it. */
function selectedRowBackground(win: Page): Promise<string> {
  return win.evaluate(() => {
    const row = document.querySelector(
      '[data-testid="file-explorer-tree"] .tree-row--selected',
    ) as HTMLElement | null;
    return row ? getComputedStyle(row).backgroundColor : 'no-selected-row';
  });
}

test('the tree highlights its selection only while its pane is active', async () => {
  const root = mkdtempSync(join(tmpdir(), 'throng-selvis-'));
  writeFileSync(join(root, 'picked.txt'), 'x\n');
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'SelVisProj', root);
      const pid = await firstPanelId(win);
      const tree = win.getByTestId('file-explorer-tree');
      const row = tree.getByText('picked.txt', { exact: true });
      await expect(row).toBeVisible({ timeout: 8000 });

      // Selecting in the tree makes the pane active, and the row is highlighted.
      await row.click();
      await expect(tree.locator('.tree-row--selected')).toContainText('picked.txt');
      const lit = await selectedRowBackground(win);
      expect(lit).not.toBe(TRANSPARENT);
      expect(lit).not.toBe('no-selected-row');

      // Working somewhere else takes the highlight away — but NOT the selection: the row keeps its
      // class, so every file operation still knows what it acts on.
      await win.getByTestId(`panel-${pid}`).click();
      await expect.poll(() => selectedRowBackground(win)).toBe(TRANSPARENT);
      await expect(tree.locator('.tree-row--selected')).toContainText('picked.txt');

      // Coming back lights it again — the same row, without having to re-pick it.
      await row.click();
      await expect.poll(() => selectedRowBackground(win)).toBe(lit);
    });
  } finally {
    cleanupTemp(root);
  }
});
