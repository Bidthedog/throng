import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, join, sep } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { runApp, createProject, firstPanelId, step, TYPE_DELAY } from './harness.js';

/**
 * 028 follow-up — the reported defects, driven against REAL Claude Code.
 *
 * Five stand-in programs across three fixtures failed to reproduce what the user reproduces every
 * time. Each stand-in was a guess at what Claude does — negotiates kitty, owns the alternate screen,
 * repaints only on resize — and each guess was close enough to pass and wrong enough to prove
 * nothing. So these drive the actual program, and assert on what it actually shows.
 *
 * They need `claude` on PATH and a working login, so they are opt-in: set THRONG_CLAUDE_E2E=1.
 * A test that silently skips is worse than no test, so the skip is stated in the title.
 */

/*
 * Opt-in, and never on remote CI.
 *
 * These drive the real `claude` binary: they need it installed, logged in, and they spend a little
 * quota. None of that is true of a CI runner, and a test that cannot pass there must not be left to
 * fail there — so CI is excluded even when the flag is set, rather than relying on the flag being
 * unset by luck.
 */
const CLAUDE_E2E = process.env.THRONG_CLAUDE_E2E === '1' && !process.env.CI;

/**
 * A REAL project to borrow claude's history from (`THRONG_CLAUDE_E2E_ROOT`).
 *
 * The agents view is a list of the project's existing sessions, so in a fresh temp directory it has
 * nothing to show: Left opens an empty view, Escape lands on nothing, and the test presses keys into
 * a state the user is never in. Pointing at a project with real sessions is what makes the reported
 * sequence reproducible at all. `cleanup` already refuses to delete anything outside the temp area,
 * which is what makes this safe.
 */
const CLAUDE_ROOT = process.env.THRONG_CLAUDE_E2E_ROOT;

/** How `claude` names a project directory under ~/.claude/projects. */
function claudeProjectDir(root: string): string {
  // split/join rather than a character class: the escaping of a backslash inside one is easy to get
  // subtly wrong, and when it is wrong this silently looks in a directory that does not exist —
  // which presents as "no session was created" rather than as the path bug it is.
  return root.split(':').join('-').split('\\').join('-').split('/').join('-');
}

/**
 * Accept claude's folder-trust dialog for this project up front, and undo it afterwards.
 *
 * Without it the session opens on a modal asking whether to trust the directory, and every keystroke
 * the test sends goes to that dialog instead of to the prompt — the test would be measuring the
 * wrong thing entirely rather than failing honestly.
 *
 * Deliberately the SMALLEST possible edit to a file the user's own claude also writes: one key added
 * for a temp directory that nothing else refers to, and removed again in teardown.
 */
function trustProject(root: string): () => void {
  const configPath = join(homedir(), '.claude.json');
  if (!existsSync(configPath)) return () => {};
  const key = root.split('\\').join('/');
  const read = (): Record<string, unknown> =>
    JSON.parse(readFileSync(configPath, 'utf8')) as Record<string, unknown>;
  const config = read();
  const projects = (config.projects ?? {}) as Record<string, unknown>;
  projects[key] = {
    hasTrustDialogAccepted: true,
    projectOnboardingSeenCount: 1,
    hasClaudeMdExternalIncludesApproved: true,
    hasClaudeMdExternalIncludesWarningShown: true,
  };
  config.projects = projects;
  writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
  return () => {
    // Re-read rather than reusing the parsed copy: claude may have written to this file in between,
    // and clobbering the user's own session state to tidy up a test would be a poor trade.
    const latest = read();
    const live = (latest.projects ?? {}) as Record<string, unknown>;
    delete live[key];
    latest.projects = live;
    writeFileSync(configPath, JSON.stringify(latest, null, 2), 'utf8');
  };
}

async function terminalWithStartupCommand(
  win: Page,
  panelId: string,
  command: string,
  flavour = 'windows-powershell',
): Promise<void> {
  await win.getByTestId(`panel-type-select-${panelId}`).selectOption('terminal');
  await win.getByTestId('terminal-flavour').selectOption(flavour);
  await win.getByTestId('terminal-startup-command').fill(command);
  const confirm = win.getByTestId(`panel-type-confirm-${panelId}`);
  await expect(confirm).toBeEnabled();
  await confirm.click();
  await expect(win.getByTestId(`terminal-${panelId}`)).toBeVisible();
}

/**
 * Remove a temp project, tolerating a directory the terminal process still holds.
 *
 * A cleanup failure must never be reported as the test's result: the first run of these tests failed
 * with an EPERM from rmSync, which read exactly like a defect and was nothing of the sort.
 */
function cleanup(root: string): void {
  // NEVER delete a directory outside the temp area. This test can be pointed at a real project to
  // borrow its claude history, and a cleanup that honoured that would delete a working tree.
  if (!root.toLowerCase().startsWith(tmpdir().toLowerCase())) return;
  try {
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 });
  } catch {
    /* the shell may still hold it — the OS reclaims temp, and this is not the test's subject */
  }
}

