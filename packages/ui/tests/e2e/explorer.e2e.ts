/**
 * E2E (004, T019) — the File Explorer tree renders the active project's folder,
 * sorts folders-first, hides excluded entries, expands subfolders lazily, and
 * supports the level-by-level Expand + selectable root. Drives the real Electron
 * app via the shared harness.
 */
import { test, expect } from '@playwright/test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';

/** react-dnd's empty drag-preview image trips the app's CSP harmlessly; ignore it. */
const realErrors = (errors: string[]): string[] =>
  errors.filter((e) => !e.includes('Content Security Policy') && !e.includes('data:image'));
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openApp,
  createProject as newProject,
  cleanupTemp,
  type AppOptions,
  type OpenApp, FILE_OP_TIMEOUT_MS } from './harness.js';
import type { Locator, Page } from '@playwright/test';

/**
 * Toggle a folder's expansion via its CHEVRON (#121) — the folder NAME only
 * selects now, so expansion is driven exclusively by the twisty control.
 */
const toggleFolder = (tree: Locator, relPath: string): Promise<void> =>
  tree.getByTestId(`tree-twisty-${relPath}`).click();

/*
 * ONE app for the whole file, not one per test.
 *
 * Every test here opened its own Electron app, daemon and window to look at a tree — 17 launches at
 * roughly two seconds each, to run assertions that never needed a pristine app. None of them seeds
 * state before launch, which is the only thing that genuinely requires one.
 *
 * The two shims below are what let the 17 test bodies stay untouched:
 *
 *   runApp        invokes the body against the shared window instead of launching. Same signature,
 *                 so no call site changed. It deliberately does NOT accept options — a test that
 *                 needs a seeded config root must use the real `runApp` and its own app, and would
 *                 fail loudly here rather than silently ignoring them.
 *   createProject appends a counter to the name. Sharing an app means projects accumulate, and
 *                 fifteen projects called "Demo" would make `.project-item` ambiguous — Playwright's
 *                 strict mode turns that into a confusing failure rather than a wrong pass, but the
 *                 unique name avoids the question entirely.
 *
 * Serial mode is required: these tests share a window and a database, so they must not interleave,
 * and a failure should skip the rest rather than run them against the wreckage.
 */
test.describe.configure({ mode: 'serial' });

let shared: OpenApp;
test.beforeAll(async () => {
  shared = await openApp();
});
test.afterAll(async () => {
  await shared?.close();
});

const runApp = (
  fn: (app: OpenApp['app'], win: OpenApp['win']) => Promise<void>,
  opts?: AppOptions,
): Promise<void> => {
  /*
   * Refuse options rather than ignore them. The shared app is already running, so a seeded config
   * root or database cannot be applied — and silently dropping it does not fail, it passes for the
   * wrong reason. Measured exactly once: the double-click test seeds `editor.openOnClick: 'double'`,
   * the shim swallowed it, single-click opened the file, and the assertion saw 2 opens where it
   * expected 0. A test that needs its own app calls `runOwnApp`.
   */
  if (opts) {
    throw new Error(
      'this file shares one app; a test needing launch options must call runOwnApp instead',
    );
  }
  return fn(shared.app, shared.win);
};

let projectSeq = 0;
const createProject = (win: OpenApp['win'], name: string, root: string): Promise<void> =>
  newProject(win, `${name}-${(projectSeq += 1)}`, root);

/** Build a known project folder structure on disk. Returns its absolute path. */
function makeProjectFolder(): string {
  const root = mkdtempSync(join(tmpdir(), 'throng-proj-'));
  mkdirSync(join(root, 'src'));
  writeFileSync(join(root, 'src', 'index.ts'), 'export const x = 1;\n');
  mkdirSync(join(root, 'src', 'inner'));
  writeFileSync(join(root, 'src', 'inner', 'deep.ts'), '//\n');
  mkdirSync(join(root, '.git')); // must be hidden by the default exclude globs
  writeFileSync(join(root, 'README.md'), '# demo\n');
  writeFileSync(join(root, 'a.txt'), 'a\n');
  return root;
}

