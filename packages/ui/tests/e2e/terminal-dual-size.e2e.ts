import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { runApp, createProject, firstPanelId, reloadWindow, daemonRpc } from './harness.js';
import { skipIfElevated } from './admin.js';

/**
 * 008 User Story 2 (SC-002/SC-003). One terminal session presented in two windows of
 * DIFFERENT pixel sizes MUST render legibly in both: the daemon sizes the shared PTY to
 * the smallest attached view, so no view ever receives output wider than its own grid,
 * and the larger view simply shows background padding. The prior last-writer-wins resize
 * garbled one of the two views. Here a distinctive marker must appear INTACT in both the
 * large main window and the small sub-workspace window, and stay intact across focus
 * changes (which must transmit no resize).
 */

// A deliberately SMALL sub-workspace window (the main window is the default 1280×800),
// so the two views are meaningfully different sizes.
const seedSmallSub = `(() => window.throng.invoke('workspace.persistSubWorkspaces', { subWorkspaces: [
  { id: 'sw1', ownerUser: 'u', name: 'Small', colour: '#3fb950',
    bounds: { x: 30, y: 30, width: 520, height: 340 },
    tabs: [{ id: 't', title: 'T', root: { type: 'panel', id: 'seed', originProjectId: 'x', title: 'P' } }] },
] }))()`;

async function newTerminal(win: Page, root: string): Promise<string> {
  const pid = await firstPanelId(win);
  await win.getByTestId(`panel-type-select-${pid}`).selectOption('terminal');
  await win.getByTestId('terminal-flavour').selectOption('cmd');
  await win.getByTestId(`panel-type-confirm-${pid}`).click();
  await expect(win.getByTestId(`terminal-${pid}`)).toContainText(basename(root), { timeout: 20000 });
  return pid;
}

test('one terminal in two different-sized windows renders legibly in both, stable across focus', async () => {
  skipIfElevated();
  const root = mkdtempSync(join(tmpdir(), 'throng-dualsize-'));
  try {
    await runApp(async (app, win, { pipeName }) => {
      await win.evaluate(seedSmallSub);
      await reloadWindow(win);
      await createProject(win, 'DualSize', root);
      const pid = await newTerminal(win, root);

      const [child] = await Promise.all([
        app.waitForEvent('window'),
        win.getByTestId('subworkspace-open-sw1').click(),
      ]);
      await child.waitForLoadState('domcontentloaded');

      // "Sync to" → <sub-workspace name "Small"> → tab "T". Submenu parents open on a
      // hover dwell, so hover them (keeping the pointer there) and click only the leaf tab.
      await win.getByTestId(`panel-handle-${pid}`).click({ button: 'right' });
      await win.getByTestId('menu-item-Sync to').hover();
      await win.getByTestId('menu-item-Small').hover();
      await win.getByTestId('menu-item-T').click();
      await expect(child.getByTestId(`terminal-${pid}`)).toBeVisible({ timeout: 20000 });

      // A distinctive marker must render INTACT (not garbled, wrapped-wrong, or
      // duplicated) in BOTH the large and the small window — the corruption defect.
      await daemonRpc(pipeName, 'terminal.write', { panelId: pid, data: 'echo DUALSIZE_MARKER_42\r\n' });
      await expect(win.getByTestId(`terminal-${pid}`)).toContainText('DUALSIZE_MARKER_42', { timeout: 20000 });
      await expect(child.getByTestId(`terminal-${pid}`)).toContainText('DUALSIZE_MARKER_42', { timeout: 20000 });

      // Switching focus between the two windows must not corrupt either view (no resize
      // is transmitted on a focus change — SC-003), so the content stays intact.
      await child.bringToFront();
      await win.bringToFront();
      await daemonRpc(pipeName, 'terminal.write', { panelId: pid, data: 'echo AFTER_FOCUS_88\r\n' });
      await expect(win.getByTestId(`terminal-${pid}`)).toContainText('AFTER_FOCUS_88', { timeout: 20000 });
      await expect(child.getByTestId(`terminal-${pid}`)).toContainText('AFTER_FOCUS_88', { timeout: 20000 });
      // Both markers remain present and intact in both windows (nothing was garbled away).
      await expect(win.getByTestId(`terminal-${pid}`)).toContainText('DUALSIZE_MARKER_42');
      await expect(child.getByTestId(`terminal-${pid}`)).toContainText('DUALSIZE_MARKER_42');
    });
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
  }
});
