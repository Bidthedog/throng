import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
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


// 013 US4 — replace in the active editor. The two properties that matter beyond "the text
// changed": replace-all is ONE undoable step (FR-008), and the file's encoding and line
// endings survive it untouched (SC-004) — a replace must not silently rewrite the file's
// shape, which is exactly what a naive read-modify-write would do.

async function newEditor(win: Page): Promise<string> {
  const pid = await firstPanelId(win);
  await win.getByTestId(`panel-type-select-${pid}`).selectOption('editor');
  await win.getByTestId(`panel-type-confirm-${pid}`).click();
  await expect(win.getByTestId(`editor-${pid}`)).toBeVisible();
  return pid;
}

/** Open a file from the tree, then put focus back in the editor (find is a panel command). */
async function openFile(win: Page, pid: string, name: string, expectText: string): Promise<void> {
  await win.getByTestId(`editor-${pid}`).click();
  await win.getByTestId('file-explorer-tree').getByText(name, { exact: true }).click();
  await expect(win.getByTestId(`editor-${pid}`).locator('.cm-content')).toContainText(expectText, {
    timeout: 15000,
  });
  await win.getByTestId(`editor-${pid}`).locator('.cm-content').click();
}

test('replace-all rewrites every match in one undoable step, preserving CRLF (SC-004)', async () => {
  const root = mkdtempSync(join(tmpdir(), 'throng-repl-'));
  const file = join(root, 'crlf.txt');
  try {
    // A CRLF file — the shape the replace must not disturb.
    writeFileSync(file, 'alpha one\r\nalpha two\r\nbeta three\r\n', 'utf8');

    await runApp(async (_app, win) => {
      await createProject(win, 'ReplProj', root);
      const pid = await newEditor(win);
      await openFile(win, pid, 'crlf.txt', 'alpha one');

      // Ctrl+H opens find WITH the replace controls (editor only).
      await win.keyboard.press('Control+h');
      await expect(win.getByTestId(`find-bar-${pid}`)).toBeVisible();
      await expect(win.getByTestId('find-replace-row')).toBeVisible();

      await win.getByTestId('find-input').fill('alpha');
      await expect(win.getByTestId('find-count')).toHaveText('1 of 2');
      await win.getByTestId('replace-input').fill('OMEGA');

      // Replace every match at once; the count empties out.
      await win.getByTestId('replace-all').click();
      await expect(win.getByTestId('find-count')).toHaveText('No results');

      await win.keyboard.press('Escape');
      await win.keyboard.press('Control+s');

      // Only the intended text changed — and the file is still CRLF, still UTF-8.
      await expect
        .poll(() => readFileSync(file, 'utf8'), { timeout: 8000 })
        .toBe('OMEGA one\r\nOMEGA two\r\nbeta three\r\n');
      const bytes = readFileSync(file);
      expect(bytes.includes(0x0d), 'CRLF line endings were rewritten').toBe(true);

      // ONE undo puts the whole replace-all back (FR-008): not two, not three.
      await win.getByTestId(`editor-${pid}`).locator('.cm-content').click();
      await win.keyboard.press('Control+z');
      await win.keyboard.press('Control+s');
      await expect
        .poll(() => readFileSync(file, 'utf8'), { timeout: 8000 })
        .toBe('alpha one\r\nalpha two\r\nbeta three\r\n');
    });
  } finally {
    cleanupTemp(root);
  }
});

test('replace-current changes only the current match and advances to the next', async () => {
  const root = mkdtempSync(join(tmpdir(), 'throng-repl-'));
  const file = join(root, 'one.txt');
  try {
    writeFileSync(file, 'dup\ndup\ndup\n', 'utf8');

    await runApp(async (_app, win) => {
      await createProject(win, 'ReplOne', root);
      const pid = await newEditor(win);
      await openFile(win, pid, 'one.txt', 'dup');

      await win.keyboard.press('Control+h');
      await win.getByTestId('find-input').fill('dup');
      await expect(win.getByTestId('find-count')).toHaveText('1 of 3');
      await win.getByTestId('replace-input').fill('X');

      // One match replaced ⇒ two left, and the selection has moved on to the next.
      await win.getByTestId('replace-current').click();
      await expect(win.getByTestId('find-count')).toHaveText(/ of 2$/);

      await win.keyboard.press('Escape');
      await win.keyboard.press('Control+s');
      await expect.poll(() => readFileSync(file, 'utf8'), { timeout: 8000 }).toBe('X\ndup\ndup\n');
    });
  } finally {
    cleanupTemp(root);
  }
});

test('editing the document while find is open does not misplace a later replace', async () => {
  const root = mkdtempSync(join(tmpdir(), 'throng-repl-'));
  const file = join(root, 'shift.txt');
  try {
    writeFileSync(file, 'target one\ntarget two\n', 'utf8');

    await runApp(async (_app, win) => {
      await createProject(win, 'ReplShift', root);
      const pid = await newEditor(win);
      await openFile(win, pid, 'shift.txt', 'target one');

      // Find the matches — their offsets are recorded now.
      await win.keyboard.press('Control+h');
      await win.getByTestId('find-input').fill('target');
      await expect(win.getByTestId('find-count')).toHaveText('1 of 2');
      await win.getByTestId('replace-input').fill('HIT');

      // …then type a line ABOVE them, shifting every match along. Replacing at the offsets
      // remembered a moment ago would now scribble over the wrong characters entirely.
      const content = win.getByTestId(`editor-${pid}`).locator('.cm-content');
      await content.click();
      await win.keyboard.press('Control+Home');
      await win.keyboard.type('PREFIX LINE\n');

      await win.getByTestId('replace-all').click();

      await win.keyboard.press('Escape');
      await win.keyboard.press('Control+s');

      // The replacement landed on the real matches, and the inserted line is intact.
      await expect
        .poll(() => readFileSync(file, 'utf8'), { timeout: 8000 })
        .toBe('PREFIX LINE\nHIT one\nHIT two\n');
    });
  } finally {
    cleanupTemp(root);
  }
});

test('a terminal never offers replace — its find is read-only (FR-010)', async () => {
  const root = mkdtempSync(join(tmpdir(), 'throng-repl-'));
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'ReplTerm', root);
      const pid = await firstPanelId(win);
      await win.getByTestId(`panel-type-select-${pid}`).selectOption('terminal');
      await win.getByTestId('terminal-flavour').selectOption('cmd');
      await win.getByTestId(`panel-type-confirm-${pid}`).click();
      await expect(win.getByTestId(`terminal-${pid}`)).toBeVisible();
      await win.getByTestId(`terminal-${pid}`).click();

      // Even the "open find with replace" chord gives a terminal a plain, find-only bar.
      await win.keyboard.press('Control+h');
      await win.keyboard.press('Control+f');
      await expect(win.getByTestId(`find-bar-${pid}`)).toBeVisible();
      await expect(win.getByTestId('find-replace-row')).toHaveCount(0);
      await expect(win.getByTestId('replace-all')).toHaveCount(0);
    });
  } finally {
    cleanupTemp(root);
  }
});
