import { mkdtempSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import { runApp, createProject, firstPanelId } from './harness.js';
import { skipIfElevated } from './admin.js';

// Post-Delivery-E feedback (Session 2026-07-05b): New Editor menu target (FR-072),
// panel-header Save + Revert (FR-075/076), visible out-of-tree save message
// (FR-078), and the themeable editor monospace font (FR-074).

function makeProject(): string {
  const root = mkdtempSync(join(tmpdir(), 'throng-fb-'));
  writeFileSync(join(root, 'a.txt'), 'A-BODY\n');
  return root;
}

async function newEditor(win: Page): Promise<string> {
  const pid = await firstPanelId(win);
  await win.getByTestId(`panel-type-select-${pid}`).selectOption('editor');
  await win.getByTestId(`panel-type-confirm-${pid}`).click();
  await expect(win.getByTestId(`editor-${pid}`)).toBeVisible();
  return pid;
}

const item = (win: Page, label: string) => win.getByTestId(`menu-item-${label}`);

async function stubSaveDialog(app: ElectronApplication, picked: string): Promise<void> {
  await app.evaluate(({ dialog }, p) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: p });
  }, picked);
}

test('a refused out-of-tree save shows a visible message and leaves the buffer unsaved', async () => {
  skipIfElevated();
  const root = makeProject();
  const outside = mkdtempSync(join(tmpdir(), 'throng-out-'));
  try {
    await runApp(async (app, win) => {
      await createProject(win, 'FbProj', root);
      const pid = await newEditor(win);
      await win.getByTestId(`editor-${pid}`).locator('.cm-content').click();
      await win.keyboard.type('data');

      await stubSaveDialog(app, join(outside, 'escape.txt'));
      await win.keyboard.press('Control+s');

      // A visible notice, not a silent no-op (FR-078).
      await expect(win.getByTestId('editor-notice-dialog')).toBeVisible();
      await expect(win.getByTestId('editor-notice-message')).toContainText('project');
      await win.getByTestId('editor-notice-ok').click();
      await expect(win.getByTestId(`panel-unsaved-${pid}`)).toBeVisible();
      expect(existsSync(join(outside, 'escape.txt'))).toBe(false);
    });
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
    rmSync(outside, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
  }
});

test('Open In offers "New Editor" (a second panel) and disables it once the file is open', async () => {
  skipIfElevated();
  const root = makeProject();
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'FbProj', root);
      await newEditor(win);

      const tree = win.getByTestId('file-explorer-tree');
      await tree.getByText('a.txt', { exact: true }).click({ button: 'right' });
      await item(win, 'Open In').click();
      await expect(win.locator('.context-menu__item', { hasText: 'Last Active Editor' }).last()).toBeVisible();
      // New Editor is available while the file is not open.
      await expect(item(win, 'New Editor')).toBeVisible();
      await expect(item(win, 'New Editor')).not.toHaveClass(/context-menu__item--disabled/);
      await item(win, 'New Editor').click();

      // A second editor panel now hosts the file.
      await expect(win.locator('.editor-panel')).toHaveCount(2);
      await expect(win.locator('.cm-content', { hasText: 'A-BODY' }).first()).toBeVisible();

      // Re-open the menu → New Editor is disabled (one buffer per file, FR-011a).
      await tree.getByText('a.txt', { exact: true }).click({ button: 'right' });
      await item(win, 'Open In').click();
      await expect(item(win, 'New Editor')).toHaveClass(/context-menu__item--disabled/);
    });
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
  }
});

test('panel-header Save saves; Revert discards changes after confirmation', async () => {
  skipIfElevated();
  const root = makeProject();
  const savePath = join(root, 'note.txt');
  try {
    await runApp(async (app, win) => {
      await createProject(win, 'FbProj', root);
      const pid = await newEditor(win);
      const content = win.getByTestId(`editor-${pid}`).locator('.cm-content');
      await content.click();
      await win.keyboard.type('first');

      // Save via the panel-header menu (== Ctrl+S).
      await stubSaveDialog(app, savePath);
      await win.getByTestId(`panel-handle-${pid}`).click({ button: 'right' });
      await item(win, 'Save').click();
      await expect
        .poll(() => (existsSync(savePath) ? readFileSync(savePath, 'utf8') : ''), { timeout: 8000 })
        .toBe('first');
      await expect(win.getByTestId(`panel-unsaved-${pid}`)).toHaveCount(0);

      // Edit again, then Revert (confirm) → content returns to the saved text.
      await content.click();
      await win.keyboard.type(' SECOND');
      await expect(win.getByTestId(`panel-unsaved-${pid}`)).toBeVisible();
      await win.getByTestId(`panel-handle-${pid}`).click({ button: 'right' });
      await item(win, 'Revert').click();
      await win.getByTestId('confirm-accept').click();

      await expect(content).not.toContainText('SECOND');
      await expect(content).toContainText('first');
      await expect(win.getByTestId(`panel-unsaved-${pid}`)).toHaveCount(0);
    });
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
  }
});

test('the editor renders in the themeable monospace font (Consolas default)', async () => {
  skipIfElevated();
  const root = makeProject();
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'FbProj', root);
      const pid = await newEditor(win);
      const family = await win
        .getByTestId(`editor-${pid}`)
        .locator('.cm-scroller')
        .evaluate((el) => getComputedStyle(el).fontFamily);
      expect(family.toLowerCase()).toContain('consolas');
    });
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
  }
});
