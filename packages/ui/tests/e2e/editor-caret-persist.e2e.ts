/**
 * Regression E2E for issue 144 — the editor caret/selection is lost when you switch
 * away from an editor's tab and back.
 *
 * ## The mechanism
 *
 * A background tab is not in the React tree (FR-008), so switching tabs UNMOUNTS the
 * editor and `view.destroy()`s the CodeMirror view — which holds all selection/scroll
 * state. Remounting rebuilds the view from the authority's TEXT, which carries no
 * selection, so the caret snapped back to offset 0. The fix saves the view state
 * (selection + scroll) on unmount, keyed by panel id, and restores it on the next
 * mount (`editor-view-state.ts`, wired through `use-editor.ts`).
 *
 * This test moves the caret to the end of a known line, switches away (adds a second
 * tab), switches back, then types a marker WITHOUT re-clicking — so the marker lands
 * wherever the caret actually is. With the bug it lands at the start of the document;
 * fixed, it lands at the end of the line the user left it on.
 */
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { runApp, createProject, firstPanelId } from './harness.js';
import { skipIfElevated } from './admin.js';

function makeProject(): string {
  const root = mkdtempSync(join(tmpdir(), 'throng-caret-'));
  // Four distinct single-word lines so the caret's line is unambiguous from the text.
  writeFileSync(join(root, 'lines.txt'), 'AAAA\nBBBB\nCCCC\nDDDD\n');
  return root;
}

async function newEditor(win: Page, pid: string): Promise<void> {
  await win.getByTestId(`panel-type-select-${pid}`).selectOption('editor');
  await win.getByTestId(`panel-type-confirm-${pid}`).click();
  await expect(win.getByTestId(`editor-${pid}`)).toBeVisible();
}

/** The editor's lines as plain text (zero-width placeholder → empty line). */
const docLines = (win: Page, pid: string): Promise<string[]> =>
  win.evaluate(
    (id) =>
      [...document.querySelectorAll(`[data-testid="editor-${id}"] .cm-line`)].map((l) =>
        l.textContent === '​' ? '' : (l.textContent ?? ''),
      ),
    pid,
  );

test('the scroll position is restored and the editor re-focuses on switch back (issue 144)', async () => {
  skipIfElevated();
  const root = mkdtempSync(join(tmpdir(), 'throng-scroll-'));
  const rows = Array.from({ length: 200 }, (_, i) => `row-${String(i).padStart(3, '0')}`);
  // No trailing newline, so Ctrl+End lands at the end of "row-199", not an empty line after it.
  writeFileSync(join(root, 'long.txt'), rows.join('\n'));
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'ScrollProj', root);
      const pid = await firstPanelId(win);
      await newEditor(win, pid);

      await win.getByTestId(`editor-${pid}`).click();
      await win.getByTestId('file-explorer-tree').getByText('long.txt', { exact: true }).click();
      const content = win.getByTestId(`editor-${pid}`).locator('.cm-content');
      await expect(content).toContainText('row-000', { timeout: 8000 });

      // Scroll to the very bottom (caret at end of the document).
      await content.click();
      await win.keyboard.press('Control+End');
      const scroller = win.getByTestId(`editor-${pid}`).locator('.cm-scroller');
      const scrollBefore = await scroller.evaluate((el) => el.scrollTop);
      expect(scrollBefore).toBeGreaterThan(0);

      // Switch away (second tab) and back to the editor's tab (remount).
      await win.getByTestId('tab-add').click();
      await expect(win.locator('.tab-chip')).toHaveCount(2);
      await win.locator('.tab-chip').nth(0).click();
      await expect(content).toContainText('row-199', { timeout: 8000 });

      // The viewport is restored near the bottom, not reset to the top.
      await expect
        .poll(() => scroller.evaluate((el) => el.scrollTop), { timeout: 8000 })
        .toBeGreaterThan(scrollBefore - 40);

      // The editor took keyboard focus on remount WITHOUT a click (CodeMirror marks the
      // focused view with `.cm-focused`)…
      await expect(win.getByTestId(`editor-${pid}`).locator('.cm-editor')).toHaveClass(
        /cm-focused/,
        { timeout: 4000 },
      );
      // …so a typed marker lands at the restored caret (end of the document).
      await win.keyboard.type('Z');
      const lines = await docLines(win, pid);
      expect(lines.filter((l) => l.includes('Z')).join()).toContain('row-199Z');
    });
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
  }
});

test('the caret survives a tab switch away and back (issue 144)', async () => {
  skipIfElevated();
  const root = makeProject();
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'CaretProj', root);
      const pid = await firstPanelId(win);
      await newEditor(win, pid);

      // Open the file and put the caret at the END of the third line ("CCCC").
      await win.getByTestId(`editor-${pid}`).click();
      await win.getByTestId('file-explorer-tree').getByText('lines.txt', { exact: true }).click();
      const content = win.getByTestId(`editor-${pid}`).locator('.cm-content');
      await expect(content).toContainText('CCCC', { timeout: 8000 });
      await content.locator('.cm-line', { hasText: 'CCCC' }).click();
      await win.keyboard.press('End');

      // Switch AWAY: a second tab becomes active, so the editor's tab unmounts (saving
      // its view state), then switch BACK to the editor's tab (remount → restore).
      await win.getByTestId('tab-add').click();
      await expect(win.locator('.tab-chip')).toHaveCount(2);
      await win.locator('.tab-chip').nth(0).click();
      await expect(content).toContainText('CCCC', { timeout: 8000 });

      // Focus the editor WITHOUT clicking (a click would move the caret). CodeMirror
      // reflects its restored state-selection to the DOM on focus, so the marker we
      // type lands at the caret the fix restored.
      await content.evaluate((el) => (el as HTMLElement).focus());
      await win.keyboard.type('Z');

      const lines = await docLines(win, pid);
      // Restored: the marker appends to the line the caret was left on…
      expect(lines[2]).toBe('CCCCZ');
      // …and the first line is untouched (it would read "ZAAAA" if the caret reset to 0).
      expect(lines[0]).toBe('AAAA');
    });
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
  }
});
