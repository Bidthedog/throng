import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import { cleanupTemp, createProject, firstPanelId, runApp } from './harness.js';

/**
 * Layer: E2E. Middle-click paste is Chromium's own response to a real press on Linux, from the primary selection,
 * which no synthesised event in jsdom can trigger (062 FR-033).
 */
test.skip(process.platform !== 'linux', 'The primary selection is Linux behaviour');

test('Ctrl+middle-click in an editor resets its zoom without pasting, and a plain middle-click still pastes', { tag: ['@linux', '@extended', '@editor', '@reserve:input'] }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'throng-middle-'));
  const marker = 'PRIMARY_SELECTION_MARK';
  writeFileSync(join(root, 'lines.txt'), 'one\ntwo\nthree\n');
  try {
    await runApp(async (app, win) => {
      await createProject(win, 'Middle', root);
      const pid = await firstPanelId(win);
      await win.getByTestId(`panel-type-select-${pid}`).selectOption('editor');
      await win.getByTestId(`panel-type-confirm-${pid}`).click();
      const editor = win.getByTestId(`editor-${pid}`);
      await expect(editor).toBeVisible();
      await editor.click();
      await win.getByTestId('file-explorer-tree').getByText('lines.txt', { exact: true }).click();
      const content = editor.locator('.cm-content');
      await expect(content).toContainText('one', { timeout: 8000 });
      // The gesture's press is prevented, so it takes no focus of its own: the paste only lands in an editor already focused.
      await content.click();
      // Electron takes the clipboard type at runtime; the types this project compiles against name only the text.
      await app.evaluate(({ clipboard }, text) => (clipboard.writeText as (text: string, type: string) => void)(text, 'selection'), marker);

      await win.keyboard.down('Control');
      await content.click({ button: 'middle' });
      await win.keyboard.up('Control');
      // The plain click is the control: it proves the paste route works here, and that it has drained, so one mark means Ctrl pasted nothing.
      await content.click({ button: 'middle' });
      await expect(content).toContainText(marker);
      const text = (await content.textContent()) ?? '';
      expect(text.split(marker).length - 1).toBe(1);
    });
  } finally {
    cleanupTemp(root);
  }
});
