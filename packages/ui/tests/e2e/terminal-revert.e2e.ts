import { basename } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import { runApp, createProject, firstPanelId } from './harness.js';
import { skipIfElevated } from './admin.js';

// FR-020 (dedicated E2E, T127): when a Terminal Panel's shell ends — the user typed
// `exit` (or it crashed) — the Panel reverts to the type-selection form, surfacing the
// exit info, and can be re-typed: selecting Terminal again + Confirm starts a fresh
// session. The Panel's type is fixed only while content is live.

test('typing exit reverts the Panel to the form with exit info, then it re-types', async () => {
  skipIfElevated();
  const root = mkdtempSync(join(tmpdir(), 'throng-revert-'));
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'Revert', root);
      const pid = await firstPanelId(win);

      // Confirm a Terminal (cmd) and wait until its prompt is live.
      await win.getByTestId(`panel-type-select-${pid}`).selectOption('terminal');
      await win.getByTestId('terminal-flavour').selectOption('cmd');
      await win.getByTestId(`panel-type-confirm-${pid}`).click();
      const term = win.getByTestId(`terminal-${pid}`);
      await expect(term).toContainText(basename(root), { timeout: 20000 });

      // End the shell → the Panel reverts to the form AND surfaces the exit info.
      await term.click();
      await win.keyboard.type('exit');
      await win.keyboard.press('Enter');
      await expect(win.getByTestId(`panel-type-form-${pid}`)).toBeVisible({ timeout: 15000 });
      await expect(win.getByTestId(`panel-exit-${pid}`)).toBeVisible();

      // Re-type the Panel: Terminal again → a fresh live session starts.
      await win.getByTestId(`panel-type-select-${pid}`).selectOption('terminal');
      await win.getByTestId('terminal-flavour').selectOption('cmd');
      await win.getByTestId(`panel-type-confirm-${pid}`).click();
      const term2 = win.getByTestId(`terminal-${pid}`);
      await expect(term2).toBeVisible();
      await expect(term2).toContainText(basename(root), { timeout: 20000 });

      // Clean up the live session so the app-close warning doesn't block teardown.
      await win.evaluate((id) => window.throng?.terminal?.kill?.(id), pid);
      await win.waitForTimeout(1200);
    });
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 });
  }
});
