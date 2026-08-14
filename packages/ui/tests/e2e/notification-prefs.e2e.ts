/**
 * 030 US1 (#224) — the USER decides whether a notice appears, and for how long.
 *
 * ══ WHY THIS SPEC EXISTS ══
 *
 * Today severity governs persistence and nothing else does: `notification.tsx:225` reads
 * `if (input.severity !== 'error')` and arms a timer for the hardcoded `AUTO_DISMISS_MS`, so an
 * error persists forever and everything else vanishes after five seconds. Neither half is the
 * user's to change. A notice that disappeared before it was read is indistinguishable from one
 * that never happened, which is the defect #224 reports.
 *
 * ══ WHY `error` SPECIFICALLY, IN THE "Display for N" CASE ══
 *
 * `error` is the ONE severity hard-coded to persist. A *Display for N* test written against `info`
 * or `success` would pass on master — those already auto-dismiss — while the exemption survived
 * untouched, and FR-012/US1 AC6 exist precisely to remove it. So the timed case below is asserted
 * on `error`, and nothing else will do.
 *
 * ══ TIER ══
 *
 * SERIAL (`parallel-plan.json`). It opens the Preferences window, which takes focus, and throng
 * closes menus and popups on blur — a second headed app sharing the desktop loses its menus
 * underneath it. Its sibling `notice-logging.e2e.ts` seeds the same settings through the config
 * root instead and therefore stays parallel; see its header.
 *
 * ══ STATE OF THE IMPLEMENTATION WHEN THIS WAS WRITTEN ══
 *
 * The eight `group: 'Notifications'` descriptors (T019) and the settings parse (T017/T018) have
 * landed, so the FIRST test below passes: it pins the surface these later tests drive. Everything
 * after it describes T020 (the inert timeout control), T021 (the confirmation) and T025–T027a (the
 * `NotificationProvider` rewrite), none of which exists yet.
 */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import {
  addPanels,
  cleanupTemp,
  createProject,
  panelIds,
  runApp,
  setSlider,
  settle,
} from './harness.js';

/**
 * Each test opens the Preferences window AND drives the main window's workspace — a project
 * creation, a panel rename, a deliberate wait past `AUTO_DISMISS_MS`. That is comfortably past the
 * 30s default, and a budget exceeded is reported as an unnamed timeout rather than as the
 * assertion that was actually waiting.
 */
test.describe.configure({ timeout: 120_000 });

const cfgRoots: string[] = [];
function freshCfgRoot(seed?: Record<string, unknown>): string {
  const dir = mkdtempSync(join(tmpdir(), 'throng-cfg-notice-prefs-'));
  cfgRoots.push(dir);
  if (seed) writeFileSync(join(dir, 'settings.json'), JSON.stringify({ version: 1, ...seed }), 'utf8');
  return dir;
}
test.afterAll(() => {
  for (const dir of cfgRoots.splice(0)) cleanupTemp(dir);
});

