import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { openApp, cleanupTemp, settle, type AppOptions, type OpenApp } from './harness.js';
import {
  configRootSeeded,
  settleConfigRoot,
  snapshotConfigRoot,
  type ConfigRootSnapshot,
} from './helpers/config-snapshot.js';
import { closePrefsWindow } from './helpers/prefs-window.js';

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

/*
 * ONE app for this file, not one per test (034 FR-045, SC-010).
 *
 * All three tests called `freshCfgRoot()` with NO arguments and seeded nothing into it before
 * launching — the isolated root was write ISOLATION between tests, not pre-launch state. What they
 * actually need is a config root that looks untouched when each one starts, which is
 * `settleConfigRoot`'s whole job.
 *
 * ══ WHY THE RESTORE IS NOT OPTIONAL HERE ══
 *
 * The first two tests both begin by clicking `control-editor.autoSave` and polling for `true`. That
 * is a TOGGLE. Without a restore between them the second click would set it back to `false` and the
 * poll would time out — in the SETUP, before the test reached anything it is about, which is the
 * worst place for a shared-app conversion to break.
 *
 * `restoreConfigRoot` already understands the obstruction these tests use: it explicitly clears a
 * path that a test replaced with a DIRECTORY before writing the file back (`helpers/config-snapshot.ts`,
 * which names `preferences-reset` doing the same thing). Each test's own `finally` still restores,
 * because a test that leaves the config root broken for the next one should say so itself.
 *
 * ══ ORDER ══
 *
 * The main-window test runs LAST. It creates two projects, and a project is DAEMON state — the
 * config restore cannot undo it, so it goes where nothing follows it. The two preferences-window
 * tests are order-independent of each other.
 *
 * ══ AND THE PREFERENCES WINDOW IS CLOSED BETWEEN TESTS ══
 *
 * `openPrefs` polls the window list for one carrying `prefs-mode-toggle`. throng allows exactly one
 * preferences window, so a surviving one from the previous test would be found instantly — on the
 * previous test's tab, with the previous test's on-entry snapshot behind Revert, and with a JSON
 * buffer that raises `json-external-change` the moment the restore rewrites the file underneath it.
 */
test.describe.configure({ mode: 'serial' });

let shared: OpenApp;
let cfgRoot: string;
let settingsPath: string;
let baseline: ConfigRootSnapshot;

test.beforeAll(async () => {
  cfgRoot = freshCfgRoot();
  settingsPath = join(cfgRoot, 'settings.json');
  shared = await openApp({ env: { THRONG_CONFIG_ROOT: cfgRoot } });
  await settle(shared.win);
  // Snapshot only once first-run seeding has finished — settings, key bindings and every shipped
  // theme. A partial photograph would have every later restore DELETE whatever arrived late.
  await expect.poll(() => configRootSeeded(cfgRoot), { timeout: 30_000 }).toBe(true);
  baseline = snapshotConfigRoot(cfgRoot);
});

test.afterEach(async () => {
  await closePrefsWindow(shared.app);
  await settleConfigRoot(baseline);
});

test.afterAll(async () => {
  await shared?.close();
  for (const dir of cfgRoots.splice(0)) cleanupTemp(dir);
});

/**
 * The shared app, in the shape `runApp` had — plus the run's own Electron data directory, which the
 * #265 test reads `logs/main.log` out of.
 *
 * It REFUSES launch options rather than ignoring them: a swallowed config root does not fail, it
 * makes a test pass for the wrong reason.
 */
const runApp = (
  fn: (
    app: OpenApp['app'],
    win: OpenApp['win'],
    ctx: { userDataDir: string },
  ) => Promise<void>,
  opts?: AppOptions,
): Promise<void> => {
  if (opts) {
    throw new Error('this file shares one app; a test needing launch options must open its own');
  }
  return fn(shared.app, shared.win, { userDataDir: shared.userDataDir });
};

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

