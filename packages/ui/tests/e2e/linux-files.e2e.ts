import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import { FILE_OP_TIMEOUT_MS, cleanupTemp, createProject, runApp } from './harness.js';

/**
 * Layer: E2E. The real `shell.trashItem` into the real freedesktop trash, and back through the real tree (062 US3).
 * The trash layout itself is proved in linux-trash.contract.test.ts; this is the path through the app.
 */
test.skip(process.platform !== 'linux', 'Linux file behaviour');

test('two names differing only by case are two files, and a deleted one comes back from the Trash', { tag: ['@linux', '@extended', '@explorer', '@reserve:native'] }, async () => {
  // Under the runner's home, not the temp folder, so the item goes to the home trash whatever /tmp is mounted on.
  const base = join(process.env.HOME ?? tmpdir(), '.cache', 'throng-e2e');
  mkdirSync(base, { recursive: true });
  const root = mkdtempSync(join(base, 'files-'));
  writeFileSync(join(root, 'README.md'), 'upper');
  writeFileSync(join(root, 'readme.md'), 'lower');
  writeFileSync(join(root, 'other.txt'), 'other');
  try {
    expect(readdirSync(root)).toHaveLength(3);
    await runApp(async (_app, win) => {
      await createProject(win, 'Files', root);
      const tree = win.getByTestId('file-explorer-tree');
      await expect(tree.getByText('README.md', { exact: true })).toBeVisible();
      await expect(tree.getByText('readme.md', { exact: true })).toBeVisible();

      await tree.getByText('readme.md', { exact: true }).click({ button: 'right' });
      await win.getByTestId('menu-item-Delete').click();
      await expect(win.getByTestId('confirm-dialog')).toContainText('Trash');
      await win.getByTestId('confirm-accept').click();
      await expect.poll(() => existsSync(join(root, 'readme.md')), { timeout: FILE_OP_TIMEOUT_MS }).toBe(false);
      expect(existsSync(join(root, 'README.md'))).toBe(true);

      await tree.getByText('other.txt', { exact: true }).click({ button: 'right' });
      await win.getByRole('menuitem', { name: /^Undo / }).click();
      await expect.poll(() => existsSync(join(root, 'readme.md')), { timeout: FILE_OP_TIMEOUT_MS }).toBe(true);
    });
  } finally {
    cleanupTemp(root);
    rmSync(base, { recursive: true, force: true });
  }
});
