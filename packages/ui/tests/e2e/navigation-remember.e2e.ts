/**
 * 033 Phase 8 (#219) — the two `Editor · Navigation` remember settings, asserted in BOTH states.
 *
 * Covers AS-18 to AS-21 (US1), AS-13 to AS-15 (US2), FR-057 – FR-063, M1–M8 of
 * [data-model.md §6](../../../../specs/033-open-and-navigate/data-model.md), and SC-014.
 *
 * ══ WHY BOTH STATES, AND WHY "THE TOGGLE IS IN PREFERENCES" IS NOT EVIDENCE ══
 *
 * SC-014 names the defect this file exists to prevent, and it is #108's: a setting that is RENDERED
 * and never READ. A form control that writes a key nothing consumes passes every assertion anyone
 * would naturally write about it — it appears, it toggles, it persists — while the feature it claims
 * to govern does nothing at all. So each setting is asserted in both states here, and the assertion
 * is always about the MODAL rather than about the control:
 *
 *   off  the modal opens EMPTY, even straight after a value was accepted
 *   on   the modal opens with that value present, fully selected, and (Quick Open) showing ITS results
 *
 * The preferences window appears in exactly one test, and even there the evidence is that clicking
 * the toggle CHANGED WHAT THE MODAL DOES — not that the row rendered.
 *
 * ══ HOW A SETTING IS PUT INTO A STATE ══
 *
 * Two ways, chosen per test for a reason rather than by habit:
 *
 *  - **Seeded on disk before launch** for every test that needs a setting to be ON. A settings write
 *    is picked up asynchronously, and there is no observable for "this setting is now live" short of
 *    the modal behaviour the test is about — so a test that wrote the setting and then immediately
 *    accepted a value would be racing the hot-reload, and would fail by remembering nothing.
 *  - **Changed live, in the preferences window** for the one test about TURNING A SETTING OFF
 *    (AS-15 / FR-063). That direction has an honest sync point: the modal opening empty is itself
 *    the condition, and `expect.poll` over "reopen and read the input" can only come true once the
 *    change is live. It is also the only way to prove the control is wired to anything.
 *
 * ══ WHAT IS DELIBERATELY NOT HERE ══
 *
 * **"The remembered line number survives a project change"** is asserted at the UNIT layer, in
 * `packages/ui/tests/unit/navigation-remember-store.test.ts`, along with every other transition of
 * the remembered-input state (what counts as accepted, what a project change discards, what turning
 * a setting off discards). Those are pure state rules and reproduce in milliseconds; this file
 * carries only what needs a real window — a real chord, a real selection, a real hot-reload.
 *
 * **No wall-clock ceiling anywhere.** Registered in the SERIAL tier (it opens the preferences
 * window), but a timed assertion would still be measuring the machine rather than the feature.
 */
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect, type ElectronApplication, type Locator, type Page } from '@playwright/test';
import {
  runApp,
  createProject,
  firstPanelId,
  settle,
  cleanupTemp,
} from './harness.js';
import { openGotoLine, openQuickOpen, quickOpenRows } from './helpers/navigation.js';
import { writeSettingsAtomic } from './helpers/config-write.js';

/* ────────────────────────────────────────────────────────────────────────────────────────────────
 * Fixtures
 * ──────────────────────────────────────────────────────────────────────────────────────────────── */

/** Exactly `LONG_LINES` lines, and NO trailing newline — so the document has `LONG_LINES` lines. */
const LONG_LINES = 400;

function makeProject(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  mkdirSync(join(root, 'docs'), { recursive: true });
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'README.md'), '// README.md\n', 'utf8');
  writeFileSync(join(root, 'docs', 'guide.md'), '// docs/guide.md\n', 'utf8');
  writeFileSync(join(root, 'src', 'app.ts'), '// src/app.ts\n', 'utf8');
  writeFileSync(join(root, 'src', 'util.ts'), '// src/util.ts\n', 'utf8');
  /*
   * `long.txt` is the Go To Line subject, and its line count is load-bearing twice over: the jump to
   * 42 has to be a real jump, and the clamp assertion below expects a request past the end to
   * resolve to exactly this many lines. `join('\n')` with no trailing newline is deliberate — a
   * trailing newline would make the document 401 lines, and the fixture would then disagree with the
   * assertion by one in a way that reads as a clamping bug.
   */
  const lines: string[] = [];
  for (let n = 1; n <= LONG_LINES; n += 1) lines.push(`line-${String(n).padStart(4, '0')}`);
  writeFileSync(join(root, 'long.txt'), lines.join('\n'), 'utf8');
  return root;
}


