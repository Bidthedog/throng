/**
 * 033 US4 (T086) — **Collapse All Children** and **Expand All Children** on a folder's context menu.
 *
 * Covers AS-1 to AS-11, contract §B.2/§B.3 (D1–D10, E1–E3), SC-009 and FR-045. The builder-level
 * half — which rows exist for which node, in which section and order — is proved without a window by
 * `packages/ui/tests/unit/explorer-subtree-menu.test.ts`, and the pure targets by
 * `packages/core/tests/unit/explorer-subtree.test.ts`. What is left here is what genuinely needs one:
 * a real menu over a real tree, a real filesystem behind it, a project switch and a window reload.
 *
 * THE ASSERTION THAT MATTERS MOST is `expectNoOpenFolderLies` — issue #120. `build(dir)` in
 * `use-explorer-data.ts` yields `[]` for a folder whose children were never loaded, which is
 * indistinguishable from a folder that is genuinely empty: the row renders open, shows nothing, and
 * never fills. Every mutating test below ends by walking every open folder and demanding that it
 * either renders a child or is empty ON DISK. Counting rows would not catch it; only the comparison
 * against the filesystem can.
 *
 * It short-circuits at the first clause almost everywhere — an open folder that renders a child is
 * acquitted without touching the disk — so AS-10 is written to put `branch/l1b/empty` in the one
 * state that reaches the second clause, and asserts that it did. Otherwise "the assertion that
 * matters most" would be ten calls whose loop body never executed in a green run.
 */
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect, type Locator, type Page } from '@playwright/test';
import { DEFAULT_EXCLUDE_GLOBS, compileExcluder } from '@throng/core';
import {
  runApp as runOwnApp,
  createProject,
  reloadWindow,
  cleanupTemp,
} from './harness.js';

/**
 * root/
 *   branch/                 ← the anchor almost every test acts on
 *     l1a/                  ← immediate child folder
 *       l2a/                ← grandchild — Expand All Children must NOT open this
 *         l3a/
 *           deep.txt
 *         l2a.txt
 *       l1a.txt
 *     l1b/                  ← immediate child folder
 *       empty/              ← genuinely empty ON DISK: the honest case #120 hides behind
 *       l1b.txt
 *     node_modules/         ← excluded by the shipped defaults (FR-070) — D7's subject
 *       pkg/index.js
 *     branch.txt
 *   other/
 *     other.txt
 *   root.txt
 */
function makeProject(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  mkdirSync(join(root, 'branch', 'l1a', 'l2a', 'l3a'), { recursive: true });
  writeFileSync(join(root, 'branch', 'l1a', 'l2a', 'l3a', 'deep.txt'), 'deep\n');
  writeFileSync(join(root, 'branch', 'l1a', 'l2a', 'l2a.txt'), 'l2a\n');
  writeFileSync(join(root, 'branch', 'l1a', 'l1a.txt'), 'l1a\n');
  mkdirSync(join(root, 'branch', 'l1b', 'empty'), { recursive: true });
  writeFileSync(join(root, 'branch', 'l1b', 'l1b.txt'), 'l1b\n');
  mkdirSync(join(root, 'branch', 'node_modules', 'pkg'), { recursive: true });
  writeFileSync(join(root, 'branch', 'node_modules', 'pkg', 'index.js'), 'module.exports = 1;\n');
  writeFileSync(join(root, 'branch', 'branch.txt'), 'branch\n');
  mkdirSync(join(root, 'other'));
  writeFileSync(join(root, 'other', 'other.txt'), 'other\n');
  writeFileSync(join(root, 'root.txt'), 'root\n');
  return root;
}

/**
 * The shipped exclusion rule itself, compiled — never a second copy of it.
 *
 * This was `new Set(['node_modules', '.git'])`, which is the answer written out by hand. Two names of
 * seven, in a different form, in a different file: add an eighth glob (or drop `**\/node_modules`, as
 * FR-070 nearly did the other way round) and the tree would legitimately change while the check went
 * on comparing against the old list — reporting a #120 desync for a folder the tree was right to
 * leave empty, or missing a real one. `compileExcluder` is the same predicate `fetchChildren` asks,
 * so the two cannot drift.
 */
const isExcluded = compileExcluder(DEFAULT_EXCLUDE_GLOBS);

const COLLAPSE = 'Collapse All Children';
const EXPAND = 'Expand All Children';

const tree = (win: Page): Locator => win.getByTestId('file-explorer-tree');
const rowFor = (win: Page, relPath: string): Locator =>
  tree(win).locator(`.tree-row[data-rel-path="${relPath}"]`);

