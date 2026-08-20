import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { openApp, createProject, firstPanelId, cleanupTemp, type OpenApp } from './harness.js';
import { skipIfElevated } from './admin.js';

// Session 2026-07-06b: editor pill always shows the containing folder (FR-088),
// context menus stay on-screen (FR-089), and a tree rename commits on blur (FR-090).

/*
 * ══ ONE APP FOR THE FILE (034 FR-045) ══
 *
 * Four tests, four `runApp()` calls, four Electron launches and four daemons. Nothing here seeds
 * state before the app starts — `makeProject()` is a `mkdtempSync` folder that reaches the app only
 * through in-app `createProject`, a filesystem fixture rather than a launch seed — and nothing
 * relaunches. So the file shares one app.
 *
 * WHY SHARING IS SAFE HERE SPECIFICALLY, check by check:
 *
 *  • Assertions are RELATIVE. The pill test reads `panel-file-${pid}`; the menu test compares the
 *    menu's own box against the window it was measured in; the selection test reads the input it
 *    just opened. The one assertion that LOOKS window-wide — `toHaveCount(0)` for `top.txt` — is
 *    scoped to `file-explorer-tree`, and only the ACTIVE project's tree renders, so it can only ever
 *    see this test's own root.
 *
 *  • NO PROJECT-NAME COLLISION — the one thing that had to be FIXED rather than merely checked. All
 *    four tests created a project called `Fb3` over four DIFFERENT temp roots; four launches hid it
 *    and one app cannot. They are named apart below and nothing else about them changed. The ROOTS
 *    were already fine: four sibling `throng-fb3-` temp dirs, so FR-029's identical/ancestor/
 *    descendant exclusivity rule cannot reject any of them.
 *
 *  • Nothing here swaps a main-process handler, resizes the window or collapses a pane. Two tests do
 *    end with transient UI still open — a context menu (test 2) and an inline tree-rename input
 *    (test 3) — and both clear themselves harmlessly. Checked rather than assumed: the context menu
 *    has NO backdrop and closes from a window `pointerdown` listener that neither preventDefaults nor
 *    stops propagation, so the next click both closes it and reaches its target, and the provider
 *    keeps ONE menu open at a time; the rename input commits on blur (FR-090) with its untouched
 *    value, which is a no-op rename.
 *
 *  • `skipIfElevated()` on the first test is unaffected: the skip happens inside the body, after the
 *    shared app is already open, and the other three do not skip.
 *
 * Deliberately NOT `mode: 'serial'`. These four ask four independent questions — what the pill
 * shows, where a menu lands, what a rename selects, what a blur commits — and a first failure that
 * skipped the rest would turn one of them into "something about the editor feedback is wrong".
 * `fullyParallel: false` already keeps the file to one worker, in order, so the shared app is never
 * driven by two tests at once.
 */

function makeProject(): string {
  const root = mkdtempSync(join(tmpdir(), 'throng-fb3-'));
  mkdirSync(join(root, 'sub'));
  writeFileSync(join(root, 'sub', 'deep.txt'), 'DEEP\n');
  writeFileSync(join(root, 'top.txt'), 'TOP\n');
  return root;
}

async function newEditor(win: Page): Promise<string> {
  const pid = await firstPanelId(win);
  await win.getByTestId(`panel-type-select-${pid}`).selectOption('editor');
  await win.getByTestId(`panel-type-confirm-${pid}`).click();
  await expect(win.getByTestId(`editor-${pid}`)).toBeVisible();
  return pid;
}

let shared: OpenApp;

test.beforeAll(async () => {
  shared = await openApp();
});

test.afterAll(async () => {
  await shared?.close();
});

/*
 * TWO TESTS REMOVED (035) — the rename box's selection range, and blur-commit (FR-090). Both are
 * now `packages/ui/tests/component/explorer-tree-interaction.test.ts`.
 *
 * The first read `selectionStart`/`selectionEnd` off an `<input>`, which is a jsdom question in
 * the most literal sense: the property is set by the component, at mount, from the value it was
 * given. The second typed a name, clicked another row, and called `existsSync` — but the
 * filesystem half was never the claim. `files-service.test.ts:48` already proves `rename` moves
 * the bytes; FR-090 says a BLUR commits at all, rather than discarding what the user typed the way
 * Escape does, and that is the tree's decision.
 *
 * TWO THINGS CAME OUT OF MOVING THEM, and both are the point of the exercise:
 *
 *   - A DEFECT, filed as #283. The stem rule is applied to folders as well as files, so a folder
 *     called `my.config` opens with `my` selected and renaming it to "settings" gives
 *     `settings.config`. The E2E asserted `top.txt` only, so the folder case had never been
 *     exercised at any layer. A characterisation test records it as it behaves, with the intended
 *     value written down as the red step for whoever takes the issue.
 *   - A VACUOUS TEST, caught by its own red step. A draft claimed Escape SUPPRESSES the blur-commit
 *     that follows a cancel — a real rule, at `tree-node.tsx:151` — and deleting the suppression
 *     left every test green, because jsdom does not fire `blur` when a focused element is
 *     unmounted. The claim is narrowed to what actually runs and the gap is stated there.
 */
test('the editor pill shows the containing folder in brackets (subfolder + root)', { tag: ['@extended', '@editor'] }, async () => {
  skipIfElevated();
  const root = makeProject();
  try {
    const { win } = shared;
    await createProject(win, 'Fb3Pill', root);
    const pid = await newEditor(win);
    await win.getByTestId(`editor-${pid}`).click();
    const tree = win.getByTestId('file-explorer-tree');

    // Open a file in a subfolder → pill shows the project-relative path with the
    // host OS's native separator (Windows '\\', FR-101).
    await tree.getByTestId('tree-twisty-sub').click(); // #121: the NAME only selects; the twisty expands
    await tree.getByText('deep.txt', { exact: true }).click();
    const pill = win.getByTestId(`panel-file-${pid}`);
    await expect(pill).toContainText('deep.txt', { timeout: 8000 });
    await expect(pill).toContainText('\\sub\\');
    // The hover title (full absolute path) is consistently native — no mixed slashes.
    const title = await pill.getAttribute('title');
    expect(title).toContain('\\');
    expect(title).not.toContain('/');

    // Open a root-level file → pill shows "\\<name>" (rooted at the project root).
    await tree.getByText('top.txt', { exact: true }).click();
    await expect(pill).toContainText('top.txt', { timeout: 8000 });
    await expect(pill).toContainText('\\top.txt');
  } finally {
    cleanupTemp(root);
  }
});

test('a context menu opened near the bottom-right edge stays fully on-screen (FR-089)', { tag: ['@extended', '@editor', '@reserve:layout'] }, async () => {
  const root = makeProject();
  try {
    const { win } = shared;
    await createProject(win, 'Fb3Menu', root);
    const tree = win.getByTestId('file-explorer-tree');
    await expect(tree).toBeVisible();

    const viewport = await win.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
    // The Files & Folders tree is the right-hand pane, so a right-click here lands
    // near the window's right edge — the menu (which opens rightward by default)
    // must flip LEFT to stay on-screen.
    await tree.getByText('top.txt', { exact: true }).click({ button: 'right' });
    // The menu must be fully within the viewport (flipped up/left as needed).
    const box = await win.getByTestId('context-menu').boundingBox();
    expect(box).not.toBeNull();
    if (box) {
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.w + 1);
      expect(box.y + box.height).toBeLessThanOrEqual(viewport.h + 1);
    }
  } finally {
    cleanupTemp(root);
  }
});