function freshCfgRoot(both: boolean): string {
  const dir = mkdtempSync(join(tmpdir(), 'throng-remember-cfg-'));
  /*
   * Written BEFORE launch (see the header): the app reads settings at startup, so seeding the file
   * here is what makes the setting live from the very first invocation rather than at some
   * unobservable moment afterwards.
   */
  writeSettingsAtomic(dir, {
    editor: { navigation: { rememberQuickOpenQuery: both, rememberGotoLineNumber: both } },
  });
  return dir;
}

function readSettings(cfgRoot: string): Record<string, any> | null {
  try {
    return JSON.parse(readFileSync(join(cfgRoot, 'settings.json'), 'utf8'));
  } catch {
    return null;
  }
}

/* ────────────────────────────────────────────────────────────────────────────────────────────────
 * Driving the two modals
 * ──────────────────────────────────────────────────────────────────────────────────────────────── */

/** Turn the tab's first panel into an editor and hand back its id. */
async function newEditor(win: Page): Promise<string> {
  const pid = await firstPanelId(win);
  await win.getByTestId(`panel-type-select-${pid}`).selectOption('editor');
  await win.getByTestId(`panel-type-confirm-${pid}`).click();
  await expect(win.getByTestId(`editor-${pid}`)).toBeVisible();
  return pid;
}

/**
 * Open `file` from the tree and then put the keyboard in the editor by CLICKING A RENDERED LINE.
 *
 * Both halves are needed and `goto-line.e2e.ts` documents why at length: opening from the tree
 * leaves the ACTIVE PANE at File Explorer, so `navigate.gotoLine` — which is EDITOR_ONLY —
 * resolves to nothing and `Ctrl+G` does nothing at all. Clicking a line sets the pane as well as the
 * DOM focus. It must be a rendered LINE rather than `.cm-content`, whose box for a four-hundred-line
 * document is thousands of pixels tall: Playwright scrolls an element's centre into view before
 * clicking it, which would drop the caret in the middle of the file.
 */
async function openFileAndFocus(win: Page, pid: string, file: string, firstText: string): Promise<void> {
  await win.getByTestId('file-explorer-tree').getByText(file, { exact: true }).click();
  const editor = win.getByTestId(`editor-${pid}`);
  await expect(editor.locator('.cm-content')).toContainText(firstText, { timeout: 8000 });
  await editor.locator('.cm-content .cm-line').first().click();
  await expect(editor.locator('.cm-editor.cm-focused')).toBeVisible({ timeout: 10_000 });
}

/**
 * Accept a Quick Open query that matches exactly one file — the only kind of value FR-061 records.
 *
 * The row count is asserted BEFORE Enter is pressed, and that is not defensive padding. `Enter` is
 * not queued: the picker answers it from the highlighted row, and while the file index is still
 * being enumerated there is no row at all (FR-015 / S3). An Enter arriving in that window is
 * correctly ignored and nothing retries it, so the test dies later on an assertion about the value
 * that was never accepted. `quick-open.e2e.ts` measured this exact failure.
 */
