import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { test, expect, type Locator, type Page } from '@playwright/test';
import { runApp, createProject, firstPanelId, cleanupTemp } from './harness.js';
import { skipIfElevated } from './admin.js';

/**
 * 029 / #196 — a file operation blocked by a process HOLDING the target must say so, not report a
 * raw errno.
 *
 * ══ THE DEFECT ══
 *
 * `packages/ui/src/main/files-service.ts` catches every fs failure and returns `message(e)` — the
 * unmodified Node `Error.message` — at seven call sites (`:110`, `:166`, `:215`, `:241`, `:344`,
 * `:360`, `:375`). Nothing on that path classifies `EPERM` / `EBUSY` / `ENOTEMPTY` into a cause, so
 * the toast reads:
 *
 *     EPERM: operation not permitted, rename 'X:\…\PJ Replacement' -> 'X:\…\PJ Replacements'
 *
 * "operation not permitted" reads as a PERMISSIONS problem. The real cause is that another process
 * has the folder open, and the user is given no way to know that — let alone which process.
 *
 * ══ MEASURED: THE ISSUE NAMES ONLY ONE OF THE TWO ERRNOS ══
 *
 * #196 reports `EPERM`. Replicating it against a local temp folder produces `EBUSY: resource busy
 * or locked, rename …` instead — same cause, same uselessness to the user, different code. Windows
 * picks between them by how the holder opened the handle and where the path lives, so a fix that
 * classifies only what the issue quoted would miss the commoner case. Both are matched below, and
 * 029 must classify the CLASS rather than the string.
 *
 * ══ SCOPE ══
 *
 * Classification only, per the 029 planning decision. Naming the holder (`explorer.exe`, pid 1234)
 * needs the Windows Restart Manager (`RmStartSession` / `RmGetList`) or handle enumeration behind
 * the `packages/platform-windows` seam, and is a spike inside 029 rather than part of this
 * replication. The classification half is independently useful and independently testable — which
 * is exactly the split the issue itself proposes.
 *
 * ══ WHAT THESE TESTS ASSERT ══
 *
 * The INTENDED behaviour, so they FAIL on master by design.
 */

/** The visible notice, not its copy/dismiss controls (see `notice-stacking.e2e.ts`). */
function notices(win: Page): Locator {
  return win.getByTestId('explorer-error');
}

/**
 * Hold `folder` open the way any other program would — a live process whose CURRENT DIRECTORY is
 * that folder. Windows then refuses to rename or delete it.
 *
 * This is not a simulation of the failure: it is the same mechanism throng's own
 * `WindowsDirectoryLock` uses to hold a project root
 * (`packages/platform-windows/src/windows-directory-lock.ts:22`), which is why it produces the
 * identical `EPERM` the issue reports.
 */
function holdFolder(folder: string): ChildProcess {
  /*
   * The child ANNOUNCES itself, and that is not decoration.
   *
   * A process holds its working directory from the moment it is running, but `spawn` returns long
   * before that. The setup below then probes by RENAMING the folder — so a probe that runs first
   * renames the directory out from under a child that has not started, which launches holding
   * nothing, and every later probe succeeds against a folder nobody is holding. The poll then
   * spends its whole budget failing to see a hold its own first iteration prevented.
   *
   * Measured twice: 100 probes over 10.8s with no hold in the integration test, and this spec going
   * flaky in a full six-worker run, where a contended spawn is slower to land. Waiting for a line on
   * stdout replaces a guess about timing with the process telling us — it cannot print before node
   * is running, and node's cwd is set at spawn, so "ready" means "held".
   */
  return spawn(process.execPath, ['-e', 'process.stdout.write("ready\\n");setInterval(()=>{},1e9)'], {
    cwd: folder,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
}

/** Resolve once the child has said it is running — see {@link holdFolder}. */
function whenHolding(child: ChildProcess): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('the holder process never started')), 20_000);
    child.stdout?.on('data', (chunk: Buffer) => {
      if (chunk.toString().includes('ready')) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.once('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
  });
}

/** Rename `name` to `to` from the Files & Folders tree (F2, as `explorer-rename-reentry` does). */
async function renameInTree(win: Page, name: string, to: string): Promise<void> {
  const tree = win.getByTestId('file-explorer-tree');
  await expect(tree).toBeVisible();
  await tree.getByText(name, { exact: true }).click();
  await win.keyboard.press('F2');
  const input = tree.locator('input.tree-rename');
  await expect(input).toBeVisible();
  await input.fill(to);
  await input.press('Enter');
}

