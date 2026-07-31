import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { runApp, createProject } from './harness.js';

/**
 * 026 — renaming in the tree must leave keyboard focus IN the tree.
 *
 * Committing an inline rename unmounts the text input it was typed into. Nothing then takes focus
 * back, so it falls to `<body>` and the Files & Folders pane goes dead to the keyboard: the arrow
 * keys stop moving the selection, F2 no longer starts another rename, Delete does nothing. The user
 * has to click the tree again to carry on — after an action they performed *in* the tree.
 *
 * The fix is not simply "focus the tree". react-arborist uses ROVING FOCUS: DOM focus lives on the
 * tree container, never on a row (`tree-node.tsx` documents this), and the existing
 * `select(id, { focus: false })` calls are load-bearing — issue #144 added them precisely so the
 * tree could re-highlight a row without yanking the caret out of an editor. So focus must return
 * only when the rename was driven FROM the tree, which is the case this covers.
 *
 * Two assertions, because either alone is weak:
 *
 *   1. DOM focus is inside the tree — direct, but a container can hold focus while the tree's own
 *      key handling has moved on.
 *   2. F2 opens a rename again — behavioural, and the thing the user actually lost. This is the one
 *      that would have caught the bug; the first only says where focus went.
 *
 * RED on master: focus lands on `<body>` and the second F2 does nothing.
 */

function makeProject(): string {
  const root = mkdtempSync(join(tmpdir(), 'throng-rnfocus-'));
  mkdirSync(join(root, 'Docs'));
  writeFileSync(join(root, 'Docs', 'note.txt'), 'note\n');
  writeFileSync(join(root, 'a.txt'), 'a\n');
  writeFileSync(join(root, 'b.txt'), 'b\n');
  return root;
}

/** Is DOM focus inside the Files & Folders tree? */
function focusIsInTree(win: Page): Promise<boolean> {
  return win.evaluate(() => {
    const tree = document.querySelector('[data-testid="file-explorer-tree"]');
    const active = document.activeElement;
    return !!tree && !!active && tree.contains(active);
  });
}

/** Rename `from` to `to` via the tree's inline editor (F2), and settle on the new name. */
async function renameInTree(win: Page, from: string, to: string): Promise<void> {
  const tree = win.getByTestId('file-explorer-tree');
  await tree.getByText(from, { exact: true }).click();
  await win.keyboard.press('F2');
  const input = tree.locator('input.tree-rename');
  await expect(input).toBeVisible();
  await input.fill(to);
  await input.press('Enter');
  await expect(tree.getByText(to, { exact: true })).toBeVisible({ timeout: 10_000 });
}

test('renaming a FOLDER leaves keyboard focus in the tree', async () => {
  const root = makeProject();
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'RenameFocus', root);
      const tree = win.getByTestId('file-explorer-tree');
      await expect(tree).toBeVisible();

      await renameInTree(win, 'Docs', 'Documents');

      expect(
        await focusIsInTree(win),
        'focus left the tree after the rename — the pane is dead to the keyboard',
      ).toBe(true);

      // The behavioural half: the tree still answers the keyboard, so the user can carry straight
      // on. A second F2 must open the inline editor again without touching the mouse.
      await win.keyboard.press('F2');
      await expect(tree.locator('input.tree-rename')).toBeVisible({ timeout: 5000 });
      await win.keyboard.press('Escape');
    });
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
  }
});

test('renaming a FILE leaves keyboard focus in the tree', async () => {
  // Same code path (a rename is a move for both), asserted separately so a fix that special-cases
  // folders cannot pass.
  const root = makeProject();
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'RenameFocusFile', root);
      const tree = win.getByTestId('file-explorer-tree');
      await expect(tree).toBeVisible();

      await renameInTree(win, 'a.txt', 'renamed.txt');

      expect(
        await focusIsInTree(win),
        'focus left the tree after the rename — the pane is dead to the keyboard',
      ).toBe(true);

      await win.keyboard.press('F2');
      await expect(tree.locator('input.tree-rename')).toBeVisible({ timeout: 5000 });
      await win.keyboard.press('Escape');
    });
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
  }
});

test('CANCELLING a rename also leaves focus in the tree', async () => {
  // Escape unmounts the same input by the same route. If the fix only runs on the commit path, the
  // user who changed their mind is still stranded.
  const root = makeProject();
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'RenameFocusCancel', root);
      const tree = win.getByTestId('file-explorer-tree');
      await expect(tree).toBeVisible();

      await tree.getByText('b.txt', { exact: true }).click();
      await win.keyboard.press('F2');
      await expect(tree.locator('input.tree-rename')).toBeVisible();
      await win.keyboard.press('Escape');
      await expect(tree.locator('input.tree-rename')).toHaveCount(0);

      expect(await focusIsInTree(win), 'focus left the tree after cancelling a rename').toBe(true);
    });
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
  }
});

test('an editor keeps the caret when the tree re-highlights (issue #144 must not regress)', async () => {
  // The fence for the fix. #144's `select(id, { focus: false })` exists so the tree can highlight
  // the active file's row WITHOUT stealing the caret out of an editor — a rename-focus fix written
  // as "the tree takes focus" would undo it, and typing would start landing in the wrong place.
  const root = makeProject();
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'RenameFocusFence', root);
      const tree = win.getByTestId('file-explorer-tree');
      await expect(tree).toBeVisible();

      // Open a file into an editor panel, then click into its text.
      const pid = await win
        .locator('.panel-box')
        .first()
        .evaluate((el) => (el as HTMLElement).dataset.panelId ?? '');
      await win.getByTestId(`panel-type-select-${pid}`).selectOption('editor');
      await win.getByTestId(`panel-type-confirm-${pid}`).click();
      await expect(win.getByTestId(`editor-${pid}`)).toBeVisible();
      await tree.getByText('a.txt', { exact: true }).click();
      const content = win.getByTestId(`editor-${pid}`).locator('.cm-content');
      await expect(content).toContainText('a', { timeout: 10_000 });
      await content.click();

      // The caret is in the editor and must stay there — no tree interaction has happened since.
      await win.waitForTimeout(500);
      expect(
        await focusIsInTree(win),
        'the tree stole focus from the editor — issue #144 has regressed',
      ).toBe(false);
    });
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
  }
});
