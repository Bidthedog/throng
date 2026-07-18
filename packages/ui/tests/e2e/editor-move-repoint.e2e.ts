/**
 * Regression E2E for issue #87 — moving a file in the File Explorer leaves its open
 * editor pointing at the OLD path.
 *
 * ## The mechanism these tests pin
 *
 * `FilesService.delete` tells the editor coordinator what it removed
 * (`this.onDeleted?.(removed)` — files-service.ts:165, wired to
 * `editorCoordinator.markDeleted` at main.ts:586). `FilesService.move`
 * (files-service.ts:84-112) tells it NOTHING. So an in-app move is invisible to the
 * coordinator, and the only thing that eventually notices is the per-doc folder watch
 * (`onDiskChange`, editor-coordinator.ts:692): it re-reads `doc.absPath`, the load
 * fails because the file is no longer there, and it routes the document through
 * `markDeleted` (editor-coordinator.ts:704) — keeping the buffer and force-dirtying it
 * so a save can re-create the file.
 *
 * That is exactly right for a file deleted by another program (the last test here
 * guards it) and exactly wrong for a file throng moved itself. The coordinator already
 * knows how to re-point — `load()` has the branch for it (editor-coordinator.ts:210-218:
 * unregister the old path from the one-buffer registry, drop the stale recovery temp) —
 * but nothing calls it when the FILE moves rather than the panel.
 *
 * Each test below is named for the acceptance criterion it covers. They are RED until
 * the move signals the coordinator; the final `another program` test is a GUARD and is
 * expected to be GREEN already.
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { runApp, createProject, firstPanelId, addPanels } from './harness.js';
import { skipIfElevated } from './admin.js';

/** A project with a file at the root and an empty `dest` folder to move it into. */
function makeProject(tag: string): string {
  const root = mkdtempSync(join(tmpdir(), `throng-mv-${tag}-`));
  mkdirSync(join(root, 'dest'));
  writeFileSync(join(root, 'note.txt'), 'MOVE-ME-BODY\n');
  return root;
}

const rmRoot = (dir: string): void => {
  rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
};

async function newEditor(win: Page, pid: string): Promise<string> {
  await win.getByTestId(`panel-type-select-${pid}`).selectOption('editor');
  await win.getByTestId(`panel-type-confirm-${pid}`).click();
  await expect(win.getByTestId(`editor-${pid}`)).toBeVisible();
  return pid;
}

/** Open `name` from the tree into the panel `pid`, and settle on its content. */
async function openInto(win: Page, pid: string, name: string, body: string): Promise<void> {
  await win.getByTestId(`editor-${pid}`).click(); // make it the last-active editor
  await win.getByTestId('file-explorer-tree').getByText(name, { exact: true }).click();
  await expect(win.getByTestId(`editor-${pid}`).locator('.cm-content')).toContainText(body, {
    timeout: 8000,
  });
  // A freshly-loaded file is clean — the baseline every "did not go dirty" assertion below
  // is measured against.
  await expect(win.getByTestId(`panel-unsaved-${pid}`)).toHaveCount(0);
}

/**
 * Compare paths by IDENTITY, not by spelling.
 *
 * The coordinator stores the path the renderer opened with, which arrives from the tree
 * FORWARD-slashed (`…/throng-mv-ac1-x/note.txt`), while `node:path.join` here produces the
 * Windows back-slashed form. They name the same file, and issue #87 is not about separators —
 * so comparing the raw strings makes every test in this file fail for a reason nobody cares
 * about, and (worse) makes the AC7 guard, which is CORRECT today, look broken.
 */
const normPath = (p: string | null): string | null =>
  p === null ? null : p.replace(/\\/g, '/').toLowerCase();

/**
 * The COORDINATOR's idea of where a document lives — not the renderer's.
 *
 * `editor.list()` is served straight from `EditorCoordinator.docs`, so this reads the
 * authority's `absPath` rather than anything the view happens to be displaying. That is the
 * fact issue #87 is about, and reading it directly means these tests fail on the bug itself
 * rather than on a symptom of it.
 */
