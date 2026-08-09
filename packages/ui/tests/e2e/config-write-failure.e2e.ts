import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { runApp, cleanupTemp } from './harness.js';

/**
 * #102 — a config write that FAILS must tell the user.
 *
 * ══ THE DEFECT ══
 *
 * `writeConfig` returns a truthful `{ ok: false, error }` — #99 fixed that, and with it the silent
 * DATA LOSS underneath this. What #99 deliberately left alone is that **nothing reads the answer**.
 * Every preferences caller discards it: `void writeConfig(...)`, `void apply.applyNow(...)`, and so
 * on across seven call sites. So the failure mode moved from "we lied and lost your edit" to "we
 * know it failed and do not mention it".
 *
 * The user changes a setting, the row shows the new value, the file never changes, and they find out
 * when the preference is not there tomorrow.
 *
 * ══ WHY THE FIX CANNOT BE AT THE CALL SITES ══
 *
 * The debounced path — every text and number edit — fires through `scheduleWrite`, whose timer does
 * `void writeConfig(id, json)`. There is no caller holding that promise and no component still
 * mounted to hold it: the module keeps the registry precisely so an orphaned write still settles.
 * A call-site fix cannot reach it. `write-config.ts` says so itself: "THE CHOKEPOINT IS THE DESIGN.
 * Every config write goes through `writeConfig`."
 *
 * ══ WHAT IS ALREADY FIXED, AND WHAT IS NOT ══
 *
 * Measured before writing this, because #102's list is out of date. The settings tab's discrete
 * controls DO report now — a toggle whose write fails says "Saving auto-save failed. Nothing was
 * changed." — and so does the reset path (`preferences-reset.e2e.ts`). Those two are done.
 *
 * Still silent: the JSON tab, the keybindings tab, the themes tab, and preferences-app's revert-all
 * loop. This spec drives the JSON tab, which is the one that matters most, because it is the one a
 * call-site fix cannot reach: its edits go through `scheduleWrite`, whose timer does
 * `void writeConfig(id, json)` with no caller holding the promise and no component guaranteed to
 * still be mounted. `write-config.ts` states the consequence itself — "THE CHOKEPOINT IS THE DESIGN.
 * Every config write goes through `writeConfig`" — so the chokepoint is where this has to be fixed,
 * and fixing it there covers the other three for free.
 */

const cfgRoots: string[] = [];
function freshCfgRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'throng-cfg-102-'));
  cfgRoots.push(dir);
  return dir;
}
test.afterAll(() => {
  for (const dir of cfgRoots.splice(0)) cleanupTemp(dir);
});

/** Open the preferences window on `tab` and return its page (as `preferences-reset.e2e.ts` does). */
async function openPrefs(
  app: ElectronApplication,
  win: Page,
  tab: 'settings' | 'keybindings' | 'themes',
): Promise<Page> {
  await win.bringToFront();
  await win.getByTestId('title-bar-cog').click();
  await win.getByTestId(`cog-menu-${tab}`).click();

  let prefs: Page | undefined;
  await expect
    .poll(
      async () => {
        for (const page of app.windows()) {
          if (page === win || page.isClosed()) continue;
          if ((await page.getByTestId('prefs-mode-toggle').count()) > 0) {
            prefs = page;
            return true;
          }
        }
        return false;
      },
      { timeout: 20_000, message: 'the preferences window never appeared' },
    )
    .toBe(true);
  return prefs as Page;
}

/**
 * Make `settings.json` unwritable the only way Windows reliably allows: replace it with a NON-EMPTY
 * directory, so the atomic commit's rename fails with a real EPERM.
 *
 * The same technique `config-write-durability.test.ts` and `preferences-reset.e2e.ts` use — this is
 * a genuine failure of the real write path, not a stub that returns false.
 */
function obstruct(path: string): string {
  const saved = readFileSync(path, 'utf8');
  rmSync(path, { force: true });
  mkdirSync(path, { recursive: true });
  writeFileSync(join(path, 'blocker.txt'), 'x', 'utf8');
  return saved;
}

test('a JSON edit that could not be saved says so, instead of silently not applying (#102)', async () => {
  test.setTimeout(180_000);
  const cfgRoot = freshCfgRoot();
  const settingsPath = join(cfgRoot, 'settings.json');

  await runApp(
    async (app, win) => {
      const prefs = await openPrefs(app, win, 'settings');
      await expect(prefs.getByTestId('settings-tab')).toBeVisible();

      // SETUP: an ordinary edit lands, so settings.json exists and the write path demonstrably
      // works here. Without it, the silence below could be "writes never worked" rather than #102.
      await prefs.getByTestId('control-editor.autoSave').click();
      await expect
        .poll(() => JSON.parse(readFileSync(settingsPath, 'utf8'))?.editor?.autoSave, {
          timeout: 20_000,
          message: 'the first edit never reached settings.json',
        })
        .toBe(true);

      await prefs.getByTestId('prefs-mode-toggle').click();
      await expect(prefs.getByTestId('json-tab-settings')).toBeVisible();

      const saved = obstruct(settingsPath);
      try {
        // A valid edit, through the DEBOUNCED path — `scheduleWrite` fires ~300ms later and the
        // promise it creates is held by nobody.
        const editor = prefs.getByTestId('json-editor-settings').locator('.cm-content');
        await editor.click();
        await prefs.keyboard.press('Control+A');
        await editor.pressSequentially('{ "editor": { "autoSave": false } }');

        /**
         * RED — the user is TOLD the edit did not save.
         *
         * Wording matched loosely: what is asserted is that SOMETHING says so, rather than the
         * buffer sitting there showing a document the file does not have.
         */
        const notice = prefs.getByTestId('prefs-notice');
        await expect(notice).toBeVisible({ timeout: 20_000 });
        const text = (await notice.innerText()).toLowerCase();
        expect(text).toMatch(/could not|failed|not saved|unable/);

        // And it carries no raw errno — 029's rule, on the same notice surface.
        expect(text).not.toContain('eperm');
        expect(text).not.toMatch(/[a-z]:\\/);
      } finally {
        // Put the file back so teardown is clean whatever happened above.
        rmSync(settingsPath, { recursive: true, force: true });
        writeFileSync(settingsPath, saved, 'utf8');
      }
    },
    { env: { THRONG_CONFIG_ROOT: cfgRoot } },
  );
});
