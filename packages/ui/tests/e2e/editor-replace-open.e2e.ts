/**
 * 052 User Story 3 (FR-010, FR-011, FR-013, SC-004, #111) — Replace onto a file that is open, end to end.
 *
 * Two editors are open: one on `note.md` at the project root (A), one on `dest/note.md` (B). A is cut in the File
 * Explorer and pasted into `dest`, and the clash is answered **Replace**. There must then be ONE document for
 * `dest/note.md`, shown by both panels; undo must give each file its own text back; and the link must survive a
 * restart, a rename and the owner's panel closing.
 *
 * Layer: E2E, @reserve:window. Every piece is pinned below this layer — the coordinator's link and relay fan-out in
 * integration/editor-one-buffer.integration.test.ts, the undo in integration/transfer-clash.integration.test.ts,
 * the linked mount in component/editor-linked-panel.test.ts — and none composes them: a real tree gesture and clash
 * prompt driving the transfer engine in main, the coordinator relaying one document to two live renderer panels,
 * a debounced layout save carrying the link, and a second application launch restoring both panels onto it. This is
 * MT-08 of the branch's manual test plan, automated at the maintainer's request; MT-09 (a DIRTY open file: the
 * replaced notice, Save As, Discard, Unload's Save and undo) and MT-10 (the source not open) follow it.
 */
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import {
  runApp,
  createProject,
  firstPanelId,
  panelIds,
  splitPanelViaMenu,
  focusEditor,
  cleanupTemp,
  FILE_OP_TIMEOUT_MS,
} from './harness.js';

const A_BODY = 'AAAA-MOVED-BODY';
const B_BODY = 'BBBB-ORIGINAL-BODY';

/** `note.md` (A) at the root and `dest/note.md` (B): the same name, so pasting A into `dest` clashes. */
function makeProject(tag: string): string {
  const root = mkdtempSync(join(tmpdir(), `throng-replace-${tag}-`));
  mkdirSync(join(root, 'dest'));
  writeFileSync(join(root, 'note.md'), `${A_BODY}\n`);
  writeFileSync(join(root, 'dest', 'note.md'), `${B_BODY}\n`);
  return root;
}

const tree = (win: Page) => win.getByTestId('file-explorer-tree');

/** A file's text, or `''` while it does not exist — a move or its undo passes through that state, and a read that
 * throws ends an `expect.poll` instead of letting it retry. */
const textOf = (path: string): string => (existsSync(path) ? readFileSync(path, 'utf8') : '');
const menuItem = (win: Page, label: string) => win.locator('.context-menu__item', { hasText: label });
const content = (win: Page, pid: string) => win.getByTestId(`editor-${pid}`).locator('.cm-content');

async function toEditor(win: Page, pid: string): Promise<void> {
  await win.getByTestId(`panel-type-select-${pid}`).selectOption('editor');
  await win.getByTestId(`panel-type-confirm-${pid}`).click();
  await expect(win.getByTestId(`editor-${pid}`)).toBeVisible();
}

/**
 * The tree row for a `note.md`. With `dest` expanded the tree lists `dest`, then `dest/note.md`, then the root's
 * `note.md` (folders first), so the first match is B and the second A.
 */
const noteRow = (win: Page, which: 'A' | 'B') =>
  tree(win).getByText('note.md', { exact: true }).nth(which === 'B' ? 0 : 1);

/** Open a tree row into panel `pid` and settle on its text, clean. */
async function openInto(win: Page, pid: string, row: ReturnType<typeof noteRow>, body: string): Promise<void> {
  await win.getByTestId(`editor-${pid}`).click(); // the last-active editor is where the tree opens a file
  await row.click();
  await expect(content(win, pid)).toContainText(body, { timeout: 10_000 });
  await expect(win.getByTestId(`panel-unsaved-${pid}`)).toHaveCount(0);
}

