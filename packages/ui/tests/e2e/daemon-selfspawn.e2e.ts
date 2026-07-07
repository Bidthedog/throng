import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import { runApp, createProject, reloadWindow } from './harness.js';

// Regression (T064/T066): with no daemon pre-spawned, the UI must spawn its OWN
// daemon via ensureDaemon — under Electron. The daemon's native modules
// (better-sqlite3) are built for host Node, so it MUST be spawned with host `node`,
// not the Electron binary; otherwise it crashes on a NODE_MODULE_VERSION mismatch,
// the UI reaches no daemon, and the project list is empty. This exercises that path.

test('the app spawns its own working daemon (host Node) and projects persist', async () => {
  const root = mkdtempSync(join(tmpdir(), 'throng-selfspawn-'));
  try {
    await runApp(
      async (_app, win) => {
        // Creating a project round-trips through the app-spawned daemon (RPC +
        // SQLite). If the daemon failed to start, this never appears.
        await createProject(win, 'SelfSpawn', root);

        // Reload so the list is re-fetched from the daemon (projects.list), proving
        // the daemon actually opened its DB and persisted the project — not just an
        // optimistic UI update.
        await reloadWindow(win);
        await expect(win.locator('.project-item', { hasText: 'SelfSpawn' })).toBeVisible({
          timeout: 15000,
        });
      },
      { skipDaemon: true },
    );
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 });
  }
});
