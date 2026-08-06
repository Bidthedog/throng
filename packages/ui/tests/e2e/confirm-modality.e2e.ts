/**
 * 018 US6 follow-up — a confirmation dialog is actually modal.
 *
 * `aria-modal="true"` was a promise the implementation did not keep: Tab walked straight out of the
 * dialog into the live application behind it, and a click beside the dialog answered the question by
 * dismissing it. A user consenting to a destructive consequence could reach — and press Enter on —
 * any control of an application the dialog was supposed to be blocking, or lose the dialog to a
 * misjudged click. The keyboard now cycles within the dialog, and only its buttons (or Escape, which
 * is deliberate) end it.
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { runApp, createProject, cleanupTemp} from './harness.js';

/** True while keyboard focus is somewhere inside the confirmation dialog. */
function focusInsideDialog(win: Page): Promise<boolean> {
  return win.evaluate(
    () => document.activeElement?.closest('[data-testid="confirm-dialog"]') != null,
  );
}

test('Tab stays inside a confirmation dialog, and clicking beside it does not dismiss it', async () => {
  const root = mkdtempSync(join(tmpdir(), 'throng-modal-'));
  writeFileSync(join(root, 'doomed.txt'), 'x\n');
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'ModalProj', root);
      const tree = win.getByTestId('file-explorer-tree');
      await tree.getByText('doomed.txt', { exact: true }).click();

      // The delete confirmation — the dialog the report named.
      await tree.getByText('doomed.txt', { exact: true }).click({ button: 'right' });
      await win.getByTestId('menu-item-Delete').click();
      await expect(win.getByTestId('confirm-dialog')).toBeVisible();
      expect(await focusInsideDialog(win)).toBe(true);

      // Tab all the way round — more presses than the dialog has controls, so a leak would show.
      for (let i = 0; i < 6; i++) {
        await win.keyboard.press('Tab');
        expect(await focusInsideDialog(win)).toBe(true);
      }
      // …and back the other way.
      for (let i = 0; i < 4; i++) {
        await win.keyboard.press('Shift+Tab');
        expect(await focusInsideDialog(win)).toBe(true);
      }

      // A click on the scrim beside the dialog leaves the question standing.
      await win.getByTestId('confirm-overlay').click({ position: { x: 5, y: 5 } });
      await expect(win.getByTestId('confirm-dialog')).toBeVisible();
      expect(await focusInsideDialog(win)).toBe(true);
      await expect(tree.getByText('doomed.txt', { exact: true })).toBeVisible(); // nothing happened

      // Cancel is a button, and buttons still work.
      await win.getByTestId('confirm-cancel').click();
      await expect(win.getByTestId('confirm-dialog')).toHaveCount(0);
      await expect(tree.getByText('doomed.txt', { exact: true })).toBeVisible();
    });
  } finally {
    cleanupTemp(root);
  }
});