test('a JSON edit that could not be saved says so, instead of silently not applying (#102)', { tag: ['@extended', '@prefs'] }, async () => {
  test.setTimeout(180_000);

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
        /*
         * A valid edit, applied by LEAVING the editor (032, FR-017).
         *
         * This test used to rely on the 300 ms debounce: type, wait, and the write fired from a
         * timer whose promise nobody held — which was the whole point, because that is the path no
         * call site can attach a `.then` to. That debounce is gone: applying a half-typed value that
         * happened to parse is what pulled the document out from under the user's cursor.
         *
         * The write it produces is IDENTICAL, and so is the reason this test exists. `leaveJson`
         * commits through `writeConfig`, and the result is dropped exactly as the timer's was — the
         * commit is called from a gate that returns a boolean, not a promise, so the failure still
         * has nowhere to surface but the chokepoint. #102 is as reachable as it ever was.
         */
        const editor = prefs.getByTestId('json-editor-settings').locator('.cm-content');
        await editor.click();
        await prefs.keyboard.press('Control+A');
        await editor.pressSequentially('{ "editor": { "autoSave": false } }');
        await prefs.getByTestId('prefs-mode-toggle').click();

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
  );
});

/**
 * 032 — ONE notice, and it says WHY (#265).
 *
 * ══ WHAT WAS REPORTED ══
 *
 * A user created `settings.json` as a FOLDER, launched the app, and changed a setting. They got
 * two notices:
 *
 *     Saving your settings failed. Nothing was changed.
 *     Saving Remove a project failed. Nothing was changed.
 *
 * Three defects in one screenshot.
 *
 * **Two notices for one failed write.** `config-write-notices.ts` reports from the chokepoint every
 * write passes through, and `settings-tab.tsx:212` reports again from the call site. The chokepoint's
 * own docblock predicted they would collapse into one — "`notify` replaces a live notice carrying the
 * same [test id]" — but that is no longer how de-duplication works: 030 keys supersession on
 * `causeKey`, and neither of these carried one, so both stood.
 *
 * **The second is nonsense.** "Remove a project" is the LABEL of `confirmations.destroyProject`. The
 * call site interpolates a setting's label into a sentence shaped for an operation name, so the user
 * is told that removing a project failed when they removed nothing.
 *
 * **Neither says why.** `onConfigWriteFailed` hands the listener `(id, error)` and the listener took
 * only `id`. The real message — `EPERM: operation not permitted, rename …` — was already in the
 * renderer and was dropped on the floor, so the notice could not explain itself and there was
 * nothing to copy into a bug report.
 *
 * ══ WHY THE CALL-SITE REPORTER GOES RATHER THAN THE CHOKEPOINT ONE ══
 *
 * The call site cannot cover the debounced path — `scheduleWrite`'s timer does
 * `void writeConfig(id, json)` with no caller holding the promise — which is exactly why the
 * chokepoint reporter was built. Keeping the specific-sounding one and deleting the general one
 * would re-open #102 for every text and number edit in preferences.
 */