async function docPath(win: Page, pid: string): Promise<string | null> {
  const raw = await win.evaluate(async (panelId) => {
    const docs = await window.throng.editor.list();
    return docs.find((d) => d.panelId === panelId)?.absPath ?? null;
  }, pid);
  return normPath(raw);
}

/** The one-buffer registry's answer for a path: focus an existing editor, or open a new one? */
function openDecision(win: Page, absPath: string): Promise<string> {
  return win.evaluate(
    async (p) => (await window.throng.editor.openInto({ absPath: p })).action,
    absPath,
  );
}

const menuItem = (win: Page, label: string) =>
  win.locator('.context-menu__item', { hasText: label });

/** Cut `name` in the tree and paste it into the folder `destName`. */
async function cutPaste(win: Page, name: string, destName: string): Promise<void> {
  const tree = win.getByTestId('file-explorer-tree');
  await tree.getByText(name, { exact: true }).click({ button: 'right' });
  await menuItem(win, 'Cut').click();
  await tree.getByText(destName, { exact: true }).click({ button: 'right' });
  await menuItem(win, 'Paste').click();
}

/**
 * Wait until `moved` exists and `from` does not — the MOVE itself, observed on disk.
 *
 * Every assertion in this file is about what the editor did in response to the move, so the
 * move having actually happened is a precondition, not a result. Asserting it here means a
 * failure below can only mean the editor got it wrong.
 */
async function expectMovedOnDisk(from: string, to: string): Promise<void> {
  await expect.poll(() => existsSync(to), { timeout: 10000 }).toBe(true);
  await expect.poll(() => existsSync(from), { timeout: 10000 }).toBe(false);
}

/**
 * Give the folder watch time to fire before asserting that nothing bad happened.
 *
 * A deliberate sleep, and the rare case that earns one: the assertions after it are NEGATIVE
 * ("the editor did not go dirty", "no notice appeared"), and a negative assertion made before
 * the watcher has run passes for the wrong reason — it would be green today, against the very
 * bug it is meant to catch. There is no event to await, because the correct behaviour is that
 * no event ever arrives. The watch is a `fs.watch` on the doc's folder plus a re-read, so this
 * is an order of magnitude more than it needs.
 */
async function letWatcherFire(win: Page): Promise<void> {
  await win.waitForTimeout(1500);
}

test('AC1 — a cut+paste move re-points the editor; it does not go dirty and raises no notice', async () => {
  skipIfElevated();
  const root = makeProject('ac1');
  const oldPath = join(root, 'note.txt');
  const newPath = join(root, 'dest', 'note.txt');
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'Mv1', root);
      const pid = await newEditor(win, await firstPanelId(win));
      await openInto(win, pid, 'note.txt', 'MOVE-ME-BODY');
      expect(await docPath(win, pid)).toBe(normPath(oldPath));

      await cutPaste(win, 'note.txt', 'dest');
      await expectMovedOnDisk(oldPath, newPath);
      await letWatcherFire(win);

      /*
       * SOFT, deliberately — this is the criterion that names all three symptoms at once, and a
       * hard assertion on the first would hide the other two behind it. The re-point is the CAUSE
       * and the dirty flag is what the user actually sees; a reader of a failing run is entitled
       * to both, not to whichever happens to be checked first. Soft expectations still fail the
       * test — they just finish gathering the evidence before they do.
       */
      // The document is the same document; only its path changed.
      expect.soft(await docPath(win, pid)).toBe(normPath(newPath));
      // It was never edited, so nothing about a move may make it look edited.
      await expect.soft(win.getByTestId(`panel-unsaved-${pid}`)).toHaveCount(0);
      await expect.soft(win.getByTestId('editor-notice-dialog')).toHaveCount(0);
      // The panel header's file pill follows it too (its title is the full path).
      await expect.soft(win.getByTestId(`panel-file-${pid}`)).toHaveAttribute('title', newPath);
    });
  } finally {
    rmRoot(root);
  }
});

