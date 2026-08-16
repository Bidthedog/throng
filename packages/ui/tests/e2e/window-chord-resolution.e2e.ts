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
 * of them the widening can reach. The first test then fails if that discovered set and this file's
 * coverage table disagree IN EITHER DIRECTION — a new window chord on a letter key, or a default
 * moved off one, both stop the suite until someone decides what covers it.
 *
 * The chords the tests PRESS are derived the same way, so a changed default is exercised as changed
 * rather than asserted against a stale literal.
 */
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect, type Page } from '@playwright/test';
import { shippedBindingsFor } from '@throng/core';
import {
  openApp,
  createProject,
  firstPanelId,
  panelIds,
  addPanels,
  cleanupTemp,
  type OpenApp,
} from './harness.js';

/* ══════════════════════════════════════════════════════════════════════════════════════════════
 * Discovery — the allowlist, the chords, and the branch that carries them
 * ══════════════════════════════════════════════════════════════════════════════════════════════ */

const APP_TSX = fileURLToPath(new URL('../../src/renderer/app.tsx', import.meta.url));

/**
 * The action ids in `app.tsx`'s `HANDLED` set.
 *
 * Half the entries are string literals and half are module constants (`TABS_OPEN_PICKER`,
 * `QUICK_OPEN`, `GOTO_LINE`), so the identifiers are resolved against their declarations in the same
 * file. Every failure mode here THROWS rather than returning a short list: a scanner that quietly
 * finds nothing reports a clean bill of health for an allowlist it never read, which is the same
 * defect as the vacuous guard that FR-053a is about.
 */
function handledActions(): string[] {
  const src = readFileSync(APP_TSX, 'utf8');
  const block = /const HANDLED:[^=]*=\s*new Set\(\[([\s\S]*?)\]\)/.exec(src);
  if (!block) {
    throw new Error(
      `could not find the HANDLED set in ${APP_TSX} — the dispatcher was restructured, and this ` +
        `spec is no longer reading the allowlist it claims to cover`,
    );
  }
  const entries = (block[1] ?? '')
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, '').trim().replace(/,$/, ''))
    .filter((line) => line.length > 0);
  const actions = entries.map((entry) => {
    const literal = /^'([^']+)'$/.exec(entry) ?? /^"([^"]+)"$/.exec(entry);
    if (literal) return literal[1] as string;
    const decl = new RegExp(String.raw`const ${entry}\s*:[^=]*=\s*'([^']+)'`).exec(src);
    if (!decl) {
      throw new Error(`HANDLED entry \`${entry}\` is neither a literal nor a resolvable constant`);
    }
    return decl[1] as string;
  });
  if (actions.length === 0) throw new Error('the HANDLED set parsed as empty');
  return actions;
}

/** The key segment of a binding token — everything after the modifiers. `Ctrl++` → `+`. */
function keyOf(token: string): string {
  let rest = token;
  for (;;) {
    const mod = /^(Ctrl|Control|Shift|Alt|Meta)\+(?=.)/.exec(rest);
    if (!mod) return rest;
    rest = rest.slice(mod[0].length);
  }
}

/**
 * The dispatcher's three `keepShift` branches, restated against a BINDING token.
 *
 * `app.tsx` asks the live event; this asks the chord the event would have to be. The two agree by
 * construction: `chordKey` normalises the physical Backquote to `` ` `` whatever it produced, a
 * function key's `e.key` is its own name, and a letter chord's `e.key` is that letter with case
 * folded away by `normalizeToken`. Restated rather than imported because it is not exported — and
 * `handledActions()` above would catch the dispatcher being restructured underneath it.
 */
function keepsShift(key: string): boolean {
  return key === '`' || /^F\d{1,2}$/.test(key) || /^[a-z]$/i.test(key);
}

/** Every HANDLED action whose shipped chord goes through one of those branches, with those chords. */
function discoverKeepShiftChords(): Map<string, string[]> {
  const bindings = shippedBindingsFor().bindings;
  const found = new Map<string, string[]>();
  for (const action of handledActions()) {
    const chords = (bindings[action] ?? []).filter((token) => keepsShift(keyOf(token)));
    if (chords.length > 0) found.set(action, chords);
  }
  return found;
}

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

/**
 * The actions this file presses, each against the test that presses it.
 *
 * The value is documentation for whoever reads a failure of the manifest test below; the KEY is the
 * part that is checked.
 */
const COVERED: ReadonlyMap<string, string> = new Map([
  ['view.toggleProjects', 'the two pane toggles'],
  ['view.toggleExplorer', 'the two pane toggles'],
  ['tabs.openPicker', 'the tab picker'],
  ['navigate.quickOpen', 'Quick Open — the chord the widening was made for'],
  ['navigate.gotoLine', 'Go To Line over the active editor'],
  ['panel.rename', 'the active panel’s rename box'],
  ['file.undo', 'undo and redo a file operation'],
  ['file.redo', 'undo and redo a file operation'],
  ['focus.cycle', 'cycling panel focus both ways'],
  ['focus.cycleBack', 'cycling panel focus both ways'],
  ['view.fullscreen', 'fullscreen'],
]);

