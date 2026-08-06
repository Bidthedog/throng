import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import { runApp, createProject, firstPanelId, cleanupTemp} from './harness.js';

// US8/US7 (Delivery C): the shared red unsaved dot aggregates on Panel/Tab/project
// and clears on save; debounced auto-save writes without Ctrl+S.

async function stubSaveDialog(app: ElectronApplication, picked: string): Promise<void> {
  await app.evaluate(({ dialog }, p) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: p });
  }, picked);
}

async function newEditor(win: Page): Promise<string> {
  const pid = await firstPanelId(win);
  await win.getByTestId(`panel-type-select-${pid}`).selectOption('editor');
  await win.getByTestId(`panel-type-confirm-${pid}`).click();
  await expect(win.getByTestId(`editor-${pid}`)).toBeVisible();
  return pid;
}

test('the unsaved dot lights on panel + tab + project and clears on save', async () => {
  const root = mkdtempSync(join(tmpdir(), 'throng-ind-'));
  const savePath = join(root, 'doc.txt');
  try {
    await runApp(async (app, win) => {
      await createProject(win, 'IndProj', root);
      const pid = await newEditor(win);
      const tabId = await win
        .locator('.tab-chip')
        .first()
        .evaluate((el) => (el as HTMLElement).dataset.testid?.replace('tab-', '') ?? '');

      await win.getByTestId(`editor-${pid}`).locator('.cm-content').click();
      await win.keyboard.type('dirty content');

      // Dot appears on the Panel, the Tab, and the project row.
      await expect(win.getByTestId(`panel-unsaved-${pid}`)).toBeVisible();
      await expect(win.getByTestId(`tab-unsaved-${tabId}`)).toBeVisible();
      await expect(win.locator('.project-item .throng-unsaved-dot').first()).toBeVisible();

      // Save → every dot clears.
      await stubSaveDialog(app, savePath);
      await win.keyboard.press('Control+s');
      await expect(win.getByTestId(`panel-unsaved-${pid}`)).toHaveCount(0, { timeout: 8000 });
      await expect(win.getByTestId(`tab-unsaved-${tabId}`)).toHaveCount(0);
      await expect(win.locator('.project-item .throng-unsaved-dot')).toHaveCount(0);
    });
  } finally {
    cleanupTemp(root);
  }
});

test('auto-save writes edits within the debounce without Ctrl+S', async () => {
  const root = mkdtempSync(join(tmpdir(), 'throng-auto-'));
  const file = join(root, 'auto.txt');
  writeFileSync(file, 'seed\n');
  const cfgRoot = mkdtempSync(join(tmpdir(), 'throng-cfg-auto-'));
  writeFileSync(
    join(cfgRoot, 'settings.json'),
    JSON.stringify({ version: 1, editor: { autoSave: true, autoSaveDebounceMs: 150 } }),
  );
  try {
    await runApp(
      async (_app, win) => {
        await createProject(win, 'AutoProj', root);
        const pid = await newEditor(win);
        await win.getByTestId(`editor-${pid}`).click();

        // Open the saved file, then edit — auto-save should write it back.
        await win.getByTestId('file-explorer-tree').getByText('auto.txt', { exact: true }).click();
        const content = win.getByTestId(`editor-${pid}`).locator('.cm-content');
        await expect(content).toContainText('seed', { timeout: 8000 });
        await content.click();
        await win.keyboard.type('AUTO ');

        await expect
          .poll(() => (existsSync(file) ? readFileSync(file, 'utf8') : ''), { timeout: 8000 })
          .toContain('AUTO');
        // Auto-save cleared the dirty state.
        await expect(win.getByTestId(`panel-unsaved-${pid}`)).toHaveCount(0, { timeout: 8000 });
      },
      { env: { THRONG_CONFIG_ROOT: cfgRoot } },
    );
  } finally {
    cleanupTemp(root);
    cleanupTemp(cfgRoot);
  }
});
