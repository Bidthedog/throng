/**
 * 024 US3 follow-up — in Files & Folders the arrow keys move the SELECTION, not a separate cursor.
 *
 * Every file operation reads the selection, so a tree where the highlight and the operations
 * disagree quietly does the wrong thing: Ctrl+X cut the row the user had arrowed AWAY from, and
 * Ctrl+V pasted into that row's folder rather than the one the cursor was resting on. This drives
 * both from the keyboard alone and proves the file that actually moved is the one that was cut, into
 * the folder the cursor had reached.
 */
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import { runApp, createProject, cleanupTemp} from './harness.js';

test('arrowing to a row makes it the cut/paste target (024 US3 follow-up)', async () => {
  const root = mkdtempSync(join(tmpdir(), 'throng-kbdsel-'));
  mkdirSync(join(root, 'sub'));
  writeFileSync(join(root, 'a.txt'), 'A\n');
  writeFileSync(join(root, 'b.txt'), 'B\n');
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'KbdSelProj', root);
      const tree = win.getByTestId('file-explorer-tree');
      await expect(tree.getByText('a.txt', { exact: true })).toBeVisible({ timeout: 8000 });

      // Start on the folder (a single click selects it; only a double-click expands it), so the
      // whole rest of the gesture is keyboard-only.
      await tree.getByText('sub', { exact: true }).click();

      // The highlighted row is drawn ONLY by the selected-row background — no second focus ring
      // boxing it in, now that selection and focus are the same thing.
      await expect
        .poll(() =>
          win.evaluate(() => {
            const row = document.querySelector(
              '[data-testid="file-explorer-tree"] [role="treeitem"]:focus',
            );
            return row ? getComputedStyle(row).outlineStyle : 'no-focused-row';
          }),
        )
        .toBe('none');
      // Down onto a.txt — this must SELECT it, not merely draw a cursor over it.
      await win.keyboard.press('ArrowDown');
      await win.keyboard.press('Control+x');
      // Back up onto the folder, which is now the paste target for the same reason.
      await win.keyboard.press('ArrowUp');
      await win.keyboard.press('Control+v');

      // a.txt moved into the (collapsed) folder: gone from the root listing, present inside it.
      await expect(tree.getByText('a.txt', { exact: true })).toHaveCount(0, { timeout: 8000 });
      await expect(tree.getByText('b.txt', { exact: true })).toBeVisible(); // untouched
      await tree.getByText('sub', { exact: true }).dblclick();
      await expect(tree.getByText('a.txt', { exact: true })).toBeVisible({ timeout: 8000 });
    });
  } finally {
    cleanupTemp(root);
  }
});
