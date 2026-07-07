import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { runApp, createProject, firstPanelId, reloadWindow } from './harness.js';
import { skipIfElevated } from './admin.js';

// US10 (Delivery E): a project editor synced into a sub-workspace mirrors ONE
// document across both windows — content typed in the main window appears in the
// sub-workspace window (same panelId, cross-window content sync, FR-034).

const seedSub = `(() => window.throng.invoke('workspace.persistSubWorkspaces', { subWorkspaces: [
  { id: 'sw1', ownerUser: 'u', name: 'Mirror', colour: '#3fb950',
    bounds: { x: 0, y: 0, width: 500, height: 400 },
    tabs: [{ id: 't', title: 'T', root: { type: 'panel', id: 'seed', originProjectId: 'x', title: 'P' } }] },
] }))()`;

async function newEditor(win: Page): Promise<string> {
  const pid = await firstPanelId(win);
  await win.getByTestId(`panel-type-select-${pid}`).selectOption('editor');
  await win.getByTestId(`panel-type-confirm-${pid}`).click();
  await expect(win.getByTestId(`editor-${pid}`)).toBeVisible();
  return pid;
}

test('a synced project editor mirrors one document across both windows', async () => {
  skipIfElevated();
  const root = mkdtempSync(join(tmpdir(), 'throng-swed-'));
  try {
    await runApp(async (app, win) => {
      await win.evaluate(seedSub);
      await reloadWindow(win);
      await createProject(win, 'MirrorProj', root);
      const pid = await newEditor(win);

      // Type content into the main-window editor and let it flush to UI main.
      await win.getByTestId(`editor-${pid}`).locator('.cm-content').click();
      await win.keyboard.type('HELLO-MIRROR');
      await win.waitForTimeout(300);

      // Open the sub-workspace window.
      const [child] = await Promise.all([
        app.waitForEvent('window'),
        win.getByTestId('subworkspace-open-sw1').click(),
      ]);
      await child.waitForLoadState('domcontentloaded');

      // Sync the editor Panel into the sub-workspace's Tab "T".
      await win.getByTestId(`panel-handle-${pid}`).click({ button: 'right' });
      await win.getByTestId('menu-item-Sync to').click();
      await win.getByTestId('menu-item-Mirror').click();
      await win.getByTestId('menu-item-T').click();

      // The child window shows the SAME editor with the already-typed content.
      const childEditor = child.getByTestId(`editor-${pid}`);
      await expect(childEditor).toBeVisible({ timeout: 10000 });
      await expect(childEditor.locator('.cm-content')).toContainText('HELLO-MIRROR', {
        timeout: 10000,
      });
      // Let the child editor's initial load settle so it doesn't race the next edit.
      await child.waitForTimeout(500);

      // A live edit in the MAIN window mirrors into the sub-workspace window.
      await win.bringToFront();
      await win.getByTestId(`editor-${pid}`).locator('.cm-content').click();
      await win.keyboard.type(' MORE');
      await expect(win.getByTestId(`editor-${pid}`).locator('.cm-content')).toContainText('MORE');
      // … and it mirrors into the sub-workspace window (one document, FR-034).
      await expect(childEditor.locator('.cm-content')).toContainText('MORE', { timeout: 10000 });
    });
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
  }
});
