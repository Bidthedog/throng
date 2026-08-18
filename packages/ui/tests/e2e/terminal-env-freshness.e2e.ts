import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { test, expect } from '@playwright/test';
import { runApp, createProject, firstPanelId, cleanupTemp } from './harness.js';
import { skipIfElevated } from './admin.js';

/**
 * #209 — a terminal must inherit the environment of the session running NOW, not the one that
 * happened to start the daemon.
 *
 * ══ THE DEFECT ══
 *
 * Three reasonable behaviours combine into one silent bug:
 *
 *   1. the daemon is spawned DETACHED and outlives the UI, on purpose;
 *   2. it is REUSED whenever its build id still matches, so a later launch adopts it;
 *   3. it keeps the environment it was born with, because a process cannot re-read its parent's.
 *
 * So the daemon holds a frozen snapshot of whichever session first started it, and every terminal it
 * spawns inherits that. Measured on the issue: a 22-hour-old daemon whose launching console no
 * longer existed, passing `CLAUDE_CODE_CHILD_SESSION=1` into every new terminal — which silently
 * turned off Claude Code's transcript saving, and suppresses kitty keyboard negotiation by the same
 * route. Both symptoms are silent, which is what makes it worth carrying an environment across the
 * RPC to fix.
 *
 * ══ HOW THIS REPRODUCES IT IN ONE RUN ══
 *
 * The suite cannot wait 22 hours, and it does not need to. What matters is only that the daemon's
 * environment DIFFERS from the app's — which is arranged directly: the daemon is started first with
 * a marker variable, then the app is launched WITHOUT it. A terminal that still sees the marker is
 * reading the daemon's snapshot; one that does not is reading the app's, which is the fix.
 *
 * That is the same relationship an aged daemon has to a fresh app, established in seconds instead of
 * a day, and it fails for exactly the same reason. *
 * ══ WHY THE MARKER IS NOT NAMED `THRONG_*` ══
 *
 * It was, at first, and the test passed with the fix DISABLED — vacuously. `sanitizeSpawnEnv` strips
 * every `THRONG_*` variable on the way to a shell by design (#172), so the marker never arrived
 * whichever environment it came from. A name outside that prefix is what makes the two cases
 * distinguishable at all.
 */

test('a terminal sees the environment of the app that launched it, not the daemon (#209)', { tag: ['@extended', '@terminal'] }, async () => {
  // An elevated daemon routes terminals through the de-elevated agent, a different process tree
  // from the one this asserts about.
  skipIfElevated();
  test.setTimeout(180_000);

  const root = mkdtempSync(join(tmpdir(), 'throng-209-root-'));

  try {
    await runApp(
      async (_app, win) => {
        await createProject(win, 'EnvProj', root);
        const pid = await firstPanelId(win);
        await win.getByTestId(`panel-type-select-${pid}`).selectOption('terminal');
        await win.getByTestId('terminal-flavour').selectOption('cmd');
        await win.getByTestId(`panel-type-confirm-${pid}`).click();

        const term = win.getByTestId(`terminal-${pid}`);
        await expect(term).toContainText(basename(root), { timeout: 20_000 });

        // Ask the shell what it inherited. `echo` on cmd prints the literal name when a variable is
        // unset, which distinguishes "absent" from "empty" without any extra machinery.
        await term.click();
        await win.keyboard.type('echo [%STALE_DAEMON_MARKER%]');
        await win.keyboard.press('Enter');

        /**
         * RED — the marker belongs to the DAEMON's session, and must not reach the shell.
         *
         * `[%STALE_DAEMON_MARKER%]` is cmd's way of saying "no such variable". Seeing
         * `[stale-daemon-session]` instead means the terminal was built from the environment the
         * daemon was born with — a session the user may have closed days ago.
         */
        await expect(term).toContainText('[%STALE_DAEMON_MARKER%]', { timeout: 20_000 });
        await expect(term).not.toContainText('[stale-daemon-session]');
      },
      {
        /*
         * The daemon is started by the HARNESS with a marker the app will not have — which is what
         * makes this an aged daemon in miniature. `runApp` starts it from this env before launching
         * the app, and the app's own environment (which the harness does not extend) is what a
         * correct implementation must use instead.
         */
        daemonEnv: { STALE_DAEMON_MARKER: 'stale-daemon-session' },
      },
    );
  } finally {
    cleanupTemp(root);
  }
});