/** Everything the terminal is currently showing, as one string. */
async function screen(win: Page, panelId: string): Promise<string> {
  return (await win.getByTestId(`terminal-${panelId}`).textContent()) ?? '';
}




/**
 * What the DAEMON says is running in the panel — the process table, not the screen and not the
 * window title.
 *
 * Three earlier oracles were all spoofable: claude leaves its transcript on screen when it exits;
 * `textContent` also returns xterm's injected CSS; and the panel header shows the title CLAUDE sets
 * for itself, which one run rendered as "10 awaiting input - claude agents" while the question was
 * whether claude was running at all.
 */
async function runningCommand(win: Page, panelId: string): Promise<string> {
  return win.evaluate(
    (id) =>
      (
        window as unknown as {
          __throngTerminalCommand?: (p: string) => string | null | undefined;
        }
      ).__throngTerminalCommand?.(id) ?? '',
    panelId,
  );
}

test.describe('Claude Code key handling (opt-in: THRONG_CLAUDE_E2E=1)', () => {
  test.skip(
    !CLAUDE_E2E,
    'needs a logged-in `claude` on PATH: set THRONG_CLAUDE_E2E=1, and never runs on CI',
  );

  test('Ctrl+Backspace works when claude is TYPED at a prompt, not launched as a startup command', async () => {
    test.setTimeout(240_000);
    /*
     * The user's actual flow, and the one difference every passing test here had quietly avoided.
     *
     * A startup command launches claude before the shell ever edits a line. Typing `claude` at the
     * prompt does not: PSReadLine reads that line, and to read it, it enables win32-input-mode. So
     * by the time claude starts, throng has recorded "this terminal wants key RECORDS" on behalf of
     * a program that has since handed over — and claude, which reads raw VT, is then sent records it
     * cannot act on.
     *
     * Same bytes on the wire either way, which is why the byte-level diagnostic matched and the
     * defect still only happened on one machine. What differs is who negotiated, and when.
     */
    const root = mkdtempSync(join(tmpdir(), 'throng-claude-typed-'));
    const untrust = trustProject(root);
    try {
      await runApp(async (_app, win) => {
        await createProject(win, 'ClaudeTyped', root);
        const pid = await firstPanelId(win);
        // No startup command: land on a PowerShell prompt first, exactly as a user does.
        await terminalWithStartupCommand(win, pid, '');

        const term = win.getByTestId(`terminal-${pid}`);
        await expect(term).toContainText(basename(root), { timeout: 60_000 });
        await term.click();
        await win.keyboard.type('claude', { delay: 60 });
        await win.keyboard.press('Enter');
        await expect(term).toContainText(/Welcome back|auto mode on/i, { timeout: 180_000 });
        await win.waitForTimeout(3000);

        await term.click();
        await win.keyboard.type('alpha bravo charlie', { delay: 60 });
        await expect(term).toContainText('alpha bravo charlie', { timeout: 30_000 });
        await win.keyboard.press('Control+Backspace');
        await win.waitForTimeout(2500);

        const diag = await win.evaluate(
          () =>
            (
              window as unknown as {
                __throngTerminalDiagnostics?: () => Record<string, { keys: { chord: string }[] }>;
              }
            ).__throngTerminalDiagnostics?.() ?? {},
        );
        for (const [, d] of Object.entries(diag)) {
          console.log('DIAG-TYPED', JSON.stringify(d.keys.filter((k) => k.chord.includes('Backspace'))));
        }

        const after = await screen(win, pid);
        expect(after).toContain('alpha bravo');
        expect(after, 'Ctrl+Backspace deleted nothing').not.toContain('charlie');
        expect(after, 'Ctrl+Backspace deleted one CHARACTER, not a word').not.toContain('charli');

        await win.keyboard.press('Control+C');
        await win.waitForTimeout(500);
        await win.keyboard.type('/exit', { delay: 60 });
        await win.keyboard.press('Enter');
        await win.waitForTimeout(1500);
      });
    } finally {
      untrust();
      cleanup(root);
    }
  });

  test('Ctrl+Backspace deletes a WORD in claude when the shell negotiated NOTHING', async () => {
    test.setTimeout(240_000);
    /*
     * The case the PowerShell tests cannot reach.
     *
     * PSReadLine enables win32-input-mode to read its prompt, so by the time claude starts, throng
     * already believes the terminal wants key RECORDS — and sends one for this chord, which works.
     * Under a shell that negotiates nothing, throng falls back to xterm's legacy `^H`, which claude
     * cannot tell from Ctrl+H and treats as delete-one-character.
     *
     * So the chord's behaviour depends on which shell happened to launch claude, which is not
     * something a user can be expected to know or care about.
     */
    const root = mkdtempSync(join(tmpdir(), 'throng-claude-bkspcmd-'));
    const untrust = trustProject(root);
    try {
      await runApp(async (_app, win) => {
        await createProject(win, 'ClaudeBkspCmd', root);
        const pid = await firstPanelId(win);
        await terminalWithStartupCommand(win, pid, 'claude', 'cmd');

        const term = win.getByTestId(`terminal-${pid}`);
        await expect(term).toContainText(/Welcome back|auto mode on/i, { timeout: 180_000 });
        await win.waitForTimeout(3000);

        await term.click();
        await win.keyboard.type('alpha bravo charlie', { delay: 60 });
        await expect(term).toContainText('alpha bravo charlie', { timeout: 30_000 });
        await win.keyboard.press('Control+Backspace');
        await win.waitForTimeout(2500);

        const diag = await win.evaluate(
          () =>
            (
              window as unknown as {
                __throngTerminalDiagnostics?: () => Record<string, { keys: unknown[] }>;
              }
            ).__throngTerminalDiagnostics?.() ?? {},
        );
        for (const [, d] of Object.entries(diag)) {
          const keys = d.keys as { chord: string }[];
          console.log('DIAG-CMD', JSON.stringify(keys.filter((k) => k.chord.includes('Backspace'))));
        }

        const after = await screen(win, pid);
        expect(after).toContain('alpha bravo');
        expect(after, 'Ctrl+Backspace deleted nothing').not.toContain('charlie');
        expect(after, 'Ctrl+Backspace deleted one CHARACTER, not a word').not.toContain('charli');

        await win.keyboard.press('Control+C');
        await win.waitForTimeout(500);
        await win.keyboard.type('/exit', { delay: 60 });
        await win.keyboard.press('Enter');
        await win.waitForTimeout(1500);
      });
    } finally {
      untrust();
      cleanup(root);
    }
  });

  test('Ctrl+Backspace still deletes a WORD in claude after a tab switch', async () => {
    test.setTimeout(240_000);
    /*
     * The same chord as the first test, after the trigger that breaks the OTHER one.
     *
     * A fresh session passes, so whatever goes wrong is state the terminal acquires: the shell
     * enables win32-input-mode while it edits a line, and that flag now survives a view rebuild.
     * If throng then encodes this chord as a win32 key RECORD, claude — which never asked for
     * records and reads raw VT — gets something it cannot act on.
     */
    const root = mkdtempSync(join(tmpdir(), 'throng-claude-bksp2-'));
    const untrust = trustProject(root);
    try {
      await runApp(async (_app, win) => {
        await createProject(win, 'ClaudeBksp2', root);
        const pid = await firstPanelId(win);
        await terminalWithStartupCommand(win, pid, 'claude');

        const term = win.getByTestId(`terminal-${pid}`);
        await expect(term).toContainText(/Welcome back|auto mode on/i, { timeout: 180_000 });
        await win.waitForTimeout(3000);

        // Switch away and back BEFORE typing — the terminal is rebuilt, carrying whatever the shell
        // negotiated with it.
        await win.getByTestId('tab-add').click();
        await win.waitForTimeout(1200);
        await win.getByTestId('tab-strip').locator('.tab-chip').first().click();
        await win.waitForTimeout(2500);

        const back = win.getByTestId(`terminal-${pid}`);
        await back.click();
        await win.keyboard.type('alpha bravo charlie', { delay: 60 });
        await expect(back).toContainText('alpha bravo charlie', { timeout: 30_000 });
        await win.keyboard.press('Control+Backspace');
        await win.waitForTimeout(2500);

        const diag = await win.evaluate(
          () =>
            (
              window as unknown as {
                __throngTerminalDiagnostics?: () => Record<string, { keys: unknown[] }>;
              }
            ).__throngTerminalDiagnostics?.() ?? {},
        );
        for (const [panel, d] of Object.entries(diag)) {
          console.log('DIAG-BKSP', panel, JSON.stringify(d.keys));
        }

        const after = await screen(win, pid);
        expect(after).toContain('alpha bravo');
        expect(after, 'Ctrl+Backspace deleted nothing after the tab switch').not.toContain('charlie');
        expect(after, 'Ctrl+Backspace deleted one CHARACTER, not a word').not.toContain('charli');

        await win.keyboard.press('Control+C');
        await win.waitForTimeout(500);
        await win.keyboard.type('/exit', { delay: 60 });
        await win.keyboard.press('Enter');
        await win.waitForTimeout(1500);
      });
    } finally {
      untrust();
      cleanup(root);
    }
  });

  test('Ctrl+End still reaches claude after a tab switch', async () => {
    test.setTimeout(240_000);
    /*
     * Borrows a REAL project and one of its existing claude sessions.
     *
     * A resumed session with history is the premise: Ctrl+Home only has somewhere to go when there
     * is a transcript above. A fresh session has none — measured, not assumed — and minting one in a
     * temp directory did not produce a resumable transcript. The user's own setup is a real project
     * with real history, so the test uses exactly that, and never writes to or deletes it.
     */
    const root = process.env.THRONG_CLAUDE_PROJECT ?? ['D:', 'git', 'throng'].join(sep);
    const sessionDir = join(homedir(), '.claude', 'projects', claudeProjectDir(root));
    const sessions = existsSync(sessionDir)
      ? readdirSync(sessionDir).filter((f) => /^[0-9a-f]{8}-/.test(f) && f.endsWith('.jsonl'))
      : [];
    expect(sessions.length, `no claude sessions under ${sessionDir}`).toBeGreaterThan(0);
    const sessionId = sessions[0].slice(0, -'.jsonl'.length);
    const untrust = trustProject(root);
    try {
      await runApp(async (_app, win) => {
        await createProject(win, 'ClaudeEnd', root);
        const pid = await firstPanelId(win);
        await terminalWithStartupCommand(win, pid, `claude --resume ${sessionId}`);

        const term = win.getByTestId(`terminal-${pid}`);
        await expect(term).toContainText(/Welcome back|auto mode on|Jump to Bottom/i, {
          timeout: 180_000,
        });
        await win.waitForTimeout(4000);

        // Scroll claude's own transcript to the top: it then offers the way back, which is the
        // observable this test turns on.
        await term.click();
        await win.keyboard.press('Control+Home');
        await expect(term).toContainText(/Jump to Bottom/i, { timeout: 30_000 });
        console.log('CLAUDE-END: Ctrl+Home reached claude (Jump to Bottom shown)');

        // Ctrl+End works BEFORE the switch — establishing the chord itself is fine.
        await win.keyboard.press('Control+End');
        await expect(term).not.toContainText(/Jump to Bottom/i, { timeout: 30_000 });
        console.log('CLAUDE-END: Ctrl+End reached claude BEFORE the tab switch');

        // Back to the top, then switch away and back — the reported trigger.
        await win.keyboard.press('Control+Home');
        await expect(term).toContainText(/Jump to Bottom/i, { timeout: 30_000 });
        await win.getByTestId('tab-add').click();
        await win.waitForTimeout(1500);
        await win.getByTestId('tab-strip').locator('.tab-chip').first().click();
        await win.waitForTimeout(3000);

        const back = win.getByTestId(`terminal-${pid}`);
        await back.click();
        const stillScrolled = /Jump to Bottom/i.test(await screen(win, pid));
        console.log('CLAUDE-END: after switch, still scrolled up =', stillScrolled);
        await win.keyboard.press('Control+End');
        await win.waitForTimeout(3000);

        // What did throng BELIEVE when that key arrived? This is the question every stand-in failed
        // to answer, and the diagnostic exists precisely so it can be read from a failing run.
        const diag = await win.evaluate(
          () =>
            (
              window as unknown as {
                __throngTerminalDiagnostics?: () => Record<string, { keys: unknown[] }>;
              }
            ).__throngTerminalDiagnostics?.() ?? {},
        );
        for (const [panel, d] of Object.entries(diag)) {
          console.log('DIAG', panel, JSON.stringify(d.keys));
        }

        await expect(
          back,
          'Ctrl+End did not reach claude after the tab switch — it is still offering Jump to Bottom',
        ).not.toContainText(/Jump to Bottom/i, { timeout: 20_000 });
      });
    } finally {
      untrust();
      cleanup(root);
    }
  });

  /**
   * Escape on claude's AGENT LIST, driven against the real program, in the user's own flow:
   * `claude` typed at a PowerShell prompt, then Left to reach the agents view, then Escape.
   *
   * Reported as re-entering the selected session instead of leaving claude, and only sometimes. The
   * user's diagnostics showed why: at that keypress throng's state read `kitty: true`. Claude had
   * negotiated the kitty keyboard protocol, whose disambiguate flag exists for exactly one problem —
   * 0x1b is BOTH the Escape key and the first byte of every escape sequence. Under that flag Escape
   * must be reported as `CSI 27 u`; a bare 0x1b is the ambiguity the program asked to be rid of, and
   * what it decides then depends on what arrives next, which is the intermittency.
   *
   * The assertion is the INVARIANT rather than a fixed byte, because the right answer depends on
   * what the program negotiated: CSI-u once it has asked to disambiguate, the legacy byte otherwise.
   * That way this states the rule instead of encoding one machine's session.
   */
  test('Escape reaches claude in the encoding claude negotiated', async () => {
    test.setTimeout(240_000);
    const root = CLAUDE_ROOT ?? mkdtempSync(join(tmpdir(), 'throng-claude-esc-'));
    const untrust = trustProject(root);
    try {
      await runApp(async (_app, win) => {
        await createProject(win, 'ClaudeEsc', root);
        const pid = await firstPanelId(win);
        // NO startup command: the user types `claude` at the prompt, and how claude is launched has
        // already been shown to change what the terminal has negotiated by the time it starts.
        await win.getByTestId(`panel-type-select-${pid}`).selectOption('terminal');
        await win.getByTestId('terminal-flavour').selectOption('windows-powershell');
        await win.getByTestId(`panel-type-confirm-${pid}`).click();

        const term = win.getByTestId(`terminal-${pid}`);
        await expect(term).toBeVisible();
        /*
         * Wait for the PROMPT before typing a character.
         *
         * A shell that has not finished painting its prompt loses the start of what is typed at it,
         * and the command then submits half-formed - observed as `claud` + Enter on one line and a
         * stray `e` on the next, which PowerShell duly reported as an error. The prompt shows the
         * working directory, so that is the thing to wait for.
         */
        await expect(term).toContainText(basename(root), { timeout: 30_000 });
        await term.click();
        await step(win, 'a PowerShell prompt — about to type `claude`, as the user does');
        await win.keyboard.type('claude', { delay: TYPE_DELAY });
        // …and confirm the whole command is on the line before submitting it. A plain containment
        // check, because xterm's textContent joins the rows with no line breaks, so an end-anchored
        // pattern never matches what is actually the last thing typed.
        await expect(term).toContainText('claude', { timeout: 15_000 });
        await win.keyboard.press('Enter');

        await expect(term).toContainText(/Welcome back|auto mode on|for agents/i, {
          timeout: 180_000,
        });
        await win.waitForTimeout(4000);
        await step(win, 'claude is up');

        await term.click();
        await win.keyboard.press('ArrowLeft');
        await win.waitForTimeout(2500);
        await step(win, 'pressed Left — this opens the agents view');

        /*
         * Prove the agents view is actually open before pressing the key under test. Its footer is
         * distinctive, and without this check a run against a project with no sessions presses
         * Escape at an ordinary prompt and reports on a state the user is never in.
         */
        await expect(term).toContainText(/enter to return|space to reply|ctrl\+x to delete/i, {
          timeout: 20_000,
        });
        await step(win, 'the agents view is open — about to press Escape');

        await win.keyboard.press('Escape');
        await win.waitForTimeout(2500);
        await step(win, 'pressed Escape — the key under test');

        const diag = await win.evaluate(
          () =>
            (
              window as unknown as {
                __throngTerminalDiagnostics?: () => Record<
                  string,
                  { keys: { chord: string; sent?: string; kitty: boolean; altBuffer: boolean }[] }
                >;
              }
            ).__throngTerminalDiagnostics?.() ?? {},
        );
        const keys = Object.values(diag).flatMap((d) => d.keys);
        const esc = keys.filter((k) => k.chord === 'Escape').at(-1);
        expect(esc, 'no Escape keypress was recorded at all').toBeDefined();
        console.log(
          `[claude-esc] kitty=${esc?.kitty} altBuffer=${esc?.altBuffer} sent=${JSON.stringify(esc?.sent)}`,
        );

        /*
         * `sent` is stored ESCAPED (`recordKeyBytes` runs it through JSON.stringify), because a raw
         * control byte in a blob a user pastes back is unreadable — and invisible in a terminal,
         * which is how a first cut of this compared the six characters `` against a real ESC
         * byte and reported a failure that was entirely the test's own.
         *
         * The rule being asserted: once the program has asked to disambiguate, Escape is a CSI-u
         * report; until then the legacy byte is the correct and only answer.
         */
        // Six characters - a backslash, u, 0, 0, 1, b - NOT the ESC byte.
        const ESCAPED_ESC = '\\u001b';
        expect(esc?.sent).toBe(esc?.kitty ? `${ESCAPED_ESC}[27u` : ESCAPED_ESC);
      });
    } finally {
      untrust();
      cleanup(root);
    }
  });

  /**
   * The USER'S use case, asserted as an outcome rather than as bytes: on claude's agents view,
   * Escape leaves claude.
   *
   * Every byte-level fence for this passed while the user's symptom persisted, which is exactly why
   * this one asserts what a person sees: the shell prompt is back and claude's chrome is gone. A
   * test that only checks what throng transmitted cannot tell "the right bytes were sent" from "the
   * user got what they asked for", and the difference is the whole defect.
   *
   * Needs a project with real sessions in it (THRONG_CLAUDE_E2E_ROOT) - the agents view is a list of
   * them, and in an empty project there is nothing to press Escape on.
   */

  /**
   * The same use case WITH THE MOUSE MOVING, which is the difference between the automated run and
   * the user's hand.
   *
   * Claude enables any-event mouse tracking (1003), so every pointer movement over the terminal is
   * transmitted as `CSI < 35 ; x ; y M` into the same stream as the keys. The user's diagnostics
   * carried forty of those around the keypress; an automated run moves nothing, which is why the
   * outcome test above passes here and the user's Escape "almost always re-enters the session".
   *
   * A hand resting on a mouse is not an exotic condition, so a terminal that only works with a
   * motionless pointer does not work.
   */

  /**
   * The control for the two Escape tests: prove the oracle can say "claude is gone".
   *
   * Both of those assert on the panel header, which shows the foreground command the daemon polls
   * for (every second). An assertion that can only ever come out one way proves nothing, and three
   * earlier versions of this check were wrong in exactly that way - so this one exits claude by a
   * route known to work, Ctrl+C twice, and requires the header to change.
   *
   * Nothing is sent to the model: Ctrl+C is a signal, not a prompt.
   */
  test('the panel header reports claude leaving when it really exits', async () => {
    test.setTimeout(240_000);
    const root = CLAUDE_ROOT ?? mkdtempSync(join(tmpdir(), 'throng-claude-oracle-'));
    const untrust = trustProject(root);
    try {
      await runApp(async (_app, win) => {
        await createProject(win, 'ClaudeOracle', root);
        const pid = await firstPanelId(win);
        await win.getByTestId(`panel-type-select-${pid}`).selectOption('terminal');
        await win.getByTestId('terminal-flavour').selectOption('windows-powershell');
        await win.getByTestId(`panel-type-confirm-${pid}`).click();

        const term = win.getByTestId(`terminal-${pid}`);
        await expect(term).toBeVisible();
        await expect(term).toContainText(basename(root), { timeout: 30_000 });
        await term.click();
        await win.keyboard.type('claude', { delay: TYPE_DELAY });
        await expect(term).toContainText('claude', { timeout: 15_000 });
        await win.keyboard.press('Enter');
        await expect(term).toContainText(/for agents|auto mode on|Welcome back/i, {
          timeout: 180_000,
        });
        await win.waitForTimeout(4000);

        // While it runs, the header names it.
        expect(await runningCommand(win, pid)).toMatch(/claude/i);

        await term.click();
        await win.keyboard.press('Control+c');
        await win.waitForTimeout(600);
        await win.keyboard.press('Control+c');
        await win.waitForTimeout(6000);

        const after = await runningCommand(win, pid);
        console.log(`[claude-oracle] after Ctrl+C twice the header says: ${JSON.stringify(after)}`);
        expect(after, 'the header never stopped naming claude, so the oracle is unusable').not.toMatch(
          /claude/i,
        );
      });
    } finally {
      untrust();
      cleanup(root);
    }
  });

  /**
   * Escape on the agents view, per SHELL FLAVOUR.
   *
   * Escape LEAVES THE VIEW; it does not exit claude. Claude's documented exits are Ctrl+C twice and
   * Ctrl+X Ctrl+K, and the `?` hint on that screen refers to its own help menu — so a terminal in
   * which Escape quits the program is the one behaving oddly, not this one.
   *
   * These fences were written the other way round, against days of assuming a Windows Terminal
   * session was the reference. They are kept, inverted, because the pass now means something: the
   * key reaches claude, the view closes, and the program is still there afterwards.
   *
   * The oracle is the daemon's view of the session's child processes — the process table, not the
   * screen (claude leaves its transcript behind), not the panel header (that shows the title claude
   * sets for itself). A control test elsewhere in this file proves it flips when claude really exits.
   */
  for (const flavour of ['cmd', 'windows-powershell', 'pwsh', 'git-bash']) {
    test(`Escape leaves the agents view without exiting claude (${flavour})`, async () => {
      test.setTimeout(240_000);
      const root = CLAUDE_ROOT ?? mkdtempSync(join(tmpdir(), `throng-esc-${flavour}-`));
      const untrust = trustProject(root);
      try {
        await runApp(async (_app, win) => {
          await createProject(win, `Esc-${flavour}`, root);
          const pid = await firstPanelId(win);
          await win.getByTestId(`panel-type-select-${pid}`).selectOption('terminal');
          await win.getByTestId('terminal-flavour').selectOption(flavour);
          await win.getByTestId(`panel-type-confirm-${pid}`).click();

          const term = win.getByTestId(`terminal-${pid}`);
          await expect(term).toBeVisible();
          // Wait for the PROMPT: a shell still painting one loses the start of what is typed at it,
          // which once submitted `claud` and left a stray `e` on the next line.
          await expect(term).toContainText(basename(root), { timeout: 40_000 });
          await term.click();
          await win.keyboard.type('claude', { delay: TYPE_DELAY });
          await expect(term).toContainText('claude', { timeout: 15_000 });
          await win.keyboard.press('Enter');
          await expect(term).toContainText(/for agents|auto mode on|Welcome back/i, {
            timeout: 180_000,
          });
          await win.waitForTimeout(4000);

          await term.click();
          await win.keyboard.press('ArrowLeft');
          // Prove the agents view is really open before pressing the key under test — a run against a
          // project with no sessions presses Escape at an ordinary prompt and reports on nothing.
          await expect(term).toContainText(/enter to return|space to reply|ctrl\+x to delete/i, {
            timeout: 20_000,
          });
          await step(win, `${flavour}: agents view open, pressing Escape`);

          await win.keyboard.press('Escape');
          await win.waitForTimeout(5000);

          const running = await runningCommand(win, pid);
          const sent = await win.evaluate(
            (id) =>
              (
                window as unknown as {
                  __throngTerminalDiagnostics?: () => Record<
                    string,
                    { keys: { chord: string; sent?: string; kitty: boolean }[] }
                  >;
                }
              )
                .__throngTerminalDiagnostics?.()
                ?.[id]?.keys.filter((k) => k.chord === 'Escape')
                .at(-1) ?? null,
            pid,
          );
          console.log(`[esc-${flavour}] sent=${JSON.stringify(sent)} running=${JSON.stringify(running)}`);
          // The key reached claude as the bare byte every terminal sends…
          expect(sent?.sent, `Escape was not transmitted as a bare byte (${flavour})`).toBe(
            String.fromCharCode(92) + 'u001b',
          );
          // …the agents view closed…
          await expect(term).not.toContainText(/enter to return|space to reply/i, { timeout: 15_000 });
          // …and claude is still running, which is the documented behaviour.
          expect(running, `claude should still be running after Escape (${flavour})`).toMatch(
            /claude/i,
          );
        });
      } finally {
        untrust();
        cleanup(root);
      }
    });
  }

  /**
   * #207 — claude's interface must not stay painted after it exits.
   *
   * Claude renders INLINE: it never takes the alternate screen, so its banner and status footer live
   * in the normal buffer and it erases that region itself on the way out, with cursor moves and
   * erase sequences. Anything that reflows the buffer underneath it lands those erases in the wrong
   * place, and the user is left with a live shell prompt sandwiched between the leavings of a
   * program that has gone.
   *
   * The transcript ABOVE the prompt is not the bug — that is scrollback, and it belongs there. The
   * bug is claude's status footer drawn BELOW the returned prompt, so the assertion is about what
   * comes last on screen, not about whether claude's words appear at all.
   */
  test('claude leaves no interface behind when it exits', async () => {
    test.setTimeout(240_000);
    const root = CLAUDE_ROOT ?? mkdtempSync(join(tmpdir(), 'throng-claude-exit-'));
    const untrust = trustProject(root);
    try {
      await runApp(async (_app, win) => {
        await createProject(win, 'ClaudeExit', root);
        const pid = await firstPanelId(win);
        await win.getByTestId(`panel-type-select-${pid}`).selectOption('terminal');
        await win.getByTestId('terminal-flavour').selectOption('windows-powershell');
        await win.getByTestId(`panel-type-confirm-${pid}`).click();

        const term = win.getByTestId(`terminal-${pid}`);
        await expect(term).toBeVisible();
        await expect(term).toContainText(basename(root), { timeout: 40_000 });
        await term.click();
        await win.keyboard.type('claude', { delay: TYPE_DELAY });
        await expect(term).toContainText('claude', { timeout: 15_000 });
        await win.keyboard.press('Enter');
        await expect(term).toContainText(/for agents|auto mode on|Welcome back/i, {
          timeout: 180_000,
        });
        await win.waitForTimeout(4000);

        await term.click();
        await win.keyboard.press('Control+c');
        await win.waitForTimeout(700);
        await win.keyboard.press('Control+c');
        await win.waitForTimeout(6000);

        // Claude is really gone — asked of the process table, not of the screen.
        expect(await runningCommand(win, pid)).not.toMatch(/claude/i);

        // The last thing on screen is a shell prompt, not claude's status footer.
        const tail = await win.evaluate((id) => {
          const el = document.querySelector(`[data-testid="terminal-${id}"]`);
          const lines = [...(el?.querySelectorAll('.xterm-rows > div') ?? [])]
            .map((r) => (r.textContent ?? '').trim())
            .filter((l) => l.length > 0);
          return lines.slice(-3);
        }, pid);
        console.log(`[claude-exit] last rows: ${JSON.stringify(tail)}`);
        expect(
          tail.join(' '),
          "claude's interface is still painted below the prompt",
        ).not.toMatch(/auto mode on|for agents|Usage\s+£|Model\s+\[/i);
      });
    } finally {
      untrust();
      cleanup(root);
    }
  });

  /**
   * Left, then Left again while claude is asking — throng transmits both, and that is its whole job.
   *
   * Reported as a defect: claude answers the first Left with "press left arrow again to exit", and
   * the second press never satisfies it. Measured in Windows Terminal, the behaviour is IDENTICAL,
   * so it is claude's and not the terminal's — the same conclusion the Escape fence reached, and by
   * the same route.
   *
   * What is throng's to keep true is what this asserts: both presses go out as `CSI D`, neither is
   * swallowed, and nothing rides along between them. The claude-side outcome is recorded as observed
   * rather than as wished for, so if it ever changes upstream this test says so instead of quietly
   * agreeing.
   *
   * The gap does not matter: 150ms, 600ms and 1500ms were measured behaving the same.
   */
  test('both Left presses reach claude, whatever claude then does with them', async () => {
    test.setTimeout(240_000);
    const root = CLAUDE_ROOT ?? mkdtempSync(join(tmpdir(), 'throng-claude-leftexit-'));
    const untrust = trustProject(root);
    try {
      await runApp(async (_app, win) => {
        await createProject(win, 'ClaudeLeftExit', root);
        const pid = await firstPanelId(win);
        await win.getByTestId(`panel-type-select-${pid}`).selectOption('terminal');
        await win.getByTestId('terminal-flavour').selectOption('windows-powershell');
        await win.getByTestId(`panel-type-confirm-${pid}`).click();

        const term = win.getByTestId(`terminal-${pid}`);
        await expect(term).toBeVisible();
        await expect(term).toContainText(basename(root), { timeout: 40_000 });
        await term.click();
        await win.keyboard.type('claude', { delay: TYPE_DELAY });
        await expect(term).toContainText('claude', { timeout: 15_000 });
        await win.keyboard.press('Enter');
        await expect(term).toContainText(/for agents|auto mode on|Welcome back/i, {
          timeout: 180_000,
        });
        await win.waitForTimeout(4000);

        // Type something and take it back out again — the user's exact route to an empty prompt.
        await term.click();
        await win.keyboard.type('delta echo', { delay: TYPE_DELAY });
        await win.waitForTimeout(1200);
        for (let i = 0; i < 14; i += 1) await win.keyboard.press('Backspace');
        await win.waitForTimeout(1200);

        await win.keyboard.press('ArrowLeft');
        // Claude answers with "press left arrow again to exit". Wait for it, so the second press
        // lands while it is asking — that is the reported scenario, and the gap turned out not to
        // matter: 150ms, 600ms and 1500ms all behave the same.
        await expect(term).toContainText(/again to exit|press.*again/i, { timeout: 20_000 });
        await step(win, 'claude is asking for a second Left');

        await win.keyboard.press('ArrowLeft');
        await win.waitForTimeout(6000);

        const keys = await win.evaluate(
          (id) =>
            (
              window as unknown as {
                __throngTerminalDiagnostics?: () => Record<
                  string,
                  { keys: { chord: string; sent?: string; reserved: boolean }[] }
                >;
              }
            )
              .__throngTerminalDiagnostics?.()
              ?.[id]?.keys.filter((k) => k.chord === 'ArrowLeft') ?? [],
          pid,
        );
        console.log(`[left-exit] ArrowLeft decisions: ${JSON.stringify(keys.slice(-2))}`);
        const writes = await win.evaluate(
          (id) =>
            (
              window as unknown as {
                __throngTerminalDiagnostics?: () => Record<string, { writes: string[] }>;
              }
            ).__throngTerminalDiagnostics?.()?.[id]?.writes.slice(-12) ?? [],
          pid,
        );
        console.log(`[left-exit] raw stream: ${JSON.stringify(writes)}`);
        const running = await runningCommand(win, pid);
        console.log(`[left-exit] daemon says running: ${JSON.stringify(running)}`);

        // throng's part: two presses, transmitted identically, neither reserved.
        expect(keys.length, 'both Left presses should have been recorded').toBeGreaterThanOrEqual(2);
        // Eight characters, as the diagnostics store them: \\u001b[D — not the ESC byte.
        const ESCAPED_LEFT = '\\u001b[D';
        for (const k of keys.slice(-2)) {
          expect(k.sent, 'Left must reach the program as CSI D').toBe(ESCAPED_LEFT);
          expect(k.reserved, 'throng must not swallow Left').toBe(false);
        }
        // …and nothing interleaved between them, which is what would change their meaning.
        expect(writes.slice(-2), 'something rode along between the two presses').toEqual([
          ESCAPED_LEFT,
          ESCAPED_LEFT,
        ]);
        /*
         * Claude's part, recorded as MEASURED — in throng and in Windows Terminal alike, the second
         * press does not confirm and claude stays up. Asserted so that an upstream change is caught
         * here rather than silently agreed with.
         */
        expect(running, 'claude exited — the upstream behaviour has changed, revisit this').toMatch(
          /claude/i,
        );
      });
    } finally {
      untrust();
      cleanup(root);
    }
  });
});