async function acceptQuickOpenQuery(win: Page, query: string, opensText: string): Promise<void> {
  await openQuickOpen(win);
  await win.keyboard.type(query);
  await expect(quickOpenRows(win)).toHaveCount(1);
  await win.keyboard.press('Enter');
  await expect(win.getByTestId('quickopen')).toHaveCount(0);

  /*
   * ══ THE MODAL CLOSING IS NOT THE QUERY BEING RECORDED — issue #321 ══
   *
   * `choose` (`quick-open.tsx`) calls `onDismiss()` SYNCHRONOUSLY and then does the real work in an
   * async IIFE: `await openFileInTab(...)`, `if (!opened) return`, and only then
   * `rememberQuickOpenQuery(...)`. That ordering is deliberate and correct — FR-061 defines
   * "accepted" as a file having OPENED, so a route the user cancels at the unsaved-changes prompt
   * must record nothing.
   *
   * The consequence is that the assertion above — the modal is gone — resolves while the record is
   * still pending behind the open. Returning here let the caller read the remembered value before
   * anything had written it, and the read is a plain non-retrying `expect`, so it got `''`.
   *
   * MEASURED, not argued. Instrumenting the store showed the order in a failing run:
   *     seed{remember:true, held:null} · seed{remember:true, held:null} · accept{query:"guide"}
   * — the second modal opened and seeded from an empty store BEFORE the accept was recorded, with
   * `remember` true throughout and NO discard of any kind. On this machine that lost the race in
   * 4 of 20 runs of the spec alone; the issue recorded it as 1 in ~705.
   *
   * So wait for the OPEN, which is the record's actual precondition. `opensText` is the content of
   * the file the query resolves to — the cheapest observable that the router finished.
   */
  await expect(win.locator('.editor-panel')).toContainText(opensText, { timeout: 15_000 });
}

/** Type a line number into Go To Line and confirm it. */
async function acceptGotoLine(win: Page, text: string): Promise<void> {
  await openGotoLine(win);
  await win.keyboard.type(text);
  await win.keyboard.press('Enter');
  await expect(win.getByTestId('gotoline')).toHaveCount(0);
}

/**
 * The input's value, and whether the WHOLE of it is selected (FR-060).
 *
 * Read off `selectionStart`/`selectionEnd` rather than inferred from a keystroke, because the two
 * halves of FR-060 fail separately: a value that is present but not selected still costs the user a
 * `Ctrl+A` before they can type, and "typing replaced it" alone cannot tell a selected value from a
 * field that was cleared on the first keypress.
 */
async function inputState(input: Locator): Promise<{ value: string; fullySelected: boolean }> {
  return input.evaluate((el) => {
    const field = el as HTMLInputElement;
    return {
      value: field.value,
      fullySelected:
        field.value.length > 0 &&
        field.selectionStart === 0 &&
        field.selectionEnd === field.value.length,
    };
  });
}

/** Open the preferences window on the Settings tab. */
async function openSettings(app: ElectronApplication, win: Page): Promise<Page> {
  await win.getByTestId('title-bar-cog').click();
  const [prefs] = await Promise.all([
    app.waitForEvent('window'),
    win.getByTestId('cog-menu-settings').click(),
  ]);
  await prefs.waitForLoadState('domcontentloaded');
  await expect(prefs.getByTestId('settings-tab')).toBeVisible();
  return prefs;
}

/** Open Quick Open, read its input, and close again — the probe both "off" assertions poll. */
async function quickOpenInputValue(win: Page): Promise<string> {
  await openQuickOpen(win);
  const value = (await inputState(win.getByTestId('quickopen-input'))).value;
  await win.keyboard.press('Escape');
  await expect(win.getByTestId('quickopen')).toHaveCount(0);
  return value;
}

/** The same probe for Go To Line. Requires the editor to be the active panel. */
async function gotoLineInputValue(win: Page): Promise<string> {
  await openGotoLine(win);
  const value = (await inputState(win.getByTestId('gotoline-input'))).value;
  await win.keyboard.press('Escape');
  await expect(win.getByTestId('gotoline')).toHaveCount(0);
  return value;
}

/*
 * Every test here launches its OWN app, because every one of them needs a config root seeded before
 * the window exists — which is the one case `docs/testing.md` says may not share an app.
 *
 * The default 30s budget does not cover a launch plus a project plus two modals driven several times
 * over, so each test states what it needs. The preferences test asks for most: it drives a second
 * window and then waits on two hot-reload round trips.
 */
test.beforeEach(() => {
  test.setTimeout(90_000);
});

/* ────────────────────────────────────────────────────────────────────────────────────────────────
 * OFF — the shipped defaults (AS-18, AS-13, FR-057, M1, SC-014's first half)
 * ──────────────────────────────────────────────────────────────────────────────────────────────── */


/* ────────────────────────────────────────────────────────────────────────────────────────────────
 * ON — Quick Open (AS-19, AS-20, AS-21, FR-060, FR-061, FR-062)
 * ──────────────────────────────────────────────────────────────────────────────────────────────── */

