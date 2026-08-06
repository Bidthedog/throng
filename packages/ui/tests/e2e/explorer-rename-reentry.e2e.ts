import { mkdtempSync, mkdirSync, writeFileSync, existsSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import {
  openApp,
  createProject as newProject,
  reloadWindow,
  cleanupTemp,
  type AppOptions,
  type OpenApp,
} from './harness.js';

/*
 * ONE app for this file, not one per test.
 *
 * Each test used to launch its own Electron app, daemon and window — roughly two seconds apiece, and
 * 604 such launches across the suite — to run assertions that never needed a pristine app. Only a
 * test that seeds state BEFORE launch genuinely does, and those keep their own app via `runOwnApp`.
 *
 * The shims below exist so the test bodies below are unchanged:
 *   runApp        runs the body against the shared window. It refuses options rather than ignoring
 *                 them: a dropped config root does not fail, it passes for the wrong reason.
 *   createProject appends a counter, because a shared app accumulates projects and duplicate names
 *                 make `.project-item` ambiguous.
 *
 * Serial mode is required — shared window, shared database — and it means a failure skips the rest
 * rather than running them against whatever state the failure left behind.
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
  fn: (app: OpenApp['app'], win: OpenApp['win'], ctx: { pipeName: string; userDataDir: string }) => Promise<void>,
  opts?: AppOptions,
): Promise<void> => {
  if (opts) {
    throw new Error(
      'this file shares one app; a test needing launch options must call runOwnApp instead',
    );
  }
  return fn(shared.app, shared.win, {
    pipeName: shared.pipeName,
    userDataDir: shared.userDataDir,
  });
};

let projectSeq = 0;
const createProject = (win: OpenApp['win'], name: string, root: string): Promise<void> =>
  newProject(win, `${name}-${(projectSeq += 1)}`, root);


/**
 * 026 / #197 — re-entering a project after a folder rename must not error on the folder's OLD path.
 *
 * THE TRIGGER, pinned. The explorer persists `{ expanded, selectedId }` per project in
 * localStorage, keyed by relPath (`use-explorer-data.ts`), and on project entry it fetches EVERY
 * persisted-expanded path to seed react-arborist's `initialOpenState`. A failed fetch is not
 * treated as a stale restore — `fetchChildren` routes every `files.list` error straight to
 * `fail(res.error, 'list the contents of this folder')`, which is a user-facing notice.
 *
 * `onRename` migrates the SELECTION to the new path (#122's `pendingSelect`) but NOT the open
 * state. Compare `drop`, which migrates every open descendant by prefix into `pendingOpen` and
 * re-persists the instant it applies (#120's "Finding 5"). A rename has no equivalent — so an
 * expanded folder that is renamed leaves its OLD relPath sitting in the persisted `expanded` array,
 * and the next entry into that project lists a path that no longer exists.
 *
 * That also explains the reporter's "often, not always": it needs the folder to have been EXPANDED
 * at some point, which is what puts its path in the persisted set.
 *
 * MEASURED ON MASTER — the defect lands in two different places, and a fix has to close both:
 *
 *   - An IN-APP rename loses the expansion SILENTLY. No error appears, because `#122`'s
 *     re-selection drains through `onSelect → persist`, which re-snapshots the open state from
 *     react-arborist — where the renamed folder is no longer open — and so writes the stale entry
 *     out of localStorage before it can ever be restored. The user gets no message and no
 *     expansion. (Tests 1 and 2 fail on `note.txt` never reappearing.)
 *
 *   - An EXTERNAL rename, made while the project was closed, produces the reported ERROR NOTICE.
 *     Nothing re-persisted, so the old path is still in the set and is listed on re-entry.
 *     (Test 3 fails on `explorer-error` being present.)
 *
 * Every case asserts both outcomes regardless of which one currently fires, because the acceptance
 * criteria require both: no user-facing error, AND expansion intact at the new path.
 *
 * RED on master.
 */

function makeProject(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  mkdirSync(join(root, 'Docs'));
  writeFileSync(join(root, 'Docs', 'note.txt'), 'note\n');
  writeFileSync(join(root, 'top.txt'), 'top\n');
  return root;
}

/**
 * Switch to a project by name. A project row shows its ROOT PATH as well as its name, and
 * `hasText` is a substring match — so temp-dir prefixes here are deliberately unrelated to the
 * project names, and the switch goes through the row's own switch control rather than the row.
 */
async function switchToProject(win: Page, name: string): Promise<void> {
  await win
    .locator('.project-item', { hasText: name })
    .locator('[data-testid^="project-switch-"]')
    .click();
}

/** Expand `Docs`, then rename it to `Documents` from the tree and confirm it landed on disk. */
async function expandAndRename(win: Page, root: string): Promise<void> {
  const tree = win.getByTestId('file-explorer-tree');
  await expect(tree).toBeVisible();

  // Expand — this is what writes the folder's path into the persisted `expanded` set.
  await tree.getByText('Docs', { exact: true }).dblclick();
  await expect(tree.getByText('note.txt', { exact: true })).toBeVisible({ timeout: 10_000 });

  await tree.getByText('Docs', { exact: true }).click();
  await win.keyboard.press('F2');
  const input = tree.locator('input.tree-rename');
  await expect(input).toBeVisible();
  await input.fill('Documents');
  await input.press('Enter');

  await expect(tree.getByText('Documents', { exact: true })).toBeVisible({ timeout: 10_000 });
  await expect.poll(() => existsSync(join(root, 'Documents')), { timeout: 8000 }).toBe(true);
  expect(existsSync(join(root, 'Docs'))).toBe(false);
}

/** No stale-restore error reached the user, and the renamed folder came back expanded. */
async function expectCleanRestore(win: Page): Promise<void> {
  const tree = win.getByTestId('file-explorer-tree');
  await expect(tree.getByText('Documents', { exact: true })).toBeVisible({ timeout: 15_000 });

  // A restore against a path that no longer exists is not the user's problem, and must never
  // become a notice — least of all one naming a folder they renamed on purpose.
  await expect(win.getByTestId('explorer-error')).toHaveCount(0);

  // The expansion followed the rename, exactly as it follows a move (#120).
  await expect(tree.getByText('note.txt', { exact: true })).toBeVisible({ timeout: 10_000 });
}

test('renaming an expanded folder, switching project and returning restores cleanly', async () => {
  const root = makeProject('throng-rr-a-');
  const other = mkdtempSync(join(tmpdir(), 'throng-rr-b-'));
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'Reentry', root);
      await expandAndRename(win, root);

      // Leave the project, then come back to it.
      await createProject(win, 'Elsewhere', other);
      await expect(win.getByTestId('file-explorer-tree')).toBeVisible();
      await switchToProject(win, 'Reentry');

      await expectCleanRestore(win);
    });
  } finally {
    for (const dir of [root, other]) {
      cleanupTemp(dir);
    }
  }
});

