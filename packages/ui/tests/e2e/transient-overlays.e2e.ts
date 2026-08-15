/**
 * 033 Phase 11 / D1 — at most ONE transient overlay per window (FR-071, FR-071a, SC-017).
 *
 * ══ WHY THIS SPEC EXISTS AT ALL ══
 *
 * The user pressed `Ctrl+Alt+T` and then `Ctrl+Shift+T` and got two focus-trapped modals on screen
 * at once. FR-066 had promised "exactly one modal" but scoped the promise to the two NEW modals, so
 * the tab picker — whose open flag lives in a `useState` inside `tab-group.tsx` and in no store at
 * all — was never part of it. FR-071 widens the rule to every overlay; FR-071a forbids the obvious
 * repair, because a feature that imports another feature's store to know whether to close is a
 * coupling the next overlay would have to repeat.
 *
 * ══ WHAT IS ASSERTED, AND WHY IT IS "EXACTLY ONE" ══
 *
 * Every case here reads back the WHOLE SET of overlays in the DOM and compares it with `[b]`.
 * Asserting only "B is visible" would have passed against the broken build — B *was* visible; so
 * was A, on top of it. The set is the assertion, and the scrim count beside it is the second half:
 * two overlays each render `.modal-overlay`, and a user staring at a double-darkened window is what
 * the defect looked like.
 *
 * SC-017 names all SIX ordered pairs of the three, not one example, because the mechanism is
 * directional at each call site: an overlay can be a correct dismisser and a broken dismissee. The
 * editor status strip's language picker gets ONE directional case (opening Quick Open dismisses it)
 * rather than joining the matrix — with four overlays the matrix is twelve pairs, and the extra six
 * exercise no branch of the one registry that the first six do not.
 *
 * ══ ONE APP, ONE PROJECT, ONE EDITOR ══
 *
 * Nothing here seeds state before the app starts, so the file shares a single `openApp()`. The
 * fixture is a project with one small file open in an editor panel: Go To Line is EDITOR_ONLY and
 * needs an editor active, Quick Open needs the window to have a project root, and the tab picker
 * needs neither — so the editor fixture is the one state in which all three chords are live.
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import {
  openApp,
  createProject as newProject,
  firstPanelId,
  settle,
  cleanupTemp,
  type OpenApp,
} from './harness.js';
import { GOTO_LINE_CHORD, QUICK_OPEN_CHORD } from './helpers/navigation.js';

/*
 * Deliberately NOT `mode: 'serial'`, unlike the other shared-app specs in this suite.
 *
 * Serial mode SKIPS the rest of the file once one test fails, and this file is a MATRIX: the whole
 * value of six ordered pairs is knowing which of them hold and which do not. A first failure that
 * hid the other five would turn "four pairs are broken, in two different ways" into "something is
 * broken", which is the report that costs an afternoon. Serial mode is right where tests build on
 * each other; here every case begins by resetting the window through `prepare()`, so none does.
 *
 * `fullyParallel: false` in `playwright.config.ts` still keeps the file to ONE worker, in order, so
 * the shared app is never driven by two tests at once.
 */
let shared: OpenApp;
let root: string;
let panelId: string;

/**
 * The tab picker's chord (031 T5, `tabs.openPicker`).
 *
 * Named here rather than imported: `helpers/navigation.ts` owns the two NAVIGATION chords and this
 * one belongs to the tab strip, which has no chord helper. It is the chord the user actually
 * pressed in the report that produced FR-071.
 */
const TAB_PICKER_CHORD = 'Control+Alt+T';

/** The three overlays SC-017's matrix is drawn over. Each id is also its `data-testid`. */
const OVERLAYS = ['quickopen', 'gotoline', 'tabpicker'] as const;
type Overlay = (typeof OVERLAYS)[number];

const CHORD: Record<Overlay, string> = {
  quickopen: QUICK_OPEN_CHORD,
  gotoline: GOTO_LINE_CHORD,
  tabpicker: TAB_PICKER_CHORD,
};

const NAME: Record<Overlay, string> = {
  quickopen: 'Quick Open',
  gotoline: 'Go To Line',
  tabpicker: 'the tab picker',
};

test.beforeAll(async () => {
  shared = await openApp();
  root = mkdtempSync(join(tmpdir(), 'throng-overlays-'));
  writeFileSync(join(root, 'alpha.txt'), 'one\ntwo\nthree\nfour\nfive\n', 'utf8');

  const win = shared.win;
  await settle(win);
  await newProject(win, 'Overlays', root);
  panelId = await firstPanelId(win);
  await win.getByTestId(`panel-type-select-${panelId}`).selectOption('editor');
  await win.getByTestId(`panel-type-confirm-${panelId}`).click();
  await expect(win.getByTestId(`editor-${panelId}`)).toBeVisible();
  await win.getByTestId('file-explorer-tree').getByText('alpha.txt', { exact: true }).click();
  await expect(win.getByTestId(`editor-${panelId}`).locator('.cm-content')).toContainText('one', {
    timeout: 8000,
  });
});

test.afterAll(async () => {
  await shared?.close();
  if (root) cleanupTemp(root);
});

