/**
 * The language picker is a LISTBOX, not a hundred tab stops (024 follow-up).
 *
 * Every option was a button, so Tab stepped through the languages one at a time — Tab doing the job
 * of an arrow key, and no way back to the filter short of tabbing past every remaining language. The
 * ARIA listbox pattern says a composite widget is a SINGLE tab stop with the arrows moving inside
 * it, and that is what a user reaching for Tab expects: the next CONTROL, not the next row.
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { runApp, createProject, firstPanelId, cleanupTemp} from './harness.js';

/** The test id of whatever currently holds the keyboard. */
function focusedTestId(win: Page): Promise<string | null> {
  return win.evaluate(() => document.activeElement?.getAttribute('data-testid') ?? null);
}

test('Tab moves between the filter and the list; arrows move within it; Enter confirms', async () => {
  const root = mkdtempSync(join(tmpdir(), 'throng-langkbd-'));
  writeFileSync(join(root, 'thing.txt'), 'hello\n');
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'LangKbdProj', root);
      const pid = await firstPanelId(win);
      await win.getByTestId(`panel-type-select-${pid}`).selectOption('editor');
      await win.getByTestId(`panel-type-confirm-${pid}`).click();
      await win.getByTestId(`editor-${pid}`).click();
      await win.getByTestId('file-explorer-tree').getByText('thing.txt', { exact: true }).click();
      await expect(win.getByTestId(`editor-${pid}`).locator('.cm-content')).toContainText('hello', {
        timeout: 8000,
      });

      await win.getByTestId(`editor-language-${pid}`).click();
      await expect(win.getByTestId(`language-picker-${pid}`)).toBeVisible();
      // The filter takes the keyboard, so the user can type straight away.
      expect(await focusedTestId(win)).toBe(`language-filter-${pid}`);

      // Filter to a couple of options so the assertions below name known rows.
      await win.getByTestId(`language-filter-${pid}`).fill('json');
      await expect(win.getByTestId('language-option-json')).toBeVisible();

      // ONE Tab reaches the list — landing on its first option, not stepping through languages.
      await win.keyboard.press('Tab');
      expect(await focusedTestId(win)).toBe('language-option-json');

      // The ARROWS move within the list…
      await win.keyboard.press('ArrowDown');
      const afterDown = await focusedTestId(win);
      expect(afterDown).not.toBe('language-option-json');
      expect(afterDown).toMatch(/^language-option-/);
      await win.keyboard.press('ArrowUp');
      expect(await focusedTestId(win)).toBe('language-option-json');

      // ArrowUp off the TOP of the list goes back to the filter — the way in was ArrowDown out of
      // it, and a door that only opens one way is not a door.
      await win.keyboard.press('ArrowUp');
      expect(await focusedTestId(win)).toBe(`language-filter-${pid}`);
      await win.keyboard.press('ArrowDown');
      expect(await focusedTestId(win)).toBe('language-option-json');

      // …and Tab does NOT move within the list: it leaves it, because the list is one stop.
      await win.keyboard.press('Tab');
      expect(await focusedTestId(win)).not.toMatch(/^language-option-/);

      // Tab never leaves the STRIP, either: it cycles the picker and the strip's own controls, and
      // does not walk off into the file tree or the panels behind an open menu.
      for (let i = 0; i < 8; i++) {
        await win.keyboard.press('Tab');
        const inStrip = await win.evaluate(
          (id) =>
            document.activeElement?.closest(`[data-testid="editor-status-strip-${id}"]`) != null,
          pid,
        );
        expect(inStrip).toBe(true);
      }

      // Back to the list, and Enter confirms the option the arrows are on.
      await win.getByTestId(`language-filter-${pid}`).focus();
      await win.keyboard.press('ArrowDown');
      expect(await focusedTestId(win)).toBe('language-option-json');
      await win.keyboard.press('Enter');
      await expect(win.getByTestId(`language-picker-${pid}`)).toHaveCount(0);
      await expect(win.getByTestId(`editor-language-${pid}`)).toHaveText('JSON');
    });
  } finally {
    cleanupTemp(root);
  }
});