/*
 * MOVED DOWN (test-suite audit) — two declarations that launched an Electron app each, with a config
 * root seeded before launch, only to read a modal's input:
 *
 *   `at the shipped defaults BOTH modals reopen empty, even straight after a value was accepted`
 *       (AS-18, AS-13, FR-057)
 *   `with rememberQuickOpenQuery on, the accepted query comes back selected with its own results —
 *       an abandoned one never does, and a project change discards it` (AS-19, AS-20, AS-21)
 *
 * Quick Open's half is the real `QuickOpen` over the real `ConfigProvider` in
 * `component/quick-open-header.test.ts` ("the remembered query"): off reopens empty and lists the
 * whole project; on seeds the accepted query FULLY SELECTED into the picker's own query state, typing
 * replaces it, an abandoned or cancelled open records nothing. Each is red when the setting is not
 * read, when the seed is dropped and when an unopened file is recorded. The rules behind them — what
 * counts as accepted, that a project change discards the query (AS-21, FR-062), that turning a
 * setting off discards it (FR-063), and Go To Line's number (AS-13, AS-14) — are
 * `unit/navigation-remember-store.test.ts` and `core/tests/unit/goto-line.test.ts`.
 *
 * What stays here is the one declaration below: the preferences window, the only place the toggles
 * can be turned off by a user and the modal observed to change.
 */

/* ────────────────────────────────────────────────────────────────────────────────────────────────
 * ON — Go To Line (AS-14, FR-060, FR-061)
 * ──────────────────────────────────────────────────────────────────────────────────────────────── */

/*
 * MOVED to `packages/core/tests/unit/goto-line.test.ts` +
 * `packages/ui/tests/unit/navigation-remember-store.test.ts` (034 FR-046a): "the line that was
 * GONE TO comes back selected — and it is the line REACHED, not the number typed". The
 * distinction it guards is the clamp (99999 typed, 400 reached, 400 remembered), and the clamp
 * is what the unit test asserts — breaking it reddens 9 cases.
 */

/* ────────────────────────────────────────────────────────────────────────────────────────────────
 * The preferences window — FR-059, FR-063, AS-15, SC-014
 * ──────────────────────────────────────────────────────────────────────────────────────────────── */

