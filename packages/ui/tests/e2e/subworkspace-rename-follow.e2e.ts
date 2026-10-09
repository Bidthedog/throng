import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import { runApp as runOwnApp, createProject, daemonRpc, reloadWindow, cleanupTemp, geom, settle, switchProject } from './harness.js';
import { openQuickOpen, quickOpenRows, chooseQuickOpenRow } from './helpers/navigation.js';

/*
 * 052 US1 · T011 — a rename reaches the layout of a sub-workspace NO WINDOW HOLDS.
 *
 * An editor on `a.md` lives in a sub-workspace, that sub-workspace's window is closed, and `a.md` is renamed to
 * `b.md` in the main window's File Explorer. Reopening the sub-workspace must show the editor on `b.md`, clean,
 * with no "could not be read" notice (#397 was exactly that notice).
 *
 * WHY E2E. The rule is proven lower: the daemon's single-transaction rewrite in
 * `packages/daemon/tests/integration/workspace-follow-moves.integration.test.ts`, and each in-app move route
 * issuing one `workspace.followMoves` in `packages/ui/tests/integration/in-app-moves-follow-layouts.integration.test.ts`.
 * Neither composes main.ts's `layouts.followMoves` wiring with a real window manager deciding what is HELD (a
 * sub-workspace window that has really closed) and a real second renderer reopening from the record the daemon
 * rewrote. That composition is window lifecycle — `@reserve:window`.
 *
 * WHY THE EDITOR IS NOT SYNCED FROM THE MAIN WINDOW. A synced panel is a MIRROR: the main window keeps the same
 * panel id live, main's editor coordinator keeps that panel's document and re-points it on the move, and the
 * reopened window adopts that document whatever its record says. Measured: with `layouts.followMoves` removed
 * from main.ts, the synced version of this test still passed. So the panel is seeded into the sub-workspace
 * alone — owned by the project, held by no window but the sub-workspace's — and the file is opened in it there.
 *
 * OWN APP: the project root is seeded with `a.md` before launch, and a sub-workspace record is persisted.
 */

const BODY = 'FOLLOW-BODY-052';
const SW_URL = 'sw=sw1';
const PANEL = 'swfollow';

const seedSub = (originProjectId: string): string =>
  `(() => window.throng.invoke('workspace.persistSubWorkspaces', { subWorkspaces: [
     { id: 'sw1', ownerUser: 'u', name: 'Follow', colour: '#3fb950',
       bounds: { x: 0, y: 0, width: 700, height: 560 },
       tabs: [{ id: 't', title: 'T', root: { type: 'panel', id: '${PANEL}',
         originProjectId: ${JSON.stringify(originProjectId)}, title: 'P' } }] },
   ] }))()`;

/**
 * sw1's persisted record as text, asked of the daemon directly — the process that owns it (see
 * subworkspaces.e2e.ts on why not through a renderer's `invoke`). Text, because the claim is only which path the
 * record names, wherever in the panel's config and history it sits.
 */
async function swRecord(pipeName: string): Promise<string> {
  const loaded = (await daemonRpc(pipeName, 'workspace.loadSubWorkspaces', {})) as {
    subWorkspaces?: Array<{ id: string }>;
  } | null;
  return JSON.stringify(loaded?.subWorkspaces?.find((s) => s.id === 'sw1') ?? null);
}

async function openSub(app: ElectronApplication, win: Page): Promise<Page> {
  const [child] = await Promise.all([app.waitForEvent('window'), win.getByTestId('subworkspace-open-sw1').click()]);
  await child.waitForLoadState('domcontentloaded');
  await settle(child);
  return child;
}

