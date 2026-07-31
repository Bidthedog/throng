import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import { runApp, createProject } from './harness.js';
import { skipIfElevated } from './admin.js';

/**
 * 026 / #186 — the Files & Folders tree must stay live-synced with the filesystem.
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

test('a file created and then deleted OUTSIDE throng appears and disappears with no user action', async () => {
  const root = makeProject();
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'LiveSync', root);
      const tree = win.getByTestId('file-explorer-tree');
      await expect(tree).toBeVisible();
      await expect(tree.getByText('seed.txt', { exact: true })).toBeVisible();

      // (1) External CREATE, directly under the watched root.
      writeFileSync(join(root, 'external.txt'), 'from outside\n');
      await expect(tree.getByText('external.txt', { exact: true })).toBeVisible({ timeout: 10_000 });

      // (2) External DELETE of that same file.
      rmSync(join(root, 'external.txt'), { force: true });
      expect(existsSync(join(root, 'external.txt'))).toBe(false);
      await expect(tree.getByText('external.txt', { exact: true })).toHaveCount(0, { timeout: 10_000 });
    });
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
  }
});

test('a file created OUTSIDE throng in an EXPANDED subfolder appears there', async () => {
  // A loaded-but-nested directory is the case `reloadDirs()` re-reads by walking every loaded key,
  // and the case a re-pointed or dead watcher breaks first.
  const root = makeProject();
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'LiveSyncSub', root);
      const tree = win.getByTestId('file-explorer-tree');
      await expect(tree).toBeVisible();

      await tree.getByText('sub', { exact: true }).dblclick();
      await expect(tree.getByText('inner.txt', { exact: true })).toBeVisible({ timeout: 10_000 });

      writeFileSync(join(root, 'sub', 'nested-external.txt'), 'x\n');
      await expect(tree.getByText('nested-external.txt', { exact: true })).toBeVisible({ timeout: 10_000 });
    });
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
  }
});

test('a file deleted INSIDE throng leaves the tree immediately', async () => {
  skipIfElevated();
  const root = makeProject();
  const cfgRoot = permanentDeleteConfig();
  try {
    await runApp(
      async (_app, win) => {
        await createProject(win, 'LiveSyncDel', root);
        const tree = win.getByTestId('file-explorer-tree');
        await expect(tree).toBeVisible();

        const row = tree.getByText('seed.txt', { exact: true });
        await row.click();
        await row.click({ button: 'right' });
        await win.getByTestId('menu-item-Delete').click();
        await win.getByTestId('confirm-accept').click();
        const wry = win.getByTestId('confirm-accept');
        if (await wry.isVisible().catch(() => false)) await wry.click();

        // The delete really happened — so a tree that still shows it is a tree that is stale,
        // not an operation that failed.
        await expect.poll(() => existsSync(join(root, 'seed.txt')), { timeout: 8000 }).toBe(false);
        await expect(tree.getByText('seed.txt', { exact: true })).toHaveCount(0, { timeout: 10_000 });
        await expect(tree.locator('.explorer__error')).toHaveCount(0);
      },
      { env: { THRONG_CONFIG_ROOT: cfgRoot } },
    );
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
    rmSync(cfgRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
  }
});

test('a FOLDER deleted INSIDE throng leaves the tree immediately', async () => {
  skipIfElevated();
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

        await expect.poll(() => existsSync(join(root, 'sub')), { timeout: 8000 }).toBe(false);
        await expect(tree.getByText('sub', { exact: true })).toHaveCount(0, { timeout: 10_000 });
      },
      { env: { THRONG_CONFIG_ROOT: cfgRoot } },
    );
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
    rmSync(cfgRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
  }
});
