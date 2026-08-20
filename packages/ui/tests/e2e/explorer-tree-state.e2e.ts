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
import { test, expect, type Locator } from '@playwright/test';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  openApp,
  runApp as runOwnApp,
  createProject,
  reloadWindow,
  cleanupTemp,
  geom,
  FILE_OP_TIMEOUT_MS,
  type AppOptions,
  type OpenApp,
} from './harness.js';

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

/*
 * ONE app for tests (1) and (1b) (034 FR-045, SC-027) — 3 launches -> 2.
 *
 * Test (5) keeps `runOwnApp` because it calls `reloadWindow`. Nothing is declared after it, so
 * the reload could not reach another test — but a mid-file `location.reload()` against a shared
 * `OpenApp` handle and its `afterAll` close is unproven on this branch, and the one launch it
 * would save is not worth finding out during a teardown.
 *
 * (1) and (1b) share. Both build the same fixture on their OWN temp root and both re-establish
 * every piece of state they read — (1b)'s subject is a stale react-arborist open-map entry that
 * it creates itself, inside its own project, and the open map is keyed per project. They were
 * both called "Demo" and are named apart now, and their roots move to `afterAll` rather than
 * being deleted while the explorer still watches them.
 */
test.describe.configure({ mode: 'serial' });

const ownedRoots: string[] = [];
/** Register a project root for removal in `afterAll`, once the shared app has closed. */
function own(dir: string): string {
  ownedRoots.push(dir);
  return dir;
}

let shared: OpenApp;

test.beforeAll(async () => {
  shared = await openApp();
});

test.afterAll(async () => {
  await shared?.close();
  for (const dir of ownedRoots.splice(0)) cleanupTemp(dir);
});

const runApp = (
  fn: (app: OpenApp['app'], win: OpenApp['win']) => Promise<void>,
  opts?: AppOptions,
): Promise<void> => {
  if (opts) {
    throw new Error(
      'this file shares one app; a test needing launch options must call runOwnApp instead',
    );
  }
  return fn(shared.app, shared.win);
};

test('(1) dragging an EXPANDED folder into another folder keeps it expanded, icon and all', { tag: ['@extended', '@explorer', '@reserve:osdrag'] }, async () => {
  const projectRoot = own(makeProjectFolder());
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
        .poll(() => existsSync(join(projectRoot, 'box', 'movable', 'child.txt')), { timeout: FILE_OP_TIMEOUT_MS })
        .toBe(true);
      expect(existsSync(join(projectRoot, 'movable'))).toBe(false);

      // Let the watcher-driven re-read settle so we measure the FINAL state — poll for it rather
      // than sleep, so a failure still names the actual settled discrepancy, not a mid-transition
      // read.
      await expect(tree.getByText('keep.txt', { exact: true })).toBeVisible(); // box auto-opened
      await expect
        .poll(
          async () => {
            const state = await folderState(tree, 'movable');
            const childVisible = await tree.getByText('child.txt', { exact: true }).isVisible();
            return { ...state, childVisible };
          },
          { timeout: 5000 },
        )
        // REQUIRED: the folder stays open — children visible, chevron open, glyph open.
        .toEqual({ twistyOpen: true, icon: '📂', childVisible: true });

      expect(realErrors(errors), `renderer errors:\n${errors.join('\n')}`).toEqual([]);
    });
  } finally {
    // The root is deleted in `afterAll`, once the shared app has CLOSED. Deleting it here would
    // remove a folder the explorer is still watching.
  }
});

/**
 * (1b) The ORPHANED open-map entry from (1) is never cleaned up: react-arborist
 * still holds `{'movable': true}` for the path the folder used to occupy. Drag the
 * folder BACK to that path and the stale entry applies to it again — isOpen goes
 * true while nothing has loaded its children. This is the state the report
 * describes: "the folder collapses, but the expansion icon remains open".
 */