/**
 * The one action covered ELSEWHERE, named with the file that covers it and checked to still be true.
 *
 * `menu.open` is `Shift+F10`, which takes the function-key branch — so it belongs in this file's
 * subject and is deliberately not in it. Asserting it means opening a context menu, and throng closes
 * menus when its window loses focus, which would move this spec into `parallel-plan.json`'s serial
 * list and cost a worker slot for an assertion that already exists a file away.
 *
 * An exemption that names a file is only worth anything while the file still does what it is named
 * for, so the manifest test below reads it and checks the chord is still pressed there. An exemption
 * nobody verifies is how coverage evaporates without anyone deleting a test.
 */
const COVERED_ELSEWHERE: ReadonlyMap<string, { spec: string; press: string }> = new Map([
  ['menu.open', { spec: 'menu-keyboard.e2e.ts', press: 'Shift+F10' }],
]);

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
 * The manifest — what must be covered, discovered rather than declared
 * ══════════════════════════════════════════════════════════════════════════════════════════════ */

test('every window chord the Shift widening can reach is covered — discovered from HANDLED, not listed (SC-021)', () => {
  // The parse found a real allowlist. A silently empty one would make every claim below vacuous.
  expect(handledActions().length, 'HANDLED parsed as suspiciously small').toBeGreaterThan(10);

  const discovered = [...KEEP_SHIFT.keys()].sort();
  const claimed = [...COVERED.keys(), ...COVERED_ELSEWHERE.keys()].sort();
  const uncovered = discovered.filter((a) => !claimed.includes(a));
  const stale = claimed.filter((a) => !discovered.includes(a));

  expect(
    { uncovered, stale },
    `SC-021: this file's coverage and app.tsx's HANDLED allowlist disagree.\n` +
      `  uncovered — a window chord on a backtick, function or letter key that the keepShift branch ` +
      `builds the event for, and that nothing here presses: ${uncovered.join(', ') || '(none)'}\n` +
      `  stale — covered here but no longer reachable that way, usually a default chord moved to ` +
      `another key: ${stale.join(', ') || '(none)'}\n` +
      `Add a test (or an entry in COVERED_ELSEWHERE naming the spec that has one). A regression in ` +
      `this listener is silent — the chord resolves to null and nothing happens — so an uncovered ` +
      `action is a command that can die without a single test going red.`,
  ).toEqual({ uncovered: [], stale: [] });

  // Every exemption still points at a spec that presses the chord.
  for (const [action, { spec, press: chord }] of COVERED_ELSEWHERE) {
    const path = fileURLToPath(new URL(spec, import.meta.url));
    expect(existsSync(path), `${action} is exempted to ${spec}, which does not exist`).toBe(true);
    expect(
      readFileSync(path, 'utf8'),
      `${action} is exempted to ${spec}, which no longer presses ${chord}`,
    ).toContain(chord);
  }
});

/* ══════════════════════════════════════════════════════════════════════════════════════════════
 * The chords themselves. Each test restores whatever it changed.
 * ══════════════════════════════════════════════════════════════════════════════════════════════ */

test('the pane toggles still resolve — Ctrl+Alt+B and Ctrl+Alt+N', async () => {
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

test('the tab picker still resolves — Ctrl+Alt+T', async () => {
  const win = shared.win;
  await win.locator('body').click();
  await win.keyboard.press(chordFor('tabs.openPicker'));
  await expect(win.getByTestId('tabpicker')).toBeVisible();
  await win.keyboard.press('Escape');
  await expect(win.getByTestId('tabpicker')).toHaveCount(0);
});

test('Quick Open still resolves — Ctrl+Shift+T, the chord the widening was made for', async () => {
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

test('Go To Line still resolves over the active editor — Ctrl+G', async () => {
  const win = shared.win;
  await focusEditorPanel(win);
  await win.keyboard.press(chordFor('navigate.gotoLine'));
  await expect(win.getByTestId('gotoline')).toBeVisible();
  await expect(win.getByTestId('gotoline-input')).toBeFocused();
  await win.keyboard.press('Escape');
  await expect(win.getByTestId('gotoline')).toHaveCount(0);
});

test('the panel rename box still resolves — F2', async () => {
  const win = shared.win;
  await focusEditorPanel(win);
  await win.keyboard.press(chordFor('panel.rename'));
  const input = win.getByTestId(`panel-rename-input-${editorPanel}`);
  await expect(input).toBeVisible();
  // Escape backs out without writing, so the panel keeps the name the rest of the file expects.
  await input.press('Escape');
  await expect(input).toHaveCount(0);
});

test('file undo and redo still resolve with the tree active — Ctrl+Z and Ctrl+Y', async () => {
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

test('focus cycling still resolves in both directions — Ctrl+` and Ctrl+Shift+`', async () => {
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

test('fullscreen still resolves — F11', async () => {
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