interface RowState {
  relPath: string;
  kind: string;
  open: boolean;
}

/** Every rendered row, with the open-state its chevron is ADVERTISING (`aria-expanded`). */
async function rows(win: Page): Promise<RowState[]> {
  return tree(win)
    .locator('.tree-row')
    .evaluateAll((els) =>
      els.map((el) => ({
        relPath: el.getAttribute('data-rel-path') ?? '',
        kind: el.getAttribute('data-kind') ?? '',
        // The project root has no chevron button at all — it is the tree, and always open.
        open:
          el.classList.contains('tree-row--root') ||
          el.querySelector('.tree-twisty')?.getAttribute('aria-expanded') === 'true',
      })),
    );
}

/** The relPaths of every folder the tree is currently drawing as OPEN, sorted for comparison. */
async function openFolders(win: Page): Promise<string[]> {
  const all = await rows(win);
  return all
    .filter((r) => r.kind === 'folder' && r.open)
    .map((r) => r.relPath)
    .sort();
}

const parentOf = (rel: string): string =>
  rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '';

/**
 * The open folders, read once the tree has STOPPED MOVING — required before every negative assertion.
 *
 * `expandChildren` is a fire-and-forget `void (async () => {…})()`: it returns to its caller
 * immediately and then does two more rounds of IPC, so the rows it is about to add appear a beat
 * after the click. `chooseOnRow` waits only for the menu item to detach, which happens sooner still.
 *
 * That is harmless for a POSITIVE assertion — `toBeVisible` retries until the row arrives. It is
 * fatal for a NEGATIVE one. "This grandchild stayed closed" and "asking a second time changed
 * nothing" are both TRUE at t=0 and only become false later, so a retrying matcher is satisfied by
 * its FIRST poll and the test has measured the gap rather than the behaviour. A recursive-descent
 * regression in `expandChildren` — every level opening instead of one — passes every one of them.
 *
 * So poll until two consecutive reads AGREE, and assert on the settled value. "Nothing more
 * happened" then means nothing more happened after the tree came to rest, which is the only reading
 * of it that can fail.
 */
async function settledOpenFolders(win: Page): Promise<string[]> {
  let previous: string | null = null;
  let latest: string[] = [];
  await expect
    .poll(
      async () => {
        latest = await openFolders(win);
        const now = JSON.stringify(latest);
        const stable = previous !== null && previous === now;
        previous = now;
        return stable;
      },
      {
        timeout: 20_000,
        intervals: [300, 300, 300, 300, 500],
        message: 'the tree never stopped changing shape',
      },
    )
    .toBe(true);
  return latest;
}

/**
 * SC-009 / AS-8 / D6 — **zero folders may end up marked open with unloaded children.**
 *
 * For every folder the tree draws as open, either it renders at least one child row, or the folder
 * really is empty on disk. The filesystem is consulted deliberately: an unloaded folder and an empty
 * one render identically, so the tree alone cannot tell the two apart — which is exactly how #120
 * survived. A failure names the folder and what is actually inside it.
 *
 * Returns the folders that actually REACHED the filesystem — the ones drawn open with no child row,
 * which had to be acquitted by a `readdirSync`. At almost every call site every open folder renders
 * a child, so the loop short-circuits and the return is `[]`: the check runs, finds nothing to
 * verify, and passes. That is a green bar for a body that never executed, which is why AS-10 below
 * asserts on this list rather than merely calling the function — one call site proves the honest
 * empty folder is acquitted and the desync branch is reachable, instead of ten call sites proving
 * neither.
 */
async function expectNoOpenFolderLies(win: Page, projectRoot: string): Promise<string[]> {
  const all = await rows(win);
  const rendered = new Set(all.map((r) => r.relPath));
  const verifiedOnDisk: string[] = [];
  for (const folder of all.filter((r) => r.kind === 'folder' && r.open)) {
    const rendersAChild = [...rendered].some(
      (rel) => rel !== folder.relPath && parentOf(rel) === folder.relPath,
    );
    if (rendersAChild) continue;
    const abs = folder.relPath === '' ? projectRoot : join(projectRoot, folder.relPath);
    const onDisk = readdirSync(abs).filter(
      (n) => !isExcluded(folder.relPath === '' ? n : `${folder.relPath}/${n}`),
    );
    expect(
      onDisk,
      `folder "${folder.relPath || '<root>'}" is drawn OPEN but renders no children — #120 desync`,
    ).toEqual([]);
    verifiedOnDisk.push(folder.relPath);
  }
  return verifiedOnDisk;
}

