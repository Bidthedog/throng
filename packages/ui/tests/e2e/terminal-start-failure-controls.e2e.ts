import { mkdirSync, mkdtempSync, renameSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import Database from 'better-sqlite3';
import { test, expect, type Locator, type Page } from '@playwright/test';
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
 * 029 US1 — the CONTROLS on a terminal that could not start.
 *
 * ══ WHY A SEPARATE FILE FROM `terminal-launch-failure-config.e2e.ts` ══
 *
 * That spec is #204's replication: a terminal that fails to launch must not lose its configuration.
 * It should keep reading as the reproduction of that bug. This one covers what 029 ADDS — a failure
 * shown in place, with two controls, reachable from the panel's menu as well as the badge.
 *
 * ══ THE POINT OF THE `Clear` CONTROL ══
 *
 * #204's fix is that a failed start no longer clears the panel type. That leaves the user with a
 * panel stuck as a terminal it cannot start, so the clearing has to remain AVAILABLE — the change is
 * that it becomes something the user does, not something that happens to them (FR-004a). Asserting
 * the control exists and works is what stops the fix from being a trap.
 *
 * ══ AND WHY THE MENU ITEMS ARE ASSERTED HERE ══
 *
 * The Constitution binds a feature that adds a panel action to add its menu item in the same
 * increment: an icon-only control with no menu equivalent is unreachable by keyboard and
 * undiscoverable by anyone who does not recognise the glyph.
 *
 * ══ REPOINTED BY 030 US4 (T056e) — WHAT MOVED, AND WHAT DID NOT ══
 *
 * 030 FR-039 replaces this panel's `terminal-panel__starting` failure strip with the shared
 * `PanelFailureBanner` every panel type uses, so the SURFACE these tests address changes while the
 * BEHAVIOUR they describe does not. Precisely:
 *
 *   CHANGED — `terminal-start-failed-{pid}` becomes `panel-failure-{pid}` ({@link failureBanner}),
 *     and `terminal-retry-{pid}` / `terminal-clear-{pid}` become controls addressed by their
 *     accessible names INSIDE that banner ({@link bannerControl}). The names are unchanged: FR-042d
 *     keeps 029's *Try again* and *Clear panel type* in every panel type precisely so this file's
 *     claims survive. Addressing them by name rather than by a new test id also states the
 *     requirement itself — a control the constitution demands be named is found by its name.
 *   CHANGED — the FR-004 prose check, split in two. See the comment at its site.
 *   UNCHANGED — every menu-item assertion (`menu-item-Try again`, `menu-item-Clear panel type`),
 *     every `panel-type-form-{pid}` assertion, the context-menu open/close, the persisted-layout
 *     polls and the whole daemon-death test's subject matter.
 *
 * ══ WHY ONE HELPER, AND NOT AN INLINE `getByTestId` PER SITE ══
 *
 * Two of this file's assertions are `toHaveCount(0)` — the banner is GONE after Clear, and no
 * failure banner exists at all on the cwd-fallback path. A negative keyed on a test id that no
 * longer exists passes by matching nothing, silently, which is the exact false green 030 US3 found
 * in `project-missing-root-wedge`'s locator. Routing every reference — positive and negative —
 * through one helper is what closes that: the positives in the first test would fail loudly if the
 * id were ever wrong, so the negatives elsewhere cannot quietly stop testing anything.
 *
 * NOTE for whoever picks up #246 ("reads the layout after a fixed sleep, not after the write"): that
 * defect lived in this file's timed wait plus `layoutJson` reads, addressed in 034 (I251) — see the
 * `sleep-justified` markers by the two waits below for why a fence is still not possible there. This
 * change moved locators only.
 */

/**
 * The failure banner of panel `pid` — 030's shared component (contracts/panel-failure-banner.md).
 *
 * The ONE place this file names that surface. See the header for why that matters.
 */
function failureBanner(win: Page, pid: string): Locator {
  return win.getByTestId(`panel-failure-${pid}`);
}

/**
 * A banner control, by the accessible name FR-042d fixes for every panel type.
 *
 * Deliberately scoped INSIDE the banner. `terminal-retry-{pid}` survives 030 on the still-starting
 * strip, which FR-039a keeps exactly as it is — so an unscoped locator would go on resolving after
 * this change while quietly addressing a different state of a different kind.
 */
function bannerControl(win: Page, pid: string, name: string): Locator {
  return failureBanner(win, pid).getByRole('button', { name, exact: true });
}

/**
 * The persisted layout blob for `projectName`, or '' if there isn't one yet.
 *
 * '' means "could not read", NOT "the layout is empty" — the two are different facts and collapsing
 * them is the defect #246 was reported for. Every caller must therefore establish that this returned
 * something before asserting on what it contains; a bare read can be the database mid-write.
 */
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
 * Rename `from` to `to`, waiting out the directory lock rather than assuming it has dropped.
 *
 * The daemon holds a project root for as long as a terminal is open, via a helper whose cwd IS the
 * folder, and that helper exits a beat AFTER `runApp`'s teardown returns. Renaming immediately
 * therefore races the OS releasing the handle, and loses often enough to matter.
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
  expect(existsSync(to)).toBe(true);
}

