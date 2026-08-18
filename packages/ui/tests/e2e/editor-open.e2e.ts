import { mkdtempSync, writeFileSync, unlinkSync } from 'node:fs';
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
 * Every `runApp` is an Electron launch, a daemon and a window — around two seconds each — and none of
 * the tests here needs a pristine app: each builds its own project, and creating a project swaps the
 * whole workspace, which is the isolation they actually rely on. Only a test that seeds state BEFORE
 * launch needs its own app, and there is none in this file.
 *
 * The shims keep the test bodies unchanged:
 *   runApp        runs against the shared window, and REFUSES options rather than ignoring them — a
 *                 silently dropped config root does not fail, it passes for the wrong reason.
 *   createProject appends a counter, because a shared app accumulates projects and duplicate names
 *                 make `.project-item` ambiguous.
 *
 * Serial mode is required (shared window, shared database) and means a failure skips the rest rather
 * than running them against whatever state it left behind.
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
  fn: (app: OpenApp['app'], win: OpenApp['win']) => Promise<void>,
  opts?: AppOptions,
): Promise<void> => {
  if (opts) {
    throw new Error(
      'this file shares one app; a test needing launch options must call runOwnApp instead',
    );
  }
  return fn(shared.app, shared.win);
};

let projectSeq = 0;
const createProject = (win: OpenApp['win'], name: string, root: string): Promise<void> =>
  newProject(win, `${name}-${(projectSeq += 1)}`, root);

// US2/US9 (Delivery B): open files from the tree into the last active editor
// (openOnClick single default); an already-open file focuses the one editor;
// opening into a dirty editor shows the four-choice prompt, and "Open in new
// editor" must open the file that was CLICKED.

function makeProject(): string {
  const root = mkdtempSync(join(tmpdir(), 'throng-open-'));
  writeFileSync(join(root, 'alpha.txt'), 'ALPHA-CONTENT\n');
  writeFileSync(join(root, 'beta.txt'), 'BETA-CONTENT\n');
  return root;
}

/** A project whose open document can be deleted underneath the editor. */
function makeDirtyProject(): string {
  const root = mkdtempSync(join(tmpdir(), 'throng-newed-'));
  writeFileSync(join(root, 'CLAUDE.md'), 'CLAUDE-DOC-CONTENT\n');
  writeFileSync(join(root, 'gone.txt'), 'GONE-BODY\n');
  writeFileSync(join(root, 'target.txt'), 'TARGET-BODY-99\n');
  return root;
}

async function newEditor(win: Page): Promise<string> {
  const pid = await firstPanelId(win);
  await win.getByTestId(`panel-type-select-${pid}`).selectOption('editor');
  await win.getByTestId(`panel-type-confirm-${pid}`).click();
  await expect(win.getByTestId(`editor-${pid}`)).toBeVisible();
  return pid;
}

test('clicking a file opens it into the editor; another file replaces a clean doc', { tag: ['@extended', '@editor'] }, async () => {
  const root = makeProject();
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'OpenProj', root);
      const pid = await newEditor(win);
      await win.getByTestId(`editor-${pid}`).click(); // make it the active editor

      const tree = win.getByTestId('file-explorer-tree');
      await tree.getByText('alpha.txt', { exact: true }).click();
      const content = win.getByTestId(`editor-${pid}`).locator('.cm-content');
      await expect(content).toContainText('ALPHA-CONTENT', { timeout: 8000 });
      await expect(win.getByTestId(`panel-file-${pid}`)).toContainText('alpha.txt');

      // A clean editor takes the next file, replacing the document (no 2nd editor).
      await tree.getByText('beta.txt', { exact: true }).click();
      await expect(content).toContainText('BETA-CONTENT', { timeout: 8000 });
      await expect(content).not.toContainText('ALPHA-CONTENT');
      /*
       * Exactly one editor panel — no duplicate buffer.
       *
       * This counts panels in the ACTIVE project's workspace, which is what makes it safe alongside
       * the "Open in new editor" test below that deliberately ends with two: each test creates its
       * own project, and creating one swaps the workspace.
       */
      await expect(win.locator('.editor-panel')).toHaveCount(1);
    });
  } finally {
    cleanupTemp(root);
  }
});