function readSettings(cfgRoot: string): Record<string, any> | null {
  try {
    return JSON.parse(readFileSync(join(cfgRoot, 'settings.json'), 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Wait until the MAIN WINDOW is actually running under the new notification settings.
 *
 * `readSettings` observes the FILE, and that is main's write completing — which is emphatically not
 * the same event as the window that raises the notice running under it. The config watcher re-reads
 * the document and rebroadcasts it afterwards (measured at ~45 ms here), and only then does the main
 * window's provider adopt it.
 *
 * Polling the file and driving the window immediately gets both halves of this wrong at once. The
 * notice is raised against the OLD mode; and the project-creation path serialises the WHOLE settings
 * document from the main window's own copy (`projects-panel.tsx`, `persistLastProjectFolder`), so a
 * copy that is still stale writes the user's edit straight back out. The file then says what was
 * asked for while the application is doing something else — measured, and the reason this helper
 * exists rather than a longer timeout on the assertion.
 */
async function appliedInMainWindow(
  win: Page,
  pick: (notifications: any) => unknown,
  expected: unknown,
): Promise<void> {
  await expect
    .poll(async () => {
      const settings = await win.evaluate(async () => {
        const payload = await window.throng?.config?.get?.();
        return (payload?.settings ?? null) as Record<string, any> | null;
      });
      return pick(settings?.notifications);
    })
    .toEqual(expected);
  // `config.get()` reflects MAIN's copy, which is set in the same call that broadcasts to the
  // windows — not by a window receiving it. One settle for the renderer to re-render under it.
  await win.waitForTimeout(500);
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

/**
 * A real, CLASSIFIED error notice in the MAIN window, raised without touching a menu.
 *
 * A project pointed at a folder that does not exist: the explorer's first listing fails with
 * `ENOENT … realpath`, which `speakFailure` classifies as `path-missing`, so the notice carries a
 * message, a `causeKey` and the raw errno in `copyDetail`. Each call uses a distinct folder name,
 * which gives a distinct message and a distinct cause key — neither the identical-content rule nor
 * `shouldSuppressForCause` can collapse two of them, so "a second notice did not appear" always
 * means the display mode suppressed it.
 */
let ghosts = 0;
async function raiseErrorNotice(win: Page): Promise<string> {
  ghosts += 1;
  const name = `Ghost${ghosts}`;
  await createProject(win, name, `C:/throng-e2e-missing/${name.toLowerCase()}`);
  return name;
}

/** Rename a panel through its header, WITHOUT a context menu (double-click opens the box). */
async function renamePanel(win: Page, panelId: string, to: string): Promise<void> {
  await win.getByTestId(`panel-handle-${panelId}`).dblclick();
  const input = win.getByTestId(`panel-rename-input-${panelId}`);
  await expect(input).toBeVisible();
  await input.fill(to);
  // Asserted present above: a blind Enter would land on whatever holds focus.
  await input.press('Enter');
  await expect(input).toHaveCount(0);
}

const SEVERITIES = ['error', 'warning', 'info', 'success'] as const;

test('the Notifications category offers a mode and a bounded duration for all four severities', async () => {
  const cfgRoot = freshCfgRoot();
  await runApp(
    async (app, win) => {
      const prefs = await openSettings(app, win);

      // The category exists, and it holds one ROW PER SEVERITY of each kind — four modes and four
      // durations. Eight leaves is the whole of the user-facing surface #224 asks for.
      await expect(prefs.getByTestId('settings-group-Notifications')).toBeVisible();
      for (const severity of SEVERITIES) {
        const mode = prefs.getByTestId(`control-notifications.${severity}.mode`);
        await expect(mode).toBeVisible();
        /*
         * Three modes, exhaustive by design — and each one CALLED WHAT FR-001 CALLS IT.
         *
         * The value assertion below was the whole of this test, and it passed for months while the
         * dropdown read "Never / Timed / Dismiss": the stored token is what every other test in this
         * file drives (`selectOption('never')`), so nothing anywhere ever looked at the words on the
         * screen. The user does not read `never`. Asserting the visible text is the only thing that
         * can tell the difference between the specified names and the generic Title-Case fallback.
         */
        for (const [value, text] of [
          ['never', 'Never display'],
          ['timed', 'Display for'],
          ['dismiss', 'Dismiss only'],
        ] as const) {
          const option = mode.locator(`option[value="${value}"]`);
          await expect(option).toHaveCount(1);
          await expect(option, `the ${value} option is not called "${text}"`).toHaveText(text);
        }
        // A bounded numeric is a SLIDER in this app, and the bounds are the parse's own — a control
        // offering a value the parser would silently replace is issue #227 all over again.
        const slider = prefs.getByTestId(`control-notifications.${severity}.timeoutMs-slider`);
        await expect(slider).toHaveAttribute('min', '3000');
        await expect(slider).toHaveAttribute('max', '30000');
        /*
         * The STEP, and the shipped default sitting exactly on it.
         *
         * A slider whose grid steps past the value the app shipped with is a control the user cannot
         * undo with the control itself — drag once and Reset (or the JSON file) is the only way back.
         * 3000 + 4×500 = 5000 and 3000 + 14×500 = 10000, which is what the 3000/30000 range bought
         * and what 1500/60000 made arithmetically impossible.
         */
        await expect(slider).toHaveAttribute('step', '500');
        // The FIELD groups anything of five digits or more (`formatGrouped`), so `info`'s 10000 reads
        // "10,000" and a bare `Number()` on it is NaN. Strip what the display added.
        const shownMs = await prefs
          .getByTestId(`control-notifications.${severity}.timeoutMs`)
          .inputValue();
        const shipped = Number(shownMs.replace(/[^0-9]/g, ''));
        expect((shipped - 3000) % 500, `${severity} ships ${shipped} ms, between two stops`).toBe(0);
      }

      // The shipped defaults (FR-013): a failure waits to be acknowledged, a confirmation does not.
      await expect(prefs.getByTestId('control-notifications.error.mode')).toHaveValue('dismiss');
      await expect(prefs.getByTestId('control-notifications.warning.mode')).toHaveValue('dismiss');
      await expect(prefs.getByTestId('control-notifications.info.mode')).toHaveValue('timed');
      await expect(prefs.getByTestId('control-notifications.success.mode')).toHaveValue('timed');
    },
    { env: { THRONG_CONFIG_ROOT: cfgRoot } },
  );
});

test('Never display shows nothing at all, and Dismiss only shows it again in the same session (FR-012, FR-016)', async () => {
  const cfgRoot = freshCfgRoot();
  await runApp(
    async (app, win) => {
      await settle(win);
      const prefs = await openSettings(app, win);
      const notices = win.getByTestId('explorer-error');

      // ── Baseline: with the shipped default the failure is reported and STAYS reported.
      await raiseErrorNotice(win);
      await expect(notices).toHaveCount(1, { timeout: 20_000 });
      await expect(notices).toContainText('could not be found');
      await win.getByTestId('explorer-error-dismiss').click();
      await expect(notices).toHaveCount(0);

      // ── Never display: the same class of failure now says nothing on screen.
      await prefs.getByTestId('control-notifications.error.mode').selectOption('never');
      // `error` is a severity whose silence has to be consented to (FR-008); accept it here — the
      // confirmation ITSELF is the subject of the next test, not this one.
      const confirmed = prefs.getByTestId('confirm-dialog');
      if (await confirmed.isVisible().catch(() => false)) {
        await confirmed.getByRole('button').last().click();
      }
      await expect.poll(() => readSettings(cfgRoot)?.notifications?.error?.mode).toBe('never');
      await appliedInMainWindow(win, (n) => n?.error?.mode, 'never');

      await raiseErrorNotice(win);
      // The project really did open — so the failure really was raised, and the empty notice list
      // below is a decision rather than an unrendered DOM.
      await expect(win.locator('.project-item[data-active="true"]')).toContainText('Ghost2');
      await win.waitForTimeout(2000);
      await expect(notices).toHaveCount(0);

      // ── FR-016 / T014a: the change applies to the NEXT notice raised in this SAME session.
      // Nothing is reloaded, relaunched or reopened between here and the notice below.
      await prefs.getByTestId('control-notifications.error.mode').selectOption('dismiss');
      await expect.poll(() => readSettings(cfgRoot)?.notifications?.error?.mode).toBe('dismiss');
      await appliedInMainWindow(win, (n) => n?.error?.mode, 'dismiss');

      await raiseErrorNotice(win);
      await expect(notices).toHaveCount(1, { timeout: 20_000 });
      await expect(notices).toContainText('ghost3');
    },
    { env: { THRONG_CONFIG_ROOT: cfgRoot } },
  );
});

/**
 * The two dwells this test uses, and why the pair of them is the assertion (FR-004).
 *
 * The first version of this test set the floor and asserted the notice was gone within ten seconds.
 * That is satisfied by the floor, by 5000, by "whatever constant the provider was arming before this
 * feature", and by every value under ten seconds — so the requirement it claimed to cover, *leaves
 * once N has elapsed*, was never measured, and a regression that armed every timed notice at one
 * hard-coded duration would have stayed green.
 *
 * Two dwells, at opposite ends of the allowed range, in one session, remove that. A hypothetical
 * constant C has to satisfy both: C < SHORT_BUDGET to clear the first, C > STILL_UP_AFTER to clear
 * the second. `C < 8000` and `C > 15000` cannot both hold, so no constant passes — only a provider
 * actually reading the user's number does.
 */
const SHORT_MS = 3_000; // the floor of the allowed range, and on the slider's 500 grid
const SHORT_BUDGET = 8_000; // generous over 3000, and comfortably under STILL_UP_AFTER
const LONG_MS = 30_000; // the ceiling
const STILL_UP_AFTER = 15_000; // …so a notice armed at anything short would already have gone

test('Display for N takes an ERROR notice away after N, and NOT before (FR-004, FR-012)', async () => {
  test.setTimeout(180_000);
  const cfgRoot = freshCfgRoot();
  await runApp(
    async (app, win) => {
      await settle(win);
      const prefs = await openSettings(app, win);

      // ── N at the FLOOR of the allowed range.
      const mode = prefs.getByTestId('control-notifications.error.mode');
      await mode.selectOption('timed');
      /*
       * The CONTROL took it — asserted separately from the file below, so the next failure says
       * which half broke.
       *
       * Measured once in a full serial run: the poll on `settings.json` expired with the mode still
       * `dismiss`, its default, and the same test passed 5/5 in isolation. That leaves two very
       * different explanations — the dropdown never registered the change, or it did and the write
       * was lost or reverted — and the file poll alone cannot tell them apart. It is not a longer
       * timeout: a slow write and a lost write must not look the same, which is exactly what
       * widening the budget would arrange. Tracked separately; this only makes the evidence land.
       */
      await expect(mode, 'the mode dropdown did not take the selection').toHaveValue('timed');
      await setSlider(
        prefs.getByTestId('control-notifications.error.timeoutMs-slider'),
        String(SHORT_MS),
      );
      await expect.poll(() => readSettings(cfgRoot)?.notifications?.error?.mode).toBe('timed');
      await expect.poll(() => readSettings(cfgRoot)?.notifications?.error?.timeoutMs).toBe(SHORT_MS);
      await appliedInMainWindow(win, (n) => n?.error, { mode: 'timed', timeoutMs: SHORT_MS });

      const notices = win.getByTestId('explorer-error');
      await raiseErrorNotice(win);
      // It appears — the timed mode does not mean "never shown".
      await expect(notices).toHaveCount(1, { timeout: 20_000 });
      const shownAt = Date.now();
      // …and then it goes, unaided. On master an `error` waits forever, which is the exemption
      // FR-012 removes.
      await expect(notices).toHaveCount(0, { timeout: SHORT_BUDGET });
      // Reported rather than merely bounded: a dwell creeping towards the budget is the early sign
      // of the timer being armed from something other than the setting.
      const dwelt = Date.now() - shownAt;
      expect(dwelt, `a ${SHORT_MS} ms notice stood for ${dwelt} ms`).toBeLessThan(SHORT_BUDGET);

      // ── The same code path, N at the CEILING (FR-016: it applies to the next notice raised).
      await setSlider(
        prefs.getByTestId('control-notifications.error.timeoutMs-slider'),
        String(LONG_MS),
      );
      await expect.poll(() => readSettings(cfgRoot)?.notifications?.error?.timeoutMs).toBe(LONG_MS);
      await appliedInMainWindow(win, (n) => n?.error, { mode: 'timed', timeoutMs: LONG_MS });

      await raiseErrorNotice(win);
      await expect(notices).toHaveCount(1, { timeout: 20_000 });
      // Still there long after the previous dwell — and long after any plausible hard-coded one.
      // This is the half that makes the first half mean something.
      await win.waitForTimeout(STILL_UP_AFTER);
      await expect(
        notices,
        `a ${LONG_MS} ms notice left within ${STILL_UP_AFTER} ms — the timer is not the user's number`,
      ).toHaveCount(1);
    },
    { env: { THRONG_CONFIG_ROOT: cfgRoot } },
  );
});

/**
 * FR-014 / SC-014 — A SETTINGS FILE WRITTEN BEFORE THIS FEATURE STILL OPENS.
 *
 * `parseNotificationSettings` is total and `display-mode.test.ts` proves it on every malformed value
 * anyone could think of. That is the unit half, and it was the whole of the coverage: nothing
 * anywhere started the APPLICATION over a document with no `notifications` section, which is the
 * only place the two halves of the requirement can both be observed. FR-014 has two halves and says
 * so — the file loads and resolves to the shipped defaults, AND it raises no error notice about the
 * configuration. A parse that resolved correctly while some other layer complained about the missing
 * section would satisfy a unit test and fail the requirement, and nothing would have said so.
 *
 * The seeded document is what a user upgrading into 030 actually has: `version: 1`, no notification
 * preferences at all, and settings they had already changed from the shipped defaults. Both must
 * still be theirs afterwards — an upgrade that "worked" by resetting the file would pass a test that
 * only looked at the notifications.
 */
test('a pre-030 settings file opens with its preferences intact and no configuration error (FR-014, SC-014)', async () => {
  const cfgRoot = freshCfgRoot({
    editor: { autoSave: true, autoSaveDebounceMs: 900 },
  });
  // Stated rather than assumed: the seed has to be genuinely pre-030 for the test to mean anything.
  expect(readSettings(cfgRoot)?.notifications).toBeUndefined();

  await runApp(
    async (app, win) => {
      await settle(win);

      // ── The absent section resolves to the shipped defaults (FR-013), in the running application
      // and not merely in a parse.
      await appliedInMainWindow(win, (n) => n, {
        error: { mode: 'dismiss', timeoutMs: 5000 },
        warning: { mode: 'dismiss', timeoutMs: 5000 },
        info: { mode: 'timed', timeoutMs: 10000 },
        success: { mode: 'timed', timeoutMs: 5000 },
      });

      // ── …and the preferences the user had already set are still theirs (SC-014).
      const editor = await win.evaluate(async () => {
        const payload = await window.throng?.config?.get?.();
        return (payload?.settings as Record<string, any> | undefined)?.editor ?? null;
      });
      expect(editor?.autoSave).toBe(true);
      expect(editor?.autoSaveDebounceMs).toBe(900);

      // ── NOTHING WAS REPORTED. This is the half FR-014 states explicitly and the half a parse test
      // structurally cannot see: an upgrade the user has to dismiss a notice about is not a
      // successful load, whatever the resolved values say.
      const prefs = await openSettings(app, win);
      await expect(prefs.getByTestId('settings-group-Notifications')).toBeVisible();
      await expect(prefs.getByTestId('control-notifications.error.mode')).toHaveValue('dismiss');
      // The user's own values, on the surface they would go looking at.
      await expect(prefs.getByTestId('control-editor.autoSave')).toBeChecked();

      for (const [where, page] of [
        ['the main window', win],
        ['the preferences window', prefs],
      ] as const) {
        // `.notice--error` and not `.notice`: FR-014's words are "raising no ERROR notice about the
        // configuration", and pinning the absence of every toast would make this fail for reasons
        // that have nothing to do with the requirement.
        await expect(
          page.locator('.notice--error'),
          `an error notice was raised in ${where} over a settings file with no notification section`,
        ).toHaveCount(0);
      }
      await expect(prefs.getByTestId('prefs-notice')).toHaveCount(0);
    },
    { env: { THRONG_CONFIG_ROOT: cfgRoot } },
  );
});

test('Dismiss only outlives any timeout — asserted on a WARNING, which auto-vanishes today (FR-012)', async () => {
  const root = mkdtempSync(join(tmpdir(), 'throng-notice-prefs-warn-'));
  const cfgRoot = freshCfgRoot();
  try {
    await runApp(
      async (app, win) => {
        await settle(win);
        const prefs = await openSettings(app, win);
        // The shipped default for `warning` IS Dismiss only (FR-013) — pinned here because the
        // whole assertion rests on it.
        await expect(prefs.getByTestId('control-notifications.warning.mode')).toHaveValue('dismiss');

        // A real warning: two panels, one name. The daemon adjusts the second and says so once.
        await createProject(win, 'WarnProj', root);
        await addPanels(win, 1);
        const ids = await panelIds(win);
        expect(ids.length).toBeGreaterThanOrEqual(2);
        await renamePanel(win, ids[0]!, 'Build');
        // The daemon grants names from the PERSISTED layouts, and the layout write is debounced —
        // ask the second panel for "Build" too soon and the name is not taken yet, so nothing is
        // adjusted and no warning is raised. Without this wait the test fails at "no notice", which
        // reads as the notice model being broken when the rename simply succeeded.
        await win.waitForTimeout(1500);
        await renamePanel(win, ids[1]!, 'Build');
        // The ADJUSTMENT is the event. Asserted here so a producer that did not fire is reported as
        // a producer that did not fire, and never as a missing notice.
        await expect(win.getByTestId(`panel-title-${ids[1]!}`)).toHaveText('Build (2)');

        const notice = win.getByTestId('panel-name-adjusted');
        await expect(notice).toBeVisible({ timeout: 15_000 });
        await expect(notice).toHaveClass(/notice--warning/);

        // Past `AUTO_DISMISS_MS` (5000) with room to spare. On master the timer is armed for every
        // severity but `error`, so this warning is gone by now whatever Preferences says.
        await win.waitForTimeout(7000);
        await expect(notice).toBeVisible();

        // Dismiss only still means dismissABLE.
        await win.getByTestId('panel-name-adjusted-dismiss').click();
        await expect(notice).toHaveCount(0);
      },
      { env: { THRONG_CONFIG_ROOT: cfgRoot } },
    );
  } finally {
    cleanupTemp(root);
  }
});

test('the duration control is inert unless the mode is Display for (FR-011)', async () => {
  const cfgRoot = freshCfgRoot();
  await runApp(
    async (app, win) => {
      const prefs = await openSettings(app, win);
      const mode = prefs.getByTestId('control-notifications.error.mode');
      // BOTH halves of the control: `NumberControl` renders a range input AND a typed field, and a
      // disabled thumb beside a live text box is not an inert control.
      const slider = prefs.getByTestId('control-notifications.error.timeoutMs-slider');
      const field = prefs.getByTestId('control-notifications.error.timeoutMs');

      // Dismiss only (the shipped default for `error`): the duration means nothing.
      await expect(mode).toHaveValue('dismiss');
      await expect(slider).toBeDisabled();
      await expect(field).toBeDisabled();

      // Display for: it is the only mode the number has a meaning in.
      await mode.selectOption('timed');
      await expect(slider).toBeEnabled();
      await expect(field).toBeEnabled();

      // Never display: inert again.
      await mode.selectOption('never');
      const confirmed = prefs.getByTestId('confirm-dialog');
      if (await confirmed.isVisible().catch(() => false)) {
        await confirmed.getByRole('button').last().click();
      }
      await expect(slider).toBeDisabled();
      await expect(field).toBeDisabled();
    },
    { env: { THRONG_CONFIG_ROOT: cfgRoot } },
  );
});

test('a duration below 3000 or above 30000 cannot be committed (FR-010)', async () => {
  const cfgRoot = freshCfgRoot();
  await runApp(
    async (app, win) => {
      const prefs = await openSettings(app, win);
      // The field only accepts input in the mode that uses it, so put it there first.
      await prefs.getByTestId('control-notifications.error.mode').selectOption('timed');
      const field = prefs.getByTestId('control-notifications.error.timeoutMs');
      await expect(field).toBeEnabled();

      for (const rejected of ['2999', '30001']) {
        await field.fill(rejected);
        await field.press('Enter');
        await expect(prefs.getByTestId('control-notifications.error.timeoutMs-invalid')).toBeVisible();
        // Not applied: the settings file keeps the last valid value.
        expect(readSettings(cfgRoot)?.notifications?.error?.timeoutMs ?? 5000).toBe(5000);
      }

      /*
       * …and ANY value inside the bounds commits — the grid belongs to the slider, not to the
       * setting (FR-010).
       *
       * 3567 is on no stop of a 500 ms slider, and that is the point: the bound is the contract and
       * the step is an affordance, so typing an exact number the thumb cannot land on is a first-
       * class way to set this. It must reach the settings file unrounded and STAY there — a control
       * that quietly snapped it to 3500 would be answering a question the user did not ask.
       */
      await field.fill('3567');
      await field.press('Enter');
      await expect.poll(() => readSettings(cfgRoot)?.notifications?.error?.timeoutMs).toBe(3567);
      /*
       * Still 3567 after the write has been read back in — the round trip through the config
       * watcher is where a rounding parse would show up, and where the field would be re-rendered
       * from the stored value if it had been changed.
       *
       * Asserted on the DIGITS, not the exact string: the field renders through `formatGrouped`, so
       * whether this reads "3567" or "3,567" depends on the digit-grouping threshold, which is a
       * separate question from whether the value survived. Pinning the punctuation here would make
       * this test fail for a reason that has nothing to do with FR-010.
       */
      await prefs.waitForTimeout(1000);
      await expect
        .poll(async () => (await field.inputValue()).replace(/[^0-9]/g, ''))
        .toBe('3567');
      expect(readSettings(cfgRoot)?.notifications?.error?.timeoutMs).toBe(3567);
    },
    { env: { THRONG_CONFIG_ROOT: cfgRoot } },
  );
});

/**
 * T014 — turning an ERROR off is a consequence a user consents to; turning `info` off is not.
 *
 * FR-008's confirmation is what makes *Never display* offerable at all: the user is told, in the
 * moment, that a failed operation will report nothing on screen. Declining must leave the mode
 * exactly as it was — a dialog that changes the setting whichever button you press is worse than
 * no dialog, because it looks like a choice.
 *
 * Declined with Escape rather than a named button: Escape is the documented dismissal on this
 * dialog (`confirm-dialog.tsx` settles it as DISMISSED) and it does not pre-decide a testid for a
 * control that has not been written yet.
 */
test('choosing Never display for an error asks first, and declining changes nothing (FR-008)', async () => {
  const cfgRoot = freshCfgRoot();
  await runApp(
    async (app, win) => {
      const prefs = await openSettings(app, win);
      const errorMode = prefs.getByTestId('control-notifications.error.mode');

      await errorMode.selectOption('never');
      const dialog = prefs.getByTestId('confirm-dialog');
      await expect(dialog).toBeVisible();
      // It names the CONSEQUENCE — "are you sure?" asks the user to confirm a word, not an outcome.
      await expect(dialog).toContainText(/report nothing|not be shown|never/i);

      await prefs.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);
      // Unchanged, on screen and on disk.
      await expect(errorMode).toHaveValue('dismiss');
      await prefs.waitForTimeout(500);
      expect(readSettings(cfgRoot)?.notifications?.error?.mode ?? 'dismiss').toBe('dismiss');

      // `warning` asks too — a partly-failed operation reporting nothing is the same bargain.
      await prefs.getByTestId('control-notifications.warning.mode').selectOption('never');
      await expect(prefs.getByTestId('confirm-dialog')).toBeVisible();
      await prefs.keyboard.press('Escape');
      await expect(prefs.getByTestId('confirm-dialog')).toHaveCount(0);

      // `info` does NOT: there is no failure to miss, so a prompt would be nagging.
      await prefs.getByTestId('control-notifications.info.mode').selectOption('never');
      await expect.poll(() => readSettings(cfgRoot)?.notifications?.info?.mode).toBe('never');
      await expect(prefs.getByTestId('confirm-dialog')).toHaveCount(0);
    },
    { env: { THRONG_CONFIG_ROOT: cfgRoot } },
  );
});
