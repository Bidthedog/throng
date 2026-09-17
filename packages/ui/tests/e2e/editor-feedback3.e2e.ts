import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import { openApp, createProject, cleanupTemp, type OpenApp } from './harness.js';

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
 *  • `skipIfElevated()` on the first test was unaffected: the skip happened inside the body, after
 *    the shared app was already open. (That test has since moved down — see 044 T163c below.)
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
/*
 * MOVED DOWN (044 T163c): "the editor pill shows the containing folder in brackets (subfolder +
 * root)". Its three claims, each observed failing below against a broken implementation first:
 *
 *   - what the folder part SAYS for a subfolder and a root-level file, in native separators —
 *     `packages/core/tests/unit/path-display.test.ts` (`editorPathParts`);
 *   - that the header DRAWS it into `.panel-box__file-folder` beside `.panel-box__file-name`, and
 *   - that the pill's `title` is the full path with back-slashes only —
 *     `packages/ui/tests/component/panel-box.test.ts`, "the editor file pill shows the containing
 *     folder", added for this move.
 *
 * It was also the file's only `skipIfElevated()` test, so this file no longer loses coverage on an
 * elevated runner.
 */

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

