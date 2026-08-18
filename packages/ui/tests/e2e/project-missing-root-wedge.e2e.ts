import { mkdtempSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { test, expect, type Locator, type Page } from '@playwright/test';
import { runApp, createProject, firstPanelId, cleanupTemp } from './harness.js';
import { skipIfElevated } from './admin.js';

/**
 * 029 / #181 — a project whose folder no longer exists must fail cleanly, not wedge the workspace.
 *
 * ══ THE DEFECT AS REPORTED ══
 *
 * Switching to a project whose root has been deleted or moved fails with a bare `ENOENT`, and the
 * workspace WEDGES: the Files & Folders tree changes to the new project, but the active tab and the
 * main display never switch. Panels keep responding, so the application looks alive while being
 * stuck half-way between two projects.
 *
 * ══ THE ISSUE'S STATED CAUSE IS WRONG ══
 *
 * #181 blames `WindowsDirectoryLock`: "projects.setActive takes the project lock by spawning a
 * helper with `cwd: <project folder>`… a missing cwd makes `spawn` throw `ENOENT`". The code does
 * not support that:
 *
 *   • `packages/persistence/src/project-repository.ts:102` — `setActiveExclusive` is a pure SQLite
 *     transaction. It touches no filesystem.
 *   • `packages/daemon/src/project-service.ts:114` — the RPC handler is a straight pass-through.
 *   • `packages/daemon/src/terminal-service.ts:422` — `locks.acquire(projectId, launch.cwd)` is the
 *     ONLY production caller of the directory lock, and it runs on terminal CREATE.
 *
 * ══ MEASURED, FIRST ATTEMPT: NO TERMINAL ⇒ NO FAILURE AT ALL ══
 *
 * Switching to a folder-less project whose panels are all UNTYPED was measured on master as a
 * clean, complete success:
 *
 *     [MEASURE-181-NOTICE] (no project-error notice)
 *     [MEASURE-181-PANELS] 2   ← the target project's own panel count; the workspace DID switch
 *
 * Nothing threw, nothing wedged, no notice appeared. That is consistent with the tracing above and
 * inconsistent with the issue: `setActive` cannot fail on a missing folder because it never looks
 * at one.
 *
 * So the trigger has to be something that TOUCHES the filesystem on entry, and the only such thing
 * is a terminal attaching — which takes the directory lock and throws `Cannot lock "…": the path
 * does not exist` (`packages/platform-windows/src/windows-directory-lock.ts:39`). This version
 * therefore gives the target project a real terminal, which is also what the reporter's session had.
 *
 * The half-switch, if it appears, has its own separate explanation:
 * `packages/ui/src/renderer/state/projects-store.tsx:168` sets `setOpenedId(id)` OPTIMISTICALLY,
 * before `await run('open this project', …)`, and `refresh()` only runs on the success path — so
 * the explorer can follow the optimistic id while `activeProject` never moves.
 *
 * ══ MEASURED, SECOND ATTEMPT: THE ISSUE'S STEPS CANNOT BE PERFORMED AS WRITTEN ══
 *
 * #181's repro says "delete or rename that folder outside throng" with throng running. If the
 * target project has ever been OPENED in that session, it has a live terminal, the daemon holds its
 * root, and Windows refuses the rename outright — measured here as a 30-second poll that never
 * succeeded. Terminals survive a project switch by design (the sidebar keeps showing `1T·1P`), so
 * switching away does not release the lock either.
 *
 * The steps therefore only work for a project that is NOT loaded — which is the ordinary case, and
 * is what the reporter would have had: a project they had not opened yet that session. This test
 * reproduces that with a restart, which unloads everything and releases every lock.
 *
 * ══ MEASURED, THIRD ATTEMPT: #181 IS TWO CLAIMS, AND ONLY ONE OF THEM REPRODUCES ══
 *
 *     [MEASURE-181-NOTICES]  An error occurred when you tried to list the contents of this folder
 *                            ENOENT: no such file or directory, realpath '<Bravo's root>'
 *                          | Internal error: Cannot lock "<Bravo's root>": the path does not exist
 *     [MEASURE-181-EXPLORER] Project settings — ProjectBravo
 *     [MEASURE-181-ACTIVE]   ProjectBravo
 *     [MEASURE-181-PANELS]   1
 *
 * **The raw-errno claim reproduces, twice over.** The user gets `ENOENT: … realpath` from the
 * explorer trying to list the folder, AND `Internal error: Cannot lock "…"` from the terminal
 * trying to attach. Two internal strings, neither of which says "the folder you moved is gone".
 *
 * **The WEDGE claim does not reproduce.** The explorer and the sidebar agree — both are on
 * ProjectBravo — so the workspace switched cleanly and completely. There is no half-switched state
 * on master today.
 *
 * And the ENOENT does NOT come from `setActive` at all: it comes from the explorer's `realpath` on
 * the missing root, which is a different code path from the one the issue names. The optimistic
 * `setOpenedId` described above is real, but it cannot produce a visible split here because
 * `setActive` succeeds — so both halves of the app follow it.
 *
 * The single remaining panel is #204 showing through: Bravo's terminal could not attach, so its
 * panel reverted to the type form.
 *
 * ══ WHAT THIS TEST ASSERTS ══
 *
 * The INTENDED behaviour, so it FAILS on master — on the message assertions, which is where the
 * live defect is.
 *
 * The coherence assertion currently PASSES. It is kept deliberately, as a guard rather than a
 * replication: whatever 029 does about the failed entry — leave the workspace on the previous
 * project, switch with an empty state, offer to repoint — it must not arrive at a state where the
 * explorer and the sidebar name different projects. Removing a passing assertion because it is not
 * the bug would delete the only thing stopping the fix from introducing it.
 *
 * "Offers to remove or repoint the project" is deliberately NOT asserted — that is a surface 029
 * must design, and baking a testid for it here would pre-decide the spec.
 */

/** Which project the EXPLORER pane is showing — its settings button names it outright. */
async function explorerProject(win: Page): Promise<string> {
  const btn = win.locator('[aria-label^="Project settings"], [title^="Project settings"]').first();
  return (await btn.count()) > 0 ? ((await btn.getAttribute('aria-label')) ?? (await btn.getAttribute('title')) ?? '') : '(none)';
}

/**
 * Every notice on screen, whatever surface raised it.
 *
 * Matched on the notices CONTAINER and the `.notice` card rather than on a list of test-id
 * shapes. The id list was `[data-testid$="-error"], [data-testid^="panel-exit-"],
 * [data-testid^="notice-"]`, and 030 US3 walked straight through it: the consolidated notice
 * this failure now raises is `panel-failure-notice`, which starts with none of them and ends
 * with none of them — so the count below read ZERO while the notice was on screen and being
 * read by the assertions above it. A locator that asks "what notices are there" cannot be an
 * enumeration of the ids that happened to exist when it was written: that list goes stale
 * silently, and in the direction of a false green.
 */
function noticeCards(win: Page): Locator {
  return win.getByTestId('notices').locator('.notice');
}

async function allNoticeText(win: Page): Promise<string> {
  const parts = await noticeCards(win).allInnerTexts();
  return parts.join(' | ').replace(/\n/g, ' ') || '(no notices)';
}

test('entering a project whose folder is gone reports it and does not split the workspace', { tag: ['@extended', '@window'] }, async () => {
  skipIfElevated();
  test.setTimeout(240_000);

  const rootA = mkdtempSync(join(tmpdir(), 'throng-181-a-'));
  const rootB = mkdtempSync(join(tmpdir(), 'throng-181-b-'));
  const movedB = `${rootB}-gone`;
  writeFileSync(join(rootA, 'alpha-file.txt'), 'A\n');
  writeFileSync(join(rootB, 'bravo-file.txt'), 'B\n');

  const dataDir = mkdtempSync(join(tmpdir(), 'throng-181-data-'));
  const userDataDir = mkdtempSync(join(tmpdir(), 'throng-181-ud-'));

  try {
    // ── Launch 1: two projects, Bravo carrying a real terminal, ending on Alpha. ──────────────
    await runApp(
      async (_app, win) => {
        await createProject(win, 'ProjectAlpha', rootA);
        await createProject(win, 'ProjectBravo', rootB);

        // Bravo gets a REAL terminal. Without one, nothing on the entry path touches the filesystem
        // and the missing folder is never noticed at all (see the first measurement above).
        const bravoPanel = await firstPanelId(win);
        await win.getByTestId(`panel-type-select-${bravoPanel}`).selectOption('terminal');
        await win.getByTestId('terminal-flavour').selectOption('cmd');
        await win.getByTestId(`panel-type-confirm-${bravoPanel}`).click();
        await expect(win.getByTestId(`terminal-${bravoPanel}`)).toContainText(basename(rootB), {
          timeout: 20_000,
        });

        // End on Alpha, so launch 2 opens there and Bravo is the project being ENTERED.
        await win
          .locator('.project-item', { hasText: 'ProjectAlpha' })
          .locator('[data-testid^="project-switch-"]')
          .click();
        await expect(
          win.getByTestId('file-explorer-tree').getByText('alpha-file.txt', { exact: true }),
        ).toBeVisible({ timeout: 20_000 });
      },
      { dataDir, userDataDir },
    );

    // ── Break Bravo's root while throng is closed. ────────────────────────────────────────────
    // Polled rather than assumed: the daemon's lock helper exits when the daemon does, which is a
    // beat after teardown returns.
    await expect
      .poll(
        () => {
          try {
            renameSync(rootB, movedB);
            return true;
          } catch {
            return false;
          }
        },
        { timeout: 30_000, message: "could not rename Bravo's root away (lock never released?)" },
      )
      .toBe(true);
    expect(existsSync(rootB)).toBe(false); // SETUP landed

    // ── Launch 2: enter Alpha, then switch to Bravo — the reporter's "switch to that project". ──
    //
    // Alpha has to be entered EXPLICITLY. Measured: a restarted throng opens on "No project —
    // throng" / "No project selected", because a project is opened lazily per session and nothing
    // is restored automatically. Without this step there is no previously-open workspace for the
    // failed switch to be left on, and the reported symptom — half on one project, half on the
    // other — has nothing to be half of.
    await runApp(
      async (_app, win) => {
        await win
          .locator('.project-item', { hasText: 'ProjectAlpha' })
          .locator('[data-testid^="project-switch-"]')
          .click();
        const tree = win.getByTestId('file-explorer-tree');
        await expect(tree.getByText('alpha-file.txt', { exact: true })).toBeVisible({
          timeout: 25_000,
        });
        expect(await explorerProject(win)).toContain('ProjectAlpha'); // SETUP: we start on Alpha

        await win
          .locator('.project-item', { hasText: 'ProjectBravo' })
          .locator('[data-testid^="project-switch-"]')
          .click();

        /*
         * A fixed wait, kept from the replication and now doing a different job.
         *
         * Entering a project fans out — the explorer lists the root, the layout restores, each
         * terminal attaches — and every one of those can fail independently. The assertions below
         * are about what the app SETTLES on, including the negative ones (no second notice, no
         * errno anywhere), and a negative asserted mid-cascade proves nothing. There is no single
         * event that means "the entry has finished failing", which is exactly when a wait with a
         * stated reason is the honest instrument.
         */
        // sleep-justified: entering a project fans out into independent async failures (explorer listing, terminal attach, notice consolidation) with no single event marking "the cascade has finished failing", and the assertions below — including the negative ones — must read whatever it settles on, not any one piece mid-flight.
        await win.waitForTimeout(8000);
        const noticeText = await allNoticeText(win);
        const explorerName = await explorerProject(win);
        const activeName = (
          await win.locator('.project-item[data-active="true"]').allInnerTexts()
        ).join(' / ').replace(/\n/g, ' ');

        /**
         * GUARD (currently passing) — the two halves of the app agree on which project is open.
         *
         * The wedge the issue describes, stated without pre-judging which half is meant to win:
         * whatever the explorer is showing, the sidebar's active project must match it.
         *
         * Measured on master: they DO agree, so this does not reproduce (see the header). It stays
         * because the state it forbids — "the application looks alive while being stuck half-way
         * between two projects" — is one a fix could easily introduce while rerouting the failed
         * entry, and nothing else in the suite would catch it.
         */
        const agreed =
          (explorerName.includes('ProjectBravo') && activeName.includes('ProjectBravo')) ||
          (explorerName.includes('ProjectAlpha') && activeName.includes('ProjectAlpha'));
        expect(
            agreed,
            `the explorer and the sidebar disagree about which project is open — explorer: "${explorerName}", active: "${activeName}"`,
          )
          .toBe(true);

        /**
         * RED #2 — the user is TOLD, and the message names the folder IN ITS PROSE.
         *
         * Paths are stripped before matching for the same reason as in `fileop-lock-cause`: the
         * folder name appears inside the raw error's path, so an unstripped `toContain` passes
         * while the message is still an errno. The point of the requirement is that the sentence
         * names the folder, not that the folder's characters occur somewhere in the blob.
         */
        const prose = noticeText.replace(/[A-Za-z]:\\[^\s'"|]+/g, '<path>');
        expect(prose, 'the notice does not name the missing folder').toContain(basename(rootB));
        expect(prose, 'the notice does not say the folder is missing')
          .toMatch(/no longer exists|could not be found|missing|moved or deleted/i);
        expect(prose, 'the notice hands the user a raw internal error')
          .not.toMatch(/ENOENT|Internal error|Cannot lock/i);

        /**
         * FR-019 / FR-019a — ONE notice for one missing folder, and the panels still say what broke.
         *
         * Measured on master: two notices for one absent folder, from the file tree and from a
         * terminal, each phrased differently about the same fact. FR-019 collapses them on the cause.
         *
         * The second half is what keeps that from being a loss. Suppression must hide the duplicate
         * MESSAGE, never which parts of the workspace stopped working — so the notice answers "why"
         * exactly once, and each panel that could not start still answers "what" in place. Without
         * this pair asserted together, "collapse the notices" and "hide the damage" look identical
         * from the outside.
         *
         * 030 US3 strengthened the surviving notice rather than changing this count: it is now
         * the CONSOLIDATED one, which additionally lists the panels the folder defeated, and it
         * SUPERSEDES the file tree's report of the same cause instead of merely arriving after
         * it. Whichever of the two reports first, exactly one notice stands.
         */
        const notices = noticeCards(win);
        expect(await notices.count(), 'one cause should raise one notice').toBe(1);
        /*
         * 030 US4 / T060b — `terminal-start-failed-*` is now the shared `panel-failure-*` banner.
         *
         * The `:not()` is load-bearing, not tidiness. The consolidated notice's own ids all begin
         * `panel-failure-notice` (`workspace/panel-failure-notice.ts` — the card AND its dismiss
         * control), and that notice is on screen here, so a bare prefix match on `panel-failure-`
         * selects three elements where one panel failed. MEASURED: it did, exactly that, which is
         * why the exclusion is itself a PREFIX and not an equality — an equality caught the card and
         * left its button behind. Panel ids are uuids, so the two families can never collide on an
         * exact id; only a prefix match confuses them.
         */
        await expect(
          win.locator('[data-testid^="panel-failure-"]:not([data-testid^="panel-failure-notice"])'),
          'the panel that could not start says so in place',
        ).toHaveCount(1);

        /**
         * FR-019d — a watcher re-reporting the same failure stays silent while the notice stands.
         *
         * The explorer re-reads its folders on every filesystem event, and the root is still gone, so
         * this failure recurs on its own for as long as the user looks at it. Handled by the same
         * cause key rather than by a second rule: the notice is live, so the cause is spoken for.
         * Waited out rather than triggered, because the recurrence IS the watcher's own timer.
         */
        // sleep-justified: the explorer's re-check runs on its own filesystem-watch timer with no signal exposed to this test, so waiting out at least one of its cycles is the only way to give a recurring failure the chance to raise the second notice this asserts absent.
        await win.waitForTimeout(5000);
        expect(
          await notices.count(),
          'a recurring failure re-notified while its notice was still on screen',
        ).toBe(1);
      },
      { dataDir, userDataDir },
    );
  } finally {
    for (const dir of [rootA, rootB, movedB, dataDir, userDataDir]) cleanupTemp(dir);
  }
});
