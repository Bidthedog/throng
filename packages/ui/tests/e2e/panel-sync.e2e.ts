import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import { createProject, firstPanelId, runApp } from './harness.js';

// FR-027a (batch 2, revised 2026-07-02): a cloned Panel (same id in the project +
// its sub-workspaces) syncs its CONTENT across windows — the type-selection form
// draft (selected type + inputs) and the confirmed type mirror live (the terminal
// session already mirrors via FR-021). The active/selected Panel is deliberately
// NOT mirrored: sub-workspace focus is independent of the main window's selection.

test('the type-selection form syncs live across the project and sub-workspace windows', async () => {
  await runApp(async (app, win) => {
    await createProject(win, 'FormSync', 'C:/c/formsync');
    const a = await firstPanelId(win);

    // Clone the untyped Panel into a new sub-workspace window.
    await win.getByTestId(`panel-handle-${a}`).click({ button: 'right' });
    await win.getByTestId('menu-item-Sync to').click();
    const [child] = await Promise.all([
      app.waitForEvent('window'),
      win.getByTestId('menu-item-New Sub-workspace').click(),
    ]);
    await child.waitForLoadState('domcontentloaded');
    await expect(child.getByTestId(`panel-type-form-${a}`)).toBeVisible();

    // Select "terminal" in the MAIN window → the child's form mirrors it.
    await win.getByTestId(`panel-type-select-${a}`).selectOption('terminal');
    await expect(child.getByTestId(`panel-type-select-${a}`)).toHaveValue('terminal');
    await expect(child.getByTestId('terminal-inputs')).toBeVisible();

    // Edit Startup Params in the CHILD → the main window reflects it…
    await child.getByTestId('terminal-params').fill('--login --sync');
    await expect(win.getByTestId('terminal-params')).toHaveValue('--login --sync');
    // …and back the other way (main → child).
    await win.getByTestId('terminal-params').fill('--other');
    await expect(child.getByTestId('terminal-params')).toHaveValue('--other');
  });
});

test('confirming a Panel type in one window types the clone in the other', async () => {
  // A real project root so the terminal can actually launch (else it reverts to the form).
  const root = mkdtempSync(join(tmpdir(), 'throng-confirmsync-'));
  try {
    await runApp(async (app, win) => {
      await createProject(win, 'ConfirmSync', root);
      const a = await firstPanelId(win);

      await win.getByTestId(`panel-handle-${a}`).click({ button: 'right' });
      await win.getByTestId('menu-item-Sync to').click();
      const [child] = await Promise.all([
        app.waitForEvent('window'),
        win.getByTestId('menu-item-New Sub-workspace').click(),
      ]);
      await child.waitForLoadState('domcontentloaded');

      // Choose Terminal + a known flavour, then confirm in the MAIN window.
      await win.getByTestId(`panel-type-select-${a}`).selectOption('terminal');
      await win.getByTestId('terminal-flavour').selectOption('cmd');
      await win.getByTestId(`panel-type-confirm-${a}`).click();

      // Both windows leave the form and show the inline terminal for the same Panel
      // (one shared session, FR-021).
      await expect(win.getByTestId(`terminal-${a}`)).toBeVisible({ timeout: 15000 });
      await expect(child.getByTestId(`panel-type-form-${a}`)).toHaveCount(0);
      await expect(child.getByTestId(`terminal-${a}`)).toBeVisible({ timeout: 15000 });

      // Terminate the shared session before teardown so the app-close "terminals
      // still running" warning (FR-015e) doesn't block the automated close — the
      // convention every terminal-spawning E2E follows.
      await win.evaluate((id) => window.throng?.terminal?.kill?.(id), a);
      await win.waitForTimeout(1200);
    });
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 });
  }
});

test('panel selection is INDEPENDENT across windows (not mirrored)', async () => {
  await runApp(async (app, win) => {
    await createProject(win, 'ActiveSync', 'C:/c/activesync');
    const a = await firstPanelId(win);
    await win.getByTestId(`panel-add-${a}`).click();
    await win.keyboard.press('Enter');
    await expect(win.locator('.panel-box')).toHaveCount(2);
    const b = (await win.locator('.panel-box').evaluateAll((els) =>
      els.map((el) => (el as HTMLElement).dataset.panelId ?? ''),
    )).find((id) => id !== a)!;

    // Mirror BOTH panels into one sub-workspace: a into a new one, then b into it.
    await win.getByTestId(`panel-handle-${a}`).click({ button: 'right' });
    await win.getByTestId('menu-item-Sync to').click();
    const [child] = await Promise.all([
      app.waitForEvent('window'),
      win.getByTestId('menu-item-New Sub-workspace').click(),
    ]);
    await child.waitForLoadState('domcontentloaded');
    await win.getByTestId(`panel-handle-${b}`).click({ button: 'right' });
    await win.getByTestId('menu-item-Sync to').click();
    await win.getByTestId('menu-item-Sub-workspace 1').click();
    await win.getByTestId('menu-item-Sub-workspace Tab 1').click();
    await expect(child.getByTestId(`panel-${b}`)).toBeVisible();

    // Select a in the CHILD, then b in the MAIN window: the child's selection must
    // NOT follow the main window's (sub-workspace focus is independent).
    await child.getByTestId(`panel-${a}`).click({ position: { x: 5, y: 5 } });
    await expect(child.getByTestId(`panel-${a}`)).toHaveAttribute('data-active', 'true');
    await win.getByTestId(`panel-${b}`).click({ position: { x: 5, y: 5 } });
    await expect(win.getByTestId(`panel-${b}`)).toHaveAttribute('data-active', 'true');
    await win.waitForTimeout(400); // give any (unwanted) broadcast time to land
    await expect(child.getByTestId(`panel-${a}`)).toHaveAttribute('data-active', 'true');
    await expect(child.getByTestId(`panel-${b}`)).toHaveAttribute('data-active', 'false');

    // And the reverse: selecting in the CHILD must not move the main window's focus.
    await win.getByTestId(`panel-${a}`).click({ position: { x: 5, y: 5 } });
    await expect(win.getByTestId(`panel-${a}`)).toHaveAttribute('data-active', 'true');
    await child.getByTestId(`panel-${b}`).click({ position: { x: 5, y: 5 } });
    await expect(child.getByTestId(`panel-${b}`)).toHaveAttribute('data-active', 'true');
    await child.waitForTimeout(400);
    await expect(win.getByTestId(`panel-${a}`)).toHaveAttribute('data-active', 'true');
    await expect(win.getByTestId(`panel-${b}`)).toHaveAttribute('data-active', 'false');
  });
});
