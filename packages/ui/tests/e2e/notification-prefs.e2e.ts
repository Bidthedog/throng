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
import Database from 'better-sqlite3';
import { test, expect } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { FILE_OP_TIMEOUT_MS,
  addPanels,
  cleanupTemp,
  createProject,
  openApp,
  panelIds,
  runApp as runOwnApp,
  setSlider,
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
 * ONE app for five of these six tests (034 FR-045, SC-010) — 6 launches -> 2.
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

/**
 * Poll the daemon's own SQLite store for a persisted layout matching `predicate` — the layout the
 * PANEL-NAME service actually reads (`panel-name-service.ts`'s `claim` goes through
 * `workspaceStore.load`, never an in-memory registry), so this is the real condition a debounced
 * write's caller needs, rather than a duration standing in for it. Mirrors
 * `persistence-restore.e2e.ts`'s (unexported) `expectLayoutSaved`.
 */
async function expectLayoutPersisted(
  projectName: string,
  predicate: (layoutJson: string) => boolean,
): Promise<void> {
  await expect
    .poll(
      () => {
        let db: InstanceType<typeof Database> | undefined;
        try {
          db = new Database(join(dataDir, 'throng.db'), { readonly: true });
          const row = db
            .prepare(
              `SELECT w.layout_json AS json
                 FROM workspace_layout w
                 JOIN projects p ON p.id = w.project_id
                WHERE p.name = ?`,
            )
            .get(projectName) as { json?: string } | undefined;
          return row?.json !== undefined && predicate(row.json);
        } catch {
          return false; // not written yet, or a transient read of a mid-write DB
        } finally {
          db?.close();
        }
      },
      { timeout: 15_000, message: `the layout for "${projectName}" was never persisted` },
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

/**
 * The two dwells this test uses, and why the pair of them is the assertion (FR-004).
 *
 * The first version of this test set the floor and asserted the notice was gone within ten seconds.
 * That is satisfied by the floor, by 5000, by "whatever constant the provider was arming before this
 * feature", and by every value under ten seconds — so the requirement it claimed to cover, *leaves
 * once N has elapsed*, was never measured, and a regression that armed every timed notice at one
 * hard-coded duration would have stayed green.
 *
 * Two dwells, at opposite ends of the allowed range, used to remove that — but only the SHORT one
 * still waits real time here. A hypothetical constant C had to satisfy both: C < SHORT_BUDGET to
 * clear the first, C > 15000 (the old `STILL_UP_AFTER` margin) to clear the second, and `C < 8000`
 * and `C > 15000` cannot both hold — so no constant passed either check. The LONG half of that pair
 * (034 FR-045/SC-008) moved to `packages/ui/tests/component/notice-dismissal-timer.test.ts`, which
 * proves it with a fake clock using these SAME two numbers (`LONG_MS` and its own `STILL_UP_AFTER`):
 * still present 15000 ms in, gone once `LONG_MS` itself elapses — the positive half no real-time wait
 * here ever proved. What stays real-time is that a genuine Preferences slider drag reaching `LONG_MS`
 * and a REAL error notice both actually happen; what no longer waits real seconds is "and it survived
 * N of them", which needs no window to prove.
 */
const SHORT_MS = 3_000; // the floor of the allowed range, and on the slider's 500 grid
const SHORT_BUDGET = 8_000; // generous over 3000, and comfortably under the old 15000 ms margin
const LONG_MS = 30_000; // the ceiling — mirrored in notice-dismissal-timer.test.ts

test('Display for N takes an ERROR notice away after N, and NOT before (FR-004, FR-012)', { tag: ['@extended', '@prefs'] }, async () => {
  test.setTimeout(180_000);
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
      await expect.poll(() => readSettings(cfgRoot)?.notifications?.error?.mode, { timeout: FILE_OP_TIMEOUT_MS }).toBe('timed');
      await expect.poll(() => readSettings(cfgRoot)?.notifications?.error?.timeoutMs, { timeout: FILE_OP_TIMEOUT_MS }).toBe(SHORT_MS);
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
      await expect.poll(() => readSettings(cfgRoot)?.notifications?.error?.timeoutMs, { timeout: FILE_OP_TIMEOUT_MS }).toBe(LONG_MS);
      await appliedInMainWindow(win, (n) => n?.error, { mode: 'timed', timeoutMs: LONG_MS });

      await raiseErrorNotice(win);
      await expect(notices).toHaveCount(1, { timeout: 20_000 });
      /*
       * "…and it is still there 15000 ms in, and gone once LONG_MS itself elapses" — the half that
       * makes the SHORT case above mean something — is no longer waited out here in real time. 034
       * FR-045/SC-008: `notice-dismissal-timer.test.ts` proves both ends of that with a fake clock,
       * against this SAME `LONG_MS`, and goes further than any real-time wait could — an hour past a
       * `dismiss`-mode notice's non-existent timer, not fifteen seconds past a `timed` one's. What
       * this Electron window still proves, and only it can: that a real Preferences slider drag
       * actually reaches `NotificationProvider` and a real error notice actually renders under it —
       * both asserted above, with no wait needed for either.
       */
    },
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
test('a pre-030 settings file opens with its preferences intact and no configuration error (FR-014, SC-014)', { tag: ['@extended', '@prefs'] }, async () => {
  const cfgRoot = freshCfgRoot({
    editor: { autoSave: true, autoSaveDebounceMs: 900 },
  });
  // Stated rather than assumed: the seed has to be genuinely pre-030 for the test to mean anything.
  expect(readSettings(cfgRoot)?.notifications).toBeUndefined();

  await runOwnApp(
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

test('Dismiss only outlives any timeout — asserted on a WARNING, which auto-vanishes today (FR-012)', { tag: ['@extended', '@prefs'] }, async () => {
  // Registered, not deleted here: under one app this root is watched for the rest of the file.
  const root = mkdtempSync(join(tmpdir(), 'throng-notice-prefs-warn-'));
  ownedRoots.push(root);
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
      // The daemon grants names from the PERSISTED layouts (`panel-name-service.ts`'s `claim` reads
      // straight through `workspaceStore.load`, never an in-memory registry) and the write is
      // debounced — ask the second panel for "Build" before the first rename has actually reached
      // the store and nothing is taken yet, so nothing is adjusted and no warning is raised. Poll the
      // store itself rather than asserting a duration is always long enough for the debounce plus
      // its IPC round trip.
      await expectLayoutPersisted('WarnProj', (json) => json.includes('"title":"Build"'));
      await renamePanel(win, ids[1]!, 'Build');
      // The ADJUSTMENT is the event. Asserted here so a producer that did not fire is reported as
      // a producer that did not fire, and never as a missing notice.
      await expect(win.getByTestId(`panel-title-${ids[1]!}`)).toHaveText('Build (2)');

      const notice = win.getByTestId('panel-name-adjusted');
      await expect(notice).toBeVisible({ timeout: 15_000 });
      await expect(notice).toHaveClass(/notice--warning/);

      /*
       * On master (pre-030) the timer was armed for every severity but `error`, so this warning would
       * have been gone by `AUTO_DISMISS_MS` (5000) whatever Preferences said. That NO timer is ever
       * armed for `mode: 'dismiss'` — at any severity, for any duration, an hour included — is proven
       * with a fake clock in `notice-dismissal-timer.test.ts` ("Dismiss only never arms a timer,
       * whatever the severity", 034 FR-045/SC-008), so this spec no longer waits real seconds to
       * gesture at the same fact. What stays here, and only Electron can prove it: that a REAL
       * panel-rename collision through the real daemon raises a real `warning` notice under the
       * shipped `dismiss` default, and that it is still dismissible — both asserted around this.
       */

      // Dismiss only still means dismissABLE.
      await win.getByTestId('panel-name-adjusted-dismiss').click();
      await expect(notice).toHaveCount(0);
    },
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
