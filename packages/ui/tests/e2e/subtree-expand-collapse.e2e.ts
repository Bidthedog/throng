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
 */
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect, type Locator, type Page } from '@playwright/test';
import { runApp, createProject, reloadWindow, cleanupTemp } from './harness.js';

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

/** The shipped default excludes that apply to this fixture — the tree is right to omit them. */
const EXCLUDED = new Set(['node_modules', '.git']);

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
 * SC-009 / AS-8 / D6 — **zero folders may end up marked open with unloaded children.**
 *
 * For every folder the tree draws as open, either it renders at least one child row, or the folder
 * really is empty on disk. The filesystem is consulted deliberately: an unloaded folder and an empty
 * one render identically, so the tree alone cannot tell the two apart — which is exactly how #120
 * survived. A failure names the folder and what is actually inside it.
 */
async function expectNoOpenFolderLies(win: Page, projectRoot: string): Promise<void> {
  const all = await rows(win);
  const rendered = new Set(all.map((r) => r.relPath));
  for (const folder of all.filter((r) => r.kind === 'folder' && r.open)) {
    const rendersAChild = [...rendered].some(
      (rel) => rel !== folder.relPath && parentOf(rel) === folder.relPath,
    );
    if (rendersAChild) continue;
    const abs = folder.relPath === '' ? projectRoot : join(projectRoot, folder.relPath);
    const onDisk = readdirSync(abs).filter((n) => !EXCLUDED.has(n));
    expect(
      onDisk,
      `folder "${folder.relPath || '<root>'}" is drawn OPEN but renders no children — #120 desync`,
    ).toEqual([]);
  }
}

/** Right-click a row and choose one of the two new items. */
async function chooseOnRow(win: Page, relPath: string, label: string): Promise<void> {
  await rowFor(win, relPath).click({ button: 'right' });
  await expect(win.getByTestId(`menu-item-${label}`)).toBeVisible();
  await win.getByTestId(`menu-item-${label}`).click();
  await expect(win.getByTestId(`menu-item-${label}`)).toHaveCount(0);
}

/** Open a folder the ordinary way — the chevron, which is the path both new actions must reuse. */
async function chevron(win: Page, relPath: string): Promise<void> {
  await tree(win).getByTestId(`tree-twisty-${relPath}`).click();
  await expect(rowFor(win, relPath).locator('.tree-twisty')).toHaveAttribute('aria-expanded', 'true');
}

/** Renderer errors, minus the CSP noise react-dnd's empty drag image produces harmlessly. */
const realErrors = (errors: string[]): string[] =>
  errors.filter((e) => !e.includes('Content Security Policy') && !e.includes('data:image'));

function watchErrors(win: Page): string[] {
  const errors: string[] = [];
  win.on('pageerror', (e) => errors.push(String(e)));
  win.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  return errors;
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

test('AS-1/AS-2 — a folder offers both items; a file draws NEITHER, not even disabled', async () => {
  const projectRoot = makeProject('throng-subtree-menu-');
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'Subtree', projectRoot);
      await expect(tree(win)).toBeVisible();

      // AS-1 — a FOLDER offers both, enabled, in the Navigate group after Copy Path.
      await rowFor(win, 'branch').click({ button: 'right' });
      await expect(win.getByTestId(`menu-item-${COLLAPSE}`)).toBeVisible();
      await expect(win.getByTestId(`menu-item-${EXPAND}`)).toBeVisible();
      await expect(win.getByTestId(`menu-item-${COLLAPSE}`)).toBeEnabled();
      await expect(win.getByTestId(`menu-item-${EXPAND}`)).toBeEnabled();
      await win.keyboard.press('Escape');
      await expect(win.getByTestId(`menu-item-${COLLAPSE}`)).toHaveCount(0);

      // The project ROOT is a folder too, so its menu offers them as well (D3's premise).
      await rowFor(win, '').click({ button: 'right' });
      await expect(win.getByTestId(`menu-item-${COLLAPSE}`)).toBeVisible();
      await expect(win.getByTestId(`menu-item-${EXPAND}`)).toBeVisible();
      await win.keyboard.press('Escape');
      await expect(win.getByTestId(`menu-item-${COLLAPSE}`)).toHaveCount(0);

      /*
       * AS-2 / E2 — a FILE draws neither AT ALL. `toHaveCount(0)` rather than `toBeDisabled()`
       * is the whole point: a disabled row would satisfy "the user cannot use it" and still be
       * the wrong answer, because a file can never acquire children and the row could never come
       * alive. The menu is proved OPEN first, so the absence is about these two items and not
       * about a menu that failed to appear.
       */
      await rowFor(win, 'root.txt').click({ button: 'right' });
      await expect(win.getByTestId('menu-item-Rename')).toBeVisible();
      await expect(win.getByTestId('menu-item-Copy Path')).toBeVisible();
      expect(await win.getByTestId(`menu-item-${COLLAPSE}`).count()).toBe(0);
      expect(await win.getByTestId(`menu-item-${EXPAND}`).count()).toBe(0);
      await win.keyboard.press('Escape');
    });
  } finally {
    cleanupTemp(projectRoot);
  }
});