/** Reopen a project from the sidebar. */
async function enterProject(win: Page, name: string): Promise<void> {
  const item = win.locator('.project-item', { hasText: name });
  await expect(item).toBeVisible({ timeout: 20_000 });
  const sw = item.locator('[data-testid^="project-switch-"]');
  if (await sw.isVisible().catch(() => false)) await sw.click();
  await expect(win.locator('.panel-box').first()).toBeVisible({ timeout: 20_000 });
}

test('a terminal that could not start offers Try again and Clear, on the badge and in its menu', { tag: ['@extended', '@terminal'] }, async () => {
  // An elevated daemon routes terminals through the de-elevated agent — a different process tree
  // from the one these assertions describe.
  skipIfElevated();
  test.setTimeout(300_000);

  const root = mkdtempSync(join(tmpdir(), 'throng-029c-root-'));
  const moved = `${root}-renamed`;
  const dataDir = mkdtempSync(join(tmpdir(), 'throng-029c-data-'));
  const userDataDir = mkdtempSync(join(tmpdir(), 'throng-029c-ud-'));

  try {
    // ── Launch 1: a real terminal, persisted. ────────────────────────────────────────────────
    await runApp(
      async (_app, win) => {
        await createProject(win, 'Controls', root);
        const pid = await firstPanelId(win);
        await win.getByTestId(`panel-type-select-${pid}`).selectOption('terminal');
        await win.getByTestId('terminal-flavour').selectOption('cmd');
        await win.getByTestId(`panel-type-confirm-${pid}`).click();
        await expect(win.getByTestId(`terminal-${pid}`)).toContainText(basename(root), {
          timeout: 20_000,
        });
        await expect
          .poll(() => layoutJson(dataDir, 'Controls').includes('"kind":"terminal"'), {
            timeout: 20_000,
            message: 'the terminal panel was never persisted',
          })
          .toBe(true);
      },
      { dataDir, userDataDir },
    );

    // Break the root, so the next launch cannot start the shell.
    await renameWhenReleased(root, moved);

    // ── Launch 2: the failure state, and everything on it. ───────────────────────────────────
    await runApp(
      async (_app, win) => {
        await enterProject(win, 'Controls');
        const pid = await firstPanelId(win);

        // SETUP: the panel really is in the start-failure state — everything below describes it.
        const badge = failureBanner(win, pid);
        await expect(badge).toBeVisible({ timeout: 60_000 });

        /**
         * FR-004 — the failure is stated in the panel, in prose, naming the folder, and never as an
         * errno.
         *
         * SPLIT IN TWO by 030 T056e, and this is the one substantive change in the file.
         *
         * It used to be one assertion over path-stripped text: strip `C:\…` first, because the
         * folder's name appears INSIDE the raw error's path and an unstripped match would pass while
         * the message was still an errno. That was right while the terminal composed its own
         * sentence around the folder name. Under FR-039 the per-type wording is confined to the
         * headline and the folder reaches the user through the banner's own path line (FR-040a) —
         * so stripping paths would strip the very thing the first half asserts, and the test would
         * fail for being satisfied.
         *
         * Both halves of the original claim survive, addressed separately:
         *   • the folder IS named — anywhere in the banner, prose or path line;
         *   • what the user READS is not an errno — still asserted on the stripped text, because
         *     that half's whole point is that a path must not be able to smuggle one in.
         */
        const shown = await badge.innerText();
        // The ORIGINAL folder name: that is the path the project still points at, and the one that
        // is missing. `moved` is where it went, which the user has no way to know and no reason to
        // be told.
        expect(shown, 'the banner does not name the folder that is missing').toContain(basename(root));
        const prose = shown.replace(/[A-Za-z]:\\[^\s'"|]+/g, '<path>');
        expect(prose).not.toMatch(/ENOENT|Cannot lock|Internal error/i);

        /**
         * FR-004b / 030 FR-042b — both controls are ICONS with hover titles (Constitution VI).
         *
         * The empty-text assertion is the one that matters: an icon token the shipped theme does not
         * define renders NOTHING, silently, and the control becomes an invisible button. That has
         * already happened once in this feature.
         *
         * Addressed by accessible name now, not by test id (see the header). Note that the names
         * ARE the assertion for FR-042d: a control that lost its title would not be found at all,
         * and `toBeVisible` on a locator that matches nothing fails rather than passing.
         */
        for (const name of ['Try again', 'Clear panel type']) {
          const control = bannerControl(win, pid, name);
          await expect(control).toBeVisible();
          await expect(control).toHaveAttribute('title', /.+/);
          const glyph = (await control.innerText()).trim();
          expect(glyph, `${name} rendered nothing — an invisible control`).not.toBe('');
          expect(glyph.length, `${name} should be an icon, not a word`).toBeLessThanOrEqual(2);
          expect(glyph, `${name} should be an icon, not a word`).not.toMatch(/[A-Za-z]/);
        }

        /**
         * FR-004d — and both are in the panel's CONTEXT MENU.
         *
         * Right-clicking the panel BODY, not the badge: the badge is a sibling with no handler of
         * its own, so a right-click on it bubbles past and opens nothing. The menu handler sits on a
         * div rendered in every state, which is what makes it reachable while the panel is failed.
         */
        await win.locator('.panel-box').first().click({ button: 'right', position: { x: 20, y: 120 } });
        await expect(win.getByTestId('context-menu')).toBeVisible();
        await expect(win.getByTestId('menu-item-Try again')).toBeVisible();
        await expect(win.getByTestId('menu-item-Clear panel type')).toBeVisible();
        /*
         * Dismissed by CLICKING AWAY, not by Escape — the pattern `context-menu.e2e.ts:113` uses.
         *
         * Escape has to reach the menu, and a terminal panel is exactly the surface that might eat
         * it first. Measured: it held the menu open for the full 10s budget across 23 polls, in a
         * run where the same code had passed three times before. A click on the tab body has one
         * destination and no such argument with anything.
         */
        await win.getByTestId('tab-body').click({ position: { x: 5, y: 5 } });
        await expect(win.getByTestId('context-menu')).toHaveCount(0);

        /**
         * FR-004c — retry acts on THIS panel only.
         *
         * Asserted as "the panel is still the one that failed, and is still a terminal": a retry that
         * cascaded would take the panel type with it, which is #204 by another route.
         */
        await bannerControl(win, pid, 'Try again').click();
        await expect(badge).toBeVisible({ timeout: 60_000 });
        await expect(win.getByTestId(`panel-type-form-${pid}`)).toHaveCount(0);

        /**
         * FR-004a — Clear is the user's decision, and it works.
         *
         * The panel returns to the type-selection form, in place — same position, same panel.
         */
        const titleBefore = await win.locator('.panel-box').first().getAttribute('data-panel-id');
        await bannerControl(win, pid, 'Clear panel type').click();
        await expect(win.getByTestId(`panel-type-form-${pid}`)).toBeVisible({ timeout: 20_000 });
        // Non-vacuous by construction: `badge` is the same locator asserted VISIBLE four times above
        // in this test, so a stale id could never reach this line quietly.
        await expect(badge).toHaveCount(0);
        // Still the SAME panel in the SAME place — cleared, not destroyed and recreated.
        expect(await win.locator('.panel-box').first().getAttribute('data-panel-id')).toBe(titleBefore);
      },
      { dataDir, userDataDir },
    );
  } finally {
    cleanupTemp(root);
    cleanupTemp(moved);
    cleanupTemp(dataDir);
    cleanupTemp(userDataDir);
  }
});

/**
 * 029 FR-005a / FR-005b — the remembered directory is gone, and the terminal SAYS so.
 *
 * ══ WHY THIS IS NOT A FAILURE, AND WHY IT IS NOT SILENT EITHER ══
 *
 * 025 made this fallback silent on purpose and was right that it must never be an error: the shell
 * starts, nothing is lost, and interrupting the user would be nagging. But #204's cycle exposed the
 * cost of silence — restore a project root while a subfolder inside it stays deleted, and the user
 * finds a shell at the root with no explanation, which reads as "remember-my-directory is broken".
 *
 * So the notice has to thread a needle: informative, dismissable, and NOT an error. All three are
 * asserted here, because getting any one of them wrong turns a helpful line into either noise or a
 * false alarm. `fallbackToReport` unit-tests WHEN to report; this is the half that reaches a user.
 */
test('a remembered directory that has gone is reported in the panel, and is not an error', { tag: ['@extended', '@terminal'] }, async () => {
  skipIfElevated();
  test.setTimeout(300_000);

  const root = mkdtempSync(join(tmpdir(), 'throng-029f-root-'));
  const deep = join(root, 'Deep');
  mkdirSync(deep);
  const dataDir = mkdtempSync(join(tmpdir(), 'throng-029f-data-'));
  const userDataDir = mkdtempSync(join(tmpdir(), 'throng-029f-ud-'));

  try {
    // ── Launch 1: leave the shell inside `Deep`, and let that be remembered. ─────────────────
    await runApp(
      async (_app, win) => {
        await createProject(win, 'Fallback', root);
        const pid = await firstPanelId(win);
        await win.getByTestId(`panel-type-select-${pid}`).selectOption('terminal');
        await win.getByTestId('terminal-flavour').selectOption('cmd');
        await win.getByTestId(`panel-type-confirm-${pid}`).click();
        const term = win.getByTestId(`terminal-${pid}`);
        await expect(term).toContainText(basename(root), { timeout: 20_000 });

        await term.click();
        await win.keyboard.type('cd Deep');
        await win.keyboard.press('Enter');
        await expect(term).toContainText(`${basename(root)}\\Deep>`, { timeout: 20_000 });

        // SETUP: the directory reached the PERSISTED layout. Without this the second launch would
        // remember nothing, no fallback would occur, and the assertions below would pass vacuously
        // against a terminal that simply started at the root for the ordinary reason.
        /*
         * Polled on the VALUE, not on the key.
         *
         * `lastCwd` is written as soon as the terminal starts — holding the project ROOT — so
         * waiting for the key to exist succeeds long before the `cd` has been observed, and the
         * second launch then remembers the root, falls back to nothing, and every assertion below
         * passes vacuously against an ordinary start. Measured exactly that way once.
         *
         * The daemon samples shell cwds on a 1-second timer and the layout save is debounced on top,
         * so the wait is real and the condition is the only honest thing to wait on.
         */
        await expect
          .poll(() => /"lastCwd":"[^"]*Deep/.test(layoutJson(dataDir, 'Fallback')), {
            timeout: 30_000,
            message: 'the terminal never recorded the subfolder as its working directory',
          })
          .toBe(true);
      },
      { dataDir, userDataDir },
    );

    // Delete the remembered subfolder — polled, because the shell held it until a moment ago.
    await expect
      .poll(
        () => {
          try {
            rmSync(deep, { recursive: true, force: true });
            return !existsSync(deep);
          } catch {
            return false;
          }
        },
        { timeout: 30_000, message: 'could not delete the remembered subfolder' },
      )
      .toBe(true);

    // ── Launch 2: it starts at the root, and says why. ───────────────────────────────────────
    await runApp(
      async (_app, win) => {
        await enterProject(win, 'Fallback');
        const pid = await firstPanelId(win);

        const notice = win.getByTestId(`terminal-cwd-fallback-${pid}`);
        await expect(notice).toBeVisible({ timeout: 60_000 });

        // It NAMES the folder that vanished — "your directory is gone" without saying which one
        // leaves the user no better off than the silence this replaced.
        await expect(notice).toContainText('Deep');

        /**
         * NOT an error, in three independent ways.
         *
         * The terminal really started, at the root; the start-failure surface is absent; and no
         * error notice was raised anywhere. A fallback that shipped as an error would be a
         * regression against 025's deliberate choice, and each of these three could be true while
         * another was false.
         */
        await expect(win.getByTestId(`terminal-${pid}`)).toContainText(basename(root), {
          timeout: 30_000,
        });
        /*
         * The failure surface is ABSENT — through the same {@link failureBanner} helper the first
         * test asserts VISIBLE. That shared route is what stops this negative from becoming a false
         * green: an id that had gone stale would redden the first test long before it could let this
         * one pass by matching nothing.
         */
        await expect(failureBanner(win, pid)).toHaveCount(0);
        await expect(win.locator('[data-testid$="-error"]')).toHaveCount(0);

        // Dismissable — it is information, and information the user has read should go away.
        await win.getByTestId(`terminal-cwd-fallback-dismiss-${pid}`).click();
        await expect(notice).toHaveCount(0);
      },
      { dataDir, userDataDir },
    );
  } finally {
    cleanupTemp(root);
    cleanupTemp(dataDir);
    cleanupTemp(userDataDir);
  }
});

/**
 * 029 FR-001 / SC-001 — a STOPPED DAEMON must not cost a panel its configuration.
 *
 * ══ WHY THIS EXISTS, AND WHY IT IS THE MOST IMPORTANT TEST IN THE FILE ══
 *
 * Found by independent review AFTER the feature was called finished, and it is #204 verbatim with a
 * different trigger. The cause that decides "keep the panel type" was produced only by the daemon —
 * so when the daemon was not there to produce one, the attach failure arrived unclassified,
 * `startFailurePreservesPanelType(null)` correctly read that as "revert", and `end()` stripped the
 * panel's kind and config and PERSISTED it.
 *
 * The user-visible shape: open throng while its daemon is down and every configured terminal becomes
 * an empty Panel Type form, permanently, whether or not the daemon ever comes back. The Retry
 * control this feature ADDED made it worse — clicking it while the daemon was down destroyed the
 * configuration the control exists to protect.
 *
 * ══ WHY A TAB SWITCH IS THE TRIGGER ══
 *
 * The panel has to RE-ATTACH while the daemon is dead. Switching projects would be the obvious way
 * and cannot be: that is itself an RPC, so it fails before any panel re-attaches. A tab switch is
 * renderer-local — it unmounts and remounts the panel — so it reaches the attach path with no daemon
 * needed to get there.
 */
test('a terminal keeps its configuration when the daemon is gone, not just when a folder is', { tag: ['@extended', '@terminal'] }, async () => {
  skipIfElevated();
  test.setTimeout(240_000);

  const root = mkdtempSync(join(tmpdir(), 'throng-029d-root-'));
  const dataDir = mkdtempSync(join(tmpdir(), 'throng-029d-data-'));
  const userDataDir = mkdtempSync(join(tmpdir(), 'throng-029d-ud-'));

  try {
    await runApp(
      async (_app, win, { pipeName }) => {
        await createProject(win, 'DaemonGone', root);
        const pid = await firstPanelId(win);
        await win.getByTestId(`panel-type-select-${pid}`).selectOption('terminal');
        await win.getByTestId('terminal-flavour').selectOption('cmd');
        await win.getByTestId(`panel-type-confirm-${pid}`).click();
        await expect(win.getByTestId(`terminal-${pid}`)).toContainText(basename(root), {
          timeout: 20_000,
        });
        // SETUP: the layout on disk really describes a configured terminal, so "still a terminal"
        // below is a statement about something that was true to begin with.
        await expect
          .poll(() => layoutJson(dataDir, 'DaemonGone').includes('"flavourId":"cmd"'), {
            timeout: 30_000,
            message: 'the terminal was never persisted',
          })
          .toBe(true);

        // ── Kill the daemon, and confirm the app noticed. ──────────────────────────────────────
        const daemon = await daemonPid(pipeName);
        expect(daemon).toBeGreaterThan(0);
        forceKillProcessTree(daemon);
        await expect(win.getByTestId('daemon-error')).toHaveCount(1, { timeout: 30_000 });

        // ── Force a re-attach with the daemon dead. ────────────────────────────────────────────
        await win.getByTestId('tab-add').click();
        const chips = win.getByTestId('tab-strip').locator('.tab-chip');
        await expect(chips).toHaveCount(2, { timeout: 20_000 });
        await chips.first().click();
        await expect(win.getByTestId(`panel-type-form-${pid}`)).toHaveCount(0, { timeout: 20_000 });

        /**
         * The panel is still a terminal — on screen AND in the saved workspace.
         *
         * The persisted half is the one that matters: a reverted layout is written back, so the loss
         * outlives the session that caused it. That is what "for good" means in #204's title.
         */
        /*
         * #246. The reported failure here was NOT a late write — it was an empty READ.
         *
         * `layoutJson` returns '' for any read it cannot complete, including a database the dying
         * daemon still holds. The old code slept 3000ms and then read once, so an unreadable moment
         * became the string '', and the assertion below fired with "the persisted layout stopped
         * describing a terminal" — accusing the product of a revert that never happened and sending
         * the reader into it. FR-013: an unwritten or unreadable file is an unfinished precondition,
         * never evidence.
         *
         * A FENCE WAS TRIED HERE FIRST AND IS NOT POSSIBLE, which is worth writing down because it
         * is not obvious. The natural fix for "prove nothing was written" is to observe a LATER
         * write and reason that anything earlier must already be on disk. There is no later write:
         * the daemon owns the layout, the daemon has just been killed, and nothing persists until it
         * comes back. Measured — adding two more tabs takes the UI to three while the stored layout
         * stays at one, for the full 30s. So there is no observable event to wait for, which is
         * exactly the case FR-016 allows a fixed wait for, with its reason stated.
         *
         * So the wait stays and the READ is what changes: poll until the layout is actually
         * readable, then assert on it.
         */
        // sleep-justified: the daemon is dead and owns the layout, so no later write exists to fence against — polling the READ below for readability is the only condition left, and it is what this wait leads into.
        await win.waitForTimeout(3000); // FR-016: the revert window; with the daemon dead nothing
        // signals "the app has decided not to write", and no later write exists to fence against.
        await expect
          .poll(() => layoutJson(dataDir, 'DaemonGone').length, {
            timeout: 30_000,
            message:
              'the persisted layout was never readable, so the assertions below would have been ' +
              'about a failed read rather than about the product',
          })
          .toBeGreaterThan(0);

        const layout = layoutJson(dataDir, 'DaemonGone');
        expect(layout, 'the persisted layout stopped describing a terminal').toContain('"kind":"terminal"');
        expect(layout, 'the flavour the user chose was discarded').toContain('"flavourId":"cmd"');

        /**
         * And RETRY is safe to press, which is the half that turns the bug into a trap.
         *
         * The control exists to protect the configuration; before this fix, using it while the daemon
         * was down was the fastest way to lose it.
         */
        /*
         * Scoped to the BANNER (T056e), not to a bare `terminal-retry-{pid}`.
         *
         * FR-039a keeps the still-starting strip exactly as it is, retry control and test id
         * included — so after 030 the unscoped id still resolves, to a control that means "reattach
         * to a session that is taking its time" rather than "re-run the start that failed". The
         * conditional would have gone on passing while testing the wrong thing entirely.
         */
        const retry = bannerControl(win, pid, 'Try again');
        if (await retry.isVisible().catch(() => false)) {
          await retry.click();
          // Same reasoning as above: no later write exists to fence against while the daemon is
          // down, so the wait stays (FR-016) and the read is made robust instead.
          // sleep-justified: the daemon is still dead here too, so there is no later write to fence against — the readability poll right below is the only real condition available.
          await win.waitForTimeout(3000);
          await expect
            .poll(() => layoutJson(dataDir, 'DaemonGone').length, {
              timeout: 30_000,
              message: 'the persisted layout was never readable, so the assertion below proves nothing',
            })
            .toBeGreaterThan(0);
          expect(
            layoutJson(dataDir, 'DaemonGone'),
            'pressing Retry with the daemon down destroyed the panel configuration',
          ).toContain('"kind":"terminal"');
        }
        await expect(win.getByTestId(`panel-type-form-${pid}`)).toHaveCount(0);
      },
      // The app spawns its own daemon, so `daemonPid` resolves it and teardown tolerates its absence.
      { dataDir, userDataDir, skipDaemon: true },
    );
  } finally {
    cleanupTemp(root);
    cleanupTemp(dataDir);
    cleanupTemp(userDataDir);
  }
});
