/**
 * US5 (#158) + FR-018a — the Files & Folders menu groups items into sections with separators, and
 * "Open in OS Explorer" is the FIRST item of the "Open In" submenu (folders get just that).
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import { runApp, createProject } from './harness.js';

function makeProjectFolder(): string {
  const root = mkdtempSync(join(tmpdir(), 'throng-us5-'));
  mkdirSync(join(root, 'src'));
  writeFileSync(join(root, 'src', 'index.ts'), 'export const x = 1;\n');
  writeFileSync(join(root, 'a.txt'), 'a\n');
  return root;
}

test('"Open in OS Explorer" leads the "Open In" submenu; the menu has section separators (#158)', async () => {
  const root = makeProjectFolder();
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'US5', root);
      const tree = win.getByTestId('file-explorer-tree');

      // A FILE: the menu is grouped into sections (FR-018a).
      await tree.getByText('a.txt', { exact: true }).click({ button: 'right' });
      expect(await win.locator('.context-menu__separator').count()).toBeGreaterThan(0);

      // "Open in OS File Explorer" is not a top-level item — it lives in "Open In".
      await expect(win.getByTestId('menu-item-Open in OS File Explorer')).toHaveCount(0);
      await win.getByTestId('menu-item-Open In').click();
      const fileSub = win.getByTestId('submenu-Open In');
      await expect(fileSub.locator('.context-menu__item').first()).toContainText('Open in OS File Explorer');

      // A FOLDER: its "Open In" holds ONLY the OS reveal (no editor targets).
      await tree.getByText('src', { exact: true }).click({ button: 'right' });
      await win.getByTestId('menu-item-Open In').click();
      const folderSub = win.getByTestId('submenu-Open In');
      await expect(folderSub.locator('.context-menu__item')).toHaveCount(1);
      await expect(folderSub.locator('.context-menu__item').first()).toContainText('Open in OS File Explorer');
    });
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
