import { basename } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import { APP_CLOSE_TIMEOUT_MS, HOST_OS, LONG_RUNNING_COMMAND, TERMINAL_OUTPUT_TIMEOUT_MS, TEST_SHELL, cleanupTemp, createProject, firstPanelId, panelIds, runApp, splitPanelViaMenu, requestAppClose } from './harness.js';
// T068 (US3 / FR-015): closing the app while terminals are running must warn with
// a three-choice prompt (leave running / terminate all / cancel) instead of
// silently killing them. Cancel keeps the app open.

/** Ask the main process to close the primary window (fires the close handshake). */
// MERGED: "closing with a running terminal shows the three-choice warning; Cancel keeps it open" now lives
// in the multi-terminal test below (Cancel step before Terminate), and "Terminate all closes the app" is
// the tail of that same test.

/** The label throng's shell detection gives {@link TEST_SHELL}: Windows' built-in table, or the POSIX one's `Bash`. */
/** Well inside the 18 s a GNOME power-off gives open apps (#699), and past the save step's budget. */
const SYSTEM_QUIT_TIMEOUT_MS = 10_000;

const TEST_SHELL_LABEL =TEST_SHELL === 'cmd' ? 'Command Prompt' : 'Bash';

test('warns with the right count when several terminals run (incl. a busy one); Cancel keeps the app open, Terminate all quits', { tag: ['@extended', '@window', '@reserve:window'] }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'throng-close-many-'));
  try {
    await runApp(async (app, win) => {
      await createProject(win, 'Many', root);
      const a = await firstPanelId(win);

      // Panel A → terminal, then run a long command so it is busy.
      await win.getByTestId(`panel-type-select-${a}`).selectOption('terminal');
      await win.getByTestId('terminal-flavour').selectOption(TEST_SHELL);
      await win.getByTestId(`panel-type-confirm-${a}`).click();
      await expect(win.getByTestId(`terminal-${a}`)).toContainText(basename(root), { timeout: TERMINAL_OUTPUT_TIMEOUT_MS });
      await win.getByTestId(`terminal-${a}`).click();
      await win.keyboard.type(LONG_RUNNING_COMMAND);
      await win.keyboard.press('Enter');

      // Add Panel B → a second terminal.
      await splitPanelViaMenu(win, a);
      await expect(win.locator('.panel-box')).toHaveCount(2);
      const b = (await panelIds(win)).find((id) => id !== a)!;
      await win.getByTestId(`panel-type-select-${b}`).selectOption('terminal');
      await win.getByTestId('terminal-flavour').selectOption(TEST_SHELL);
      await win.getByTestId(`panel-type-confirm-${b}`).click();
      // Panel B is SPLIT (narrow), so its prompt path wraps across xterm rows —
      // match only the temp dir's trailing chars (contiguous on the final wrapped row).
      await expect(win.getByTestId(`terminal-${b}`)).toContainText(basename(root).slice(-6), { timeout: TERMINAL_OUTPUT_TIMEOUT_MS });

      // Closing must warn — with BOTH terminals counted (the busy one must not make
      // the count query time out and silently skip the prompt).
      await requestAppClose(app);
      await expect(win.getByTestId('app-close-dialog')).toBeVisible({ timeout: 10000 });
      await expect(win.getByTestId('app-close-message')).toContainText('2 terminals');

      // Expandable details name each terminal (project / panel / flavour, FR-015).
      await win.getByTestId('app-close-details').locator('summary').click();
      const details = win.getByTestId('app-close-details');
      await expect(details.getByTestId('app-close-term-row')).toHaveCount(2);
      await expect(details).toContainText('Many'); // project name
      await expect(details).toContainText(TEST_SHELL_LABEL); // the flavour's label

      // The three choices are offered; Cancel → the warning closes and the app stays open with its terminals.
      await expect(win.getByTestId('app-close-leave')).toBeVisible();
      await expect(win.getByTestId('app-close-terminate')).toBeVisible();
      await expect(win.getByTestId('app-close-cancel')).toBeVisible();
      await win.getByTestId('app-close-cancel').click();
      await expect(win.getByTestId('app-close-dialog')).toBeHidden();
      await expect(win.getByTestId(`terminal-${a}`)).toBeVisible();

      // Ask again → the warning returns.
      await requestAppClose(app);
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

/*
 * #699 — a quit the system asks for (power-off, logout, `kill`) arrives as SIGTERM, which Electron turns into a quit
 * that closes the main window. Nobody is there to answer the running-terminals warning, so it must not be asked: the
 * workspace is saved and throng closes, leaving the terminals to the daemon. Linux only: on Windows SIGTERM is
 * TerminateProcess, and macOS routes every quit through its own lifecycle (070 FR-028).
 */
test('a quit from the system (SIGTERM) with a terminal running closes promptly, without the warning', { tag: ['@extended', '@window', '@reserve:window'] }, async () => {
  test.skip(HOST_OS !== 'linux', 'SIGTERM is the Linux system quit');
  const root = mkdtempSync(join(tmpdir(), 'throng-close-sigterm-'));
  try {
    await runApp(async (app, win) => {
      await createProject(win, 'SigTerm', root);
      const a = await firstPanelId(win);
      await win.getByTestId(`panel-type-select-${a}`).selectOption('terminal');
      await win.getByTestId('terminal-flavour').selectOption(TEST_SHELL);
      await win.getByTestId(`panel-type-confirm-${a}`).click();
      await expect(win.getByTestId(`terminal-${a}`)).toContainText(basename(root), { timeout: TERMINAL_OUTPUT_TIMEOUT_MS });

      const closed = app.waitForEvent('close', { timeout: SYSTEM_QUIT_TIMEOUT_MS });
      process.kill(app.process().pid!, 'SIGTERM');
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
    await requestAppClose(app);
    await expect(win.getByTestId('app-closing-message')).toContainText('Closing throng');
    await closed;
  });
});
