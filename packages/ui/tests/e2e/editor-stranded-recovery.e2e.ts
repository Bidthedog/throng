import { mkdtempSync, mkdirSync, writeFileSync, rmSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { test, expect, type Page } from '@playwright/test';
import { runApp, createProject, firstPanelId, reloadWindow } from './harness.js';
import { skipIfElevated } from './admin.js';

/**
 * 026 / #161 — a stranded editor must recover once its file comes back.
 *
 * An editor whose path cannot be read comes up empty and stays that way. Once the user rectifies
 * the cause — renames the folder back, moves the file back — nothing re-reads the path, so the
 * only escape is to destroy the panel and reopen the file.
 *
 * `Revert` is not the missing operation and must not become it: `EditorCoordinator.revert()` resets
 * the buffer to `doc.authority.savedText`, throng's CACHED belief about what is on disk, and
 * deliberately refuses when the file is gone rather than silently blanking the document. What is
 * absent is a fresh READ of the path.
 *
 * WHAT 024 ALREADY BUILT, per the maintainer note on the issue. `EditorCoordinator.markRestored()`
 * re-reads a path from disk and, when the content matches the buffer, resets the document to clean.
 * The re-read exists. It is wired to exactly one caller — throng's own file-undo
 * (`files-service.ts`) — so it never fires for an external restore, which is the case the issue is
 * about. What remains is a TRIGGER and the manual action.
 *
 * ══ WHAT WAS MEASURED, which is not all what the issue assumes ══
 *
 * 1. **Move-away-and-move-back WHILE RUNNING already works.** The issue calls this out as an open
 *    question — "it must be proven either way, not assumed". Proven: it recovers, and it picks up
 *    content that changed while the path was broken. Test 1 PASSES on master and is here as the
 *    regression fence, because it is the behaviour a fix for the restart case could easily break.
 *
 * 2. **The stranded editor is not empty — it is stale.** After a restart against a broken path the
 *    panel does NOT "come up empty" as reported: throng restores the buffer from its own recovery
 *    snapshot, so the editor shows the last-known text and looks entirely ordinary while the path
 *    behind it is unreadable. That is worse than blank rather than better — nothing distinguishes
 *    "this is your file" from "this is what your file used to say", and a Save would write the
 *    stale text back to a path throng could not read. The reported empty panel presumably needs a
 *    file that was never snapshotted; it did not reproduce here, and the issue text should be
 *    corrected to the stale-buffer symptom, which is worse and is demonstrable.
 *
 * 3. **`Reload from disk` does not exist**, exactly as reported.
 *
 * ══ STATUS: two of these are `test.fixme` — deliberately, and not forever ══
 *
 * #161 was BUILT on this branch and then REVERTED: the banner, `Reload from disk` and auto-recovery
 * all worked and these two tests went green, but the change made the tab-open "cannot open file"
 * notice fire on remounts FR-105 exempts (`editor-missing-aggregate.e2e.ts` went red on both its
 * cases). Trading one issue's fix for another's regression is not a fix, so it was backed out and
 * #161 stays open.
 *
 * They are `fixme` rather than left failing because a suite that is red on a developer's machine
 * and green in CI is worse than one that is honestly red. These two call `skipIfElevated()`, and CI
 * runs ELEVATED — so they skip there and fail here, which would have made the branch's green
 * depend on which machine ran it. `fixme` says the same thing in both places: known-failing,
 * awaiting #161.
 *
 * **Remove the `.fixme` when picking #161 up — do not rewrite the assertions.** They are correct;
 * the implementation is what is missing. Test 2 asserts an `editor-unloadable-<panelId>` affordance
 * whose real name the spec must settle — what it pins is that some explicit unloadable state exists
 * and names the path.
 *
 * Test 1 is a live GREEN fence and stays that way: it is the behaviour a fix for the other two is
 * most likely to break. What was learnt from the attempt is recorded on issue #161.
 */

function makeProject(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  mkdirSync(join(root, 'src'));
  writeFileSync(join(root, 'src', 'code.txt'), 'ORIGINAL-CONTENT\n');
  return root;
}

async function newEditor(win: Page): Promise<string> {
  const pid = await firstPanelId(win);
  await win.getByTestId(`panel-type-select-${pid}`).selectOption('editor');
  await win.getByTestId(`panel-type-confirm-${pid}`).click();
  await expect(win.getByTestId(`editor-${pid}`)).toBeVisible();
  return pid;
}

const item = (win: Page, label: string) => win.getByTestId(`menu-item-${label}`);

/**
 * Wait until the project's layout has ACTUALLY reached the daemon's store as an EDITOR panel.
 *
 * A sleep here asserts that some number of milliseconds is always enough for the debounced save
 * plus its IPC round-trip; under worker contention it is not, and the restart this test is ABOUT
 * then restores a layout that was never written. The panel comes back as an unconfigured Panel
 * Type form and the failure reads as "the editor vanished" — which is a test artefact, not #161.
 * (That is exactly how the first draft of this test failed.) The row in SQLite is a real,
 * observable condition, so poll for it. Mirrors `persistence-restore.e2e.ts`.
 */
async function expectEditorLayoutSaved(dataDir: string, projectName: string): Promise<void> {
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
          return row?.json?.includes('editor') ?? false;
        } catch {
          return false;
        } finally {
          db?.close();
        }
      },
      { timeout: 15_000, message: `the editor layout for ${projectName} was never persisted` },
    )
    .toBe(true);
}

/** Open `src/code.txt` into the panel's editor via the tree, and settle on its content. */
async function openTheFile(win: Page, pid: string): Promise<void> {
  const tree = win.getByTestId('file-explorer-tree');
  await expect(tree).toBeVisible();
  await tree.getByText('src', { exact: true }).dblclick();
  await tree.getByText('code.txt', { exact: true }).click();
  await expect(win.getByTestId(`editor-${pid}`).locator('.cm-content')).toContainText(
    'ORIGINAL-CONTENT',
    { timeout: 10_000 },
  );
}

