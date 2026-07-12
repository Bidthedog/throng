import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { runApp, createProject, firstPanelId } from './harness.js';
import { skipIfElevated } from './admin.js';

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
  await expect(term).toContainText(basename(root), { timeout: 20000 });
  return pid;
}

/**
 * Run a command and wait for a marker to appear in the viewport. Typed with a small
 * per-key delay: ConPTY echoes each keystroke, and typing at full speed interleaves
 * with that echo and scrambles the line.
 */
async function run(win: Page, pid: string, cmd: string, marker: string): Promise<void> {
  await win.getByTestId(`terminal-${pid}`).click();
  await win.keyboard.type(cmd, { delay: 15 });
  await win.keyboard.press('Enter');
  await expect(win.getByTestId(`terminal-${pid}`)).toContainText(marker, { timeout: 20000 });
}


/** xterm's live grid — searching must not resize it (FR-013). */
async function grid(win: Page, pid: string): Promise<{ width: number; rows: number }> {
  return win.getByTestId(`terminal-${pid}`).evaluate((el) => ({
    width: (el.querySelector('.xterm-screen') as HTMLElement | null)?.clientWidth ?? 0,
    rows: el.querySelectorAll('.xterm-rows > div').length,
  }));
}

test('finds in the scrollback, counts and steps matches — and types nothing at the shell', async () => {
  skipIfElevated();
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
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
  }
});

test('parked on a match, incoming output does not yank the viewport away (FR-012a)', async () => {
  skipIfElevated();
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
      await win.waitForTimeout(9000);

      // …and the viewport has NOT been dragged down to it: the match is still on screen
      // and the newest output is not (auto-follow is suspended — FR-012a).
      await expect(term).toContainText('FREEZE_MARKER');
      await expect(term).not.toContainText('LATE_OUTPUT');

      // The output really did arrive: jumping to the live bottom shows it, and that jump
      // is also what resumes following (FR-012a / FR-014).
      await win.getByTestId('find-close').click();
      await win.keyboard.press('Control+End');
      await expect(term).toContainText('LATE_OUTPUT', { timeout: 15000 });
    });
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
  }
});

test('with no find bar open, Escape still reaches the shell (it is not throng’s key)', async () => {
  skipIfElevated();
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

      await expect(term).toContainText('ESC_REACHED_SHELL', { timeout: 20000 });
      await expect(term).not.toContainText('is not recognized');

      // While find IS open, Escape is ours: it closes the bar (and still does not reach
      // the shell, because no stray text appears at the prompt).
      await win.keyboard.press('Control+f');
      await expect(win.getByTestId(`find-bar-${pid}`)).toBeVisible();
      await win.keyboard.press('Escape');
      await expect(win.getByTestId(`find-bar-${pid}`)).toHaveCount(0);
    });
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
  }
});

test('the find bar is scoped to one panel — no stray bar on another (spec Edge Cases)', async () => {
  skipIfElevated();
  const root = mkdtempSync(join(tmpdir(), 'throng-tfind-'));
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'TScope', root);
      const pid = await newTerminal(win, root);
      await run(win, pid, 'echo SCOPE_TERM', 'SCOPE_TERM');

      await win.keyboard.press('Control+f');
      await expect(win.getByTestId(`find-bar-${pid}`)).toBeVisible();

      // The session belongs to THIS panel's view: exactly one bar exists, on this panel.
      expect(await win.locator('[data-testid^="find-bar-"]').count()).toBe(1);
    });
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
  }
});