test('renaming an expanded folder and restarting restores cleanly', async () => {
  // The second route in the report — "or close and reopen throng". The persisted explorer state
  // lives in the renderer's localStorage, so a reload is the faithful in-harness equivalent.
  const root = makeProject('throng-rr-restart-');
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'Restarter', root);
      await expandAndRename(win, root);

      await reloadWindow(win);
      await switchToProject(win, 'Restarter');
      await expectCleanRestore(win);
    });
  } finally {
    cleanupTemp(root);
  }
});

test('a folder renamed OUTSIDE throng while the project was closed restores silently', async () => {
  // The same stale-restore path, reached without any in-app rename to migrate: throng cannot have
  // updated anything, so this is purely about a restore that fails being silent rather than loud.
  const root = makeProject('throng-rr-x-');
  const other = mkdtempSync(join(tmpdir(), 'throng-rr-y-'));
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'Externally', root);
      const tree = win.getByTestId('file-explorer-tree');
      await expect(tree).toBeVisible();
      await tree.getByText('Docs', { exact: true }).dblclick();
      await expect(tree.getByText('note.txt', { exact: true })).toBeVisible({ timeout: 10_000 });

      // Leave the project, rename the folder from outside, and come back.
      await createProject(win, 'Away', other);
      await expect(win.getByTestId('file-explorer-tree')).toBeVisible();
      renameSync(join(root, 'Docs'), join(root, 'Archive'));
      await switchToProject(win, 'Externally');

      await expect(tree.getByText('Archive', { exact: true })).toBeVisible({ timeout: 15_000 });
      await expect(win.getByTestId('explorer-error')).toHaveCount(0);
    });
  } finally {
    for (const dir of [root, other]) {
      cleanupTemp(dir);
    }
  }
});
