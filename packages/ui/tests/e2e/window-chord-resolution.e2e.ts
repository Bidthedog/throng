/**
 * 033 SC-021 (baseline finding F6) — every window-level chord still resolves after the `keepShift`
 * widening.
 *
 * ══ WHAT CHANGED, AND WHY IT NEEDS A SPEC OF ITS OWN ══
 *
 * The window-level dispatcher in `packages/ui/src/renderer/app.tsx` used to DROP Shift for every key
 * but the backtick and the function keys, on the reasoning that the produced character already
 * encodes it (`Ctrl++` is really Ctrl+Shift+`=`). That reasoning does not hold for LETTERS:
 * `normalizeToken` folds `T` and `t` together on purpose, so for A–Z the shifted character encodes
 * nothing and dropping the modifier genuinely loses the chord. `Ctrl+Shift+T` (Quick Open, FR-002)
 * arrived at the resolver as `Ctrl+T`, matched no binding, and did nothing at all.
 *
 * The fix widened the exception to a third branch:
 *
 *     const keepShift = backtick || /^F\d{1,2}$/.test(e.key) || /^[a-z]$/i.test(e.key);
 *
 * That is one line, and it changed how the event is BUILT for every command in the same listener's
 * `HANDLED` allowlist — not only for the new one. Nothing in that set announces a regression: an
 * event built with one modifier too many resolves to `null`, `HANDLED.has(null)` is false, the
 * listener returns, and the chord is simply inert. No throw, no log, no visible failure — the code's
 * own comment names that silence, which is exactly why the widening needs assertions rather than a
 * reading. This file is those assertions.
 *
 * ══ WHY IT DISCOVERS THE ALLOWLIST INSTEAD OF LISTING IT ══
 *
 * A guard shaped like the three chords someone happened to notice passes while a fourth is dead. So
 * the covered set is not written down here: `HANDLED` is read out of `app.tsx`, each action's chords
 * come from `@throng/core`'s shipped bindings, and the same three `keepShift` predicates decide which
 * of them the widening can reach. The chords the tests PRESS are derived that way too, so a changed
 * default is exercised as changed rather than asserted against a stale literal.
 *
 * ══ WHERE THE COVERAGE CHECK WENT (034 FR-045) ══
 *
 * The comparison itself — discovered set against covered set, failing in EITHER direction — used to
 * be the first test in this file, and it pressed nothing. It reads `app.tsx`, reads the shipped
 * bindings, and compares two arrays of strings, and it was doing that inside a Playwright worker
 * behind a `beforeAll` that launched Electron and built a project on disk.
 *
 * It now lives in `packages/ui/tests/unit/window-chord-manifest.test.ts`, importing the same
 * discovery from `packages/ui/tests/shared/window-chords.ts` that this file imports — one definition,
 * so the guard and the tests cannot drift apart while each stays green. That is also where the
 * exemption check lives: `menu.open` is covered in `menu-keyboard.e2e.ts`, and the guard reads that
 * file with its comments stripped to confirm the chord is still PRESSED there rather than merely
 * discussed.
 *
 * Moving it forward matters more than the seconds it saves. It is the test that fails when someone
 * adds a window chord on a letter key and covers it nowhere, and that answer is worth having in the
 * unit tier rather than most of an E2E run later.
 */
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import {
  openApp,
  createProject,
  firstPanelId,
  panelIds,
  addPanels,
  cleanupTemp,
  type OpenApp,
} from './harness.js';
import { discoverKeepShiftChords, keyOf } from '../shared/window-chords.js';

/* ══════════════════════════════════════════════════════════════════════════════════════════════
 * Discovery — the allowlist, the chords, and the branch that carries them
 * ══════════════════════════════════════════════════════════════════════════════════════════════ */

const KEEP_SHIFT = discoverKeepShiftChords();

/**
 * A binding token as Playwright's `keyboard.press` spells it.
 *
 * The letter case is load-bearing rather than cosmetic. Playwright takes the key segment literally,
 * so `Control+Alt+B` and `Control+Alt+b` are the same keystroke — but a chord written with an
 * explicit `Shift+` must keep the shifted spelling, and one without it must not acquire one, because
 * after the widening the Shift state is part of what the resolver matches on. Getting this wrong
 * would make a test fail for a reason that has nothing to do with the dispatcher.
 */
