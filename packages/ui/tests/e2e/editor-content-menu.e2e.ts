import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
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
 * Each test used to launch its own Electron app, daemon and window — roughly two seconds apiece, and
 * 604 such launches across the suite — to run assertions that never needed a pristine app. Only a
 * test that seeds state BEFORE launch genuinely does, and those keep their own app via `runOwnApp`.
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
      'this file shares one app; a test needing launch options must call runOwnApp instead',
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
 * US2 — the editor CONTENT context menu (016, FR-012/FR-012a/FR-012b · T060).
 *
 * Mouse-only editing: a user who never touches Ctrl+X must be able to cut, copy and paste. And the
 * menu must be the CONTENT's, not the panel's — right-clicking text offers Cut, not Save.
 */

function makeProject(): string {
  const root = mkdtempSync(join(tmpdir(), 'throng-cmenu-'));
  writeFileSync(join(root, 'lines.txt'), 'alpha\nbeta\ngamma\n');
  return root;
}

async function openEditorWithFile(win: Page): Promise<string> {
  const pid = await firstPanelId(win);
  await win.getByTestId(`panel-type-select-${pid}`).selectOption('editor');
  await win.getByTestId(`panel-type-confirm-${pid}`).click();
  await win.getByTestId(`editor-${pid}`).click();
  await win.getByTestId('file-explorer-tree').getByText('lines.txt', { exact: true }).click();
  await expect(win.getByTestId(`editor-${pid}`).locator('.cm-content')).toContainText('alpha', {
    timeout: 8000,
  });
  return pid;
}

const docText = (win: Page, pid: string): Promise<string> =>
  win.evaluate(
    (id) =>
      [...document.querySelectorAll(`[data-testid="editor-${id}"] .cm-line`)]
        .map((l) => (l.textContent === '​' ? '' : l.textContent))
        .join('\n'),
    pid,
  );

/** The line element, by its text — a stable place to aim a right-click. */
const line = (win: Page, pid: string, text: string) =>
  win.getByTestId(`editor-${pid}`).locator('.cm-line').filter({ hasText: text }).first();

/*
 * ── THREE OF THE FOUR MOVED (035 T055) ──
 *
 * `packages/ui/tests/component/editor-content-menu.test.ts` now owns what the menu's items DO:
 *
 *   :123  right-clicking INSIDE a selection preserves it; outside collapses it (FR-012a)
 *   :154  right-clicking OUTSIDE a selection moves the caret there (FR-012a)
 *   :179  Undo from the content menu reaches the document authority (FR-026b)
 *
 * The menu had TWO unit tests already — `menu-icon-tokens.test.ts` and `menu-sections.test.ts` —
 * asserting every label, icon, section and shortcut on it. Both build it with `{} as EditorView`,
 * because neither ever calls an `onClick`. So the list was proven exhaustively and every handler
 * behind it was proven NOWHERE, and these three E2Es were the only thing between a menu that reads
 * correctly and a menu that does nothing.
 *
 * `placeCaretForContextMenu` had no test of any kind, including for the Shift+F10 trap it carries a
 * guard against: a keyboard-opened menu supplies the focused element's corner as its coordinates,
 * so moving the caret there destroys the selection the user opened the menu to act on, and Cut
 * takes the whole line. Shipped and unguarded until now.
 *
 * ── WHY :97 STAYS ──
 *
 * The verdict said all four, and this is a deliberate partial decline. What no lower layer sees is
 * the WIRING: that a right-click on a rendered `.cm-line` reaches `placeCaretForContextMenu` with
 * coordinates `posAtCoords` can resolve, and that the item the user clicks is the CONTENT menu's
 * rather than the panel header's. jsdom has no layout, so the component test stubs `posAtCoords`
 * outright — which is correct for testing the decision and proves nothing about the measurement.
 * One test buys that, so one test keeps it.
 */
test('mouse-only cut and paste — no selection cuts the whole line (FR-012b)', { tag: ['@extended', '@editor'] }, async () => {
  const root = makeProject();
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'Menu', root);
      const pid = await openEditorWithFile(win);

      // Right-click IN a line, with nothing selected, and Cut. The item is never disabled for want
      // of a selection: the line is the unit, which is what the user plainly meant.
      await line(win, pid, 'beta').click({ button: 'right' });
      await win.getByTestId('menu-item-Cut').click();

      await expect.poll(() => docText(win, pid)).toBe('alpha\ngamma\n');

      // …and paste it back, from the menu, with the caret inside another line. A full-line entry
      // goes in as a whole line ABOVE, leaving the line it landed on unsplit (FR-015a).
      await line(win, pid, 'gamma').click({ button: 'right' });
      await win.getByTestId('menu-item-Paste').click();

      await expect.poll(() => docText(win, pid)).toBe('alpha\nbeta\ngamma\n');
    });
  } finally {
    cleanupTemp(root);
  }
});