test('opening a file into a dirty editor shows the four-choice prompt; cancel is a no-op', { tag: ['@extended', '@editor'] }, async () => {
  const root = makeProject();
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'OpenProj', root);
      const pid = await newEditor(win);
      await win.getByTestId(`editor-${pid}`).click();

      const tree = win.getByTestId('file-explorer-tree');
      const content = win.getByTestId(`editor-${pid}`).locator('.cm-content');

      // Open alpha, then make an unsaved edit.
      await tree.getByText('alpha.txt', { exact: true }).click();
      await expect(content).toContainText('ALPHA-CONTENT', { timeout: 8000 });
      await content.click();
      await win.keyboard.type('EDIT');
      await expect(win.getByTestId(`panel-unsaved-${pid}`)).toBeVisible();

      // Opening another file into the dirty editor prompts (US9).
      await tree.getByText('beta.txt', { exact: true }).click();
      await expect(win.getByTestId('unsaved-open-dialog')).toBeVisible();

      // The document NAMES in the question are set apart from the sentence around them — they are
      // what the decision is about, and the one part that must be readable at a glance (024 follow-up).
      const names = win.getByTestId('unsaved-open-dialog').locator('.modal__name');
      await expect(names).toHaveCount(2); // the dirty editor, and the file arriving
      const emphasis = await names.first().evaluate((el) => {
        const own = getComputedStyle(el as HTMLElement);
        const around = getComputedStyle((el as HTMLElement).parentElement!);
        return {
          bolder: Number(own.fontWeight) > Number(around.fontWeight),
          larger: parseFloat(own.fontSize) > parseFloat(around.fontSize),
        };
      });
      expect(emphasis).toEqual({ bolder: true, larger: true });

      // Cancel → nothing changes: editor still shows the edited alpha, still dirty.
      await win.getByTestId('unsaved-open-cancel').click();
      await expect(win.getByTestId('unsaved-open-dialog')).toHaveCount(0);
      await expect(content).toContainText('EDIT');
      await expect(win.getByTestId(`panel-unsaved-${pid}`)).toBeVisible();

      // Try again → Discard & open → beta replaces the buffer (edits dropped).
      await tree.getByText('beta.txt', { exact: true }).click();
      await expect(win.getByTestId('unsaved-open-dialog')).toBeVisible();
      await win.getByTestId('unsaved-open-discard').click();
      await expect(content).toContainText('BETA-CONTENT', { timeout: 8000 });
      await expect(content).not.toContainText('EDIT');
    });
  } finally {
    cleanupTemp(root);
  }
});

// Repro: a dirty editor whose file was DELETED is active; clicking another file shows
// the unsaved-changes prompt; "Open in new editor" MUST open the CLICKED file — not
// some other file (bug: it opened CLAUDE.md / the wrong file).
test('"Open in new editor" from the unsaved prompt opens the CLICKED file (not CLAUDE.md)', { tag: ['@extended', '@editor'] }, async () => {
  const root = makeDirtyProject();
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'NewEd', root);
      const pid = await newEditor(win);
      await win.getByTestId(`editor-${pid}`).click();
      const tree = win.getByTestId('file-explorer-tree');

      // Open gone.txt, then delete it EXTERNALLY (as the user did in Explorer) →
      // the soft-detection watcher marks the editor dirty + file-missing.
      await tree.getByText('gone.txt', { exact: true }).click();
      await expect(win.getByTestId(`editor-${pid}`).locator('.cm-content')).toContainText('GONE-BODY', {
        timeout: 8000,
      });
      unlinkSync(join(root, 'gone.txt'));
      await expect(win.getByTestId(`panel-unsaved-${pid}`)).toBeVisible({ timeout: 8000 });

      // Click target.txt → the unsaved prompt → "Open in new editor".
      await tree.getByText('target.txt', { exact: true }).click();
      await expect(win.getByTestId('unsaved-open-dialog')).toBeVisible({ timeout: 8000 });
      await win.getByTestId('unsaved-open-new').click();

      // A second editor exists and shows TARGET's content — NOT CLAUDE.md, NOT gone's.
      await expect(win.locator('.editor-panel')).toHaveCount(2, { timeout: 8000 });
      const contents = win.locator('.editor-panel .cm-content');
      await expect(contents.filter({ hasText: 'TARGET-BODY-99' })).toHaveCount(1, { timeout: 8000 });
      await expect(win.locator('.cm-content', { hasText: 'CLAUDE-DOC-CONTENT' })).toHaveCount(0);
    });
  } finally {
    cleanupTemp(root);
  }
});
