import { basename } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import { TERMINAL_OUTPUT_TIMEOUT_MS, cleanupTemp, createProject, firstPanelId, runApp } from './harness.js';

// FR-021 (dedicated E2E, T128): a Terminal Panel synced into a sub-workspace mirrors
// ONE session across both views — the daemon fans its output out to every subscribed
// window. Input typed in either view is written to the single shell and appears in
// both. (panel-sync.e2e proves both windows show the terminal; this proves the shared
// session — that keystrokes in one view surface in the other.)

test('a synced Terminal Panel mirrors one session: input in one view appears in both', { tag: ['@extended', '@terminal', '@reserve:pty'] }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'throng-mirror-'));
  try {
    await runApp(async (app, win) => {
      await createProject(win, 'Mirror', root);
      const a = await firstPanelId(win);

      // Clone the Panel into a new sub-workspace window BEFORE confirming the type.
      await win.getByTestId(`panel-handle-${a}`).click({ button: 'right' });
      await win.getByTestId('menu-item-Sync to').click();
      const [child] = await Promise.all([
        app.waitForEvent('window'),
        win.getByTestId('menu-item-New Sub-workspace').click(),
      ]);
      await child.waitForLoadState('domcontentloaded');

      // Confirm Terminal (cmd) in the MAIN window → both windows show the same session.
      await win.getByTestId(`panel-type-select-${a}`).selectOption('terminal');
      await win.getByTestId('terminal-flavour').selectOption('cmd');
      await win.getByTestId(`panel-type-confirm-${a}`).click();
      const mainTerm = win.getByTestId(`terminal-${a}`);
      const childTerm = child.getByTestId(`terminal-${a}`);
      await expect(mainTerm).toContainText(basename(root), { timeout: TERMINAL_OUTPUT_TIMEOUT_MS });
      await expect(childTerm).toBeVisible({ timeout: 20000 });

      // Send a command through the MAIN window's bridge (the exact bytes, so no
      // keystroke interleaving between the two mirrored views). Because both views
      // subscribe to the ONE daemon session, the command's echo surfaces in BOTH.
      await win.evaluate((id) => window.throng.terminal.write(id, 'echo MIRROR_MARKER_42\r'), a);
      await expect(mainTerm).toContainText('MIRROR_MARKER_42', { timeout: 15000 });
      await expect(childTerm).toContainText('MIRROR_MARKER_42', { timeout: 15000 });

      // Send another through the CHILD window's bridge → it too reaches the one shared
      // shell and its echo appears in both views (input from either view is mirrored).
      await child.evaluate((id) => window.throng.terminal.write(id, 'echo MIRROR_FROM_CHILD_99\r'), a);
      await expect(childTerm).toContainText('MIRROR_FROM_CHILD_99', { timeout: 15000 });
      await expect(mainTerm).toContainText('MIRROR_FROM_CHILD_99', { timeout: 15000 });

      /*
       * Terminate the session before teardown so the app-close warning can't block it. The kill IPC
       * resolving only means the daemon accepted the request — the Panel reverting to its
       * type-select form (the same observable `terminal-revert.e2e.ts` and friends assert on) is the
       * renderer's own confirmation that the session is actually gone.
       */
      await win.evaluate((id) => window.throng?.terminal?.kill?.(id), a);
      await expect(win.getByTestId(`panel-type-form-${a}`)).toBeVisible({ timeout: 15000 });
    });
  } finally {
    cleanupTemp(root);
  }
});