test('(1b) dragging a folder BACK to a previously-expanded path: icon open, no children', { tag: ['@extended', '@explorer', '@reserve:osdrag'] }, async () => {
  const projectRoot = own(makeProjectFolder());
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'TreeStateBack', projectRoot);
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
        .poll(() => existsSync(join(projectRoot, 'box', 'movable')), { timeout: FILE_OP_TIMEOUT_MS })
        .toBe(true);
      await expect(tree.getByText('keep.txt', { exact: true })).toBeVisible();
      // Let the row's post-move geometry settle before dragging it again — dragTo resolves the
      // drop target from live positions, and a still-animating row would aim the second drag at a
      // moment nobody cares about.
      await geom(rowFor(tree, 'movable'));

      // Drag it back out onto the ROOT row → its id is `movable` once more, and the
      // STALE open-map entry from before now applies to it.
      await tree
        .getByText('movable', { exact: true })
        .dragTo(tree.locator('.tree-row--root'));
      await expect
        .poll(() => existsSync(join(projectRoot, 'movable', 'child.txt')), { timeout: FILE_OP_TIMEOUT_MS })
        .toBe(true);

      // Let the watcher-driven re-read settle so we measure the FINAL state, the same way as (1).
      await expect
        .poll(
          async () => {
            const state = await folderState(tree, 'movable');
            const childVisible = await tree.getByText('child.txt', { exact: true }).isVisible();
            return { ...state, childVisible };
          },
          { timeout: 5000 },
        )
        // REQUIRED: whatever the icon says, it must agree with the children.
        .toEqual({ twistyOpen: true, icon: '📂', childVisible: true });
    });
  } finally {
    // The root is deleted in `afterAll`, once the shared app has CLOSED. Deleting it here would
    // remove a folder the explorer is still watching.
  }
});

/*
 * (2) AND (3) MOVED to `packages/ui/tests/component/explorer-tree-interaction.test.ts`
 * (034 FR-045). Both were about what a GESTURE does to a row, and neither needed a disk.
 *
 * (2) "clicking a folder NAME only selects; clicking the icon toggles" — the component version
 * asserts the chevron round trip on `aria-expanded`, which comes from react-arborist’s own open
 * map, rather than on `.tree-twisty--open`. That matters here specifically: this file exists
 * because the glyph and the open state were reported to DISAGREE, and a test that reads only the
 * class cannot see the disagreement it was filed for.
 *
 * (3) "a renamed file stays selected, and renaming never fires open-editor" — the component
 * version keeps this file’s hard-won premise (opens must be LIVE, or the zero-intents assertion
 * is vacuous) and drops the second Electron app the premise used to cost: `openOnClick: ‘single’`
 * is the shipped default, so no `THRONG_CONFIG_ROOT` and no `runOwnApp` are needed to reach it.
 *
 * WHAT STAYS, AND WHY IT IS NOT NEGOTIABLE: (1), (1b) and (5) all DRAG a row onto another row.
 * react-arborist’s drop maths is the one part of it that measures the DOM
 * (`dnd/compute-drop.js` calls `getBoundingClientRect`), and jsdom reports 0×0 for every element,
 * so a component-layer drag would resolve every drop to the same place. Constitution v5.1.0
 * Principle V reserves OS drag-and-drop for exactly this reason.
 *
 * ANTI-VACUITY CONTROL for the replacements: delete the `beforeAll` installing
 * `ImmediateResizeObserver` and all nine tests in that file fail — `FileTree` gates `<Tree>` on a
 * ResizeObserver-fed size, so nothing renders and every absence assertion would pass on an empty
 * document.
 */

/**
 * (5) #120 echo — a MOVE-migrated expansion must be PERSISTED immediately, not only
 * on the next user toggle/select. Move an expanded folder, reload WITHOUT touching
 * the tree, reopen the project, and its migrated expansion must be restored from
 * localStorage. Lazy project loading (projects-store) reopens the project CLOSED, so
 * the only thing that can re-expand box/movable is what the move wrote to storage.
 */
test('(5) a MOVE-migrated expansion is persisted immediately (survives an instant reload)', { tag: ['@extended', '@explorer', '@reserve:window'] }, async () => {
  const projectRoot = makeProjectFolder();
  try {
    await runOwnApp(async (_app, win) => {
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
        .poll(() => existsSync(join(projectRoot, 'box', 'movable', 'child.txt')), { timeout: FILE_OP_TIMEOUT_MS })
        .toBe(true);
      await expect(tree.getByText('keep.txt', { exact: true })).toBeVisible(); // box opened
      // The migrated expansion is applied live — movable is open at its new path.
      await expect(tree.getByText('child.txt', { exact: true })).toBeVisible();

      // The persist runs in a separate passive effect keyed on the same data change as the DOM
      // update above, so it can still be pending once the DOM already shows the migration. Poll the
      // actual persisted value rather than sleeping a guessed duration — this is the exact fact an
      // instant reload below depends on.
      await expect
        .poll(() =>
          win.evaluate(() => {
            for (let i = 0; i < localStorage.length; i++) {
              const key = localStorage.key(i);
              if (!key?.startsWith('throng.explorer.tree.')) continue;
              const raw = localStorage.getItem(key);
              if (raw && ((JSON.parse(raw).expanded as string[] | undefined) ?? []).includes('box/movable')) {
                return true;
              }
            }
            return false;
          }),
        )
        .toBe(true);

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
    cleanupTemp(projectRoot);
  }
});
