import { test, expect } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProject, runApp, seedDatabase } from './harness.js';

// End-to-end regression for the reported defect: a developer DB left half-migrated
// by an intermediate build — stamped to the latest user_version, but its
// sub_workspaces table missing the name/colour columns a later-renumbered
// migration was meant to add. Before the schema-guard fix, the version-keyed
// runner saw "already current" and did nothing, so every create silently failed.
// The daemon must now heal the drift on startup, making creation work again.

test('creating a sub-workspace works after the daemon heals a drifted DB', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'throng-e2e-drift-'));

  // Seed the exact drifted shape: full schema, then rebuild sub_workspaces WITHOUT
  // name/colour while leaving user_version at the latest (so a naive runner skips).
  seedDatabase(dataDir, (db) => {
    const latest = db.pragma('user_version', { simple: true });
    db.exec('DROP TABLE IF EXISTS sub_workspaces');
    db.exec(`
      CREATE TABLE sub_workspaces (
        id           TEXT PRIMARY KEY,
        owner_user   TEXT NOT NULL,
        bounds_json  TEXT NOT NULL,
        content_json TEXT NOT NULL,
        updated_at   TEXT NOT NULL,
        position     INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX idx_subws_owner ON sub_workspaces(owner_user);
    `);
    db.pragma(`user_version = ${latest}`);
  });

  try {
    await runApp(
      async (app, win) => {
        await createProject(win, 'Drifter', 'C:/c/drifter');
        await expect(win.getByTestId('tab-strip')).toBeVisible();

        // Detach the first Tab into a new sub-workspace.
        const firstTab = win.locator('.tab-chip').first();
        await firstTab.click();
        await firstTab.click({ button: 'right' });
        await expect(win.getByTestId('context-menu')).toBeVisible();
        await win.getByTestId('menu-item-Sync to').click();

        const [child] = await Promise.all([
          app.waitForEvent('window'),
          win.getByTestId('menu-item-New Sub-workspace').click(),
        ]);
        await child.waitForLoadState('domcontentloaded');

        // It actually got created and persisted (no silent failure, no error).
        await expect(child.getByTestId('subworkspace-window')).toBeVisible();
        await expect(win.getByTestId('subworkspace-list')).toContainText('Sub-workspace 1');
        await expect(win.getByTestId('subworkspace-error')).toHaveCount(0);
      },
      { dataDir },
    );
  } finally {
    rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
