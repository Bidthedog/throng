/**
 * US9 (#156) — the "Copy Path" submenu copies an item's path in each absolute/relative ×
 * Windows/Linux form to the clipboard.
 */
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import { runApp, createProject, cleanupTemp} from './harness.js';
import type { Page } from '@playwright/test';

function makeProject(): string {
  const root = mkdtempSync(join(tmpdir(), 'throng-cp-'));
  mkdirSync(join(root, 'src'));
  writeFileSync(join(root, 'src', 'b.txt'), 'b\n');
  return root;
}

const clip = (win: Page) =>
  win.evaluate(() => window.throng?.clipboard?.paste().then((e) => e?.text ?? ''));

async function copyForm(win: Page, treeText: string, form: string): Promise<string> {
  const tree = win.getByTestId('file-explorer-tree');
  await tree.getByText(treeText, { exact: true }).click({ button: 'right' });
  await win.getByTestId('menu-item-Copy Path').click();
  await win.getByTestId(`menu-item-${form}`).click();
  return clip(win);
}

test('Copy Path copies the item path in each absolute/relative × slash form (#156)', async () => {
  const root = makeProject();
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'CopyPath', root);
      const tree = win.getByTestId('file-explorer-tree');
      // Expand 'src' ONCE (via its chevron — a double-click would toggle it, US2) to reveal b.txt.
      await tree.getByTestId('tree-twisty-src').click();
      await expect(tree.getByText('b.txt', { exact: true })).toBeVisible();

      // Absolute POSIX: MSYS/Git Bash form — a `/<drive>/…` root, forward slashes, no backslashes.
      const absPosix = await copyForm(win, 'b.txt', 'Absolute (POSIX)');
      expect(absPosix).toMatch(/^\/[a-z]\//); // starts /<drive-letter>/
      expect(absPosix).toContain('/src/b.txt');
      expect(absPosix).not.toContain('\\');
      expect(absPosix).not.toContain(':'); // no drive colon in the POSIX form

      // Absolute Windows: backslashes, drive letter kept.
      const absWin = await copyForm(win, 'b.txt', 'Absolute (Windows)');
      expect(absWin).toContain('\\src\\b.txt');
      expect(absWin).not.toContain('/');

      // Relative forms are relative to the project root (no drive).
      const relPosix = await copyForm(win, 'b.txt', 'Relative (POSIX)');
      expect(relPosix).toBe('src/b.txt');
      const relWin = await copyForm(win, 'b.txt', 'Relative (Windows)');
      expect(relWin).toBe('src\\b.txt');
    });
  } finally {
    cleanupTemp(root);
  }
});
