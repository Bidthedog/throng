/**
 * US10 (#89) — the terminal panel header reflects the live window title the shell/program reports
 * (OSC 0/2 via xterm onTitleChange), replacing the panel name while a title is present.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import { runApp, createProject, firstPanelId } from './harness.js';
import { skipIfElevated } from './admin.js';

test('the terminal header shows the live window title reported by the shell (#89)', async () => {
  skipIfElevated();
  const root = mkdtempSync(join(tmpdir(), 'throng-title-'));
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'TitleProj', root);
      const pid = await firstPanelId(win);
      await win.getByTestId(`panel-type-select-${pid}`).selectOption('terminal');
      await win.getByTestId('terminal-flavour').selectOption('cmd');
      await win.getByTestId(`panel-type-confirm-${pid}`).click();
      const term = win.getByTestId(`terminal-${pid}`);
      await expect(term).toBeVisible();

      const header = win.getByTestId(`panel-title-${pid}`);
      // The header reflects the terminal's LIVE reported title (cmd announces its own image,
      // "…cmd.exe", via OSC) — replacing the panel name "Panel 1". This proves the full path:
      // xterm onTitleChange → title store → header, and that a reported title replaces the name
      // (FR-033), updating live as the terminal reports it.
      await expect(header).not.toHaveText('Panel 1', { timeout: 10_000 });
      await expect(header).toContainText('cmd.exe', { timeout: 10_000 });
    });
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
