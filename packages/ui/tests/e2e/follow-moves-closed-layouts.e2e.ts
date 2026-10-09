/**
 * 052 US1/US2 — an in-app move reaches layouts NO WINDOW SHOWS: a closed sub-workspace, an inactive project, a
 * tab not shown since launch (FR-001 – FR-003, FR-005, FR-007, FR-008, SC-001, SC-002, #397).
 *
 * This is MT-06 and MT-07 of the branch's manual test plan, automated at the maintainer's request.
 * subworkspace-rename-follow.e2e.ts already holds MT-06 steps 1–3 (one rename reaching a closed sub-workspace);
 * this file adds what that one does not: two renames and an undo, the navigation history the record carries, a
 * sub-workspace edited while another is closed, a preview whose file is cut into another project while its own
 * project is inactive, and a tab never shown since launch.
 *
 * Layer: E2E, @reserve:window. The daemon's rewrite is pinned in
 * daemon/tests/integration/workspace-follow-moves.integration.test.ts and each move route's walk in
 * ui/tests/integration/in-app-moves-follow-layouts.integration.test.ts; neither composes a window that has really
 * closed, a real second renderer reopening from the rewritten record, or an application restart restoring a tab
 * the user has not yet visited.
 *
 * Own app per test: each seeds a sub-workspace record, a data folder or a project root before it needs it.
 */
import { mkdirSync, mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import {
  runApp,
  createProject,
  daemonRpc,
  reloadWindow,
  cleanupTemp,
  settle,
  switchProject,
  firstPanelId,
  focusEditor,
  commitTabRename,
  FILE_OP_TIMEOUT_MS,
} from './harness.js';
import { openQuickOpen, quickOpenRows, chooseQuickOpenRow } from './helpers/navigation.js';

const BODY = 'FOLLOW-CLOSED-BODY';
const OTHER = 'OTHER-FILE-BODY';

// ── Sub-workspace plumbing (the shape subworkspace-rename-follow.e2e.ts established) ───────────────────────────────

interface SubSeed {
  id: string;
  panel: string;
}

/** Persist sub-workspace records owned by the project — held by no window until opened. */
const seedSubs = (originProjectId: string, subs: readonly SubSeed[]): string =>
  `(() => window.throng.invoke('workspace.persistSubWorkspaces', { subWorkspaces: ${JSON.stringify(
    subs.map((s) => ({
      id: s.id,
      ownerUser: 'u',
      name: s.id,
      colour: '#3fb950',
      bounds: { x: 0, y: 0, width: 700, height: 560 },
      tabs: [{ id: `t-${s.id}`, title: 'T', root: { type: 'panel', id: s.panel, originProjectId, title: 'P' } }],
    })),
  )} }))()`;

async function swRecord(pipeName: string, id: string): Promise<string> {
  const loaded = (await daemonRpc(pipeName, 'workspace.loadSubWorkspaces', {})) as {
    subWorkspaces?: Array<{ id: string }>;
  } | null;
  return JSON.stringify(loaded?.subWorkspaces?.find((s) => s.id === id) ?? null);
}

async function openSub(app: ElectronApplication, win: Page, id: string): Promise<Page> {
  const [child] = await Promise.all([app.waitForEvent('window'), win.getByTestId(`subworkspace-open-${id}`).click()]);
  await child.waitForLoadState('domcontentloaded');
  await settle(child);
  return child;
}

async function closeSub(app: ElectronApplication, child: Page, id: string): Promise<void> {
  const closed = child.waitForEvent('close');
  await app.evaluate(({ BrowserWindow }, urlMatch) => {
    BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes(urlMatch))?.close();
  }, `sw=${id}`);
  await closed;
}

/** A project on `root`, with the given sub-workspaces seeded and the window back on the project. */
async function projectWithSubs(win: Page, name: string, root: string, subs: readonly SubSeed[]): Promise<void> {
  await settle(win);
  await createProject(win, name, root);
  const projectId = await win
    .locator('.project-item[data-active="true"]')
    .evaluate((el) => (el.getAttribute('data-testid') ?? '').replace('project-item-', ''));
  expect(projectId, 'could not read the project id').not.toBe('');
  await win.evaluate(seedSubs(projectId, subs));
  await reloadWindow(win);
  await switchProject(win, name);
}

/** Make `panel` an editor in `child` and open `file` in it through Quick Open. */
async function openInSub(child: Page, panel: string, file: string, body: string, first: boolean): Promise<void> {
  if (first) {
    await child.getByTestId(`panel-type-select-${panel}`).selectOption('editor');
    await child.getByTestId(`panel-type-confirm-${panel}`).click();
    await expect(child.getByTestId(`editor-${panel}`)).toBeVisible();
  }
  await child.getByTestId(`editor-${panel}`).click();
  await openQuickOpen(child);
  await child.getByTestId('quickopen-input').fill(file);
  await expect(quickOpenRows(child)).toHaveCount(1);
  await chooseQuickOpenRow(child, 0);
  await expect(child.getByTestId(`editor-${panel}`).locator('.cm-content')).toContainText(body, { timeout: 10_000 });
}

