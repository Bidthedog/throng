import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { addPanels, createProject, firstPanelId, runApp } from './harness.js';

// FR-026 (batch 2, clarified 2026-07-01): the destroy cascade is ONE-directional.
// A Panel belongs to its project. Destroying it IN THE PROJECT removes it from the
// project and from every sub-workspace mirroring it (with a highlighted warning,
// FR-026a; an emptied sub-workspace is deleted, FR-026b). Destroying it INSIDE a
// sub-workspace is LOCAL — it only leaves that sub-workspace; the project keeps it.

async function panelIds(page: Page): Promise<string[]> {
  return page.locator('.panel-box').evaluateAll((els) =>
    els.map((el) => (el as HTMLElement).dataset.panelId ?? ''),
  );
}

/** Project with two Panels [a, b] where b is mirrored into a NEW sub-workspace
 *  window (clone; b stays in the project). Returns the ids and the child window. */
async function projectWithMirroredPanel(app: ElectronApplication, win: Page) {
  await createProject(win, 'Cascade', 'C:/c/cascade');
  const a = await firstPanelId(win);
  // Use the shared helper (017 FR-013a): a bare `panel-add` + `press('Enter')` races the
  // new panel's autoFocus'd rename input — press Enter too early and the add BUTTON
  // re-activates, adding a panel nobody asked for. addPanels settles on both.
  await addPanels(win, 1);
  const b = (await panelIds(win)).find((id) => id !== a)!;

  await win.getByTestId(`panel-handle-${b}`).click({ button: 'right' });
  await win.getByTestId('menu-item-Sync to').click();
  const [child] = await Promise.all([
    app.waitForEvent('window'),
    win.getByTestId('menu-item-New Sub-workspace').click(),
  ]);
  await child.waitForLoadState('domcontentloaded');
  await expect(child.getByTestId(`panel-${b}`)).toBeVisible();
  await expect(win.locator('.panel-box')).toHaveCount(2); // b still in the project
  return { a, b, child };
}

test('destroying a mirrored Panel in the PROJECT removes it from the sub-workspace too (with warning)', async () => {
  await runApp(async (app, win) => {
    const { a, b, child } = await projectWithMirroredPanel(app, win);

    await win.getByTestId(`panel-handle-${b}`).click({ button: 'right' });
    await win.getByTestId('menu-item-Destroy Panel').click();
    // The project destroy warns it also affects the sub-workspace holding the mirror.
    await expect(win.getByTestId('confirm-warning')).toContainText(/sub-workspace/i);
    await win.getByTestId('confirm-accept').click();

    // Project keeps only a; the sub-workspace (only held b) is emptied → its window closes.
    await expect(win.locator('.panel-box')).toHaveCount(1);
    expect((await panelIds(win))[0]).toBe(a);
    await expect.poll(() => child.isClosed()).toBe(true);
  });
});

test('destroying a mirrored Panel INSIDE a sub-workspace is local — the project keeps it', async () => {
  await runApp(async (app, win) => {
    const { a, b, child } = await projectWithMirroredPanel(app, win);

    // Give the sub-workspace a 2nd Panel so destroying b doesn't hit the never-empty
    // guard, then destroy b INSIDE the sub-workspace window.
    await addPanels(child, 1);

    await child.getByTestId(`panel-handle-${b}`).click({ button: 'right' });
    await child.getByTestId('menu-item-Close Panel').click();
    // Empty Panel + local destroy → no confirmation dialog is shown.
    await expect(child.getByTestId('confirm-dialog')).toHaveCount(0);

    // b is gone from the sub-workspace…
    await expect(child.getByTestId(`panel-${b}`)).toHaveCount(0);
    await expect(child.locator('.panel-box')).toHaveCount(1);
    // …but the PROJECT still has both a and b (the cascade does NOT go upward).
    await expect(win.locator('.panel-box')).toHaveCount(2);
    expect((await panelIds(win)).sort()).toEqual([a, b].sort());
  });
});

test('destroying a mirrored TERMINAL Panel inside a sub-workspace keeps the session running in the project', async () => {
  // Revision (2026-07-02): a local sub-workspace destroy of a CLONED project Panel
  // must NOT kill the shared terminal session — the project keeps the Panel AND its
  // live terminal (FR-021/026); only the sub-workspace's view goes away.
  const root = mkdtempSync(join(tmpdir(), 'throng-cascade-term-'));
  try {
    await runApp(async (app, win) => {
      await createProject(win, 'CascadeTerm', root);
      const a = await firstPanelId(win);

      // Type the Panel as a Terminal and let it launch.
      await win.getByTestId(`panel-type-select-${a}`).selectOption('terminal');
      await win.getByTestId('terminal-flavour').selectOption('cmd');
      await win.getByTestId(`panel-type-confirm-${a}`).click();
      await expect(win.getByTestId(`terminal-${a}`)).toBeVisible({ timeout: 15000 });

      // Mirror it into a new sub-workspace (one shared session, both views live).
      await win.getByTestId(`panel-handle-${a}`).click({ button: 'right' });
      await win.getByTestId('menu-item-Sync to').click();
      const [child] = await Promise.all([
        app.waitForEvent('window'),
        win.getByTestId('menu-item-New Sub-workspace').click(),
      ]);
      await child.waitForLoadState('domcontentloaded');
      await expect(child.getByTestId(`terminal-${a}`)).toBeVisible({ timeout: 15000 });

      // A 2nd Panel in the sub-workspace so destroying a isn't the last-panel case.
      // addPanels also handles the live terminal in the sibling panel stealing focus back
      // (which commits the rename on blur and unmounts the input) — a legitimate outcome
      // the bare press('Enter') could not distinguish from a lost keystroke.
      await addPanels(child, 1);

      // Destroy the terminal Panel INSIDE the sub-workspace. The confirmation must
      // NOT threaten termination — the session survives in the project.
      await child.getByTestId(`panel-handle-${a}`).click({ button: 'right' });
      await child.getByTestId('menu-item-Close Panel').click();
      // Active-panel destroy defaults to 'double' → two confirms; NEITHER may say
      // the terminal will be terminated (it keeps running in the project).
      await expect(child.getByTestId('confirm-dialog')).toBeVisible();
      await expect(child.getByTestId('confirm-message')).toContainText(/keeps running/i);
      await expect(child.getByTestId('confirm-message')).not.toContainText(/will be terminated/i);
      await child.getByTestId('confirm-accept').click();
      await expect(child.getByTestId('confirm-message')).toContainText(/keeps running/i);
      await child.getByTestId('confirm-accept').click();
      await expect(child.getByTestId(`panel-${a}`)).toHaveCount(0);

      // Proof the shared session was NOT killed: had it exited, the project's
      // terminal would revert to the type-selection form (FR-020). Instead the
      // project keeps the live terminal view and never shows the form.
      await expect(win.getByTestId(`terminal-${a}`)).toBeVisible();
      await win.waitForTimeout(1000); // give any (unwanted) exit→revert time to happen
      await expect(win.getByTestId(`terminal-${a}`)).toBeVisible();
      await expect(win.getByTestId(`panel-type-form-${a}`)).toHaveCount(0);

      // Terminate before teardown so the app-close warning can't block it.
      await win.evaluate((id) => window.throng?.terminal?.kill?.(id), a);
      await win.waitForTimeout(1200);
    });
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 });
  }
});
