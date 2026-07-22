/**
 * US8 (#154) — "Save Document Scroll Position". With the pref OFF (default), opening a different
 * file in place resets scroll to the top; with it ON, reopening a file in place restores its scroll.
 */
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import { runApp, createProject } from './harness.js';
import type { Page } from '@playwright/test';

const longText = (marker: string): string =>
  Array.from({ length: 300 }, (_, i) => `${marker}_LINE_${i + 1}`).join('\n') + '\n';

function makeProject(): string {
  const root = mkdtempSync(join(tmpdir(), 'throng-scroll-'));
  writeFileSync(join(root, 'one.txt'), longText('ONE'));
  writeFileSync(join(root, 'two.txt'), longText('TWO'));
  return root;
}

const scrollTop = (win: Page) => win.locator('.cm-scroller').first().evaluate((el) => el.scrollTop);

test('with the pref off (default), opening a different file in place scrolls to the top (#154)', async () => {
  const root = makeProject();
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'Scroll', root);
      const tree = win.getByTestId('file-explorer-tree');

      await tree.getByText('one.txt', { exact: true }).click();
      await expect(win.locator('.cm-content').first()).toContainText('ONE_LINE_1');

      // Scroll to the bottom of file one.
      await win.locator('.cm-content').first().click();
      await win.keyboard.press('Control+End');
      await expect.poll(() => scrollTop(win)).toBeGreaterThan(100);

      // Open file two IN PLACE (default openTarget reuses this editor).
      await tree.getByText('two.txt', { exact: true }).click();
      await expect(win.locator('.cm-content').first()).toContainText('TWO_LINE_1');

      // US8 (off): the new document starts at the top, not carrying file one's scroll.
      await expect.poll(() => scrollTop(win)).toBeLessThan(5);
    });
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
