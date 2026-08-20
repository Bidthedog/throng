import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import { runApp, createProject, firstPanelId, cleanupTemp, FILE_OP_TIMEOUT_MS } from './harness.js';

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

test('the unsaved dot lights on panel + tab + project and clears on save', { tag: ['@extended', '@editor'] }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'throng-ind-'));
  const savePath = join(root, 'doc.txt');
  try {
    await runApp(async (app, win) => {
      await createProject(win, 'IndProj', root);
      const pid = await newEditor(win);
      await win.getByTestId(`editor-${pid}`).locator('.cm-content').click();
      await win.keyboard.type('dirty content');

      /*
       * ── THE FOUR-DOT AGREEMENT MOVED (035 T055) ──
       *
       * That one dirty document lights the panel, the tab, the project row AND the tree row — and
       * that one save clears all four — is `packages/ui/tests/component/editor-dirty-store.test.ts`.
       * All four read `editor-state.ts`'s single `states` map through four selectors, so their
       * agreement is a property of that store and not of any window; the store had no test of its
       * own. That each of the four call sites RENDERS a dot from its selector is
       * `packages/ui/tests/unit/unsaved-dot-call-sites.test.ts`.
       *
       * What is left here is the half neither can reach: the SAVE. One dot is still asserted, as the
       * live witness that a real edit reaches the real store — the claim being about the round trip
       * below it, not about the dot.
       */
      await expect(win.getByTestId(`panel-unsaved-${pid}`)).toBeVisible();

      // Save → every dot clears.
      await stubSaveDialog(app, savePath);
      await win.keyboard.press('Control+s');
      await expect(win.getByTestId(`panel-unsaved-${pid}`)).toHaveCount(0, { timeout: 8000 });
    });
  } finally {
    cleanupTemp(root);
  }
});

test('auto-save writes edits within the debounce without Ctrl+S', { tag: ['@extended', '@editor'] }, async () => {
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
          .poll(() => (existsSync(file) ? readFileSync(file, 'utf8') : ''), { timeout: FILE_OP_TIMEOUT_MS })
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