test('AC2 — a drag-move re-points the editor just as a cut+paste does', async () => {
  skipIfElevated();
  const root = makeProject('ac2');
  const oldPath = join(root, 'note.txt');
  const newPath = join(root, 'dest', 'note.txt');
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'Mv2', root);
      const pid = await newEditor(win, await firstPanelId(win));
      await openInto(win, pid, 'note.txt', 'MOVE-ME-BODY');

      const tree = win.getByTestId('file-explorer-tree');
      await tree.getByText('note.txt', { exact: true }).dragTo(tree.getByText('dest', { exact: true }));
      await expectMovedOnDisk(oldPath, newPath);
      await letWatcherFire(win);

      expect(await docPath(win, pid)).toBe(normPath(newPath));
      await expect(win.getByTestId(`panel-unsaved-${pid}`)).toHaveCount(0);
    });
  } finally {
    rmRoot(root);
  }
});

test('AC3 — saving after a move writes to the NEW location and does not re-create the old file', async () => {
  skipIfElevated();
  const root = makeProject('ac3');
  const oldPath = join(root, 'note.txt');
  const newPath = join(root, 'dest', 'note.txt');
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'Mv3', root);
      const pid = await newEditor(win, await firstPanelId(win));
      await openInto(win, pid, 'note.txt', 'MOVE-ME-BODY');

      await cutPaste(win, 'note.txt', 'dest');
      await expectMovedOnDisk(oldPath, newPath);
      await letWatcherFire(win);

      // Type into the moved document, then save it.
      const content = win.getByTestId(`editor-${pid}`).locator('.cm-content');
      await content.click();
      await win.keyboard.type('EDITED-AFTER-MOVE ');
      await expect(win.getByTestId(`panel-unsaved-${pid}`)).toBeVisible();
      await win.keyboard.press('Control+s');

      // The edit lands at the NEW location…
      await expect
        .poll(() => (existsSync(newPath) ? readFileSync(newPath, 'utf8') : ''), { timeout: 8000 })
        .toContain('EDITED-AFTER-MOVE');
      // …and the save does NOT silently undo the move by re-creating the old file.
      expect(existsSync(oldPath), `save re-created the moved-from file at ${oldPath}`).toBe(false);
      await expect(win.getByTestId(`panel-unsaved-${pid}`)).toHaveCount(0);
    });
  } finally {
    rmRoot(root);
  }
});

test('AC4 — the one-buffer registry follows the move: the new path focuses the existing editor', async () => {
  skipIfElevated();
  const root = makeProject('ac4');
  const oldPath = join(root, 'note.txt');
  const newPath = join(root, 'dest', 'note.txt');
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'Mv4', root);
      const pid = await newEditor(win, await firstPanelId(win));
      await openInto(win, pid, 'note.txt', 'MOVE-ME-BODY');
      // Before the move, the registry knows the file is open at its original path.
      expect(await openDecision(win, oldPath)).toBe('focus');

      await cutPaste(win, 'note.txt', 'dest');
      await expectMovedOnDisk(oldPath, newPath);
      await letWatcherFire(win);

      // FR-011a, one buffer per file: the file is still open — at its new path.
      expect(await openDecision(win, newPath)).toBe('focus');
      // And the old path is no longer claimed by anyone — a stale claim there would refuse a
      // later Save-As onto it ("already open in another editor", editor-coordinator.ts:480).
      expect(await openDecision(win, oldPath)).toBe('open');
    });
  } finally {
    rmRoot(root);
  }
});

