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
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { test, expect, type Page } from '@playwright/test';
import { runApp, createProject, firstPanelId, cleanupTemp, FILE_OP_TIMEOUT_MS } from './harness.js';

/** A project with a file at the root and an empty `dest` folder to move it into. */
function makeProject(tag: string): string {
  const root = mkdtempSync(join(tmpdir(), `throng-mv-${tag}-`));
  mkdirSync(join(root, 'dest'));
  writeFileSync(join(root, 'note.txt'), 'MOVE-ME-BODY\n');
  return root;
}

const rmRoot = (dir: string): void => {
  cleanupTemp(dir);
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
  await expect.poll(() => existsSync(to), { timeout: FILE_OP_TIMEOUT_MS }).toBe(true);
  await expect.poll(() => existsSync(from), { timeout: FILE_OP_TIMEOUT_MS }).toBe(false);
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
  // sleep-justified: the assertions after this are NEGATIVE (no dirty flag, no notice) and the
  // sleep-justified: watch is an fs.watch + re-read with no completion signal a test can observe —
  // sleep-justified: waiting on docPath() instead would make the re-point assertion HARD and defeat
  // sleep-justified: the soft-expect design right above, which wants all three symptoms reported.
  await win.waitForTimeout(1500);
}

/**
 * Wait until PROJECT's persisted layout has actually picked up PATH — replacing a guess about the
 * layout autosave's 400ms debounce with the real write (the #246 defect class: slept past a write
 * it then could not read). Walks every string leaf of the parsed layout and compares it by
 * IDENTITY via {@link normPath}, the same way `docPath` above does, so it matches regardless of
 * which separator style the persisted path happens to use.
 */
async function expectLayoutHasPath(dataDir: string, projectName: string, path: string): Promise<void> {
  const target = normPath(path);
  await expect
    .poll(
      () => {
        let db: InstanceType<typeof Database> | undefined;
        try {
          db = new Database(join(dataDir, 'throng.db'), { readonly: true });
          const row = db
            .prepare(
              `SELECT w.layout_json AS json
                 FROM workspace_layout w
                 JOIN projects p ON p.id = w.project_id
                WHERE p.name = ?`,
            )
            .get(projectName) as { json?: string } | undefined;
          if (row?.json === undefined) return false;
          const strings: string[] = [];
          const walk = (v: unknown): void => {
            if (typeof v === 'string') strings.push(v);
            else if (Array.isArray(v)) v.forEach(walk);
            else if (v && typeof v === 'object') Object.values(v).forEach(walk);
          };
          walk(JSON.parse(row.json));
          return strings.some((s) => normPath(s) === target);
        } catch {
          return false; // not written yet, or a transient read of a mid-write DB
        } finally {
          db?.close();
        }
      },
      { timeout: 15_000, message: `the layout for "${projectName}" never picked up ${path}` },
    )
    .toBe(true);
}

/*
 * ── TWO REMOVED (035 T056) ──
 *
 * `:178` AC1 — a cut+paste move re-points the editor, does not dirty it, raises no notice.
 * `:374` AC7 — a file moved by ANOTHER program keeps its buffer, dirty and recoverable.
 *
 * AC1 SPLIT, AND THREE QUARTERS OF IT WAS ALREADY COVERED. The three symptoms it gathered — the
 * re-point, the clean flag, the absent notice — are `integration/editor-move.integration.test.ts:158`
 * ("a clean move is not news"), made against the authority that decides them, with `:99`/`:122`/`:138`
 * adding the dirty case, the once-per-window broadcast, and the registry and folder watch following.
 *
 * THE FOURTH HAD NO TEST AT ANY LAYER, and it is the one `use-editor.ts:1086` names in its own
 * comment: the header's FILE PILL, i.e. the view's copy of the path — which is also what a Ctrl+S
 * writes to. Nothing below E2E had ever driven a `movedTo` message, so the hop from the broadcast
 * to the renderer's store was untested in both directions. It is now
 * `component/editor-moved-path.test.ts`, which adds the language re-derivation that rides with it
 * (a move can change the extension: `notes.txt` → `notes.py`).
 *
 * AC7 WENT WHOLE to `integration/editor-move.integration.test.ts`, as three cases rather than one.
 * It is the GUARD on every other test in that file: those are moves throng performed and knows
 * about; this is the one that must NOT behave the same, because nothing told the app anything.
 * The third case is new — a save must not reach the copy the external move created — and it could
 * not be written here at all, because the E2E had both paths holding identical bytes.
 *
 * ── WHAT STAYS, EACH WITH ITS OWN ENTRY ──
 *
 * AC2 `@reserve:osdrag` (a real drag), AC3 `@reserve:input` (a real Ctrl+S), and AC8
 * `@reserve:window` (a panel in a BACKGROUND tab, whose listener is not mounted — FR-008 is a claim
 * about a window's other tabs, and there is no such thing below this layer).
 */
