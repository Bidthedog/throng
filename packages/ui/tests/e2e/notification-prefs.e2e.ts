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
import { FILE_OP_TIMEOUT_MS,
  cleanupTemp,
  createProject,
  openApp,
  settle,
  stayedAbsent,
  type AppOptions,
  type OpenApp,
} from './harness.js';
import {
  configRootSeeded,
  settleConfigRoot,
  snapshotConfigRoot,
  type ConfigRootSnapshot,
} from './helpers/config-snapshot.js';
import { closePrefsWindow } from './helpers/prefs-window.js';

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

/*
 * ONE app for every test here (034 FR-045, SC-010; the sixth, which seeded a pre-030 settings file and kept
 * its own launch, moved to integration in the test-suite audit — the paragraph below describes it as it was).
 * Originally: five of six tests — 6 launches -> 2.
 *
 * Five called `freshCfgRoot()` with no argument: write isolation, not pre-launch state, and
 * `restoreConfigRoot` provides that between tests. The sixth SEEDS a pre-030 settings.json before
 * launch and asserts what STARTUP does with it, so it keeps `runOwnApp` — a launch that cannot be
 * shared, stated rather than worked around.
 *
 * The shim below REFUSES launch options rather than ignoring them: a swallowed config root does not
 * fail, it makes a test pass for the wrong reason. That is exactly the mistake the seeded test would
 * otherwise make.
 *
 * Serial mode is not optional — one window, one config root, one preferences window.
 */
test.describe.configure({ mode: 'serial' });

let shared: OpenApp;
let cfgRoot: string;
let dataDir: string;
let baseline: ConfigRootSnapshot;

test.beforeAll(async () => {
  cfgRoot = freshCfgRoot();
  // Captured (rather than left to openApp's own default) so the "Dismiss only" test below can poll
  // the daemon's SQLite store directly for a persisted rename, instead of sleeping past its debounce.
  dataDir = mkdtempSync(join(tmpdir(), 'throng-data-notice-prefs-'));
  shared = await openApp({ dataDir, env: { THRONG_CONFIG_ROOT: cfgRoot } });
  await settle(shared.win);
  await expect.poll(() => configRootSeeded(cfgRoot), { timeout: 30_000 }).toBe(true);
  baseline = snapshotConfigRoot(cfgRoot);
});

/*
 * Close the preferences window, THEN restore the config root.
 *
 * The restore is what keeps every shipped-default assertion in this file meaning what it meant
 * against a pristine app — `:153` reads all of them, and another test leaves `error` at
 * `{ timed, 30000 }`. Closing first is what lets the next `waitForEvent('window')` fire, and what
 * stops a restore landing under an open window.
 */
test.afterEach(async () => {
  await closePrefsWindow(shared.app);
  // `settleConfigRoot`, not a bare restore: the preferences editors write on a DEBOUNCE, so a test
  // whose last assertion is about the screen can finish with a write still in flight. It would land
  // after the restore and poison the next test — the class of leak `dcdcb46` reverted three
  // conversions for. This restores, waits, re-diffs, and throws NAMING the drifting paths, charged
  // to the `afterEach` of the test that leaked rather than to whichever test ran next.
  await settleConfigRoot(baseline, 5_000);
});

/*
 * Project roots the WARNING test creates, removed once — after the app has closed.
 *
 * `cfgRoots` already worked this way. A project root did not: it was deleted in that test's own
 * `finally`, which under one app for the file removes a folder the application is still WATCHING.
 * That is the class `dcdcb46` reverted three conversions for, and here it would have fired into the
 * test after it as an explorer failure nobody raised on purpose.
 */
const ownedRoots: string[] = [];