test('an editor recovers when its folder is renamed away and back WHILE throng is running', async () => {
  skipIfElevated();
  // Two full watcher/restore cycles plus a deliberate negative assertion — past the 30s default.
  test.setTimeout(120_000);
  const root = makeProject('throng-strand-live-');
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'StrandLive', root);
      const pid = await newEditor(win);
      await openTheFile(win, pid);

      // Break the path from outside, and change the file while it is away. The changed content is
      // what makes this test non-vacuous: if the assertion were merely "the original text is still
      // shown", a throng that never noticed anything would pass it while being exactly as broken.
      renameSync(join(root, 'src'), join(root, 'src-moved'));
      await win.waitForTimeout(1000); // past the watcher debounce, so the break is seen if it ever is
      writeFileSync(join(root, 'src-moved', 'code.txt'), 'CHANGED-WHILE-AWAY\n');

      // Rectify the cause — exactly what the user does, and the point at which the issue says
      // nothing happens.
      renameSync(join(root, 'src-moved'), join(root, 'src'));

      // The path is readable again, so the editor loads the file's CURRENT content in place —
      // same panel, same tab, same panel name. `markRestored()` already performs this exact
      // re-read; nothing triggers it for an external restore.
      await expect(win.getByTestId(`editor-${pid}`).locator('.cm-content')).toContainText(
        'CHANGED-WHILE-AWAY',
        { timeout: 20_000 },
      );
    });
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
  }
});

test.fixme('an editor stranded across a restart recovers when the path is repaired', async () => {
  skipIfElevated();
  test.setTimeout(120_000);
  const root = makeProject('throng-strand-restart-');
  const dataDir = mkdtempSync(join(tmpdir(), 'throng-strand-data-'));
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'StrandRestart', root);
      const pid = await newEditor(win);
      await openTheFile(win, pid);
      await expectEditorLayoutSaved(dataDir, 'StrandRestart');

      // "Close throng, rename the folder outside it, reopen." A renderer reload is the faithful
      // in-harness equivalent: the layout is restored from persisted state, still pointing at the
      // old path, and the load fails.
      renameSync(join(root, 'src'), join(root, 'src-elsewhere'));
      await reloadWindow(win);

      // A reloaded window comes up with no project selected, so nothing is restored until one is
      // entered — re-enter it, which is also what "reopen throng and the project" means in the report.
      await win
        .locator('.project-item', { hasText: 'StrandRestart' })
        .locator('[data-testid^="project-switch-"]')
        .click();

      // The restored layout may not reuse the pre-reload panel id, so re-derive it rather than
      // asserting against a stale one (that mistake reads as "the editor vanished").
      const restoredPid = await firstPanelId(win);
      const content = win.getByTestId(`editor-${restoredPid}`).locator('.cm-content');
      await expect(win.getByTestId(`editor-${restoredPid}`)).toBeVisible({ timeout: 20_000 });

      // MEASURED, and NOT what the issue describes: the panel does not come up empty. throng
      // restores the buffer from its own recovery snapshot, so the editor shows the last-known
      // text and looks completely ordinary — while the path behind it is unreadable. That is worse
      // than blank, not better: nothing distinguishes "this is your file" from "this is what your
      // file used to say", and a Save would write the stale text back to a path throng cannot read.
      //
      // AC 1 requires an explicit unloadable state naming the path it could not read. The testid
      // below is a PROPOSED affordance — the spec has to settle its real name; what this pins is
      // that some such state must exist and must carry the path.
      const unloadable = win.getByTestId(`editor-unloadable-${restoredPid}`);
      await expect(unloadable).toBeVisible({ timeout: 10_000 });
      await expect(unloadable).toContainText('code.txt');

      // Put the path back, as the user does — with the file having moved on while it was away, so
      // "it recovered" cannot be satisfied by the stale buffer that was already on screen.
      writeFileSync(join(root, 'src-elsewhere', 'code.txt'), 'CHANGED-WHILE-AWAY\n');
      renameSync(join(root, 'src-elsewhere'), join(root, 'src'));

      // It re-loads the file's CURRENT content in place: same panel, same tab, same panel name.
      await expect(content).toContainText('CHANGED-WHILE-AWAY', { timeout: 20_000 });
    }, { dataDir });
  } finally {
    for (const dir of [root, dataDir]) {
      rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
    }
  }
});

test.fixme('a "Reload from disk" action exists and re-reads the path on demand', async () => {
  skipIfElevated();
  const root = makeProject('throng-strand-reload-');
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'StrandReload', root);
      const pid = await newEditor(win);
      await openTheFile(win, pid);

      // The fallback for everything auto-recovery cannot see — a network path, a watcher that
      // missed the event, a move-away-and-back inside one watcher gap — and the explicit
      // "just re-read it" escape hatch.
      await win.getByTestId(`panel-handle-${pid}`).click({ button: 'right' });
      const reload = item(win, 'Reload from disk');
      await expect(reload).toBeVisible();

      // It is a DISTINCT action, not a rename of Revert: Revert keeps its FR-075 semantics.
      await expect(item(win, 'Revert')).toBeVisible();

      // Change the file underneath the editor, then re-read it on demand.
      writeFileSync(join(root, 'src', 'code.txt'), 'CHANGED-ON-DISK\n');
      await reload.click();
      await expect(win.getByTestId(`editor-${pid}`).locator('.cm-content')).toContainText(
        'CHANGED-ON-DISK',
        { timeout: 15_000 },
      );
    });
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
  }
});
