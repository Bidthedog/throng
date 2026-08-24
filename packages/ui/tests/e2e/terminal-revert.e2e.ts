import { basename } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import { runApp, createProject, firstPanelId, cleanupTemp} from './harness.js';

// FR-020 (dedicated E2E, T127): when a Terminal Panel's shell ends — the user typed
// `exit` (or it crashed) — the Panel reverts to the type-selection form, surfacing the
// exit info, and can be re-typed: selecting Terminal again + Confirm starts a fresh
// session. The Panel's type is fixed only while content is live.

test('typing exit reverts the Panel to the form with exit info, then it re-types', { tag: ['@extended', '@terminal', '@reserve:pty'] }, async () => {
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

      // End the shell → the Panel reverts to the form.
      await term.click();
      await win.keyboard.type('exit');
      await win.keyboard.press('Enter');
      await expect(win.getByTestId(`panel-type-form-${pid}`)).toBeVisible({ timeout: 15000 });
      // ...and says NOTHING about it (025 follow-up). This assertion was inverted deliberately:
      // it used to require the exit notice here, but telling a user "Terminal exited (code 0)"
      // after they typed `exit` reports back their own action, and trains them to dismiss notices
      // unread — which is exactly when a real failure gets missed. A non-zero exit still surfaces;
      // see the case below.
      await expect(win.getByTestId(`panel-exit-${pid}`)).toHaveCount(0);

      // A FAILING exit is still surfaced, with its code — constitutional Principle III. This is
      // the other half of the rule, and without it the change above would just be "hide exits".
      await win.getByTestId(`panel-type-select-${pid}`).selectOption('terminal');
      await win.getByTestId('terminal-flavour').selectOption('cmd');
      await win.getByTestId(`panel-type-confirm-${pid}`).click();
      const failing = win.getByTestId(`terminal-${pid}`);
      await expect(failing).toBeVisible();
      // Wait for the shell to reach its prompt before typing, or the keystrokes are dropped.
      await expect(failing).toContainText(basename(root), { timeout: 20000 });
      await failing.click();
      await win.keyboard.type('exit 3');
      await win.keyboard.press('Enter');
      await expect(win.getByTestId(`panel-type-form-${pid}`)).toBeVisible({ timeout: 15000 });
      await expect(win.getByTestId(`panel-exit-${pid}`)).toBeVisible();

      /*
       * DISMISS IT BEFORE RE-TYPING (#313).
       *
       * The claim above — a non-zero exit is surfaced, Principle III — is complete the moment the
       * notice is visible. What follows needs the Confirm button underneath it, and since #313 a
       * notice takes pointer events: `.panel-type-form__actions` puts Confirm at the bottom-right of
       * the panel while the notice column is pinned to the bottom-right of the window, so the two
       * overlap. Dismissal is the remedy #313 names and the one a user has — and here it is also the
       * honest gesture, because the notice has already told them what it exists to tell them.
       *
       * This is a `dismiss`-mode notice, so waiting it out is not an option: `noticeSeverityForExit`
       * maps a non-zero exit to `error`, and an error never times out.
       */
      await win.getByTestId(`exit-dismiss-${pid}`).click();
      await expect(win.getByTestId(`panel-exit-${pid}`)).toHaveCount(0);

      // Re-type the Panel: Terminal again → a fresh live session starts.
      await win.getByTestId(`panel-type-select-${pid}`).selectOption('terminal');
      await win.getByTestId('terminal-flavour').selectOption('cmd');
      await win.getByTestId(`panel-type-confirm-${pid}`).click();
      const term2 = win.getByTestId(`terminal-${pid}`);
      await expect(term2).toBeVisible();
      await expect(term2).toContainText(basename(root), { timeout: 20000 });

      /*
       * Clean up the live session so the app-close warning doesn't block teardown. The kill IPC
       * resolving only means the daemon accepted the request — the Panel reverting to its
       * type-select form (asserted twice already above) is the renderer's own confirmation that the
       * session is actually gone.
       */
      await win.evaluate((id) => window.throng?.terminal?.kill?.(id), pid);
      await expect(win.getByTestId(`panel-type-form-${pid}`)).toBeVisible({ timeout: 15000 });
    });
  } finally {
    cleanupTemp(root);
  }
});
