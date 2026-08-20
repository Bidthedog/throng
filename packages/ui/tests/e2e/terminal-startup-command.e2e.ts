import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import {
  openApp,
  createProject as newProject,
  firstPanelId,
  cleanupTemp,
  type AppOptions,
  type OpenApp,
} from './harness.js';

/*
 * ONE app for this file, not one per test.
 *
 * Each test used to launch its own Electron app, daemon and window — roughly two seconds apiece — to
 * run assertions that never needed a pristine app. Only a test whose claim is ABOUT THE STARTUP PATH
 * genuinely does, and no test in this file is; see `launch-sharing.md` for where that line falls.
 *
 * The shims below exist so the test bodies below are unchanged:
 *   runApp        runs the body against the shared window. It refuses options rather than ignoring
 *                 them: a dropped config root does not fail, it passes for the wrong reason.
 *   createProject appends a counter, because a shared app accumulates projects and duplicate names
 *                 make `.project-item` ambiguous.
 *
 * Serial mode is required — shared window, shared database — and it means a failure skips the rest
 * rather than running them against whatever state the failure left behind.
 */
test.describe.configure({ mode: 'serial' });

let shared: OpenApp;
test.beforeAll(async () => {
  shared = await openApp();
});
test.afterAll(async () => {
  await shared?.close();
});

const runApp = (
  fn: (app: OpenApp['app'], win: OpenApp['win'], ctx: { pipeName: string; userDataDir: string }) => Promise<void>,
  opts?: AppOptions,
): Promise<void> => {
  if (opts) {
    throw new Error(
      'this file shares one app; a test needing launch options must import `runApp` from ./harness.js directly',
    );
  }
  return fn(shared.app, shared.win, {
    pipeName: shared.pipeName,
    userDataDir: shared.userDataDir,
  });
};

let projectSeq = 0;
const createProject = (win: OpenApp['win'], name: string, root: string): Promise<void> =>
  newProject(win, `${name}-${(projectSeq += 1)}`, root);

/**
 * 025 — Startup Commands, command memory, and the user-defined-flavour launch gap (#113).
 *
 * The last of these is why this file exists at all: `terminal-flavours.e2e.ts` says in its own
 * header "No terminal launches yet (that is Phase C)", and Phase C never added one — so nothing
 * in the suite has ever proven a user-defined flavour can actually start a terminal. This feature
 * adds a per-flavour command recipe to that same launch chain, so the gap is closed here.
 */

/** A user flavour pointing at a real executable every Windows machine has, under a distinct id
 *  so it cannot be confused with the built-in `cmd`. No fixture binary, no machine assumptions. */
const USER_FLAVOUR = {
  id: 'my-cmd',
  label: 'My CMD',
  file: 'C:\\Windows\\System32\\cmd.exe',
  args: [],
  defaultShellArguments: '',
  commandRecipe: ['/K', '{command}'],
};

/*
 * ══ A SECOND APP, SHARED BY THE TWO TESTS THAT GENUINELY NEED ONE (SC-027) — 3 -> 2 ══
 *
 * FR-042 and FR-043 both need an app that read `terminals.flavours` from settings.json at
 * STARTUP: a user-defined flavour has to exist before the launch chain can be asked to use it,
 * so this is real pre-launch seeding and neither can join the shared app above. They wrote the
 * SAME document into two temp roots and launched twice, which is one launch more than the fact
 * they are proving needs.
 *
 * Opened lazily rather than in a `beforeAll`, so the four tests that do not need it never pay
 * for it — and never pay for it at all when this file is run with a `--grep` that excludes them.
 *
 * Both tests leave a LIVE SHELL behind. That is already this file's shape (tests 2, 3 and 6 do
 * the same in the shared app) — but it is the reason their project roots move to `afterAll`:
 * a shell sitting in a directory that is deleted under it is the failure this file must not add.
 */
