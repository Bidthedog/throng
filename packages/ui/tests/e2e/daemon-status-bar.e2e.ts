import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import {
  runApp,
  createProject,
  firstPanelId,
  daemonPid,
  forceKillProcessTree,
  cleanupTemp,
} from './harness.js';
import { skipIfElevated } from './admin.js';

/**
 * 029 US2 — the daemon indicator: the surface #182 asked for, and the way back it carries.
 *
 * ══ WHY THIS IS A SEPARATE FILE FROM `daemon-death-notice.e2e.ts` ══
 *
 * That spec is a REPLICATION and should keep reading as the reproduction of its bug — the daemon
 * dies, the user is told, and no raw errno reaches them. This one covers the UI 029 adds on top:
 * an indicator that reflects the state, restarts on demand, cannot be fired twice, and OUTLIVES the
 * notice. Bolting new-UI assertions onto a replication makes it stop being one.
 *
 * ══ THE ONE DESIGN CLAIM WORTH TESTING ══
 *
 * The notice REPORTS and the status bar ACTS. Putting the restart on the notice would have been the
 * obvious move and is the wrong one: a notice is transient, so the remedy would vanish the moment
 * the user dismissed it — leaving them no route back except provoking another failure. Two
 * assertions below are the whole of that argument made checkable: the notice carries no restart of
 * its own (FR-009a), and the indicator is still there after the notice is dismissed.
 */

/** The status-bar indicator: present only when the daemon is NOT healthy (029 FR-008). */
const indicator = (win: Page) => win.getByTestId('status-daemon');