/*
 * DELETED, ALREADY COVERED (034 FR-045/FR-046a) — "renders the active project tree: sorted,
 * excludes hidden, lazy expand".
 *
 * IT WAS MEANT TO GO WITH THE OTHER FIVE AND WAS MISSED. `component/file-tree.test.ts:7` names
 * `explorer.e2e.ts:97` — this test — among the six line numbers it migrated, and its first
 * describe is titled "the rows the tree draws (…, migrated from explorer.e2e.ts:97)". The MOVED
 * note below it says twelve tests stay; thirteen did. The trim list simply omitted this title,
 * and the count is right again now.
 *
 * EVERY CLAIM, AND WHERE IT NOW LIVES — each verified by reading the covering assertion, not by
 * matching a title (FR-046a):
 *   "src / README.md / a.txt are visible"  → `file-tree.test.ts:360` asserts the whole row list IN
 *     ORDER (`['demo', 'src', 'a.txt', 'README.md']`), which is what the deleted title claimed
 *     and its body never checked — three `toBeVisible()` calls pass for a tree in any order.
 *   "`.git` is excluded"                    → `file-tree.test.ts:398` asserts BOTH that no row is
 *     drawn for it AND that the folder is never listed. The exclusion is applied in the RENDERER
 *     (`use-explorer-data.ts:382`, over the shipped DEFAULT_EXCLUDE_GLOBS), so that is the same
 *     code path this test drove — nothing about it lived in main.
 *   "subfolders start collapsed; the chevron expands lazily" → `file-tree.test.ts:414` asserts the
 *     FETCH CALL LOG as well as the rows, so a tree that read every folder eagerly and kept them
 *     shut reddens there and passed here.
 *   "no renderer errors"                    → the `realErrors` probe is unchanged and still run by
 *     "collapsing the tree raises no error" below, on this same shared app and window.
 *
 * Nothing is lost by the fixture being a fake `files.list` rather than a real temp folder: every
 * other test in this file still creates a real project on a real root and waits for the tree to
 * render before doing anything else.
 */

/*
 * MOVED to `packages/ui/tests/component/file-tree.test.ts` (034 FR-045) — five tests.
 *
 * THE TREE RENDERS IN JSDOM, which is the finding that unlocked this and was not obvious. The
 * blocker was never react-arborist — it ships its own jsdom tests and virtualises arithmetically,
 * measuring no DOM. It is throng’s own `useSize` gate (`file-tree.tsx`): `ResizeObserver` is absent
 * from jsdom entirely, so the effect throws, `width > 0 && height > 0` stays false and `<Tree>`
 * never mounts. ONE global is stubbed — an observer reporting a fixed 320×600 box — and that is not
 * a simplification of a real thing, because jsdom has no layout to simplify.
 *
 * The stub is honest about what it costs: at 24px rows a 600px box holds 25, and the largest
 * fixture is 7, so WHICH rows and IN WHAT ORDER is faithful while row COUNT is not. That is exactly
 * why "a large folder stays responsive — virtualised rows" is NOT in this list and stays below.
 *
 * `double-click mode` is the headline: it was this file’s only `runOwnApp` — a second Electron
 * launch and a second daemon — spent on one enum. It is now a `ConfigProvider` mount.
 *
 * FOUR OF THE FIVE LAND STRONGER THAN THE E2E DID:
 *   - the rendered sort order is asserted against a reversal that does not touch the sort function
 *   - the lazy load is asserted on the fetch CALL LOG, so making the load eager reddens it while
 *     changing not one rendered row — a claim the E2E could not make at all
 *   - Collapse-all is asserted to leave the ROOT open, which was the E2E’s blind spot: it only
 *     checked that a nested file had vanished
 *   - the open intent is asserted on its `absPath`, not merely that something opened
 *
 * Anti-vacuity control run first, and it is the reason the rest can be believed: withholding the
 * `ResizeObserver` stub fails ALL FIFTEEN component tests with "Unable to find role=tree". The tree
 * is load-bearing, not scenery — these do not pass on an empty DOM.
 *
 * A CORRECTION TO THIS BRANCH’S OWN WORKING ASSUMPTION, recorded because it reopens work already
 * declined: `useWorkspace` was treated as out of scope everywhere in this migration because
 * `WorkspaceContext` is private. But `WorkspaceProvider` IS exported and takes its client as a
 * prop, so the real provider mounts over a fake `ThrongBridge` — no production change, the same
 * pattern `project-settings-dialog.test.ts` uses. Migrations rejected on that ground deserve a
 * second look.
 *
 * WHAT STAYS: twelve tests, and every one of them touches something no jsdom can supply — real
 * filesystem watchers, a real recycle bin, real drag-and-drop hit-testing, modifier-click selection
 * through react-arborist, an inline rename with real text-selection state, virtualisation, and
 * per-project state surviving a real project switch.
 */