/** Steps 1–2: two editors side by side, A in the first and B in the second. Returns [owner, linked]. */
async function openBoth(win: Page, root: string, project: string): Promise<[string, string]> {
  await createProject(win, project, root);
  const first = await firstPanelId(win);
  await toEditor(win, first);
  await splitPanelViaMenu(win, first, 'right');
  await expect(win.locator('.panel-box')).toHaveCount(2);
  const second = (await panelIds(win)).find((id) => id !== first)!;
  await toEditor(win, second);

  await tree(win).getByTestId('tree-twisty-dest').click(); // expand
  await expect(tree(win).getByText('note.md', { exact: true })).toHaveCount(2);
  await openInto(win, first, noteRow(win, 'A'), A_BODY);
  await openInto(win, second, noteRow(win, 'B'), B_BODY);
  return [first, second];
}

/** Step 2: cut A, paste it into `dest`, answer the clash with Replace — and wait for the move on disk. */
async function replaceAOntoB(win: Page, root: string): Promise<void> {
  await noteRow(win, 'A').click({ button: 'right' });
  await menuItem(win, 'Cut').click();
  await tree(win).getByText('dest', { exact: true }).click({ button: 'right' });
  await menuItem(win, 'Paste').click();
  await win.getByTestId('clash-replace').click();
  await expect.poll(() => existsSync(join(root, 'note.md')), { timeout: FILE_OP_TIMEOUT_MS }).toBe(false);
  await expect
    .poll(() => textOf(join(root, 'dest', 'note.md')), { timeout: FILE_OP_TIMEOUT_MS })
    .toContain(A_BODY);
}

/** Step 3: both panels show A's text, and typing in either reaches the other at once. */
async function expectShared(win: Page, owner: string, linked: string, token: string): Promise<void> {
  await expect(content(win, owner)).toContainText(A_BODY, { timeout: FILE_OP_TIMEOUT_MS });
  await expect(content(win, linked)).toContainText(A_BODY, { timeout: FILE_OP_TIMEOUT_MS });
  await expect(content(win, linked)).not.toContainText(B_BODY);
  await focusEditor(win, linked);
  await win.keyboard.press('Control+End');
  await win.keyboard.type(token);
  await expect(content(win, owner)).toContainText(token, { timeout: 10_000 });
}

/** Negative: nothing reported a file it could not open. */
async function expectNoOpenFailure(win: Page): Promise<void> {
  await expect(win.getByTestId('panel-failure-notice')).toHaveCount(0);
  const dialog = win.getByTestId('editor-notice-dialog');
  const said = (await dialog.count()) > 0 ? await dialog.innerText() : '';
  await expect(dialog, `an editor notice was raised: ${said}`).toHaveCount(0);
}

test('Replace onto a clean open file: both panels share one document, and undo gives each file its own text back (FR-010, FR-013)', { tag: ['@extended', '@editor', '@reserve:window'] }, async () => {
  const root = makeProject('share');
  try {
    await runApp(async (_app, win) => {
      const [owner, linked] = await openBoth(win, root, 'ReplShare');
      await replaceAOntoB(win, root);
      await expectShared(win, owner, linked, 'TYPEDZ');
      await expectNoOpenFailure(win);

      // Step 4: undo the paste from the File Explorer — focused on its root row, since clicking a file would open it.
      await tree(win).getByRole('treeitem').first().click();
      await win.keyboard.press('Control+z');
      await expect.poll(() => existsSync(join(root, 'note.md')), { timeout: FILE_OP_TIMEOUT_MS }).toBe(true);
      await expect
        .poll(() => textOf(join(root, 'dest', 'note.md')), { timeout: FILE_OP_TIMEOUT_MS })
        .toContain(B_BODY);

      // A's panel is A again — its typing kept; B's panel is B again, with its ORIGINAL text.
      await expect(content(win, owner)).toContainText(A_BODY, { timeout: FILE_OP_TIMEOUT_MS });
      await expect(content(win, owner)).toContainText('TYPEDZ');
      await expect(content(win, linked)).toContainText(B_BODY, { timeout: FILE_OP_TIMEOUT_MS });
      await expect(content(win, linked)).not.toContainText(A_BODY);
      // Unlinked: typing in B no longer reaches A.
      await focusEditor(win, linked);
      await win.keyboard.press('Control+End');
      await win.keyboard.type('ONLYB');
      await expect(content(win, linked)).toContainText('ONLYB');
      await expect(content(win, owner)).not.toContainText('ONLYB');
      await expectNoOpenFailure(win);
    });
  } finally {
    cleanupTemp(root);
  }
});

