import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import { runApp, createProject, reloadWindow } from './harness.js';
import { skipIfElevated } from './admin.js';

// FR-077 (post-Delivery-E feedback): a sub-workspace-OWNED editor (created inside a
// sub-workspace, no owning project) can be SAVED (outside every project) and
// DESTROYED from the sub-workspace window — the editor keybindings + destroy prompt
// are wired there too. The new-editor copy is context-aware (not "within this project").

const seedSub = `(() => window.throng.invoke('workspace.persistSubWorkspaces', { subWorkspaces: [
  { id: 'sw1', ownerUser: 'u', name: 'Owned', colour: '#3fb950',
    bounds: { x: 0, y: 0, width: 500, height: 400 },
    tabs: [{ id: 't', title: 'T', root: { type: 'panel', id: 'p', originProjectId: 'x', title: 'P' } }] },
] }))()`;

const menu = (page: import('@playwright/test').Page, label: string) =>
  page.getByTestId(`menu-item-${label}`);

test('a sub-workspace-owned editor saves outside projects and can be destroyed', async () => {
  skipIfElevated();
  const projectRoot = mkdtempSync(join(tmpdir(), 'throng-swo-proj-'));
  const outside = mkdtempSync(join(tmpdir(), 'throng-swo-out-'));
  const savePath = join(outside, 'scratch.txt');
  try {
    await runApp(async (app, win) => {
      await win.evaluate(seedSub);
      await reloadWindow(win);
      await createProject(win, 'HostProj', projectRoot);

      // Open the sub-workspace window.
      const [child] = await Promise.all([
        app.waitForEvent('window'),
        win.getByTestId('subworkspace-open-sw1').click(),
      ]);
      await child.waitForLoadState('domcontentloaded');

      // The seeded panel 'p' is untyped here and owned by the sub-workspace (no
      // project). Confirm it as an Editor — the hint copy is context-aware.
      await child.getByTestId('panel-type-select-p').selectOption('editor');
      await expect(child.getByTestId('editor-inputs-hint')).toContainText('outside');
      await child.getByTestId('panel-type-confirm-p').click();
      await expect(child.getByTestId('editor-p')).toBeVisible();

      // Type + save via Ctrl+S to a location OUTSIDE every project → allowed (FR-077).
      await child.getByTestId('editor-p').locator('.cm-content').click();
      await child.keyboard.type('owned content');
      await app.evaluate(({ dialog }, p) => {
        dialog.showSaveDialog = async () => ({ canceled: false, filePath: p });
      }, savePath);
      await child.bringToFront();
      await child.keyboard.press('Control+s');

      await expect
        .poll(() => (existsSync(savePath) ? readFileSync(savePath, 'utf8') : ''), { timeout: 8000 })
        .toBe('owned content');

      // Edit again (dirty), then Destroy → the save/discard/cancel prompt appears
      // (before the fix this hung: the dialog was never mounted in this window).
      await child.getByTestId('editor-p').locator('.cm-content').click();
      await child.keyboard.type(' more');
      await child.getByTestId('panel-handle-p').click({ button: 'right' });
      await menu(child, 'Destroy Panel').click();
      await expect(child.getByTestId('dirty-close-dialog')).toBeVisible({ timeout: 6000 });
      // Cancel leaves it in place (destroy is no longer blocked, just prompted).
      await child.getByTestId('dirty-close-cancel').click();
      await expect(child.getByTestId('editor-p')).toBeVisible();
    });
  } finally {
    rmSync(projectRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
    rmSync(outside, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
  }
});