/*
 * ── ONE REMOVED (035 T055) ──
 *
 * `:474` "right-click Hide removes the item from this project view (US3 hide)". Hiding a file is a
 * chain of three, and two links were already held:
 *
 *   the menu row calls `ops.hide` with the right path   → `unit/explorer-subtree-menu.test.ts` (new)
 *   `hiddenPaths` filters the DERIVED tree data          → `component/file-tree.test.ts:488`
 *   the hidden set persists, and can be undone           → `e2e/project-settings.e2e.ts:39`
 *
 * `ops.hide` appeared in three test files before this and was a `noop` in every one. So the row
 * could have called it with the wrong path, with the SELECTION instead of the clicked node, or not
 * at all — and only an Electron launch would have said so.
 *
 * The selection case is the one worth naming. This menu deliberately operates on the whole selection
 * for the file operations (`context-menu-items.ts:83`), and hiding is not one of them: a Hide that
 * followed the selection would vanish several files from a single click, with nothing on screen to
 * say which. Red-proven as `hide-follows-the-selection`.
 */
test('collapsing the tree raises no error (no bogus internal-root path)', { tag: ['@extended', '@explorer', '@reserve:runtime'] }, async () => {
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

      // Expand two levels, then Collapse all (the action that triggered the bug).
      await win.getByRole('button', { name: 'Expand' }).click();
      await expect(tree.getByText('index.ts', { exact: true })).toBeVisible();
      await win.getByRole('button', { name: 'Expand' }).click();
      await expect(tree.getByText('deep.ts', { exact: true })).toBeVisible();
      await win.getByRole('button', { name: 'Collapse all' }).click();
      await expect(tree.getByText('index.ts', { exact: true })).toHaveCount(0);

      // No error banner and no realpath/internal-root error must appear.
      // sleep-justified: "Collapse all" itself is synchronous, but the bug this guards against was
      // sleep-justified: a stray error raised from a later, unrelated data-reload reacting to the
      // sleep-justified: root/open-state change — there is no single named async op to await, only
      // sleep-justified: time for a delayed error to have had the chance to surface.
      await win.waitForTimeout(500);
      await expect(tree.locator('.explorer__error')).toHaveCount(0);
      expect(realErrors(errors), `errors:\n${errors.join('\n')}`).toEqual([]);
    });
  } finally {
    cleanupTemp(projectRoot);
  }
});

test('reflects external filesystem changes live, preserving expansion (US2)', { tag: ['@extended', '@explorer', '@reserve:runtime'] }, async () => {
  const projectRoot = makeProjectFolder();
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'Demo', projectRoot);
      const tree = win.getByTestId('file-explorer-tree');
      await expect(tree).toBeVisible();

      // Expand `src` (via its chevron, #121) so its directory is loaded + visible.
      await toggleFolder(tree, 'src');
      await expect(tree.getByText('index.ts', { exact: true })).toBeVisible();

      // External create inside the expanded folder → appears live, no refresh.
      writeFileSync(join(projectRoot, 'src', 'fresh.ts'), 'export const y = 2;\n');
      await expect(tree.getByText('fresh.ts', { exact: true })).toBeVisible();
      // `src` stayed expanded across the live update.
      await expect(tree.getByText('index.ts', { exact: true })).toBeVisible();

      // External create at the root → appears live.
      writeFileSync(join(projectRoot, 'top.md'), '# top\n');
      await expect(tree.getByText('top.md', { exact: true })).toBeVisible();

      // External delete → vanishes live.
      rmSync(join(projectRoot, 'src', 'index.ts'), { force: true });
      await expect(tree.getByText('index.ts', { exact: true })).toHaveCount(0);
    });
  } finally {
    cleanupTemp(projectRoot);
  }
});

