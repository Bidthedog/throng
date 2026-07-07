import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { runApp, createProject, firstPanelId } from './harness.js';
import { skipIfElevated } from './admin.js';

// US6 / FR-006a (Delivery D; FR-107 refinement): a top-level "Open in OS File
// Explorer" reveal + an "Open In" submenu of editor targets (disabled for an
// already-open file), Send to Tab → New Tab, and the dirty-editor destroy prompt
// (save/discard/cancel; cancel is a no-op).

function makeProject(): string {
  const root = mkdtempSync(join(tmpdir(), 'throng-menu-'));
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

test('Open In submenu holds editor targets; a top-level OS reveal; disables an open file', async () => {
  skipIfElevated();
  const root = makeProject();
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'MenuProj', root);
      const pid = await newEditor(win);
      await win.getByTestId(`editor-${pid}`).click();

      const tree = win.getByTestId('file-explorer-tree');
      await tree.getByText('a.txt', { exact: true }).click({ button: 'right' });

      // The OS reveal is a single top-level item (FR-107), NOT inside Open In.
      await expect(item(win, 'Open in OS File Explorer')).toBeVisible();
      // Open In now holds only the editor targets (click opens the flyout).
      await item(win, 'Open In').click();
      await expect(win.locator('.context-menu__item', { hasText: 'Last Active Editor' }).last()).toBeVisible();

      // Choose This editor → the file opens into the editor.
      await win.locator('.context-menu__item', { hasText: 'Last Active Editor' }).last().click();
      await expect(win.getByTestId(`editor-${pid}`).locator('.cm-content')).toContainText('A-BODY', {
        timeout: 8000,
      });

      // Re-open the menu → both targets are now disabled: "New Editor" because the
      // file is open anywhere (FR-072), and "This editor" because it is open in the
      // target editor itself (FR-082).
      await tree.getByText('a.txt', { exact: true }).click({ button: 'right' });
      await item(win, 'Open In').click();
      await expect(item(win, 'New Editor')).toHaveClass(/context-menu__item--disabled/);
      await expect(win.locator('.context-menu__item', { hasText: 'Last Active Editor' }).last()).toHaveClass(/context-menu__item--disabled/);
    });
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
  }
});

test('Send to Tab offers New Tab on the panel menu', async () => {
  skipIfElevated();
  const root = makeProject();
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'MenuProj', root);
      const pid = await newEditor(win);
      await win.getByTestId(`panel-handle-${pid}`).click({ button: 'right' });
      await item(win, 'Send to Tab').click();
      await expect(item(win, 'New Tab')).toBeVisible();
    });
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
  }
});

test('destroying a dirty editor prompts save/discard/cancel; cancel is a no-op', async () => {
  skipIfElevated();
  const root = makeProject();
  const cfgRoot = mkdtempSync(join(tmpdir(), 'throng-cfg-menu-'));
  // No destroy-confirmation noise — isolate the dirty-close prompt.
  writeFileSync(
    join(cfgRoot, 'settings.json'),
    JSON.stringify({ version: 1, confirmations: { destroyPanel: 'none' } }),
  );
  try {
    await runApp(
      async (_app, win) => {
        await createProject(win, 'MenuProj', root);
        const pid = await newEditor(win);
        // A second panel so the editor can actually be removed (workspace keeps ≥1).
        await win.getByTestId(`panel-add-${pid}`).click();

        await win.getByTestId(`editor-${pid}`).locator('.cm-content').click();
        await win.keyboard.type('unsaved');
        await expect(win.getByTestId(`panel-unsaved-${pid}`)).toBeVisible();

        // Destroy → the save/discard/cancel prompt appears.
        await win.getByTestId(`panel-handle-${pid}`).click({ button: 'right' });
        await item(win, 'Destroy Panel').click();
        await expect(win.getByTestId('dirty-close-dialog')).toBeVisible();

        // Cancel → nothing changes: the editor is still there and still dirty.
        await win.getByTestId('dirty-close-cancel').click();
        await expect(win.getByTestId('dirty-close-dialog')).toHaveCount(0);
        await expect(win.getByTestId(`editor-${pid}`)).toBeVisible();
        await expect(win.getByTestId(`panel-unsaved-${pid}`)).toBeVisible();

        // Destroy again → Discard & close → the editor Panel is gone.
        await win.getByTestId(`panel-handle-${pid}`).click({ button: 'right' });
        await item(win, 'Destroy Panel').click();
        await win.getByTestId('dirty-close-discard').click();
        await expect(win.getByTestId(`editor-${pid}`)).toHaveCount(0, { timeout: 6000 });
      },
      { env: { THRONG_CONFIG_ROOT: cfgRoot } },
    );
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
    rmSync(cfgRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
  }
});
