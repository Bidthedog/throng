/**
 * US1 (#152, spec 024): the editor and terminal status bars are preference-controlled and visible by
 * default. Hiding a bar removes only that surface — the word-wrap command keeps working with the
 * editor bar hidden (FR-001b/c). The new terminal status bar shows the shell flavour label (FR-001).
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import { runApp, createProject, firstPanelId, cleanupTemp} from './harness.js';

test('the terminal status bar shows the flavour label by default (#152)', async () => {
  const root = mkdtempSync(join(tmpdir(), 'throng-tsb-'));
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'TsbProj', root);
      const pid = await firstPanelId(win);
      await win.getByTestId(`panel-type-select-${pid}`).selectOption('terminal');
      await win.getByTestId('terminal-flavour').selectOption('cmd');
      await win.getByTestId(`panel-type-confirm-${pid}`).click();
      await expect(win.getByTestId(`terminal-${pid}`)).toBeVisible();

      // The new status bar is present by default and names the flavour.
      const bar = win.getByTestId(`terminal-status-bar-${pid}`);
      await expect(bar).toBeVisible();
      await expect(bar).not.toBeEmpty();
    });
  } finally {
    cleanupTemp(root);
  }
});

test('hiding the editor status bar keeps the word-wrap command working (#152)', async () => {
  const root = mkdtempSync(join(tmpdir(), 'throng-esb-'));
  writeFileSync(join(root, 'x.txt'), 'y'.repeat(300) + '\n');
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'EsbProj', root);
      const pid = await firstPanelId(win);
      await win.getByTestId(`panel-type-select-${pid}`).selectOption('editor');
      await win.getByTestId(`panel-type-confirm-${pid}`).click();
      await win.getByTestId(`editor-${pid}`).click();
      await win.getByTestId('file-explorer-tree').getByText('x.txt', { exact: true }).click();
      await expect(win.getByTestId(`editor-${pid}`).locator('.cm-content')).toContainText('yyy', {
        timeout: 8000,
      });

      // Editor status strip visible by default.
      await expect(win.getByTestId(`editor-status-strip-${pid}`)).toBeVisible();

      // Hide it via settings.
      await win.getByTestId('title-bar-cog').click();
      const [prefs] = await Promise.all([
        win.context().waitForEvent('page'),
        win.getByTestId('cog-menu-settings').click(),
      ]);
      await expect(prefs.getByTestId('settings-tab')).toBeVisible();
      await prefs.getByTestId('control-editor.showStatusBar').click();

      // The strip is gone, but Ctrl+Alt+W still toggles wrap (the command is not stranded).
      await expect(win.getByTestId(`editor-status-strip-${pid}`)).toHaveCount(0);
      await win.getByTestId(`editor-${pid}`).click();
      const whiteSpace = () =>
        win
          .getByTestId(`editor-${pid}`)
          .locator('.cm-content')
          .evaluate((el) => getComputedStyle(el as HTMLElement).whiteSpace);
      const before = await whiteSpace();
      await win.keyboard.press('Control+Alt+w');
      await expect.poll(whiteSpace).not.toBe(before); // wrap flipped → the command still runs

      // …and "Set Language…" temporarily REVEALS the hidden strip with its picker open, rather than
      // doing nothing at all (#152 follow-up). The strip owns the picker, so an unmounted strip used
      // to make an enabled menu item inert.
      await win.getByTestId(`editor-${pid}`).locator('.cm-content').click({ button: 'right' });
      await win.getByTestId('menu-item-Set Language…').click();
      await expect(win.getByTestId(`editor-status-strip-${pid}`)).toBeVisible({ timeout: 5000 });
      await expect(win.getByTestId(`language-picker-${pid}`)).toBeVisible();

      // Choosing a language applies it and puts the temporarily-revealed strip away again.
      await win.getByTestId('language-option-json').click();
      await expect(win.getByTestId(`language-picker-${pid}`)).toHaveCount(0);
      await expect(win.getByTestId(`editor-status-strip-${pid}`)).toHaveCount(0);
    });
  } finally {
    cleanupTemp(root);
  }
});
