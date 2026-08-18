import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import { runApp, createProject, cleanupTemp, FILE_OP_TIMEOUT_MS } from './harness.js';

// Session 2026-07-06c: New File in the context menu (FR-096) + right-clicking empty
// space in the Files & Folders pane opens a root-targeted menu (FR-097).

function makeProject(): string {
  const root = mkdtempSync(join(tmpdir(), 'throng-newitems-'));
  mkdirSync(join(root, 'sub'));
  writeFileSync(join(root, 'sub', 'keep.txt'), 'x');
  writeFileSync(join(root, 'a.txt'), 'A');
  return root;
}

test('New File on a folder creates a file inside it, in rename mode (FR-096)', { tag: ['@extended', '@explorer'] }, async () => {
  const root = makeProject();
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
 * MOVED to `packages/ui/tests/component/explorer-root-menu.test.ts` (034 FR-045) — the FR-097
 * empty-space test, as six.
 *
 * WHAT IT ASSERTED, AND WHERE EACH PART NOW LIVES. The middle third was already proved at the
 * builder before the move and is not restated: `tests/unit/menu-sections.test.ts:396` pins the root
 * menu’s whole shape, and `tests/component/menu-section-rendering.test.ts:189/:215` pin its two
 * rendered rules and `OS File Explorer` leading the `Open In` flyout. What was proved NOWHERE below
 * E2E is the TARGET — `onEmptyContextMenu` in `file-tree.tsx`, its `{ relPath: ’’, kind: ’folder’ }`
 * node and its `.closest(’.tree-row’)` guard — and that is what the six close.
 *
 * THE REPLACEMENT LANDS STRONGER, and the reason is worth stating because it is why this was not
 * simply deleted as covered: the test below right-clicked the empty space with NOTHING SELECTED, so
 * "New File went to the root" and "New File went to the selection" produced the same file in the
 * same place and it could not tell them apart. The component tests select `a.txt` FIRST and then
 * read the destination off the bridge call, so a handler that passed the selected node through is a
 * failure rather than a pass. They also assert the guard from the other side — a right-click ON a
 * row still gets the row’s own menu — which nothing asserted anywhere, and whose inversion would
 * swallow every row menu in the pane.
 *
 * WHAT DID NOT MOVE: that `files.newFile(’’)` puts a real, empty, de-duplicated file on a real
 * disk. That is `tests/integration/files-service.test.ts:84` and `:91`, which pin the exact names
 * (`New folder`, then `New folder (2)`; `sub/New file.txt`) and assert the result "is a real, empty
 * file". The component layer stops at the bridge call and says so.
 *
 * AND THE TEST BELOW STAYS, deliberately. Its subject is the whole chain — menu, create, a focused
 * rename box, a commit, and bytes at `sub/made.txt` — and no single lower layer proves the
 * composition. FR-047: a partial replacement is not a replacement.
 *
 * ANTI-VACUITY CONTROL for the replacement: withhold the `ImmediateResizeObserver` stub. `FileTree`
 * gates its `<Tree>` on a non-zero size from a `ResizeObserver` jsdom does not implement, so the
 * tree never mounts and ALL SIX fail on "unable to find role=tree".
 */
