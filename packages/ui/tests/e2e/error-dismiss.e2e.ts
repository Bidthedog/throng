import { basename, join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { test, expect, type Page } from '@playwright/test';
import {
  openApp,
  runApp as runOwnApp,
  createProject,
  firstPanelId,
  seedDatabase,
  cleanupTemp,
  type AppOptions,
  type OpenApp,
} from './harness.js';
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

/*
 * ONE app for three of these four tests (034 FR-045, SC-010) — 4 launches -> 2.
 *
 * Tests 1, 3 and 4 create every project THROUGH the running app, under their own temp roots, with
 * their own names — nothing is on disk before the process starts. Test 2 seeds a SQLite trigger into
 * a database and hands the app that `dataDir`, so it keeps its own launch: a seeded store cannot be
 * installed into a daemon that is already running.
 *
 * ORDER IS LOAD-BEARING, and nothing enforces it: `projectId()` takes the FIRST
 * `project-switch-` row in the sidebar, so the Projects test must remain the first test declared.
 * Do not add a project-creating test above it.
 *
 * The shim below REFUSES launch options rather than ignoring them: a swallowed `dataDir` does not
 * fail, it makes the sub-workspaces test pass against a database that was never seeded.
 *
 * Serial mode is not optional — one window, one database, one sidebar.
 */
test.describe.configure({ mode: 'serial' });

let shared: OpenApp;

/*
 * Temp roots are removed ONCE, after the app has closed — never in a per-test `finally`.
 *
 * With one app for the file, a `finally` would delete a project root the application is still
 * watching, and the failure surfaces later, in another test, as a notice nobody raised on purpose.
 */
const ownedTempDirs: string[] = [];
function ownedTemp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  ownedTempDirs.push(dir);
  return dir;
}

test.beforeAll(async () => {
  shared = await openApp();
});

test.afterAll(async () => {
  await shared?.close();
  for (const dir of ownedTempDirs.splice(0)) cleanupTemp(dir);
});

const runApp = (
  fn: (app: OpenApp['app'], win: OpenApp['win']) => Promise<void>,
  opts?: AppOptions,
): Promise<void> => {
  if (opts) {
    throw new Error(
      'this file shares one app; a test needing launch options must call runOwnApp instead',
    );
  }
  return fn(shared.app, shared.win);
};

test('Projects error: trailing-edge dismiss removes it immediately and recurs', { tag: ['@extended', '@failure'] }, async () => {
  const root = ownedTemp('throng-errdismiss-proj-');
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
});

test('Sub-workspaces error: themeable dismiss removes it immediately and recurs', { tag: ['@extended', '@failure'] }, async () => {
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
    await runOwnApp(
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

test('File Explorer error: trailing-edge dismiss removes it immediately and recurs', { tag: ['@extended', '@failure'] }, async () => {
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
    await expect
      .poll(
        async () => {
          const count = await notices.count();
          if (count > 0) await win.getByTestId('explorer-error-dismiss').first().click();
          return count;
        },
        { timeout: 6000 },
      )
      .toBe(0);

    await trigger(); // recurrence — the same failure, once dismissed, can be raised again
    await expect(win.getByTestId('explorer-error-dismiss').first()).toBeVisible();
  });
});

test('Terminal exit notice: dismiss removes it, leaves the form usable, and recurs', { tag: ['@extended', '@failure'] }, async () => {
  skipIfElevated();
  const root = ownedTemp('throng-errdismiss-term-');
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
});