// ---------------------------------------------------------------------------
// Collapse All Children (AS-3, AS-4, AS-5 — contract D1/D2/D3)
// ---------------------------------------------------------------------------

test('AS-3/AS-4 — Collapse All Children closes every depth and leaves the anchor open', async () => {
  const projectRoot = makeProject('throng-subtree-collapse-');
  try {
    await runApp(async (_app, win) => {
      const errors = watchErrors(win);
      await createProject(win, 'Subtree', projectRoot);
      await expect(tree(win)).toBeVisible();

      // US4's own Independent Test: drill three levels down by hand, with the chevron.
      await chevron(win, 'branch');
      await chevron(win, 'branch/l1a');
      await chevron(win, 'branch/l1a/l2a');
      await chevron(win, 'branch/l1a/l2a/l3a');
      await expect(tree(win).getByText('deep.txt', { exact: true })).toBeVisible();
      expect(await openFolders(win)).toEqual([
        '',
        'branch',
        'branch/l1a',
        'branch/l1a/l2a',
        'branch/l1a/l2a/l3a',
      ]);

      await chooseOnRow(win, 'branch', COLLAPSE);

      // AS-4 / D1 — the anchor is STILL OPEN: its own children are on screen.
      await expect(rowFor(win, 'branch').locator('.tree-twisty')).toHaveAttribute(
        'aria-expanded',
        'true',
      );
      await expect(rowFor(win, 'branch/l1a')).toBeVisible();
      // AS-3 — and every descendant, at every depth, is closed.
      await expect(rowFor(win, 'branch/l1a/l2a')).toHaveCount(0);
      await expect(tree(win).getByText('deep.txt', { exact: true })).toHaveCount(0);
      expect(await openFolders(win)).toEqual(['', 'branch']);

      await expectNoOpenFolderLies(win, projectRoot);
      expect(realErrors(errors), `renderer errors:\n${errors.join('\n')}`).toEqual([]);
    });
  } finally {
    cleanupTemp(projectRoot);
  }
});

test('AS-5/D2 — on a folder with nothing expanded beneath it, nothing changes and nothing errors', async () => {
  const projectRoot = makeProject('throng-subtree-noop-');
  try {
    await runApp(async (_app, win) => {
      const errors = watchErrors(win);
      await createProject(win, 'Subtree', projectRoot);
      await expect(tree(win)).toBeVisible();

      // An OPEN folder whose own children are all closed, and a CLOSED folder. Neither has
      // anything expanded beneath it, so neither action has anything to do.
      await chevron(win, 'branch');
      await chevron(win, 'branch/l1b');
      const before = await openFolders(win);

      await chooseOnRow(win, 'branch/l1b', COLLAPSE);
      expect(await openFolders(win)).toEqual(before);

      await chooseOnRow(win, 'other', COLLAPSE); // closed: no loaded children at all
      expect(await openFolders(win)).toEqual(before);

      await expectNoOpenFolderLies(win, projectRoot);
      // "No error is raised" is asserted as the app saying nothing, in two places: no renderer
      // error, and no explorer notice raised for an action that did nothing.
      expect(realErrors(errors), `renderer errors:\n${errors.join('\n')}`).toEqual([]);
      await expect(win.getByTestId('notices').locator('.notice')).toHaveCount(0);
    });
  } finally {
    cleanupTemp(projectRoot);
  }
});

test('D3 — on the project ROOT, everything beneath closes and the root stays open', async () => {
  const projectRoot = makeProject('throng-subtree-root-');
  try {
    await runApp(async (_app, win) => {
      const errors = watchErrors(win);
      await createProject(win, 'Subtree', projectRoot);
      await expect(tree(win)).toBeVisible();

      await chevron(win, 'branch');
      await chevron(win, 'branch/l1a');
      await chevron(win, 'other');

      await chooseOnRow(win, '', COLLAPSE);

      // The root IS the tree: it cannot be collapsed, and its own children are still drawn.
      expect(await openFolders(win)).toEqual(['']);
      await expect(rowFor(win, 'branch')).toBeVisible();
      await expect(rowFor(win, 'other')).toBeVisible();
      await expect(tree(win).getByText('root.txt', { exact: true })).toBeVisible();
      await expect(rowFor(win, 'branch/l1a')).toHaveCount(0);

      await expectNoOpenFolderLies(win, projectRoot);
      expect(realErrors(errors), `renderer errors:\n${errors.join('\n')}`).toEqual([]);
    });
  } finally {
    cleanupTemp(projectRoot);
  }
});

