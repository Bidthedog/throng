import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { createProject, runApp, cleanupTemp} from './harness.js';


/**
 * 018 / US8 — hidden files can be seen and un-hidden (FR-041 … FR-047a).
 *
 * "Hide in this project" was a one-way door: the path went into the project's `hiddenPaths` and the
 * only way back out was to hand-edit the database. This is the door in the other direction.
 *
 * Renderer-only: `setHidden` already REPLACES the whole list, so un-hiding is a filter over what the
 * renderer already holds. No new IPC, no daemon method, no schema change.
 */

function makeProjectFolder(): string {
  const root = mkdtempSync(join(tmpdir(), 'throng-proj-'));
  writeFileSync(join(root, 'a.txt'), 'a');
  writeFileSync(join(root, 'b.txt'), 'b');
  writeFileSync(join(root, 'c.txt'), 'c');
  return root;
}

/** Hide `name` through the tree's context menu — the only way in, and the door this story reopens. */
async function hide(win: import('@playwright/test').Page, name: string): Promise<void> {
  const tree = win.getByTestId('file-explorer-tree');
  await tree.getByText(name, { exact: true }).click({ button: 'right' });
  await win.locator('.context-menu__item', { hasText: 'Hide in this project' }).click();
  await expect(tree.getByText(name, { exact: true })).toHaveCount(0);
}

async function openSettings(win: import('@playwright/test').Page): Promise<void> {
  await win.getByTestId('project-settings-open').click();
  await expect(win.getByTestId('project-settings-dialog')).toBeVisible();
}

test('lists every hidden path; removing one brings the file back with no restart (US8, FR-043)', { tag: ['@extended', '@window'] }, async () => {
  const projectRoot = makeProjectFolder();
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'Demo', projectRoot);
      const tree = win.getByTestId('file-explorer-tree');
      await expect(tree).toBeVisible();

      await hide(win, 'a.txt');
      await hide(win, 'b.txt');
      await hide(win, 'c.txt');

      await openSettings(win);
      const rows = win.getByTestId('project-settings-dialog').locator('.hidden-path');
      await expect(rows).toHaveCount(3);
      await expect(rows.filter({ hasText: 'a.txt' })).toBeVisible();
      await expect(rows.filter({ hasText: 'b.txt' })).toBeVisible();
      await expect(rows.filter({ hasText: 'c.txt' })).toBeVisible();

      // Un-hide b.txt → it returns to the tree WITHOUT a restart, and leaves the list.
      await win.getByTestId('hidden-path-remove-b.txt').click();
      await expect(rows).toHaveCount(2);
      await expect(tree.getByText('b.txt', { exact: true })).toBeVisible();
      // The other two stay hidden — a replace-the-whole-list write that dropped them would be silent
      // data loss, and the list is the only record of them.
      await expect(tree.getByText('a.txt', { exact: true })).toHaveCount(0);
      await expect(tree.getByText('c.txt', { exact: true })).toHaveCount(0);
    });
  } finally {
    cleanupTemp(projectRoot);
  }
});

/*
 * MOVED to `packages/ui/tests/component/project-settings-dialog.test.ts` and
 * `packages/ui/tests/component/file-explorer-pane.test.ts` (034 FR-045) — five tests, five launches.
 *
 *   the dialog names the project it edits, and follows a switch (FR-042)
 *   with no project active the options icon is DISABLED and says why (FR-041)
 *   deleting the edited project closes the dialog rather than editing a ghost (FR-046)
 *   a path that is ALSO glob-excluded is marked (FR-047a)
 *   a hidden path whose file was DELETED still lists and still removes
 *
 * What each was paying for is worth stating, because it is the shape of this whole migration: two
 * projects and two temp folders to read a heading; a whole config root and a `settings.json` write
 * to manufacture a glob overlap; an `rmSync` to prove the list renders from the project RECORD and
 * never stats the file. Every one of those is a property of one component and its props.
 *
 * ══ HOW THE STORE WAS FAKED, because the obvious route does not work ══
 *
 * `ProjectsProvider` takes a `client: ProjectsClient`, which is a CLASS with a private field — so a
 * structural stub is not assignable and a plain fake needs a cast. The drafts instead build a REAL
 * `ProjectsClient` over a fake `ThrongBridge`, which is an exported one-method interface. No cast,
 * no production change, and the store’s real refresh-after-mutation path is exercised rather than
 * stubbed out.
 *
 * Red-proved: making the FR-046 auto-close effect unfireable reddens 1; having `unhide` send the one
 * removed path instead of the surviving list reddens 2, as does having it send an empty list; and
 * disabling Escape reddens 1. All anchored on full lines — `onClose` occurs SEVEN times in that file
 * and `activeProject` seven more, so a bare identifier mutation would have hit the wrong one.
 *
 * WHAT STAYS: the ONE test below, which is the only place a hidden path is proved to bring the
 * file BACK into a real tree with no restart — a real project folder, a real explorer, a store
 * write and a daemon round trip.
 *
 * ══ AND THE CLAIM THIS COMMENT USED TO MAKE, WHICH WAS WRONG ══
 *
 * It said the themed-icon test had to stay because it "reads `getComputedStyle` for a themed icon,
 * which needs a real cascade (FR-049)". It never read a computed style: it read a `title` attribute
 * and counted `.icon` children. And it said the ENABLED options control was out of reach because
 * `FileExplorerPane` mounts `FileTree`, which calls `useWorkspace`, "a context that throws and is
 * not exported" — but `WorkspaceProvider` IS exported and takes its client as a prop; only
 * `WorkspaceContext` is private, and nothing needs it. `file-tree.test.ts` had already mounted that
 * whole stack. Both halves therefore came down to
 * `packages/ui/tests/component/file-explorer-pane.test.ts`:
 *
 *   is ENABLED once a project is open, and the two states differ
 *   NAMES the project in its hover title      (STRONGER: the E2E accepted any title at all, which
 *                                              the no-project title would also have satisfied)
 *   is a themed icon and never a word (FR-043a)
 *   opens the project settings dialog when it is clicked   (NEW — the E2E never clicked it, and a
 *                                              titled, themed, enabled control that opens nothing
 *                                              is exactly as broken as a missing one)
 *
 * Anti-vacuity control for that file: withhold `ProjectsProvider` and `useProjects` throws, failing
 * all 12 tests; drop the `ResizeObserver` stub and `findByRole('tree')` fails the 4 above.
 */