test('the replaced pair follows a rename, saves without going stale, and outlives the owner panel closing (FR-010, FR-011)', { tag: ['@extended', '@editor', '@reserve:window'] }, async () => {
  const root = makeProject('rename');
  try {
    await runApp(async (_app, win) => {
      const [owner, linked] = await openBoth(win, root, 'ReplRename');
      await replaceAOntoB(win, root);
      await expectShared(win, owner, linked, 'FIRSTZ');

      // Negative: a save in one panel leaves the other neither stale nor dirty.
      await focusEditor(win, linked);
      await win.keyboard.press('Control+s');
      await expect.poll(() => textOf(join(root, 'dest', 'note.md'))).toContain('FIRSTZ');
      await expect(win.getByTestId(`panel-unsaved-${linked}`)).toHaveCount(0);
      await expect(win.getByTestId(`panel-unsaved-${owner}`)).toHaveCount(0);
      await expect(content(win, owner)).toContainText('FIRSTZ');

      // Step 6: rename dest/note.md to c.md — both panels follow, and still type into each other.
      await tree(win).getByText('note.md', { exact: true }).click({ button: 'right' });
      await menuItem(win, 'Rename').click();
      const rename = tree(win).locator('input.tree-rename');
      await rename.fill('c.md');
      await rename.press('Enter');
      await expect.poll(() => existsSync(join(root, 'dest', 'c.md')), { timeout: FILE_OP_TIMEOUT_MS }).toBe(true);
      // The file pill names the file with its extension (a panel's title drops it).
      await expect(win.getByTestId(`panel-file-${owner}`)).toContainText('c.md', { timeout: FILE_OP_TIMEOUT_MS });
      await expect(win.getByTestId(`panel-file-${linked}`)).toContainText('c.md', { timeout: FILE_OP_TIMEOUT_MS });
      await focusEditor(win, owner);
      await win.keyboard.press('Control+End');
      await win.keyboard.type('SECONDZ');
      await expect(content(win, linked)).toContainText('SECONDZ', { timeout: 10_000 });

      // Step 7: close the panel that showed A, with that typing unsaved. It asks first, as any dirty editor does
      // (006 FR-006a) — and discarding there closes THIS panel only: the other holds the document on, unsaved text
      // and all.
      await win.getByTestId(`panel-close-${owner}`).click();
      await expect(win.getByTestId('dirty-close-dialog')).toBeVisible();
      await win.getByTestId('dirty-close-discard').click();
      await expect(win.getByTestId(`editor-${owner}`)).toHaveCount(0);
      await expect(content(win, linked)).toContainText('SECONDZ');
      await expect(win.getByTestId(`panel-unsaved-${linked}`)).toHaveCount(1);
      await expectNoOpenFailure(win);
    });
  } finally {
    cleanupTemp(root);
  }
});

/** Wait until the persisted layout of `project` records a panel linked to another — the link the restart restores. */
async function expectLinkPersisted(dataDir: string, project: string): Promise<void> {
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
          return row?.json?.includes('"linkedTo"') ?? false;
        } catch {
          return false; // not written yet, or a read of a mid-write database
        } finally {
          db?.close();
        }
      },
      { timeout: 15_000, message: `the layout for "${project}" never recorded the link` },
    )
    .toBe(true);
}