test('a failed settings write raises ONE notice, says why, and can be copied (#265)', { tag: ['@extended', '@prefs'] }, async () => {
  test.setTimeout(180_000);

  await runApp(
    async (app, win, { userDataDir }) => {
      const prefs = await openPrefs(app, win, 'settings');
      await expect(prefs.getByTestId('settings-tab')).toBeVisible();

      // SETUP: one ordinary edit lands, so the write path is demonstrably working here.
      await prefs.getByTestId('control-editor.autoSave').click();
      await expect
        .poll(() => JSON.parse(readFileSync(settingsPath, 'utf8'))?.editor?.autoSave, {
          timeout: 20_000,
          message: 'the first edit never reached settings.json',
        })
        .toBe(true);

      const saved = obstruct(settingsPath);
      try {
        // The reported scenario: change a setting through a discrete CONTROL, which is the path
        // that reports twice.
        await prefs.getByTestId('control-confirmations.destroyProject').selectOption('single');

        const notices = prefs.getByTestId('prefs-notice');
        await expect(notices.first()).toBeVisible({ timeout: 20_000 });

        // ── ONE notice. Not two, and not "two but one replaces the other eventually".
        await expect
          .poll(async () => notices.count(), { timeout: 5_000 })
          .toBe(1);

        const text = (await notices.first().innerText()).toLowerCase();

        // ── It must not blame an operation the user never performed.
        expect(
          text,
          'a setting\'s LABEL must not be presented as the thing that failed',
        ).not.toContain('remove a project');

        // ── It must say WHY, not merely that something failed. "Nothing was changed" is the
        //    reassurance; on its own it leaves the user with no idea what to do next.
        expect(text).toMatch(/could not|failed|unable/);
        expect(
          text.replace(/nothing was changed\.?/g, '').trim().length,
          'the notice must carry a reason beyond "nothing was changed"',
        ).toBeGreaterThan('saving your settings failed.'.length);

        // ── And the raw error is available to paste into a bug report, without being shown raw.
        await expect(prefs.getByTestId('prefs-notice-copy')).toBeVisible();
        expect(text, 'the raw errno belongs in the copy, not in the sentence').not.toContain('eperm');
        expect(text).not.toMatch(/[a-z]:\\/);

        /*
         * ── AND IT NAMES THE FILE THE USER KNOWS.
         *
         * The atomic write stages to `settings.json.2.tmp` and renames it into place. Node's rename
         * error quotes the SOURCE first, so the notice used to say `"settings.json.2.tmp" is open in
         * another program` — throng's own scratch file, which the user has never seen, cannot open
         * and cannot act on. The one fact they needed was that `settings.json` could not be written.
         */
        expect(
          text,
          "throng's staging file must never appear in a sentence shown to the user",
        ).not.toContain('.tmp');
        expect(text, 'the notice must name the document that could not be written').toContain(
          'settings.json',
        );

        /*
         * ── AND IT IS ACCURATE.
         *
         * The obstruction here is a FOLDER standing where the file should be. EPERM is ambiguous on
         * Windows — held handle, ACL refusal, or replacing a directory — and the renderer's string
         * classifier maps it straight to "is open in another program". With a folder in the way that
         * is confidently, specifically wrong, and a user who believes it goes looking for a program
         * that does not exist. The store checks the target instead of inferring from the errno.
         */
        expect(text, 'it must say what is actually wrong').toMatch(/folder/);
        expect(
          text,
          'it must not assert a cause it cannot distinguish',
        ).not.toContain('open in another program');

        /*
         * ── AND IT IS LOGGED.
         *
         * A notice the user dismisses is gone; the log is what a bug report can be reconstructed
         * from later, and it is the whole reason silencing a severity is offerable at all (FR-012:
         * *Never display* hides a failure from the SCREEN, never from the record). `copyDetail` is
         * what carries the raw system message into `NoticeLogRecord.detail`, so this asserts the
         * plumbing rather than trusting it.
         */
        await expect
          .poll(
            () => {
              try {
                return readFileSync(join(userDataDir, 'logs', 'main.log'), 'utf8');
              } catch {
                return '';
              }
            },
            { timeout: 20_000, message: 'the failure never reached the diagnostics log' },
          )
          .toMatch(/EPERM|operation not permitted|rename/i);
      } finally {
        rmSync(settingsPath, { recursive: true, force: true });
        writeFileSync(settingsPath, saved, 'utf8');
      }
    },
  );
});

/**
 * 032 US3 (T035) — the MAIN WINDOW reports a failed config write too.
 *
 * ══ THE GAP ══
 *
 * `useConfigWriteFailureNotices()` subscribes to the chokepoint every write passes through, which is
 * the right design and the reason the JSON tab, the keybindings tab and the themes tab are covered
 * without knowing it exists. But the hook is mounted in **`preferences-app.tsx` only**.
 *
 * `onConfigWriteFailed`'s listener set is module-scoped, and each window loads its own instance of
 * the module. So a write issued from the MAIN window publishes its failure into that window's
 * registry — where nothing is subscribed — and the user is told nothing at all.
 *
 * The main window really does write settings: creating a project calls `persistLastProjectFolder`
 * (`projects-panel.tsx:207`), which is the same path spec 032's US1 is about. Recorded as G-09 in
 * spec 030's FR-017 audit and named in #249's body.
 *
 * ══ WHY THIS MATTERS BEYOND TIDINESS ══
 *
 * It produces the SAME user-visible symptom as the clobber US1 fixes: "I changed something and it
 * went back." Fixing the clobber without this leaves the complaint reproducible by a second route,
 * which is how a bug gets reported as not-fixed.
 *
 * ══ EXPECTED STATE ══
 *
 * RED until the subscriber is mounted in the main window (T039) and in sub-workspace windows (T040).
 */
