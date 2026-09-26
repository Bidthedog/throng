/**
 * US1 (#152, spec 024): per-document editor word-wrap toggle, reachable from the status bar, the
 * content menu, and the `Ctrl+E,W` two-stroke chord (046 FR-091, FR-124; Ctrl+Alt+W before it). Default On (editor.defaultWordWrap). The toggle reflows the
 * live view (the CodeMirror content's white-space flips between wrapping and not).
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import { runApp, createProject, firstPanelId, focusEditor, cleanupTemp} from './harness.js';
import { shippedTwoStroke } from '../shared/window-chords.js';

function makeProject(): string {
  const root = mkdtempSync(join(tmpdir(), 'throng-wrap-'));
  // A single very long line so wrapping is observable.
  writeFileSync(join(root, 'long.txt'), 'x'.repeat(400) + '\n');
  return root;
}

/** The CodeMirror content wraps when its computed white-space is a wrapping mode. */
async function contentWraps(win: import('@playwright/test').Page, pid: string): Promise<boolean> {
  const ws = await win
    .getByTestId(`editor-${pid}`)
    .locator('.cm-content')
    .evaluate((el) => getComputedStyle(el as HTMLElement).whiteSpace);
  return ws === 'break-spaces' || ws === 'pre-wrap' || ws === 'normal';
}

test('word wrap toggles from the status bar, the chord, and the content menu (#152)', { tag: ['@extended', '@editor', '@reserve:input'] }, async () => {
  const root = makeProject();
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'WrapProj', root);
      const pid = await firstPanelId(win);
      await win.getByTestId(`panel-type-select-${pid}`).selectOption('editor');
      await win.getByTestId(`panel-type-confirm-${pid}`).click();
      await expect(win.getByTestId(`editor-${pid}`)).toBeVisible();
      await win.getByTestId(`editor-${pid}`).click();
      await win.getByTestId('file-explorer-tree').getByText('long.txt', { exact: true }).click();
      await expect(win.getByTestId(`editor-${pid}`).locator('.cm-content')).toContainText('xxxx', {
        timeout: 8000,
      });

      const wrapBtn = win.getByTestId(`editor-word-wrap-${pid}`);
      // Default On.
      await expect(wrapBtn).toHaveText('Wrap');
      await expect(wrapBtn).toHaveAttribute('aria-pressed', 'true');
      expect(await contentWraps(win, pid)).toBe(true);

      // Status-bar toggle → off; the view stops wrapping.
      await wrapBtn.click();
      await expect(wrapBtn).toHaveText('No Wrap');
      await expect(wrapBtn).toHaveAttribute('aria-pressed', 'false');
      await expect.poll(() => contentWraps(win, pid)).toBe(false);

      // Ctrl+E,W → back on. Two strokes (046 FR-091) in ONE continuous press (FR-124): Ctrl held
      // from E through W. The first leaves the editor visibly waiting, and only then is the second
      // sent, so it lands in the chord rather than in the document.
      const { hold, first, second } = shippedTwoStroke('editor.toggleWordWrap');
      await focusEditor(win, pid);
      for (const mod of hold) await win.keyboard.down(mod);
      await win.keyboard.press(first);
      await expect(win.getByTestId('editor-pending-chord')).toBeVisible();
      await win.keyboard.press(second);
      for (const mod of [...hold].reverse()) await win.keyboard.up(mod);
      await expect(win.getByTestId('editor-pending-chord')).toHaveCount(0);
      await expect(wrapBtn).toHaveText('Wrap');
      await expect.poll(() => contentWraps(win, pid)).toBe(true);

      // Content menu carries a checkable "Word Wrap" item that toggles it off again.
      await win.getByTestId(`editor-${pid}`).locator('.cm-content').click({ button: 'right' });
      await expect(win.getByTestId('menu-item-Word Wrap')).toContainText('✓'); // checked while on
      await win.getByTestId('menu-item-Word Wrap').click();
      await expect(wrapBtn).toHaveText('No Wrap');
      await expect.poll(() => contentWraps(win, pid)).toBe(false);
    });
  } finally {
    cleanupTemp(root);
  }
});
