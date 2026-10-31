import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import { runApp, createProject, cleanupTemp, FILE_OP_TIMEOUT_MS } from './harness.js';

/**
 * 026 / #186 — the File Explorer tree must stay live-synced with the filesystem.
 *
 * Three reported symptoms, asserted separately because they do not share one cause:
 *
 *  1. a file created OUTSIDE throng never appears;
 *  2. a file deleted OUTSIDE throng never disappears;
 *  3. a file or folder deleted INSIDE throng stays in the tree.
 *
 * (3) has a cause visible in the code and independent of the watcher: `remove()` in
 * `use-explorer-data.ts` awaits `files.delete` and then reconciles NOTHING. Its siblings all do —
 * `onRename`, `drop` and paste each call `reloadDirs(...)` on the awaited result, precisely so the
 * tree converges "even if the debounced fs-watch is missed or coalesced" (their words). Delete is
 * the one mutation that relies wholly on the watcher, so any watcher gap shows up as a delete that
 * appears not to have happened.
 *
 * (1) and (2) exercise the watcher chain end to end: NodeFileWatcher → ExplorerWatcher →
 * `throng:files:changed` broadcast → `files.onChange` → `reloadDirs()`.
 *
 * Each case asserts the DISK first, then the tree. A tree assertion alone cannot tell "the tree
 * did not update" from "the operation did not happen", and those need different fixes.
 *
 * ══ ALL FOUR PASS ON MASTER — read this before treating #186 as reproduced ══
 *
 * In a single window, on a quiet project, every reported symptom works: external creates and
 * deletes appear and disappear, in a nested expanded folder too, and an in-app delete leaves the
 * tree at once. So the defect is CONDITIONAL, and two of the issue's four candidate causes are
 * eliminated outright:
 *
 *   - cause 2 (one global watcher, re-pointed by a second window's `setRoot`) cannot apply: the
 *     explorer only ever mounts in the MAIN window (`app.tsx` renders `FileExplorerPane` there
 *     alone; the sub-workspace renderer has no explorer), so there is only ever one caller of
 *     `files.setRoot`;
 *   - cause 3 (in-app delete has no optimistic update) is REAL in the code — `remove()` is the one
 *     mutation that never calls `reloadDirs`, unlike `onRename`, `drop` and paste — but it is
 *     masked, because the watcher covers it. It becomes visible the moment the watcher has a gap,
 *     which is what makes it worth fixing rather than dismissing.
 *
 * What DOES reproduce is in `file-watcher-liveness.integration.test.ts`: sustained churn starves
 * the watcher's debounce indefinitely, so on a real project root (node_modules, .git, build output)
 * the tree stops updating for as long as the machine is busy. These four therefore stand as the
 * regression fence — the behaviour that must still hold once the debounce is bounded.
 */

/*
 * ALL FOUR VERDICTS DECLINED (035 T056 / FR-022) — and the decline is a correction, not a judgement
 * call.
 *
 * The census marked each of these `integration` with the note "real fs-watcher chain already
 * covered at integration layer per file's own docstring". The docstring says something different,
 * and the difference is the whole point of these four.
 *
 * `file-watcher-liveness.integration.test.ts` has exactly two tests:
 *
 *     "reports a change WHILE a noisy directory is still churning"
 *     "still COALESCES a burst — a max wait must not turn into an event per write"
 *
 * Both are about the DEBOUNCE under churn. Neither asserts that an external create reaches the
 * TREE. That test reproduces the defect (#186); these four are the fence around the behaviour that
 * must still hold once the debounce is bounded — which is what the paragraph above actually says.
 *
 * So the citation was real and pointed at the wrong claim, which is the failure this spec has now
 * met several times: a covering test that covers something adjacent.
 *
 * ── AND THEY ARE NOT CHEAP TO REPLACE, EITHER ──
 *
 * Each asserts the DISK first and then the tree, deliberately: "a tree assertion alone cannot tell
 * 'the tree did not update' from 'the operation did not happen', and those need different fixes."
 * That pairing is the chain — NodeFileWatcher → ExplorerWatcher → `throng:files:changed` →
 * `files.onChange` → `reloadDirs()` — and no layer below this one holds both ends of it.
 */
function makeProject(): string {
  const root = mkdtempSync(join(tmpdir(), 'throng-livesync-'));
  writeFileSync(join(root, 'seed.txt'), 'seed\n');
  mkdirSync(join(root, 'sub'));
  writeFileSync(join(root, 'sub', 'inner.txt'), 'inner\n');
  return root;
}

/** Permanent-delete config, so an in-app delete is assertable on disk with no Recycle Bin hop. */
function permanentDeleteConfig(): string {
  const cfgRoot = mkdtempSync(join(tmpdir(), 'throng-cfg-livesync-'));
  writeFileSync(
    join(cfgRoot, 'settings.json'),
    JSON.stringify({ version: 1, explorer: { deleteMode: 'permanent' }, confirmations: {} }),
  );
  return cfgRoot;
}

/*
 * DELETED (test-suite audit, pass 1) — three of the four, each covered by a test that makes the same assertion:
 *   - "created and then deleted OUTSIDE throng appears and disappears" and "created OUTSIDE throng in an EXPANDED
 *     subfolder appears there" → `explorer.e2e.ts` "reflects external filesystem changes live, preserving
 *     expansion (US2)": an external create inside an expanded folder, an external create at the root, and an
 *     external delete, each with no user action.
 *   - "a file deleted INSIDE throng leaves the tree immediately" → `explorer.e2e.ts` "file operations via context
 *     menu + toolbar", "keyboard shortcuts operate on the tree" and "delete confirmation can be cancelled" (each
 *     deletes a file and asserts the row is gone), and the mixed-delete integration test
 *     `integration/files-delete-mixed.integration.test.ts` for the disk side.
 * The FOLDER delete below stays: no other test deletes a folder through the tree.
 */
test('a FOLDER deleted INSIDE throng leaves the tree immediately', { tag: ['@extended', '@explorer'] }, async () => {
  const root = makeProject();
  const cfgRoot = permanentDeleteConfig();
  try {
    await runApp(
      async (_app, win) => {
        await createProject(win, 'LiveSyncDelDir', root);
        const tree = win.getByTestId('file-explorer-tree');
        await expect(tree).toBeVisible();

        const row = tree.getByText('sub', { exact: true });
        await row.click();
        await row.click({ button: 'right' });
        await win.getByTestId('menu-item-Delete').click();
        await win.getByTestId('confirm-accept').click();
        const wry = win.getByTestId('confirm-accept');
        if (await wry.isVisible().catch(() => false)) await wry.click();

        await expect.poll(() => existsSync(join(root, 'sub')), { timeout: FILE_OP_TIMEOUT_MS }).toBe(false);
        await expect(tree.getByText('sub', { exact: true })).toHaveCount(0, { timeout: 10_000 });
      },
      { env: { THRONG_CONFIG_ROOT: cfgRoot } },
    );
  } finally {
    cleanupTemp(root);
    cleanupTemp(cfgRoot);
  }
});
