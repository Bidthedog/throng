import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { runApp, createProject, firstPanelId, cleanupTemp} from './harness.js';
import { skipIfElevated } from './admin.js';

// Session 2026-07-06b: editor pill always shows the containing folder (FR-088),
// context menus stay on-screen (FR-089), and a tree rename commits on blur (FR-090).

function makeProject(): string {
  const root = mkdtempSync(join(tmpdir(), 'throng-fb3-'));
  mkdirSync(join(root, 'sub'));
  writeFileSync(join(root, 'sub', 'deep.txt'), 'DEEP\n');
  writeFileSync(join(root, 'top.txt'), 'TOP\n');
  return root;
}

async function newEditor(win: Page): Promise<string> {
  const pid = await firstPanelId(win);
  await win.getByTestId(`panel-type-select-${pid}`).selectOption('editor');
  await win.getByTestId(`panel-type-confirm-${pid}`).click();
  await expect(win.getByTestId(`editor-${pid}`)).toBeVisible();
  return pid;
}

test('the editor pill shows the containing folder in brackets (subfolder + root)', async () => {
  skipIfElevated();
  const root = makeProject();
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'Fb3', root);
      const pid = await newEditor(win);
      await win.getByTestId(`editor-${pid}`).click();
      const tree = win.getByTestId('file-explorer-tree');

      // Open a file in a subfolder → pill shows the project-relative path with the
      // host OS's native separator (Windows '\\', FR-101).
      await tree.getByTestId('tree-twisty-sub').click(); // #121: the NAME only selects; the twisty expands
      await tree.getByText('deep.txt', { exact: true }).click();
      const pill = win.getByTestId(`panel-file-${pid}`);
      await expect(pill).toContainText('deep.txt', { timeout: 8000 });
      await expect(pill).toContainText('\\sub\\');
      // The hover title (full absolute path) is consistently native — no mixed slashes.
      const title = await pill.getAttribute('title');
      expect(title).toContain('\\');
      expect(title).not.toContain('/');

      // Open a root-level file → pill shows "\\<name>" (rooted at the project root).
      await tree.getByText('top.txt', { exact: true }).click();
      await expect(pill).toContainText('top.txt', { timeout: 8000 });
      await expect(pill).toContainText('\\top.txt');
    });
  } finally {
    cleanupTemp(root);
  }
});

test('a context menu opened near the bottom-right edge stays fully on-screen (FR-089)', async () => {
  const root = makeProject();
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'Fb3', root);
      const tree = win.getByTestId('file-explorer-tree');
      await expect(tree).toBeVisible();

      const viewport = await win.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
      // The Files & Folders tree is the right-hand pane, so a right-click here lands
      // near the window's right edge — the menu (which opens rightward by default)
      // must flip LEFT to stay on-screen.
      await tree.getByText('top.txt', { exact: true }).click({ button: 'right' });
      // The menu must be fully within the viewport (flipped up/left as needed).
      const box = await win.getByTestId('context-menu').boundingBox();
      expect(box).not.toBeNull();
      if (box) {
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.y).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(viewport.w + 1);
        expect(box.y + box.height).toBeLessThanOrEqual(viewport.h + 1);
      }
    });
  } finally {
    cleanupTemp(root);
  }
});

test('entering rename selects only the name, not the extension', async () => {
  const root = makeProject();
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'Fb3', root);
      const tree = win.getByTestId('file-explorer-tree');
      await tree.getByText('top.txt', { exact: true }).click();
      await win.keyboard.press('F2');
      const input = tree.locator('input.tree-rename');
      await expect(input).toBeVisible();
      // "top.txt" → the stem "top" (0..3) is selected, not ".txt".
      const sel = await input.evaluate((el: HTMLInputElement) => ({
        start: el.selectionStart,
        end: el.selectionEnd,
        value: el.value,
      }));
      expect(sel.value).toBe('top.txt');
      expect(sel.start).toBe(0);
      expect(sel.end).toBe(3);
    });
  } finally {
    cleanupTemp(root);
  }
});

test('clicking away from an inline rename commits it immediately (FR-090)', async () => {
  const root = makeProject();
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'Fb3', root);
      const tree = win.getByTestId('file-explorer-tree');
      await tree.getByText('top.txt', { exact: true }).click();
      await win.keyboard.press('F2');
      const input = tree.locator('input.tree-rename');
      await expect(input).toBeVisible();
      await input.fill('renamed.txt');

      // Click AWAY (onto another row) instead of pressing Enter → commit (FR-090).
      await tree.getByTestId('tree-twisty-sub').click(); // #121: the NAME only selects; the twisty expands

      await expect(tree.getByText('renamed.txt', { exact: true })).toBeVisible({ timeout: 6000 });
      await expect(tree.getByText('top.txt', { exact: true })).toHaveCount(0);
      expect(existsSync(join(root, 'renamed.txt'))).toBe(true);
      expect(existsSync(join(root, 'top.txt'))).toBe(false);
    });
  } finally {
    cleanupTemp(root);
  }
});
