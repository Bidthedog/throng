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

      /*
       * AS-6 / C4 — and NO GRANDCHILD is open. `l2a` and `empty` are drawn (their parents opened)
       * but closed, so nothing inside them is on screen.
       *
       * Everything from here down is a NEGATIVE, and a negative is true before the work finishes, so
       * the tree is allowed to come to rest FIRST. Without this, a recursive descent that eventually
       * opened `l2a` would still be asserted closed on the first poll after the click.
       */
      const settled = await settledOpenFolders(win);
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
      expect(settled).toEqual(['', 'branch', 'branch/l1a', 'branch/l1b']);

      /*
       * AS-9 / D7 — an EXCLUDED folder is not expanded into, and the mechanism is that it is not in
       * the tree at all: `fetchChildren` filters by the shipped globs, so `node_modules` is never a
       * target for anything. Asserted on the row AND on its contents, because a filtered parent that
       * still leaked a child would be the same defect wearing a different face.
       */
      await expect(rowFor(win, 'branch/node_modules')).toHaveCount(0);
      await expect(tree(win).getByText('node_modules', { exact: true })).toHaveCount(0);
      await expect(tree(win).getByText('index.js', { exact: true })).toHaveCount(0);

      /*
       * AS-8 / SC-009 — the #120 assertion. Here it passes by SHORT-CIRCUIT: `empty` is drawn but
       * closed (asserted above), so every folder the tree draws as open renders a child and nothing
       * reaches the filesystem. That is the check doing its job — the desync it hunts is a folder
       * open over an unloaded listing, and there is none — but it is not the check being exercised.
       * The honest-empty branch, where `empty` is genuinely open and genuinely empty, is proved in
       * AS-10 below, which is the only place in this file where the loop body runs.
       */
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

      /*
       * Every assertion in this test is a NEGATIVE dressed as an equality — "one level, and NO
       * more". Each therefore reads the tree only once it has settled: `expandChildren` returns
       * before its second round of IPC lands, so an extra level opening a beat later is invisible to
       * a read taken the moment the menu item detaches.
       */
      await chevron(win, 'branch');
      await chooseOnRow(win, 'branch', EXPAND);
      expect(await settledOpenFolders(win)).toEqual([
        '',
        'branch',
        'branch/l1a',
        'branch/l1b',
      ]);

      // Running it AGAIN on the same anchor changes nothing: one level is one level, however many
      // times it is asked for. (Expanding further is what the chevron and the toolbar are for.)
      await chooseOnRow(win, 'branch', EXPAND);
      expect(await settledOpenFolders(win)).toEqual([
        '',
        'branch',
        'branch/l1a',
        'branch/l1b',
      ]);

      // Choosing it on a child then opens THAT child's level — never a level it was not asked for.
      await chooseOnRow(win, 'branch/l1a', EXPAND);
      expect(await settledOpenFolders(win)).toEqual([
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

      // Settled first, for the same reason as D4 above: "the first level ONLY" is a negative, and a
      // second level arriving late would slip under an assertion taken too early.
      expect(await settledOpenFolders(win)).toEqual(['', 'branch', 'other']);
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
      expect(await settledOpenFolders(win)).toEqual(['', 'branch', 'branch/l1a', 'branch/l1b']);
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
