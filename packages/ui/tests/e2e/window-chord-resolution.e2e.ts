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
import { basename, join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import {
  openApp,
  createProject,
  firstPanelId,
  panelIds,
  addPanels,
  switchProject,
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
  /*
   * A DIGIT is pressed by its physical code (046 T049). Measured on this engine: `Control+Shift+0`
   * arrives as key `0`, code `Digit0` — a shifted digit no keyboard produces, which even the pre-046
   * dispatcher resolved (it dropped Shift and read `Ctrl+0`) — while `Control+Shift+Digit0` arrives
   * as key `)`, code `Digit0`, which is what a US keyboard sends and what FR-026 is about.
   */
  const tail =
    key === '`'
      ? 'Backquote'
      : /^[0-9]$/.test(key)
        ? `Digit${key}`
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
/** Extra temp roots a test made; removed after the app has closed and released them. */
const cleanupAfter: string[] = [];
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
  for (const dir of cleanupAfter) cleanupTemp(dir);
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

test('the pane toggles still resolve — Ctrl+Shift+Alt+J and Ctrl+Shift+Alt+K', { tag: ['@extended', '@window', '@reserve:input'] }, async () => {
  const win = shared.win;
  await win.locator('body').click();

  // Projects (left): shown → collapsed → shown again.
  await expect(win.getByTestId('pane-hide-left')).toBeVisible();
  await win.keyboard.press(chordFor('view.toggleProjects'));
  await expect(win.getByTestId('pane-rail-left')).toBeVisible();
  await win.keyboard.press(chordFor('view.toggleProjects'));
  await expect(win.getByTestId('pane-hide-left')).toBeVisible();

  // File Explorer (right): the same, with the project open.
  await expect(win.getByTestId('pane-hide-right')).toBeVisible();
  await win.keyboard.press(chordFor('view.toggleExplorer'));
  await expect(win.getByTestId('pane-rail-right')).toBeVisible();
  await win.keyboard.press(chordFor('view.toggleExplorer'));
  await expect(win.getByTestId('pane-hide-right')).toBeVisible();
});

test('the tab picker still resolves — Ctrl+Shift+Alt+T', { tag: ['@extended', '@window', '@reserve:input'] }, async () => {
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
   * `file.undo` / `file.redo` are EXPLORER_ONLY, so the active pane has to be File Explorer before
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

test('find and replace in files still resolve — Ctrl+Shift+F and Ctrl+Shift+H (043 T107)', { tag: ['@core', '@window', '@reserve:input'] }, async () => {
  /*
   * 043 (#220, #153) — the second `Ctrl+Shift+<letter>` pair, and the reason this file exists.
   *
   * Both chords take the LETTER branch of `keepShift`, which is the branch `Ctrl+Shift+T` produced:
   * before the widening, a shifted letter arrived at the resolver with the Shift dropped, matched
   * no binding, and did nothing at all — no throw, no log, nothing to see. Two more chords of
   * exactly that shape are what `window-chords.ts`'s COVERED map claims are pressed here, and this
   * is the press.
   *
   * ══ WHY IT IS IRREDUCIBLE ══
   *
   * Real keyboard and input dispatch. The event is BUILT in a window-level capture listener from a
   * live `KeyboardEvent`'s `key` and modifier flags, and what is under test is whether a real
   * keystroke survives that construction. `window-chord-manifest.test.ts` already asserts the
   * allowlist and the branch predicate at the unit layer without pressing anything, which is
   * exactly why the pressing half has to be here.
   *
   * ══ WHY BOTH CHORDS ARE ONE TEST ══
   *
   * They are one command (FR-029d): replace in files is find in files with the replacement row
   * pre-enabled, honouring the same reuse rules. The second press asserted separately would need
   * its own panel and would then be asserting the reuse rule rather than the dispatch. Pressed in
   * sequence, the SECOND chord's evidence is that it reached the same panel and moved the caret
   * into a different field — which no first press could produce.
   */
  const win = shared.win;
  await focusEditorPanel(win);

  // FIND IN FILES — a panel that did not exist appears in this tab, with the caret in its input.
  // Focus, not merely presence: an inert chord and a chord that opened something the user then has
  // to click into are different failures, and the second is the one the widening actually caused.
  await win.keyboard.press(chordFor('search.findInFiles'));
  const panel = win.locator('[data-testid^="fif-panel-"]');
  await expect(panel).toHaveCount(1, { timeout: 10_000 });
  const panelId = (await panel.getAttribute('data-testid'))?.replace('fif-panel-', '') ?? '';
  expect(panelId).not.toBe('');
  await expect(win.getByTestId(`fif-term-${panelId}`)).toBeFocused();
  // Nothing was typed, so nothing was searched: the panel reports "not run" rather than a scan.
  await expect(win.getByTestId(`fif-status-${panelId}`)).toHaveAttribute('data-state', 'notRun');

  // REPLACE IN FILES — the same command, so the same panel is reused rather than a second opened,
  // the replacement row is disclosed, and the caret moves to it (FR-029d, FR-031c).
  await win.keyboard.press(chordFor('search.replaceInFiles'));
  await expect(panel).toHaveCount(1);
  await expect(win.getByTestId(`fif-replace-row-${panelId}`)).toBeVisible();
  await expect(win.getByTestId(`fif-replacement-${panelId}`)).toBeFocused();

  // Leave the tab as this file found it — the panel is empty, so its × asks nothing.
  await win.getByTestId(`panel-close-${panelId}`).click();
  await expect(panel).toHaveCount(0);
});

/** Every chunk a terminal view has put on the wire, from its own diagnostics (see quick-open.e2e.ts). */
async function inputWrites(win: Page, panelId: string): Promise<string[] | null> {
  return win.evaluate((id) => {
    const probe = (
      window as unknown as { __throngTerminalDiagnostics?: () => Record<string, { writes: string[] }> }
    ).__throngTerminalDiagnostics;
    return probe?.()[id]?.writes ?? null;
  }, panelId);
}

/**
 * `CSI I` / `CSI O` — a focus report, as `diagnostics.ts` stores it (`JSON.stringify`, so the log
 * holds the escape spelled out). Not a keystroke: a chord that moves focus makes a terminal with
 * focus reporting on answer the real focus change, and that is 028's behaviour, not a leak.
 */
const FOCUS_REPORTS = new Set(['\\u001b[I', '\\u001b[O']);

const zoomLevel = (app: OpenApp['app']): Promise<number> =>
  app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.webContents.getZoomLevel() ?? NaN);

test('from a focused real terminal, Ctrl+Shift+Alt+Numpad0, Ctrl+Shift+Alt+M and Ctrl+Shift+Alt+PageDown reach the app and the shell receives nothing (046 T049, re-pointed T164/FR-114, T181/FR-117)', { tag: ['@extended', '@window', '@reserve:input'] }, async () => {
  /*
   * 046 FR-027, FR-016, FR-010 — three window chords pressed with a REAL shell holding the keyboard.
   *
   * ══ WHY IT IS IRREDUCIBLE ══
   *
   * `zoom.reset` resolves through `chordCandidates`' PHYSICAL code match: the dispatcher reads
   * `e.code` (`Numpad0`) rather than trusting `e.key`, which a real keypad reports differently
   * depending on NumLock and Shift (`'0'`, or the documented Shift+NumLock quirk `'Insert'`). Only a
   * real engine reports a genuine `code` for a physical keypad press; window-zoom-reset-shift.test.ts
   * proves the dispatch over an event it built itself, and cannot say what the engine sends. The
   * other half — the shell gets NOTHING — needs a real terminal view wired to a real ConPTY.
   *
   * 046 iterate round 2 (T164, FR-114) — the maintainer's own words, mid-build: "The 'Zoom Reset' key
   * bindings need to use the numpad zero, NOT the 0 key." Re-pointed from a `Control+Shift+Alt+0`
   * (Digit0) press to the Numpad0-coded one the shipped default now actually needs.
   *
   * ══ HOW "NOTHING" IS READ ══
   *
   * The terminal view's own write log (028 diagnostics): every chunk it put on the wire to the shell,
   * in order. quick-open.e2e.ts's AS-1 settled why the log and not the screen — a chord a shell
   * swallows silently leaves the screen unchanged, so an unchanged screen proves nothing. A byte echo
   * (`cat -v` in Git Bash) was tried first and dropped: measured, it ended by itself on 5 of ~20
   * runs with the log holding only the command that started it, which made it a witness that fails
   * for reasons of its own.
   */
  const { app, win } = shared;
  const nextRoot = mkdtempSync(join(tmpdir(), 'throng-chords-next-'));
  cleanupAfter.push(nextRoot);

  // A SECOND project, created after ChordProj so it is the one Ctrl+Shift+Alt+PageDown steps to — then back.
  await createProject(win, 'ChordNext', nextRoot);
  await switchProject(win, 'ChordProj');

  // The empty panel focus cycling left behind, when there is one, rather than a third narrow split.
  let pid = '';
  for (const id of await panelIds(win)) {
    if (id !== editorPanel && (await win.getByTestId(`panel-type-select-${id}`).count()) > 0) pid = id;
  }
  if (pid === '') {
    await addPanels(win, 1);
    const ids = await panelIds(win);
    pid = ids[ids.length - 1] as string;
  }
  await win.getByTestId(`panel-type-select-${pid}`).selectOption('terminal');
  await win.getByTestId('terminal-flavour').selectOption('cmd');
  await win.getByTestId(`panel-type-confirm-${pid}`).click();
  const term = win.getByTestId(`terminal-${pid}`);
  await expect(term).toContainText(basename(root), { timeout: 30_000 });

  const textarea = term.locator('.xterm-helper-textarea');
  await term.click();
  await expect(textarea).toBeFocused();

  // The probe proves it can MOVE before it is asked to stay still (FR-053b's standard).
  const beforeProof = (await inputWrites(win, pid)) ?? [];
  await win.keyboard.type('x');
  await expect.poll(async () => ((await inputWrites(win, pid)) ?? []).length).toBeGreaterThan(beforeProof.length);
  await win.keyboard.press('Backspace');

  /** What the view wrote since `before`, focus reports aside — read at once, while the view lives. */
  const leaked = async (before: string[]): Promise<string[]> => {
    const now = await inputWrites(win, pid);
    expect(now, 'the terminal view has no write log — the probe is reading nothing').not.toBeNull();
    return (now ?? []).slice(before.length).filter((chunk) => !FOCUS_REPORTS.has(chunk));
  };

  // ── Ctrl+Shift+Alt+Numpad0 resets a zoomed window (FR-027, FR-114). ─────────────────────────
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.webContents.setZoomLevel(2));
  await expect.poll(() => zoomLevel(app)).toBe(2);
  await expect(textarea).toBeFocused();
  const beforeZoom = (await inputWrites(win, pid)) ?? [];
  const zoomReset = KEEP_SHIFT.get('zoom.reset')?.find((t) => /(^|\+)Shift\+/.test(t));
  expect(zoomReset, 'zoom.reset ships no Shift chord to press').toBeDefined();
  await win.evaluate(() => {
    const w = window as unknown as { __t049Key?: string };
    w.__t049Key = undefined;
    const note = (e: KeyboardEvent): void => {
      if (['Control', 'Shift', 'Alt'].includes(e.key)) return;
      w.__t049Key = `${e.key}|${e.code}`;
      window.removeEventListener('keydown', note, true);
    };
    window.addEventListener('keydown', note, true);
  });
  await win.keyboard.press(press(zoomReset as string));
  // The claim is about the PHYSICAL code, not the produced key — a real keypad reports a different
  // `key` depending on NumLock and Shift (FR-114's whole point: `code` decides, not `key`), so only
  // `code` is asserted here.
  expect(await win.evaluate(() => (window as unknown as { __t049Key?: string }).__t049Key)).toMatch(/\|Numpad0$/);
  await expect.poll(() => zoomLevel(app), { message: 'Ctrl+Shift+Alt+Numpad0 did not reset the zoom' }).toBe(0);
  expect(await leaked(beforeZoom), 'Ctrl+Shift+Alt+Numpad0 reached the shell').toEqual([]);

  // ── Ctrl+Shift+Alt+M focuses the File Explorer (FR-016, FR-117). ───────────────────────────────
  const beforeFocus = (await inputWrites(win, pid)) ?? [];
  await win.keyboard.press(chordFor('focus.explorer'));
  await expect
    .poll(() => win.evaluate(() => document.activeElement?.closest('[data-testid="file-explorer-tree"]') !== null))
    .toBe(true);
  expect(await leaked(beforeFocus), 'Ctrl+Shift+Alt+M reached the shell').toEqual([]);

  // ── Ctrl+Shift+Alt+PageDown switches project (FR-010). ───────────────────────────────────────
  await term.click();
  await expect(textarea).toBeFocused();
  const beforeSwitch = (await inputWrites(win, pid)) ?? [];
  /*
   * The switch takes this view away, and its log with it (`forgetDiagnostics` on unmount), so the log
   * is copied in the page on the chord's own KEYUP — after the keydown has been fully dispatched, which
   * is when a leaked key would have been written, and before the new project's layout can arrive over
   * IPC. A copy that is missing fails below rather than passing as "nothing written".
   */
  await win.evaluate((id) => {
    const w = window as unknown as {
      __throngTerminalDiagnostics?: () => Record<string, { writes: string[] }>;
      __t049Writes?: string[] | null;
    };
    w.__t049Writes = undefined;
    window.addEventListener(
      'keyup',
      () => {
        w.__t049Writes = w.__throngTerminalDiagnostics?.()[id]?.writes ?? null;
      },
      { capture: true, once: true },
    );
  }, pid);
  await win.keyboard.press(chordFor('project.next'));
  await expect(win.locator('.project-item', { hasText: 'ChordNext' })).toHaveAttribute('data-active', 'true');
  const atKeyup = await win.evaluate(() => (window as unknown as { __t049Writes?: string[] | null }).__t049Writes ?? null);
  expect(atKeyup, 'the terminal view was gone by the chord’s keyup — the probe read nothing').not.toBeNull();
  expect(
    (atKeyup ?? []).slice(beforeSwitch.length).filter((chunk) => !FOCUS_REPORTS.has(chunk)),
    'Ctrl+Shift+Alt+PageDown reached the shell',
  ).toEqual([]);

  await switchProject(win, 'ChordProj'); // leave the file where later tests would expect it
});
