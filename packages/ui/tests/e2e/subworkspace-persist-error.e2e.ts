import { test, expect } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProject, runApp, seedDatabase } from './harness.js';

// Regression for the silent-failure half of the "cannot create sub-workspaces"
// defect: when persisting a detached sub-workspace fails in the daemon, the
// renderer used to swallow the rejection in a fire-and-forget async block, so the
// user saw *nothing*. Now a failed create MUST surface an error instead.
//
// We simulate a daemon-side persist failure deterministically by seeding a trigger
// that aborts any INSERT into sub_workspaces.

test('surfaces an error when persisting a new sub-workspace fails', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'throng-e2e-persistfail-'));
  seedDatabase(dataDir, (db) => {
    db.exec(`
      CREATE TRIGGER block_subworkspace_insert BEFORE INSERT ON sub_workspaces
      BEGIN
        SELECT RAISE(ABORT, 'simulated persist failure');
      END;
    `);
  });

  try {
    await runApp(
      async (app, win) => {
        await createProject(win, 'Failer', 'C:/c/failer');
        await expect(win.getByTestId('tab-strip')).toBeVisible();

        // Attempt to detach the first Tab into a new sub-workspace.
        const firstTab = win.locator('.tab-chip').first();
        await firstTab.click();
        await firstTab.click({ button: 'right' });
        await expect(win.getByTestId('context-menu')).toBeVisible();
        await win.getByTestId('menu-item-Sync to').click();
        await win.getByTestId('menu-item-New Sub-workspace').click();

        // The create fails in the daemon — the user must SEE that, not silence.
        await expect(win.getByTestId('subworkspace-error')).toBeVisible();
        await expect(win.getByTestId('subworkspace-error')).toContainText(/fail/i);

        // And no phantom sub-workspace is listed.
        await expect(win.getByTestId('subworkspace-list')).not.toContainText('Sub-workspace 1');
      },
      { dataDir },
    );
  } finally {
    rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