test('the replaced pair is still one document after a restart (FR-010, SC-004)', { tag: ['@extended', '@editor', '@reserve:window'] }, async () => {
  const root = makeProject('restart');
  const dataDir = mkdtempSync(join(tmpdir(), 'throng-replace-restart-data-'));
  const userDataDir = mkdtempSync(join(tmpdir(), 'throng-replace-restart-ud-'));
  try {
    await runApp(
      async (_app, win) => {
        const [owner, linked] = await openBoth(win, root, 'ReplRestart');
        await replaceAOntoB(win, root);
        await expectShared(win, owner, linked, 'BEFOREZ');
        await focusEditor(win, owner);
        await win.keyboard.press('Control+s'); // a clean pair, so the restart restores files rather than buffers
        await expect.poll(() => textOf(join(root, 'dest', 'note.md'))).toContain('BEFOREZ');
        await expectLinkPersisted(dataDir, 'ReplRestart');
      },
      { dataDir, userDataDir },
    );

    // Step 5: a second launch restores both panels onto the one document.
    await runApp(
      async (_app, win) => {
        const projectItem = win.locator('.project-item', { hasText: 'ReplRestart' });
        await expect(projectItem).toBeVisible();
        await projectItem.locator('[data-testid^="project-switch-"]').click();
        const editors = win.locator('.editor-panel');
        await expect(editors).toHaveCount(2, { timeout: 15_000 });
        const [p1, p2] = await panelIds(win);
        await expect(content(win, p1!)).toContainText('BEFOREZ', { timeout: 15_000 });
        await expect(content(win, p2!)).toContainText('BEFOREZ', { timeout: 15_000 });

        await focusEditor(win, p2!);
        await win.keyboard.press('Control+End');
        await win.keyboard.type('AFTERZ');
        await expect(content(win, p1!)).toContainText('AFTERZ', { timeout: 10_000 });
        await expectNoOpenFailure(win);
      },
      { dataDir, userDataDir },
    );
  } finally {
    cleanupTemp(root);
    cleanupTemp(dataDir);
    cleanupTemp(userDataDir);
  }
});

// ── MT-09: Replace onto a DIRTY open file (FR-012, FR-013) ────────────────────────────────────────────────────────

const MINE = 'MINE-UNSAVED-Z';

/** Stub the native save dialog to answer `picked`, and count how often it was asked. */
async function stubSaveDialog(app: ElectronApplication, picked: string): Promise<void> {
  await app.evaluate(({ dialog }, p) => {
    const g = globalThis as { __saveAsked?: number };
    g.__saveAsked = 0;
    dialog.showSaveDialog = async () => {
      g.__saveAsked = (g.__saveAsked ?? 0) + 1;
      return { canceled: false, filePath: p };
    };
  }, picked);
}
const saveAsked = (app: ElectronApplication): Promise<number> =>
  app.evaluate(() => (globalThis as { __saveAsked?: number }).__saveAsked ?? 0);

/** Type into B's panel without saving, so the Replace lands on a dirty document. */
async function dirtyB(win: Page, linked: string): Promise<void> {
  await focusEditor(win, linked);
  await win.keyboard.press('Control+End');
  await win.keyboard.type(MINE);
  await expect(win.getByTestId(`panel-unsaved-${linked}`)).toHaveCount(1);
}

const notice = (win: Page, pid: string) => win.getByTestId(`panel-failure-${pid}`);

/** Step 2: B's panel keeps the typed text and shows the ONE replaced notice, with its two ways out. */
async function expectReplacedNotice(win: Page, pid: string): Promise<void> {
  await expect(notice(win, pid)).toContainText('note.md was replaced by a moved file. Your unsaved changes are kept here.', {
    timeout: FILE_OP_TIMEOUT_MS,
  });
  await expect(notice(win, pid)).toHaveCount(1);
  await expect(notice(win, pid).getByRole('button', { name: 'Save As…' })).toBeVisible();
  await expect(notice(win, pid).getByRole('button', { name: 'Discard' })).toBeVisible();
  await expect(content(win, pid)).toContainText(MINE);
  await expect(content(win, pid)).toContainText(B_BODY);
  await expect(win.getByTestId(`panel-unsaved-${pid}`)).toHaveCount(1);
}

/** Negative: one notice for the condition, and never a dialog about the refused save. */
async function expectNoSecondSurface(win: Page): Promise<void> {
  await expect(win.locator('[data-testid^="panel-failure-"]')).toHaveCount(1);
  await expect(win.getByTestId('confirm-dialog')).toHaveCount(0);
  await expectNoOpenFailure(win);
}

