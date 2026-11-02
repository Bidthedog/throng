import { basename } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import type { ElectronApplication } from '@playwright/test';
import { APP_CLOSE_TIMEOUT_MS, TERMINAL_OUTPUT_TIMEOUT_MS, cleanupTemp, createProject, firstPanelId, panelIds, runApp, splitPanelViaMenu } from './harness.js';
// T068 (US3 / FR-015): closing the app while terminals are running must warn with
// a three-choice prompt (leave running / terminate all / cancel) instead of
// silently killing them. Cancel keeps the app open.

/** Ask the main process to close the primary window (fires the close handshake). */
async function requestClose(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.close());
}

// MERGED: "closing with a running terminal shows the three-choice warning; Cancel keeps it open" now lives
// in the multi-terminal test below (Cancel step before Terminate), and "Terminate all closes the app" is
// the tail of that same test.

test('warns with the right count when several terminals run (incl. a busy one); Cancel keeps the app open, Terminate all quits', { tag: ['@extended', '@window', '@reserve:window'] }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'throng-close-many-'));
  try {
    await runApp(async (app, win) => {
      await createProject(win, 'Many', root);
      const a = await firstPanelId(win);

      // Panel A → terminal, then run a long command so it is busy.
      await win.getByTestId(`panel-type-select-${a}`).selectOption('terminal');
      await win.getByTestId('terminal-flavour').selectOption('cmd');
      await win.getByTestId(`panel-type-confirm-${a}`).click();
      await expect(win.getByTestId(`terminal-${a}`)).toContainText(basename(root), { timeout: TERMINAL_OUTPUT_TIMEOUT_MS });
      await win.getByTestId(`terminal-${a}`).click();
      await win.keyboard.type('ping -n 30 127.0.0.1');
      await win.keyboard.press('Enter');

      // Add Panel B → a second terminal.
      await splitPanelViaMenu(win, a);
      await expect(win.locator('.panel-box')).toHaveCount(2);
      const b = (await panelIds(win)).find((id) => id !== a)!;
      await win.getByTestId(`panel-type-select-${b}`).selectOption('terminal');
      await win.getByTestId('terminal-flavour').selectOption('cmd');
      await win.getByTestId(`panel-type-confirm-${b}`).click();
      // Panel B is SPLIT (narrow), so its cmd prompt path wraps across xterm rows —
      // match only the temp dir's trailing chars (contiguous on the final wrapped row).
      await expect(win.getByTestId(`terminal-${b}`)).toContainText(basename(root).slice(-6), { timeout: TERMINAL_OUTPUT_TIMEOUT_MS });

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

      // The three choices are offered; Cancel → the warning closes and the app stays open with its terminals.
      await expect(win.getByTestId('app-close-leave')).toBeVisible();
      await expect(win.getByTestId('app-close-terminate')).toBeVisible();
      await expect(win.getByTestId('app-close-cancel')).toBeVisible();
      await win.getByTestId('app-close-cancel').click();
      await expect(win.getByTestId('app-close-dialog')).toBeHidden();
      await expect(win.getByTestId(`terminal-${a}`)).toBeVisible();

      // Ask again → the warning returns.
      await requestClose(app);
      await expect(win.getByTestId('app-close-dialog')).toBeVisible({ timeout: 10000 });

      // Terminate all → the app quits (clean teardown, no lingering terminals).
      const closed = app.waitForEvent('close', { timeout: APP_CLOSE_TIMEOUT_MS });
      await win.getByTestId('app-close-terminate').click();
      await closed;
    });
  } finally {
    cleanupTemp(root);
  }
});

test('closing with no running terminals shows a brief closing overlay, then quits', { tag: ['@extended', '@window', '@reserve:window'] }, async () => {
  await runApp(async (app, win) => {
    await createProject(win, 'PlainClose', 'C:/c/plainclose');
    await expect(win.getByTestId('tab-strip')).toBeVisible();

    // No terminals → no warning; a brief blocking "closing" overlay, then quit.
    const closed = app.waitForEvent('close', { timeout: APP_CLOSE_TIMEOUT_MS });
    await requestClose(app);
    await expect(win.getByTestId('app-closing-message')).toContainText('Closing throng');
    await closed;
  });
});
