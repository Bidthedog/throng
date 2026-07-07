import { basename } from 'node:path';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import { runApp, createProject, firstPanelId, daemonRpc } from './harness.js';
import { skipIfElevated } from './admin.js';

// FR-022 (dedicated E2E, T129): while a project has an open terminal, the daemon holds
// the project root (IDirectoryLock), so the root folder can't be deleted/moved and the
// project's root path can't be edited. After all terminals close, both are allowed
// again. We exercise the real directory lock (OS refuses to remove the cwd of a live
// shell) and the FR-022 root-path-edit guard (projects.update is rejected).

test('an open terminal locks the project root against deletion and root-path edits', async () => {
  skipIfElevated();
  const root = mkdtempSync(join(tmpdir(), 'throng-rootlock-'));
  const elsewhere = mkdtempSync(join(tmpdir(), 'throng-rootlock-new-'));
  try {
    await runApp(async (_app, win, { pipeName }) => {
      await createProject(win, 'Locked', root);
      const pid = await firstPanelId(win);

      // Confirm a live terminal rooted at the project (its cwd == the root).
      await win.getByTestId(`panel-type-select-${pid}`).selectOption('terminal');
      await win.getByTestId('terminal-flavour').selectOption('cmd');
      await win.getByTestId(`panel-type-confirm-${pid}`).click();
      await expect(win.getByTestId(`terminal-${pid}`)).toContainText(basename(root), { timeout: 20000 });

      const projects = (await daemonRpc(pipeName, 'projects.list')) as { projects: { id: string }[] };
      const projectId = projects.projects[0].id;

      // 1) The root folder is locked: the OS refuses to remove a live shell's cwd.
      expect(() => rmSync(root, { recursive: true })).toThrow();
      expect(existsSync(root)).toBe(true);

      // 2) The root PATH can't be edited while a terminal is open (FR-022 guard):
      //    projects.update with a new rootFolder is rejected (null = error response).
      const blocked = await daemonRpc(pipeName, 'projects.update', {
        id: projectId,
        rootFolder: elsewhere,
      });
      expect(blocked).toBeNull();

      // Close the terminal → the lock is released.
      await win.evaluate((id) => window.throng?.terminal?.kill?.(id), pid);
      await expect(win.getByTestId(`panel-type-form-${pid}`)).toBeVisible({ timeout: 15000 });
      // Give the daemon a moment to release the lock on the exit event.
      await win.waitForTimeout(600);

      // 3) With no open terminals, the root path can be edited again.
      const allowed = (await daemonRpc(pipeName, 'projects.update', {
        id: projectId,
        rootFolder: elsewhere,
      })) as { project?: { rootFolder: string } } | null;
      expect(allowed?.project?.rootFolder).toBe(elsewhere);
    });
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 });
    rmSync(elsewhere, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 });
  }
});