/** Right-click a row and choose one of the two new items. */
async function chooseOnRow(win: Page, relPath: string, label: string): Promise<void> {
  await rowFor(win, relPath).click({ button: 'right' });
  await expect(win.getByTestId(`menu-item-${label}`)).toBeVisible();
  await win.getByTestId(`menu-item-${label}`).click();
  await expect(win.getByTestId(`menu-item-${label}`)).toHaveCount(0);
}


/**
 * The id of the project that is ACTIVE right now — which, straight after `createProject`, is the
 * project it just created (the harness waits for exactly that before returning).
 *
 * An id rather than a name, because a name cannot identify a row here. Each row renders the
 * project's ROOT PATH beside its name (`projects-panel.tsx` — `.project-item__path`), and
 * Playwright's `hasText` is a case-insensitive SUBSTRING match over the row's whole text. This spec
 * creates two projects in one window, and a filter on either name matched BOTH rows through their
 * temp-directory paths — a strict-mode violation, and worse, a helper that could not tell the two
 * projects apart in the one test whose entire point is switching between them. The harness's own
 * `createProject` documents this trap for names; it reaches the path text just as easily.
 */
async function activeProjectId(win: Page): Promise<string> {
  const testId = await win
    .locator('.project-item[data-active="true"]')
    .evaluate((el) => el.getAttribute('data-testid') ?? '');
  const id = testId.replace(/^project-item-/, '');
  if (id === '' || id === testId) {
    throw new Error(`activeProjectId: no usable project-item testid (saw "${testId}")`);
  }
  return id;
}

/** Switch to a project BY ID, and prove the switch by that project's own row going active. */
async function enterProject(win: Page, projectId: string): Promise<void> {
  const item = win.getByTestId(`project-item-${projectId}`);
  await expect(item).toBeVisible({ timeout: 20_000 });
  const sw = win.getByTestId(`project-switch-${projectId}`);
  if (await sw.isVisible().catch(() => false)) await sw.click();
  await expect(item).toHaveAttribute('data-active', 'true', { timeout: 20_000 });
  await expect(tree(win)).toBeVisible({ timeout: 20_000 });
}

// ---------------------------------------------------------------------------
// Where the items are drawn (AS-1, AS-2 — contract E1/E2/E3)
// ---------------------------------------------------------------------------

/*
 * DELETED (034 FR-045): "AS-1/AS-2 — a folder offers both items; a file draws NEITHER, not even
 * disabled".
 *
 * It launched Electron and right-clicked three rows to read a menu that a builder function
 * produces from a node kind. Every assertion is made directly on that builder in
 * `packages/ui/tests/unit/explorer-subtree-menu.test.ts`:
 *   - a folder offers both, in the Navigate section after Copy Path — "E1 — both are drawn, in
 *     the Navigate section, immediately after Copy Path"
 *   - and never disabled — "neither is ever drawn disabled for a folder"
 *   - the project ROOT is a folder too — "D3 — the project ROOT is a folder, so its menu offers
 *     both as well"
 *   - a file draws neither at ANY depth — "E2 — neither label appears anywhere in a file’s menu,
 *     at any depth" (it walks the submenus, which the E2E did not)
 *   - and not greyed either — "E2 — and not as a DISABLED row either: absent, not greyed"
 *   - the non-vacuity the E2E got from asserting Rename and Copy Path were visible first —
 *     "E2 — a file’s Navigate section is otherwise exactly what it was"
 *
 * Six unit cases against three right-clicks, and the unit ones ask a question the E2E could not:
 * whether the label is hiding in a submenu.
 */

// ---------------------------------------------------------------------------
// Collapse All Children (AS-3, AS-4, AS-5 — contract D1/D2/D3)
// ---------------------------------------------------------------------------

/*
 * THE SHARED APP IS GONE, AND SO IS THE ipcMain INSTRUMENT (035).
 *
 * This file used to open one app for three tests and keep AS-10 on its own, because AS-10 reloads
 * the window. Those three tests are now component tests, so the sharing has nothing left to share
 * and the one survivor launches its own app — which is what it always did.
 *
 * Three pieces of machinery went with them, and each is worth naming because each was real work:
 *
 *   - `recordListings` swapped Electron's `throng:files:list` ipcMain handler for a recording
 *     wrapper, reaching into `ipcMain._invokeHandlers` — a private table — and failing loudly if it
 *     had moved. It existed because FR-044's hidden-folder half has NO visible consequence: the
 *     requirement is that a folder is not expanded INTO, and only the calls that were not made are
 *     evidence of that. `file-tree.test.ts`'s fake records every directory it is asked for as an
 *     ordinary part of being a fake, so the same evidence is available without patching anything.
 *   - `settledOpenFolders` polled until two consecutive reads agreed, because every negative
 *     assertion in an expand test is TRUE at t=0. That hazard is real and did not go away; it is
 *     answered in the component tests by waiting on the POSITIVE outcome first.
 *   - `watchErrors` collected renderer console errors. It only ever guarded the three migrated
 *     tests, and jsdom surfaces a throwing render as a failed test rather than as a console line.
 */