test('a rename blocked by ANOTHER program says so, instead of reporting a raw EPERM', async () => {
  skipIfElevated(); // an elevated run can rename past holds a normal user cannot
  test.setTimeout(120_000);

  const root = mkdtempSync(join(tmpdir(), 'throng-196-root-'));
  const held = join(root, 'Held');
  mkdirSync(held);
  writeFileSync(join(held, 'inside.txt'), 'content\n');

  let holder: ChildProcess | undefined;
  try {
    holder = holdFolder(held);
    // SETUP, asserted rather than assumed: the holder is alive AND the OS really refuses the
    // rename. Without this the test could go green against a folder nothing was holding, and the
    // RED assertions below would be measuring the wrong failure entirely.
    // The child says when it is running; only THEN is the destructive probe safe to make.
    await whenHolding(holder);
    await expect
      .poll(
        () => {
          try {
            renameSync(held, `${held}-probe`);
            renameSync(`${held}-probe`, held); // undo if the hold had not taken yet
            return false;
          } catch {
            return true;
          }
        },
        { timeout: 10_000, message: 'the holder process never actually locked the folder' },
      )
      .toBe(true);

    await runApp(async (_app, win) => {
      await createProject(win, 'HeldProj', root);
      const tree = win.getByTestId('file-explorer-tree');
      await expect(tree.getByText('Held', { exact: true })).toBeVisible({ timeout: 15_000 });

      await renameInTree(win, 'Held', 'Renamed');

      // SETUP: the operation failed and raised exactly one notice.
      await expect(notices(win)).toHaveCount(1, { timeout: 15_000 });
      const notice = notices(win).first();

      const raw = (await notice.innerText()).replace(/\n/g, ' | ');

      /*
       * Assert against the message with FILE PATHS REMOVED — see the note in the own-lock test.
       * A bare `toContainText('Held')` is satisfied by the folder's appearance inside the raw
       * errno's path, so it passes on master while the message still says "this item".
       */
      const prose = raw.replace(/[A-Za-z]:\\[^\s'"|]+/g, '<path>');

      /**
       * RED #1 — the notice names the FOLDER, in its prose. "This item" is not something a user
       * with several panes open can act on (#195 is the general sweep; this is #196's instance).
       */
      expect(prose, 'the notice does not name the folder').toContain('Held');

      /**
       * RED #2 — it states the CAUSE in the user's terms.
       *
       * The wording is deliberately matched loosely: 029 picks the exact copy, and pinning a
       * sentence here would make the test a spelling check rather than a behaviour check.
       */
      expect(prose, 'the notice does not say the folder is held by another program')
        .toMatch(/open in another program|another program|in use by another/i);

      /**
       * RED #3 — and the raw errno is NOT the headline.
       *
       * Measured on master: `EBUSY: resource busy or locked, rename '<full temp path>' -> '<full
       * temp path>'`. Both errnos are rejected, not just the one the issue quoted — "operation not
       * permitted" sends the user to check permissions, and "resource busy or locked" is jargon
       * that names no resource and no lock holder. Neither belongs in the headline.
       */
      expect(prose, 'the raw errno is still the headline')
        .not.toMatch(/EBUSY|EPERM|resource busy or locked|operation not permitted/);

      /**
       * DEMOTED, NOT DISCARDED — the raw error survives where diagnostics can reach it.
       *
       * The issue's acceptance criterion allows "a log, or a 'details' affordance". This asserts
       * the COPY payload, because copy already exists and is already the notice's diagnostic
       * escape hatch (`notice-stacking.e2e.ts:62`). If 029 chooses the log or a details disclosure
       * instead, THIS is the assertion to move — the requirement is that the errno stays reachable,
       * not that copy specifically carries it.
       */
      await win.getByTestId('explorer-error-copy').first().click();
      const copied = await win.evaluate(() => window.throng?.clipboard?.paste());
      expect(copied?.text ?? '').toMatch(/EBUSY|EPERM/);
    });
  } finally {
    holder?.kill();
    cleanupTemp(`${held}-probe`);
    cleanupTemp(root);
  }
});

test("a rename blocked by THRONG'S OWN lock names throng, not an anonymous program", async () => {
  skipIfElevated();
  test.setTimeout(150_000);

  const root = mkdtempSync(join(tmpdir(), 'throng-196-own-root-'));
  const inner = join(root, 'Inner');
  mkdirSync(inner);
  writeFileSync(join(inner, 'inside.txt'), 'content\n');

  try {
    await runApp(async (_app, win) => {
      /*
       * Get throng to hold `Inner` through its OWN mechanism: a terminal panel in the project,
       * `cd`'d into the folder. A running shell's CURRENT DIRECTORY is held by Windows exactly as
       * the directory-lock helper's is — same mechanism, and the shell here is throng's own child.
       *
       * This is also the case a user actually hits: your own terminal is sitting in the folder you
       * are trying to rename, and throng tells you a resource is busy without mentioning that the
       * resource is throng.
       *
       * ── WHAT WAS TRIED FIRST, AND WHY IT CANNOT WORK ──
       * A second project rooted AT `Inner` (so the daemon takes the directory lock via
       * `terminal-service.ts:422`) is rejected outright: "Project root folder <root> overlaps
       * another project's folder <root>\Inner". Overlapping project roots are guarded against, so
       * the daemon's own lock can never be aimed at a folder that is visible in another project's
       * tree. The shell's cwd is the only route to a throng-held, tree-renameable folder.
       */
      await createProject(win, 'OwnLockProj', root);
      const pid = await firstPanelId(win);
      await win.getByTestId(`panel-type-select-${pid}`).selectOption('terminal');
      await win.getByTestId('terminal-flavour').selectOption('cmd');
      await win.getByTestId(`panel-type-confirm-${pid}`).click();
      const term = win.getByTestId(`terminal-${pid}`);
      await expect(term).toContainText(basename(root), { timeout: 20_000 });

      // Walk the shell into the folder, and wait for its PROMPT to prove the chdir landed — the
      // hold does not exist until the process's cwd has actually moved.
      await term.click();
      await win.keyboard.type('cd Inner');
      await win.keyboard.press('Enter');
      await expect(term).toContainText(`${basename(root)}\\Inner>`, { timeout: 20_000 });

      const tree = win.getByTestId('file-explorer-tree');
      await expect(tree.getByText('Inner', { exact: true })).toBeVisible({ timeout: 15_000 });

      /*
       * DELIBERATELY NOT waiting for the daemon to notice the chdir.
       *
       * It samples shell cwds on a 1-second timer, and renaming inside that second used to be told
       * "another program" about the user's OWN terminal — measured here before `refreshCwd` existed.
       * Waiting it out would have hidden that permanently, and a user renaming straight after a `cd`
       * is not an exotic case. The rename below therefore races the poll on purpose: it passes
       * because the holder lookup reads the cwd itself, not because the test was patient.
       */

      // SETUP: throng really is holding it — the OS refuses the rename from outside the app too.
      // Polled, because the shell's chdir and the OS taking the handle are not the same instant.
      await expect
        .poll(
          () => {
            try {
              renameSync(inner, `${inner}-probe`);
              renameSync(`${inner}-probe`, inner); // undo if the hold had not taken yet
              return false;
            } catch {
              return true;
            }
          },
          { timeout: 15_000, message: "throng's own shell never held the folder" },
        )
        .toBe(true);
      expect(existsSync(inner)).toBe(true);

      await renameInTree(win, 'Inner', 'Renamed');

      await expect(notices(win)).toHaveCount(1, { timeout: 15_000 });
      const notice = notices(win).first();
      const raw = (await notice.innerText()).replace(/\n/g, ' | ');

      /*
       * Match against the message with FILE PATHS REMOVED.
       *
       * This is not tidiness. The suite's own run directory is `throng_e2e_<hash>` and these temp
       * roots are named `throng-196-own-root-*`, so a bare /throng/i match against the notice is
       * satisfied by the PATH in the raw errno — it passed on master, where the message says
       * nothing about throng at all. A false pass in a replication is worse than no test: it would
       * have reported this half of #196 as already working.
       */
      const prose = raw.replace(/[A-Za-z]:\\[^\s'"|]+/g, '<path>');

      // RED — it names the folder, and it identifies THRONG as the holder rather than shrugging at
      // "another program". Loose match: 029 decides whether it can also name the panel.
      expect(prose, 'the notice does not name the folder').toContain('Inner');
      expect(prose, 'the notice does not identify throng as the holder').toMatch(/throng/i);
      expect(prose, 'the raw errno is still the headline')
        .not.toMatch(/EBUSY|EPERM|resource busy or locked|operation not permitted/);

      // Release the lock so teardown is not fighting a live shell.
      await win.evaluate((id) => window.throng?.terminal?.kill?.(id), pid);
      await win.waitForTimeout(1200);
    });
  } finally {
    cleanupTemp(`${inner}-probe`);
    cleanupTemp(root);
  }
});