// ---------------------------------------------------------------------------
// Expand All Children (AS-6, AS-7, AS-8, AS-9 — contract D4–D7)
// ---------------------------------------------------------------------------

test('AS-6/AS-7/AS-8/AS-9 — Expand All Children opens one level, loaded, and never into an excluded folder', async () => {
  const projectRoot = makeProject('throng-subtree-expand-');
  try {
    await runApp(async (_app, win) => {
      const errors = watchErrors(win);
      await createProject(win, 'Subtree', projectRoot);
      await expect(tree(win)).toBeVisible();

      // AS-7 / D5 / FR-042 — the anchor is CLOSED when the action is chosen.
      await expect(rowFor(win, 'branch').locator('.tree-twisty')).toHaveAttribute(
        'aria-expanded',
        'false',
      );
      await chooseOnRow(win, 'branch', EXPAND);

      // …so it opens ITSELF first, and then its immediate children.
      await expect(rowFor(win, 'branch').locator('.tree-twisty')).toHaveAttribute(
        'aria-expanded',
        'true',
      );
      // AS-6 / D4 — every immediate child FOLDER is open; the immediate child FILE is untouched.
      await expect(rowFor(win, 'branch/l1a').locator('.tree-twisty')).toHaveAttribute(
        'aria-expanded',
        'true',
      );
      await expect(rowFor(win, 'branch/l1b').locator('.tree-twisty')).toHaveAttribute(
        'aria-expanded',
        'true',
      );
      await expect(tree(win).getByText('branch.txt', { exact: true })).toBeVisible();

      // AS-6 / C4 — and NO GRANDCHILD is open. `l2a` and `empty` are drawn (their parents opened)
      // but closed, so nothing inside them is on screen.
      await expect(rowFor(win, 'branch/l1a/l2a')).toBeVisible();
      await expect(rowFor(win, 'branch/l1a/l2a').locator('.tree-twisty')).toHaveAttribute(
        'aria-expanded',
        'false',
      );
      await expect(rowFor(win, 'branch/l1b/empty').locator('.tree-twisty')).toHaveAttribute(
        'aria-expanded',
        'false',
      );
      await expect(rowFor(win, 'branch/l1a/l2a/l3a')).toHaveCount(0);
      await expect(tree(win).getByText('l2a.txt', { exact: true })).toHaveCount(0);
      expect(await openFolders(win)).toEqual(['', 'branch', 'branch/l1a', 'branch/l1b']);

      /*
       * AS-9 / D7 — an EXCLUDED folder is not expanded into, and the mechanism is that it is not in
       * the tree at all: `fetchChildren` filters by the shipped globs, so `node_modules` is never a
       * target for anything. Asserted on the row AND on its contents, because a filtered parent that
       * still leaked a child would be the same defect wearing a different face.
       */
      await expect(rowFor(win, 'branch/node_modules')).toHaveCount(0);
      await expect(tree(win).getByText('node_modules', { exact: true })).toHaveCount(0);
      await expect(tree(win).getByText('index.js', { exact: true })).toHaveCount(0);

      // AS-8 / SC-009 — the #120 assertion. `branch/l1b/empty` is the honest empty folder this
      // check must NOT flag, and any folder opened over an unloaded listing is the one it must.
      await expectNoOpenFolderLies(win, projectRoot);
      expect(realErrors(errors), `renderer errors:\n${errors.join('\n')}`).toEqual([]);
    });
  } finally {
    cleanupTemp(projectRoot);
  }
});

test('D4 — on an ALREADY-OPEN folder it still opens exactly one level, and no more', async () => {
  const projectRoot = makeProject('throng-subtree-expand-open-');
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'Subtree', projectRoot);
      await expect(tree(win)).toBeVisible();

      await chevron(win, 'branch');
      await chooseOnRow(win, 'branch', EXPAND);
      expect(await openFolders(win)).toEqual(['', 'branch', 'branch/l1a', 'branch/l1b']);

      // Running it AGAIN on the same anchor changes nothing: one level is one level, however many
      // times it is asked for. (Expanding further is what the chevron and the toolbar are for.)
      await chooseOnRow(win, 'branch', EXPAND);
      expect(await openFolders(win)).toEqual(['', 'branch', 'branch/l1a', 'branch/l1b']);

      // Choosing it on a child then opens THAT child's level — never a level it was not asked for.
      await chooseOnRow(win, 'branch/l1a', EXPAND);
      expect(await openFolders(win)).toEqual([
        '',
        'branch',
        'branch/l1a',
        'branch/l1a/l2a',
        'branch/l1b',
      ]);
      await expect(rowFor(win, 'branch/l1a/l2a/l3a').locator('.tree-twisty')).toHaveAttribute(
        'aria-expanded',
        'false',
      );

      await expectNoOpenFolderLies(win, projectRoot);
    });
  } finally {
    cleanupTemp(projectRoot);
  }
});

