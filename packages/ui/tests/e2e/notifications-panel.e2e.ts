import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { cleanupTemp, runApp, settle } from './harness.js';

/**
 * 068 US3/US4 — the Notifications panel across windows and across a restart.
 *
 * Layer: E2E — two real renderers and a real relaunch. The store's ordering, limit and corrupt-file
 * rules are `integration/notification-store.integration.test.ts`, the IPC shapes
 * `contract/notifications-ipc.contract.test.ts`, the panel's rendering and actions
 * `component/notifications-panel.test.ts`, and minimise `component/vertical-panel-stack-minimise.test.ts`.
 * What none of them can see: a notice raised in the PREFERENCES window reaching the MAIN window's
 * panel (FR-030), and the entry and the minimised state still there after the app is closed and
 * started again on the same user data (FR-031, FR-038).
 *
 * Own app per launch (`runApp` with a fixed `userDataDir`), because the second half needs the same
 * user data folder across two launches. Opens Preferences, so it is in `parallel-plan.json` (FOCUS).
 */

const temps: string[] = [];
function freshDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  temps.push(dir);
  return dir;
}
test.afterAll(() => {
  for (const dir of temps) cleanupTemp(dir);
});

/** Open Preferences on the Settings tab and return its page. */
async function openSettings(app: ElectronApplication, win: Page): Promise<Page> {
  await win.bringToFront();
  await win.getByTestId('title-bar-cog').click();
  const [prefs] = await Promise.all([app.waitForEvent('window'), win.getByTestId('cog-menu-settings').click()]);
  await prefs.waitForLoadState('domcontentloaded');
  await expect(prefs.getByTestId('settings-tab')).toBeVisible();
  return prefs;
}

/** Show the right pane, which starts hidden with no project open. */
async function showRightPane(win: Page): Promise<void> {
  const show = win.getByTestId('pane-show-right');
  if ((await show.count()) > 0) await show.click();
  await expect(win.getByTestId('notifications-panel')).toBeVisible();
}

/**
 * Make `settings.json` unwritable: replace it with a non-empty directory, so the atomic commit's
 * rename fails for real (the technique `config-write-failure.e2e.ts` uses). Returns the saved text.
 */
function obstruct(path: string): string {
  const saved = readFileSync(path, 'utf8');
  rmSync(path, { force: true });
  mkdirSync(path, { recursive: true });
  writeFileSync(join(path, 'blocker.txt'), 'x', 'utf8');
  return saved;
}

function unobstruct(path: string, saved: string): void {
  rmSync(path, { recursive: true, force: true });
  writeFileSync(path, saved, 'utf8');
}

test('a kept notice raised in Preferences reaches the main window panel, and it and the minimised panel survive a restart (FR-030, FR-031, FR-038)', { tag: ['@core', '@persistence', '@reserve:window'] }, async () => {
  test.setTimeout(240_000);
  const userDataDir = freshDir('throng-ud-notifications-');
  const cfgRoot = freshDir('throng-cfg-notifications-');
  const settingsPath = join(cfgRoot, 'settings.json');
  const env = { THRONG_CONFIG_ROOT: cfgRoot };

  await runApp(
    async (app, win) => {
      await settle(win);
      await showRightPane(win);
      await expect(win.getByTestId('notification-entry')).toHaveCount(0);

      const prefs = await openSettings(app, win);
      // An ordinary edit lands first, so settings.json exists and the write path works here.
      await prefs.getByTestId('control-editor.autoSave').click();
      await expect
        .poll(() => JSON.parse(readFileSync(settingsPath, 'utf8'))?.editor?.autoSave, { timeout: 20_000 })
        .toBe(true);

      // A JSON edit that cannot be saved raises an ERROR in the Preferences window — whose shipped
      // mode is "Toast and keep in panel" (FR-021c).
      await prefs.getByTestId('prefs-mode-toggle').click();
      await expect(prefs.getByTestId('json-tab-settings')).toBeVisible();
      const saved = obstruct(settingsPath);
      try {
        const editor = prefs.getByTestId('json-editor-settings').locator('.cm-content');
        await editor.click();
        await prefs.keyboard.press('Control+A');
        await editor.pressSequentially('{ "editor": { "autoSave": false } }');
        await prefs.getByTestId('prefs-mode-toggle').click();
        await expect(prefs.getByTestId('prefs-notice')).toBeVisible({ timeout: 20_000 });
      } finally {
        unobstruct(settingsPath, saved);
      }

      // FR-030: the MAIN window's panel holds it, though the main window raised nothing.
      const entries = win.getByTestId('notification-entry');
      await expect(entries).toHaveCount(1, { timeout: 20_000 });
      await expect(entries.first().getByTestId('notification-message')).toContainText(/could not|failed|not saved|unable/i);

      // FR-059, FR-060: the count is every entry not yet dismissed, beside the title, open or minimised.
      await expect(win.getByTestId('notifications-pending-badge')).toHaveText('1');
      // FR-038: minimise the panel; the badge beside the title is unchanged.
      await win.getByTestId('notifications-minimise').click();
      await expect(win.getByTestId('notifications-restore')).toBeVisible();
      await expect(win.getByTestId('notifications-pending-badge')).toHaveText('1');
    },
    { userDataDir, env },
  );

  // FR-031, FR-038: a fresh launch on the same user data — the entry and the minimised state are back.
  await runApp(
    async (_app, win) => {
      await settle(win);
      const show = win.getByTestId('pane-show-right');
      if ((await show.count()) > 0) await show.click();
      await expect(win.getByTestId('notifications-restore')).toBeVisible({ timeout: 20_000 });
      await expect(win.getByTestId('notifications-pending-badge')).toHaveText('1');
      await win.getByTestId('notifications-restore').click();
      // FR-059: restoring the panel does not clear the count.
      await expect(win.getByTestId('notifications-pending-badge')).toHaveText('1');
      await expect(win.getByTestId('notification-entry')).toHaveCount(1, { timeout: 20_000 });
    },
    { userDataDir, env },
  );
});