test('a config write that fails in the MAIN window says so (032 FR-010, G-09)', { tag: ['@extended', '@prefs'] }, async () => {
  test.setTimeout(180_000);
  /*
   * DECLARED LAST on purpose (see the shared-app note at the top): the two projects this creates are
   * DAEMON state, and the config-root restore between tests cannot undo them. Nothing follows it.
   */
  /*
   * TWO folders, and this is load-bearing rather than tidiness.
   *
   * throng enforces exclusive project roots: a folder already bound to a project cannot be bound to
   * a second one. An earlier version of this test reused one folder, so the second creation was
   * refused before it began — `persistLastProjectFolder` is only called when the save succeeded, so
   * no config write was ever attempted and the test sat waiting for a notice that had no reason to
   * exist. It read exactly like the defect it was meant to prove.
   */
  const firstRoot = mkdtempSync(join(tmpdir(), 'throng-proj-102-a-'));
  const secondRoot = mkdtempSync(join(tmpdir(), 'throng-proj-102-b-'));
  cfgRoots.push(firstRoot, secondRoot);

  await runApp(
    async (_app, win) => {
      // The previous test finished in the preferences window; `afterEach` destroyed it, and this
      // brings the main window forward so the clicks below land where they are aimed.
      await win.bringToFront();
      /*
       * SETUP: one project created normally, so `settings.json` exists and the main window's write
       * path is demonstrably working. Without this, silence below could mean "the main window never
       * writes settings" rather than "it writes and does not report the failure".
       */
      await win.getByTestId('project-new').click();
      await expect(win.getByTestId('project-form')).toBeVisible();
      await win.getByTestId('project-root-input').fill(firstRoot);
      await win.getByTestId('project-name-input').fill('First');
      await win.getByTestId('project-save').click();
      await expect(win.locator('.project-item').filter({ hasText: 'First' }).first()).toBeVisible();

      await expect
        .poll(() => JSON.parse(readFileSync(settingsPath, 'utf8'))?.newProject?.lastProjectFolder, {
          timeout: 20_000,
          message: 'the main window never wrote lastProjectFolder',
        })
        .toBeTruthy();

      const saved = obstruct(settingsPath);
      try {
        // A second project. `persistLastProjectFolder` fires, the atomic commit's rename hits the
        // directory now sitting where the file was, and the write genuinely fails with EPERM.
        await win.getByTestId('project-new').click();
        await expect(win.getByTestId('project-form')).toBeVisible();
        await win.getByTestId('project-root-input').fill(secondRoot);
        await win.getByTestId('project-name-input').fill('Second');
        await win.getByTestId('project-save').click();

        /**
         * RED — the user is TOLD, in the window they are looking at.
         *
         * The wording is matched loosely, as the JSON-tab case above does: what is asserted is that
         * SOMETHING says the write did not land, not a particular sentence.
         */
        const notice = win.getByTestId('prefs-notice');
        await expect(notice).toBeVisible({ timeout: 20_000 });
        const text = (await notice.innerText()).toLowerCase();
        expect(text).toMatch(/could not|failed|not saved|unable/);

        // Same rule as every other notice surface: no raw errno, no absolute path.
        expect(text).not.toContain('eperm');
        expect(text).not.toMatch(/[a-z]:\\/);
      } finally {
        rmSync(settingsPath, { recursive: true, force: true });
        writeFileSync(settingsPath, saved, 'utf8');
      }
    },
  );
});
