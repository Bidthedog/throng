import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { test, expect } from '@playwright/test';
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
 * 029 / #182 — when the daemon dies, throng must SAY so once, plainly.
 *
 * ══ THE DEFECT ══
 *
 * `ensureDaemon` runs once at startup (`packages/ui/src/main/main.ts:547`) and nothing watches the
 * connection afterwards. `getDaemonStatus` is wired through the preload bridge
 * (`packages/ui/src/preload/preload.cts:65`) and answered in main
 * (`packages/ui/src/main/main.ts:814`) — and has **no renderer consumer at all**. There is no
 * daemon indicator anywhere in the status bar.
 *
 * So when the daemon stops — killed, crashed, or retired by another instance (#192 is one route) —
 * the UI carries on as though nothing happened. Terminals stay on screen accepting no input, layout
 * changes silently fail to persist, and every project action fails with whatever raw string the RPC
 * produced. On Windows that is `ENOENT`, because a named pipe that no longer exists is a missing
 * path — which reads as "a file is missing" and sends the user looking in entirely the wrong place.
 *
 * ══ WHY THIS IS @reserve:process AND NOT @reserve:runtime (035 T060/T063) ══
 *
 * It carried `@reserve:runtime` — "the wiring is live" — and that justification is now false. Every
 * span of the wiring is proven below E2E, and this test is where the phase's channel derivation
 * (`specs/035-e2e-layer-migration/channel-derivation.md`) found its ONE genuine gap:
 *
 *   - **the raw string a dead pipe produces, and that the classifier recognises it** — this was the
 *     hole. `failure-cause-message.test.ts` asserted `isTransportFailure('ENOENT')` against a string
 *     it wrote down itself, annotated "what a dead pipe produces", which was an assumption about a
 *     real dependency never measured. Now `contract/daemon-transport-failure.contract.test.ts`, on a
 *     real socket against a real absent pipe;
 *   - **one cause raises one notice, and further failures sharing it raise none** (FR-019) —
 *     `unit/notice-suppression.test.ts`, 22 tests;
 *   - **dismissal re-arms the cause** (FR-019c) — the same file, by name.
 *
 * What is left is the part none of those can reach: **a real daemon process tree actually dying**,
 * and the running application noticing. That is process lifecycle, so the tag now says so.
 *
 * The correction is worth more than the retag. The cost of a stale justification is not that the
 * test is expensive — it is that the tag stops anyone asking, and this one had been answering
 * "wiring" for two releases after the wiring grew tests.
 *
 * ══ WHAT THIS TEST ASSERTS ══
 *
 * That the user is TOLD, once, and is never handed a raw errno.
 *
 * ── HOW IT CHANGED WHEN THE SPEC LANDED, AND WHY THAT IS NOT A CLIMBDOWN ──
 *
 * Written as a replication, this waited for the project switch to raise its OWN notice — true on
 * master, where every casualty of the dead daemon reported separately. FR-019 then made the opposite
 * true on purpose: the first failure attributable to a cause raises the notice and further failures
 * sharing it raise none, because six notices about one dead daemon is the cascade #182 complains of
 * wearing a different hat.
 *
 * So "the switch raised a notice" stopped being evidence of anything good. What replaces it is
 * stronger, because an ABSENCE proves nothing on its own — a click that silently did nothing would
 * look identical. The test therefore DISMISSES the notice and acts again: FR-019c re-arms the cause
 * when its notice goes, so a second notice must appear. That single move proves all three things at
 * once — daemon-dependent work really does fail, suppression was what silenced it, and the re-arm
 * works — where asserting the absence alone proves none of them.
 */

/** Every notice on screen, whatever raised it, as one string. */
async function allNoticeText(win: import('@playwright/test').Page): Promise<string> {
  const parts = await win.locator('[data-testid$="-error"], [data-testid^="notice-"]').allInnerTexts();
  return parts.join(' | ');
}

test('a daemon that dies is reported to the user, not turned into a raw RPC error', { tag: ['@extended', '@failure', '@reserve:process'] }, async () => {
  // An elevated daemon lives in a different process tree (the de-elevated agent), which
  // `forceKillProcessTree` on the health.ping pid does not describe.
  skipIfElevated();
  test.setTimeout(180_000);

  const root = mkdtempSync(join(tmpdir(), 'throng-182-root-'));
  const other = mkdtempSync(join(tmpdir(), 'throng-182-other-'));
  // A folder for the create that re-arms the cause below. It is never actually created as a
  // project — the daemon is dead by then, which is the entire point.
  const third = mkdtempSync(join(tmpdir(), 'throng-182-third-'));

  try {
    await runApp(
      async (_app, win, { pipeName }) => {
        await createProject(win, 'DaemonProj', root);
        const pid = await firstPanelId(win);
        await win.getByTestId(`panel-type-select-${pid}`).selectOption('terminal');
        await win.getByTestId('terminal-flavour').selectOption('cmd');
        await win.getByTestId(`panel-type-confirm-${pid}`).click();
        // SETUP: a real, live shell — so the daemon is genuinely doing work when it is killed.
        await expect(win.getByTestId(`terminal-${pid}`)).toContainText(basename(root), {
          timeout: 20_000,
        });

        // A second project to switch to once the daemon is gone. Created BEFORE the kill, because
        // creating one afterwards is itself an RPC and would fail for the same reason.
        await createProject(win, 'OtherProj', other);
        await expect(win.locator('.project-item')).toHaveCount(2);

        // ── Kill the daemon out from under the running app. ───────────────────────────────────
        // SETUP: it answered health.ping, so it was alive at the moment we killed it — this is not
        // a test that passes because the daemon had already gone.
        const daemon = await daemonPid(pipeName);
        expect(daemon).toBeGreaterThan(0);
        forceKillProcessTree(daemon);

        /**
         * FR-006 / FR-007 — throng notices unprompted, and says so.
         *
         * Before any dependent action is attempted, deliberately: the daemon's death is news in its
         * own right, and a UI that only mentioned it once the user happened to trip over it would
         * still be #182. Wording matched loosely — the copy is the spec's to choose.
         */
        const daemonError = win.getByTestId('daemon-error');
        await expect(daemonError).toHaveCount(1, { timeout: 30_000 });
        await expect(daemonError).toContainText(/daemon|background service/i);
        await expect(daemonError).not.toContainText('ENOENT');

        /**
         * FR-008 / FR-009 — and there is a way back.
         *
         * The notice is transient; the restart lives in the status bar, so dismissing the message
         * does not take the remedy with it.
         */
        await expect(win.getByTestId('status-daemon')).toBeVisible();

        // ── FR-019: a second casualty of the SAME cause adds nothing. ─────────────────────────
        const switchTo = async (name: string): Promise<void> => {
          await win
            .locator('.project-item', { hasText: name })
            .locator('[data-testid^="project-switch-"]')
            .click();
        };
        const projectError = win.getByTestId('project-error');
        await switchTo('OtherProj');

        /*
         * A fixed wait, because the thing being asserted is an ABSENCE and absences have no event to
         * wait on. Measured at 500ms / 2.5s / 7.5s / 17.5s after the click, the screen carried the
         * one daemon notice and nothing else, so 3s sits well past where a notice would have landed
         * without being a guess about a slower machine — and the re-arm below is what makes this
         * meaningful rather than merely quiet.
         */
        // sleep-justified: switchProject's RPC may not even fire on an already-active project (see below), so no completion event is guaranteed to happen for this poll to catch
        await win.waitForTimeout(3000);
        expect(await projectError.count(), 'a second notice for one dead daemon').toBe(0);
        await expect(daemonError).toHaveCount(1);
        /*
         * And nothing ANYWHERE on the notice surface is a raw pipe error.
         *
         * Asserted across every notice rather than on the one being examined, because the failure
         * this guards against is a notice raised by a surface nobody thought about — the explorer,
         * a sub-workspace — while the one under test stays clean.
         */
        expect(await allNoticeText(win)).not.toMatch(/ENOENT|jsonrpc|\\\\[.?]\\pipe\\/i);

        // ── FR-019c: dismissing the notice RE-ARMS the cause. ─────────────────────────────────
        //
        // This is the half that makes the absence above mean something. Dismissal is the user saying
        // "I have dealt with this", so the next failure attributable to the cause must speak up —
        // and its doing so proves the switch was failing all along rather than doing nothing.
        await win.getByTestId('daemon-error-dismiss').first().click();
        await expect(daemonError).toHaveCount(0);

        /*
          * The re-arm is triggered by a CREATE, not by another switch.
          *
          * A switch is state-dependent: `switchProject` sets the opened id optimistically BEFORE the
          * RPC and does not put it back when the RPC fails, so whether a later click is a real change
          * or a silent no-op depends on where the previous failure left the store. Measured — it
          * raised the notice three runs and then, unchanged, raised nothing on the fourth. A test
          * that asserts "something must now be reported" cannot be built on an action that is
          * sometimes not performed.
          *
          * Creating a project always calls the daemon.
          */
        await win.getByTestId('project-new').click();
        await expect(win.getByTestId('project-form')).toBeVisible();
        await win.getByTestId('project-root-input').fill(third);
        await win.getByTestId('project-name-input').fill('ThirdProj');
        await win.getByTestId('project-save').click();
        await expect(projectError).toHaveCount(1, { timeout: 30_000 });

        /**
         * FR-010 — the re-armed notice names the CAUSE, not the casualty, and carries no pipe error.
         *
         * `ENOENT` for a dead named pipe is the single most misleading string in this failure: it is
         * the same code a missing FILE produces, so a user reading it goes hunting for a file that
         * was never involved.
         */
        await expect(projectError).not.toContainText('ENOENT');
        await expect(projectError).not.toContainText(/jsonrpc|rpc error/i);
        await expect(projectError).toContainText(/background service|daemon|not running|stopped/i);
      },
      // The app spawns its own daemon, so `daemonPid` resolves it via health.ping and teardown's
      // `killAppSpawnedDaemon` tolerates it already being dead.
      { skipDaemon: true },
    );
  } finally {
    cleanupTemp(root);
    cleanupTemp(other);
    cleanupTemp(third);
  }
});