/*
 * ONE TEST REMOVED (035 T055) — "the CONTENT menu is distinct from the panel-HEADER menu (FR-014)",
 * now `packages/ui/tests/unit/menu-icon-tokens.test.ts`.
 *
 * It launched Electron, created a project on a real temp directory, opened a file in an editor
 * panel, right-clicked a rendered line, read the menu, pressed Escape, right-clicked the panel
 * handle and read the other one — to compare two label lists.
 *
 * Both lists are produced by pure functions. `editorContentMenu` touches its `view` only inside the
 * `onClick` closures, which is why that file's existing harness already builds it with
 * `{} as EditorView`, and `panelHeaderMenu` takes a plain panel record. Neither needs a document, a
 * selection, a project or a window to say what it contains.
 *
 * ── STRONGER THERE THAN HERE ──
 *
 * This test named four labels. The unit version keeps those four AND asserts that NO label appears
 * in both menus — the rule rather than four examples of it. That is what catches an item added to
 * the wrong builder, which is the regression FR-014 exists to prevent and precisely what four
 * literals sail past.
 *
 * The disjointness check is paired with a positive control, because two EMPTY menus satisfy it.
 *
 * Red-proven against three mutations: save-in-content (3 red), cut-in-header (2 red, and note it is
 * caught from BOTH directions), no-set-language (3 red).
 */

test('a KEYBOARD-opened menu keeps the selection — Cut takes the selected word, not the line', { tag: ['@extended', '@editor', '@reserve:layout'] }, async () => {
  const root = makeProject();
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'Menu', root);
      const pid = await openEditorWithFile(win);

      // Select "beta" from the keyboard: to the start of that line, then Shift+End.
      await line(win, pid, 'beta').click();
      await win.keyboard.press('Home');
      await win.keyboard.press('Shift+End');

      // Shift+F10 re-dispatches a synthetic contextmenu carrying the focused element's corner as
      // its coordinates. Treated as a real click, that landed outside the selection and collapsed
      // it — so Cut took the whole line, deleting a newline the user never selected.
      await win.keyboard.press('Shift+F10');
      await expect(win.getByTestId('menu-item-Cut')).toBeVisible();
      await win.getByTestId('menu-item-Cut').click();

      // The word goes; its line stays behind, empty.
      await expect.poll(() => docText(win, pid)).toBe('alpha\n\ngamma\n');
    });
  } finally {
    cleanupTemp(root);
  }
});

/**
 * Choosing a language returns the caret to the DOCUMENT.
 *
 * ── WHAT LEFT (035 T055) ──
 *
 * This test also asserted that the menu item NAMES the current language ("Plain Text") and, after a
 * change, names the new one ("JSON"). Both are `args.languageName` reaching a template in
 * `content-menu.ts`, and both are now `unit/menu-icon-tokens.test.ts` — together with two branches
 * this could not reach: a document with NO language, and the `Set Language… (undefined)` a template
 * literal produces when nobody checks the optional. Red-proven by never-names (2 red) and
 * undefined-leak (3 red).
 *
 * What is left needs a real editor. The picker takes focus to open, so a user who chose by keyboard
 * would otherwise be left typing into nothing — and "the caret is back in the document" is
 * `document.activeElement.closest('[data-testid="editor-…"]')` against a real CodeMirror.
 * `component/language-picker-keyboard.test.ts` owns the picker's own keyboard behaviour; where the
 * caret lands afterwards is not something that file can say.
 */
test('picking a language returns focus to the editor', { tag: ['@extended', '@editor', '@reserve:focus'] }, async () => {
  const root = makeProject();
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'Menu', root);
      const pid = await openEditorWithFile(win);

      await line(win, pid, 'alpha').click({ button: 'right' });
      await win.getByTestId('menu-item-Set Language…').click();
      await expect(win.getByTestId(`language-picker-${pid}`)).toBeVisible({ timeout: 5000 });

      await win.getByTestId('language-option-json').click();
      await expect(win.getByTestId(`language-picker-${pid}`)).toHaveCount(0);
      await expect
        .poll(() =>
          win.evaluate(
            (id) => document.activeElement?.closest(`[data-testid="editor-${id}"]`) != null,
            pid,
          ),
        )
        .toBe(true);
    });
  } finally {
    cleanupTemp(root);
  }
});

/*
 * DELETED (034 FR-045): "“Set Language…” opens the SAME picker the status strip does".
 *
 * A strict subset of the test directly above it, IN THIS FILE. Both open the same project, open the
 * same editor on the same file, right-click the same line, click the same `menu-item-Set Language…`
 * and assert the same `language-picker-${pid}` is visible. The one above then goes on to check the
 * item names the CURRENT language, that choosing returns the caret to the document, and that the
 * item afterwards names the language that was chosen.
 *
 * So the deleted test asserted nothing its neighbour did not already assert on the way past — and
 * cost a whole Electron launch to do it. Its title claims a comparison with the status strip that
 * it never actually made: it never opened the status strip.
 */