const tree = (win: Page) => win.getByTestId('file-explorer-tree');

async function renameInTree(win: Page, from: string, to: string): Promise<void> {
  await win.bringToFront();
  await tree(win).getByText(from, { exact: true }).click({ button: 'right' });
  await win.getByTestId('menu-item-Rename').click();
  const input = win.locator('.tree-rename');
  await expect(input).toBeVisible();
  await input.fill(to);
  await input.press('Enter');
  await expect(tree(win).getByText(to, { exact: true })).toBeVisible({ timeout: 8000 });
}

/** Negative: nothing reported a renamed file as missing or unreadable, in this window. */
async function expectNoMissingReport(page: Page, panel?: string): Promise<void> {
  if (panel !== undefined) await expect(page.getByTestId(`panel-failure-${panel}`)).toHaveCount(0);
  await expect(page.getByText(/could not be read/i)).toHaveCount(0);
  await expect(page.getByText(/couldn.t open/i)).toHaveCount(0);
}

// ── MT-06 steps 5 and 6 ────────────────────────────────────────────────────────────────────────────────────────────

test('two renames and an undo reach a closed sub-workspace, which reopens on the restored name (FR-001, FR-002)', { tag: ['@extended', '@persistence', '@reserve:window'] }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'throng-closed-undo-'));
  writeFileSync(join(root, 'a.md'), `${BODY}\n`);
  const PANEL = 'swundo';
  try {
    await runApp(async (app, win, { pipeName }) => {
      await projectWithSubs(win, 'ClosedUndo', root, [{ id: 'sw1', panel: PANEL }]);
      let child = await openSub(app, win, 'sw1');
      await openInSub(child, PANEL, 'a.md', BODY, true);
      await expect.poll(() => swRecord(pipeName, 'sw1'), { timeout: 10_000 }).toContain('a.md');
      await closeSub(app, child, 'sw1');

      await renameInTree(win, 'a.md', 'b.md');
      await expect.poll(() => swRecord(pipeName, 'sw1'), { timeout: 10_000 }).toContain('b.md');
      await renameInTree(win, 'b.md', 'c.md');
      await expect.poll(() => swRecord(pipeName, 'sw1'), { timeout: 10_000 }).toContain('c.md');

      // Step 6: undo the last rename from the File Explorer — c.md is b.md again, and the closed record follows.
      await tree(win).getByRole('treeitem').first().click();
      await win.keyboard.press('Control+z');
      await expect.poll(() => existsSync(join(root, 'b.md')), { timeout: FILE_OP_TIMEOUT_MS }).toBe(true);
      await expect.poll(() => swRecord(pipeName, 'sw1'), { timeout: 10_000 }).not.toContain('c.md');

      child = await openSub(app, win, 'sw1');
      await expect(child.getByTestId(`panel-title-${PANEL}`)).toHaveText('b', { timeout: 10_000 });
      await expect(child.getByTestId(`editor-${PANEL}`).locator('.cm-content')).toContainText(BODY, { timeout: 10_000 });
      await expect(child.getByTestId(`panel-unsaved-${PANEL}`)).toHaveCount(0);
      await expectNoMissingReport(child, PANEL);
      await expectNoMissingReport(win);
    });
  } finally {
    cleanupTemp(root);
  }
});

test('a closed sub-workspace’s navigation history follows two renames: Back never leads to an old name (FR-003)', { tag: ['@extended', '@persistence', '@reserve:window'] }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'throng-closed-history-'));
  writeFileSync(join(root, 'a.md'), `${BODY}\n`);
  writeFileSync(join(root, 'other.md'), `${OTHER}\n`);
  const PANEL = 'swhist';
  try {
    await runApp(async (app, win, { pipeName }) => {
      await projectWithSubs(win, 'ClosedHistory', root, [{ id: 'sw1', panel: PANEL }]);
      let child = await openSub(app, win, 'sw1');
      // History: a.md, then other.md — so a.md is the entry Back returns to.
      await openInSub(child, PANEL, 'a.md', BODY, true);
      await openInSub(child, PANEL, 'other.md', OTHER, false);
      await expect.poll(() => swRecord(pipeName, 'sw1'), { timeout: 10_000 }).toContain('other.md');
      await closeSub(app, child, 'sw1');

      await renameInTree(win, 'a.md', 'b.md');
      await renameInTree(win, 'b.md', 'c.md');
      await expect.poll(() => swRecord(pipeName, 'sw1'), { timeout: 10_000 }).toContain('c.md');
      expect(await swRecord(pipeName, 'sw1')).not.toMatch(/[\\/]a\.md|[\\/]b\.md/);

      child = await openSub(app, win, 'sw1');
      await expect(child.getByTestId(`panel-title-${PANEL}`)).toHaveText('other', { timeout: 10_000 });
      await focusEditor(child, PANEL);
      await child.keyboard.press('Alt+ArrowLeft');
      await expect(child.getByTestId(`panel-title-${PANEL}`)).toHaveText('c', { timeout: 10_000 });
      await expect(child.getByTestId(`editor-${PANEL}`).locator('.cm-content')).toContainText(BODY, { timeout: 10_000 });
      await expectNoMissingReport(child, PANEL);
    });
  } finally {
    cleanupTemp(root);
  }
});