test('file operations via context menu + toolbar (US3): delete, new folder, cut/paste, rename', { tag: ['@extended', '@explorer', '@reserve:native'] }, async () => {
  const projectRoot = makeProjectFolder();
  try {
    await runApp(async (_app, win) => {
      // Default delete mode = Recycle Bin: the real shell.trashItem removes the
      // entry from the live folder (→ observable in the tree).
      await createProject(win, 'Demo', projectRoot);
      const tree = win.getByTestId('file-explorer-tree');
      await expect(tree).toBeVisible();
      const menuItem = (label: string) => win.locator('.context-menu__item', { hasText: label });

      // Delete a.txt (default = Recycle Bin) via the context menu → confirm → vanishes.
      await tree.getByText('a.txt', { exact: true }).click({ button: 'right' });
      await menuItem('Delete').click();
      await win.getByTestId('confirm-accept').click();
      await expect(tree.getByText('a.txt', { exact: true })).toHaveCount(0);

      // New folder via the toolbar → appears and enters inline rename; name it.
      await win.getByRole('button', { name: 'New folder' }).click();
      const rename = tree.locator('input.tree-rename');
      await expect(rename).toBeVisible();
      await rename.fill('assets');
      await rename.press('Enter');
      await expect(tree.getByText('assets', { exact: true })).toBeVisible();

      // Cut README.md, paste into `assets` → it moves there.
      await tree.getByText('README.md', { exact: true }).click({ button: 'right' });
      await menuItem('Cut').click();
      await tree.getByText('assets', { exact: true }).click({ button: 'right' });
      await menuItem('Paste').click();
      // The paste reveals what it placed, opening `assets` (050 FR-025b) — no chevron needed.
      // Exactly one README.md remains (under assets) — it MOVED, not copied. The
      // count retries while the watcher re-reads the root and drops the stale row.
      await expect(tree.locator('.tree-label', { hasText: 'README.md' })).toHaveCount(1);
      await expect(tree.getByText('README.md', { exact: true })).toBeVisible();

      // Rename `assets` → `media` via the context menu.
      await tree.getByText('assets', { exact: true }).click({ button: 'right' });
      await menuItem('Rename').click();
      const rename2 = tree.locator('input.tree-rename');
      await rename2.fill('media');
      await rename2.press('Enter');
      await expect(tree.getByText('media', { exact: true })).toBeVisible();
    });
  } finally {
    cleanupTemp(projectRoot);
  }
});

/*
 * NARROWED (test-suite audit, pass 1): the Delete-key half moved out — `delete-mixed.e2e.ts` "file-first selection
 * (opens an editor) then Delete key removes ALL selected" presses the real Delete key on a file-first selection
 * with an editor open, which is the same claim with more in it. F2 rename stays.
 */
test('keyboard shortcuts operate on the tree: F2 renames (US3)', { tag: ['@extended', '@explorer', '@reserve:input'] }, async () => {
  const projectRoot = makeProjectFolder();
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'Demo', projectRoot);
      const tree = win.getByTestId('file-explorer-tree');
      await expect(tree).toBeVisible();

      // Select README.md, press F2 → inline rename; commit a new name.
      await tree.getByText('README.md', { exact: true }).click();
      await win.keyboard.press('F2');
      const rename = tree.locator('input.tree-rename');
      await expect(rename).toBeVisible();
      await rename.fill('readme2.md');
      await rename.press('Enter');
      await expect(tree.getByText('readme2.md', { exact: true })).toBeVisible();
    });
  } finally {
    cleanupTemp(projectRoot);
  }
});

test('copy/paste duplicates with a non-clobbering name; open-in-explorer raises no error (US3)', { tag: ['@extended', '@explorer'] }, async () => {
  const projectRoot = makeProjectFolder();
  try {
    await runApp(async (app, win) => {
      // No-op the OS reveal/open so the test doesn't pop a real file manager.
      await app.evaluate(({ shell }) => {
        shell.showItemInFolder = () => {};
        shell.openPath = async () => '';
      });
      await createProject(win, 'Demo', projectRoot);
      const tree = win.getByTestId('file-explorer-tree');
      await expect(tree).toBeVisible();

      // Copy README.md, paste at the root → a de-duplicated "README copy.md". Use the exact
      // menu-item testIds: a `hasText:'Copy'` locator now also matches "Copy Path" (#156), which is
      // ambiguous under Playwright strict mode. The Paste row names what will land (050 FR-025a).
      await tree.getByText('README.md', { exact: true }).click({ button: 'right' });
      await win.getByTestId('menu-item-Copy').click();
      await tree.locator('.tree-row--root').click({ button: 'right' });
      await win.getByTestId('menu-item-Paste "README.md"').click();
      await expect(tree.getByText('README copy.md', { exact: true })).toBeVisible();
      await expect(tree.getByText('README.md', { exact: true })).toBeVisible(); // original kept

      // Reveal a file in the OS explorer → no error banner. The reveal lives inside the "Open In"
      // submenu (#158, FR-018a) for files and folders alike — open it, then the first item.
      await win.keyboard.press('Escape'); // dismiss any lingering menu
      await tree.getByText('a.txt', { exact: true }).click({ button: 'right' });
      await win.getByTestId('menu-item-Open In').click();
      await win.getByTestId('submenu-Open In').locator('.context-menu__item').first().click();
      // sleep-justified: the reveal goes through an async main-process IPC round trip (even though
      // sleep-justified: shell.showItemInFolder is no-op'd above) with no renderer-visible
      // sleep-justified: completion signal — an error could still surface after the click's own
      // sleep-justified: await resolves, and there is nothing to wait ON for "it did not".
      await win.waitForTimeout(300);
      await expect(tree.locator('.explorer__error')).toHaveCount(0);
    });
  } finally {
    cleanupTemp(projectRoot);
  }
});

