import { basename, join } from 'node:path';
import { mkdtempSync, renameSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import { test, expect, type Page } from '@playwright/test';
import { runApp, createProject, firstPanelId, cleanupTemp } from './harness.js';
import { skipIfElevated } from './admin.js';

/**
 * 029 / #204 — a terminal that fails to LAUNCH must not lose its panel configuration.
 *
 * ══ THE DEFECT ══
 *
 * `WindowsDirectoryLock.acquire` throws `Cannot lock "…": the path does not exist`
 * (`packages/platform-windows/src/windows-directory-lock.ts:39`) when a project root has been
 * renamed away. That rejection is routed through the terminal's ordinary `end()` path, whose own
 * docblock says it runs for "a clean/unexpected exit **or a launch failure**"
 * (`terminal-panel.tsx:85`). `end()` finishes with `ws.clearPanelType(panel.id)` (`:465`), which
 * strips `kind` and `config` off the Panel (`packages/core/src/panel-type/assignment.ts:99`) — and
 * that stripped layout is what gets PERSISTED.
 *
 * So a folder that was briefly unavailable deletes the user's panel configuration. Put the folder
 * back and the panel is still an unconfigured Panel Type form: nothing in the layout says it was
 * ever a terminal.
 *
 * ══ WHAT THIS TEST ASSERTS ══
 *
 * The INTENDED behaviour, so it FAILS on master by design (029 is the fix). A terminal that could
 * not be launched keeps its panel type, shows the failure with a retry, and comes back as a
 * configured terminal once the cause is rectified.
 *
 * FR-020 — a shell that RAN AND THEN EXITED reverts to the type-selection form — is not in
 * question and is not touched here. `terminal-revert.e2e.ts` covers it directly.
 *
 * ══ WHAT THE FIX MUST RECONCILE WITH ══
 *
 * `terminal-persistence.e2e.ts:81` asserts the OPPOSITE for a different launch failure: a Panel
 * restored with a flavour that no longer exists reverts to the form, deliberately. Both cases are
 * attach failures, so "keep the config on a launch failure" cannot be applied blindly — a missing
 * FLAVOUR is a configuration the user must re-choose, whereas a missing FOLDER is transient. 029
 * has to draw that line explicitly rather than let one spec silently win.
 *
 * ══ NOT `test.fail()` ══
 *
 * This is a real red test on a branch that is not pushed. Marking it expected-to-fail would make
 * the bar green while the bug is live, which is the opposite of what a replication is for.
 */

/** A terminal VIEW, not the type form's own `terminal-flavour` / `terminal-admin` controls. */
const TERMINAL_VIEW = /^terminal-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The persisted layout blob for `projectName`, or '' if there isn't one yet. */
function layoutJson(dataDir: string, projectName: string): string {
  let db: InstanceType<typeof Database> | undefined;
  try {
    db = new Database(join(dataDir, 'throng.db'), { readonly: true });
    const row = db
      .prepare(
        `SELECT w.layout_json AS json
           FROM workspace_layout w
           JOIN projects p ON p.id = w.project_id
          WHERE p.name = ?`,
      )
      .get(projectName) as { json?: string } | undefined;
    return row?.json ?? '';
  } catch {
    return ''; // the daemon may hold the file mid-write; the poll will come back
  } finally {
    db?.close();
  }
}

/**
 * Wait until the layout has ACTUALLY reached SQLite holding a typed terminal panel.
 *
 * A sleep here would assert that some number of milliseconds always covers the debounced save plus
 * its IPC round-trip; under worker contention it does not, and the restart this test is ABOUT would
 * then restore a layout that was never written. The row is an observable condition, so poll for it.
 * Mirrors `editor-stranded-restart.e2e.ts:54`.
 */
async function expectTerminalPersisted(dataDir: string, projectName: string): Promise<void> {
  await expect
    .poll(() => layoutJson(dataDir, projectName).includes('"kind":"terminal"'), {
      timeout: 20_000,
      message: `the terminal panel for ${projectName} was never persisted`,
    })
    .toBe(true);
}

/** Reopen the project — "reopen throng and re-enter the project", as the report has it. */
async function enterProject(win: Page, name: string): Promise<void> {
  const item = win.locator('.project-item', { hasText: name });
  await expect(item).toBeVisible({ timeout: 20_000 });
  const sw = item.locator('[data-testid^="project-switch-"]');
  if (await sw.isVisible().catch(() => false)) await sw.click();
  await expect(win.locator('.panel-box').first()).toBeVisible({ timeout: 20_000 });
}

/**
 * Rename `from` to `to`, waiting out the directory lock rather than assuming it has dropped.
 *
 * The daemon holds the project root for as long as a terminal is open, via a helper process whose
 * cwd IS the folder. That helper exits when the daemon dies — a beat AFTER `runApp`'s teardown
 * returns. Renaming immediately therefore races the OS releasing the handle, and loses often enough
 * to matter. Polling makes the wait a condition instead of a guess.
 */
async function renameWhenReleased(from: string, to: string): Promise<void> {
  await expect
    .poll(
      () => {
        try {
          renameSync(from, to);
          return true;
        } catch {
          return false;
        }
      },
      { timeout: 30_000, message: `could not rename ${from} → ${to} (directory lock never released?)` },
    )
    .toBe(true);
  expect(existsSync(from)).toBe(false);
  expect(existsSync(to)).toBe(true);
}

test('a terminal that fails to launch keeps its configuration and comes back once the root returns', async () => {
  // An elevated daemon routes terminals through the de-elevated agent — a different process tree
  // from the one these assertions describe. Same guard as `terminal-persistence.e2e.ts:39`.
  skipIfElevated();
  // Three full app launches, two of them waiting on a failed attach.
  test.setTimeout(300_000);

  const root = mkdtempSync(join(tmpdir(), 'throng-204-root-'));
  const moved = `${root}-renamed`;
  const dataDir = mkdtempSync(join(tmpdir(), 'throng-204-data-'));
  const userDataDir = mkdtempSync(join(tmpdir(), 'throng-204-ud-'));

  try {
    // ── Launch 1: configure a real cmd terminal and let the layout persist ────────────────────
    await runApp(
      async (_app, win) => {
        await createProject(win, 'LaunchFail', root);
        const pid = await firstPanelId(win);
        await win.getByTestId(`panel-type-select-${pid}`).selectOption('terminal');
        await win.getByTestId('terminal-flavour').selectOption('cmd');
        await win.getByTestId(`panel-type-confirm-${pid}`).click();
        // SETUP, asserted positively: the shell really reached its prompt in the project root.
        await expect(win.getByTestId(`terminal-${pid}`)).toContainText(basename(root), {
          timeout: 20_000,
        });
        await expectTerminalPersisted(dataDir, 'LaunchFail');
      },
      { dataDir, userDataDir },
    );

    // SETUP: the layout on disk describes a terminal, and it names the flavour the user chose.
    expect(layoutJson(dataDir, 'LaunchFail')).toContain('"kind":"terminal"');
    expect(layoutJson(dataDir, 'LaunchFail')).toContain('"flavourId":"cmd"');

    // ── throng is closed. Break the project root, exactly as the report does. ─────────────────
    await renameWhenReleased(root, moved);

    // ── Launch 2: the terminal cannot attach. It must SAY so — and stay a terminal. ───────────
    await runApp(
      async (_app, win) => {
        await enterProject(win, 'LaunchFail');
        const pid = await firstPanelId(win);

        /*
         * A fixed wait, with a reason: the assertion below is a NEGATIVE.
         *
         * "The type-selection form did not appear" is true before the attach has even been tried, so
         * checking it early would pass against a panel that was about to revert. The attach failure
         * fans out through the daemon, the RPC and the panel, and none of those emits an event
         * meaning "and it has finished failing" — which is when a wait with a stated reason beats a
         * locator that cannot tell "not yet" from "never".
         */
        await win.waitForTimeout(8000);

        /**
         * RED #1 — the panel must not revert to the type-selection form.
         *
         * On master `end()` runs, `clearPanelType` strips the type, and this form appears. The
         * launch never started a shell, so there is no "the terminal finished" to report; what the
         * reversion actually communicates is "your panel configuration has been deleted because a
         * folder was briefly unavailable".
         */
        await expect(win.getByTestId(`panel-type-form-${pid}`)).toHaveCount(0, { timeout: 5000 });

        /**
         * RED #2 — the failure is shown WHERE THE TERMINAL IS, with a way to try again.
         *
         * `terminal-starting-*` / `terminal-retry-*` was the existing non-fatal failure surface
         * (008 FR-005, proven by `terminal-slow-start.e2e.ts:32`). Routing a launch failure there
         * rather than through `end()` was the shape of the fix, so this asserted an affordance that
         * already existed rather than inventing one.
         *
         * 030 US4 / T060b — a START FAILURE is now the shared banner (FR-039), and its retry is
         * addressed by the accessible name FR-042d fixes rather than by a test id. The locator is
         * SCOPED INSIDE the banner deliberately: `terminal-retry-{pid}` still exists on the
         * still-starting strip, which FR-039a keeps exactly as it was, so an unscoped locator on it
         * would go on passing here while addressing a different state of a different kind — the
         * failure would look fixed and would not be.
         */
        const banner = win.getByTestId(`panel-failure-${pid}`);
        await expect(banner).toBeVisible({ timeout: 5000 });
        await expect(banner.getByRole('button', { name: 'Try again', exact: true })).toBeVisible();
      },
      { dataDir, userDataDir },
    );

    /**
     * RED #3 — and the layout STILL describes a terminal.
     *
     * This is the "for good" in the issue title, and the most important of the three: the reverted
     * layout is written back to SQLite, so the loss outlives the session that caused it. Asserted
     * against the store rather than the screen because that is where the damage is permanent.
     */
    const afterFailure = layoutJson(dataDir, 'LaunchFail');
    expect(afterFailure, 'the persisted layout no longer describes a terminal').toContain(
      '"kind":"terminal"',
    );

    // ── Rectify the cause and reopen. ────────────────────────────────────────────────────────
    await renameWhenReleased(moved, root);

    // ── Launch 3: the terminal comes back, configured. ───────────────────────────────────────
    await runApp(
      async (_app, win) => {
        await enterProject(win, 'LaunchFail');
        const pid = await firstPanelId(win);

        /**
         * RED #4 — the whole point. Positive first (017 FR-013): assert the terminal IS there and
         * reached its prompt, then assert the form is not. A negative-only assertion would pass
         * vacuously against a workspace that had not finished rendering.
         */
        await expect
          .soft(win.getByTestId(`terminal-${pid}`))
          .toContainText(basename(root), { timeout: 20_000 });
        await expect(win.getByTestId(`panel-type-form-${pid}`)).toHaveCount(0);
        await expect(win.getByTestId(TERMINAL_VIEW)).toHaveCount(1);

        // Kill any live session so the app-close warning does not stall teardown. Guarded, because
        // on master there is no session here at all — the panel came back as an empty form.
        await win.evaluate((id) => window.throng?.terminal?.kill?.(id), pid);
        await win.waitForTimeout(1200);
      },
      { dataDir, userDataDir },
    );
  } finally {
    for (const dir of [root, moved, dataDir, userDataDir]) cleanupTemp(dir);
  }
});
