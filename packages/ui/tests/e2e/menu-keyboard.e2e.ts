/**
 * US6 (#157, spec 024 FR-018b): full keyboard navigation of context sub-menus. Arrow into a sub-menu
 * (→ / Enter) focuses its first child; arrow back out (← / Escape) closes it and returns focus to the
 * parent; only at the root does Escape close the whole menu.
 */
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { runApp, createProject } from './harness.js';

/** Arrow-Down through the menu until the focused item has the given testid (bounded). */
async function focusItemByArrows(win: Page, testId: string): Promise<void> {
  for (let i = 0; i < 12; i++) {
    const focused = await win.locator(':focus').getAttribute('data-testid').catch(() => null);
    if (focused === testId) return;
    await win.keyboard.press('ArrowDown');
  }
  throw new Error(`could not focus ${testId} by arrows`);
}

test('Shift+F10 and the ContextMenu key open the focused item’s menu (FR-018c)', async () => {
  const root = mkdtempSync(join(tmpdir(), 'throng-menuopen-'));
  writeFileSync(join(root, 'thing.txt'), 'x\n');
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'MenuOpen', root);
      const tree = win.getByTestId('file-explorer-tree');
      // Focus a tree row (a left click selects/focuses it), then open its menu by keyboard.
      await tree.getByText('thing.txt', { exact: true }).click();
      await win.keyboard.press('Shift+F10');
      await expect(win.getByTestId('context-menu')).toBeVisible();
      await win.keyboard.press('Escape');
      await expect(win.getByTestId('context-menu')).toHaveCount(0);

      // The dedicated ContextMenu (Menu) key does the same.
      await tree.getByText('thing.txt', { exact: true }).click();
      await win.keyboard.press('ContextMenu');
      await expect(win.getByTestId('context-menu')).toBeVisible();
    });
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
  }
});

test('arrow keys open a sub-menu focusing its first child, and step back out to the parent (FR-018b)', async () => {
  const root = mkdtempSync(join(tmpdir(), 'throng-menukbd-'));
  writeFileSync(join(root, 'note.txt'), 'x\n');
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'MenuKbd', root);
      const tree = win.getByTestId('file-explorer-tree');
      await tree.getByText('note.txt', { exact: true }).click({ button: 'right' });
      await expect(win.getByTestId('context-menu')).toBeVisible();

      // Navigate to the "Copy Path" parent (a sub-menu-bearing item, from 023).
      await focusItemByArrows(win, 'menu-item-Copy Path');

      // ArrowRight opens the sub-menu AND moves focus to its first child.
      await win.keyboard.press('ArrowRight');
      await expect(win.getByTestId('submenu-Copy Path')).toBeVisible();
      const firstChildFocused = await win
        .locator('[data-testid="submenu-Copy Path"] .context-menu__item:focus')
        .count();
      expect(firstChildFocused).toBe(1);

      // ArrowLeft closes the sub-menu and returns focus to the parent.
      await win.keyboard.press('ArrowLeft');
      await expect(win.getByTestId('submenu-Copy Path')).toHaveCount(0);
      await expect(win.locator(':focus')).toHaveAttribute('data-testid', 'menu-item-Copy Path');

      // Re-open with Enter (also focuses the first child), then Escape steps back out (not closing all).
      await win.keyboard.press('Enter');
      await expect(win.getByTestId('submenu-Copy Path')).toBeVisible();
      await win.keyboard.press('Escape');
      await expect(win.getByTestId('submenu-Copy Path')).toHaveCount(0);
      await expect(win.getByTestId('context-menu')).toBeVisible(); // root menu still open
      await expect(win.locator(':focus')).toHaveAttribute('data-testid', 'menu-item-Copy Path');

      // Escape at the root closes the whole menu.
      await win.keyboard.press('Escape');
      await expect(win.getByTestId('context-menu')).toHaveCount(0);
    });
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
  }
});
