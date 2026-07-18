import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { runApp, createProject, firstPanelId } from './harness.js';
import { adminTest } from './admin.js';

/**
 * Issue #94 — "Elevated throng hangs when opening a non-elevated terminal panel".
 *
 * The live repro: throng ELEVATED, a Terminal panel confirmed with "run as admin"
 * UNCHECKED. The panel must reach a usable prompt (that is the whole point of the
 * de-elevation path) or, if de-elevation genuinely cannot be performed, fail fast with
 * a VISIBLE error. It must never sit blank indefinitely.
 *
 * ⚠ NOT EXECUTED in the session that authored this test: the precondition is an
 * elevated throng launching a NON-elevated terminal, and that session was not elevated.
 * `adminTest` skips this at medium integrity. Run it with `npm run test:e2e:admin` from
 * an elevated shell.
 *
 * COVERED BY CI as of 019 (FR-013a / SC-008), which is what resolved the hole this docblock
 * used to describe. GitHub's Windows runners run ELEVATED, and `playwright.config.ts`
 * `grepInvert`s `@admin` out of `npm run test:e2e` — so the one runner that COULD exercise
 * this path was the one configured not to. The "Run @admin E2E suite" step in `ci.yml` now
 * runs `npx playwright test --grep @admin` directly on that elevated runner, and FAILS on
 * zero executed tests (Playwright exits 0 on an empty selection, which is exactly how the
 * gap stayed invisible). Locally, run it with `npm run test:e2e:admin` from an elevated
 * shell — that script exists to hop UAC, which CI does not need.
 *
 * The mechanism-level, elevation-free companion — proving no timeout/failure path exists
 * at all — is packages/daemon/tests/integration/pty-agent-launch-timeout.integration.test.ts.
 */

/** How long a de-elevated terminal gets to produce a prompt OR a visible error. */
const LAUNCH_BUDGET_MS = 25_000;

async function daemonElevated(win: Page): Promise<boolean> {
  const caps = await win.evaluate(() => window.throng?.terminal?.capabilities?.());
  return caps?.elevated === true;
}

/** The flavour ids offered in the dropdown (after selecting Terminal on `pid`). */
async function availableFlavours(win: Page, pid: string): Promise<string[]> {
  await win.getByTestId(`panel-type-select-${pid}`).selectOption('terminal');
  return win
    .getByTestId(`panel-type-form-${pid}`)
    .getByTestId('terminal-flavour')
    .evaluate((el) => Array.from((el as HTMLSelectElement).options).map((o) => o.value));
}

adminTest(
  'an elevated throng opening a NON-elevated terminal reaches a prompt or fails visibly — never hangs (#94)',
  async () => {
    const root = mkdtempSync(join(tmpdir(), 'throng-94-hang-'));
    try {
      await runApp(async (_app, win) => {
        await createProject(win, 'DeElevationHang', root);
        const marker = basename(root); // every flavour's prompt shows the cwd
        const pid = await firstPanelId(win);

        // We only reach here elevated (adminTest skips otherwise) — assert the
        // precondition rather than assume it, so a green result can't be hollow.
        expect(await daemonElevated(win), 'the @admin daemon must be elevated').toBe(true);

        const flavours = await availableFlavours(win, pid);
        const flavour = flavours.includes('windows-powershell')
          ? 'windows-powershell'
          : flavours.includes('pwsh')
            ? 'pwsh'
            : 'cmd';

        // Confirm the terminal with "run as admin" UNCHECKED → the de-elevated agent path.
        await win.getByTestId(`panel-type-form-${pid}`).getByTestId('terminal-flavour').selectOption(flavour);
        await expect(win.getByTestId('terminal-admin')).not.toBeChecked();
        await win.getByTestId(`panel-type-confirm-${pid}`).click();

        const term = win.getByTestId(`terminal-${pid}`);
        await expect(term).toBeVisible({ timeout: 15_000 });

        // Within the budget the panel must settle into exactly one of two acceptable
        // outcomes. Anything else — a blank terminal that is still "running" — is #94.
        const deadline = Date.now() + LAUNCH_BUDGET_MS;
        let text = '';
        let outcome: 'prompt' | 'visible-error' | null = null;
        while (Date.now() < deadline) {
          text = await term.innerText();
          if (text.includes(marker)) {
            outcome = 'prompt'; // the intended outcome: a working non-elevated shell
            break;
          }
          if (/\[throng\]|failed/i.test(text)) {
            outcome = 'visible-error'; // the acceptable fallback: fail fast, visibly
            break;
          }
          // The panel reverting to the type form is also a surfaced failure (FR-020).
          if (await win.getByTestId(`panel-type-form-${pid}`).isVisible()) {
            outcome = 'visible-error';
            break;
          }
          await win.waitForTimeout(250);
        }

        expect(
          outcome,
          `a non-elevated terminal on an elevated throng produced neither a prompt nor a visible error within ${LAUNCH_BUDGET_MS}ms — it hung (#94). Terminal text was: ${JSON.stringify(text)}`,
        ).not.toBeNull();

        // The bug is fixed properly only when the outcome is a WORKING de-elevated
        // terminal. A visible error is merely the acceptable degradation the issue
        // permits, so record it loudly rather than passing silently.
        expect(
          outcome,
          'de-elevation must actually produce a usable non-elevated prompt, not just a visible failure',
        ).toBe('prompt');

        await win.evaluate((id) => window.throng?.terminal?.kill?.(id), pid);
      });
    } finally {
      rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 });
    }
  },
);