test('D4/D3 — Expand All Children on the project ROOT opens its first level only', async () => {
  const projectRoot = makeProject('throng-subtree-expand-root-');
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'Subtree', projectRoot);
      await expect(tree(win)).toBeVisible();

      await chooseOnRow(win, '', EXPAND);

      expect(await openFolders(win)).toEqual(['', 'branch', 'other']);
      await expect(tree(win).getByText('other.txt', { exact: true })).toBeVisible();
      await expect(rowFor(win, 'branch/l1a').locator('.tree-twisty')).toHaveAttribute(
        'aria-expanded',
        'false',
      );

      await expectNoOpenFolderLies(win, projectRoot);
    });
  } finally {
    cleanupTemp(projectRoot);
  }
});

// ---------------------------------------------------------------------------
// Persistence (AS-10 — contract D8, FR-045)
// ---------------------------------------------------------------------------

test('AS-10/D8 — the resulting open state survives a project switch and a window reload', async () => {
  const projectRoot = makeProject('throng-subtree-persist-');
  // A prefix that shares NOTHING with the first project's, belt to the id-based selection's braces:
  // the row renders this path, and a reader who later reaches for `hasText` should not find a
  // substring waiting to match the wrong row.
  const otherRoot = mkdtempSync(join(tmpdir(), 'throng-elsewhere-'));
  try {
    writeFileSync(join(otherRoot, 'elsewhere.txt'), 'elsewhere\n');
    await runApp(async (_app, win) => {
      await createProject(win, 'Subtree', projectRoot);
      const subtreeId = await activeProjectId(win);
      await expect(tree(win)).toBeVisible();

      // Two actions, so BOTH halves of the state are the product of this feature: Expand opens a
      // level, Collapse then closes one branch of it back down.
      await chooseOnRow(win, 'branch', EXPAND);
      await chooseOnRow(win, 'branch/l1a', EXPAND);
      await chooseOnRow(win, 'branch/l1b', EXPAND); // opens branch/l1b/empty…
      expect(await openFolders(win)).toContain('branch/l1b/empty');
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

test('AS-11/D9 — the toolbar’s Expand and Collapse all behave exactly as before', async () => {
  const projectRoot = makeProject('throng-subtree-toolbar-');
  try {
    await runApp(async (_app, win) => {
      const errors = watchErrors(win);
      await createProject(win, 'Subtree', projectRoot);
      await expect(tree(win)).toBeVisible();
      const toolbar = win.getByTestId('explorer-toolbar');
      const expandBtn = toolbar.getByRole('button', { name: 'Expand', exact: true });
      const collapseAllBtn = toolbar.getByRole('button', { name: 'Collapse all', exact: true });

      // Expand still opens the SHALLOWEST collapsed level of the whole tree — not one folder's
      // children, which is what the new menu items do. Twice, so it is plainly level-by-level.
      await expandBtn.click();
      await expect(rowFor(win, 'branch/l1a')).toBeVisible();
      expect(await openFolders(win)).toEqual(['', 'branch', 'other']);
      await expandBtn.click();
      await expect(rowFor(win, 'branch/l1a/l2a')).toBeVisible();
      expect(await openFolders(win)).toEqual(['', 'branch', 'branch/l1a', 'branch/l1b', 'other']);

      // Collapse all still resets to the root alone.
      await collapseAllBtn.click();
      expect(await openFolders(win)).toEqual(['']);
      await expect(rowFor(win, 'branch/l1a')).toHaveCount(0);

      /*
       * AS-11 asks the sharper question: after one of the NEW actions has run, do the old buttons
       * still behave as they did? They read the tree's live open-state and nothing else, so they
       * must — and this is what proves the new actions left no private state behind for them to
       * trip over.
       */
      await chooseOnRow(win, 'branch', EXPAND);
      expect(await openFolders(win)).toEqual(['', 'branch', 'branch/l1a', 'branch/l1b']);
      /*
       * The right-click SELECTED `branch`, so Expand anchors there and opens the shallowest
       * still-collapsed level inside it — `l2a` and `empty`. That is the level-by-level answer it
       * has always given, derived from open-state alone; the new action left it nothing to trip on.
       */
      await expandBtn.click();
      expect(await openFolders(win)).toEqual([
        '',
        'branch',
        'branch/l1a',
        'branch/l1a/l2a',
        'branch/l1b',
        'branch/l1b/empty',
      ]);
      await collapseAllBtn.click();
      expect(await openFolders(win)).toEqual(['']);

      await expectNoOpenFolderLies(win, projectRoot);
      expect(realErrors(errors), `renderer errors:\n${errors.join('\n')}`).toEqual([]);
    });
  } finally {
    cleanupTemp(projectRoot);
  }
});
