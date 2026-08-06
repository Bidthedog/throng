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

test('mouse-only cut and paste — no selection cuts the whole line (FR-012b)', async () => {
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

test('right-clicking INSIDE a selection preserves it; outside collapses it (FR-012a)', async () => {
  const root = makeProject();
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'Menu', root);
      const pid = await openEditorWithFile(win);
      const content = win.getByTestId(`editor-${pid}`).locator('.cm-content');

      // Select the whole first line.
      await content.click();
      await win.keyboard.press('Control+Home');
      await win.keyboard.press('Shift+End');

      // Right-click INSIDE that selection and Copy. The selection must survive the right-click —
      // collapsing it would destroy the very thing the user right-clicked to act on.
      await line(win, pid, 'alpha').click({ button: 'right' });
      await win.getByTestId('menu-item-Copy').click();

      // Paste at the end: a VERBATIM copy of the selection (no trailing newline), so it appends to
      // the line rather than inserting a new one — proving the selection was preserved, not
      // collapsed to a caret (which would have copied the whole LINE and pasted it above).
      await content.click();
      await win.keyboard.press('Control+End');
      await win.keyboard.press('Control+v');
      await expect.poll(() => docText(win, pid)).toBe('alpha\nbeta\ngamma\nalpha');
    });
  } finally {
    cleanupTemp(root);
  }
});

test('right-clicking OUTSIDE a selection moves the caret there (FR-012a)', async () => {
  const root = makeProject();
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'Menu', root);
      const pid = await openEditorWithFile(win);
      const content = win.getByTestId(`editor-${pid}`).locator('.cm-content');

      // Select line 1…
      await content.click();
      await win.keyboard.press('Control+Home');
      await win.keyboard.press('Shift+End');

      // …then right-click on line 3, which is OUTSIDE it. The selection collapses and the caret
      // moves to the click, so Cut takes THAT line — not the one that was selected.
      await line(win, pid, 'gamma').click({ button: 'right' });
      await win.getByTestId('menu-item-Cut').click();

      await expect.poll(() => docText(win, pid)).toBe('alpha\nbeta\n');
    });
  } finally {
    cleanupTemp(root);
  }
});

test('Undo from the content menu reaches the document authority (FR-026b)', async () => {
  const root = makeProject();
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'Menu', root);
      const pid = await openEditorWithFile(win);

      await line(win, pid, 'beta').click({ button: 'right' });
      await win.getByTestId('menu-item-Cut').click();
      await expect.poll(() => docText(win, pid)).toBe('alpha\ngamma\n');

      // The menu's Undo must go to the AUTHORITY. CodeMirror's own `undo` operates on the local
      // `history()` that this feature deleted — a menu item bound to it would be a dead no-op that
      // looks perfectly correct in the source.
      await line(win, pid, 'alpha').click({ button: 'right' });
      await win.getByTestId('menu-item-Undo').click();

      await expect.poll(() => docText(win, pid)).toBe('alpha\nbeta\ngamma\n');
    });
  } finally {
    cleanupTemp(root);
  }
});

test('the CONTENT menu is distinct from the panel-HEADER menu (FR-014)', async () => {
  const root = makeProject();
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'Menu', root);
      const pid = await openEditorWithFile(win);

      // The content menu acts on the TEXT.
      await line(win, pid, 'alpha').click({ button: 'right' });
      await expect(win.getByTestId('menu-item-Cut')).toBeVisible();
      await expect(win.getByTestId('menu-item-Set Language…')).toBeVisible();
      await expect(win.getByTestId('menu-item-Save')).toHaveCount(0); // …not on the panel
      await win.keyboard.press('Escape');

      // The panel-header menu acts on the PANEL, and is unchanged by this feature.
      await win.getByTestId(`panel-handle-${pid}`).click({ button: 'right' });
      await expect(win.getByTestId('menu-item-Save')).toBeVisible();
      await expect(win.getByTestId('menu-item-Cut')).toHaveCount(0); // …not on the text
    });
  } finally {
    cleanupTemp(root);
  }
});

test('a KEYBOARD-opened menu keeps the selection — Cut takes the selected word, not the line', async () => {
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

test('the Set Language item names the current language, and picking one returns focus to the editor', async () => {
  const root = makeProject();
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'Menu', root);
      const pid = await openEditorWithFile(win);

      // lines.txt is plain text, and the menu says so rather than only offering to change it.
      await line(win, pid, 'alpha').click({ button: 'right' });
      const item = win.getByTestId('menu-item-Set Language…');
      await expect(item).toContainText('Plain Text');
      await item.click();
      await expect(win.getByTestId(`language-picker-${pid}`)).toBeVisible({ timeout: 5000 });

      // Choosing puts the caret back in the document — the picker took focus to open, and a user
      // who chose by keyboard would otherwise be left typing into nothing.
      await win.getByTestId('language-option-json').click();
      await expect(win.getByTestId(`language-picker-${pid}`)).toHaveCount(0);
      await expect
        .poll(() =>
          win.evaluate(
            (id) =>
              document.activeElement?.closest(`[data-testid="editor-${id}"]`) != null,
            pid,
          ),
        )
        .toBe(true);

      // …and the menu now names the language that was chosen.
      await line(win, pid, 'alpha').click({ button: 'right' });
      await expect(win.getByTestId('menu-item-Set Language…')).toContainText('JSON');
    });
  } finally {
    cleanupTemp(root);
  }
});

test('“Set Language…” opens the SAME picker the status strip does (FR-010/FR-012)', async () => {
  const root = makeProject();
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'Menu', root);
      const pid = await openEditorWithFile(win);

      await line(win, pid, 'alpha').click({ button: 'right' });
      await win.getByTestId('menu-item-Set Language…').click();

      await expect(win.getByTestId(`language-picker-${pid}`)).toBeVisible({ timeout: 5000 });
    });
  } finally {
    cleanupTemp(root);
  }
});
