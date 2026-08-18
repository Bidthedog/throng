/**
 * US3 (#85) — undo a FILE OPERATION in Files & Folders.
 *
 * A rename, a move or a delete in the tree is a real change on disk, and until now it was a change
 * with no way back short of doing the inverse by hand — or, for a delete, going to the Recycle Bin
 * and knowing where the file had come from. Ctrl+Z in the tree now reverses the last one, and the
 * stack is per project and persisted, so it survives a restart (FR-010).
 */
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { openApp,
  createProject as newProject,
  firstPanelId,
  cleanupTemp,
  type AppOptions,
  type OpenApp, FILE_OP_TIMEOUT_MS } from './harness.js';
import { skipIfElevated } from './admin.js';

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


/** Right-click a row and read what the menu offers. */
async function rowMenu(win: Page, name: string): Promise<void> {
  await win.getByTestId('file-explorer-tree').getByText(name, { exact: true }).click({ button: 'right' });
  await expect(win.getByTestId('context-menu')).toBeVisible();
}

test('Ctrl+Z reverses a rename, and Ctrl+Y puts it back', { tag: ['@extended', '@explorer'] }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'throng-undo-'));
  writeFileSync(join(root, 'before.txt'), 'content\n');
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'UndoProj', root);
      const tree = win.getByTestId('file-explorer-tree');
      await expect(tree.getByText('before.txt', { exact: true })).toBeVisible({ timeout: 8000 });

      // Undo is OFFERED but unavailable before anything has happened — the item teaches that undo
      // exists, rather than appearing from nowhere after the first operation.
      await rowMenu(win, 'before.txt');
      await expect(win.getByTestId('menu-item-Undo')).toBeDisabled();
      await expect(win.getByTestId('menu-item-Undo')).toContainText('Ctrl');
      await win.keyboard.press('Escape');

      // Rename it.
      await tree.getByText('before.txt', { exact: true }).click();
      await win.keyboard.press('F2');
      const input = win.locator('.tree-rename');
      await expect(input).toBeVisible();
      await input.fill('after.txt');
      await input.press('Enter');
      await expect(tree.getByText('after.txt', { exact: true })).toBeVisible({ timeout: 8000 });
      expect(existsSync(join(root, 'after.txt'))).toBe(true);

      // Undo — the file goes back to its old name, on disk.
      await tree.getByText('after.txt', { exact: true }).click();
      await win.keyboard.press('Control+z');
      await expect(tree.getByText('before.txt', { exact: true })).toBeVisible({ timeout: 8000 });
      await expect.poll(() => existsSync(join(root, 'before.txt'))).toBe(true);
      expect(existsSync(join(root, 'after.txt'))).toBe(false);

      // Redo — and it is renamed again.
      await tree.getByText('before.txt', { exact: true }).click();
      await win.keyboard.press('Control+y');
      await expect(tree.getByText('after.txt', { exact: true })).toBeVisible({ timeout: 8000 });
      await expect.poll(() => existsSync(join(root, 'after.txt'))).toBe(true);
    });
  } finally {
    cleanupTemp(root);
  }
});

test('undo works from anywhere in the pane, not only with a row focused', { tag: ['@extended', '@explorer'] }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'throng-undopane-'));
  writeFileSync(join(root, 'renamed.txt'), 'x\n');
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'UndoPaneProj', root);
      const tree = win.getByTestId('file-explorer-tree');
      await expect(tree.getByText('renamed.txt', { exact: true })).toBeVisible({ timeout: 8000 });

      // Rename through the MENU, closed by mouse — the path that leaves focus on the pane rather
      // than on a tree row. Undo must still be the pane's Ctrl+Z, not the editor's.
      await tree.getByText('renamed.txt', { exact: true }).click({ button: 'right' });
      await win.getByTestId('menu-item-Rename').click();
      const input = win.locator('.tree-rename');
      await expect(input).toBeVisible();
      await input.fill('other.txt');
      await input.press('Enter');
      await expect(tree.getByText('other.txt', { exact: true })).toBeVisible({ timeout: 8000 });

      // Click the pane's header — inside Files & Folders, but not on a row and not in the tree.
      await win.getByTestId('files-pane').getByText('Files & Folders').click();
      await win.keyboard.press('Control+z');
      await expect.poll(() => existsSync(join(root, 'renamed.txt')), { timeout: FILE_OP_TIMEOUT_MS }).toBe(true);
      expect(existsSync(join(root, 'other.txt'))).toBe(false);
    });
  } finally {
    cleanupTemp(root);
  }
});

