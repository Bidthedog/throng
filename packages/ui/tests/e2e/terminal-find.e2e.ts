import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import {
  openApp,
  createProject as newProject,
  firstPanelId,
  cleanupTemp,
  type AppOptions,
  type OpenApp,
  TERMINAL_OUTPUT_TIMEOUT_MS,
} from './harness.js';

/*
 * ONE app for this file, not one per test.
 *
 * Each test used to launch its own Electron app, daemon and window — roughly two seconds apiece, and
 * 604 such launches across the suite — to run assertions that never needed a pristine app. Only a
 * test that seeds state BEFORE launch genuinely does, and those keep their own app via `runOwnApp`.
 *
 * The shims below exist so the test bodies below are unchanged:
 *   runApp        runs the body against the shared window. It refuses options rather than ignoring
 *                 them: a dropped config root does not fail, it passes for the wrong reason.
 *   createProject appends a counter, because a shared app accumulates projects and duplicate names
 *                 make `.project-item` ambiguous.
 *
 * Serial mode is required — shared window, shared database — and it means a failure skips the rest
 * rather than running them against whatever state the failure left behind.
 */
test.describe.configure({ mode: 'serial' });

let shared: OpenApp;
test.beforeAll(async () => {
  shared = await openApp();
});
test.afterAll(async () => {
  await shared?.close();
});

const runApp = (
  fn: (app: OpenApp['app'], win: OpenApp['win'], ctx: { pipeName: string; userDataDir: string }) => Promise<void>,
  opts?: AppOptions,
): Promise<void> => {
  if (opts) {
    throw new Error(
      'this file shares one app; a test needing launch options must call runOwnApp instead',
    );
  }
  return fn(shared.app, shared.win, {
    pipeName: shared.pipeName,
    userDataDir: shared.userDataDir,
  });
};

let projectSeq = 0;
const createProject = (win: OpenApp['win'], name: string, root: string): Promise<void> =>
  newProject(win, `${name}-${(projectSeq += 1)}`, root);

// 013 US2 — find in a terminal's retained scrollback. The load-bearing property is that
// searching is READ-ONLY: not one keystroke reaches the running program, and the
// character grid is never resized by it (FR-010 / FR-013 / SC-002).

/**
 * A cmd.exe terminal in the given panel (plain echo, no PSReadLine repainting).
 * Waits for the shell's first prompt — typing into a still-initialising ConPTY
 * interleaves with its echo and scrambles the line.
 */
async function newTerminal(win: Page, root: string): Promise<string> {
  const pid = await firstPanelId(win);
  await win.getByTestId(`panel-type-select-${pid}`).selectOption('terminal');
  await win.getByTestId('terminal-flavour').selectOption('cmd');
  const confirm = win.getByTestId(`panel-type-confirm-${pid}`);
  await expect(confirm).toBeEnabled();
  await confirm.click();
  const term = win.getByTestId(`terminal-${pid}`);
  await expect(term).toBeVisible();
  // cmd.exe's prompt shows its cwd — the project root — once it is ready for input.
  await expect(term).toContainText(basename(root), { timeout: TERMINAL_OUTPUT_TIMEOUT_MS });
  return pid;
}

/**
 * Run a command and wait for a marker to appear in the viewport. Typed with a small
 * per-key delay: ConPTY echoes each keystroke, and typing at full speed interleaves
 * with that echo and scrambles the line.
 */