/**
 * Every overlay currently in the DOM, in a fixed order so the comparison is order-independent in
 * practice while still being an `toEqual` on a concrete array.
 *
 * Read in ONE `evaluate` rather than three `count()` calls: three separate reads of a UI that is
 * mid-transition can each be true at a different instant, and the whole question here is what is on
 * screen AT THE SAME TIME.
 */
async function overlaysOnScreen(win: Page): Promise<Overlay[]> {
  return win.evaluate(
    (ids) => ids.filter((id) => document.querySelector(`[data-testid="${id}"]`) !== null),
    OVERLAYS as unknown as Overlay[],
  );
}

/**
 * Put the window back in the state every case starts from: no overlay open, and the keyboard in the
 * editor's document.
 *
 * The click is on a RENDERED line rather than `.cm-content` — Playwright scrolls an element's centre
 * into view before clicking, and it is also what sets the ACTIVE PANE to the workspace, which is the
 * fact `currentScope` reads to decide that `navigate.gotoLine` (EDITOR_ONLY) is live at all. DOM
 * focus alone is not that fact.
 */
async function prepare(): Promise<void> {
  const win = shared.win;
  for (let i = 0; i < 4 && (await overlaysOnScreen(win)).length > 0; i += 1) {
    await win.keyboard.press('Escape');
  }
  await expect.poll(() => overlaysOnScreen(win)).toEqual([]);
  await win.getByTestId(`editor-${panelId}`).locator('.cm-content .cm-line').first().click();
  await expect(
    win.getByTestId(`editor-${panelId}`).locator('.cm-editor.cm-focused'),
  ).toBeVisible({ timeout: 10_000 });
}

/**
 * Open one overlay by its chord and wait for it to be usable (visible, and holding the caret).
 *
 * Used for the FIRST overlay of a pair, where both halves are a precondition. The second overlay is
 * driven by hand in the test body, because the order the assertions are made in decides what the
 * failure says: asserting the caret before the SET turns "two overlays are on screen" into "Quick
 * Open opened without the caret", which is a true sentence about the wrong subject.
 */
async function openOverlay(o: Overlay): Promise<void> {
  const win = shared.win;
  await win.keyboard.press(CHORD[o]);
  await expect(win.getByTestId(o), `${NAME[o]} did not open on ${CHORD[o]}`).toBeVisible();
  await expect(win.getByTestId(`${o}-input`), `${NAME[o]} opened without the caret`).toBeFocused();
}

/* ────────────────────────────────────────────────────────────────────────────────────────────────
 * SC-017 — all six ordered pairs
 * ──────────────────────────────────────────────────────────────────────────────────────────────── */

const PAIRS: Array<[Overlay, Overlay]> = [
  ['quickopen', 'gotoline'],
  ['gotoline', 'quickopen'],
  ['quickopen', 'tabpicker'],
  ['tabpicker', 'quickopen'],
  ['gotoline', 'tabpicker'],
  ['tabpicker', 'gotoline'],
];

for (const [a, b] of PAIRS) {
  test(`opening ${NAME[b]} while ${NAME[a]} is open leaves exactly one overlay (SC-017, FR-071)`, async () => {
    const win = shared.win;
    await prepare();

    await openOverlay(a);
    await expect.poll(() => overlaysOnScreen(win)).toEqual([a]);

    await win.keyboard.press(CHORD[b]);
    await expect(win.getByTestId(b), `${NAME[b]} did not open on ${CHORD[b]}`).toBeVisible();

    /*
     * THE assertion. The whole set, not "B is visible" — B was visible in the broken build too,
     * drawn on top of A with A's focus trap still holding the caret underneath it.
     */
    await expect
      .poll(() => overlaysOnScreen(win), {
        message: `${NAME[b]} opened OVER ${NAME[a]} instead of replacing it — both are on screen`,
      })
      .toEqual([b]);
    // One scrim, not two stacked on each other — the doubly-darkened window the user saw.
    await expect(win.locator('.modal-overlay')).toHaveCount(1);
    // And one focus trap: the survivor holds the caret, so the first keystroke goes where it looks.
    await expect(win.getByTestId(`${b}-input`), `${NAME[b]} is on screen without the caret`)
      .toBeFocused();
  });
}

/* ────────────────────────────────────────────────────────────────────────────────────────────────
 * The fourth overlay — one directional case (D1)
 * ──────────────────────────────────────────────────────────────────────────────────────────────── */

test('opening Quick Open dismisses the editor status strip’s language picker (FR-071)', async () => {
  const win = shared.win;
  await prepare();

  await win.getByTestId(`editor-language-${panelId}`).click();
  await expect(win.getByTestId(`language-picker-${panelId}`)).toBeVisible();

  await win.keyboard.press(QUICK_OPEN_CHORD);
  await expect(win.getByTestId('quickopen')).toBeVisible();

  await expect(
    win.getByTestId(`language-picker-${panelId}`),
    'the language picker stayed open under Quick Open',
  ).toHaveCount(0);
  await expect.poll(() => overlaysOnScreen(win)).toEqual(['quickopen']);
  await expect(win.getByTestId('quickopen-input')).toBeFocused();
});
