/**
 * Panel rename precedence + Reset Name (#89 follow-up).
 *
 * A user rename must WIN over a terminal's live OSC window title (before this, the reported title
 * overrode the rename). "Reset Name" — the header menu item next to "Rename" — clears the custom
 * name, dropping the terminal back to showing its live title.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import { runApp, createProject, firstPanelId } from './harness.js';
import { skipIfElevated } from './admin.js';

test('a rename overrides the live terminal title, and Reset Name restores it (#89)', async () => {
  skipIfElevated();
  const root = mkdtempSync(join(tmpdir(), 'throng-reset-'));
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'ResetProj', root);
      const pid = await firstPanelId(win);
      await win.getByTestId(`panel-type-select-${pid}`).selectOption('terminal');
      await win.getByTestId('terminal-flavour').selectOption('cmd');
      await win.getByTestId(`panel-type-confirm-${pid}`).click();
      await expect(win.getByTestId(`terminal-${pid}`)).toBeVisible();

      const header = win.getByTestId(`panel-title-${pid}`);
      // The live OSC title (…cmd.exe) shows first.
      await expect(header).toContainText('cmd.exe', { timeout: 10_000 });

      // Rename → the custom name WINS over the live title.
      await win.getByTestId(`panel-handle-${pid}`).click({ button: 'right' });
      await win.getByTestId('menu-item-Rename').click();
      const input = win.getByTestId(`panel-rename-input-${pid}`);
      await input.fill('My Shell');
      await input.press('Enter');
      await expect(header).toHaveText('My Shell');

      // Reset Name → the live title returns.
      await win.getByTestId(`panel-handle-${pid}`).click({ button: 'right' });
      await win.getByTestId('menu-item-Reset Name').click();
      await expect(header).toContainText('cmd.exe', { timeout: 10_000 });
    });
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
