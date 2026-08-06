import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import { runApp, createProject, cleanupTemp} from './harness.js';

// Session 2026-07-06c: New File in the context menu (FR-096) + right-clicking empty
// space in the Files & Folders pane opens a root-targeted menu (FR-097).

function makeProject(): string {
  const root = mkdtempSync(join(tmpdir(), 'throng-newitems-'));
  mkdirSync(join(root, 'sub'));
  writeFileSync(join(root, 'sub', 'keep.txt'), 'x');
  writeFileSync(join(root, 'a.txt'), 'A');
  return root;
}

test('New File on a folder creates a file inside it, in rename mode (FR-096)', async () => {
  const root = makeProject();
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'NI', root);
      const tree = win.getByTestId('file-explorer-tree');
      await expect(tree).toBeVisible();

      // Right-click the `sub` folder → New File → creates sub/New file.txt in rename.
      await tree.getByText('sub', { exact: true }).click({ button: 'right' });
      await win.getByTestId('menu-item-New File').click();

      // The rename input is focused on the new file.
      const input = tree.locator('input.tree-rename');
      await expect(input).toBeVisible({ timeout: 6000 });
      await input.fill('made.txt');
      await win.keyboard.press('Enter');

      await expect
        .poll(() => existsSync(join(root, 'sub', 'made.txt')), { timeout: 6000 })
        .toBe(true);
    });
  } finally {
    cleanupTemp(root);
  }
});

test('right-clicking empty space opens a root menu with New File / New Folder / reveal (FR-097)', async () => {
  const root = makeProject();
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'NI', root);
      const tree = win.getByTestId('file-explorer-tree');
      await expect(tree).toBeVisible();

      // Right-click the empty body area BELOW the rows (not on any row).
      const body = win.locator('.explorer__body');
      const box = await body.boundingBox();
      expect(box).not.toBeNull();
      if (box) {
        await body.click({ button: 'right', position: { x: box.width / 2, y: box.height - 8 } });
      }

      // Menu offers root actions.
      await expect(win.getByTestId('menu-item-New Folder')).toBeVisible();
      await expect(win.getByTestId('menu-item-New File')).toBeVisible();
      // The OS reveal lives inside the "Open In" submenu (#158, FR-018a) — not top-level — for the
      // root menu just as for a row's. Open it to confirm the reveal is reachable.
      await expect(win.getByTestId('menu-item-Open In')).toBeVisible();
      await win.getByTestId('menu-item-Open In').click();
      await expect(
        win.getByTestId('submenu-Open In').locator('.context-menu__item').first(),
      ).toContainText('OS File Explorer');

      // New File here creates it at the ROOT (the top-level item is still open behind the submenu).
      await win.getByTestId('menu-item-New File').click();
      const input = tree.locator('input.tree-rename');
      await expect(input).toBeVisible({ timeout: 6000 });
      await win.keyboard.press('Enter'); // accept the default "New file.txt"

      await expect
        .poll(() => readdirSync(root).some((n) => n.startsWith('New file')), { timeout: 6000 })
        .toBe(true);
    });
  } finally {
    cleanupTemp(root);
  }
});
