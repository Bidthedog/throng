/**
 * US1 (#125) — a context-menu item whose command has a bound keyboard shortcut shows that
 * shortcut in brackets after the label, in smaller text; an unbound item is unchanged.
 */
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import { runApp, createProject } from './harness.js';

test('a context-menu item shows its command’s first keyboard shortcut in brackets (#125)', async () => {
  const root = mkdtempSync(join(tmpdir(), 'throng-sc-'));
  writeFileSync(join(root, 'a.txt'), 'a\n');
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'Shortcuts', root);
      const tree = win.getByTestId('file-explorer-tree');
      await expect(tree.getByText('a.txt', { exact: true })).toBeVisible();

      await tree.getByText('a.txt', { exact: true }).click({ button: 'right' });

      // Copy is bound to Ctrl+C in the explorer scope → shown in brackets after the label.
      await expect(win.getByTestId('menu-item-Copy')).toBeVisible();
      await expect(win.getByTestId('menu-shortcut-Copy')).toHaveText('(Ctrl+C)');

      // FR-005 — the shortcut is visually smaller than the label.
      const sizes = await win.evaluate(() => {
        const sc = document.querySelector('[data-testid="menu-shortcut-Copy"]') as HTMLElement;
        const label = sc.closest('.context-menu__item')?.querySelector('.context-menu__label') as HTMLElement;
        return {
          shortcut: parseFloat(getComputedStyle(sc).fontSize),
          label: parseFloat(getComputedStyle(label).fontSize),
        };
      });
      expect(sizes.shortcut).toBeLessThan(sizes.label);

      // FR-004 — an item whose action has no keybinding (New File) renders no shortcut element.
      await expect(win.getByTestId('menu-item-New File')).toBeVisible();
      await expect(win.getByTestId('menu-shortcut-New File')).toHaveCount(0);
    });
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