test('a sub-workspace edited while another is closed keeps its edits through a rename (FR-001, negative)', { tag: ['@extended', '@persistence', '@reserve:window'] }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'throng-closed-edited-'));
  writeFileSync(join(root, 'a.md'), `${BODY}\n`);
  try {
    await runApp(async (app, win, { pipeName }) => {
      await projectWithSubs(win, 'ClosedEdited', root, [
        { id: 'sw1', panel: 'swone' },
        { id: 'sw2', panel: 'swtwo' },
      ]);
      // sw1 holds the editor on a.md, and is closed.
      const one = await openSub(app, win, 'sw1');
      await openInSub(one, 'swone', 'a.md', BODY, true);
      await expect.poll(() => swRecord(pipeName, 'sw1'), { timeout: 10_000 }).toContain('a.md');
      await closeSub(app, one, 'sw1');

      // sw2 is open and edited — split into two panels — while sw1 is closed.
      let two = await openSub(app, win, 'sw2');
      await two.getByTestId('panel-add-swtwo').click();
      await two.getByTestId('menu-item-Split Right').click();
      await expect(two.locator('.panel-box')).toHaveCount(2);
      await expect
        .poll(async () => (await swRecord(pipeName, 'sw2')).split('"type":"panel"').length - 1, { timeout: 10_000 })
        .toBe(2);

      await renameInTree(win, 'a.md', 'b.md');
      await expect.poll(() => swRecord(pipeName, 'sw1'), { timeout: 10_000 }).toContain('b.md');

      // sw2 keeps its split: the walk rewrote only the record it had to.
      await closeSub(app, two, 'sw2');
      two = await openSub(app, win, 'sw2');
      await expect(two.locator('.panel-box')).toHaveCount(2, { timeout: 10_000 });
      const reopened = await openSub(app, win, 'sw1');
      await expect(reopened.getByTestId('panel-title-swone')).toHaveText('b', { timeout: 10_000 });
      await expectNoMissingReport(reopened, 'swone');
    });
  } finally {
    cleanupTemp(root);
  }
});

// ── MT-06 step 4 ───────────────────────────────────────────────────────────────────────────────────────────────────

