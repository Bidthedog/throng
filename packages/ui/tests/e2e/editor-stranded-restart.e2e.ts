import { mkdtempSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { test, expect, type Page } from '@playwright/test';
import { runApp, createProject, firstPanelId, cleanupTemp} from './harness.js';

/**
 * 027 / #161 — the reported cycle, end to end: close throng, rename the PROJECT FOLDER, reopen,
 * put the folder back.
 *
 * This is the replication the issue is actually made of, and it differs from
 * `editor-stranded-recovery.e2e.ts` in the two ways that turned out to matter:
 *
 * 1. **A real restart**, not a renderer reload. Two `runApp` launches over one dataDir and one
 *    userDataDir. A renderer reload leaves UI main's document registry intact, so the remounting
 *    panel adopts the in-memory document and never attempts a load — a different code path, and one
 *    that hid the symptom the reporter saw.
 * 2. **The PROJECT ROOT is renamed**, not a subfolder. That is what breaks the tree, the editor and
 *    (in the report) the terminals at once, and it is why all three of the reported notices appear
 *    together.
 *
 * ══ WHAT WAS MEASURED ON MASTER, before any of this was written ══
 *
 * All three reported errors reproduce verbatim, and the stranded editor comes up **empty** — as the
 * issue says, and contrary to the note added during 026, which measured the renderer-reload path
 * where a still-live in-memory buffer makes it look STALE instead. Both are real; which one you get
 * depends on whether UI main still holds the document. Empty is what a genuine restart gives.
 *
 * Then the folder is renamed back and **nothing at all happens** — not the editor, not the tree.
 * That is one root cause, not three: every watch bound underneath a missing path spends its five
 * retries in under four seconds and is abandoned for the session, so when the path returns there is
 * nobody left watching to notice. Fixing the watch to WAIT for a path that does not exist yet
 * recovers the tree and the editor together.
 *
 * The run time is the other half of the evidence: 1.8 minutes on master (two 30s assertions timing
 * out against a dead watch), 40 seconds once the recovery works.
 */

function makeProject(): string {
  const root = mkdtempSync(join(tmpdir(), 'throng-strandroot-'));
  writeFileSync(join(root, 'code.txt'), 'ORIGINAL-CONTENT\n');
  return root;
}

/**
 * Wait until the project's layout has ACTUALLY reached the daemon's store, holding the open file.
 *
 * A sleep here asserts that some number of milliseconds is always enough for the debounced save
 * plus its IPC round-trip; under worker contention it is not, and the restart this test is ABOUT
 * then restores a layout that was never written. The row in SQLite is a real, observable condition,
 * so poll for it. Mirrors `persistence-restore.e2e.ts`.
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
          return row?.json?.includes('code.txt') ?? false;
        } catch {
          return false;
        } finally {
          db?.close();
        }
      },
      { timeout: 20_000, message: `the editor layout for ${projectName} was never persisted` },
    )
    .toBe(true);
}

/** Enter the project — "reopen throng and the project", as the report has it. */
async function enterProject(win: Page, name: string): Promise<void> {
  const item = win.locator('.project-item', { hasText: name });
  await expect(item).toBeVisible({ timeout: 20_000 });
  const sw = item.locator('[data-testid^="project-switch-"]');
  if (await sw.isVisible().catch(() => false)) await sw.click();
  await expect(win.locator('.panel-box').first()).toBeVisible({ timeout: 20_000 });
}

test('an editor and the tree recover when the project folder is renamed back after a restart', async () => {
  // Two full app launches plus two watcher cycles — past the 30s default.
  test.setTimeout(180_000);
  const root = makeProject();
  const moved = `${root}-renamed`;
  const dataDir = mkdtempSync(join(tmpdir(), 'throng-strandroot-data-'));
  const userDataDir = mkdtempSync(join(tmpdir(), 'throng-strandroot-ud-'));
  try {
    // ── Launch 1: open a project, open a file into an editor, let the layout persist ──
    await runApp(
      async (_app, win) => {
        await createProject(win, 'StrandRoot', root);
        const pid = await firstPanelId(win);
        await win.getByTestId(`panel-type-select-${pid}`).selectOption('editor');
        await win.getByTestId(`panel-type-confirm-${pid}`).click();
        await expect(win.getByTestId(`editor-${pid}`)).toBeVisible();

        const tree = win.getByTestId('file-explorer-tree');
        await expect(tree).toBeVisible();
        await tree.getByText('code.txt', { exact: true }).click();
        await expect(win.getByTestId(`editor-${pid}`).locator('.cm-content')).toContainText(
          'ORIGINAL-CONTENT',
          { timeout: 15_000 },
        );
        await expectEditorLayoutSaved(dataDir, 'StrandRoot');
      },
      { dataDir, userDataDir },
    );

    // ── throng is closed. Rename the project folder, exactly as the report does. ──
    renameSync(root, moved);
    expect(existsSync(root)).toBe(false);

    // ── Launch 2: reopen throng and the project ──
    await runApp(
      async (_app, win) => {
        await enterProject(win, 'StrandRoot');
        const pid = await firstPanelId(win);
        const editor = win.getByTestId(`editor-${pid}`);
        await expect(editor).toBeVisible({ timeout: 25_000 });

        /**
         * The editor SAYS it could not read its file, and NAMES the path.
         *
         * The defect is not merely that recovery never happens — it is that nothing on screen
         * distinguishes "this is your file" from "this is what your file used to say". On this
         * path the panel comes up empty; when a recovery snapshot survives it comes up holding
         * remembered text and looking entirely ordinary, and a Ctrl+S would write that text back
         * over a path throng could not even open.
         */
        const unloadable = win.getByTestId(`editor-unloadable-${pid}`);
        await expect(unloadable).toBeVisible({ timeout: 15_000 });
        await expect(unloadable).toContainText('code.txt');

        // ── Rectify the cause. The file has moved on while it was away, so "it recovered" cannot
        //    be satisfied by whatever was already on screen. ──
        writeFileSync(join(moved, 'code.txt'), 'CHANGED-WHILE-AWAY\n');
        renameSync(moved, root);

        // The editor loads the file's CURRENT content in place — same panel, same tab, same name —
        // and stops claiming it cannot be read.
        await expect(editor.locator('.cm-content')).toContainText('CHANGED-WHILE-AWAY', {
          timeout: 40_000,
        });
        await expect(unloadable).toHaveCount(0);

        // …and so does the tree, from the same fix: its watch waited for the root rather than
        // giving up on it. Which is why the third reported notice — "Live updates have stopped for
        // this project. Reopen it to resume watching for changes." — must NOT be on screen: live
        // updates demonstrably did resume, so telling the user to reopen the project would be
        // false, and it is the notice that used to fire here.
        const tree = win.getByTestId('file-explorer-tree');
        await expect(tree.getByText('code.txt', { exact: true })).toBeVisible({ timeout: 40_000 });
        await expect(win.getByText('Live updates have stopped for this project.')).toHaveCount(0);
      },
      { dataDir, userDataDir },
    );
  } finally {
    for (const dir of [root, moved, dataDir, userDataDir]) {
      cleanupTemp(dir);
    }
  }
});