let seeded: OpenApp | undefined;
const seededRoots: string[] = [];
const ownSeeded = (dir: string): string => {
  seededRoots.push(dir);
  return dir;
};

const runSeeded = async (
  fn: (app: OpenApp['app'], win: OpenApp['win']) => Promise<void>,
): Promise<void> => {
  if (!seeded) {
    const cfg = ownSeeded(mkdtempSync(join(tmpdir(), 'throng-cfgroot-')));
    writeFileSync(
      join(cfg, 'settings.json'),
      JSON.stringify({ terminals: { flavours: [USER_FLAVOUR] } }, null, 2),
      'utf8',
    );
    seeded = await openApp({ env: { THRONG_CONFIG_ROOT: cfg } });
  }
  return fn(seeded.app, seeded.win);
};

test.afterAll(async () => {
  await seeded?.close();
  seeded = undefined;
  for (const dir of seededRoots.splice(0)) cleanupTemp(dir);
});

/*
 * ══ THREE TESTS LEFT HERE (034 FR-045/FR-046) — 6 declarations → 3 ══
 *
 * 1. MOVED — "the form offers Shell Arguments, Startup Command and the memory checkbox
 *    (FR-001/FR-002/FR-015)" → `packages/ui/tests/component/terminal-panel-type-inputs.test.ts`.
 *
 *    It launched nothing. It opened the panel type form and read four DOM states off it, and
 *    that is `TerminalInputs` deciding what to render. The component version lands STRONGER in
 *    one place the E2E could not reach: it asserts the two fields carry DIFFERENT descriptions,
 *    which is the actual content of FR-002 — the rename happened because "Startup Params" and
 *    "Startup Command" shared a word and were confused for each other, and two elements both
 *    being present says nothing about that.
 *
 * 2. DELETED — "a startup command runs and leaves an interactive prompt behind (FR-004/FR-005)".
 *
 *    `terminal-startup-command-flavours.e2e.ts` asserts the identical pair for `cmd` and for
 *    three other shells besides: it fills a marker echo, waits for the marker in the terminal,
 *    and asserts `panel-type-select-<pid>` has count 0 so the shell is still alive. Same flavour,
 *    same two claims, same wording in its own comment ("a wrong recipe … would have closed it,
 *    reverting the panel to its type-selection form"). This was the single-flavour original the
 *    table-driven file was written to replace, and replacing it was never finished.
 *
 * 3. DELETED — "an empty startup command behaves exactly as before (FR-006)".
 *
 *    Its two assertions were `term` is visible, and `term` does NOT contain STARTUP_MARKER_OK.
 *    The second cannot fail: nothing in this app run ever writes that marker into THIS panel,
 *    and since the file moved to a shared app it is a different panel from the one that did.
 *    What survives of the claim lives in two stronger places — `launch-spec-command.test.ts`
 *    ("changes NOTHING when the startup command is empty (FR-006)") asserts the empty-command
 *    spec is byte-for-byte the no-command spec with no `writeOnReady`, and `terminal-revert.e2e.ts`
 *    starts a cmd terminal with no startup command and waits for the project root IN THE PROMPT,
 *    which is a live shell rather than merely a painted view.
 *
 *    THE LEAST CONFIDENT OF THE FOUR DELETIONS, and flagged as such: the E2E carried FR-006 in
 *    its title while only the unit test carries the requirement. Restoring it is cheap if the
 *    reviewer disagrees.
 *
 * ANTI-VACUITY CONTROL for the replacement: make `stubBridge` resolve `[]`. `renderForm` awaits
 * `findByTestId('terminal-flavour')`, which only exists once a non-empty flavour list has
 * loaded, so all 4 component tests fail before any assertion of their own runs.
 *
 * WHAT STAYS, and why: the two user-defined-flavour launches (FR-042/FR-043) start a real shell
 * from a flavour that exists only in settings.json — the launch gap #113 records — and the
 * pre-fill test (FR-007a) ends a live shell from inside and reads what the panel remembered
 * afterwards. Both are PTY fidelity, which Principle V reserves.
 */