test('both toggles live in Editor · Navigation, ship off, and turning them off DISCARDS what is held (FR-059, FR-063, AS-15, SC-014)', { tag: ['@extended', '@editor', '@reserve:window'] }, async () => {
  const root = makeProject('throng-remember-prefs-');
  const cfg = freshCfgRoot(true);
  try {
    await runApp(
      async (app, win) => {
        await settle(win);
        await createProject(win, 'RememberPrefs', root);
        const pid = await newEditor(win);
        await openFileAndFocus(win, pid, 'long.txt', 'line-0001');

        // Put a value in each — there has to be something to discard for FR-063 to be about anything.
        await acceptGotoLine(win, '42');
        await acceptQuickOpenQuery(win, 'guide', '// docs/guide.md');
        // …and prove BOTH are being surfaced before anything is switched off. Without this the test
        // could pass against an implementation that never remembered anything in the first place.
        // TEMPORARY PROBE (#321) — remove. The trace is read ONLY on failure, so the passing path
        // is byte-for-byte what it was; an extra round trip before the read masks the race.
        const seen = await quickOpenInputValue(win);
        if (seen !== 'guide') {
          const trace = await win.evaluate(
            () => (window as unknown as { __qo?: unknown[] }).__qo ?? [],
          );
          throw new Error(`#321 REPRO — expected 'guide', got '${seen}'. trace=${JSON.stringify(trace)}`);
        }
        await openFileAndFocus(win, pid, 'long.txt', 'line-0001');
        expect(await gotoLineInputValue(win)).toBe('42');

        const prefs = await openSettings(app, win);

        /*
         * FR-059 — one group, both settings in it, ADJACENT and beside the sibling that was already
         * there. Asserted as the group's whole membership in order, because "the row exists" is
         * satisfied by a descriptor dropped anywhere in the registry, and the group's contents are
         * rendered in registry order.
         */
        const group = prefs.getByTestId('settings-group-Editor · Navigation');
        await expect(group, 'there is no Editor · Navigation group in the Settings tab').toBeVisible();
        /*
         * `:scope > .fold-content >` — the group's contents container's DIRECT children, which is what a
         * row is. (056: every heading's contents sit in one `.fold-content` so a fold can hide them.)
         *
         * A bare `[data-testid^="setting-"]` is not selective enough: each row nests a `RowActions`
         * whose four controls are `setting-actions-`, `setting-revert-`, `setting-reset-` and
         * `setting-clear-` prefixed, so the descendant form returned fifteen elements for three
         * rows. `.replace('setting-', '')` then compounded it — `String.replace` takes the first
         * occurrence ANYWHERE rather than a prefix — which is why the failure read as twelve
         * mysterious extra keys instead of naming the nesting. Structural, so a new row action
         * added later changes nothing here; `slice` is anchored, so a key that happened to contain
         * the substring could not be mangled.
         */
        const keys = await group
          .locator(':scope > .fold-content > [data-testid^="setting-"]')
          .evaluateAll((rows) =>
            rows.map((row) => (row.getAttribute('data-testid') ?? '').slice('setting-'.length)),
          );
        /*
         * `historySize` joined this group in 044 FR-108 (#136), which put it in the EXISTING
         * `Editor · Navigation` group deliberately — 040 FR-037a pins exactly three `Editor · …`
         * groups, so a fourth sibling was not available. It sits AFTER the two remember toggles, so
         * FR-059's actual claim — the two are adjacent and beside `quickOpenExcludeHidden`, the
         * sibling that was already there — is unchanged; this line is a whole-membership assertion,
         * so a legitimately added row has to be named here rather than the list being loosened.
         */
        expect(keys).toEqual([
          'editor.navigation.quickOpenExcludeHidden',
          'editor.navigation.rememberQuickOpenQuery',
          'editor.navigation.rememberGotoLineNumber',
          'editor.navigation.historySize',
        ]);

        // Both are toggles, and both are ON here because this app's config root seeded them so.
        const quickOpenToggle = prefs.getByTestId('control-editor.navigation.rememberQuickOpenQuery');
        const gotoLineToggle = prefs.getByTestId('control-editor.navigation.rememberGotoLineNumber');
        await expect(quickOpenToggle).toBeChecked();
        await expect(gotoLineToggle).toBeChecked();

        // Turn both OFF from the visual editor — the only route a user has.
        await quickOpenToggle.click();
        await gotoLineToggle.click();
        await expect
          .poll(() => readSettings(cfg)?.editor?.navigation?.rememberQuickOpenQuery)
          .toBe(false);
        await expect
          .poll(() => readSettings(cfg)?.editor?.navigation?.rememberGotoLineNumber)
          .toBe(false);
        await prefs.close();
        await win.bringToFront();
        // Put the keyboard back in the editor before driving either chord. A window that has just
        // regained focus has it nowhere in particular, and Go To Line is EDITOR_ONLY — without this
        // the poll below would be waiting on a chord that never resolves rather than on a setting.
        await openFileAndFocus(win, pid, 'long.txt', 'line-0001');

        /*
         * AS-15 / FR-063 — SC-014's whole point, and the #108 guard.
         *
         * The evidence is that the MODAL changed, not that the row rendered. A control writing a key
         * nothing reads would leave both of these still seeded, and every assertion above it would
         * still have passed.
         *
         * Polled, because a settings write is picked up asynchronously and the modal opening empty
         * IS the condition — which makes the wait self-verifying rather than a duration someone
         * guessed. Each probe opens the modal, reads the field and dismisses it, so repeating it
         * costs nothing and changes nothing.
         */
        await expect
          .poll(() => quickOpenInputValue(win), {
            timeout: 15_000,
            message: 'Quick Open kept the remembered query after the setting was turned off',
          })
          .toBe('');

        await expect
          .poll(() => gotoLineInputValue(win), {
            timeout: 15_000,
            message: 'Go To Line kept the remembered number after the setting was turned off',
          })
          .toBe('');
      },
      { env: { THRONG_CONFIG_ROOT: cfg } },
    );
  } finally {
    cleanupTemp(root);
    cleanupTemp(cfg);
  }
});