async function run(win: Page, pid: string, cmd: string, marker: string): Promise<void> {
  const term = win.getByTestId(`terminal-${pid}`);
  await term.click();
  await win.keyboard.type(cmd, { delay: 15 });
  await win.keyboard.press('Enter');
  /*
   * Wait for one MORE occurrence of the marker than the typed command itself contains.
   *
   * ConPTY echoes each keystroke as it is typed, so for `echo NEEDLE_A` the marker is on screen as
   * part of the command LINE before the shell has run anything. A plain `toContainText(marker)` is
   * satisfied by that echo, and the next `run` then types into a shell that is still working — the
   * line interleaves with the echo, which is exactly the scrambling the per-key delay above exists
   * to prevent. Measured under six CPU hogs: `echo other` rendered as `echo othe` + `othe` + a fresh
   * prompt + `r`.
   *
   * The extra occurrence is the command's OUTPUT, which only exists once it has actually executed.
   * Counting relative to the command rather than to a fixed 2 keeps this correct for markers that
   * are never typed — `for /l ... @echo filler %i` waits on `filler 150`, which appears once, in the
   * output alone.
   */
  const escaped = marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const inCommand = (cmd.match(new RegExp(escaped, 'g')) ?? []).length;
  await expect
    .poll(async () => ((await term.innerText()).match(new RegExp(escaped, 'g')) ?? []).length, {
      timeout: 20000,
    })
    .toBeGreaterThanOrEqual(inCommand + 1);
}

/** xterm's live grid — searching must not resize it (FR-013). */
async function grid(win: Page, pid: string): Promise<{ width: number; rows: number }> {
  return win.getByTestId(`terminal-${pid}`).evaluate((el) => ({
    width: (el.querySelector('.xterm-screen') as HTMLElement | null)?.clientWidth ?? 0,
    rows: el.querySelectorAll('.xterm-rows > div').length,
  }));
}

/*
 * ── ONE REMOVED AS A DUPLICATE, AND ITS FIXTURE COULD NOT TEST ITS OWN CLAIM (035 T055) ──
 *
 * `:249` "the find bar is scoped to one panel — no stray bar on another (spec Edge Cases)". No
 * replacement was written, because `packages/ui/tests/unit/search-store.test.ts` already asserts
 * the scoping and asserts it harder:
 *
 *   `:73`  "drives the engine of the panel find was opened on"
 *   `:214` "starts a fresh session when find opens on a different panel" — TWO registered panels,
 *          find opened on the first, then the second, asserting the session's `panelId` moved and
 *          the term did NOT carry over
 *
 * The removed test created a project, started a real shell, ran `echo`, waited for the output,
 * opened the find bar and asserted `[data-testid^="find-bar-"]` had a count of ONE — in a workspace
 * containing exactly one panel. There was no second panel for a stray bar to appear on, so the
 * assertion was satisfied by arithmetic rather than by the behaviour it named. A build that leaked a
 * bar onto every panel would have passed it.
 *
 * That is worth recording rather than tidying away: the test was not merely redundant, it could not
 * have failed for the reason it existed. The version that CAN fail was already in the suite, one
 * layer down, and had been all along.
 */
test('finds in the scrollback, counts and steps matches — and types nothing at the shell', { tag: ['@extended', '@terminal', '@reserve:pty'] }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'throng-tfind-'));
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'TFind', root);
      const pid = await newTerminal(win, root);
      const term = win.getByTestId(`terminal-${pid}`);

      await run(win, pid, 'echo NEEDLE_A', 'NEEDLE_A');
      await run(win, pid, 'echo other', 'other');
      await run(win, pid, 'echo NEEDLE_B', 'NEEDLE_B');
      const before = await grid(win, pid);

      await win.keyboard.press('Control+f');
      await expect(win.getByTestId(`find-bar-${pid}`)).toBeVisible();
      await win.getByTestId('find-input').fill('NEEDLE_');

      // Matches are found in the retained scrollback and counted.
      await expect(win.getByTestId('find-count')).toHaveText(/^\d+ of [2-9]\d*$/, {
        timeout: 10000,
      });
      await win.getByTestId('find-next').click();
      await expect(win.getByTestId('find-count')).toHaveText(/^\d+ of \d+$/);

      // Searching resized nothing (FR-013).
      expect(await grid(win, pid)).toEqual(before);

      // Not one keystroke reached the shell: the next command still runs cleanly and no
      // stray input was interpreted at the prompt (SC-002).
      await win.getByTestId('find-close').click();
      await run(win, pid, 'echo STILL_ALIVE', 'STILL_ALIVE');
      await expect(term).not.toContainText('is not recognized');
    });
  } finally {
    cleanupTemp(root);
  }
});

