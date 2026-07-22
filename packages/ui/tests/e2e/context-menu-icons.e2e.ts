/**
 * US3 (#126) — context-menu actions that map to an existing theme icon token render with their
 * icon (resolved through the active theme); items with no token stay iconless but keep their label
 * and the icon column's alignment (no ragged rows).
 */
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import { runApp, createProject } from './harness.js';

test('menu items render their theme icon; an item with no token stays aligned (#126)', async () => {
  const root = mkdtempSync(join(tmpdir(), 'throng-icons-'));
  writeFileSync(join(root, 'a.txt'), 'a\n');
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'Icons', root);
      const tree = win.getByTestId('file-explorer-tree');
      await expect(tree.getByText('a.txt', { exact: true })).toBeVisible();
      await tree.getByText('a.txt', { exact: true }).click({ button: 'right' });

      // Rename ('rename') and Delete ('destroy') map to existing theme tokens → the icon cell
      // renders content, resolved through the active theme (FR-010/FR-011).
      await expect(win.getByTestId('menu-item-Rename').locator('.context-menu__icon')).not.toBeEmpty();
      await expect(win.getByTestId('menu-item-Delete').locator('.context-menu__icon')).not.toBeEmpty();

      // Copy has no token yet (no cut/copy/paste tokens in the shipped set — recorded for #127) →
      // the icon cell is still present (column preserved) and the label is intact, so the row is
      // not ragged (FR-012).
      const copy = win.getByTestId('menu-item-Copy');
      await expect(copy.locator('.context-menu__icon')).toHaveCount(1);
      await expect(copy.locator('.context-menu__label')).toHaveText('Copy');

      // The relocated OS reveal ('folderOpen') carries its icon inside the "Open In" submenu.
      await win.getByTestId('menu-item-Open In').click();
      await expect(
        win.getByTestId('menu-item-Open in OS File Explorer').locator('.context-menu__icon'),
      ).not.toBeEmpty();
    });
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
