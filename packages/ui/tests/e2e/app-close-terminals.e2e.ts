import { basename } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import type { ElectronApplication } from '@playwright/test';
import { runApp, createProject, firstPanelId, panelIds } from './harness.js';
import { skipIfElevated } from './admin.js';

// T068 (US3 / FR-015): closing the app while terminals are running must warn with
// a three-choice prompt (leave running / terminate all / cancel) instead of
// silently killing them. Cancel keeps the app open.

/** Ask the main process to close the primary window (fires the close handshake). */
async function requestClose(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.close());
}

test('closing with a running terminal shows the three-choice warning; Cancel keeps it open', async () => {
  skipIfElevated();
  const root = mkdtempSync(join(tmpdir(), 'throng-close-'));
  try {
    await runApp(async (app, win) => {
      await createProject(win, 'Close', root);
      const pid = await firstPanelId(win);
      await win.getByTestId(`panel-type-select-${pid}`).selectOption('terminal');
      await win.getByTestId('terminal-flavour').selectOption('cmd');
      await win.getByTestId(`panel-type-confirm-${pid}`).click();

      const term = win.getByTestId(`terminal-${pid}`);
      await expect(term).toBeVisible();
      await expect(term).toContainText(basename(root), { timeout: 15000 });

      // Request the app close → the warning appears (a terminal is running).
      await requestClose(app);
      const dialog = win.getByTestId('app-close-dialog');
      await expect(dialog).toBeVisible({ timeout: 10000 });
      await expect(win.getByTestId('app-close-message')).toContainText('1 terminal');
      await expect(win.getByTestId('app-close-leave')).toBeVisible();
      await expect(win.getByTestId('app-close-terminate')).toBeVisible();
      await expect(win.getByTestId('app-close-cancel')).toBeVisible();

      // Cancel → the warning closes and the app stays open with its terminal.
      await win.getByTestId('app-close-cancel').click();
      await expect(dialog).toBeHidden();
      await expect(term).toBeVisible();

      // Exit the shell so teardown closes cleanly (no running terminals).
      await term.click();
      await win.keyboard.type('exit');
      await win.keyboard.press('Enter');
      await expect(win.getByTestId(`panel-type-form-${pid}`)).toBeVisible({ timeout: 15000 });
    });
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 });
  }
});

test('“Terminate all” closes the app', async () => {
  const root = mkdtempSync(join(tmpdir(), 'throng-close2-'));
  try {
    await runApp(async (app, win) => {
      await createProject(win, 'Close2', root);
      const pid = await firstPanelId(win);
      await win.getByTestId(`panel-type-select-${pid}`).selectOption('terminal');
      await win.getByTestId('terminal-flavour').selectOption('cmd');
      await win.getByTestId(`panel-type-confirm-${pid}`).click();
      const term = win.getByTestId(`terminal-${pid}`);
      await expect(term).toContainText(basename(root), { timeout: 15000 });

      await requestClose(app);
      await expect(win.getByTestId('app-close-dialog')).toBeVisible({ timeout: 10000 });

      // Terminate all → the daemon kills the sessions and the app quits. (The
      // transient "Closing your terminals…" overlay races the fast quit; the closing
      // overlay text is asserted in the plain-close case below.)
      const closed = app.waitForEvent('close', { timeout: 10000 });
      await win.getByTestId('app-close-terminate').click();
      await closed;
    });
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 });
  }
});

test('warns with the right count when several terminals run (incl. a busy one)', async () => {
  skipIfElevated();
  const root = mkdtempSync(join(tmpdir(), 'throng-close-many-'));
  try {
    await runApp(async (app, win) => {
      await createProject(win, 'Many', root);
      const a = await firstPanelId(win);

      // Panel A → terminal, then run a long command so it is busy.
      await win.getByTestId(`panel-type-select-${a}`).selectOption('terminal');
      await win.getByTestId('terminal-flavour').selectOption('cmd');
      await win.getByTestId(`panel-type-confirm-${a}`).click();
      await expect(win.getByTestId(`terminal-${a}`)).toContainText(basename(root), { timeout: 15000 });
      await win.getByTestId(`terminal-${a}`).click();
      await win.keyboard.type('ping -n 30 127.0.0.1');
      await win.keyboard.press('Enter');

      // Add Panel B → a second terminal.
      await win.getByTestId(`panel-add-${a}`).click();
      const b = (await panelIds(win)).find((id) => id !== a)!;
      await win.keyboard.press('Escape');
      await win.getByTestId(`panel-type-select-${b}`).selectOption('terminal');
      await win.getByTestId('terminal-flavour').selectOption('cmd');
      await win.getByTestId(`panel-type-confirm-${b}`).click();
      // Panel B is SPLIT (narrow), so its cmd prompt path wraps across xterm rows —
      // match only the temp dir's trailing chars (contiguous on the final wrapped row).
      await expect(win.getByTestId(`terminal-${b}`)).toContainText(basename(root).slice(-6), { timeout: 15000 });

      // Closing must warn — with BOTH terminals counted (the busy one must not make
      // the count query time out and silently skip the prompt).
      await requestClose(app);
      await expect(win.getByTestId('app-close-dialog')).toBeVisible({ timeout: 10000 });
      await expect(win.getByTestId('app-close-message')).toContainText('2 terminals');

      // Expandable details name each terminal (project / panel / flavour, FR-015).
      await win.getByTestId('app-close-details').locator('summary').click();
      const details = win.getByTestId('app-close-details');
      await expect(details.getByTestId('app-close-term-row')).toHaveCount(2);
      await expect(details).toContainText('Many'); // project name
      await expect(details).toContainText('Command Prompt'); // cmd flavour label

      // Terminate all → the app quits (clean teardown, no lingering terminals).
      const closed = app.waitForEvent('close', { timeout: 10000 });
      await win.getByTestId('app-close-terminate').click();
      await closed;
    });
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 });
  }
});

test('closing with no running terminals shows a brief closing overlay, then quits', async () => {
  await runApp(async (app, win) => {
    await createProject(win, 'PlainClose', 'C:/c/plainclose');
    await expect(win.getByTestId('tab-strip')).toBeVisible();

    // No terminals → no warning; a brief blocking "closing" overlay, then quit.
    const closed = app.waitForEvent('close', { timeout: 10000 });
    await requestClose(app);
    await expect(win.getByTestId('app-closing-message')).toContainText('Closing throng');
    await closed;
  });
});
