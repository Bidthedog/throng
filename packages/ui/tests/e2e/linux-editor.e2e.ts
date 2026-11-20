import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import { cleanupTemp, createProject, firstPanelId, runApp } from './harness.js';

/**
 * Layer: E2E. Middle-click paste is Chromium's own response to a real press on Linux, from the primary selection,
 * which no synthesised event in jsdom can trigger. 073 FR-008g (2026-11-20): the middle button pastes nowhere in throng,
 * superseding the Linux middle-click paste this test once kept as its control (062 FR-030, Supersessions). Ctrl+middle-
 * click stays the zoom reset (002 FR-039); the reader's own paste is unaffected.
 */
test.skip(process.platform !== 'linux', 'The primary selection is Linux behaviour');

test('Ctrl+middle-click in an editor resets its zoom without pasting, a plain middle-click pastes nothing, and Ctrl+V still pastes', { tag: ['@linux', '@extended', '@editor', '@reserve:input'] }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'throng-middle-'));
  const marker = 'PRIMARY_SELECTION_MARK';
  const clip = 'CLIPBOARD_MARK';
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
      await app.evaluate(({ clipboard }, text) => clipboard.writeText(text), clip);

      await win.keyboard.down('Control');
      await content.click({ button: 'middle' });
      await win.keyboard.up('Control');
      await content.click({ button: 'middle' });
      // The reader's own paste is the control: input is handled in order, so once its text is in, both middle presses
      // have been, and the primary selection's absence means neither pasted.
      await win.keyboard.press('Control+v');
      await expect(content).toContainText(clip);
      expect(await content.textContent()).not.toContain(marker);
    });
  } finally {
    cleanupTemp(root);
  }
});
