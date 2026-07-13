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
        // POSITIVE first (017 FR-013): the terminal actually recovered and is showing its
        // prompt. Only then is "the still-starting state is gone" worth asserting.
        //
        // The old order asserted `toHaveCount(0)` on the still-starting overlay FIRST — and
        // that assertion was VACUOUS: the retry handler clears the state synchronously
        // (`setStillStarting(false)` in terminal-panel.tsx), so the overlay is already gone
        // the instant the click returns, whether or not the reattach then succeeded. It
        // passed instantly, proved nothing, and hid the real failure below.
        await expect(win.getByTestId(`terminal-${pid}`)).toContainText(basename(root), { timeout: 20000 });
        await expect(win.getByTestId(`terminal-starting-${pid}`)).toHaveCount(0);
      },
      {
        skipDaemon: true,
        // Budgets sized so only the FIRST attach can miss (017 FR-013a, race class (c)).
        //
        // The cold-start attach is delayed IN THE DAEMON by ATTACH_DELAY_MS, and the client
        // gives up after ATTACH_TIMEOUT_MS. The test needs exactly one thing to be certain:
        // delay >> budget, so the first attach ALWAYS exceeds it. 8000 vs 2000 gives that a
        // 4x margin — it is a structural guarantee, not a timing hope.
        //
        // The old pair (3000/400) also satisfied delay > budget, but it made the *retry*
        // race too: the retry is a session REUSE and returns immediately, yet it still had
        // to complete a renderer→main→daemon round-trip inside 400ms. Under six-worker
        // contention that round-trip does not fit, so the retry ALSO timed out, re-entered
        // "still starting", and the terminal never painted — the test then sat for 20s on a
        // blank terminal. (Reproduced 3/3 under load; 3/3 green in isolation.) The retry was
        // never meant to be on a clock; only the first attach is.
        env: { THRONG_ATTACH_TIMEOUT_MS: '2000', THRONG_ATTACH_DELAY_MS: '8000' },
      },
    );
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
  }
});
