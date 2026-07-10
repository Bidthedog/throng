import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { test, expect } from '@playwright/test';
import { runApp, createProject, firstPanelId } from './harness.js';
import { skipIfElevated } from './admin.js';

/**
 * 008 FR-005 / SC-006. A terminal whose shell takes longer to start than the attach
 * budget MUST render a non-fatal "still starting" state with a retry — it MUST NOT revert
 * the panel to the type-selection form, MUST NOT present a hard error, and MUST NOT
 * terminate the session. The retry reattaches to the (now-running) session and recovers.
 *
 * The cold-start attach is slowed past the (small) attach budget with two test seams:
 *   • THRONG_ATTACH_TIMEOUT_MS — the client attach budget (008 FR-004); set small.
 *   • THRONG_ATTACH_DELAY_MS   — the daemon delays a COLD-START attach's response; set
 *     large. The session is registered before the delay, so the retry (a reuse) is fast.
 * `skipDaemon` makes the APP spawn its own daemon, which inherits these env vars.
 */
test('a slow-starting terminal shows the "still starting" state and recovers on retry', async () => {
  skipIfElevated();
  const root = mkdtempSync(join(tmpdir(), 'throng-slowstart-'));
  try {
    await runApp(
      async (_app, win) => {
        await createProject(win, 'SlowStart', root);
        const pid = await firstPanelId(win);
        await win.getByTestId(`panel-type-select-${pid}`).selectOption('terminal');
        await win.getByTestId('terminal-flavour').selectOption('cmd');
        await win.getByTestId(`panel-type-confirm-${pid}`).click();

        // The cold-start attach exceeds the budget → the non-fatal "still starting" state
        // with a (themeable-icon) retry affordance appears.
        await expect(win.getByTestId(`terminal-starting-${pid}`)).toBeVisible({ timeout: 20000 });
        await expect(win.getByTestId(`terminal-retry-${pid}`)).toBeVisible();
        // It did NOT revert to the type form, and surfaced NO hard exit error.
        await expect(win.getByTestId(`panel-type-form-${pid}`)).toHaveCount(0);
        await expect(win.getByTestId(`panel-exit-${pid}`)).toHaveCount(0);

        // Retry reattaches to the now-running session → the state clears and the terminal
        // shows its prompt (the project root), never a fresh cold start or a form.
        await win.getByTestId(`terminal-retry-${pid}`).click();
        await expect(win.getByTestId(`terminal-starting-${pid}`)).toHaveCount(0, { timeout: 20000 });
        await expect(win.getByTestId(`terminal-${pid}`)).toContainText(basename(root), { timeout: 20000 });
      },
      {
        skipDaemon: true,
        env: { THRONG_ATTACH_TIMEOUT_MS: '400', THRONG_ATTACH_DELAY_MS: '3000' },
      },
    );
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
  }
});
