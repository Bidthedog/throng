/**
 * 032 US1 (#249, #260) — a change the user made stays made.
 *
 * ══ WHAT THIS REPRODUCES ══
 *
 * Every configuration write goes through one chokepoint that takes the WHOLE document, already
 * serialised. A caller changing one key therefore rebuilds the entire document from whatever copy it
 * holds. The Preferences window and the main window each hold their own, refreshed only by the config
 * watcher's broadcast — so a write issued from one window inside that refresh gap reverts every key
 * the other window just changed.
 *
 * Concretely, and this is the whole test: change `notifications.error.mode` in Preferences, then
 * create a project in the main window before the broadcast lands. `persistLastProjectFolder`
 * (`projects-panel.tsx:207`) serialises the whole settings document from the main window's stale
 * React copy, and the notification mode goes back to what it was.
 *
 * ══ WHY THE TIMING IS THE TEST, AND WHY `createProject()` CANNOT BE USED ══
 *
 * The gap is reported at ~45 ms in #249. The `createProject` harness helper performs four UI
 * interactions — click New, fill root, fill name, click Save — which takes far longer than that, so
 * the broadcast lands mid-helper and the clobber never happens. A test written the obvious way passes
 * on broken code.
 *
 * So the form is filled FIRST and left open. Only then is the preference changed, and only then is
 * Save clicked. That puts exactly one click between the two writes, which is the tightest window
 * Playwright can produce without reaching into the app.
 *
 * ══ THE HELPER THAT PROVES THIS IS REAL ══
 *
 * `notification-prefs.e2e.ts:90` has a local helper, `appliedInMainWindow()`, whose entire job is to
 * wait until the main window has ADOPTED new settings before driving it. Its docstring names
 * `persistLastProjectFolder` and the stale copy outright:
 *
 *     "the project-creation path serialises the WHOLE settings document from the main window's own
 *      copy, so a copy that is still stale writes the user's edit straight back out"
 *
 * That helper is this test inverted. It exists because the defect is real, and it is why the suite
 * has never caught it: five tests in that file politely wait for the race to be over.
 *
 * ══ THE VALUE THIS TEST CHOOSES, AND WHY IT IS NOT `never` ══
 *
 * It selects `timed`, and that is load-bearing rather than arbitrary.
 *
 * The first version of this test selected **`never`**, and `never` is the one value on this setting
 * that raises a CONSENT DIALOG first (030 FR-008: a failure that stops reporting itself has to be
 * agreed to). Nothing in the test answered that dialog, so no write was ever issued — and the
 * assertion failed because the value never arrived at all, not because anything clobbered it.
 *
 * That test was then run ten times, came back red ten times out of ten, and was accepted as a
 * confirmed reproduction. **The confirmation was worthless.** A test that fails for a different
 * reason than the reported one is indistinguishable from a real reproduction when you are only
 * looking at the exit code, and it goes green the moment almost anything changes. It is the exact
 * trap the repo's testing rule exists to prevent, walked into while following that rule.
 *
 * `timed` needs no consent, so the write actually happens and the race is actually run.
 *
 * The deterministic proof of the same guarantee lives at the integration layer, where it does not
 * depend on winning a ~45 ms race with a Playwright click:
 * `config-write-concurrency.test.ts` and the 1,000-write soak in `config-write-soak.test.ts`.
 *
 * ══ EXPECTED STATE ══
 *
 * RED on master. Green once the write carries the change rather than the document. If it is
 * intermittent rather than reliably red, it is not a reproduction — see tasks.md T005, which requires
 * 10 failures out of 10 before this is accepted, because a test that is red 6 runs in 10 is a new
 * flake being introduced deliberately.
 *
 * ══ TIER ══
 *
 * SERIAL (`parallel-plan.json`). It opens the Preferences window, which takes focus, and throng
 * closes menus and popups on blur.
 */
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { cleanupTemp, runApp, settle } from './harness.js';

/** Opening Preferences, filling a form and racing a write comfortably exceeds the 30s default. */
test.describe.configure({ timeout: 120_000 });

const temps: string[] = [];
function freshDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  temps.push(dir);
  return dir;
}
test.afterAll(() => {
  for (const dir of temps.splice(0)) cleanupTemp(dir);
});

function readSettings(cfgRoot: string): Record<string, any> | null {
  try {
    return JSON.parse(readFileSync(join(cfgRoot, 'settings.json'), 'utf8'));
  } catch {
    return null;
  }
}

