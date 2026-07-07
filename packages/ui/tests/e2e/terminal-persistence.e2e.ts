import { basename } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { test, expect } from '@playwright/test';
import { runApp, createProject, firstPanelId } from './harness.js';

// FR-019 restore arm (dedicated E2E, T130): a Terminal Panel persisted with a flavour
// that is no longer available at restore time must surface the unavailability — NOT a
// blank terminal. (Reattach + scrollback and the app-close three-choice prompt are
// covered by terminal-reattach.e2e / app-close-terminals.e2e; this covers the arm those
// don't: the panel restores, its attach with the missing flavour fails, and the Panel
// reverts to the type-selection form with the failure surfaced.)

test('a Panel restored with a now-removed flavour surfaces unavailability, not a blank terminal', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'throng-persist-flavour-'));
  const root = mkdtempSync(join(tmpdir(), 'throng-persist-root-'));
  try {
    // Run 1: confirm a real cmd terminal so the layout persists a Terminal Panel whose
    // config records flavourId "cmd".
    await runApp(
      async (_app, win) => {
        await createProject(win, 'Persist', root);
        const pid = await firstPanelId(win);
        await win.getByTestId(`panel-type-select-${pid}`).selectOption('terminal');
        await win.getByTestId('terminal-flavour').selectOption('cmd');
        await win.getByTestId(`panel-type-confirm-${pid}`).click();
        await expect(win.getByTestId(`terminal-${pid}`)).toContainText(basename(root), { timeout: 20000 });
        await win.waitForTimeout(900); // layout save debounce (400ms) + slack
      },
      { dataDir },
    );

    // Between runs, simulate the flavour being removed: rewrite the persisted layout so
    // the Panel references a flavour that no longer resolves on this machine.
    const db = new Database(join(dataDir, 'throng.db'));
    const changed = db
      .prepare('UPDATE workspace_layout SET layout_json = REPLACE(layout_json, ?, ?)')
      .run('"flavourId":"cmd"', '"flavourId":"ghost-removed-flavour"');
    db.close();
    expect(changed.changes).toBeGreaterThan(0); // the terminal config was persisted & rewritten

    // Run 2: open the project → the Panel restores, its terminal attaches with the
    // missing flavour, and the failure is surfaced (reverted to the form with exit info)
    // rather than left as a blank terminal.
    await runApp(
      async (_app, win) => {
        await win
          .locator('.project-item', { hasText: 'Persist' })
          .locator('[data-testid^="project-switch-"]')
          .click();

        const exit = win.locator('[data-testid^="panel-exit-"]');
        await expect(exit).toBeVisible({ timeout: 20000 });
        await expect(exit).toContainText(/not available|unavailable|ghost-removed-flavour/i);
        // And the Panel is back to the type-selection form (re-typeable), not a terminal.
        await expect(win.locator('[data-testid^="panel-type-form-"]')).toBeVisible();
        await expect(win.locator('[data-testid^="terminal-"]')).toHaveCount(0);
      },
      { dataDir },
    );
  } finally {
    rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});
