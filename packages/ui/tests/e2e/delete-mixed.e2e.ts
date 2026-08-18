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

test('Ctrl-selecting files + folders and deleting removes ALL of them', { tag: ['@extended', '@explorer'] }, async () => {
  const root = own(makeProject());
  try {
    await runSeeded(
      async (_app, win) => {
        await createProject(win, 'DelMixMenu', root);
        const tree = win.getByTestId('file-explorer-tree');
        await expect(tree).toBeVisible();

        // Select all four with Ctrl held (multi-select).
        await tree.getByText('dir1', { exact: true }).click();
        await tree.getByText('file1.txt', { exact: true }).click({ modifiers: ['Control'] });
        await tree.getByText('dir2', { exact: true }).click({ modifiers: ['Control'] });
        await tree.getByText('file2.txt', { exact: true }).click({ modifiers: ['Control'] });
        await expect(tree.locator('.tree-row--selected')).toHaveCount(4);

        // Delete via the context menu (targets the whole selection).
        await tree.getByText('file2.txt', { exact: true }).click({ button: 'right', modifiers: ['Control'] });
        await win.getByTestId('menu-item-Delete').click();
        // Confirm (double-confirm default → accept once, then the wry one if present).
        await win.getByTestId('confirm-accept').click();
        const wry = win.getByTestId('confirm-accept');
        if (await wry.isVisible().catch(() => false)) await wry.click();

        // ALL four are gone.
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

test('recycle mode (default): mixed files + folders all get recycled via the real shell', { tag: ['@extended', '@explorer'] }, async () => {
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

test('file-first selection (opens an editor) then Delete key removes ALL selected', { tag: ['@extended', '@explorer'] }, async () => {
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
