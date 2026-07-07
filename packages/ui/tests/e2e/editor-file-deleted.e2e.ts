import { mkdtempSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { runApp, createProject, firstPanelId } from './harness.js';
import { skipIfElevated } from './admin.js';

async function dismissNoticeIfPresent(win: Page): Promise<void> {
  const ok = win.getByTestId('editor-notice-ok');
  if (await ok.isVisible().catch(() => false)) await ok.click();
}

// Session 2026-07-06d: "Last Active Editor (<Panel>)" label (FR-098); deleting a file
// open in an editor marks it dirty + save re-creates it (FR-099); the "Cannot open
// file" dialog carries file/panel detail and re-appears on tab selection (FR-100).

function makeProject(): string {
  const root = mkdtempSync(join(tmpdir(), 'throng-del-'));
  writeFileSync(join(root, 'note.txt'), 'HELLO-BODY\n');
  return root;
}

async function newEditor(win: Page): Promise<string> {
  const pid = await firstPanelId(win);
  await win.getByTestId(`panel-type-select-${pid}`).selectOption('editor');
  await win.getByTestId(`panel-type-confirm-${pid}`).click();
  await expect(win.getByTestId(`editor-${pid}`)).toBeVisible();
  return pid;
}

test('the Open-In target is labelled "Last Active Editor (<Panel name>)" (FR-098)', async () => {
  skipIfElevated();
  const root = makeProject();
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'Del', root);
      const pid = await newEditor(win);
      // Rename the editor panel to a known name.
      await win.getByTestId(`panel-handle-${pid}`).dblclick();
      const rename = win.getByTestId(`panel-rename-input-${pid}`);
      await rename.fill('Scratch');
      await rename.press('Enter');
      await win.getByTestId(`editor-${pid}`).click();

      const tree = win.getByTestId('file-explorer-tree');
      await tree.getByText('note.txt', { exact: true }).click({ button: 'right' });
      await win.getByTestId('menu-item-Open In').click();
      await expect(win.getByTestId('menu-item-Last Active Editor (Scratch)')).toBeVisible();
    });
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
  }
});

test('deleting an open file marks the editor dirty; save re-creates it; re-select shows the error', async () => {
  skipIfElevated();
  const root = makeProject();
  const file = join(root, 'note.txt');
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'Del', root);
      const pid = await newEditor(win);
      await win.getByTestId(`editor-${pid}`).click();

      // Open note.txt into the editor.
      const tree = win.getByTestId('file-explorer-tree');
      await tree.getByText('note.txt', { exact: true }).click();
      await expect(win.getByTestId(`editor-${pid}`).locator('.cm-content')).toContainText(
        'HELLO-BODY',
        { timeout: 8000 },
      );
      // Clean editor → no unsaved dot yet.
      await expect(win.getByTestId(`panel-unsaved-${pid}`)).toHaveCount(0);

      // Delete the file via the tree.
      await tree.getByText('note.txt', { exact: true }).click({ button: 'right' });
      await win.getByTestId('menu-item-Delete').click();
      await win.getByTestId('confirm-accept').click();
      const again = win.getByTestId('confirm-accept');
      if (await again.isVisible().catch(() => false)) await again.click();

      // FR-099: the editor becomes dirty (unsaved dot appears), buffer kept.
      await expect(win.getByTestId(`panel-unsaved-${pid}`)).toBeVisible({ timeout: 8000 });
      await expect
        .poll(() => existsSync(file), { timeout: 6000 })
        .toBe(false);

      // FR-100: re-selecting the tab surfaces a detailed "Cannot open file" dialog.
      await win.getByTestId('tab-add').click(); // creates + switches to a 2nd tab
      const firstTab = win.locator('.tab-chip').first();
      await firstTab.click(); // back to the editor's tab → remount
      const dialog = win.getByTestId('editor-notice-dialog');
      await expect(dialog).toBeVisible({ timeout: 8000 });
      // Same layout as the multi-file dialog — one bulleted file, bold name + panel note.
      const files = win.getByTestId('editor-notice-files');
      await expect(files.locator('.editor-notice__file')).toHaveCount(1);
      await expect(files.locator('.editor-notice__file-name', { hasText: 'note.txt' })).toBeVisible();
      await expect(files).toContainText('Panel:'); // which panel
      await win.getByTestId('editor-notice-ok').click();

      // Save writes the buffer back to the original path, re-creating the file.
      // Focus the editor pane first so Ctrl+S targets it (active-pane gating).
      await win.getByTestId(`editor-${pid}`).locator('.cm-content').click();
      await win.keyboard.press('Control+s');
      await expect
        .poll(() => (existsSync(file) ? readFileSync(file, 'utf8') : ''), { timeout: 8000 })
        .toContain('HELLO-BODY');
    });
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
  }
});

test('after a restart, a deleted-file editor restores its content (not blank) from recovery (FR-102)', async () => {
  skipIfElevated();
  const root = mkdtempSync(join(tmpdir(), 'throng-del2-'));
  const dataDir = mkdtempSync(join(tmpdir(), 'throng-del2-data-'));
  const userDataDir = mkdtempSync(join(tmpdir(), 'throng-del2-ud-'));
  writeFileSync(join(root, 'keep.txt'), 'KEEP-BODY-77\n');
  try {
    // Session 1: open the file, delete it (→ dirty + recovery temp written), close.
    await runApp(
      async (_app, win) => {
        await createProject(win, 'Del2', root);
        const pid = await firstPanelId(win);
        await win.getByTestId(`panel-type-select-${pid}`).selectOption('editor');
        await win.getByTestId(`panel-type-confirm-${pid}`).click();
        await expect(win.getByTestId(`editor-${pid}`)).toBeVisible();
        await win.getByTestId(`editor-${pid}`).click();

        const tree = win.getByTestId('file-explorer-tree');
        await tree.getByText('keep.txt', { exact: true }).click();
        await expect(win.getByTestId(`editor-${pid}`).locator('.cm-content')).toContainText(
          'KEEP-BODY-77',
          { timeout: 8000 },
        );
        await tree.getByText('keep.txt', { exact: true }).click({ button: 'right' });
        await win.getByTestId('menu-item-Delete').click();
        await win.getByTestId('confirm-accept').click();
        const again = win.getByTestId('confirm-accept');
        if (await again.isVisible().catch(() => false)) await again.click();
        await expect(win.getByTestId(`panel-unsaved-${pid}`)).toBeVisible({ timeout: 8000 });
        await win.waitForTimeout(600); // let the immediate recovery write settle
      },
      { dataDir, userDataDir },
    );

    // Session 2: reopen → the file is gone, but the editor shows the recovered
    // content (dirty), NOT a blank editor.
    await runApp(
      async (_app, win) => {
        const projectItem = win.locator('.project-item', { hasText: 'Del2' });
        await expect(projectItem).toBeVisible();
        await projectItem.locator('[data-testid^="project-switch-"]').click();

        await dismissNoticeIfPresent(win); // the "Cannot open file" dialog
        const editor = win.locator('.editor-panel').first();
        await expect(editor).toBeVisible({ timeout: 10000 });
        await expect(editor.locator('.cm-content')).toContainText('KEEP-BODY-77', { timeout: 10000 });
        await expect(win.locator('.throng-unsaved-dot').first()).toBeVisible();
      },
      { dataDir, userDataDir },
    );
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
    rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
    rmSync(userDataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
  }
});