/*
 * MOVED to `packages/core/tests/unit/explorer-subtree.test.ts` (034 FR-046a) — five tests:
 * the no-op case, the root case for collapse, the already-open case, the root case for expand,
 * and the toolbar behaving as before. All five are `immediateChildFolders` and
 * `descendantOpenFolders` over an ExpandNode, with no filesystem in sight.
 *
 * The Red proof is the one worth remembering: making one-level expand return DESCENDANTS —
 * i.e. expand-everything, the exact defect the rule exists to prevent — reddens 5 cases there.
 *
 * What stays in this file needs a real tree on a real disk: the collapse that must close every
 * depth, the expand that must not enter an excluded folder, the hidden folder that must never
 * even be listed, and the open state surviving a project switch and a reload.
 */

// ---------------------------------------------------------------------------
// Expand All Children (AS-6, AS-7, AS-8, AS-9 — contract D4–D7)
// ---------------------------------------------------------------------------

/**
 * D7's SECOND half — FR-044 for a folder hidden by **"Hide in this project"**, not by a glob.
 *
 * The test above covers the glob half, and its mechanism is that `fetchChildren` filters the listing,
 * so an excluded folder is never a target for anything. The per-project hidden set works the other
 * way round: it is applied in the `data` memo, LONG after `fetchChildren`, so `childrenMap` — which is
 * exactly what `expandChildren` reads — still holds the hidden folder. The explicit
 * `.filter((r) => !hiddenSet.has(r))` in `use-explorer-data.ts` is the only thing keeping it out of
 * the targets, and until now nothing in the suite went anywhere near it.
 *
 * WHAT THIS ASSERTS, AND WHAT IT DELIBERATELY DOES NOT. Removing that filter would not leak the
 * folder into the tree — `data` drops it at every level, `api.open` on an absent node renders
 * nothing, and `snapshotOpen` never sees it. Its whole cost is one directory listing issued for a
 * folder the user has said they do not want to see. So the tree assertions below are the guard
 * (nothing leaked), and the LISTING assertion is the test: the mutation this file exists to catch is
 * deleting that filter, and it is caught by `not.toContain('branch/veiled')` and by nothing else.
 *
 * The anchor is opened by hand FIRST so `branch` is already in `childrenMap` complete with `veiled`,
 * which is the state the filter is written for — hidden AFTER the listing that named it.
 */
// ---------------------------------------------------------------------------
// Persistence (AS-10 — contract D8, FR-045)
// ---------------------------------------------------------------------------

/*
 * THREE TESTS REMOVED (035 FR-007) — Collapse All Children, Expand All Children, and the hidden
 * folder. All three are now `packages/ui/tests/component/file-tree.test.ts`.
 *
 * WHAT THEIR RESERVE TAG SAID, AND WHAT THEY ACTUALLY DROVE. Each was here because it walks a
 * context menu. throng's context menu is an IN-DOM REACT COMPONENT (`ContextMenuProvider`) — the
 * native-menu entry on the constitution's reserve is about `Menu`/`MenuItem` from Electron, and
 * these never touched one. `context-menu-lifecycle.test.ts` and `file-tree.test.ts`'s Cut test
 * already drive this menu in jsdom, so what these three actually needed was a folder tree, and a
 * folder tree is a set of directory listings.
 *
 * THE #120 CHECK GOT STRONGER, NOT WEAKER. `expectNoOpenFolderLies` had to consult the real
 * filesystem here, because an unloaded folder and an empty one render identically and the tree
 * cannot tell them apart. In the component test the listings ARE the filesystem and the fake logs
 * every directory the tree asked for, so "drawn open but never listed" is stated directly instead of
 * being inferred from a `readdirSync`. FR-044's hidden folder is the same story: the requirement is
 * that the folder is not expanded INTO, which has no visible consequence, and the listing log is
 * evidence about a call that was not made.
 *
 * RED-PROVEN THREE WAYS, each hitting exactly one test: making one-level expand return DESCENDANTS
 * (the recursive-descent defect FR-042 exists to prevent) reddens the expand and hidden tests;
 * dropping the `hiddenSet` filter reddens the hidden test alone; adding the anchor to the collapse
 * targets reddens the collapse test alone.
 *
 * WHAT STAYS. AS-10/D8 below — the open state surviving a project switch and a window RELOAD. That
 * is `@reserve:window` and it is the one place in this file where `expectNoOpenFolderLies`'s
 * filesystem branch genuinely runs against a real disk.
 */