/*
 * DELETED (test-suite audit, pass 1):
 *   - "drag-and-drop moves a file into a folder (US3b)" → `explorer-tree-state.e2e.ts` (1), which drags a folder onto
 *     a folder with the same real drag and asserts the move landed.
 *   - "multi-select (Ctrl-click) then Delete removes all selected (US3b)" → `delete-mixed.e2e.ts` "file-first
 *     selection (opens an editor) then Delete key removes ALL selected" (Ctrl-click selection, Delete key, one
 *     confirm, every selected row gone).
 */
test('delete confirmation can be cancelled; the toolbar Delete button works (US3 polish)', { tag: ['@extended', '@explorer', '@reserve:native'] }, async () => {
  const projectRoot = makeProjectFolder();
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'Demo', projectRoot);
      const tree = win.getByTestId('file-explorer-tree');
      await expect(tree).toBeVisible();

      // Cancel the confirmation → the file stays.
      await tree.getByText('a.txt', { exact: true }).click({ button: 'right' });
      await win.locator('.context-menu__item', { hasText: 'Delete' }).click();
      await expect(win.getByTestId('confirm-dialog')).toBeVisible();
      await win.getByTestId('confirm-cancel').click();
      await expect(tree.getByText('a.txt', { exact: true })).toBeVisible();

      // Toolbar Delete button → confirm → gone.
      await tree.getByText('a.txt', { exact: true }).click();
      await win.getByRole('button', { name: 'Delete' }).click();
      await win.getByTestId('confirm-accept').click();
      await expect(tree.getByText('a.txt', { exact: true })).toHaveCount(0);
    });
  } finally {
    cleanupTemp(projectRoot);
  }
});

test('New folder in a collapsed folder expands it and overwrites the selected name (US3 polish)', { tag: ['@extended', '@explorer', '@reserve:input'] }, async () => {
  const projectRoot = makeProjectFolder();
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'Demo', projectRoot);
      const tree = win.getByTestId('file-explorer-tree');
      await expect(tree).toBeVisible();

      // Select `src` (name click, #121) then expand + collapse it via its chevron,
      // leaving it selected but minimised.
      await tree.getByText('src', { exact: true }).click(); // select
      await expect(tree.locator('.tree-row--selected', { hasText: 'src' })).toBeVisible();
      await toggleFolder(tree, 'src'); // expand
      await expect(tree.getByText('index.ts', { exact: true })).toBeVisible();
      await toggleFolder(tree, 'src'); // collapse
      await expect(tree.getByText('index.ts', { exact: true })).toHaveCount(0);

      // New folder → src expands and the new folder is in rename mode.
      await win.getByRole('button', { name: 'New folder' }).click();
      await expect(tree.getByText('index.ts', { exact: true })).toBeVisible(); // src re-expanded
      const rename = tree.locator('input.tree-rename');
      await expect(rename).toBeVisible();

      // The default name is fully selected → typing overwrites it entirely.
      await win.keyboard.type('models');
      await rename.press('Enter');
      await expect(tree.getByText('models', { exact: true })).toBeVisible();
      await expect(tree.getByText('New folder', { exact: true })).toHaveCount(0);
    });
  } finally {
    cleanupTemp(projectRoot);
  }
});

test('a large folder stays responsive — virtualised rows (polish T061)', { tag: ['@extended', '@explorer', '@reserve:layout'] }, async () => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'throng-big-'));
  mkdirSync(join(projectRoot, 'big'));
  for (let i = 0; i < 800; i += 1) {
    writeFileSync(join(projectRoot, 'big', `f-${String(i).padStart(4, '0')}.txt`), 'x');
  }
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'Big', projectRoot);
      const tree = win.getByTestId('file-explorer-tree');
      await expect(tree).toBeVisible();

      await toggleFolder(tree, 'big'); // expand 800 entries via the chevron (#121)
      await expect(tree.getByText('f-0000.txt', { exact: true })).toBeVisible();

      // Virtualised: only a small window of rows is in the DOM, not all 800.
      // not-a-clock: 200 bounds the number of ROWS the virtualiser leaves in the DOM, not a
      // duration — expanding 800 entries must not materialise 800 elements. Nothing here is timed,
      // so 034 SC-007 does not govern it.
      const rows = await tree.locator('.tree-row').count();
      expect(rows).toBeGreaterThan(0);
      expect(rows).toBeLessThan(200);
    });
  } finally {
    cleanupTemp(projectRoot);
  }
});

