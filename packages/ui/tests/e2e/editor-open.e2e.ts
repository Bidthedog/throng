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

async function newEditor(win: Page): Promise<string> {
  const pid = await firstPanelId(win);
  await win.getByTestId(`panel-type-select-${pid}`).selectOption('editor');
  await win.getByTestId(`panel-type-confirm-${pid}`).click();
  await expect(win.getByTestId(`editor-${pid}`)).toBeVisible();
  return pid;
}

/*
 * MERGED (pass 2): 'clicking a file opens it into the editor; another file replaces a clean doc' is
 * now the first half of the test below, which opened alpha anyway. It also carries the header-name
 * assertion that left `panel-auto-naming.e2e.ts` ('a New Tab panel takes its name from the file its
 * editor opens', #218): the header names the editor by its file's stem.
 *
 * MOVED DOWN (pass 2): '"Open in new editor" from the unsaved prompt opens the CLICKED file (not
 * CLAUDE.md)' is `component/editor-open-routing.test.ts` 'from the TREE route, "new" opens the CLICKED
 * file even when the dirty last-active editor holds a deleted file'. Red-proven there: pointing the
 * `new` branch of `replaceInEditorPanel` (open-into-panel.ts) at another path fails it and the
 * drop-route sibling. The routing is pure; only the soft-detection watcher marking the editor dirty on
 * a deleted file needed the real app, and that is `editor-missing-aggregate.e2e.ts`.
 */
test('clicking a file opens it, another file replaces a clean doc, and a dirty editor asks before it is replaced; cancel is a no-op', { tag: ['@extended', '@editor', '@reserve:layout'] }, async () => {
  const root = makeProject();
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'OpenProj', root);
      const pid = await newEditor(win);
      await win.getByTestId(`editor-${pid}`).click(); // make it the active editor

      const tree = win.getByTestId('file-explorer-tree');
      const content = win.getByTestId(`editor-${pid}`).locator('.cm-content');

      // (merged) Open alpha into the editor.
      await tree.getByText('alpha.txt', { exact: true }).click();
      await expect(content, 'clicking a file opens it into the editor').toContainText('ALPHA-CONTENT', { timeout: 8000 });
      await expect(win.getByTestId(`panel-file-${pid}`), 'the file pill names the opened file').toContainText('alpha.txt');
      // (merged from panel-auto-naming, #218) The header names an editor by its file's stem.
      await expect(win.getByTestId(`panel-title-${pid}`), 'the header takes its name from the file').toHaveText('alpha', { timeout: 15_000 });

      // (merged) A clean editor takes the next file, replacing the document (no 2nd editor).
      await tree.getByText('beta.txt', { exact: true }).click();
      await expect(content, 'a clean editor takes the next file').toContainText('BETA-CONTENT', { timeout: 8000 });
      await expect(content, 'the clean document is replaced, not kept').not.toContainText('ALPHA-CONTENT');
      /*
       * Exactly one editor panel — no duplicate buffer.
       *
       * This counts panels in the ACTIVE project's workspace, which is what makes it safe alongside
       * the "Open in new editor" test below that deliberately ends with two: each test creates its
       * own project, and creating one swaps the workspace.
       */
      await expect(win.locator('.editor-panel'), 'no duplicate buffer: still one editor').toHaveCount(1);

      // Make an unsaved edit in beta.
      await content.click();
      await win.keyboard.type('EDIT');
      await expect(win.getByTestId(`panel-unsaved-${pid}`)).toBeVisible();

      // Opening another file into the dirty editor prompts (US9).
      await tree.getByText('alpha.txt', { exact: true }).click();
      await expect(win.getByTestId('unsaved-open-dialog'), 'a dirty editor asks before it is replaced').toBeVisible();

      // The document NAMES in the question are set apart from the sentence around them — they are
      // what the decision is about, and the one part that must be readable at a glance (024 follow-up).
      const names = win.getByTestId('unsaved-open-dialog').locator('.modal__name');
      await expect(names, 'the dirty editor and the arriving file are both named').toHaveCount(2);
      const emphasis = await names.first().evaluate((el) => {
        const own = getComputedStyle(el as HTMLElement);
        const around = getComputedStyle((el as HTMLElement).parentElement!);
        return {
          bolder: Number(own.fontWeight) > Number(around.fontWeight),
          larger: parseFloat(own.fontSize) > parseFloat(around.fontSize),
        };
      });
      expect(emphasis, 'the names are bolder and larger than the sentence').toEqual({ bolder: true, larger: true });

      // Cancel → nothing changes: editor still shows the edited beta, still dirty.
      await win.getByTestId('unsaved-open-cancel').click();
      await expect(win.getByTestId('unsaved-open-dialog')).toHaveCount(0);
      await expect(content, 'cancel keeps the edited buffer').toContainText('EDIT');
      await expect(win.getByTestId(`panel-unsaved-${pid}`), 'cancel leaves the editor dirty').toBeVisible();

      // Try again → Discard & open → alpha replaces the buffer (edits dropped).
      await tree.getByText('alpha.txt', { exact: true }).click();
      await expect(win.getByTestId('unsaved-open-dialog')).toBeVisible();
      await win.getByTestId('unsaved-open-discard').click();
      await expect(content, 'discard opens the clicked file').toContainText('ALPHA-CONTENT', { timeout: 8000 });
      await expect(content, 'discard drops the edits').not.toContainText('EDIT');
    });
  } finally {
    cleanupTemp(root);
  }
});