test.afterAll(async () => {
  await shared?.close();
  cleanupTemp(dataDir);
  for (const dir of cfgRoots.splice(0)) cleanupTemp(dir);
  for (const dir of ownedRoots.splice(0)) cleanupTemp(dir);
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
  // sleep-justified: the renderer's own uptake of the hot-reload broadcast is unobservable from outside except by raising a notice under it, which is exactly what every caller does next.
  await win.waitForTimeout(500);
}

/**
 * A fence for `stayedAbsent`: has the notice log recorded this raise?
 *
 * A *Never display* notice renders nothing on screen, but 030 FR-005/FR-008 requires the record to
 * reach `logs/main.log` regardless — `notice-logging.e2e.ts` proves the write happens for a
 * silenced severity — so its arrival is proof the raise was actually processed and the decision to
 * say nothing on screen was actually made, not merely that nothing has happened yet.
 */
async function noticeLogged(userDataDir: string, pattern: RegExp): Promise<void> {
  await expect
    .poll(
      () => {
        try {
          return readFileSync(join(userDataDir, 'logs', 'main.log'), 'utf8')
            .split(/\r?\n/)
            .some((line) => line.includes('[renderer-notice]') && pattern.test(line));
        } catch {
          return false; // the file may not exist yet
        }
      },
      { timeout: 15_000, message: `no [renderer-notice] record matching ${String(pattern)}` },
    )
    .toBe(true);
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

/*
 * TWO TESTS REMOVED (035) — now `packages/ui/tests/component/preferences-settings-search.test.ts`,
 * which already mounts `SettingsTab` under its three providers. Both launched Electron and opened a
 * SECOND WINDOW to read this tab's own markup and one confirmation.
 *
 * THE FIRST'S OWN COMMENT SAYS WHY IT MATTERS, and that half is kept verbatim in spirit: its value
 * assertion "passed for months while the dropdown read Never / Timed / Dismiss", because every other
 * test in this file drives the STORED TOKEN and nothing ever read the words on screen. The component
 * version asserts the visible text, and adds the count — a fifth severity, or a severity with a mode
 * and no duration, is the drift a per-severity surface accumulates and neither test could see.
 *
 * FOUR THINGS THE RED STEP CORRECTED, all of them mine and all worth recording:
 *
 *   - The duration leaf is `timeoutMs`, not `durationMs`, and it renders TWO controls (a slider and
 *     a number field).
 *   - That file runs on FAKE TIMERS for its debounce, so every `findBy*` await hung to the 5s test
 *     timeout. The dialog is raised synchronously inside the change handler, so a sync query is both
 *     correct and stronger.
 *   - The consequence assertion `/report nothing|not be shown|never/i` against the whole dialog
 *     proved nothing: the TITLE is "Never display error notices?", so the alternation matched before
 *     the message was consulted. Replacing the entire message with "Are you sure?" left it green.
 *   - "Declining leaves the setting unchanged" proved nothing either, because that mount has no
 *     config bridge and the select could never change. The discriminating observable is the WRITE —
 *     through `writePatch`, not `write`, which is a third thing a spy had to be told.
 *
 * And one assertion is new: SUCCESS is not asked about either. The migrated test checked `info`;
 * `success` is the same bargain and had no test at all.
 *
 * WHAT STAYS. Everything below that needs a real clock or a real config file: a timed notice
 * expiring, a dismiss-mode notice NOT expiring, a mode setting gating whether a raised notice
 * renders, and a pre-030 settings file resolving to defaults.
 */

test('Never display shows nothing at all, and Dismiss only shows it again in the same session (FR-012, FR-016)', { tag: ['@extended', '@prefs'] }, async () => {
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
      await expect.poll(() => readSettings(cfgRoot)?.notifications?.error?.mode, { timeout: FILE_OP_TIMEOUT_MS }).toBe('never');
      await appliedInMainWindow(win, (n) => n?.error?.mode, 'never');

      await raiseErrorNotice(win);
      // The project really did open — so the failure really was raised. The FENCE below is the
      // record it still wrote to `logs/main.log` even though "never" suppressed it on screen (030
      // FR-005/FR-008) — proof the opportunity to display it has actually passed, not a guess at
      // how long that takes.
      await expect(win.locator('.project-item[data-active="true"]')).toContainText('Ghost2');
      await stayedAbsent(
        () => noticeLogged(shared.userDataDir, /severity=error.*ghost2/i),
        () => notices.count(),
        'a suppressed error notice for ghost2',
      );

      // ── FR-016 / T014a: the change applies to the NEXT notice raised in this SAME session.
      // Nothing is reloaded, relaunched or reopened between here and the notice below.
      await prefs.getByTestId('control-notifications.error.mode').selectOption('dismiss');
      await expect.poll(() => readSettings(cfgRoot)?.notifications?.error?.mode, { timeout: FILE_OP_TIMEOUT_MS }).toBe('dismiss');
      await appliedInMainWindow(win, (n) => n?.error?.mode, 'dismiss');

      await raiseErrorNotice(win);
      await expect(notices).toHaveCount(1, { timeout: 20_000 });
      await expect(notices).toContainText('ghost3');
    },
  );
});

/*
 * DELETED (test-suite audit, pass 1):
 *   - "Display for N takes an ERROR notice away after N, and NOT before (FR-004, FR-012)" — the timer is
 *     `component/notice-dismissal-timer.test.ts` (a fake clock: still present short of N, gone once N elapses),
 *     the mode reaching the provider and gating a real notice is the test above, and a Preferences slider
 *     persisting a bounded numeric is `preferences-slider.e2e.ts` (FR-033).
 *   - "a pre-030 settings file opens with its preferences intact and no configuration error (FR-014, SC-014)" —
 *     MOVED DOWN to `integration/config-store.integration.test.ts` ("a settings file with no notifications section
 *     resolves to the shipped defaults and keeps the user’s own values"), which reads a real seeded config root
 *     through `readConfigOnce`, the function startup calls.
 */

/*
 * REMOVED (048) — "Dismiss only outlives any timeout, asserted on a WARNING". Its warning was the daemon's
 * panel-name-adjusted notice, raised when a TYPED panel name collided with another; panels cannot be renamed
 * any more, so nothing raises that notice. The claim itself (no timer is ever armed for `dismiss`, at any
 * severity) is `component/notice-dismissal-timer.test.ts`, which a fake clock makes stronger than a real wait.
 */

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
/*
 * MOVED to `packages/ui/tests/component/preferences-number-control.test.ts` (034 FR-045):
 *   - "the duration control is inert unless the mode is Display for (FR-011)"
 *   - "a duration below 3000 or above 30000 cannot be committed (FR-010)"
 *
 * Both are about the numeric control alone: its bounds, and its `disabled` state when the mode
 * beside it takes its meaning away. Being INERT rather than hidden is the requirement — a control
 * that vanishes takes its explanation with it, and the user cannot see that the duration is still
 * there waiting for the mode that uses it — and "shown but disabled" is a DOM fact.
 *
 * This file was measured at 60.8 seconds, among the ten slowest in the suite. What remains is what
 * earns that: real notices appearing, surviving a dismissal, and vanishing on a real timer.
 */