test('Replace onto a dirty open file keeps the changes under one notice; Ctrl+S is refused there and Save As keeps them (FR-012)', { tag: ['@extended', '@editor', '@reserve:window'] }, async () => {
  const root = makeProject('dirty-saveas');
  try {
    await runApp(async (app, win) => {
      const [, linked] = await openBoth(win, root, 'ReplDirtySaveAs');
      await dirtyB(win, linked);
      await replaceAOntoB(win, root);
      await expectReplacedNotice(win, linked);
      await expectNoSecondSurface(win);

      // Step 3: Ctrl+S flashes the same notice, writes nothing and asks nothing.
      await stubSaveDialog(app, join(root, 'dest', 'mine.md'));
      const flashBefore = Number((await notice(win, linked).getAttribute('data-flash')) ?? '0');
      await focusEditor(win, linked);
      await win.keyboard.press('Control+s');
      await expect
        .poll(async () => Number((await notice(win, linked).getAttribute('data-flash')) ?? '0'))
        .toBeGreaterThan(flashBefore);
      expect(textOf(join(root, 'dest', 'note.md'))).not.toContain(MINE);
      expect(await saveAsked(app)).toBe(0);
      await expectNoSecondSurface(win);

      // Step 4: Save As… keeps the changes in a file of their own; the panel is an ordinary editor on it.
      await notice(win, linked).getByRole('button', { name: 'Save As…' }).click();
      await expect.poll(() => textOf(join(root, 'dest', 'mine.md')), { timeout: FILE_OP_TIMEOUT_MS }).toContain(MINE);
      await expect(notice(win, linked)).toHaveCount(0);
      await expect(win.getByTestId(`panel-file-${linked}`)).toContainText('mine.md');
      await expect(win.getByTestId(`panel-unsaved-${linked}`)).toHaveCount(0);
      expect(textOf(join(root, 'dest', 'note.md'))).toContain(A_BODY); // the moved file is untouched
    });
  } finally {
    cleanupTemp(root);
  }
});

test('Discard on the replaced notice gives up the changes and shares the moved file (FR-012, FR-010)', { tag: ['@extended', '@editor', '@reserve:window'] }, async () => {
  const root = makeProject('dirty-discard');
  try {
    await runApp(async (_app, win) => {
      const [owner, linked] = await openBoth(win, root, 'ReplDirtyDiscard');
      await dirtyB(win, linked);
      await replaceAOntoB(win, root);
      await expectReplacedNotice(win, linked);

      // Step 5: Discard — the panel shows the moved file, shared with A's panel as in MT-08.
      await notice(win, linked).getByRole('button', { name: 'Discard' }).click();
      await expect(notice(win, linked)).toHaveCount(0);
      await expect(content(win, linked)).not.toContainText(MINE);
      await expect(win.getByTestId(`panel-unsaved-${linked}`)).toHaveCount(0);
      await expectShared(win, owner, linked, 'AFTERDISCARDZ');
      await expectNoOpenFailure(win);
    });
  } finally {
    cleanupTemp(root);
  }
});

test('unloading with a replaced dirty file and choosing Save asks where to keep its changes (FR-012)', { tag: ['@extended', '@editor', '@reserve:window'] }, async () => {
  const root = makeProject('dirty-unload');
  try {
    await runApp(async (app, win) => {
      const [, linked] = await openBoth(win, root, 'ReplDirtyUnload');
      await dirtyB(win, linked);
      await replaceAOntoB(win, root);
      await expectReplacedNotice(win, linked);

      // Step 6: Unload, Save — the replaced document cannot Save onto its path, so it asks where, and keeps the text.
      const kept = join(root, 'kept.md');
      await stubSaveDialog(app, kept);
      await win.locator('.project-item', { hasText: 'ReplDirtyUnload' }).click({ button: 'right' });
      await win.getByTestId('menu-item-Unload Project').click();
      await expect(win.getByTestId('dirty-close-dialog')).toBeVisible();
      await win.getByTestId('dirty-close-save').click();
      await expect.poll(() => saveAsked(app), { timeout: FILE_OP_TIMEOUT_MS }).toBe(1);
      await expect.poll(() => textOf(kept), { timeout: FILE_OP_TIMEOUT_MS }).toContain(MINE);
      expect(textOf(join(root, 'dest', 'note.md'))).not.toContain(MINE); // never written onto the moved file
    });
  } finally {
    cleanupTemp(root);
  }
});

