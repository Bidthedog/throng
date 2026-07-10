import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { runApp, createProject, firstPanelId, reloadWindow, daemonRpc } from './harness.js';
import { skipIfElevated } from './admin.js';

/**
 * 008 User Story 1 (SC-001/SC-004). A long-running program in a project terminal MUST
 * survive being mirrored into a new sub-workspace window: the same session is presented
 * in both windows, the program keeps running, and neither window reports a connection
 * error or reverts to the type-selection form. Mirroring via the panel's "Sync to →
 * Mirror" menu is the app equivalent of dragging the tab into the sub-workspace.
 */

// An (initially empty) sub-workspace with one tab "T"; the running terminal panel is
// mirrored into it below via the panel context menu.
const seedSub = `(() => window.throng.invoke('workspace.persistSubWorkspaces', { subWorkspaces: [
  { id: 'sw1', ownerUser: 'u', name: 'Mirror', colour: '#3fb950',
    bounds: { x: 40, y: 40, width: 660, height: 460 },
    tabs: [{ id: 't', title: 'T', root: { type: 'panel', id: 'seed', originProjectId: 'x', title: 'P' } }] },
] }))()`;

async function newTerminal(win: Page, root: string): Promise<string> {
  const pid = await firstPanelId(win);
  await win.getByTestId(`panel-type-select-${pid}`).selectOption('terminal');
  await win.getByTestId('terminal-flavour').selectOption('cmd');
  await win.getByTestId(`panel-type-confirm-${pid}`).click();
  // The live terminal shows the project root in its prompt — proof it attached.
  await expect(win.getByTestId(`terminal-${pid}`)).toContainText(basename(root), { timeout: 20000 });
  return pid;
}

test('a running terminal survives being mirrored into a new sub-workspace and streams to both windows', async () => {
  skipIfElevated();
  const root = mkdtempSync(join(tmpdir(), 'throng-termsurv-'));
  try {
    await runApp(async (app, win, { pipeName }) => {
      await win.evaluate(seedSub);
      await reloadWindow(win);
      await createProject(win, 'Survive', root);
      const pid = await newTerminal(win, root);

      // Open the sub-workspace window, then mirror the RUNNING terminal into its Tab "T".
      const [child] = await Promise.all([
        app.waitForEvent('window'),
        win.getByTestId('subworkspace-open-sw1').click(),
      ]);
      await child.waitForLoadState('domcontentloaded');

      // "Sync to" → <sub-workspace name "Mirror"> → tab "T". Submenu parents open on a
      // hover dwell, so hover them (keeping the pointer there) and click only the leaf tab.
      await win.getByTestId(`panel-handle-${pid}`).click({ button: 'right' });
      await win.getByTestId('menu-item-Sync to').hover();
      await win.getByTestId('menu-item-Mirror').hover();
      await win.getByTestId('menu-item-T').click();

      // The sub-workspace shows the SAME terminal — not the type form, not an error.
      await expect(child.getByTestId(`terminal-${pid}`)).toBeVisible({ timeout: 20000 });
      await expect(child.locator('[data-testid^="panel-exit-"]')).toHaveCount(0);
      await expect(win.locator('[data-testid^="panel-exit-"]')).toHaveCount(0);
      await expect(win.getByTestId(`terminal-${pid}`)).toBeVisible();

      // Exactly ONE running session for the panel — the program was NOT reaped by the mirror.
      const listed = (await daemonRpc(pipeName, 'terminal.list', {})) as {
        sessions: Array<{ panelId: string; status: string }>;
      };
      const sessions = listed.sessions.filter((s) => s.panelId === pid);
      expect(sessions).toHaveLength(1);
      expect(sessions[0].status).toBe('running');

      // A command run AFTER the mirror still executes and streams to BOTH windows —
      // the same live program, presented twice.
      await daemonRpc(pipeName, 'terminal.write', { panelId: pid, data: 'echo SURVIVED_9137\r\n' });
      await expect(win.getByTestId(`terminal-${pid}`)).toContainText('SURVIVED_9137', { timeout: 20000 });
      await expect(child.getByTestId(`terminal-${pid}`)).toContainText('SURVIVED_9137', { timeout: 20000 });
    });
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
  }
});