/*
 * NARROWED (test-suite audit, pass 1): the expansion-per-project half moved out — "the resulting open state
 * survives a project switch and a window reload" in `subtree-expand-collapse.e2e.ts` (AS-10/D8) and the persisted
 * expansion in `explorer-tree-state.e2e.ts` (5) hold it. What stays is the SELECTION surviving a project switch,
 * and the root row being selectable.
 */
test('remembers selection per project; root is selectable', { tag: ['@extended', '@explorer', '@reserve:runtime'] }, async () => {
  const rootA = makeProjectFolder();
  const rootB = makeProjectFolder();
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'Alpha', rootA);
      const tree = win.getByTestId('file-explorer-tree');
      await expect(tree).toBeVisible();

      // Select README.md in Alpha.
      await tree.getByText('README.md', { exact: true }).click();
      await expect(tree.locator('.tree-row--selected', { hasText: 'README.md' })).toBeVisible();

      // Create + switch to Beta — Alpha's tree unmounts; Beta starts with nothing selected.
      await createProject(win, 'Beta', rootB);
      await expect(tree.locator('.tree-row--selected', { hasText: 'README.md' })).toHaveCount(0);

      // Switch back to Alpha → its selection is restored.
      await win
        .locator('.project-item', { hasText: 'Alpha' })
        .locator('[data-testid^="project-switch-"]')
        .click();
      await expect(tree.locator('.tree-row--selected', { hasText: 'README.md' })).toBeVisible();

      // The root row is selectable (but stays expanded).
      await tree.locator('.tree-row--root').click();
      await expect(tree.locator('.tree-row--root.tree-row--selected')).toBeVisible();
      await expect(tree.getByText('src', { exact: true })).toBeVisible();
    });
  } finally {
    cleanupTemp(rootA);
    cleanupTemp(rootB);
  }
});

/*
 * ── MERGED IN (test-suite audit, pass 1) — one app instead of three ──
 *
 * The three tests below used to be `explorer-new-items.e2e.ts`, `explorer-keyboard-selection.e2e.ts` and
 * `explorer-bottom-click.e2e.ts`: one Electron launch, one daemon and one window each, for a test that seeds
 * nothing before launch. They now run on this file's shared app. The bodies are unchanged apart from the project
 * helpers, which are named apart here because the file already has `makeProjectFolder`.
 *
 * MOVED to `packages/ui/tests/component/explorer-root-menu.test.ts` (034 FR-045), from the former
 * explorer-new-items file: the FR-097 empty-space (root-targeted) menu test, as six. What stayed is the whole
 * chain for New File on a folder — menu, create, a focused rename box, a commit, and bytes at `sub/made.txt`.
 */

// Session 2026-07-06c: New File in the context menu (FR-096).
function makeNewItemsProject(): string {
  const root = mkdtempSync(join(tmpdir(), 'throng-newitems-'));
  mkdirSync(join(root, 'sub'));
  writeFileSync(join(root, 'sub', 'keep.txt'), 'x');
  writeFileSync(join(root, 'a.txt'), 'A');
  return root;
}

test('New File on a folder creates a file inside it, in rename mode (FR-096)', { tag: ['@extended', '@explorer', '@reserve:input'] }, async () => {
  const root = makeNewItemsProject();
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'NI', root);
      const tree = win.getByTestId('file-explorer-tree');
      await expect(tree).toBeVisible();

      // Right-click the `sub` folder → New File → creates sub/New file.txt in rename.
      await tree.getByText('sub', { exact: true }).click({ button: 'right' });
      await win.getByTestId('menu-item-New File').click();

      // The rename input is focused on the new file.
      const input = tree.locator('input.tree-rename');
      await expect(input).toBeVisible({ timeout: 6000 });
      await input.fill('made.txt');
      await win.keyboard.press('Enter');

      await expect
        .poll(() => existsSync(join(root, 'sub', 'made.txt')), { timeout: FILE_OP_TIMEOUT_MS })
        .toBe(true);
    });
  } finally {
    cleanupTemp(root);
  }
});

/*
 * 024 US3 follow-up — in File Explorer the arrow keys move the SELECTION, not a separate cursor.
 *
 * Every file operation reads the selection, so a tree where the highlight and the operations
 * disagree quietly does the wrong thing: Ctrl+X cut the row the user had arrowed AWAY from, and
 * Ctrl+V pasted into that row's folder rather than the one the cursor was resting on. This drives
 * both from the keyboard alone and proves the file that actually moved is the one that was cut, into
 * the folder the cursor had reached.
 */
