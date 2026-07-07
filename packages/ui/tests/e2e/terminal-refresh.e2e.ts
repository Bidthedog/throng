import { basename } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import { runApp, createProject, firstPanelId } from './harness.js';

// FR-109: a periodic self-heal repaint keeps xterm's view fresh. It must be
// NON-DESTRUCTIVE — it re-renders from the buffer, so on-screen content survives
// across the refresh interval (2s) and the terminal stays live afterwards.

test('the periodic terminal repaint is non-destructive (content survives the interval)', async () => {
  const root = mkdtempSync(join(tmpdir(), 'throng-term-refresh-'));
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'Refresh', root);
      const pid = await firstPanelId(win);
      await win.getByTestId(`panel-type-select-${pid}`).selectOption('terminal');
      await win.getByTestId('terminal-flavour').selectOption('cmd');
      const confirm = win.getByTestId(`panel-type-confirm-${pid}`);
      await expect(confirm).toBeEnabled();
      await confirm.click();

      const term = win.getByTestId(`terminal-${pid}`);
      await expect(term).toBeVisible();
      // The prompt shows the project root (its unique basename).
      const marker = basename(root);
      await expect(term).toContainText(marker, { timeout: 15000 });

      // Wait past the repaint interval → at least one refresh fires; content stays.
      await win.waitForTimeout(2600);
      await expect(term).toContainText(marker);

      // The view is still live: exit the shell (unlocks the root) and the Panel
      // reverts to the type-selection form.
      await term.click();
      await win.keyboard.press('e');
      await win.keyboard.press('x');
      await win.keyboard.press('i');
      await win.keyboard.press('t');
      await win.keyboard.press('Enter');
      await expect(win.getByTestId(`panel-type-form-${pid}`)).toBeVisible({ timeout: 15000 });
    });
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 });
  }
});
