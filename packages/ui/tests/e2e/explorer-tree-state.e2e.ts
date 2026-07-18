/**
 * E2E — REPRODUCTION ONLY (v1 bug sweep). Three reported Files & Folders defects:
 *
 *   1. Dragging an EXPANDED folder into another folder collapses it, but the
 *      expansion icon reportedly stays open.
 *   2. Clicking a folder's NAME should not toggle it — only the icon should.
 *   3. A renamed file should stay SELECTED, without firing the open-editor action.
 *
 * These tests assert the REQUIRED behaviour, so they are expected to FAIL against
 * the current build. They exist to establish the true mechanism, not to fix it.
 */
import { test, expect, type Locator, type Page } from '@playwright/test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runApp, createProject, reloadWindow } from './harness.js';

/** react-dnd's empty drag-preview image trips the app's CSP harmlessly; ignore it. */
const realErrors = (errors: string[]): string[] =>
  errors.filter((e) => !e.includes('Content Security Policy') && !e.includes('data:image'));

/**
 * root/
 *   box/       ← drop destination
 *     keep.txt
 *   movable/   ← the folder we expand, then drag into box/
 *     child.txt
 *   a.txt
 */
function makeProjectFolder(): string {
  const root = mkdtempSync(join(tmpdir(), 'throng-treestate-'));
  mkdirSync(join(root, 'box'));
  writeFileSync(join(root, 'box', 'keep.txt'), 'keep\n');
  mkdirSync(join(root, 'movable'));
  writeFileSync(join(root, 'movable', 'child.txt'), 'child\n');
  writeFileSync(join(root, 'a.txt'), 'a\n');
  return root;
}

const rowFor = (tree: Locator, name: string): Locator =>
  tree.locator('.tree-row').filter({ hasText: name }).first();

/** The two independent "is it open?" signals a folder row renders. */
async function folderState(
  tree: Locator,
  name: string,
): Promise<{ twistyOpen: boolean; icon: string }> {
  const row = rowFor(tree, name);
  const twistyOpen = await row
    .locator('.tree-twisty')
    .evaluate((el) => el.classList.contains('tree-twisty--open'));
  const icon = ((await row.locator('.tree-icon').textContent()) ?? '').trim();
  return { twistyOpen, icon };
}

