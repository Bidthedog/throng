import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import { runApp, createProject } from './harness.js';
import { skipIfElevated } from './admin.js';

// Reported bug: Ctrl-selecting a MIX of files and folders then Delete removes only
// the folders. Expected: ALL selected items are deleted after confirmation.

function makeProject(): string {
  const root = mkdtempSync(join(tmpdir(), 'throng-delmix-e2e-'));
  writeFileSync(join(root, 'file1.txt'), '1');
  writeFileSync(join(root, 'file2.txt'), '2');
  mkdirSync(join(root, 'dir1'));
  mkdirSync(join(root, 'dir2'));
  return root;
}

test('Ctrl-selecting files + folders and deleting removes ALL of them', async () => {
  skipIfElevated();
  const root = makeProject();
  // permanent delete so we assert directly on disk (no Recycle Bin).
  const cfgRoot = mkdtempSync(join(tmpdir(), 'throng-cfg-del-'));
  writeFileSync(
    join(cfgRoot, 'settings.json'),
    JSON.stringify({ version: 1, explorer: { deleteMode: 'permanent' }, confirmations: {} }),
  );
  try {
    await runApp(
      async (_app, win) => {
        await createProject(win, 'DelMix', root);
        const tree = win.getByTestId('file-explorer-tree');
        await expect(tree).toBeVisible();

        // Select all four with Ctrl held (multi-select).
        await tree.getByText('dir1', { exact: true }).click();
        await tree.getByText('file1.txt', { exact: true }).click({ modifiers: ['Control'] });
        await tree.getByText('dir2', { exact: true }).click({ modifiers: ['Control'] });
        await tree.getByText('file2.txt', { exact: true }).click({ modifiers: ['Control'] });
        await expect(tree.locator('.tree-row--selected')).toHaveCount(4);

        // Delete via the context menu (targets the whole selection).
        await tree.getByText('file2.txt', { exact: true }).click({ button: 'right', modifiers: ['Control'] });
        await win.getByTestId('menu-item-Delete').click();
        // Confirm (double-confirm default → accept once, then the wry one if present).
        await win.getByTestId('confirm-accept').click();
        const wry = win.getByTestId('confirm-accept');
        if (await wry.isVisible().catch(() => false)) await wry.click();

        // ALL four are gone.
        await expect
          .poll(
            () =>
              ['file1.txt', 'file2.txt', 'dir1', 'dir2'].filter((n) => existsSync(join(root, n))),
            { timeout: 8000 },
          )
          .toEqual([]);
      },
      { env: { THRONG_CONFIG_ROOT: cfgRoot } },
    );
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
    rmSync(cfgRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
  }
});

test('recycle mode (default): mixed files + folders all get recycled via the real shell', async () => {
  skipIfElevated();
  const root = makeProject();
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'DelMix', root);
      const tree = win.getByTestId('file-explorer-tree');
      await expect(tree).toBeVisible();

      await tree.getByText('dir1', { exact: true }).click();
      await tree.getByText('file1.txt', { exact: true }).click({ modifiers: ['Control'] });
      await tree.getByText('dir2', { exact: true }).click({ modifiers: ['Control'] });
      await tree.getByText('file2.txt', { exact: true }).click({ modifiers: ['Control'] });
      await expect(tree.locator('.tree-row--selected')).toHaveCount(4);

      // Default deleteMode is 'recycle' → real shell.trashItem.
      await tree.getByText('file2.txt', { exact: true }).click({ button: 'right', modifiers: ['Control'] });
      await win.getByTestId('menu-item-Delete').click();
      await win.getByTestId('confirm-accept').click();
      const wry = win.getByTestId('confirm-accept');
      if (await wry.isVisible().catch(() => false)) await wry.click();

      await expect
        .poll(
          () => ['file1.txt', 'file2.txt', 'dir1', 'dir2'].filter((n) => existsSync(join(root, n))),
          { timeout: 10000 },
        )
        .toEqual([]);
    });
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
  }
});

test('file-first selection (opens an editor) then Delete key removes ALL selected', async () => {
  skipIfElevated();
  const root = makeProject();
  const cfgRoot = mkdtempSync(join(tmpdir(), 'throng-cfg-del2-'));
  writeFileSync(
    join(cfgRoot, 'settings.json'),
    JSON.stringify({ version: 1, explorer: { deleteMode: 'permanent' } }),
  );
  try {
    await runApp(
      async (_app, win) => {
        await createProject(win, 'DelMix', root);
        const tree = win.getByTestId('file-explorer-tree');
        await expect(tree).toBeVisible();

        // Plain-click a FILE first — this OPENS it into an editor (and may move focus).
        await tree.getByText('file1.txt', { exact: true }).click();
        await tree.getByText('dir1', { exact: true }).click({ modifiers: ['Control'] });
        await tree.getByText('file2.txt', { exact: true }).click({ modifiers: ['Control'] });
        await tree.getByText('dir2', { exact: true }).click({ modifiers: ['Control'] });
        await expect(tree.locator('.tree-row--selected')).toHaveCount(4);

        // Delete via the Delete KEY (needs tree focus) + confirm.
        await win.keyboard.press('Delete');
        await win.getByTestId('confirm-accept').click();
        const wry = win.getByTestId('confirm-accept');
        if (await wry.isVisible().catch(() => false)) await wry.click();

        await expect
          .poll(
            () =>
              ['file1.txt', 'file2.txt', 'dir1', 'dir2'].filter((n) => existsSync(join(root, n))),
            { timeout: 8000 },
          )
          .toEqual([]);
      },
      { env: { THRONG_CONFIG_ROOT: cfgRoot } },
    );
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
    rmSync(cfgRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
  }
});