test('arrowing to a row makes it the cut/paste target (024 US3 follow-up)', { tag: ['@extended', '@explorer', '@reserve:input'] }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'throng-kbdsel-'));
  mkdirSync(join(root, 'sub'));
  writeFileSync(join(root, 'a.txt'), 'A\n');
  writeFileSync(join(root, 'b.txt'), 'B\n');
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'KbdSelProj', root);
      const tree = win.getByTestId('file-explorer-tree');
      await expect(tree.getByText('a.txt', { exact: true })).toBeVisible({ timeout: 8000 });

      // Start on the folder (a single click selects it; only a double-click expands it), so the
      // whole rest of the gesture is keyboard-only.
      await tree.getByText('sub', { exact: true }).click();

      // The highlighted row is drawn ONLY by the selected-row background — no second focus ring
      // boxing it in, now that selection and focus are the same thing.
      await expect
        .poll(() =>
          win.evaluate(() => {
            const row = document.querySelector(
              '[data-testid="file-explorer-tree"] [role="treeitem"]:focus',
            );
            return row ? getComputedStyle(row).outlineStyle : 'no-focused-row';
          }),
        )
        .toBe('none');
      // Down onto a.txt — this must SELECT it, not merely draw a cursor over it.
      await win.keyboard.press('ArrowDown');
      await win.keyboard.press('Control+x');
      // Back up onto the folder, which is now the paste target for the same reason.
      await win.keyboard.press('ArrowUp');
      await win.keyboard.press('Control+v');

      // a.txt moved into the folder, which the paste opened to reveal it (050 FR-025b): present
      // once, a level down, and selected.
      const moved = tree.getByRole('treeitem', { name: 'a.txt', exact: true });
      await expect(moved).toHaveAttribute('aria-level', '3', { timeout: 8000 });
      await expect(moved).toHaveAttribute('aria-selected', 'true');
      await expect(tree.getByText('b.txt', { exact: true })).toBeVisible(); // untouched
      await expect.poll(() => existsSync(join(root, 'sub', 'a.txt'))).toBe(true);
    });
  } finally {
    cleanupTemp(root);
  }
});

/**
 * #419 — a click at the bottom of a tree that shows BOTH scrollbars leaves the tree where it is.
 *
 * With a horizontal and a vertical scrollbar showing and the list scrolled all the way down, the
 * first click on a row nudged the tree up, and the reporter's double-click then missed the row.
 *
 * ══ WHAT WAS MEASURED ══
 *
 * The nudge, every time: on the unfixed build one click on the last row moved the scroller from
 * 797 to 785 — the horizontal scrollbar's height. Selecting asks react-window to reveal the row, and
 * react-window clamps with the list's full height rather than its client height, so a list at its
 * true bottom sits past what it thinks is the last offset. The fix leaves a row already in full
 * view alone (`visible-row-scroll.ts`, decision pinned in `visible-row-scroll.test.ts`).
 *
 * Why that costs the double-click: for 150 ms after ANY scroll react-window sets
 * `pointer-events: none` on its rows. Observed here when Playwright's own scroll-into-view preceded
 * the gesture — the second press landed on a container with no row under it. With a real-paced
 * gesture and no other scroll, synthetic input does NOT reproduce the lost double-click on the
 * unfixed build (5/5 passed), so the double-click assertion below is a statement of intent, not a
 * reproduction. The scroll assertion is the reproduction.
 *
 * The gesture is driven by coordinates, at a human's pace, after the list has settled: a locator
 * click would first scroll the (over-wide) row into view horizontally, which no user does.
 *
 * Why this layer: two real scrollbars and react-window's clamp exist only with a real layout.
 */
const BOTTOM_FOLDERS = 60;
const BOTTOM_LONG = 'a-folder-name-long-enough-to-be-wider-than-the-file-explorer-pane';
const bottomFolderName = (i: number): string => `f${String(i).padStart(2, '0')}-${BOTTOM_LONG}`;

function makeBottomClickProject(): string {
  const root = mkdtempSync(join(tmpdir(), 'throng-bottom-click-'));
  for (let i = 0; i < BOTTOM_FOLDERS; i++) {
    const folder = join(root, bottomFolderName(i));
    mkdirSync(folder);
    writeFileSync(join(folder, 'inside.txt'), 'x\n');
  }
  return root;
}

interface ScrollerState {
  top: number;
  max: number;
  hBar: boolean;
  vBar: boolean;
  /** react-window's isScrolling state: the rows ignore the pointer while it is set. */
  settled: boolean;
}

