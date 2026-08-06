import { basename, join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { test, expect, type Page } from '@playwright/test';
import { runApp, createProject, firstPanelId, seedDatabase, cleanupTemp} from './harness.js';
import { skipIfElevated } from './admin.js';

// 011, US1 (T037 / FR-001..003,006): every one of the four panel error surfaces
// carries a trailing-edge themeable `dismiss` icon control that removes the error
// IMMEDIATELY (no focus change / re-render trigger) and re-appears on recurrence.
// The sub-workspaces surface is the reference the other three now match. The dismiss
// glyph is the active theme's `dismiss` token (009), never a text label.

async function projectId(win: Page): Promise<string> {
  const el = win.locator('[data-testid^="project-switch-"]').first();
  const testid = await el.getAttribute('data-testid');
  return testid!.replace('project-switch-', '');
}

test('Projects error: trailing-edge dismiss removes it immediately and recurs', async () => {
  const root = mkdtempSync(join(tmpdir(), 'throng-errdismiss-proj-'));
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'Proj', root);
      const pid = await projectId(win);

      const forceError = async (): Promise<void> => {
        await win.getByTestId(`project-switch-${pid}`).dblclick();
        const input = win.getByTestId(`project-rename-input-${pid}`);
        await input.evaluate((el) => {
          const i = el as HTMLInputElement;
          const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
          setter.call(i, 'y'.repeat(130));
          i.dispatchEvent(new Event('input', { bubbles: true }));
        });
        await input.press('Enter');
        await expect(win.getByTestId('project-error')).toBeVisible({ timeout: 6000 });
        // Close the inline editor (Escape) so the error stands on its own — otherwise
        // clicking the dismiss control would blur-recommit the invalid name and
        // immediately re-raise the same error.
        await input.press('Escape');
        await expect(win.getByTestId(`project-rename-input-${pid}`)).toHaveCount(0);
        await expect(win.getByTestId('project-error')).toBeVisible();
      };

      await forceError();
      // The dismiss control is themeable (resolves the `dismiss` glyph, not a label).
      const dismiss = win.getByTestId('project-error-dismiss');
      await expect(dismiss).toBeVisible();
      await dismiss.click();
      // Immediate removal — no focus change, no reload.
      await expect(win.getByTestId('project-error')).toHaveCount(0);

      // Recurrence: the same condition re-shows the surface.
      await forceError();
      await expect(win.getByTestId('project-error-dismiss')).toBeVisible();
    });
  } finally {
    cleanupTemp(root);
  }
});

test('Sub-workspaces error: themeable dismiss removes it immediately and recurs', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'throng-errdismiss-sw-'));
  seedDatabase(dataDir, (db) => {
    db.exec(`
      CREATE TRIGGER block_subworkspace_insert BEFORE INSERT ON sub_workspaces
      BEGIN
        SELECT RAISE(ABORT, 'simulated persist failure');
      END;
    `);
  });
  try {
    await runApp(
      async (_app, win) => {
        await createProject(win, 'Failer', 'C:/c/failer');
        await expect(win.getByTestId('tab-strip')).toBeVisible();

        const detach = async (): Promise<void> => {
          const firstTab = win.locator('.tab-chip').first();
          await firstTab.click();
          await firstTab.click({ button: 'right' });
          await expect(win.getByTestId('context-menu')).toBeVisible();
          await win.getByTestId('menu-item-Sync to').click();
          await win.getByTestId('menu-item-New Sub-workspace').click();
          await expect(win.getByTestId('subworkspace-error')).toBeVisible();
        };

        await detach();
        const dismiss = win.getByTestId('subworkspace-error-dismiss');
        await expect(dismiss).toBeVisible();
        await dismiss.click();
        await expect(win.getByTestId('subworkspace-error')).toHaveCount(0);

        await detach(); // recurrence
        await expect(win.getByTestId('subworkspace-error-dismiss')).toBeVisible();
      },
      { dataDir },
    );
  } finally {
    cleanupTemp(dataDir);
  }
});