/** Open the preferences window on the Settings tab and return its Page. */
async function openSettings(app: ElectronApplication, win: Page): Promise<Page> {
  await win.getByTestId('title-bar-cog').click();
  const [prefs] = await Promise.all([
    app.waitForEvent('window'),
    win.getByTestId('cog-menu-settings').click(),
  ]);
  await prefs.waitForLoadState('domcontentloaded');
  await settle(prefs, '.prefs-root');
  await expect(prefs.getByTestId('settings-tab')).toBeVisible();
  return prefs;
}

test('a Preferences change survives a project created in the main window (FR-001, #249)', { tag: ['@extended', '@prefs'] }, async () => {
  const cfgRoot = freshDir('throng-cfg-write-integrity-');
  const projectRoot = freshDir('throng-proj-write-integrity-');

  await runApp(
    async (app, win) => {
      await settle(win);
      const prefs = await openSettings(app, win);

      const mode = prefs.getByTestId('control-notifications.error.mode');
      await expect(mode).toHaveValue('dismiss'); // the shipped default

      // ── Arm the main window's write FIRST. The form is filled but NOT submitted, so the only
      //    thing left between the preference change and `persistLastProjectFolder` is one click.
      await win.getByTestId('project-new').click();
      await expect(win.getByTestId('project-form')).toBeVisible();
      await win.getByTestId('project-root-input').fill(projectRoot);
      await win.getByTestId('project-name-input').fill('Clobber');

      // ── The user's change.
      await mode.selectOption('timed');

      // ── Immediately: the main window writes the whole settings document from its own copy, which
      //    at this instant still says `dismiss`. No wait here — a wait is what hides the defect.
      await win.getByTestId('project-save').click();
      await expect(win.locator('.project-item').filter({ hasText: 'Clobber' }).first()).toBeVisible();

      // ── The project was created…
      expect(readSettings(cfgRoot)?.newProject?.lastProjectFolder).toBeTruthy();

      // ── …and the user's preference is still what they chose. On master it has reverted to
      //    'dismiss', with nothing on screen to say so.
      await expect
        .poll(() => readSettings(cfgRoot)?.notifications?.error?.mode, { timeout: 5_000 })
        .toBe('timed');

      // ── And it is not merely on disk: the window the notice would be raised in agrees.
      await expect
        .poll(async () =>
          win.evaluate(async () => {
            const payload = await window.throng?.config?.get?.();
            return (payload?.settings as any)?.notifications?.error?.mode;
          }),
        )
        .toBe('timed');

      /*
       * ── CROSS-WINDOW CONVERGENCE (G3's second half, FR-003).
       *
       * A main-process test structurally cannot reach this: it can prove the DISK converges, but
       * "and the outcome is the same in every open window" needs two real renderers. Both windows
       * are open right here, so this is the one place it can be asserted.
       *
       * The Preferences window is the one that issued the change; the main window learned about it
       * through the broadcast. If they disagreed, the user would see the old value in one window
       * and the new one in the other — which is the same complaint as the revert, arriving by a
       * different route.
       */
      await expect(mode, 'the window that issued the change must still show it').toHaveValue('timed');

      // ── The main window's copy converged on the same value, without either window rewriting the
      //    other's key. `lastProjectFolder` is the main window's own key and must have survived too.
      expect(readSettings(cfgRoot)?.newProject?.lastProjectFolder).toBeTruthy();
    },
    { env: { THRONG_CONFIG_ROOT: cfgRoot } },
  );
});

/**
 * FR-006 / US1 scenario 4 — a changed setting is what LOADS after a restart.
 *
 * A separate `runApp` against the SAME config root, because that is what a restart is. Asserting it
 * inside the first app would only prove the value is in memory, which is the half that was never in
 * doubt: #260's complaint is that a change "is lost and never arrives", and a user who restarts to
 * check is the commonest way that gets noticed.
 */
test('a changed setting is what loads after a restart (FR-006)', { tag: ['@extended', '@prefs'] }, async () => {
  const cfgRoot = freshDir('throng-cfg-write-restart-');

  await runApp(
    async (app, win) => {
      await settle(win);
      const prefs = await openSettings(app, win);
      const mode = prefs.getByTestId('control-notifications.error.mode');
      await expect(mode).toHaveValue('dismiss');
      await mode.selectOption('timed');
      await expect
        .poll(() => readSettings(cfgRoot)?.notifications?.error?.mode, { timeout: 5_000 })
        .toBe('timed');
    },
    { env: { THRONG_CONFIG_ROOT: cfgRoot } },
  );

  // A second launch, same config root. Nothing carries over but the file.
  await runApp(
    async (app, win) => {
      await settle(win);
      const prefs = await openSettings(app, win);
      await expect(
        prefs.getByTestId('control-notifications.error.mode'),
        'the setting the user changed must be what loads',
      ).toHaveValue('timed');
    },
    { env: { THRONG_CONFIG_ROOT: cfgRoot } },
  );
});
