import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import {
  openApp,
  runApp as runOwnApp,
  createProject,
  cleanupTemp,
  FILE_OP_TIMEOUT_MS,
  type OpenApp,
} from './harness.js';

// Reported bug: Ctrl-selecting a MIX of files and folders then Delete removes only
// the folders. Expected: ALL selected items are deleted after confirmation.

function makeProject(): string {
  const root = mkdtempSync(join(tmpdir(), 'throng-delmix-e2e-'));
  writeFileSync(join(root, 'file1.txt'), '1');
  writeFileSync(join(root, 'file2.txt'), '2');
  mkdirSync(join(root, 'dir1'));
  mkdirSync(join(root, 'dir2'));
  return root;
}

/*
 * ONE seeded app for the two PERMANENT-delete tests (034 FR-045, SC-027) — 3 launches -> 2.
 *
 * `explorer.deleteMode = permanent` genuinely has to be in settings.json before the app starts,
 * so neither of those tests can run against a default app. But they seeded the SAME document
 * into two temp roots and launched twice, and one seeded app answers for both. (Test 1's
 * document carried an extra empty `confirmations: {}`, which is the defaults written out.)
 *
 * The recycle test keeps `runOwnApp`: its subject is the SHIPPED default, which is the one
 * thing a seeded app cannot show.
 *
 * The two projects were both called "DelMix" and are named apart. Their roots move to
 * `afterAll`: each test empties its own tree and then deleted the watched root itself.
 *
 * Opened lazily, so a `--grep` that selects only the recycle test never launches it.
 */
test.describe.configure({ mode: 'serial' });

const ownedRoots: string[] = [];
/** Register a temp directory for removal in `afterAll`, once the shared app has closed. */
function own(dir: string): string {
  ownedRoots.push(dir);
  return dir;
}

let seeded: OpenApp | undefined;

const runSeeded = async (
  fn: (app: OpenApp['app'], win: OpenApp['win']) => Promise<void>,
): Promise<void> => {
  if (!seeded) {
    const cfgRoot = own(mkdtempSync(join(tmpdir(), 'throng-cfg-del-')));
    writeFileSync(
      join(cfgRoot, 'settings.json'),
      JSON.stringify({ version: 1, explorer: { deleteMode: 'permanent' }, confirmations: {} }),
    );
    seeded = await openApp({ env: { THRONG_CONFIG_ROOT: cfgRoot } });
  }
  return fn(seeded.app, seeded.win);
};

test.afterAll(async () => {
  await seeded?.close();
  seeded = undefined;
  for (const dir of ownedRoots.splice(0)) cleanupTemp(dir);
});

/*
 * ── ONE REMOVED (035 T056) ──
 *
 * `:73` "Ctrl-selecting files + folders and deleting removes ALL of them" — split, and both halves
 * already had, or now have, a home:
 *
 *   Delete is addressed to the SELECTION rather than to the row under the pointer
 *     → `unit/explorer-subtree-menu.test.ts` (new)
 *   all of them really go — files and folders, in any order, and an ENOENT part-way through does
 *   not abort the rest
 *     → `integration/files-delete-mixed.integration.test.ts:39-57`, four cases against a real
 *       filesystem
 *
 * The TARGETING rule (`context-menu-items.ts:85`) had no test for either branch. This file used the
 * multi-select shape for `Hide` — which deliberately does NOT take the selection — so the shape was
 * present and the rule was not. The new tests pin both directions, and the second is the one that
 * protects the user: right-clicking a row OUTSIDE the selection must not sweep the selection up
 * with it. `always-the-selection` reddens exactly that and nothing else.
 *
 * Red-proven: row-only (2), always-the-selection (1).
 *
 * ── WHAT STAYS ──
 *
 * `:113` `@reserve:native` — it recycles through the REAL shell and reads the Recycle Bin back.
 * `:146` `@reserve:input` — it presses a real Delete key with an editor open, which is a claim about
 * where the keystroke lands rather than about what the menu targets.
 */
test('recycle mode (default): mixed files + folders all get recycled via the real shell', { tag: ['@extended', '@explorer', '@reserve:native'] }, async () => {
  const root = makeProject();
  try {
    await runOwnApp(async (_app, win) => {
      await createProject(win, 'DelMix', root);
      const tree = win.getByTestId('file-explorer-tree');
      await expect(tree).toBeVisible();

      await tree.getByText('dir1', { exact: true }).click();
      await tree.getByText('file1.txt', { exact: true }).click({ modifiers: ['Control'] });
      await tree.getByText('dir2', { exact: true }).click({ modifiers: ['Control'] });
      await tree.getByText('file2.txt', { exact: true }).click({ modifiers: ['Control'] });
      await expect(tree.locator('.tree-row--selected')).toHaveCount(4);

      // Default deleteMode is 'recycle' → real shell.trashItem.
      await tree.getByText('file2.txt', { exact: true }).click({ button: 'right', modifiers: ['Control'] });
      await win.getByTestId('menu-item-Delete').click();
      await win.getByTestId('confirm-accept').click();
      const wry = win.getByTestId('confirm-accept');
      if (await wry.isVisible().catch(() => false)) await wry.click();

      await expect
        .poll(
          () => ['file1.txt', 'file2.txt', 'dir1', 'dir2'].filter((n) => existsSync(join(root, n))),
          { timeout: FILE_OP_TIMEOUT_MS },
        )
        .toEqual([]);
    });
  } finally {
    cleanupTemp(root);
  }
});

test('file-first selection (opens an editor) then Delete key removes ALL selected', { tag: ['@extended', '@explorer', '@reserve:input'] }, async () => {
  const root = own(makeProject());
  try {
    await runSeeded(
      async (_app, win) => {
        await createProject(win, 'DelMixKey', root);
        const tree = win.getByTestId('file-explorer-tree');
        await expect(tree).toBeVisible();

        // Plain-click a FILE first — this OPENS it into an editor (and may move focus).
        await tree.getByText('file1.txt', { exact: true }).click();
        await tree.getByText('dir1', { exact: true }).click({ modifiers: ['Control'] });
        await tree.getByText('file2.txt', { exact: true }).click({ modifiers: ['Control'] });
        await tree.getByText('dir2', { exact: true }).click({ modifiers: ['Control'] });
        await expect(tree.locator('.tree-row--selected')).toHaveCount(4);

        // Delete via the Delete KEY (needs tree focus) + confirm.
        await win.keyboard.press('Delete');
        await win.getByTestId('confirm-accept').click();
        const wry = win.getByTestId('confirm-accept');
        if (await wry.isVisible().catch(() => false)) await wry.click();

        await expect
          .poll(
            () =>
              ['file1.txt', 'file2.txt', 'dir1', 'dir2'].filter((n) => existsSync(join(root, n))),
            { timeout: FILE_OP_TIMEOUT_MS },
          )
          .toEqual([]);
      },
    );
  } finally {
    // The root is deleted in `afterAll`, once the shared app has CLOSED. Deleting it here would
    // remove a folder the explorer is still watching.
  }
});