test('AC5 — a clean move leaves no recovery snapshot stranding the document at its old path', async () => {
  skipIfElevated();
  const root = makeProject('ac5');
  const userDataDir = mkdtempSync(join(tmpdir(), 'throng-mv-ac5-ud-'));
  const oldPath = join(root, 'note.txt');
  const newPath = join(root, 'dest', 'note.txt');
  try {
    await runApp(
      async (_app, win) => {
        await createProject(win, 'Mv5', root);
        const pid = await newEditor(win, await firstPanelId(win));
        await openInto(win, pid, 'note.txt', 'MOVE-ME-BODY');

        await cutPaste(win, 'note.txt', 'dest');
        await expectMovedOnDisk(oldPath, newPath);
        await letWatcherFire(win);

        /*
         * Snapshots are keyed by panelId and carry no path (editor-recovery.ts), so a moved
         * document's snapshot cannot "point" anywhere by itself — it strands the document by
         * EXISTING. The panel's path is restored from the persisted layout (the OLD path), and
         * a snapshot beside it is then restored over it, dirty. So the property that matters is
         * that a move leaves the document CLEAN and therefore leaves no snapshot at all: the
         * same thing `load()`'s re-point branch does when a panel is pointed at a new file
         * (editor-coordinator.ts:217, `await this.recovery.remove(...)`).
         *
         * Today `markDeleted` writes one immediately and undebounced (editor-coordinator.ts:288),
         * which is precisely the crash-restores-to-the-old-path hazard the criterion names.
         */
        const snapshot = join(userDataDir, 'recovery', encodeURIComponent(pid));
        expect(
          existsSync(snapshot),
          `a recovery snapshot was written for a document that only MOVED (${snapshot})`,
        ).toBe(false);
      },
      { userDataDir },
    );
  } finally {
    rmRoot(root);
    rmRoot(userDataDir);
  }
});

test('AC6 — moving a FOLDER re-points every open file inside it', async () => {
  skipIfElevated();
  const root = mkdtempSync(join(tmpdir(), 'throng-mv-ac6-'));
  mkdirSync(join(root, 'pack'));
  mkdirSync(join(root, 'dest'));
  writeFileSync(join(root, 'pack', 'one.txt'), 'ONE-BODY\n');
  writeFileSync(join(root, 'pack', 'two.txt'), 'TWO-BODY\n');
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'Mv6', root);
      await addPanels(win, 1); // two panels → two editors, one file each
      const [pidA, pidB] = await win
        .locator('.panel-box')
        .evaluateAll((els) => els.map((el) => (el as HTMLElement).dataset.panelId ?? ''));
      await newEditor(win, pidA);
      await newEditor(win, pidB);

      // Expand `pack` so its files are clickable, then open one into each editor.
      const tree = win.getByTestId('file-explorer-tree');
      await tree.getByText('pack', { exact: true }).click();
      await expect(tree.getByText('one.txt', { exact: true })).toBeVisible();
      await openInto(win, pidA, 'one.txt', 'ONE-BODY');
      await openInto(win, pidB, 'two.txt', 'TWO-BODY');

      // Move the whole folder into `dest`.
      await cutPaste(win, 'pack', 'dest');
      await expectMovedOnDisk(join(root, 'pack', 'one.txt'), join(root, 'dest', 'pack', 'one.txt'));
      await letWatcherFire(win);

      // Both documents live under the folder's new home; neither went dirty.
      expect(await docPath(win, pidA)).toBe(normPath(join(root, 'dest', 'pack', 'one.txt')));
      expect(await docPath(win, pidB)).toBe(normPath(join(root, 'dest', 'pack', 'two.txt')));
      await expect(win.getByTestId(`panel-unsaved-${pidA}`)).toHaveCount(0);
      await expect(win.getByTestId(`panel-unsaved-${pidB}`)).toHaveCount(0);
    });
  } finally {
    rmRoot(root);
  }
});

/**
 * FR-008, for a panel that is NOT on screen when the move happens.
 *
 * Only the active tab's `SplitTree` is mounted (`tab-group.tsx:625`), so a background tab's editor
 * has already torn down its `onSync` subscription and cannot hear `movedTo` at all. Every other test
 * in this file moves a file while the editor is looking at it, so all of them are blind to this: the
 * panel keeps the OLD path in the persisted layout and reopens on a ghost after a restart — missing,
 * dirty, and one Ctrl+S from re-creating the file the move emptied. #87, one restart later.
 *
 * The restart is the assertion. Nothing else can distinguish "the view adopted the new path when it
 * remounted" (which was always true, and is worth nothing here) from "the LAYOUT learnt it".
 */