test('undo reverses a move back out of the folder it went into', { tag: ['@extended', '@explorer'] }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'throng-undomove-'));
  mkdirSync(join(root, 'dst'));
  writeFileSync(join(root, 'moved.txt'), 'x\n');
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'UndoMoveProj', root);
      const tree = win.getByTestId('file-explorer-tree');
      await expect(tree.getByText('moved.txt', { exact: true })).toBeVisible({ timeout: 8000 });

      // Cut + paste into the folder — the move path.
      await tree.getByText('moved.txt', { exact: true }).click();
      await win.keyboard.press('Control+x');
      await tree.getByText('dst', { exact: true }).click();
      await win.keyboard.press('Control+v');
      /*
       * Both ends of the move in ONE wait.
       *
       * A move is two filesystem effects, and they do not land together. Polling for the arrival and
       * then asserting the departure with a non-retrying `expect` reads the source directory in the
       * gap between them — so the test fails while the move is simply still finishing. It failed that
       * way repeatedly in full runs and passes alone, which is the signature of a race the test
       * creates rather than one the product has.
       */
      await expect
        .poll(
          () =>
            `${existsSync(join(root, 'dst', 'moved.txt'))},${existsSync(join(root, 'moved.txt'))}`,
          { timeout: FILE_OP_TIMEOUT_MS },
        )
        .toBe('true,false');

      /*
       * Let the undo ENTRY be recorded before sending the chord.
       *
       * The poll above proves the move landed on DISK, which is not the same as the renderer having
       * pushed its undo record — those are separate, and under load the chord can arrive first and
       * find nothing to undo. The symptom is the file simply staying where it was moved to, which
       * reads like a broken undo rather than a chord sent too early.
       *
       * Measured: 1 failure in 10 under eight CPU hogs. It then passed 14/14 with a diagnostic
       * `evaluate` in this position — a few milliseconds of round-trip was enough to hide it, which
       * is what identified the gap as the cause rather than focus. (That probe also ruled focus out
       * directly: `document.activeElement` was the same unclassed DIV in every run, passing or not.)
       */
      // sleep-justified: canUndoFileOp only renders while the context menu is open, so there is no
      // sleep-justified: passive signal for "the undo entry was recorded" to wait on — the poll above
      // sleep-justified: proves the move landed on disk, not that the renderer pushed its undo record,
      // sleep-justified: and under load the chord can arrive first and find nothing to undo.
      await win.waitForTimeout(300);
      // Undo puts it back at the root, where the user had it — again, both ends together.
      await win.keyboard.press('Control+z');
      await expect
        .poll(
          () =>
            `${existsSync(join(root, 'moved.txt'))},${existsSync(join(root, 'dst', 'moved.txt'))}`,
          { timeout: FILE_OP_TIMEOUT_MS },
        )
        .toBe('true,false');
    });
  } finally {
    cleanupTemp(root);
  }
});

test('undoing a delete un-strands the editor that was open on the file', { tag: ['@extended', '@explorer'] }, async () => {
  skipIfElevated();
  const root = mkdtempSync(join(tmpdir(), 'throng-undodel-'));
  writeFileSync(join(root, 'open.txt'), 'ORIGINAL\n');
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'UndoDelProj', root);
      const pid = await firstPanelId(win);
      await win.getByTestId(`panel-type-select-${pid}`).selectOption('editor');
      await win.getByTestId(`panel-type-confirm-${pid}`).click();
      const tree = win.getByTestId('file-explorer-tree');
      await tree.getByText('open.txt', { exact: true }).click();
      await expect(win.getByTestId(`editor-${pid}`).locator('.cm-content')).toContainText(
        'ORIGINAL',
        { timeout: 8000 },
      );
      // Clean to begin with.
      await expect(win.getByTestId(`panel-unsaved-${pid}`)).toHaveCount(0);

      // Delete it. The editor goes dirty deliberately: the buffer is now the only copy (FR-099).
      await tree.getByText('open.txt', { exact: true }).click();
      await win.keyboard.press('Delete');
      await win.getByTestId('confirm-accept').click();
      await expect(win.getByTestId(`panel-unsaved-${pid}`)).toBeVisible({ timeout: 8000 });

      // Undo the delete. The file comes back — and the editor must NOTICE. Leaving it dirty tells
      // the user their work is at risk over a file that is sitting on disk again, and every later
      // "save before closing?" asks about a document with nothing to save.
      await win.keyboard.press('Control+z');
      await expect.poll(() => existsSync(join(root, 'open.txt')), { timeout: FILE_OP_TIMEOUT_MS }).toBe(true);
      await expect(win.getByTestId(`panel-unsaved-${pid}`)).toHaveCount(0, { timeout: 8000 });
      // …and the tree's own dirty mark goes with it.
      await expect(win.getByTestId('tree-unsaved-open.txt')).toHaveCount(0);
    });
  } finally {
    cleanupTemp(root);
  }
});

test('a refused undo says why, and keeps the entry so it can be retried', { tag: ['@extended', '@explorer'] }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'throng-undoblock-'));
  writeFileSync(join(root, 'one.txt'), 'x\n');
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'UndoBlockProj', root);
      const tree = win.getByTestId('file-explorer-tree');
      await expect(tree.getByText('one.txt', { exact: true })).toBeVisible({ timeout: 8000 });

      await tree.getByText('one.txt', { exact: true }).click();
      await win.keyboard.press('F2');
      const input = win.locator('.tree-rename');
      await input.fill('two.txt');
      await input.press('Enter');
      await expect(tree.getByText('two.txt', { exact: true })).toBeVisible({ timeout: 8000 });

      // Something else now occupies the name the undo wants to restore. Replaying blindly would
      // either fail obscurely or overwrite a file the user never agreed to lose.
      writeFileSync(join(root, 'one.txt'), 'a different file\n');
      await tree.getByText('two.txt', { exact: true }).click();
      await win.keyboard.press('Control+z');

      // It is REPORTED — an undo that silently did nothing would read as undo being broken.
      const notice = win.getByTestId('explorer-error');
      await expect(notice.first()).toBeVisible({ timeout: 8000 });
      await expect(notice.first()).toContainText('undo that file operation');
      // …and nothing was destroyed.
      expect(existsSync(join(root, 'two.txt'))).toBe(true);
      expect(existsSync(join(root, 'one.txt'))).toBe(true);
    });
  } finally {
    cleanupTemp(root);
  }
});
