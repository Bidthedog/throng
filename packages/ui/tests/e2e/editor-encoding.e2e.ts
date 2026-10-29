/**
 * 059 US2 + US3 + US4 — a UTF-16 file in the real app: the status bar names its format, its line-ending
 * list switches it to CR and its encoding list to UTF-8, and Ctrl+S writes what was chosen (T043, T069).
 *
 * Why E2E: the indicators' rendered text in a real status bar and the menus they open on a real click
 * are the user's whole route through this feature; every piece beneath them — detection,
 * the authority's line format, the save — is proven lower, and only a running app composes them.
 */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import { runApp, createProject, firstPanelId, focusEditor, cleanupTemp } from './harness.js';

/** UTF-16 LE with a BOM — what PowerShell 5.1's `>` writes. */
function utf16le(text: string): Buffer {
  return Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]);
}

test('a UTF-16 LE file shows its format, switches to CR and UTF-8 from the status bar, and saves both (059 US2, US3, US4)', { tag: ['@extended', '@editor', '@reserve:input'] }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'throng-encoding-'));
  const file = join(root, 'ps.txt');
  writeFileSync(file, utf16le('héllo\r\nwörld\r\n'));
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'EncodingProj', root);
      const pid = await firstPanelId(win);
      await win.getByTestId(`panel-type-select-${pid}`).selectOption('editor');
      await win.getByTestId(`panel-type-confirm-${pid}`).click();
      await expect(win.getByTestId(`editor-${pid}`)).toBeVisible();
      await win.getByTestId(`editor-${pid}`).click();
      await win.getByTestId('file-explorer-tree').getByText('ps.txt', { exact: true }).click();
      const content = win.getByTestId(`editor-${pid}`).locator('.cm-content');
      await expect(content).toContainText('héllo', { timeout: 8000 });

      await expect(win.getByTestId(`editor-encoding-${pid}`)).toHaveText('UTF-16 LE');
      await expect(win.getByTestId(`editor-line-ending-${pid}`)).toHaveText('CRLF');

      // FR-057 — the line-ending list switches to CR; nothing is written yet.
      await win.getByTestId(`editor-line-ending-${pid}`).click();
      await win.getByTestId('menu-item-line-ending-cr').click();
      await expect(win.getByTestId(`editor-line-ending-${pid}`)).toHaveText('CR');

      // FR-055 — the encoding list changes the document's encoding, still writing nothing.
      await win.getByTestId(`editor-encoding-${pid}`).click();
      await win.getByTestId('menu-item-encoding-utf8').click();
      await expect(win.getByTestId(`editor-encoding-${pid}`)).toHaveText('UTF-8');
      expect(readFileSync(file).toString('hex')).toBe(utf16le('héllo\r\nwörld\r\n').toString('hex'));

      await focusEditor(win, pid);
      await win.keyboard.press('Control+S');
      await expect
        .poll(() => readFileSync(file).toString('hex'), { timeout: 8000 })
        .toBe(Buffer.from('héllo\rwörld\r', 'utf8').toString('hex'));
    });
  } finally {
    cleanupTemp(root);
  }
});
