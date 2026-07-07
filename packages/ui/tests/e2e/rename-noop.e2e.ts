import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import { runApp, createProject } from './harness.js';

// US12 / FR-070: confirming a rename with an UNCHANGED name shows no error and
// leaves the item unchanged; a changed valid name still renames. Also verifies
// Enter opens/renames correctly (Enter never triggers a rename on the tree).

function makeProject(): string {
  const root = mkdtempSync(join(tmpdir(), 'throng-rn-'));
  writeFileSync(join(root, 'a.txt'), 'a\n');
  return root;
}

test('confirming an unchanged name is a no-op (no error); a changed name renames', async () => {
  const root = makeProject();
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'RenameProj', root);
      const tree = win.getByTestId('file-explorer-tree');
      await expect(tree).toBeVisible();

      const row = tree.getByText('a.txt', { exact: true });
      await row.click();

      // Begin rename (F2) → the inline input appears pre-filled with the name.
      await win.keyboard.press('F2');
      const input = tree.locator('input.tree-rename');
      await expect(input).toBeVisible();

      // Confirm WITHOUT changing the name → no error banner, item unchanged (FR-070).
      await input.press('Enter');
      await expect(tree.locator('.explorer__error')).toHaveCount(0);
      await expect(tree.getByText('a.txt', { exact: true })).toBeVisible();
      expect(existsSync(join(root, 'a.txt'))).toBe(true);

      // A changed valid name still renames.
      await tree.getByText('a.txt', { exact: true }).click();
      await win.keyboard.press('F2');
      const input2 = tree.locator('input.tree-rename');
      await expect(input2).toBeVisible();
      await input2.fill('b.txt');
      await input2.press('Enter');

      await expect(tree.getByText('b.txt', { exact: true })).toBeVisible({ timeout: 6000 });
      await expect(tree.locator('.explorer__error')).toHaveCount(0);
      expect(existsSync(join(root, 'b.txt'))).toBe(true);
      expect(existsSync(join(root, 'a.txt'))).toBe(false);
    });
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
  }
});
