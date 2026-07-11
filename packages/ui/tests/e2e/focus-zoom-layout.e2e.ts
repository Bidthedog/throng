import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { runApp, createProject, firstPanelId, panelIds, reloadWindow } from './harness.js';
import { skipIfElevated } from './admin.js';

// 012 US4 (FR-005/006/010, SC-003): focus + per-type zoom survive layout changes.
// A sensible panel stays active across every transition, and each type's
// (project-scoped) zoom is retained — unchanged by structural change.

const seedSub = `(() => window.throng.invoke('workspace.persistSubWorkspaces', { subWorkspaces: [
  { id: 'sw1', ownerUser: 'u', name: 'Detached A', colour: '#3fb950',
    bounds: { x: 0, y: 0, width: 400, height: 300 },
    tabs: [{ id: 't', title: 'T', root: { type: 'panel', id: 'p', originProjectId: 'x', title: 'P' } }] },
] }))()`;

/** A panel's stored zoom level (the `data-zoom` attribute on its panel box). */
function panelZoom(win: Page, pid: string): Promise<number> {
  return win.getByTestId(`panel-${pid}`).evaluate((el) => Number((el as HTMLElement).dataset.zoom));
}

async function newEditor(win: Page, pid: string): Promise<void> {
  await win.getByTestId(`panel-type-select-${pid}`).selectOption('editor');
  await win.getByTestId(`panel-type-confirm-${pid}`).click();
  await expect(win.getByTestId(`editor-${pid}`)).toBeVisible();
}

test("a panel's zoom and a single active panel survive tab switch, split, and close (FR-005/010)", async () => {
  skipIfElevated();
  const root = mkdtempSync(join(tmpdir(), 'throng-fzl-'));
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'Survive', root);
      const p1 = await firstPanelId(win);
      await newEditor(win, p1);

      // Zoom this panel up.
      await win.getByTestId(`panel-${p1}`).click();
      await win.keyboard.press('Control+Alt+Equal');
      await win.keyboard.press('Control+Alt+Equal');
      await expect.poll(() => panelZoom(win, p1)).toBeGreaterThan(0);
      const level = await panelZoom(win, p1);

      // Tab switch → back: p1's own zoom is unchanged, one panel active.
      await win.getByTestId('tab-add').click();
      await win.keyboard.press('Enter');
      await expect(win.locator('.tab-chip')).toHaveCount(2);
      await win.locator('.tab-chip').first().click();
      expect(await panelZoom(win, p1)).toBe(level);
      await expect(win.locator('.panel-box--active')).toHaveCount(1);

      // Split (add a sibling panel) → p1's zoom unchanged, exactly one panel active.
      await win.getByTestId(`panel-add-${p1}`).click();
      await win.keyboard.press('Enter');
      await expect(win.locator('.panel-box')).toHaveCount(2);
      expect(await panelZoom(win, p1)).toBe(level);
      await expect(win.locator('.panel-box--active')).toHaveCount(1);

      // Activate the sibling then close it → focus re-homes to the FR-005 target
      // (p1, the preceding panel), still exactly one active, and p1 keeps its zoom.
      const [id1, id2] = await panelIds(win);
      const sibling = id1 === p1 ? id2 : id1;
      await win.getByTestId(`panel-${sibling}`).click();
      await expect(win.getByTestId(`panel-${sibling}`)).toHaveAttribute('data-active', 'true');
      await win.getByTestId(`panel-close-${sibling}`).click();
      await expect(win.locator('.panel-box')).toHaveCount(1);
      await expect(win.locator('.panel-box--active')).toHaveCount(1);
      await expect(win.getByTestId(`panel-${p1}`)).toHaveAttribute('data-active', 'true');
      expect(await panelZoom(win, p1)).toBe(level);
    });
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
  }
});

test('the main window and a detached sub-workspace hold independent active panels (FR-006)', async () => {
  const root = mkdtempSync(join(tmpdir(), 'throng-fzl2-'));
  try {
    await runApp(async (app, win) => {
      await createProject(win, 'MainProj', root);
      const p1 = await firstPanelId(win);
      await win.getByTestId(`panel-add-${p1}`).click();
      await win.keyboard.press('Enter');
      await expect(win.locator('.panel-box')).toHaveCount(2);
      await win.waitForTimeout(600); // let the debounced layout save flush before reload

      // Seed + open a sub-workspace window (its own single panel 'p').
      await win.evaluate(seedSub);
      await reloadWindow(win);
      await win.locator('.project-item', { hasText: 'MainProj' }).click();
      await expect(win.locator('.panel-box')).toHaveCount(2); // main layout restored
      await expect(win.getByTestId('subworkspace-name-sw1')).toHaveText('Detached A');
      const [child] = await Promise.all([
        app.waitForEvent('window'),
        win.getByTestId('subworkspace-open-sw1').click(),
      ]);
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
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
  }
});