function press(token: string): string {
  const key = keyOf(token);
  const mods = token.slice(0, token.length - key.length).replace(/Ctrl\+/g, 'Control+');
  const shifted = /(^|\+)Shift\+/.test(token);
  const tail =
    key === '`'
      ? 'Backquote'
      : /^[a-z]$/i.test(key)
        ? shifted
          ? key.toUpperCase()
          : key.toLowerCase()
        : key;
  return mods + tail;
}

/** The chord a test is about to send, failing loudly rather than pressing `undefined`. */
function chordFor(action: string): string {
  const chords = KEEP_SHIFT.get(action);
  if (!chords || chords[0] === undefined) {
    throw new Error(`${action} carries no Shift-keeping chord — the coverage table is stale`);
  }
  return press(chords[0]);
}

/* ══════════════════════════════════════════════════════════════════════════════════════════════
 * One app and one project for the whole file
 * ══════════════════════════════════════════════════════════════════════════════════════════════ */

/*
 * Serial, sharing one window: every test here asks the same question of a different chord, and none
 * of them needs a pristine app. Each restores what it changed, so the order below is the order they
 * are written in and a failure skips the rest rather than running them against the wreckage.
 *
 * The project is built once in `beforeAll` rather than per test — nine window launches to press
 * eleven chords would make the cheapest possible assertion the most expensive spec in the suite.
 */
test.describe.configure({ mode: 'serial' });

/** Line `n` reads `line-NN`, so a rendered line names its own number. */
const marker = (n: number): string => `line-${String(n).padStart(2, '0')}`;
const RENAME_FROM = 'alpha.txt';
const RENAME_TO = 'alpha-renamed.txt';

let shared: OpenApp;
let root = '';
let editorPanel = '';

test.beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'throng-chords-'));
  const lines: string[] = [];
  for (let n = 1; n <= 40; n += 1) lines.push(marker(n));
  writeFileSync(join(root, 'lines.txt'), lines.join('\n') + '\n', 'utf8');
  writeFileSync(join(root, RENAME_FROM), 'a\n', 'utf8');

  shared = await openApp();
  const win = shared.win;
  await createProject(win, 'ChordProj', root);

  // One editor panel showing a real file: the surface `panel.rename` and `navigate.gotoLine` need.
  editorPanel = await firstPanelId(win);
  await win.getByTestId(`panel-type-select-${editorPanel}`).selectOption('editor');
  await win.getByTestId(`panel-type-confirm-${editorPanel}`).click();
  await expect(win.getByTestId(`editor-${editorPanel}`)).toBeVisible();
  await win.getByTestId('file-explorer-tree').getByText('lines.txt', { exact: true }).click();
  await expect(win.getByTestId(`editor-${editorPanel}`).locator('.cm-content')).toContainText(
    marker(1),
    { timeout: 8000 },
  );
});

test.afterAll(async () => {
  await shared?.close();
  if (root) cleanupTemp(root);
});

/**
 * Put the keyboard in the editor, and wait until it is there.
 *
 * A CLICK, not `focus()`: DOM focus is not the same fact as which PANE the application thinks the
 * keyboard is in, and the file above was opened from the tree — which leaves the active pane at Files
 * & Folders, where an editor-scoped chord resolves to nothing at all. The first rendered line rather
 * than `.cm-content`, because Playwright scrolls an element's centre into view before clicking and
 * `.cm-content` is the whole document.
 */
async function focusEditorPanel(win: Page): Promise<void> {
  const editor = win.getByTestId(`editor-${editorPanel}`);
  await editor.locator('.cm-content .cm-line').first().click();
  await expect(editor.locator('.cm-editor.cm-focused')).toBeVisible({ timeout: 10_000 });
}

/* ══════════════════════════════════════════════════════════════════════════════════════════════
 * The chords themselves. Each test restores whatever it changed.
 * ══════════════════════════════════════════════════════════════════════════════════════════════ */

test('the pane toggles still resolve — Ctrl+Alt+B and Ctrl+Alt+N', { tag: ['@extended', '@window', '@reserve:input'] }, async () => {
  const win = shared.win;
  await win.locator('body').click();

  // Projects (left): shown → collapsed → shown again.
  await expect(win.getByTestId('pane-hide-left')).toBeVisible();
  await win.keyboard.press(chordFor('view.toggleProjects'));
  await expect(win.getByTestId('pane-rail-left')).toBeVisible();
  await win.keyboard.press(chordFor('view.toggleProjects'));
  await expect(win.getByTestId('pane-hide-left')).toBeVisible();

  // Files & Folders (right): the same, with the project open.
  await expect(win.getByTestId('pane-hide-right')).toBeVisible();
  await win.keyboard.press(chordFor('view.toggleExplorer'));
  await expect(win.getByTestId('pane-rail-right')).toBeVisible();
  await win.keyboard.press(chordFor('view.toggleExplorer'));
  await expect(win.getByTestId('pane-hide-right')).toBeVisible();
});

