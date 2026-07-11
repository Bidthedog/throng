import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { test, expect } from '@playwright/test';
import { runApp, createProject, firstPanelId } from './harness.js';
import { skipIfElevated } from './admin.js';

// 012 revision: the daemon polls each terminal's shell cwd (via the process-cwd OS
// seam / PEB read) and pushes it to the renderer, which shows it in the panel title
// so the path stays visible even when a full-screen program hides the prompt.

test('the terminal panel title shows its live working directory and updates on cd', async () => {
  skipIfElevated();
  const root = mkdtempSync(join(tmpdir(), 'throng-cwd-title-'));
  mkdirSync(join(root, 'deepdir'));
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'CwdTitle', root);
      const pid = await firstPanelId(win);
      await win.getByTestId(`panel-type-select-${pid}`).selectOption('terminal');
      await win.getByTestId('terminal-flavour').selectOption('cmd');
      await win.getByTestId(`panel-type-confirm-${pid}`).click();
      await expect(win.getByTestId(`terminal-${pid}`)).toContainText(basename(root), { timeout: 15000 });

      // The header shows the launch cwd within a poll or two.
      await expect(win.getByTestId(`panel-cwd-${pid}`)).toContainText(basename(root), { timeout: 10000 });

      // Change directory inside the shell → the header follows.
      const term = win.getByTestId(`terminal-${pid}`);
      await term.click();
      await win.keyboard.type('cd deepdir');
      await win.keyboard.press('Enter');
      await expect(win.getByTestId(`panel-cwd-${pid}`)).toContainText('deepdir', { timeout: 10000 });
    });
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
  }
});
