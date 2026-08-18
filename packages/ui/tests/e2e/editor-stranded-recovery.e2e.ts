import { mkdtempSync, mkdirSync, writeFileSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { test, expect, type Page } from '@playwright/test';
import { runApp, createProject, firstPanelId, reloadWindow, cleanupTemp} from './harness.js';

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
 * ══ STATUS: all three are LIVE (027 / #161 is fixed) ══
 *
 * Tests 2 and 3 were committed as `test.fixme` — known-failing, awaiting #161 — because #161 had
 * been BUILT on the 026 branch and then REVERTED: the banner, `Reload from disk` and auto-recovery
 * all worked, but the change made the tab-open "cannot open file" notice fire on remounts FR-105
 * exempts (`editor-missing-aggregate.e2e.ts` went red on both its cases).
 *
 * The `.fixme`s are gone and the assertions were NOT rewritten, as that commit required. What the
 * second attempt added is the root cause the first one never found: the watch on a missing path is
 * ABANDONED rather than made to wait for it, so nothing was ever going to notice the repair. See
 * `editor-stranded-restart.e2e.ts` for the reported cycle end to end, and
 * `packages/ui/tests/unit/file-watcher-missing-path.test.ts` for the watcher contract.
 *
 * The aggregate-notice regression is avoided by keeping the two facts apart: `unloadable` (the path
 * cannot be read — drives the banner, survives a remount) is a different field from `fileMissing`
 * (drives the one-shot tab-open dialog, which FR-105 keeps silent on a remount). Nothing on the
 * recovery path calls `openFile`, which warns immediately by design and was the second half of that
 * regression.
 *
 * Test 1 remains the GREEN fence it always was: it is the behaviour a fix for the other two was
 * most likely to break, and it still passes.
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

test('an editor recovers when its folder is renamed away and back WHILE throng is running', { tag: ['@extended', '@editor'] }, async () => {
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
      /*
       * A FENCE WAS TRIED HERE AND THE PREMISE WAS WRONG. Recorded, because it is a reasonable
       * inference that happens to be false.
       *
       * The attempt asserted the shared panel-failure banner appears here —
       * `expect(getByTestId('panel-failure-<pid>')).toBeVisible()` — reasoning that the folder watch
       * sets `unloadable` and 027/#161's banner renders it, which would make "the break is seen" an
       * observable rather than a duration. It failed every attempt at 15s each.
       *
       * The banner IS the right observable further down, after the panel is REOPENED (see the
       * `restoredPid` assertions below, which pass). It does not appear for a live rename-away of an
       * already-open editor, so the state the fence assumed simply is not reached at this point.
       *
       * sleep-justified: the folder watch has a debounce and raises nothing observable when it
       * sleep-justified: notices a live rename-away — the panel keeps rendering its buffer, which is
       * sleep-justified: precisely the defect this test exists to catch, so there is no signal to
       * sleep-justified: wait on that is not also the thing under test.
       */
      await win.waitForTimeout(1000);
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
    cleanupTemp(root);
  }
});

test('an editor stranded across a restart recovers when the path is repaired', { tag: ['@extended', '@editor'] }, async () => {
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
      // below was a PROPOSED affordance when this was written; 030 US4 (#236, FR-039) settled it as
      // `panel-failure-{panelId}` — the ONE banner every panel type renders, replacing this
      // editor-only markup. What is pinned here is unchanged: some such state must exist, and it
      // must carry the path (FR-040a is that requirement, kept because of this test).
      const unloadable = win.getByTestId(`panel-failure-${restoredPid}`);
      await expect(unloadable).toBeVisible({ timeout: 10_000 });
      await expect(unloadable).toContainText('code.txt');
      /*
       * …and it says what the paragraph above says: the text on screen is NOT the file (026
       * `contracts/editor-unloadable.md` P3).
       *
       * Added because its absence let that requirement be deleted without a red. The 030 migration
       * to the shared banner rendered headline + path + pointer and had nowhere to put this
       * sentence; visibility and the path are exactly the two things this test was already asserting,
       * so it went through green. It is the load-bearing half rather than a nicety: `unloadable`
       * guards no save path in the renderer (026 P6 is unimplemented there), so while it is on
       * screen this is the only warning that a Ctrl+S writes the remembered buffer back over a path
       * throng could not read — which is the very hazard the comment above describes.
       */
      await expect(
        unloadable,
        'the banner no longer says the text on screen is a remembered buffer rather than the file',
      ).toContainText('What is shown here is not the file.');

      // Put the path back, as the user does — with the file having moved on while it was away, so
      // "it recovered" cannot be satisfied by the stale buffer that was already on screen.
      writeFileSync(join(root, 'src-elsewhere', 'code.txt'), 'CHANGED-WHILE-AWAY\n');
      renameSync(join(root, 'src-elsewhere'), join(root, 'src'));

      // It re-loads the file's CURRENT content in place: same panel, same tab, same panel name.
      await expect(content).toContainText('CHANGED-WHILE-AWAY', { timeout: 20_000 });
    }, { dataDir });
  } finally {
    for (const dir of [root, dataDir]) {
      cleanupTemp(dir);
    }
  }
});

test('a "Reload from disk" action exists and re-reads the path on demand', { tag: ['@extended', '@editor'] }, async () => {
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
    cleanupTemp(root);
  }
});