test('AS-10/D8 — the resulting open state survives a project switch and a window reload', { tag: ['@extended', '@explorer', '@reserve:window'] }, async () => {
  const projectRoot = makeProject('throng-subtree-persist-');
  // A prefix that shares NOTHING with the first project's, belt to the id-based selection's braces:
  // the row renders this path, and a reader who later reaches for `hasText` should not find a
  // substring waiting to match the wrong row.
  const otherRoot = mkdtempSync(join(tmpdir(), 'throng-elsewhere-'));
  try {
    writeFileSync(join(otherRoot, 'elsewhere.txt'), 'elsewhere\n');
    await runOwnApp(async (_app, win) => {
      await createProject(win, 'Subtree', projectRoot);
      const subtreeId = await activeProjectId(win);
      await expect(tree(win)).toBeVisible();

      // Two actions, so BOTH halves of the state are the product of this feature: Expand opens a
      // level, Collapse then closes one branch of it back down.
      await chooseOnRow(win, 'branch', EXPAND);
      await chooseOnRow(win, 'branch/l1a', EXPAND);
      await chooseOnRow(win, 'branch/l1b', EXPAND); // opens branch/l1b/empty…
      expect(await settledOpenFolders(win)).toContain('branch/l1b/empty');

      /*
       * ══ THE ONE MOMENT `expectNoOpenFolderLies` ACTUALLY REACHES THE FILESYSTEM ══
       *
       * `branch/l1b/empty` is open right here, renders no child row, and is empty on disk — the
       * honest-empty case #120 hides behind. At every OTHER call site in this file each open folder
       * renders a child, so the check short-circuits before `readdirSync` and its body never runs at
       * all: ten green calls proving that nine loops did nothing. This is the call that exercises
       * both branches, and the returned list is asserted so that it stays that way — a change that
       * left `empty` closed here would quietly retire the check's only real exercise, and this
       * assertion is what would say so.
       */
      const acquitted = await expectNoOpenFolderLies(win, projectRoot);
      expect(
        acquitted,
        'the honest-empty folder must be the one that reached the filesystem — otherwise ' +
          'expectNoOpenFolderLies has never once run its body in a green run',
      ).toEqual(['branch/l1b/empty']);

      await chooseOnRow(win, 'branch/l1b', COLLAPSE); // …which this closes again
      const expected = await openFolders(win);
      expect(expected).toEqual(['', 'branch', 'branch/l1a', 'branch/l1a/l2a', 'branch/l1b']);

      // A second project, switched to and back. The tree is rebuilt from localStorage on return,
      // exactly as it is after a manual expand. Creating it makes it active, and the two ids are
      // asserted DIFFERENT — the switch is only evidence if there really were two projects.
      await createProject(win, 'Elsewhere', otherRoot);
      const elsewhereId = await activeProjectId(win);
      expect(elsewhereId).not.toBe(subtreeId);
      await expect(tree(win).getByText('elsewhere.txt', { exact: true })).toBeVisible();
      await enterProject(win, subtreeId);
      await expect(rowFor(win, 'branch/l1a/l2a')).toBeVisible({ timeout: 15_000 });
      expect(await openFolders(win)).toEqual(expected);
      await expectNoOpenFolderLies(win, projectRoot);

      // And a window reload — the same key, the same shape, restored on reopen (FR-045). The id is
      // the persisted project id, so it still names the same row after the reload.
      await reloadWindow(win);
      await enterProject(win, subtreeId);
      await expect(rowFor(win, 'branch/l1a/l2a')).toBeVisible({ timeout: 15_000 });
      expect(await openFolders(win)).toEqual(expected);
      await expectNoOpenFolderLies(win, projectRoot);
    });
  } finally {
    cleanupTemp(projectRoot);
    cleanupTemp(otherRoot);
  }
});

// ---------------------------------------------------------------------------
// The toolbar is untouched (AS-11 — contract D9, FR-046)
// ---------------------------------------------------------------------------
