import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import { runApp, createProject, firstPanelId, panelIds, reloadWindow, cleanupTemp, splitPanelViaMenu } from './harness.js';
import { openSubWorkspaceWindow } from './helpers/subworkspace-open.js';

// 012 US4 (FR-005/006/010, SC-003): focus + per-type zoom survive layout changes.
// A sensible panel stays active across every transition, and each type's
// (project-scoped) zoom is retained — unchanged by structural change.

const seedSub = `(() => window.throng.invoke('workspace.persistSubWorkspaces', { subWorkspaces: [
  { id: 'sw1', ownerUser: 'u', name: 'Detached A', colour: '#3fb950',
    bounds: { x: 0, y: 0, width: 400, height: 300 },
    tabs: [{ id: 't', title: 'T', root: { type: 'panel', id: 'p', originProjectId: 'x', title: 'P' } }] },
] }))()`;

// MOVED DOWN: "a panel's zoom and a single active panel survive tab switch, split, and close (FR-005/010)".
// The zoom half is core's workspace-operations.test.ts ("a panel's zoom is unchanged by a tab switch, a split and
// the close of a sibling"), red-proven against a zoom-dropping addPanel and removePanel. The focus re-homing half
// is core's active-panel.test.ts (panelAfterRemoval, FR-005).

test('the main window and a detached sub-workspace hold independent active panels (FR-006)', { tag: ['@extended', '@window', '@reserve:window'] }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'throng-fzl2-'));
  try {
    await runApp(async (app, win) => {
      await createProject(win, 'MainProj', root);
      const p1 = await firstPanelId(win);
      await splitPanelViaMenu(win, p1);
      await expect(win.locator('.panel-box')).toHaveCount(2);
      // sleep-justified: the layout blob sits behind workspace-store's fixed 400ms debounce
      // sleep-justified: (layout-saves.ts:5) and the write is fire-and-forget past it — nothing on
      // sleep-justified: `window` reports when the save actually lands, only `settleLayoutSaves()`
      // sleep-justified: does (main.tsx's app-close drain), which reloadWindow below does not run.
      await win.waitForTimeout(600);

      // Seed + open a sub-workspace window (its own single panel 'p').
      await win.evaluate(seedSub);
      await reloadWindow(win);
      await win.locator('.project-item', { hasText: 'MainProj' }).click();
      await expect(win.locator('.panel-box')).toHaveCount(2); // main layout restored
      await expect(win.getByTestId('subworkspace-name-sw1')).toHaveText('Detached A');
      const child = await openSubWorkspaceWindow(app, win, 'sw1');
      await child.waitForLoadState('domcontentloaded');
      await expect(child.getByTestId('panel-p')).toBeVisible();

      // The sub-workspace window's panel is its own active panel.
      await expect(child.getByTestId('panel-p')).toHaveAttribute('data-active', 'true');

      // Activate panels in the MAIN window — the sub-workspace's active panel does
      // NOT change (per-window focus context, distinct from the OS focus/raise group).
      const [mp1, mp2] = await panelIds(win);
      await win.getByTestId(`panel-${mp1}`).click();
      await expect(win.getByTestId(`panel-${mp1}`)).toHaveAttribute('data-active', 'true');
      await expect(child.getByTestId('panel-p')).toHaveAttribute('data-active', 'true');

      await win.getByTestId(`panel-${mp2}`).click();
      await expect(win.getByTestId(`panel-${mp2}`)).toHaveAttribute('data-active', 'true');
      await expect(win.getByTestId(`panel-${mp1}`)).toHaveAttribute('data-active', 'false');
      // The sub-workspace is untouched throughout — independent focus contexts.
      await expect(child.getByTestId('panel-p')).toHaveAttribute('data-active', 'true');
      await expect(child.locator('.panel-box--active')).toHaveCount(1);
    });
  } finally {
    cleanupTemp(root);
  }
});