test('the daemon indicator reports the state, restarts on demand, and outlives the notice', { tag: ['@extended', '@failure', '@reserve:process'] }, async () => {
  // An elevated daemon lives in a different process tree (the de-elevated agent), which
  // `forceKillProcessTree` on the health.ping pid does not describe.
  skipIfElevated();
  test.setTimeout(180_000);

  const root = mkdtempSync(join(tmpdir(), 'throng-182sb-root-'));

  try {
    await runApp(
      async (_app, win, { pipeName }) => {
        await createProject(win, 'BarProj', root);
        const pid = await firstPanelId(win);
        await win.getByTestId(`panel-type-select-${pid}`).selectOption('terminal');
        await win.getByTestId('terminal-flavour').selectOption('cmd');
        await win.getByTestId(`panel-type-confirm-${pid}`).click();
        // SETUP: a real shell, so the daemon is genuinely working when it is killed.
        await expect(win.getByTestId(`terminal-${pid}`)).toContainText(basename(root), {
          timeout: 20_000,
        });

        /**
         * FR-008 — SILENT while healthy.
         *
         * A status bar that always shouts says nothing. This is asserted before the kill so the
         * appearance below is a transition rather than something that was there all along.
         */
        await expect(indicator(win)).toHaveCount(0);

        const daemon = await daemonPid(pipeName);
        expect(daemon).toBeGreaterThan(0);
        const killedAt = Date.now();
        forceKillProcessTree(daemon);

        /*
         * ── SC-002: the user knows within two seconds. ────────────────────────────────────────
         *
         * Measured END TO END, because `DAEMON_GRACE_MS` being 1200 proves only what the state
         * machine intends; the ceiling is about when the message reaches the SCREEN.
         *
         * This assertion is why the file is in the serial tier of `parallel-plan.json`. The grace
         * spends 1200ms of the 2000ms budget by design, so only 800ms is left for the socket to
         * close, the transition to broadcast and React to paint — and at six local workers it was
         * measured at 2039ms. That is contention, not a regression, but a wall-clock ceiling cannot
         * tell the two apart, so it must not be asked the question under load. CI runs one worker
         * per shard and was never exposed.
         */
        await expect(win.getByTestId('daemon-error')).toHaveCount(1, { timeout: 30_000 });
        const noticedIn = Date.now() - killedAt;
        expect(noticedIn, `the daemon notice took ${noticedIn}ms to appear`).toBeLessThan(2000);

        /**
         * FR-008 — the indicator is an ICON with a hover title (Constitution VI), and it says which
         * state it is in without relying on colour.
         */
        await expect(indicator(win)).toBeVisible();
        await expect(indicator(win)).toHaveAttribute('data-status', 'stopped');
        await expect(indicator(win)).toHaveAttribute('title', /daemon/i);
        /*
         * Icon-only means a GLYPH, not a word — throng's icon packs are characters, not SVG.
         *
         * Asserted as "short and contains no letters" rather than as a specific glyph, because the
         * icon pack is user-replaceable and pinning the character would make this a test of the
         * shipped theme's taste. What must not happen is a text label creeping in, or the glyph
         * vanishing entirely: an icon token the theme does not define renders NOTHING, silently, and
         * the control becomes an invisible button. That has already happened once in this feature.
         */
        const glyph = (await indicator(win).innerText()).trim();
        expect(glyph, 'the indicator rendered nothing — an invisible control').not.toBe('');
        expect(glyph.length, 'the indicator should be an icon, not a word').toBeLessThanOrEqual(2);
        expect(glyph, 'the indicator should be an icon, not a word').not.toMatch(/[A-Za-z]/);

        /**
         * FR-009a — the NOTICE carries no restart of its own, and the indicator survives the notice.
         *
         * A testable negative, and the reason the control lives in the status bar at all.
         */
        const notice = win.getByTestId('daemon-error');
        expect(
          await notice.locator('button').count(),
          'the notice should carry only its copy and dismiss controls',
        ).toBe(2);
        await win.getByTestId('daemon-error-dismiss').first().click();
        await expect(notice).toHaveCount(0);
        await expect(indicator(win)).toBeVisible();

        /**
         * FR-010a / FR-010b — nothing is disabled or blocked while the daemon is down, and work that
         * needs no daemon still succeeds.
         *
         * The tempting response to a dead daemon is to grey the application out. That would turn one
         * broken subsystem into a broken application, and the file explorer does not use the daemon
         * at all — it goes through UI main.
         */
        writeFileSync(join(root, 'still-works.txt'), 'x');
        const tree = win.getByTestId('file-explorer-tree');
        await expect(tree.getByText('still-works.txt', { exact: true })).toBeVisible({
          timeout: 20_000,
        });
        // The sidebar's own controls are not blanket-disabled either.
        await expect(win.getByTestId('project-new')).toBeEnabled();

        // ── FR-009 / FR-009b: the way back. ──────────────────────────────────────────────────
        await indicator(win).click();
        /*
         * The restart is asserted by its OUTCOME, not by catching the `restarting` frame.
         *
         * A spawn that succeeds can move through `restarting` faster than a poll can observe it, so
         * asserting the intermediate state would be a race the test loses on a fast machine. What
         * FR-009 actually promises is that the user is told whether it worked — and a daemon that is
         * serving again makes the indicator go away entirely, which is the strongest form of that.
         */
        await expect(indicator(win)).toHaveCount(0, { timeout: 60_000 });

        // And the app is genuinely working again, not merely quiet: a project action needs the
        // daemon, and this one must now succeed.
        const other = mkdtempSync(join(tmpdir(), 'throng-182sb-other-'));
        try {
          await createProject(win, 'AfterRestart', other);
          await expect(win.getByTestId('project-error')).toHaveCount(0);
        } finally {
          cleanupTemp(other);
        }
      },
      // The app spawns its own daemon, so `daemonPid` resolves it via health.ping and teardown's
      // `killAppSpawnedDaemon` tolerates it already being dead.
      { skipDaemon: true },
    );
  } finally {
    cleanupTemp(root);
  }
});

/**
 * #212 — a project switch that FAILS must leave the opened project where it actually is.
 *
 * ══ WHY THIS LIVES IN THE DAEMON-DOWN SPEC ══
 *
 * The bug is about any failed switch, but a switch has to genuinely fail to show it, and a stopped
 * daemon is the cleanest way to make `projects.setActive` fail on demand. That setup is already here.
 *
 * ══ WHAT IS ASSERTED, AND WHAT WAS TRIED FIRST ══
 *
 * `switchProject` set the opened project BEFORE its RPC and never put it back when the RPC failed,
 * so the store went on believing it was in a project it had never entered. `openedId` drives
 * `activeProject`, which drives the sidebar's `data-active`, the window title and the accent colour
 * — so the failure is plainly visible: the app highlights, titles and colours itself for a project
 * that was never opened.
 *
 * The first version of this test asserted the CONSEQUENCE instead — that retrying the same switch
 * still does work rather than being refused as a no-op — by dismissing the daemon notice and looking
 * for a second one. That cannot work, and the reason is worth recording: the store sets the same
 * error string and the same action label both times, so React bails on identical state, the notice
 * effect never re-runs, and no second notice is raised whatever the store believes. It tested the
 * notification model's de-duplication, not this bug.
 */
