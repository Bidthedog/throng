/**
 * US3 (#126) + 023 (#127) — context-menu actions render their theme icon token.
 *
 * #126 shipped icons only where a token already existed; the clipboard and editing rows referenced
 * tokens the shipped set never had, so they resolved to an EMPTY glyph. 023 adds those tokens
 * (cut/copy/paste/selectAll/undo/redo/language/keybindings/themes/about/hide) and wires every menu,
 * so no row in the explorer, editor, terminal or cog menu is left with a blank icon cell. These
 * specs assert the icon cell is NON-EMPTY across all four menus.
 */
import { basename } from 'node:path';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { runApp, createProject, firstPanelId } from './harness.js';
import { skipIfElevated } from './admin.js';

/** The icon cell of a menu row, by the row's label. */
const iconCell = (win: Page, label: string) =>
  win.getByTestId(`menu-item-${label}`).locator('.context-menu__icon');

test('explorer menu items render their theme icon; the clipboard rows are no longer blank (#127)', async () => {
  const root = mkdtempSync(join(tmpdir(), 'throng-icons-'));
  writeFileSync(join(root, 'a.txt'), 'a\n');
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'Icons', root);
      const tree = win.getByTestId('file-explorer-tree');
      await expect(tree.getByText('a.txt', { exact: true })).toBeVisible();
      await tree.getByText('a.txt', { exact: true }).click({ button: 'right' });

      // Rename ('rename') and Delete ('destroy') always had tokens.
      await expect(iconCell(win, 'Rename')).not.toBeEmpty();
      await expect(iconCell(win, 'Delete')).not.toBeEmpty();

      // The clipboard rows — blank before 023 (no cut/copy/paste tokens) — now render a glyph, with
      // the label intact and the row still aligned.
      await expect(iconCell(win, 'Cut')).not.toBeEmpty();
      await expect(iconCell(win, 'Copy')).not.toBeEmpty();
      await expect(iconCell(win, 'Paste')).not.toBeEmpty();
      await expect(win.getByTestId('menu-item-Copy').locator('.context-menu__label')).toHaveText('Copy');

      // "Hide in this project" — also blank before 023 — now carries the 'hide' glyph.
      await expect(iconCell(win, 'Hide in this project')).not.toBeEmpty();

      // The relocated OS reveal ('folderOpen') carries its icon inside the "Open In" submenu.
      await win.getByTestId('menu-item-Open In').click();
      await expect(iconCell(win, 'Open in OS File Explorer')).not.toBeEmpty();
    });
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test('editor content menu: every row renders an icon, and the editing rows show their shortcut (#127)', async () => {
  skipIfElevated();
  const root = mkdtempSync(join(tmpdir(), 'throng-icons-ed-'));
  writeFileSync(join(root, 'lines.txt'), 'alpha\nbeta\ngamma\n');
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'Icons', root);
      const pid = await firstPanelId(win);
      await win.getByTestId(`panel-type-select-${pid}`).selectOption('editor');
      await win.getByTestId(`panel-type-confirm-${pid}`).click();
      await win.getByTestId(`editor-${pid}`).click();
      await win.getByTestId('file-explorer-tree').getByText('lines.txt', { exact: true }).click();
      await expect(win.getByTestId(`editor-${pid}`).locator('.cm-content')).toContainText('alpha', {
        timeout: 8000,
      });

      // Right-click a line to open the content menu.
      await win
        .getByTestId(`editor-${pid}`)
        .locator('.cm-line')
        .filter({ hasText: 'beta' })
        .first()
        .click({ button: 'right' });

      // Every row — including the four that were blank before 023 — renders a glyph.
      for (const label of ['Cut', 'Copy', 'Paste', 'Select All', 'Undo', 'Redo', 'Set Language…']) {
        await expect(iconCell(win, label)).not.toBeEmpty();
      }

      // The fixed native chords are shown after the label (display-only; these actions keep their
      // native bindings and are deliberately off the rebindable list, FR-017c).
      await expect(win.getByTestId('menu-shortcut-Cut')).toHaveText('(Ctrl+X)');
      await expect(win.getByTestId('menu-shortcut-Undo')).toHaveText('(Ctrl+Z)');
    });
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
  }
});

test('cog menu: Settings / Key Bindings / Themes / About each render an icon (#127)', async () => {
  const root = mkdtempSync(join(tmpdir(), 'throng-icons-cog-'));
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'Icons', root);
      // Open the cog menu (main window only). Its rows keep their own `cog-menu-*` test ids.
      await win.getByTestId('title-bar-cog').click();
      await expect(win.getByTestId('cog-menu')).toBeVisible();

      for (const tab of ['settings', 'keybindings', 'themes', 'about']) {
        await expect(
          win.getByTestId(`cog-menu-${tab}`).locator('.context-menu__icon'),
        ).not.toBeEmpty();
      }
    });
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test('terminal menu: Copy and Paste render their icon (#127)', async () => {
  skipIfElevated();
  const root = mkdtempSync(join(tmpdir(), 'throng-icons-term-'));
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'Icons', root);
      const pid = await firstPanelId(win);
      await win.getByTestId(`panel-type-select-${pid}`).selectOption('terminal');
      await win.getByTestId('terminal-flavour').selectOption('windows-powershell');
      await win.getByTestId(`panel-type-confirm-${pid}`).click();
      await expect(win.getByTestId(`terminal-${pid}`)).toContainText(basename(root), { timeout: 20000 });

      await win.getByTestId(`terminal-${pid}`).click({ button: 'right' });
      await expect(win.getByTestId('context-menu')).toHaveCount(1);
      // Copy is disabled without a selection, but its glyph still renders in the reserved cell.
      await expect(iconCell(win, 'Copy')).not.toBeEmpty();
      await expect(iconCell(win, 'Paste')).not.toBeEmpty();
      await expect(win.getByTestId('menu-shortcut-Paste')).toHaveText('(Ctrl+V)');
    });
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
  }
});
