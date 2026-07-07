import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { runApp, createProject, reloadWindow } from './harness.js';
import { skipIfElevated } from './admin.js';

// Renaming a project MUST update that project's name shown in OTHER windows —
// specifically the owner text on sub-workspace panels — without needing a reload.

async function projectId(win: Page): Promise<string> {
  const tid = await win
    .locator('[data-testid^="project-switch-"]')
    .first()
    .getAttribute('data-testid');
  return (tid ?? '').replace('project-switch-', '');
}

test('renaming a project updates its name on sub-workspace panels live', async () => {
  skipIfElevated();
  const root = mkdtempSync(join(tmpdir(), 'throng-rensub-'));
  try {
    await runApp(async (app, win) => {
      await createProject(win, 'OldName', root);
      const pid = await projectId(win);

      // Seed a sub-workspace whose panel is OWNED by that project, then reload so it
      // appears, and open its window.
      await win.evaluate((originProjectId) => {
        return window.throng!.invoke!('workspace.persistSubWorkspaces', {
          subWorkspaces: [
            {
              id: 'sw1',
              ownerUser: 'u',
              name: 'SubA',
              colour: '#3fb950',
              bounds: { x: 0, y: 0, width: 700, height: 460 },
              tabs: [{ id: 't', title: 'T', root: { type: 'panel', id: 'p', originProjectId, title: 'P' } }],
            },
          ],
        });
      }, pid);
      await reloadWindow(win);

      const [child] = await Promise.all([
        app.waitForEvent('window'),
        win.getByTestId('subworkspace-open-sw1').click(),
      ]);
      await child.waitForLoadState('domcontentloaded');

      // The panel's owner text shows the project's CURRENT name.
      const owner = child.getByTestId('panel-project-p');
      await expect(owner).toContainText('OldName', { timeout: 10000 });

      // Rename the project in the MAIN window (inline).
      await win.getByTestId(`project-switch-${pid}`).dblclick();
      const rename = win.getByTestId(`project-rename-input-${pid}`);
      await rename.fill('BrandNewName');
      await rename.press('Enter');
      await expect(win.locator('.project-item', { hasText: 'BrandNewName' })).toBeVisible();

      // The sub-workspace window's panel owner text updates WITHOUT a reload.
      await expect(owner).toContainText('BrandNewName', { timeout: 10000 });
      await expect(owner).not.toContainText('OldName');
    });
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
  }
});