test('a failed project switch leaves the active project where it was (#212)', { tag: ['@extended', '@failure', '@reserve:process'] }, async () => {
  skipIfElevated();
  test.setTimeout(180_000);

  const root = mkdtempSync(join(tmpdir(), 'throng-212-root-'));
  const other = mkdtempSync(join(tmpdir(), 'throng-212-other-'));

  try {
    await runApp(
      async (_app, win, { pipeName }) => {
        await createProject(win, 'Alpha', root);
        // Created BEFORE the kill — creating one afterwards is itself an RPC and would fail too.
        await createProject(win, 'Bravo', other);
        await expect(win.locator('.project-item')).toHaveCount(2);

        const switchTo = async (name: string): Promise<void> => {
          await win
            .locator('.project-item', { hasText: name })
            .locator('[data-testid^="project-switch-"]')
            .click();
        };
        const active = win.locator('.project-item[data-active="true"]');

        // SETUP: back on Alpha, and the app agrees. Switching to Bravo below is a real change.
        await switchTo('Alpha');
        await expect(active).toHaveCount(1);
        await expect(active).toContainText('Alpha');

        const daemon = await daemonPid(pipeName);
        expect(daemon).toBeGreaterThan(0);
        forceKillProcessTree(daemon);
        await expect(win.getByTestId('daemon-error')).toHaveCount(1, { timeout: 30_000 });

        // ── The switch cannot succeed: nothing is there to serve it. ──────────────────────────
        await switchTo('Bravo');
        /*
         * A FENCE WAS TRIED HERE AND DOES NOT WORK. Recorded rather than removed, because the next
         * person will have the same idea.
         *
         * The attempt asserted the optimistic update — `expect(active).toContainText('Bravo')` —
         * on the reasoning that seeing Bravo proves the switch was genuinely attempted rather than
         * nothing having happened yet. It failed all three attempts, every run, at ~19s each.
         *
         * The state is TRANSIENT and this is the one case where it is at its most transient: the
         * daemon has just been force-killed, so the RPC does not time out, it is refused as soon as
         * the pipe is found dead. Bravo can appear and revert between two of Playwright's polls, so
         * the assertion is a race against the very failure the test is about — and asserting a
         * transient state is unreliable by construction, not by bad luck.
         *
         * `quiesced()` does not rescue it either: two consecutive equal reads settle immediately on
         * the pre-switch value if the optimistic update has not applied yet, which is the vacuous
         * pass wearing the condition's clothes.
         *
         * sleep-justified: nothing durable marks "the rejected switch has been handled" — there is
         * sleep-justified: no notice, no state change that survives, and the only observable is the
         * sleep-justified: optimistic update, which is a transient this test races by construction.
         */
        await win.waitForTimeout(5000);

        /**
         * Alpha is active again once the RPC rejects (no daemon to serve it).
         *
         * Before the fix the highlight followed the optimistic update and stayed on Bravo — a project
         * the app never opened, given the active marker and, through the same `activeProject`, the
         * window title and the accent colour.
         *
         * Only the sidebar is asserted, deliberately. The window title is set natively via
         * `window.throng.setTitle` in the main process, so `page.title()` reads `document.title` and
         * returns "throng" whatever the project is — an assertion on it would fail for a reason that
         * has nothing to do with this bug.
         */
        await expect(active).toHaveCount(1);
        await expect(active, 'the app moved to a project it never opened').toContainText('Alpha');
      },
      { skipDaemon: true },
    );
  } finally {
    cleanupTemp(root);
    cleanupTemp(other);
  }
});