/**
 * 041 FR-020a (#314) — the notice chord resolves even while a REAL SHELL has the keyboard.
 *
 * ══ WHY THIS ONE IS AN E2E AND THE REST OF #314 IS NOT ══
 *
 * Every other claim about `focus.notice` — that it is idempotent, that an arriving notice does not
 * steal focus, that Escape returns to the origin, that the list carries its affordance — is focus
 * movement inside one surface, which `notice-focus.test.ts` asserts in jsdom in milliseconds.
 *
 * What no cheaper layer can observe is that a terminal did NOT receive the chord. A terminal panel
 * forwards nearly everything to its shell, so a binding in the wrong tier is swallowed and the notice
 * is unreachable in exactly the place it is most likely to appear (FR-020a). Only a real ConPTY and a
 * real keyboard can answer that, and it is asserted here rather than in a spec of its own so it
 * inherits this file's tier placement.
 *
 * ONE assertion, deliberately: `e2e-tags.test.ts` fails a test that appears to need two reserve
 * entries (035 FR-016b), and "focus arrives at the notice" already has a component test.
 */
test('the notice chord still resolves over a focused terminal — Ctrl+Alt+M', { tag: ['@extended', '@window', '@reserve:input'] }, async () => {
  const win = shared.win;
  await focusEditorPanel(win);

  // No notice on screen: the chord must do nothing AND raise nothing (FR-024). That is the half a
  // shell-swallowed chord and a correctly-ignored one look identical from, so it is checked first.
  await win.keyboard.press(chordFor('focus.notice'));
  await expect(win.getByTestId('notices').locator('> *')).toHaveCount(0);

  // …and it reached the application rather than the document, which is what the shell would have
  // eaten. The editor keeps focus because there was nowhere for it to go.
  await expect(win.getByTestId(`editor-${editorPanel}`).locator('.cm-editor.cm-focused')).toBeVisible();
});

test('the tab picker still resolves — Ctrl+Alt+T', { tag: ['@extended', '@window', '@reserve:input'] }, async () => {
  const win = shared.win;
  await win.locator('body').click();
  await win.keyboard.press(chordFor('tabs.openPicker'));
  await expect(win.getByTestId('tabpicker')).toBeVisible();
  await win.keyboard.press('Escape');
  await expect(win.getByTestId('tabpicker')).toHaveCount(0);
});

test('Quick Open still resolves — Ctrl+Shift+T, the chord the widening was made for', { tag: ['@core', '@window', '@reserve:input'] }, async () => {
  const win = shared.win;
  await focusEditorPanel(win);
  await win.keyboard.press(chordFor('navigate.quickOpen'));
  await expect(win.getByTestId('quickopen')).toBeVisible();
  // Focus in the query field, not merely a modal on screen: this is the chord that used to resolve
  // to nothing at all, so "something appeared" is not enough to call it dispatched.
  await expect(win.getByTestId('quickopen-input')).toBeFocused();
  await win.keyboard.press('Escape');
  await expect(win.getByTestId('quickopen')).toHaveCount(0);
});

test('Go To Line still resolves over the active editor — Ctrl+G', { tag: ['@extended', '@window', '@reserve:input'] }, async () => {
  const win = shared.win;
  await focusEditorPanel(win);
  await win.keyboard.press(chordFor('navigate.gotoLine'));
  await expect(win.getByTestId('gotoline')).toBeVisible();
  await expect(win.getByTestId('gotoline-input')).toBeFocused();
  await win.keyboard.press('Escape');
  await expect(win.getByTestId('gotoline')).toHaveCount(0);
});

test('the panel rename box still resolves — F2', { tag: ['@extended', '@window', '@reserve:input'] }, async () => {
  const win = shared.win;
  await focusEditorPanel(win);
  await win.keyboard.press(chordFor('panel.rename'));
  const input = win.getByTestId(`panel-rename-input-${editorPanel}`);
  await expect(input).toBeVisible();
  // Escape backs out without writing, so the panel keeps the name the rest of the file expects.
  await input.press('Escape');
  await expect(input).toHaveCount(0);
});

