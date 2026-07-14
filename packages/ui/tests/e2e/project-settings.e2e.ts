import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { createProject, runApp } from './harness.js';

/** The projects list row for `name` — the sidebar has no per-project test id, only a class + text. */
function projectItem(win: import('@playwright/test').Page, name: string) {
  return win.locator('.project-item', { hasText: name });
}

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

test('lists every hidden path; removing one brings the file back with no restart (US8, FR-043)', async () => {
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
    rmSync(projectRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test('the dialog NAMES the project it edits, and follows a project switch (US8, FR-042)', async () => {
  const first = makeProjectFolder();
  const second = makeProjectFolder();
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'First', first);
      await expect(win.getByTestId('file-explorer-tree')).toBeVisible();
      await hide(win, 'a.txt');

      await createProject(win, 'Second', second);
      await expect(win.getByTestId('file-explorer-tree')).toBeVisible();
      await hide(win, 'c.txt');

      // The dialog must never leave the user guessing WHOSE settings are on screen.
      await openSettings(win);
      const dialog = win.getByTestId('project-settings-dialog');
      await expect(dialog).toContainText('Second');
      const rows = dialog.locator('.hidden-path');
      await expect(rows).toHaveCount(1);
      await expect(rows.first()).toContainText('c.txt');
      await expect(dialog).not.toContainText('a.txt');

      // Switch back → the OTHER project's paths, not a stale render of this one's.
      await win.keyboard.press('Escape');
      await projectItem(win, 'First').locator('.project-item__switch').click();
      await expect(win.getByTestId('file-explorer-tree')).toBeVisible();
      await openSettings(win);
      await expect(dialog).toContainText('First');
      await expect(dialog.locator('.hidden-path')).toHaveCount(1);
      await expect(dialog.locator('.hidden-path').first()).toContainText('a.txt');
    });
  } finally {
    rmSync(first, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    rmSync(second, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test('with no project active the options icon is DISABLED and says why (US8, FR-041)', async () => {
  await runApp(async (_app, win) => {
    // With no project the right pane defaults COLLAPSED — expand it, or there is no header to look at.
    await win.getByTestId('pane-show-right').click();
    await expect(win.getByTestId('file-explorer-empty')).toBeVisible();
    const options = win.getByTestId('project-settings-open');
    await expect(options).toBeVisible();
    await expect(options).toBeDisabled();
    // A control that vanishes teaches the user nothing; one that is visibly unavailable explains itself.
    await expect(options).toHaveAttribute('title', /no project|No project/);
    await expect(win.getByTestId('project-settings-dialog')).toHaveCount(0);
  });
});

test('deleting the edited project closes the dialog rather than editing a ghost (US8, FR-046)', async () => {
  const projectRoot = makeProjectFolder();
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'Doomed', projectRoot);
      await expect(win.getByTestId('file-explorer-tree')).toBeVisible();
      await hide(win, 'a.txt');
      await openSettings(win);

      // Delete the project out from under the open dialog.
      //
      // The dialog is MODAL, so its overlay covers the sidebar and no real pointer can reach the delete
      // button — which is the point: the state change this requirement guards against does not arrive by
      // the user clicking behind the dialog, it arrives from ELSEWHERE (another window mutating the
      // shared projects store, a sub-workspace closing its project). Dispatching the click directly is
      // how the test produces that state change without pretending the overlay is not there.
      await projectItem(win, 'Doomed')
        .locator('[data-testid^="project-delete-"]')
        .dispatchEvent('click');
      // Removal double-confirms (FR-023/024). Wait for the wry second dialog by its TEXT rather than
      // clicking the same test id twice — the outgoing dialog's button lingers in the DOM for a frame,
      // and a click that lands on it does nothing at all.
      await win.getByTestId('confirm-accept').click();
      await expect(win.getByTestId('confirm-dialog')).toContainText('absolutely sure');
      await win.getByTestId('confirm-accept').click();

      // The dialog must not survive as an editor of a project that no longer exists.
      await expect(win.getByTestId('project-settings-dialog')).toHaveCount(0);
      await expect(win.getByTestId('workspace-no-project')).toBeVisible();

      // …and it must not be re-openable onto the ghost either. (Losing its project collapses the right
      // pane back to its no-project default, so expand it again to see the header.)
      const expand = win.getByTestId('pane-show-right');
      if (await expand.isVisible()) await expand.click();
      await expect(win.getByTestId('file-explorer-empty')).toBeVisible();
      await expect(win.getByTestId('project-settings-open')).toBeDisabled();
    });
  } finally {
    rmSync(projectRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test('a path that is ALSO glob-excluded is marked — removing it would do nothing (US8, FR-047a)', async () => {
  const projectRoot = makeProjectFolder();
  const cfgRoot = mkdtempSync(join(tmpdir(), 'throng-cfg-'));
  try {
    await runApp(
      async (_app, win) => {
        await createProject(win, 'Demo', projectRoot);
        const tree = win.getByTestId('file-explorer-tree');
        await expect(tree).toBeVisible();
        await hide(win, 'a.txt');
        await hide(win, 'b.txt');

        // The overlap the way a real user reaches it: the path was hidden, and a global exclusion glob
        // grew to cover it LATER. Now removing it from the hidden list cannot bring it back — the glob
        // filters one stage earlier, at fetch — and a remove button that visibly does nothing is a worse
        // defect than the one this story fixes.
        const file = join(cfgRoot, 'settings.json');
        const settings = JSON.parse(readFileSync(file, 'utf8')) as {
          explorer: { excludeGlobs: string[] };
        };
        settings.explorer.excludeGlobs = [...settings.explorer.excludeGlobs, '**/a.txt'];
        writeFileSync(file, JSON.stringify(settings, null, 2));

        await openSettings(win);
        const dialog = win.getByTestId('project-settings-dialog');
        const overlapped = dialog.locator('.hidden-path').filter({ hasText: 'a.txt' });
        await expect(overlapped).toHaveClass(/hidden-path--also-excluded/);
        await expect(overlapped).toContainText(/exclusion|excluded/i);
        // b.txt is hidden but NOT glob-matched — removing it really will bring it back, so it must not
        // wear the mark.
        await expect(dialog.locator('.hidden-path').filter({ hasText: 'b.txt' })).not.toHaveClass(
          /hidden-path--also-excluded/,
        );

        // And the dialog states that the global exclusions apply at all (FR-047) — the hidden-paths
        // list must never be mistaken for the whole story.
        await expect(dialog.getByTestId('project-settings-globals')).toContainText(/exclusion/i);
      },
      { env: { THRONG_CONFIG_ROOT: cfgRoot } },
    );
  } finally {
    rmSync(projectRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    rmSync(cfgRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test('a hidden path whose file was DELETED still lists and still removes (US8, edge case)', async () => {
  const projectRoot = makeProjectFolder();
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'Demo', projectRoot);
      await expect(win.getByTestId('file-explorer-tree')).toBeVisible();
      await hide(win, 'a.txt');

      // The user hides a build artefact, then cleans. The list names PATHS, not files — a render that
      // stats each one would throw here, which is exactly the case a real user reaches.
      rmSync(join(projectRoot, 'a.txt'), { force: true });

      await openSettings(win);
      const rows = win.getByTestId('project-settings-dialog').locator('.hidden-path');
      await expect(rows).toHaveCount(1);
      await expect(rows.first()).toContainText('a.txt');
      await win.getByTestId('hidden-path-remove-a.txt').click();
      await expect(rows).toHaveCount(0);
    });
  } finally {
    rmSync(projectRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test('every control this story adds is a themed icon with a hover title (US8, FR-043a)', async () => {
  const projectRoot = makeProjectFolder();
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'Demo', projectRoot);
      await expect(win.getByTestId('file-explorer-tree')).toBeVisible();
      await hide(win, 'a.txt');

      // The pane's options control: an icon from the active pack, named on hover.
      const options = win.getByTestId('project-settings-open');
      await expect(options).toHaveAttribute('title', /.+/);
      await expect(options.locator('.icon')).toHaveCount(1);

      await openSettings(win);
      // The per-row remove control is NOT a dialog decision button, so the constitution's exception
      // does not cover it: it must be a themed icon, not the word "Remove".
      const remove = win.getByTestId('hidden-path-remove-a.txt');
      await expect(remove).toHaveAttribute('title', /.+/);
      await expect(remove.locator('.icon')).toHaveCount(1);
      await expect(remove).not.toContainText(/remove/i);
    });
  } finally {
    rmSync(projectRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