test('File Explorer error: trailing-edge dismiss removes it immediately and recurs', async () => {
  // A project root that does not exist on disk: any file op (New folder) fails
  // deterministically in the daemon (non-recursive mkdir → ENOENT), surfacing the
  // pane's real error banner. No frozen contextBridge override, no disk race.
  const missingRoot = join(tmpdir(), 'throng-fx-missing-root-does-not-exist');
  await runApp(async (_app, win) => {
    await createProject(win, 'Files', missingRoot);
    await expect(win.getByTestId('explorer-toolbar')).toBeVisible();

    // Notices STACK (024 follow-up), and a missing root fails at BOTH the initial listing and the
    // New-folder attempt — two distinct failures, so two notices, each with its own dismiss control.
    const notices = win.getByTestId('explorer-error');
    const trigger = async (): Promise<void> => {
      await win.getByRole('button', { name: 'New folder' }).click();
      await expect(notices.first()).toBeVisible({ timeout: 6000 });
    };

    await trigger();
    /*
     * Dismissing clears the stack, one acknowledgement at a time.
     *
     * Deliberately NOT asserted as a per-click decrement. Two versions of that raced and reddened CI
     * (runs 30951944889 and 30954326326): a missing project root keeps failing, so a fresh notice can
     * land between the count taken before a click and the one taken after, and the arithmetic is then
     * wrong while nothing is broken. `count()` does not retry either, so both reads were instants.
     *
     * What this feature promises — and what the three surfaces above check individually, where
     * nothing else is generating notices — is that a dismiss removes the notice it belongs to and the
     * same failure can be raised again. That claim survives another notice arriving mid-loop.
     * "Exactly one fewer" never could.
     */
    for (let guard = 0; guard < 30 && (await notices.count()) > 0; guard += 1) {
      await win.getByTestId('explorer-error-dismiss').first().click();
      await win.waitForTimeout(100);
    }
    await expect(notices).toHaveCount(0);

    await trigger(); // recurrence — the same failure, once dismissed, can be raised again
    await expect(win.getByTestId('explorer-error-dismiss').first()).toBeVisible();
  });
});

test('Terminal exit notice: dismiss removes it, leaves the form usable, and recurs', async () => {
  skipIfElevated();
  const root = mkdtempSync(join(tmpdir(), 'throng-errdismiss-term-'));
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'Term', root);
      const pid = await firstPanelId(win);

      const exitOnce = async (): Promise<void> => {
        await win.getByTestId(`panel-type-select-${pid}`).selectOption('terminal');
        await win.getByTestId('terminal-flavour').selectOption('cmd');
        await win.getByTestId(`panel-type-confirm-${pid}`).click();
        const term = win.getByTestId(`terminal-${pid}`);
        await expect(term).toContainText(basename(root), { timeout: 20000 });
        await term.click();
        /*
         * `exit 3`, not `exit` — a FAILING exit is the only one that raises a notice.
         *
         * This test asserted the notice after a clean `exit` and had been failing in every
         * environment, because that behaviour was deliberately removed: telling a user "Terminal
         * exited (code 0)" after they typed `exit` reports their own action back at them and trains
         * them to dismiss notices unread. `terminal-revert.e2e.ts` pins both halves of that decision.
         *
         * The subject here is the DISMISS control on the terminal-exit surface, which needs a notice
         * to exist at all — so it uses the exit that still produces one.
         */
        await win.keyboard.type('exit 3');
        await win.keyboard.press('Enter');
        await expect(win.getByTestId(`panel-exit-${pid}`)).toBeVisible({ timeout: 15000 });
      };

      await exitOnce();
      // Dismiss the exit notice — it is removed immediately, the type form stays usable.
      const dismiss = win.getByTestId(`exit-dismiss-${pid}`);
      await expect(dismiss).toBeVisible();
      await dismiss.click();
      await expect(win.getByTestId(`panel-exit-${pid}`)).toHaveCount(0);
      // The form is never left blank/unrecoverable: the type select is still usable.
      await expect(win.getByTestId(`panel-type-select-${pid}`)).toBeVisible();

      // Recurrence: a fresh exit re-shows the notice.
      await exitOnce();
      await expect(win.getByTestId(`exit-dismiss-${pid}`)).toBeVisible();
    });
  } finally {
    cleanupTemp(root);
  }
});
