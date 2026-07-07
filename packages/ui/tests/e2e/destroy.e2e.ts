import { basename } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import { createProject, firstPanelId, runApp } from './harness.js';

// US3 / SC-005: Destroy flows use the shared confirm dialog with the configured
// confirmation level. A PANEL only confirms when it hosts a live terminal (losing
// a running shell is the destructive case); a plain Panel is removed immediately.
// Tab/Project destroys stay level-based. Cancelling any destroy leaves state
// unchanged (FR-025).

test('destroys an empty Panel immediately — no terminal, no confirmation', async () => {
  await runApp(async (_app, win) => {
    await createProject(win, 'Destroyer', 'C:/c/destroyer');
    await expect(win.getByTestId('tab-strip')).toBeVisible();

    // Two Panels so destroying one is allowed (the workspace keeps ≥ 1 Panel).
    const pid = await firstPanelId(win);
    await win.getByTestId(`panel-add-${pid}`).click();
    await expect(win.locator('.panel-box')).toHaveCount(2);
    await win.keyboard.press('Escape'); // dismiss the new Panel's rename input

    // Header × on an empty Panel → removed immediately, no confirmation.
    await win.getByTestId(`panel-close-${pid}`).click();
    await expect(win.getByTestId('confirm-dialog')).toHaveCount(0);
    await expect(win.locator('.panel-box')).toHaveCount(1);
  });
});

test('warns before destroying a Panel that hosts a live terminal', async () => {
  const root = mkdtempSync(join(tmpdir(), 'throng-destroy-term-'));
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'TermDestroy', root);
      const pid = await firstPanelId(win);

      // A second Panel so destroying the terminal Panel is allowed.
      await win.getByTestId(`panel-add-${pid}`).click();
      await expect(win.locator('.panel-box')).toHaveCount(2);
      await win.keyboard.press('Escape');

      // Turn the first Panel into a live Terminal.
      await win.getByTestId(`panel-type-select-${pid}`).selectOption('terminal');
      await win.getByTestId('terminal-flavour').selectOption('cmd');
      await win.getByTestId(`panel-type-confirm-${pid}`).click();
      // Wait until the shell prompt is live. This Panel is SPLIT (two panels), so the
      // full root path in the cmd prompt wraps across xterm rows; match only the temp
      // dir's trailing (random) chars, which land contiguously on the final wrapped row.
      await expect(win.getByTestId(`terminal-${pid}`)).toContainText(basename(root).slice(-6), {
        timeout: 15000,
      });

      // Header × on the Terminal Panel → confirmation fires (double level), because
      // the Panel hosts a live terminal.
      await win.getByTestId(`panel-close-${pid}`).click();
      await expect(win.getByTestId('confirm-dialog')).toBeVisible();
      await expect(win.getByTestId('confirm-dialog')).toContainText('running terminal');
      await win.getByTestId('confirm-accept').click(); // "Destroy Panel"
      await expect(win.getByTestId('confirm-dialog')).toContainText('absolutely sure');
      await win.getByTestId('confirm-accept').click(); // "Yes, I'm absolutely sure"

      await expect(win.locator('.panel-box')).toHaveCount(1);
      // Destroying killed the terminal; let the daemon clear the session before
      // teardown so the app-close handshake doesn't see a dying terminal.
      await win.waitForTimeout(1200);
    });
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 });
  }
});

test('cancelling a Tab destroy leaves all state unchanged (FR-025)', async () => {
  await runApp(async (_app, win) => {
    await createProject(win, 'Canceller', 'C:/c/canceller');
    await win.getByTestId('tab-add').click();
    await expect(win.locator('.tab-chip')).toHaveCount(2);

    const firstTab = win.locator('.tab-chip').first();
    await firstTab.click();
    await firstTab.click({ button: 'right' });
    await win.getByTestId('menu-item-Destroy Tab').click();

    // Cancel the first dialog → nothing is destroyed.
    await expect(win.getByTestId('confirm-dialog')).toBeVisible();
    await win.getByTestId('confirm-cancel').click();
    await expect(win.getByTestId('confirm-dialog')).toHaveCount(0);
    await expect(win.locator('.tab-chip')).toHaveCount(2);
  });
});