test('file undo and redo still resolve with the tree active — Ctrl+Z and Ctrl+Y', { tag: ['@extended', '@window', '@reserve:input'] }, async () => {
  const win = shared.win;
  const tree = win.getByTestId('file-explorer-tree');

  /*
   * `file.undo` / `file.redo` are EXPLORER_ONLY, so the active pane has to be Files & Folders before
   * either chord resolves at all — clicking a row is what puts it there. A file operation also has
   * to exist to reverse, so this renames one and then walks the operation back and forward.
   */
  await tree.getByText(RENAME_FROM, { exact: true }).click();
  await win.keyboard.press('F2');
  const rename = win.locator('input.tree-rename');
  await expect(rename).toBeVisible();
  await rename.fill(RENAME_TO);
  await rename.press('Enter');
  await expect(tree.getByText(RENAME_TO, { exact: true })).toBeVisible({ timeout: 8000 });

  // Undo — on disk, not merely in the tree.
  await tree.getByText(RENAME_TO, { exact: true }).click();
  await win.keyboard.press(chordFor('file.undo'));
  await expect(tree.getByText(RENAME_FROM, { exact: true })).toBeVisible({ timeout: 8000 });
  await expect.poll(() => existsSync(join(root, RENAME_FROM))).toBe(true);

  // Redo — and it is renamed again.
  await tree.getByText(RENAME_FROM, { exact: true }).click();
  await win.keyboard.press(chordFor('file.redo'));
  await expect(tree.getByText(RENAME_TO, { exact: true })).toBeVisible({ timeout: 8000 });
  await expect.poll(() => existsSync(join(root, RENAME_TO))).toBe(true);

  // Leave the tree as this file found it.
  await tree.getByText(RENAME_TO, { exact: true }).click();
  await win.keyboard.press(chordFor('file.undo'));
  await expect(tree.getByText(RENAME_FROM, { exact: true })).toBeVisible({ timeout: 8000 });
});

test('focus cycling still resolves in both directions — Ctrl+` and Ctrl+Shift+`', { tag: ['@extended', '@window', '@reserve:input'] }, async () => {
  const win = shared.win;

  /*
   * The backtick branch is the one that has always kept Shift, and the pair is the reason it does:
   * the two commands differ ONLY by the modifier, so a dropped Shift would not make cycle-back
   * inert — it would silently run cycle-forward instead, which is the harder failure to see.
   */
  await addPanels(win, 1);
  await expect(win.locator('.panel-box')).toHaveCount(2);
  const [p1, p2] = await panelIds(win);

  await win.getByTestId(`panel-${p1}`).click();
  await expect(win.getByTestId(`panel-${p1}`)).toHaveAttribute('data-active', 'true');

  await win.keyboard.press(chordFor('focus.cycle'));
  await expect(win.getByTestId(`panel-${p2}`)).toHaveAttribute('data-active', 'true');
  await expect(win.locator('.panel-box--active')).toHaveCount(1);

  await win.keyboard.press(chordFor('focus.cycleBack'));
  await expect(win.getByTestId(`panel-${p1}`)).toHaveAttribute('data-active', 'true');
  await expect(win.locator('.panel-box--active')).toHaveCount(1);
});

test('fullscreen still resolves — F11', { tag: ['@extended', '@window', '@reserve:input'] }, async () => {
  const { app, win } = shared;
  const isFullScreen = (): Promise<boolean> =>
    app.evaluate(
      ({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isFullScreen() ?? false,
    );

  await win.locator('body').click();
  expect(await isFullScreen()).toBe(false);
  try {
    await win.keyboard.press(chordFor('view.fullscreen'));
    await expect.poll(isFullScreen, { timeout: 10_000 }).toBe(true);
    await win.keyboard.press(chordFor('view.fullscreen'));
    await expect.poll(isFullScreen, { timeout: 10_000 }).toBe(false);
  } finally {
    /*
     * A window left fullscreen would be inherited by whatever runs next in this file, and by the
     * teardown that has to close it. Restoring in `finally` keeps a failure here to ONE failure
     * rather than a cascade that hides which chord actually broke.
     */
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]?.setFullScreen(false),
    );
  }
});