test('AC2 — a drag-move re-points the editor just as a cut+paste does', { tag: ['@extended', '@editor', '@reserve:osdrag'] }, async () => {
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

test('AC3 — saving after a move writes to the NEW location and does not re-create the old file', { tag: ['@extended', '@editor', '@reserve:input'] }, async () => {
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
        .poll(() => (existsSync(newPath) ? readFileSync(newPath, 'utf8') : ''), { timeout: FILE_OP_TIMEOUT_MS })
        .toContain('EDITED-AFTER-MOVE');
      // …and the save does NOT silently undo the move by re-creating the old file.
      expect(existsSync(oldPath), `save re-created the moved-from file at ${oldPath}`).toBe(false);
      await expect(win.getByTestId(`panel-unsaved-${pid}`)).toHaveCount(0);
    });
  } finally {
    rmRoot(root);
  }
});

/*
 * DELETED (034 FR-045) — AC4, AC5 and AC6, each already asserted in
 * `packages/ui/tests/integration/editor-move.integration.test.ts` against the real coordinator:
 *
 *   AC4 → "the one-buffer registry and the folder watch both follow the file". It asserts the
 *   EXACT pair this test did — `openInto(to)` is `focus` for the same panel, `openInto(from)` is
 *   `open` — and then goes further, writing to the moved file and requiring the document to
 *   notice, which proves the per-folder watch re-attached. Strictly more than the E2E asked.
 *
 *   AC5 → "a clean move is not news: no dirty, no delete, no notice, and no recovery snapshot
 *   (FR-003/AC5)", which names the criterion in its own title and asks `coord.recover()` rather
 *   than looking for a file under a seeded `userDataDir`. That also removes one of this file’s
 *   two own-app launches.
 *
 *   AC6 → "rewrites the path by prefix, in the destination folder’s own spelling" plus
 *   "matches by identity, never by spelling: `pack-lock.txt` is not under `pack`". The second is
 *   the trap a prefix rewrite actually falls into, and no E2E here ever tested it. AC6 also
 *   called `skipIfElevated()`, so it never ran on CI at all — the coverage it appeared to give
 *   was only ever a developer’s local run.
 *
 * WHAT STAYS: AC1, because it is the one test joining the tree gesture to the coordinator and the
 * only assertion on the panel’s file pill; AC2 and AC3, whose residues are a real drag and a real
 * Ctrl+S clearing the unsaved indicator; AC7, the external-mover guard; and AC8, which restarts
 * the app and is the only thing that can tell "the view adopted the path on remount" from "the
 * layout learnt it".
 */

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
test('AC8 — a move reaches the persisted layout of a panel in a BACKGROUND tab (FR-008)', { tag: ['@extended', '@editor', '@reserve:window'] }, async () => {
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
        await expectLayoutHasPath(dataDir, 'Mv8', newPath);
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
        // Restored onto the real file: clean, no recovered buffer, and nothing reporting a file it
        // could not open — asserted on BOTH surfaces, since 030 US3 moved that report from the
        // dialog to the consolidated notice (T052).
        await expect(win.locator('.throng-unsaved-dot')).toHaveCount(0);
        await expect(win.getByTestId('editor-notice-dialog')).toHaveCount(0);
        await expect(win.getByTestId('panel-failure-notice')).toHaveCount(0);
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
