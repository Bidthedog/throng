import { basename } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import { runApp, createProject, firstPanelId } from './harness.js';

// US2 (launch) / Plan Phase C·1 (FR-013/014/SC-004): confirming a Terminal Panel
// starts a live shell hosted by the daemon, attached inline (xterm.js), rooted at
// the project. The terminal echoes input and reports the project root as its cwd.

test('confirms Terminal → a live inline shell echoes input and starts at the project root', async () => {
  const root = mkdtempSync(join(tmpdir(), 'throng-term-live-'));
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'Live', root);
      const pid = await firstPanelId(win);

      await win.getByTestId(`panel-type-select-${pid}`).selectOption('terminal');
      // Use Command Prompt (plain echo, no PSReadLine line-editor repainting) so
      // the streamed output is straightforward to assert.
      await win.getByTestId('terminal-flavour').selectOption('cmd');
      const confirm = win.getByTestId(`panel-type-confirm-${pid}`);
      await expect(confirm).toBeEnabled();
      await confirm.click();

      // The inline terminal view mounts (FR-014).
      const term = win.getByTestId(`terminal-${pid}`);
      await expect(term).toBeVisible();

      // cmd.exe's prompt shows its cwd → the project root (FR-013 / SC-004). The
      // temp dir's unique basename appears in the terminal viewport.
      await expect(term).toContainText(basename(root), { timeout: 15000 });

      // A plain left-click must focus the terminal so the user can type (the click
      // also activates the Panel; it must not tear down/blur the view).
      await term.click();
      await win.keyboard.type('echo LIVE_MARKER_88');
      await win.keyboard.press('Enter');
      await expect(term).toContainText('LIVE_MARKER_88', { timeout: 15000 });

      // Close the shell → the Panel reverts to the type-selection form (FR-020),
      // and the project root unlocks (so teardown can remove it).
      await term.click();
      await win.keyboard.type('exit');
      await win.keyboard.press('Enter');
      await expect(win.getByTestId(`panel-type-form-${pid}`)).toBeVisible({ timeout: 15000 });
    });
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 });
  }
});