test('(1) dragging an EXPANDED folder into another folder keeps it expanded, icon and all', async () => {
  const projectRoot = makeProjectFolder();
  try {
    await runApp(async (_app, win) => {
      const errors: string[] = [];
      win.on('pageerror', (e) => errors.push(String(e)));
      win.on('console', (m) => {
        if (m.type() === 'error') errors.push(m.text());
      });

      await createProject(win, 'Demo', projectRoot);
      const tree = win.getByTestId('file-explorer-tree');
      await expect(tree).toBeVisible();

      // Expand `movable` via its chevron — the name only selects now (#121). Its
      // child is visible, chevron + glyph both read OPEN.
      await rowFor(tree, 'movable').locator('.tree-twisty').click();
      await expect(tree.getByText('child.txt', { exact: true })).toBeVisible();
      expect(await folderState(tree, 'movable')).toEqual({ twistyOpen: true, icon: '📂' });

      // Drag the EXPANDED `movable` onto `box`.
      await tree
        .getByText('movable', { exact: true })
        .dragTo(tree.getByText('box', { exact: true }));

      // The move landed on disk (deterministic; the tree lags behind the watcher).
      await expect
        .poll(() => existsSync(join(projectRoot, 'box', 'movable', 'child.txt')), { timeout: 10000 })
        .toBe(true);
      expect(existsSync(join(projectRoot, 'movable'))).toBe(false);

      // Let the watcher-driven re-read settle so we measure the FINAL state.
      await expect(tree.getByText('keep.txt', { exact: true })).toBeVisible(); // box auto-opened
      await win.waitForTimeout(1000);

      // REPORT the two signals + the children, so a failure names the discrepancy.
      const state = await folderState(tree, 'movable');
      const childVisible = await tree.getByText('child.txt', { exact: true }).isVisible();
      const observed = { ...state, childVisible };

      // REQUIRED: the folder stays open — children visible, chevron open, glyph open.
      expect(observed).toEqual({ twistyOpen: true, icon: '📂', childVisible: true });

      expect(realErrors(errors), `renderer errors:\n${errors.join('\n')}`).toEqual([]);
    });
  } finally {
    rmSync(projectRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

/**
 * (1b) The ORPHANED open-map entry from (1) is never cleaned up: react-arborist
 * still holds `{'movable': true}` for the path the folder used to occupy. Drag the
 * folder BACK to that path and the stale entry applies to it again — isOpen goes
 * true while nothing has loaded its children. This is the state the report
 * describes: "the folder collapses, but the expansion icon remains open".
 */
test('(1b) dragging a folder BACK to a previously-expanded path: icon open, no children', async () => {
  const projectRoot = makeProjectFolder();
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'Demo', projectRoot);
      const tree = win.getByTestId('file-explorer-tree');
      await expect(tree).toBeVisible();

      // Expand `movable` at the root via its chevron (the name only selects now,
      // #121) → open map records {'movable': true}.
      await rowFor(tree, 'movable').locator('.tree-twisty').click();
      await expect(tree.getByText('child.txt', { exact: true })).toBeVisible();

      // Drag it into `box` → it is now `box/movable`, and reads closed.
      await tree
        .getByText('movable', { exact: true })
        .dragTo(tree.getByText('box', { exact: true }));
      await expect
        .poll(() => existsSync(join(projectRoot, 'box', 'movable')), { timeout: 10000 })
        .toBe(true);
      await expect(tree.getByText('keep.txt', { exact: true })).toBeVisible();
      await win.waitForTimeout(500);

      // Drag it back out onto the ROOT row → its id is `movable` once more, and the
      // STALE open-map entry from before now applies to it.
      await tree
        .getByText('movable', { exact: true })
        .dragTo(tree.locator('.tree-row--root'));
      await expect
        .poll(() => existsSync(join(projectRoot, 'movable', 'child.txt')), { timeout: 10000 })
        .toBe(true);
      await win.waitForTimeout(1200); // let the watcher re-read settle

      const state = await folderState(tree, 'movable');
      const childVisible = await tree.getByText('child.txt', { exact: true }).isVisible();
      const observed = { ...state, childVisible };

      // REQUIRED: whatever the icon says, it must agree with the children.
      expect(observed).toEqual({ twistyOpen: true, icon: '📂', childVisible: true });
    });
  } finally {
    rmSync(projectRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test('(2) clicking a folder NAME only selects; clicking the icon toggles', async () => {
  const projectRoot = makeProjectFolder();
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'Demo', projectRoot);
      const tree = win.getByTestId('file-explorer-tree');
      await expect(tree).toBeVisible();
      await expect(tree.getByText('movable', { exact: true })).toBeVisible();
      await expect(tree.getByText('child.txt', { exact: true })).toHaveCount(0);

      // FIRST: clicking the twisty (chevron) toggles — verified before the
      // assertion that is expected to fail, so both halves get a real result.
      await rowFor(tree, 'movable').locator('.tree-twisty').click();
      await expect(tree.getByText('child.txt', { exact: true })).toBeVisible();
      await rowFor(tree, 'movable').locator('.tree-twisty').click();
      await expect(tree.getByText('child.txt', { exact: true })).toHaveCount(0);

      // THEN: clicking the NAME selects the folder but must NOT expand it.
      await tree.locator('.tree-label', { hasText: 'movable' }).click();
      await expect(tree.locator('.tree-row--selected', { hasText: 'movable' })).toBeVisible();
      await win.waitForTimeout(400); // give a wrongful expand time to render
      await expect(
        tree.getByText('child.txt', { exact: true }),
        'clicking the folder NAME must not expand it',
      ).toHaveCount(0);
    });
  } finally {
    rmSync(projectRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

const installOpenListener = (win: Page): Promise<void> =>
  win.evaluate(() => {
    (globalThis as Record<string, unknown>).__opens = [];
    window.addEventListener('throng:open-file', (e) =>
      ((globalThis as Record<string, unknown>).__opens as unknown[]).push((e as CustomEvent).detail),
    );
  });
const openCount = (win: Page): Promise<number> =>
  win.evaluate(() => ((globalThis as Record<string, unknown>).__opens as unknown[]).length);
/** Zero the recorded open intents so a later assertion measures only what follows. */
const resetOpens = (win: Page): Promise<void> =>
  win.evaluate(() => {
    (globalThis as Record<string, unknown>).__opens = [];
  });

test('(3) a renamed file stays selected, and renaming never fires open-editor', async () => {
  const projectRoot = makeProjectFolder();
  // Run under the DEFAULT 'single' mode, where a click on a FILE genuinely opens it.
  // That is what gives the openIntents:0 assertion teeth: in a mode where opens are
  // LIVE, the RENAME must still add none. (Under 'none' the assertion held vacuously —
  // nothing could ever open, so it proved nothing about the rename.)
  const cfgRoot = mkdtempSync(join(tmpdir(), 'throng-cfg-rename-'));
  writeFileSync(
    join(cfgRoot, 'settings.json'),
    JSON.stringify({ version: 1, editor: { openOnClick: 'single' } }),
  );
  try {
    await runApp(
      async (_app, win) => {
        await createProject(win, 'Demo', projectRoot);
        const tree = win.getByTestId('file-explorer-tree');
        await expect(tree).toBeVisible();
        await installOpenListener(win);

        // Click a.txt: it selects AND opens (single-click opens a file). The row keeps
        // keyboard focus — opening routes into an editor but does not move DOM focus —
        // so F2 below still reaches the tree.
        await tree.getByText('a.txt', { exact: true }).click();
        await expect(tree.locator('.tree-row--selected', { hasText: 'a.txt' })).toBeVisible();
        // PREMISE: opens really are live in this mode — the click opened the file. If
        // this ever stops holding, the openIntents:0 assertion is toothless again.
        await expect.poll(() => openCount(win), { timeout: 5000 }).toBeGreaterThanOrEqual(1);

        // Zero the counter so only what the RENAME does is measured.
        await resetOpens(win);

        // F2 → rename to b.txt → commit.
        await win.keyboard.press('F2');
        const rename = tree.locator('input.tree-rename');
        await expect(rename).toBeVisible();
        await rename.fill('b.txt');
        await rename.press('Enter');
        await expect(tree.getByText('b.txt', { exact: true })).toBeVisible();
        await win.waitForTimeout(1000); // let the watcher re-read settle

        // Gather BOTH reported facts before asserting, so one failure cannot mask
        // the other: the selection must survive, and no editor may open.
        const observed = {
          renamedRowSelected: await tree
            .locator('.tree-row--selected', { hasText: 'b.txt' })
            .count(),
          totalSelectedRows: await tree.locator('.tree-row--selected').count(),
          openIntents: await openCount(win),
        };

        // REQUIRED: exactly the renamed row stays selected, and nothing opened.
        expect(observed).toEqual({
          renamedRowSelected: 1,
          totalSelectedRows: 1,
          openIntents: 0,
        });
      },
      { env: { THRONG_CONFIG_ROOT: cfgRoot } },
    );
  } finally {
    rmSync(projectRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    rmSync(cfgRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

/**
 * (5) #120 echo — a MOVE-migrated expansion must be PERSISTED immediately, not only
 * on the next user toggle/select. Move an expanded folder, reload WITHOUT touching
 * the tree, reopen the project, and its migrated expansion must be restored from
 * localStorage. Lazy project loading (projects-store) reopens the project CLOSED, so
 * the only thing that can re-expand box/movable is what the move wrote to storage.
 */
test('(5) a MOVE-migrated expansion is persisted immediately (survives an instant reload)', async () => {
  const projectRoot = makeProjectFolder();
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'Demo', projectRoot);
      const tree = win.getByTestId('file-explorer-tree');
      await expect(tree).toBeVisible();

      // Expand `movable` via its chevron (the name only selects, #121).
      await rowFor(tree, 'movable').locator('.tree-twisty').click();
      await expect(tree.getByText('child.txt', { exact: true })).toBeVisible();

      // Drag the EXPANDED `movable` onto `box`: the expansion migrates to box/movable
      // (#120) and `box` auto-opens to reveal the drop.
      await tree
        .getByText('movable', { exact: true })
        .dragTo(tree.getByText('box', { exact: true }));
      await expect
        .poll(() => existsSync(join(projectRoot, 'box', 'movable', 'child.txt')), { timeout: 10000 })
        .toBe(true);
      await expect(tree.getByText('keep.txt', { exact: true })).toBeVisible(); // box opened
      // The migrated expansion is applied live — movable is open at its new path.
      await expect(tree.getByText('child.txt', { exact: true })).toBeVisible();
      await win.waitForTimeout(500); // let the migrate + persist settle

      // Reload IMMEDIATELY — no user toggle/select after the move. The project reopens
      // CLOSED (lazy loading), so its expansion can only come from what the MOVE
      // persisted. Reopen it and the migrated open-state must be restored.
      await reloadWindow(win);
      await win
        .locator('.project-item', { hasText: 'Demo' })
        .locator('[data-testid^="project-switch-"]')
        .click();

      const treeAfter = win.getByTestId('file-explorer-tree');
      await expect(treeAfter).toBeVisible();
      // box AND box/movable were persisted open by the move: their children are
      // visible again with NO manual expansion.
      await expect(treeAfter.getByText('keep.txt', { exact: true })).toBeVisible();
      await expect(treeAfter.getByText('child.txt', { exact: true })).toBeVisible();
    });
  } finally {
    rmSync(projectRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
