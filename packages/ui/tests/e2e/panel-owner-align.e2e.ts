import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import { runApp, createProject, reloadWindow } from './harness.js';
import { skipIfElevated } from './admin.js';

// FR-087: in a sub-workspace window, a Panel's project/sub-workspace owner text is
// right-aligned in the header, immediately beside the Panel controls (not floating
// mid-header). Verified by geometry: the owner pill sits in the right portion of
// the header, just left of the actions.

const seedSub = `(() => window.throng.invoke('workspace.persistSubWorkspaces', { subWorkspaces: [
  { id: 'sw1', ownerUser: 'u', name: 'OwnerAlign', colour: '#3fb950',
    bounds: { x: 0, y: 0, width: 700, height: 460 },
    tabs: [{ id: 't', title: 'T', root: { type: 'panel', id: 'p', originProjectId: 'x', title: 'P' } }] },
] }))()`;

test('the sub-workspace/project owner text is right-aligned beside the panel controls', async () => {
  skipIfElevated();
  const root = mkdtempSync(join(tmpdir(), 'throng-owner-'));
  try {
    await runApp(async (app, win) => {
      await win.evaluate(seedSub);
      await reloadWindow(win);
      await createProject(win, 'Host', root);

      const [child] = await Promise.all([
        app.waitForEvent('window'),
        win.getByTestId('subworkspace-open-sw1').click(),
      ]);
      await child.waitForLoadState('domcontentloaded');

      const owner = child.getByTestId('panel-project-p');
      await expect(owner).toBeVisible();
      const ownerBox = await owner.boundingBox();
      const panelBox = await child.getByTestId('panel-p').boundingBox();
      expect(ownerBox).not.toBeNull();
      expect(panelBox).not.toBeNull();
      if (ownerBox && panelBox) {
        // Owner text is in the right portion of the header (right-aligned).
        expect(ownerBox.x).toBeGreaterThan(panelBox.x + panelBox.width * 0.5);
        // …and its right edge is near the panel's right edge (beside the controls).
        expect(ownerBox.x + ownerBox.width).toBeGreaterThan(panelBox.x + panelBox.width * 0.7);
      }
    });
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
  }
});