test('parked on a match, incoming output does not yank the viewport away (FR-012a)', { tag: ['@extended', '@terminal', '@reserve:pty'] }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'throng-tfind-'));
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'TFreeze', root);
      const pid = await newTerminal(win, root);
      const term = win.getByTestId(`terminal-${pid}`);

      // Scrollback long enough that the marker scrolls off the top of the viewport.
      await run(win, pid, 'echo FREEZE_MARKER', 'FREEZE_MARKER');
      await run(win, pid, 'for /l %i in (1,1,150) do @echo filler %i', 'filler 150');
      // xterm renders only the VISIBLE rows, so the marker is now off-screen…
      await expect(term).not.toContainText('FREEZE_MARKER');

      // Queue output that lands a few seconds from NOW, so it arrives while we are
      // parked on the match without us typing anything in the meantime.
      await term.click();
      await win.keyboard.type('ping -n 7 127.0.0.1 >nul & echo LATE_OUTPUT', { delay: 15 });
      await win.keyboard.press('Enter');

      // …and find scrolls it back INTO view, parking the viewport up in the scrollback.
      await win.keyboard.press('Control+f');
      await win.getByTestId('find-input').fill('FREEZE_MARKER');
      await expect(win.getByTestId('find-count')).toHaveText(/^\d+ of \d+$/, { timeout: 10000 });
      await expect(term).toContainText('FREEZE_MARKER');

      // The delayed output lands while we sit on the match…
      // sleep-justified: the only signal that LATE_OUTPUT reached the buffer while parked is the Control+End jump this test performs AFTER, which is the auto-follow resume FR-012a proves happens later.
      await win.waitForTimeout(9000);

      // …and the viewport has NOT been dragged down to it: the match is still on screen
      // and the newest output is not (auto-follow is suspended — FR-012a).
      await expect(term).toContainText('FREEZE_MARKER');
      await expect(term).not.toContainText('LATE_OUTPUT');

      // The output really did arrive: jumping to the live bottom shows it, and that jump
      // is also what resumes following (FR-012a / FR-014).
      await win.getByTestId('find-close').click();
      await win.keyboard.press('Control+End');
      await expect(term).toContainText('LATE_OUTPUT', { timeout: TERMINAL_OUTPUT_TIMEOUT_MS });
    });
  } finally {
    cleanupTemp(root);
  }
});

test('with no find bar open, Escape still reaches the shell (it is not throng’s key)', { tag: ['@extended', '@terminal', '@reserve:pty'] }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'throng-tfind-'));
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'TEsc', root);
      const pid = await newTerminal(win, root);
      const term = win.getByTestId(`terminal-${pid}`);

      // cmd.exe clears the current input line on Escape. So: type something, press Escape,
      // then type a marker and run it. If Escape reached the shell the line was cleared and
      // only the marker runs; if throng swallowed it, the two are concatenated and cmd
      // fails to find the command.
      //
      // This guards the whole class of "find broke the terminal" bugs: Escape must not be
      // reserved unless a find bar is actually open (vim/less/readline depend on it).
      await term.click();
      await win.keyboard.type('echo SHOULD_BE_CLEARED', { delay: 15 });
      await win.keyboard.press('Escape');
      await win.keyboard.type('echo ESC_REACHED_SHELL', { delay: 15 });
      await win.keyboard.press('Enter');

      await expect(term).toContainText('ESC_REACHED_SHELL', {
        timeout: TERMINAL_OUTPUT_TIMEOUT_MS,
      });
      await expect(term).not.toContainText('is not recognized');

      // While find IS open, Escape is ours: it closes the bar (and still does not reach
      // the shell, because no stray text appears at the prompt).
      await win.keyboard.press('Control+f');
      await expect(win.getByTestId(`find-bar-${pid}`)).toBeVisible();
      await win.keyboard.press('Escape');
      await expect(win.getByTestId(`find-bar-${pid}`)).toHaveCount(0);
    });
  } finally {
    cleanupTemp(root);
  }
});

