import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { runApp, createProject, firstPanelId } from './harness.js';
import { skipIfElevated } from './admin.js';

// Session 2026-07-06f: the "cannot open file" popup lists ALL missing files on a tab
// in ONE dialog (FR-100), fires only on tab open/re-select — never on a panel
// drag/remount (FR-105) — and can be disabled via editor.warnOnMissingFile.

function makeProject(): string {
  const root = mkdtempSync(join(tmpdir(), 'throng-agg-'));
  writeFileSync(join(root, 'alpha.txt'), 'AAA\n');
  writeFileSync(join(root, 'beta.txt'), 'BBB\n');
  return root;
}

async function newEditor(win: Page): Promise<string> {
  const pid = await firstPanelId(win);
  await win.getByTestId(`panel-type-select-${pid}`).selectOption('editor');
  await win.getByTestId(`panel-type-confirm-${pid}`).click();
  await expect(win.getByTestId(`editor-${pid}`)).toBeVisible();
  return pid;
}

async function reselectFirstTab(win: Page): Promise<void> {
  await win.getByTestId('tab-add').click(); // new active tab
  await win.locator('.tab-chip').first().click(); // back to the editors' tab
}

test('lists ALL missing files on a tab in one dialog (FR-100)', async () => {
  skipIfElevated();
  const root = makeProject();
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'Agg', root);
      const pid = await newEditor(win);
      await win.getByTestId(`editor-${pid}`).click();
      const tree = win.getByTestId('file-explorer-tree');

      // Editor 1 ← alpha.txt (single click); Editor 2 ← beta.txt (Open In → New Editor).
      await tree.getByText('alpha.txt', { exact: true }).click();
      await expect(win.getByTestId(`editor-${pid}`).locator('.cm-content')).toContainText('AAA', {
        timeout: 8000,
      });
      await tree.getByText('beta.txt', { exact: true }).click({ button: 'right' });
      await win.getByTestId('menu-item-Open In').click();
      await win.getByTestId('menu-item-New Editor').click();
      await expect(win.locator('.editor-panel')).toHaveCount(2, { timeout: 8000 });

      // Delete BOTH files.
      await tree.getByText('alpha.txt', { exact: true }).click();
      await tree.getByText('beta.txt', { exact: true }).click({ modifiers: ['Control'] });
      await tree.getByText('beta.txt', { exact: true }).click({ button: 'right', modifiers: ['Control'] });
      await win.getByTestId('menu-item-Delete').click();
      await win.getByTestId('confirm-accept').click();
      const wry = win.getByTestId('confirm-accept');
      if (await wry.isVisible().catch(() => false)) await wry.click();

      // Re-select the tab → ONE dialog naming both files.
      await reselectFirstTab(win);
      const dialog = win.getByTestId('editor-notice-dialog');
      await expect(dialog).toBeVisible({ timeout: 8000 });
      // Both files listed in the scrollable box, each as a distinct bullet with the
      // file NAME bold (its directory path is not).
      const files = win.getByTestId('editor-notice-files');
      await expect(files.locator('.editor-notice__file')).toHaveCount(2);
      // Each file name is its own bold element (its directory path is a separate,
      // non-bold element).
      await expect(files.locator('.editor-notice__file-name', { hasText: 'alpha.txt' })).toBeVisible();
      await expect(files.locator('.editor-notice__file-name', { hasText: 'beta.txt' })).toBeVisible();
      await expect(files.locator('.editor-notice__file-dir').first()).toBeVisible();
      // The bold name renders with a bold font weight.
      const weight = await files
        .locator('.editor-notice__file-name', { hasText: 'alpha.txt' })
        .evaluate((el) => Number(getComputedStyle(el).fontWeight));
      expect(weight).toBeGreaterThanOrEqual(600);
    });
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
  }
});

test('does NOT pop the dialog on delete / remount while the tab stays active (FR-105)', async () => {
  skipIfElevated();
  const root = makeProject();
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'Agg', root);
      const pid = await newEditor(win);
      await win.getByTestId(`editor-${pid}`).click();
      const tree = win.getByTestId('file-explorer-tree');
      await tree.getByText('alpha.txt', { exact: true }).click();
      await expect(win.getByTestId(`editor-${pid}`).locator('.cm-content')).toContainText('AAA', {
        timeout: 8000,
      });

      // Delete the open file → the editor goes dirty, but NO popup (tab unchanged).
      await tree.getByText('alpha.txt', { exact: true }).click({ button: 'right' });
      await win.getByTestId('menu-item-Delete').click();
      await win.getByTestId('confirm-accept').click();
      const wry = win.getByTestId('confirm-accept');
      if (await wry.isVisible().catch(() => false)) await wry.click();
      await expect(win.getByTestId(`panel-unsaved-${pid}`)).toBeVisible({ timeout: 8000 });

      // Give the tab-open watcher's window (300ms) time to pass — still no dialog,
      // because the active tab never changed (this is what a panel drag also does).
      await win.waitForTimeout(700);
      await expect(win.getByTestId('editor-notice-dialog')).toHaveCount(0);

      // Only a tab re-selection surfaces it.
      await reselectFirstTab(win);
      await expect(win.getByTestId('editor-notice-dialog')).toBeVisible({ timeout: 8000 });
    });
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
  }
});

test('editor.warnOnMissingFile=false suppresses the popup entirely', async () => {
  skipIfElevated();
  const root = makeProject();
  const cfgRoot = mkdtempSync(join(tmpdir(), 'throng-agg-cfg-'));
  writeFileSync(
    join(cfgRoot, 'settings.json'),
    JSON.stringify({ version: 1, editor: { warnOnMissingFile: false } }),
  );
  try {
    await runApp(
      async (_app, win) => {
        await createProject(win, 'Agg', root);
        const pid = await newEditor(win);
        await win.getByTestId(`editor-${pid}`).click();
        const tree = win.getByTestId('file-explorer-tree');
        await tree.getByText('alpha.txt', { exact: true }).click();
        await expect(win.getByTestId(`editor-${pid}`).locator('.cm-content')).toContainText('AAA', {
          timeout: 8000,
        });

        await tree.getByText('alpha.txt', { exact: true }).click({ button: 'right' });
        await win.getByTestId('menu-item-Delete').click();
        await win.getByTestId('confirm-accept').click();
        const wry = win.getByTestId('confirm-accept');
        if (await wry.isVisible().catch(() => false)) await wry.click();
        await expect(win.getByTestId(`panel-unsaved-${pid}`)).toBeVisible({ timeout: 8000 });

        // Re-select the tab — with the setting off, NO dialog appears.
        await reselectFirstTab(win);
        await win.waitForTimeout(700);
        await expect(win.getByTestId('editor-notice-dialog')).toHaveCount(0);
      },
      { env: { THRONG_CONFIG_ROOT: cfgRoot } },
    );
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
    rmSync(cfgRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
  }
});