test('a USER-DEFINED flavour actually launches — the gap #113 records (FR-042)', { tag: ['@extended', '@terminal', '@reserve:pty'] }, async () => {
  const root = ownSeeded(mkdtempSync(join(tmpdir(), 'throng-025-userflav-')));
  try {
    await runSeeded(
      async (_app, win) => {
        await createProject(win, 'UserLaunch', root);
        const pid = await firstPanelId(win);
        await win.getByTestId(`panel-type-select-${pid}`).selectOption('terminal');
        const flavour = win.getByTestId('terminal-flavour');
        await expect(flavour.locator('option[value="my-cmd"]')).toHaveCount(1);
        await flavour.selectOption('my-cmd');
        await win.getByTestId(`panel-type-confirm-${pid}`).click();

        // It LAUNCHED — not merely appeared in the dropdown, which is all the suite proved before.
        const term = win.getByTestId(`terminal-${pid}`);
        await expect(term).toBeVisible();
        await expect(win.getByTestId(`panel-type-select-${pid}`)).toHaveCount(0);
      },
    );
  } finally {
    // The seeded app's config root and this project root are removed in `afterAll`, after the
    // shell this test started has died with the app that owns it.
  }
});

test('a user-defined flavour launches WITH a startup command, via its own recipe (FR-043)', { tag: ['@extended', '@terminal', '@reserve:pty'] }, async () => {
  const root = ownSeeded(mkdtempSync(join(tmpdir(), 'throng-025-userflav-')));
  try {
    await runSeeded(
      async (_app, win) => {
        await createProject(win, 'UserLaunchCmd', root);
        const pid = await firstPanelId(win);
        await win.getByTestId(`panel-type-select-${pid}`).selectOption('terminal');
        await win.getByTestId('terminal-flavour').selectOption('my-cmd');
        await win.getByTestId('terminal-startup-command').fill('echo USER_FLAVOUR_MARKER');
        await win.getByTestId(`panel-type-confirm-${pid}`).click();

        const term = win.getByTestId(`terminal-${pid}`);
        await expect(term).toContainText('USER_FLAVOUR_MARKER', { timeout: 30_000 });
      },
    );
  } finally {
    // The seeded app's config root and this project root are removed in `afterAll`.
  }
});

test('the empty-panel form pre-fills from what the panel remembered (FR-007a)', { tag: ['@extended', '@terminal', '@reserve:pty'] }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'throng-025-prefill-'));
  try {
  await runApp(async (_app, win) => {
    await createProject(win, 'Prefill', root);
    const pid = await firstPanelId(win);
    await win.getByTestId(`panel-type-select-${pid}`).selectOption('terminal');
    await win.getByTestId('terminal-flavour').selectOption('cmd');
    await win.getByTestId('terminal-shell-arguments').fill('/K');
    await win.getByTestId('terminal-startup-command').fill('echo PREFILL_MARKER');
    await win.getByTestId('terminal-remember-command').check();
    await win.getByTestId(`panel-type-confirm-${pid}`).click();

    const term = win.getByTestId(`terminal-${pid}`);
    await expect(term).toContainText('PREFILL_MARKER', { timeout: 30_000 });

    // End the terminal from inside. The panel returns to its empty state — which IS the edit
    // screen (FR-007b): there is no separate settings dialog anywhere.
    await term.click();
    await win.keyboard.type('exit');
    await win.keyboard.press('Enter');

    const form = win.getByTestId(`panel-type-select-${pid}`);
    await expect(form).toBeVisible({ timeout: 30_000 });
    await form.selectOption('terminal');

    // Pre-filled from memory rather than reset to defaults.
    await expect(win.getByTestId('terminal-startup-command')).toHaveValue('echo PREFILL_MARKER');
    await expect(win.getByTestId('terminal-remember-command')).toBeChecked();
  });
  } finally {
    cleanupTemp(root);
  }
});
