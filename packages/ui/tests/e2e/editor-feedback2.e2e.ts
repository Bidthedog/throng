import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import { runApp, createProject, firstPanelId } from './harness.js';
import { skipIfElevated } from './admin.js';

// Session 2026-07-06 feedback: "This editor" rename + selected-editor disable
// (FR-082), New Folder tree menu (FR-086), Save As (FR-084), and the save-dialog
// default file name = Panel name (FR-083).

function makeProject(): string {
  const root = mkdtempSync(join(tmpdir(), 'throng-fb2-'));
  mkdirSync(join(root, 'sub'));
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

test('"This editor" is disabled when the file is already open in the target editor', async () => {
  skipIfElevated();
  const root = makeProject();
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'Fb2', root);
      const pid = await newEditor(win);
      await win.getByTestId(`editor-${pid}`).click();

      const tree = win.getByTestId('file-explorer-tree');
      await tree.getByText('a.txt', { exact: true }).click({ button: 'right' });
      await item(win, 'Open In').click();
      // Renamed from "Editor Here" (FR-082), enabled while not open.
      await expect(win.locator('.context-menu__item', { hasText: 'Last Active Editor' }).last()).toBeVisible();
      await expect(win.locator('.context-menu__item', { hasText: 'Last Active Editor' }).last()).not.toHaveClass(/context-menu__item--disabled/);
      await win.locator('.context-menu__item', { hasText: 'Last Active Editor' }).last().click();
      await expect(win.getByTestId(`editor-${pid}`).locator('.cm-content')).toContainText('A-BODY', {
        timeout: 8000,
      });

      // Now the file is open in that editor → "This editor" is disabled (no-op).
      await tree.getByText('a.txt', { exact: true }).click({ button: 'right' });
      await item(win, 'Open In').click();
      await expect(win.locator('.context-menu__item', { hasText: 'Last Active Editor' }).last()).toHaveClass(/context-menu__item--disabled/);
    });
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
  }
});

test('the Files & Folders context menu has a New Folder action', async () => {
  skipIfElevated();
  const root = makeProject();
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'Fb2', root);
      const tree = win.getByTestId('file-explorer-tree');
      await tree.getByText('sub', { exact: true }).click({ button: 'right' });
      await expect(item(win, 'New Folder')).toBeVisible();
      await item(win, 'New Folder').click();
      // A new folder is created (inline rename input appears) and exists on disk.
      await expect(tree.locator('input.tree-rename')).toBeVisible({ timeout: 6000 });
      await expect
        .poll(() => existsSync(join(root, 'sub', 'New folder')), { timeout: 6000 })
        .toBe(true);
    });
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
  }
});

test('Save As writes the document to a newly chosen location', async () => {
  skipIfElevated();
  const root = makeProject();
  const first = join(root, 'first.txt');
  const second = join(root, 'second.txt');
  const stub = async (app: ElectronApplication, path: string): Promise<void> => {
    await app.evaluate(({ dialog }, p) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: p });
    }, path);
  };
  try {
    await runApp(async (app, win) => {
      await createProject(win, 'Fb2', root);
      const pid = await newEditor(win);
      await win.getByTestId(`editor-${pid}`).locator('.cm-content').click();
      await win.keyboard.type('hello');

      await stub(app, first);
      await win.keyboard.press('Control+s');
      await expect.poll(() => (existsSync(first) ? readFileSync(first, 'utf8') : ''), { timeout: 8000 }).toBe('hello');

      // Save As → choose a different location; the doc is written there too.
      await stub(app, second);
      await win.getByTestId(`panel-handle-${pid}`).click({ button: 'right' });
      await item(win, 'Save As…').click();
      await expect.poll(() => (existsSync(second) ? readFileSync(second, 'utf8') : ''), { timeout: 8000 }).toBe('hello');
    });
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
  }
});

test('the save dialog defaults the file name to the Panel name (FR-083)', async () => {
  skipIfElevated();
  const root = makeProject();
  try {
    await runApp(async (app, win) => {
      await createProject(win, 'Fb2', root);
      const pid = await newEditor(win);

      // Rename the panel to a known name.
      await win.getByTestId(`panel-handle-${pid}`).dblclick();
      const rename = win.getByTestId(`panel-rename-input-${pid}`);
      await rename.fill('MyDocument');
      await rename.press('Enter');

      // Capture the save-dialog default path.
      await app.evaluate(({ dialog }) => {
        (globalThis as Record<string, unknown>).__savePath = null;
        dialog.showSaveDialog = async (a: unknown, b: unknown) => {
          const opts = (b ?? a) as { defaultPath?: string };
          (globalThis as Record<string, unknown>).__savePath = opts?.defaultPath ?? '';
          return { canceled: true, filePath: undefined };
        };
      });

      await win.getByTestId(`editor-${pid}`).locator('.cm-content').click();
      await win.keyboard.type('x');
      await win.keyboard.press('Control+s');

      await expect
        .poll(async () => app.evaluate(() => (globalThis as Record<string, unknown>).__savePath), {
          timeout: 6000,
        })
        .toContain('MyDocument');
    });
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
  }
});
