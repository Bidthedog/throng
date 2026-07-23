/**
 * US5 (#97, spec 024): editor panels name themselves from the open file.
 *
 * An editor with no manual name shows the open file's basename (final extension stripped); a manual
 * rename wins even when a different file is opened; "Reset Name" restores the auto name and is
 * disabled until the panel has been renamed; the shared unsaved dot shows for a dirty editor whether
 * auto-named or renamed.
 */
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import { runApp, createProject, firstPanelId } from './harness.js';
import { skipIfElevated } from './admin.js';

function makeProject(): string {
  const root = mkdtempSync(join(tmpdir(), 'throng-naming-'));
  writeFileSync(join(root, 'foo.ts'), 'export const foo = 1;\n');
  writeFileSync(join(root, 'bar.md'), '# bar\n');
  writeFileSync(join(root, 'baz.ts'), 'export const baz = 2;\n');
  return root;
}

test('an editor titles itself from its open file; rename wins; Reset Name restores it (#97)', async () => {
  skipIfElevated();
  const root = makeProject();
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'NamingProj', root);
      const pid = await firstPanelId(win);
      await win.getByTestId(`panel-type-select-${pid}`).selectOption('editor');
      await win.getByTestId(`panel-type-confirm-${pid}`).click();
      await expect(win.getByTestId(`editor-${pid}`)).toBeVisible();
      await win.getByTestId(`editor-${pid}`).click();

      const title = win.getByTestId(`panel-title-${pid}`);
      const tree = win.getByTestId('file-explorer-tree');

      // Auto-name from the open file's basename, final extension stripped.
      await tree.getByText('foo.ts', { exact: true }).click();
      await expect(title).toHaveText('foo', { timeout: 8000 });

      // Re-derives as the open file changes.
      await tree.getByText('bar.md', { exact: true }).click();
      await expect(title).toHaveText('bar', { timeout: 8000 });

      // "Reset Name" is DISABLED before any manual rename (FR-017).
      await win.getByTestId(`panel-handle-${pid}`).click({ button: 'right' });
      await expect(win.getByTestId('menu-item-Reset Name')).toBeDisabled();
      await win.keyboard.press('Escape');

      // A manual rename WINS, even when another file is opened.
      await win.getByTestId(`panel-handle-${pid}`).click({ button: 'right' });
      await win.getByTestId('menu-item-Rename').click();
      const input = win.getByTestId(`panel-rename-input-${pid}`);
      await input.fill('Scratch');
      await input.press('Enter');
      await expect(title).toHaveText('Scratch');
      await tree.getByText('baz.ts', { exact: true }).click();
      await expect(title).toHaveText('Scratch');

      // "Reset Name" restores the auto name — the CURRENT file's basename.
      await win.getByTestId(`panel-handle-${pid}`).click({ button: 'right' });
      await win.getByTestId('menu-item-Reset Name').click();
      await expect(title).toHaveText('baz', { timeout: 8000 });

      // The unsaved dot shows for a dirty auto-named editor, beside (not inside) the title.
      const content = win.getByTestId(`editor-${pid}`).locator('.cm-content');
      await content.click();
      await win.keyboard.type('// edit');
      await expect(win.getByTestId(`panel-unsaved-${pid}`)).toBeVisible({ timeout: 8000 });
      await expect(title).toHaveText('baz'); // dirtiness never folded into the name
    });
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
  }
});