test('AC8 — a move reaches the persisted layout of a panel in a BACKGROUND tab (FR-008)', async () => {
  skipIfElevated();
  const root = makeProject('ac8');
  const dataDir = mkdtempSync(join(tmpdir(), 'throng-mv-ac8-data-'));
  const userDataDir = mkdtempSync(join(tmpdir(), 'throng-mv-ac8-ud-'));
  const oldPath = join(root, 'note.txt');
  const newPath = join(root, 'dest', 'note.txt');
  try {
    // Session 1: open the file, then go and work in a second tab — and move it from there.
    await runApp(
      async (_app, win) => {
        await createProject(win, 'Mv8', root);
        const pid = await newEditor(win, await firstPanelId(win));
        await openInto(win, pid, 'note.txt', 'MOVE-ME-BODY');

        await win.getByTestId('tab-add').click(); // creates + switches to a 2nd tab
        await expect(win.getByTestId(`editor-${pid}`)).toHaveCount(0); // …so the editor unmounted

        // The File Explorer is outside the tab group, so the move is a perfectly ordinary one.
        await cutPaste(win, 'note.txt', 'dest');
        await expectMovedOnDisk(oldPath, newPath);
        // The coordinator is the authority and knows where the document lives, mounted or not.
        expect(await docPath(win, pid)).toBe(normPath(newPath));
        await win.waitForTimeout(1200); // > the layout autosave debounce (400ms)
      },
      { dataDir, userDataDir },
    );

    // Session 2: come back to the tab the editor is in. It must open the file where it now LIVES.
    await runApp(
      async (_app, win) => {
        const projectItem = win.locator('.project-item', { hasText: 'Mv8' });
        await expect(projectItem).toBeVisible();
        await projectItem.locator('[data-testid^="project-switch-"]').click();
        await win.locator('.tab-chip').first().click(); // back to the editor's tab → it mounts

        const editor = win.locator('.editor-panel').first();
        await expect(editor).toBeVisible({ timeout: 10000 });
        await expect(editor.locator('.cm-content')).toContainText('MOVE-ME-BODY', { timeout: 10000 });
        // Restored onto the real file: clean, no recovered buffer, and no "cannot open" dialog.
        await expect(win.locator('.throng-unsaved-dot')).toHaveCount(0);
        await expect(win.getByTestId('editor-notice-dialog')).toHaveCount(0);
      },
      { dataDir, userDataDir },
    );
  } finally {
    rmRoot(root);
    rmRoot(dataDir);
    rmRoot(userDataDir);
  }
});

/**
 * GUARD — expected GREEN today, and must stay green.
 *
 * A file moved by ANOTHER program is not a re-point: throng has no idea where it went, and the
 * buffer is the only surviving copy. Keeping it, dirtying it and letting a save re-create the
 * file is the correct answer (FR-099), and it is the behaviour the fix for #87 must not sweep
 * away while making in-app moves quiet.
 */
test('AC7 (guard) — a file moved by ANOTHER program still keeps its buffer, dirty and recoverable', async () => {
  skipIfElevated();
  const root = makeProject('ac7');
  const oldPath = join(root, 'note.txt');
  const away = join(root, 'dest', 'note.txt');
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'Mv7', root);
      const pid = await newEditor(win, await firstPanelId(win));
      await openInto(win, pid, 'note.txt', 'MOVE-ME-BODY');

      // Not throng: a move performed behind the app's back.
      renameSync(oldPath, away);
      await expectMovedOnDisk(oldPath, away);

      // FR-099: the buffer survives and is force-dirtied so a save can re-create the file…
      await expect(win.getByTestId(`panel-unsaved-${pid}`)).toBeVisible({ timeout: 10000 });
      await expect(win.getByTestId(`editor-${pid}`).locator('.cm-content')).toContainText(
        'MOVE-ME-BODY',
      );
      // …and the document is still pointed at the path throng last knew it by. It did NOT
      // follow the file, because nothing told it where the file went — that is the point.
      expect(await docPath(win, pid)).toBe(normPath(oldPath));

      // A save re-creates the file at the original location (the recoverable path).
      await win.getByTestId(`editor-${pid}`).locator('.cm-content').click();
      await win.keyboard.press('Control+s');
      await expect
        .poll(() => (existsSync(oldPath) ? readFileSync(oldPath, 'utf8') : ''), { timeout: 8000 })
        .toContain('MOVE-ME-BODY');
    });
  } finally {
    rmRoot(root);
  }
});