test('a preview in an inactive project whose file is cut into another project says it moved there (FR-008, 050 FR-035)', { tag: ['@extended', '@editor', '@reserve:window'] }, async () => {
  const rootP = mkdtempSync(join(tmpdir(), 'throng-xp-preview-p-'));
  const rootQ = mkdtempSync(join(tmpdir(), 'throng-xp-preview-q-'));
  mkdirSync(join(rootP, 'inbox'));
  mkdirSync(join(rootQ, 'docs'));
  writeFileSync(join(rootQ, 'docs', 'x.md'), '# Moving preview\n\nPREVIEW-BODY\n');
  try {
    await runApp(async (_app, win) => {
      await settle(win);
      await createProject(win, 'PreviewP', rootP);
      await createProject(win, 'PreviewQ', rootQ);

      // In Q: a standalone preview of docs/x.md.
      await tree(win).getByTestId('tree-twisty-docs').click();
      await tree(win).getByText('x.md', { exact: true }).click({ button: 'right' });
      await win.getByTestId('menu-item-Open In').click();
      await win.getByTestId('menu-item-New Preview Panel').click();
      const preview = win.locator('[data-testid^="preview-markdown-"]');
      await expect(preview).toContainText('PREVIEW-BODY', { timeout: 10_000 });
      const panelId = await preview.evaluate((el) => el.closest('[data-panel-id]')?.getAttribute('data-panel-id') ?? '');

      // Cut it in Q, switch to P (Q stays loaded, inactive), paste into P.
      await tree(win).getByText('x.md', { exact: true }).click({ button: 'right' });
      await win.getByRole('menuitem', { name: /^Cut \(/ }).click();
      await switchProject(win, 'PreviewP');
      await tree(win).getByText('inbox', { exact: true }).click({ button: 'right' });
      await win.getByRole('menuitem', { name: /^Paste / }).click();
      await expect.poll(() => existsSync(join(rootP, 'inbox', 'x.md')), { timeout: FILE_OP_TIMEOUT_MS }).toBe(true);

      // Back in Q: the preview says where its file went, not that it could not read it.
      await switchProject(win, 'PreviewQ');
      const banner = panelId ? win.getByTestId(`panel-failure-${panelId}`) : win.locator('[data-testid^="panel-failure-"]');
      await expect(banner).toContainText('This file moved to another project', { timeout: FILE_OP_TIMEOUT_MS });
      await expect(banner).toContainText('inbox');
      await expectNoMissingReport(win);
    });
  } finally {
    cleanupTemp(rootP);
    cleanupTemp(rootQ);
  }
});

// ── MT-07 ──────────────────────────────────────────────────────────────────────────────────────────────────────────

const norm = (p: string): string => p.replace(/\\/g, '/').toLowerCase();

/** Wait until `project`'s persisted layout names `path` (by identity, any separator). */
async function expectLayoutHasPath(dataDir: string, project: string, path: string): Promise<void> {
  await expect
    .poll(
      () => {
        let db: InstanceType<typeof Database> | undefined;
        try {
          db = new Database(join(dataDir, 'throng.db'), { readonly: true });
          const row = db
            .prepare(
              `SELECT w.layout_json AS json FROM workspace_layout w JOIN projects p ON p.id = w.project_id WHERE p.name = ?`,
            )
            .get(project) as { json?: string } | undefined;
          return norm(row?.json ?? '').replace(/\/\//g, '/').includes(norm(path));
        } catch {
          return false;
        } finally {
          db?.close();
        }
      },
      { timeout: 15_000, message: `the layout for "${project}" never named ${path}` },
    )
    .toBe(true);
}

test('a tab not shown since launch follows a rename across a restart (FR-007, FR-005)', { tag: ['@extended', '@editor', '@reserve:window'] }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'throng-unshown-tab-'));
  writeFileSync(join(root, 'a.md'), `${BODY}\n`);
  const dataDir = mkdtempSync(join(tmpdir(), 'throng-unshown-tab-data-'));
  const userDataDir = mkdtempSync(join(tmpdir(), 'throng-unshown-tab-ud-'));
  const session = { dataDir, userDataDir };
  try {
    // Session 1: an editor on a.md in a second tab T2; T1 left showing.
    await runApp(async (_app, win) => {
      await settle(win);
      await createProject(win, 'Unshown', root);
      await win.getByTestId('tab-add').click();
      await commitTabRename(win);
      const pid = await firstPanelId(win);
      await win.getByTestId(`panel-type-select-${pid}`).selectOption('editor');
      await win.getByTestId(`panel-type-confirm-${pid}`).click();
      await win.getByTestId(`editor-${pid}`).click();
      await tree(win).getByText('a.md', { exact: true }).click();
      await expect(win.getByTestId(`editor-${pid}`).locator('.cm-content')).toContainText(BODY, { timeout: 10_000 });
      await win.locator('.tab-chip').first().click();
      await expect(win.getByTestId(`editor-${pid}`)).toHaveCount(0);
      await expectLayoutHasPath(dataDir, 'Unshown', join(root, 'a.md'));
    }, session);

    // Session 2: launched on T1; without visiting T2, rename a.md → b.md.
    await runApp(async (_app, win) => {
      await switchProject(win, 'Unshown');
      await expect(win.locator('.editor-panel')).toHaveCount(0);
      await renameInTree(win, 'a.md', 'b.md');
      await expectLayoutHasPath(dataDir, 'Unshown', join(root, 'b.md'));
    }, session);

    // Session 3: open T2 — its editor is on b.md, clean, with no could-not-read banner.
    await runApp(async (_app, win) => {
      await switchProject(win, 'Unshown');
      await win.locator('.tab-chip').nth(1).click();
      const editor = win.locator('.editor-panel').first();
      await expect(editor).toBeVisible({ timeout: 10_000 });
      await expect(editor.locator('.cm-content')).toContainText(BODY, { timeout: 10_000 });
      await expect(win.locator('[data-testid^="panel-file-"]').first()).toContainText('b.md');
      await expect(win.locator('.throng-unsaved-dot')).toHaveCount(0);
      await expect(win.locator('[data-testid^="panel-failure-"]')).toHaveCount(0);
      await expectNoMissingReport(win);
    }, session);
  } finally {
    cleanupTemp(root);
    cleanupTemp(dataDir);
    cleanupTemp(userDataDir);
  }
});