test('a rename in the main window reaches a closed sub-workspace, which reopens on the new name', { tag: ['@extended', '@persistence', '@reserve:window'] }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'throng-swfollow-'));
  writeFileSync(join(root, 'a.md'), `${BODY}\n`);
  try {
    await runOwnApp(async (app, win, { pipeName }) => {
      await settle(win);
      await createProject(win, 'FollowProj', root);
      const projectId = await win
        .locator('.project-item[data-active="true"]')
        .evaluate((el) => (el.getAttribute('data-testid') ?? '').replace('project-item-', ''));
      expect(projectId, 'could not read the project id').not.toBe('');

      await win.evaluate(seedSub(projectId));
      await reloadWindow(win);
      // A reloaded window comes up with no project selected (see quick-open.e2e.ts) — re-enter it.
      await switchProject(win, 'FollowProj');
      const tree = win.getByTestId('file-explorer-tree');
      await expect(tree.getByText('a.md', { exact: true })).toBeVisible({ timeout: 8000 });

      // In the sub-workspace window: make its panel an editor and open a.md in it.
      let child = await openSub(app, win);
      await child.getByTestId(`panel-type-select-${PANEL}`).selectOption('editor');
      await child.getByTestId(`panel-type-confirm-${PANEL}`).click();
      const childEditor = (): ReturnType<Page['getByTestId']> => child.getByTestId(`editor-${PANEL}`);
      await expect(childEditor()).toBeVisible();
      await openQuickOpen(child);
      await child.getByTestId('quickopen-input').fill('a.md');
      await expect(quickOpenRows(child)).toHaveCount(1);
      await chooseQuickOpenRow(child, 0);
      await expect(childEditor().locator('.cm-content')).toContainText(BODY, { timeout: 10000 });
      await expect(child.getByTestId(`panel-title-${PANEL}`)).toHaveText('a', { timeout: 10000 });
      await geom(childEditor());
      // The window's own save is debounced: closing before it lands would reopen an untyped panel, and the test
      // would be about that rather than the move. Wait for the record to name a.md.
      await expect
        .poll(() => swRecord(pipeName), { timeout: 10_000, message: 'sw1 never persisted its editor on a.md' })
        .toContain('a.md');

      // CLOSE the sub-workspace window — its record is now held by no window.
      const closed = child.waitForEvent('close');
      await app.evaluate(({ BrowserWindow }, urlMatch) => {
        BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes(urlMatch))?.close();
      }, SW_URL);
      await closed;
      await expect
        .poll(() =>
          app.evaluate(
            ({ BrowserWindow }, urlMatch) =>
              BrowserWindow.getAllWindows().filter(
                (w) => !w.isDestroyed() && !w.webContents.isDestroyed() && w.webContents.getURL().includes(urlMatch),
              ).length,
            SW_URL,
          ),
        )
        .toBe(0);

      // Rename a.md → b.md in the main window's File Explorer.
      await win.bringToFront();
      await tree.getByText('a.md', { exact: true }).click({ button: 'right' });
      await win.getByTestId('menu-item-Rename').click();
      const input = win.locator('.tree-rename');
      await expect(input).toBeVisible();
      await input.fill('b.md');
      await input.press('Enter');
      await expect(tree.getByText('b.md', { exact: true })).toBeVisible({ timeout: 8000 });
      // The walk is fire-and-forget after the move (FR-009), so fence the reopen on its write landing — this is
      // the stale path's first observable: without main.ts's `layouts.followMoves` the record keeps a.md.
      await expect
        .poll(() => swRecord(pipeName), { timeout: 10_000, message: 'the closed sub-workspace’s record never followed the rename' })
        .toContain('b.md');

      // REOPEN the sub-workspace: the editor is on b.md, clean, with no failure notice.
      child = await openSub(app, win);
      await expect(childEditor()).toBeVisible({ timeout: 10000 });
      await expect(child.getByTestId(`panel-title-${PANEL}`)).toHaveText('b', { timeout: 10000 });
      await expect(childEditor().locator('.cm-content')).toContainText(BODY, { timeout: 10000 });
      await geom(childEditor());
      await expect(child.getByTestId(`panel-unsaved-${PANEL}`)).toHaveCount(0);
      await expect(child.getByTestId(`panel-failure-${PANEL}`)).toHaveCount(0);
      await expect(child.getByText(/could not be read/i)).toHaveCount(0);
    });
  } finally {
    cleanupTemp(root);
  }
});