/** The tree's own scroller: the first element under the body that scrolls vertically. */
function scroller(win: Page, scrollToBottom = false): Promise<ScrollerState> {
  return win.evaluate((toBottom) => {
    const body = document.querySelector('[data-testid="file-explorer-tree"] .explorer__body');
    const el = [...(body?.querySelectorAll<HTMLElement>('*') ?? [])].find((e) =>
      /(auto|scroll)/.test(getComputedStyle(e).overflowY),
    );
    if (!el) throw new Error('no scrolling element in the explorer body');
    if (toBottom) el.scrollTop = el.scrollHeight;
    // react-window marks its ROWS container `pointer-events: none` while scrolling. It is not the
    // scroller's first child: react-arborist puts its drop-cursor layer ahead of it.
    const scrolling = [...el.children].some((c) => (c as HTMLElement).style.pointerEvents === 'none');
    return {
      top: el.scrollTop,
      max: el.scrollHeight - el.clientHeight,
      hBar: el.scrollWidth > el.clientWidth,
      vBar: el.scrollHeight > el.clientHeight,
      settled: !scrolling,
    };
  }, scrollToBottom);
}

/** A point on the part of the row the user can see: a little in from the pane's left, mid-height. */
async function visiblePointOn(win: Page, rel: string): Promise<{ x: number; y: number }> {
  return win.evaluate((relPath) => {
    const body = document
      .querySelector('[data-testid="file-explorer-tree"] .explorer__body')!
      .getBoundingClientRect();
    const row = document
      .querySelector(`.tree-row[data-rel-path="${relPath}"]`)!
      .getBoundingClientRect();
    return { x: Math.max(row.left, body.left) + 60, y: row.top + row.height / 2 };
  }, rel);
}

test('a click at the bottom of a two-scrollbar tree leaves the tree where it is (#419)', { tag: ['@extended', '@explorer', '@reserve:layout'] }, async () => {
  const root = makeBottomClickProject();
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'BottomClick', root);
      const tree = win.getByTestId('file-explorer-tree');
      const rowFor = (rel: string) => tree.locator(`.tree-row[data-rel-path="${rel}"]`);
      const opened = (rel: string) => rowFor(rel).locator('.tree-twisty');
      await expect(rowFor(bottomFolderName(0))).toBeVisible({ timeout: 8000 });

      // Control: the same double-click at the TOP of the list expands the folder, so a failure below
      // is about where the row sits, not about the gesture.
      const first = bottomFolderName(0);
      await expect.poll(async () => (await scroller(win)).settled).toBe(true);
      const top = await visiblePointOn(win, first);
      await win.mouse.click(top.x, top.y, { clickCount: 2, delay: 70 });
      await expect(opened(first)).toHaveClass(/tree-twisty--open/);
      await opened(first).click();
      await expect(opened(first)).not.toHaveClass(/tree-twisty--open/);

      const last = bottomFolderName(BOTTOM_FOLDERS - 1);
      await scroller(win, true);
      await expect(rowFor(last)).toBeVisible();
      // The user has stopped scrolling before they double-click.
      await expect.poll(async () => (await scroller(win)).settled).toBe(true);
      const before = await scroller(win);
      expect(before.hBar, 'precondition: a horizontal scrollbar').toBe(true);
      expect(before.vBar, 'precondition: a vertical scrollbar').toBe(true);
      expect(before.top, 'precondition: scrolled to the bottom').toBeGreaterThanOrEqual(before.max - 1);

      const bottom = await visiblePointOn(win, last);
      // One click selects the row. Measured on the unfixed build: 797 -> 785, every run — the tree
      // rose by the horizontal scrollbar's height.
      await win.mouse.click(bottom.x, bottom.y);
      await expect.poll(async () => (await scroller(win)).settled).toBe(true);
      expect((await scroller(win)).top, 'a click on a row in full view moved the tree').toBe(before.top);

      // And the double-click on it expands it. Measured: this half PASSES on the unfixed build too once
      // the gesture is a real one — synthetic input does not reproduce the lost double-click, only the
      // scroll beneath it. It stays as the user-facing statement of what the fix is for.
      // At a human's pace: ~70 ms held per press, so the second press lands ~140 ms after the first.
      await win.mouse.click(bottom.x, bottom.y, { clickCount: 2, delay: 70 });

      // Its child lands below the viewport, which a virtualised list does not render — so the
      // folder's own open state is what says the double-click landed.
      await expect(opened(last), 'the double-click did not expand the folder').toHaveClass(
        /tree-twisty--open/,
        { timeout: 2000 },
      );
    });
  } finally {
    cleanupTemp(root);
  }
});