test('undoing the Replace gives the dirty panel its file back, still unsaved (FR-013)', { tag: ['@extended', '@editor', '@reserve:window'] }, async () => {
  const root = makeProject('dirty-undo');
  try {
    await runApp(async (_app, win) => {
      const [owner, linked] = await openBoth(win, root, 'ReplDirtyUndo');
      await dirtyB(win, linked);
      await replaceAOntoB(win, root);
      await expectReplacedNotice(win, linked);

      // Step 7: undo the paste from the File Explorer.
      await tree(win).getByRole('treeitem').first().click();
      await win.keyboard.press('Control+z');
      await expect.poll(() => existsSync(join(root, 'note.md')), { timeout: FILE_OP_TIMEOUT_MS }).toBe(true);
      await expect.poll(() => textOf(join(root, 'dest', 'note.md')), { timeout: FILE_OP_TIMEOUT_MS }).toContain(B_BODY);

      await expect(notice(win, linked)).toHaveCount(0, { timeout: FILE_OP_TIMEOUT_MS });
      await expect(content(win, linked)).toContainText(MINE);
      await expect(win.getByTestId(`panel-unsaved-${linked}`)).toHaveCount(1);
      await expect(content(win, owner)).toContainText(A_BODY);
      await expect(content(win, owner)).not.toContainText(MINE);
      await expectNoOpenFailure(win);
    });
  } finally {
    cleanupTemp(root);
  }
});

// ── MT-10: Replace onto an open file whose source is NOT open (FR-011, FR-012) ────────────────────────────────────

/** Only B is open, in a single editor. */
async function openOnlyB(win: Page, root: string, project: string): Promise<string> {
  await createProject(win, project, root);
  const pid = await firstPanelId(win);
  await toEditor(win, pid);
  await tree(win).getByTestId('tree-twisty-dest').click();
  await expect(tree(win).getByText('note.md', { exact: true })).toHaveCount(2);
  await openInto(win, pid, noteRow(win, 'B'), B_BODY);
  return pid;
}

test('Replace onto a clean open file whose source is not open reloads it, clean, with no notice (FR-011)', { tag: ['@extended', '@editor', '@reserve:window'] }, async () => {
  const root = makeProject('only-clean');
  try {
    await runApp(async (_app, win) => {
      const pid = await openOnlyB(win, root, 'ReplOnlyClean');
      await replaceAOntoB(win, root);
      await expect(content(win, pid)).toContainText(A_BODY, { timeout: FILE_OP_TIMEOUT_MS });
      await expect(content(win, pid)).not.toContainText(B_BODY);
      // Negative: not left unsaved or missing once the paste has finished.
      await expect(win.getByTestId(`panel-unsaved-${pid}`)).toHaveCount(0);
      await expect(notice(win, pid)).toHaveCount(0);
      await expectNoOpenFailure(win);
    });
  } finally {
    cleanupTemp(root);
  }
});

test('Replace onto a dirty open file whose source is not open keeps the changes under the replaced notice (FR-012)', { tag: ['@extended', '@editor', '@reserve:window'] }, async () => {
  const root = makeProject('only-dirty');
  try {
    await runApp(async (app, win) => {
      const pid = await openOnlyB(win, root, 'ReplOnlyDirty');
      await dirtyB(win, pid);
      await replaceAOntoB(win, root);
      await expectReplacedNotice(win, pid);

      await stubSaveDialog(app, join(root, 'never.md'));
      await focusEditor(win, pid);
      await win.keyboard.press('Control+s');
      await expect.poll(async () => Number((await notice(win, pid).getAttribute('data-flash')) ?? '0')).toBeGreaterThan(0);
      expect(textOf(join(root, 'dest', 'note.md'))).not.toContain(MINE);
      expect(await saveAsked(app)).toBe(0);
      await expectNoSecondSurface(win);
    });
  } finally {
    cleanupTemp(root);
  }
});
