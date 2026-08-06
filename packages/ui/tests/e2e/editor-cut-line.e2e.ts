import { existsSync, mkdirSync, mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
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
 * US3 — `Ctrl+X` cuts the current line (016, FR-016/FR-016a/FR-015a · T065).
 *
 * The headline proof here is the LAST test: the same chord cuts a LINE in an editor and a FILE in
 * the File Explorer, and the two never touch each other. That is the whole reason dispatch has a
 * scope — a resolver that could not tell them apart would either delete a file when the user meant
 * a line, or refuse to cut a line at all.
 */

function makeProject(): string {
  const root = mkdtempSync(join(tmpdir(), 'throng-cutline-'));
  writeFileSync(join(root, 'lines.txt'), 'alpha\nbeta\ngamma\n');
  writeFileSync(join(root, 'victim.txt'), 'cut me\n');
  mkdirSync(join(root, 'sub'));
  return root;
}

async function openFileInEditor(win: Page, name: string, expectText: string): Promise<string> {
  const pid = await firstPanelId(win);
  await win.getByTestId(`panel-type-select-${pid}`).selectOption('editor');
  await win.getByTestId(`panel-type-confirm-${pid}`).click();
  await win.getByTestId(`editor-${pid}`).click();
  await win.getByTestId('file-explorer-tree').getByText(name, { exact: true }).click();
  await expect(win.getByTestId(`editor-${pid}`).locator('.cm-content')).toContainText(expectText, {
    timeout: 8000,
  });
  return pid;
}

/** The editor's whole document, as the user sees it. */
const docText = (win: Page, pid: string): Promise<string> =>
  win.evaluate(
    (id) =>
      [...document.querySelectorAll(`[data-testid="editor-${id}"] .cm-line`)]
        .map((l) => (l.textContent === '​' ? '' : l.textContent))
        .join('\n'),
    pid,
  );

test('Ctrl+X with no selection cuts the whole line, and it pastes back as a line', async () => {
  const root = makeProject();
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'CutLine', root);
      const pid = await openFileInEditor(win, 'lines.txt', 'alpha');
      const content = win.getByTestId(`editor-${pid}`).locator('.cm-content');

      // Put the caret on "beta" with NO selection, and cut.
      await content.click();
      await win.keyboard.press('Control+Home');
      await win.keyboard.press('ArrowDown'); // …line 2
      await win.keyboard.press('Control+x');

      // The line is gone ENTIRELY — not blanked, not left as an empty line.
      await expect.poll(() => docText(win, pid)).toBe('alpha\ngamma\n');

      // Paste it back with the caret in the MIDDLE of a word. A full-line entry inserts as a whole
      // line ABOVE, leaving the line it landed on unsplit — the point of remembering the shape.
      await win.keyboard.press('Control+Home');
      await win.keyboard.press('ArrowRight');
      await win.keyboard.press('ArrowRight'); // …inside "alpha", between "al" and "pha"
      await win.keyboard.press('Control+v');

      await expect.poll(() => docText(win, pid)).toBe('beta\nalpha\ngamma\n');
    });
  } finally {
    cleanupTemp(root);
  }
});

test('a selection is cut EXACTLY — Ctrl+X never widens it to the whole line', async () => {
  const root = makeProject();
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'CutLine', root);
      const pid = await openFileInEditor(win, 'lines.txt', 'alpha');
      const content = win.getByTestId(`editor-${pid}`).locator('.cm-content');

      // Select just "al" of "alpha", then cut. Losing the line here would be the worst possible
      // failure of a cut: text destroyed that the user never selected.
      await content.click();
      await win.keyboard.press('Control+Home');
      await win.keyboard.press('Shift+ArrowRight');
      await win.keyboard.press('Shift+ArrowRight');
      await win.keyboard.press('Control+x');

      await expect.poll(() => docText(win, pid)).toBe('pha\nbeta\ngamma\n');

      // …and it pastes back verbatim, INTO the line — not above it.
      await win.keyboard.press('Control+v');
      await expect.poll(() => docText(win, pid)).toBe('alpha\nbeta\ngamma\n');
    });
  } finally {
    cleanupTemp(root);
  }
});

test('one Ctrl+Z restores a cut line — a command is ONE undo entry (FR-026)', async () => {
  const root = makeProject();
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'CutLine', root);
      const pid = await openFileInEditor(win, 'lines.txt', 'alpha');
      const content = win.getByTestId(`editor-${pid}`).locator('.cm-content');

      await content.click();
      await win.keyboard.press('Control+Home');
      await win.keyboard.press('Control+x');
      await expect.poll(() => docText(win, pid)).toBe('beta\ngamma\n');

      await win.keyboard.press('Control+z');
      await expect.poll(() => docText(win, pid)).toBe('alpha\nbeta\ngamma\n');
    });
  } finally {
    cleanupTemp(root);
  }
});

test('in the File Explorer, Ctrl+X still cuts a FILE — the scopes are disjoint (D6)', async () => {
  const root = makeProject();
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'CutLine', root);
      const pid = await openFileInEditor(win, 'lines.txt', 'alpha');

      // Click a file in the TREE. That both opens it in the editor and gives the tree the focus —
      // so the app now has a live editor holding a document, and the keyboard aimed at the explorer.
      const victim = win.getByTestId('file-explorer-tree').getByText('victim.txt', { exact: true });
      await victim.click();
      await expect(win.getByTestId(`editor-${pid}`).locator('.cm-content')).toContainText('cut me');
      const beforeCut = await docText(win, pid);

      // …and press the very chord that cuts a LINE inside the editor.
      await win.keyboard.press('Control+x');

      // The DOCUMENT is untouched. The editor never saw the key — had it, the line "cut me" would
      // have vanished. This is the whole point of scoping dispatch.
      expect(await docText(win, pid)).toBe(beforeCut);

      // …and the FILE really was cut, not merely ignored: pasting into the subfolder MOVES it.
      await win.getByTestId('file-explorer-tree').getByText('sub', { exact: true }).click();
      await win.keyboard.press('Control+v');

      await expect
        .poll(() => existsSync(join(root, 'sub', 'victim.txt')), { timeout: 8000 })
        .toBe(true);
      expect(existsSync(join(root, 'victim.txt'))).toBe(false); // …moved, not copied
      // The editor's own file is untouched throughout.
      expect(readFileSync(join(root, 'lines.txt'), 'utf8')).toBe('alpha\nbeta\ngamma\n');
    });
  } finally {
    cleanupTemp(root);
  }
});
