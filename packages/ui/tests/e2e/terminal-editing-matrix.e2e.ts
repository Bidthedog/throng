import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import {
  runApp,
  createProject,
  firstPanelId,
  cleanupTemp,
  quiesced,
  TERMINAL_OUTPUT_TIMEOUT_MS,
} from './harness.js';

/**
 * The line-editing chords, across every shell throng ships, asserted by OUTCOME.
 *
 * These exist because a whole feature's worth of byte-level fences passed while the user's chords
 * stayed broken. Asserting "throng transmitted 0x08" answers a question nobody asked; the question is
 * whether the word was deleted. So every case here makes the SHELL compute the answer and reads what
 * it printed: a wrong keystroke cannot fake the marker.
 *
 * The pattern throughout: leave a command deliberately incomplete, use the chord under test to
 * repair it, then submit. If the chord did what it should, the command runs and prints its marker.
 * If it did nothing, or something else, the command is malformed and the marker never appears.
 *
 * Flavour coverage is the point: the same chord reaches a different line editor in each shell, and
 * the encoding that works for one has already been measured breaking another.
 *
 * ONE APP PER FLAVOUR, not one per chord. Each `runApp` is a daemon plus an Electron launch plus a
 * shell start — around twenty seconds of setup to test a single keystroke, and at twenty cases this
 * became the largest file in CI's slowest shard, which then timed out at the 30-minute job cap. The
 * chords are independent commands typed at one prompt, so they share a terminal and run as
 * `test.step`s: the per-chord reporting survives, and the setup is paid once instead of five times.
 *
 * Sharing a terminal has one hazard, and every marker below is unique because of it. `expectPrinted`
 * scans the whole screen, so a marker reused across steps could match the PREVIOUS step's output and
 * pass without the chord having done anything at all.
 */

interface Flavour {
  /** The id in the terminal's flavour picker. */
  id: string;
  /** How the test names it. */
  label: string;
  /** `echo` is not universal; git-bash and the PowerShells differ in quoting. */
  echo: (text: string) => string;
  /**
   * The same, for a phrase containing a SPACE. Not the same call: `Write-Output alpha bravo` passes
   * two arguments and PowerShell prints them on separate lines, so a marker spanning the space could
   * never appear. Quoting keeps it one argument — and one printed line — in every shell.
   */
  phrase: (text: string) => string;
  /** Fills the buffer past one screen, for the scrollback chords. */
  fill: string;
}

const FLAVOURS: Flavour[] = [
  // cmd echoes its quotes back, so its phrase form deliberately has none.
  {
    id: 'cmd',
    label: 'cmd',
    echo: (t) => `echo ${t}`,
    phrase: (t) => `echo ${t}`,
    fill: 'for /L %i in (1,1,120) do @echo SCROLLMARK%i',
  },
  {
    id: 'windows-powershell',
    label: 'Windows PowerShell',
    echo: (t) => `Write-Output ${t}`,
    phrase: (t) => `Write-Output "${t}"`,
    fill: '1..120 | ForEach-Object { "SCROLLMARK$_" }',
  },
  {
    id: 'pwsh',
    label: 'pwsh',
    echo: (t) => `Write-Output ${t}`,
    phrase: (t) => `Write-Output "${t}"`,
    fill: '1..120 | ForEach-Object { "SCROLLMARK$_" }',
  },
  {
    id: 'git-bash',
    label: 'git-bash',
    echo: (t) => `echo ${t}`,
    phrase: (t) => `echo ${t}`,
    fill: 'for i in $(seq 1 120); do echo SCROLLMARK$i; done',
  },
];

/** The terminal's rendered rows — NOT `textContent`, which also returns xterm's injected CSS. */
async function rows(win: Page, panelId: string): Promise<string> {
  return win.evaluate((id) => {
    const el = document.querySelector(`[data-testid="terminal-${id}"]`);
    return [...(el?.querySelectorAll('.xterm-rows > div') ?? [])]
      .map((r) => r.textContent ?? '')
      .join(String.fromCharCode(10));
  }, panelId);
}

/** Submit the line and wait for the shell to print `marker` on a line of its own. */
async function expectPrinted(win: Page, pid: string, marker: string): Promise<boolean> {
  await win.keyboard.press('Enter');
  try {
    await expect
      .poll(
        async () => {
          const text = await rows(win, pid);
          // The command line itself contains the marker too, so look for it on a line that is
          // NOT the echoed command — the shell's own output has no `echo`/`Write-Output` in front
          // of it.
          return text
            .split(String.fromCharCode(10))
            .map((l) => l.trim())
            .some((l) => l === marker);
        },
        { timeout: 10_000 },
      )
      .toBe(true);
    return true;
  } catch {
    return false;
  }
}

/**
 * Type `text`, then WAIT UNTIL THE SHELL HAS ECHOED IT — issue #252.
 *
 * `keyboard.type` resolves when the keystrokes have been DISPATCHED, not when the shell has
 * assembled a line out of them. Every chord step below used to send its chord the instant typing
 * returned, so under load the chord operated on a line that was not yet what the test believed it
 * was: Home moved to the start of a half-built line, the repair character landed in the wrong
 * place, and the command printed nothing the assertion recognised. The reported failure was
 * "Home/End did not move the cursor within the line", which is a true statement about a line that
 * had not finished existing.
 *
 * git-bash surfaced it first, and that is not because git-bash is broken — its line editor simply
 * assembles on a different schedule from PSReadLine's, so it lost the race first. Fixing only the
 * reported step would have left the same race in the other three (FR-014 says every step).
 *
 * This is exactly the principle `openShell` already applies to the prompt: it refuses to trust a
 * painted prompt and runs a real command instead, because "that the shell echoed, edited and printed
 * READYOK is the only evidence that the next keystroke will be seen". Same rule, per step.
 *
 * Whitespace is stripped from BOTH sides before comparing: a long command wraps across terminal rows,
 * and the wrap inserts a newline mid-string that would otherwise defeat a literal match. This is an
 * echo check, not the assertion the test exists for — the markers below do that work.
 */
async function typeAndEcho(win: Page, pid: string, text: string, expected = text): Promise<void> {
  await win.keyboard.type(text, { delay: 25 });
  await awaitEcho(win, pid, expected);
}

/**
 * Wait until `expected` is on the screen, without typing anything.
 *
 * Separate from `typeAndEcho` because what is TYPED and what should then APPEAR are not always the
 * same string — repairing a line types one character and expects the whole command. Conflating them
 * is not a hypothetical: the first version of this fix passed the full command to `typeAndEcho`
 * where only its first character should have been typed, so the line became `echo LINEOKcho LINEOK`,
 * printed nothing, and took the spec from 0 failures in 3 runs under load to 3 in 3. It was caught
 * by measuring before as well as after, which is the only reason it is not in the branch.
 */
async function awaitEcho(win: Page, pid: string, expected: string): Promise<void> {
  const bare = (s: string): string => s.replace(/\s+/g, '');
  await expect
    .poll(async () => bare(await rows(win, pid)).includes(bare(expected)), {
      timeout: TERMINAL_OUTPUT_TIMEOUT_MS,
      message:
        `the shell never showed "${expected}", so the chord under test would have edited a line ` +
        `that had not finished being assembled`,
    })
    .toBe(true);
}

/**
 * Submit the line and wait for the shell to print ONE of `markers` — returning which.
 *
 * Needed because `forward-word` is not one behaviour: readline stops at the END of the word, while
 * PSReadLine's NextWord stops at the START of the next one. Both are word movement; they simply
 * disagree about which edge. A test demanding one exact line could only ever pass on half the shells
 * throng ships, and would be asserting on the line editor rather than on throng.
 */
async function printedOneOf(win: Page, pid: string, markers: string[]): Promise<string | undefined> {
  await win.keyboard.press('Enter');
  let hit: string | undefined;
  try {
    await expect
      .poll(
        async () => {
          const lines = (await rows(win, pid)).split(String.fromCharCode(10)).map((l) => l.trim());
          hit = markers.find((m) => lines.includes(m));
          return hit !== undefined;
        },
        { timeout: 10_000 },
      )
      .toBe(true);
    return hit;
  } catch {
    return undefined;
  }
}

/** Open a terminal of this flavour and wait for a prompt that is ready to take a command. */
async function openShell(win: Page, root: string, flavour: Flavour): Promise<string> {
  await createProject(win, `Chords-${flavour.id}`, root);
  const pid = await firstPanelId(win);
  await win.getByTestId(`panel-type-select-${pid}`).selectOption('terminal');
  await win.getByTestId('terminal-flavour').selectOption(flavour.id);
  await win.getByTestId(`panel-type-confirm-${pid}`).click();
  const term = win.getByTestId(`terminal-${pid}`);
  await expect(term).toBeVisible();
  /*
   * Wait for the PROMPT, not just for the panel. A shell still painting its prompt loses the start
   * of whatever is typed at it — measured as `claud` submitting and a stray `e` landing on the next
   * line — and the test then reports on a command nobody wrote.
   */
  await expect(term).toContainText(basename(root), { timeout: 40_000 });
  await term.click();

  /*
   * A painted prompt is not a ready line editor. PSReadLine finishes initialising AFTER the prompt is
   * on screen, and under load it swallows whatever was typed in between — measured as three of twenty
   * cases failing in a full sequential run while passing one at a time, which is the worst way for a
   * suite to be wrong.
   *
   * So prove readiness rather than waiting a guessed interval: run one real command and require its
   * output. That the shell echoed, edited and printed `READYOK` is the only evidence that the next
   * keystroke will be seen.
   */
  await win.keyboard.type(flavour.echo('READYOK'), { delay: 25 });
  if (!(await expectPrinted(win, pid, 'READYOK'))) {
    throw new Error(
      `${flavour.label}: the shell never printed READYOK — it never became interactive`,
    );
  }
  return pid;
}

for (const flavour of FLAVOURS) {
  test(`line-editing chords — ${flavour.label}`, { tag: ['@extended', '@terminal'] }, async () => {
    test.setTimeout(240_000);
    const root = mkdtempSync(join(tmpdir(), `throng-chords-${flavour.id}-`));
    try {
      await runApp(async (_app, win) => {
        const pid = await openShell(win, root, flavour);

        await test.step('Ctrl+Backspace deletes the previous word', async () => {
          // A trailing word the chord must remove in one press. If it deletes one character, or
          // nothing, the leftover makes the command print the wrong thing.
          await typeAndEcho(win, pid, `${flavour.echo('BKSPOK')} DELETEME`);
          await win.keyboard.press('Control+Backspace');
          expect(
            await expectPrinted(win, pid, 'BKSPOK'),
            'Ctrl+Backspace did not delete the previous word',
          ).toBe(true);
        });

        await test.step('Home and End move within the line', async () => {
          const full = flavour.echo('LINEOK');
          // Missing its FIRST character, repaired by travelling to the start of the line…
          await typeAndEcho(win, pid, full.slice(1));
          await win.keyboard.press('Home');
          // Type ONLY the missing first character, then wait for the WHOLE command to be on the
          // line. Note the two arguments: what is typed is one character, what should then appear
          // is the repaired command. If Home had not landed, this shows the character in the wrong
          // place and the step fails HERE, naming the line, rather than later naming the marker.
          await typeAndEcho(win, pid, full[0], full);
          // …and End must bring the cursor back, or the newline lands mid-command.
          await win.keyboard.press('End');
          expect(
            await expectPrinted(win, pid, 'LINEOK'),
            'Home/End did not move the cursor within the line',
          ).toBe(true);
        });

        await test.step('Ctrl+Left lands BEFORE the last word, not inside it', async () => {
          // Word-left puts the marker before `bravo`; a character-left would put it inside.
          await typeAndEcho(win, pid, flavour.phrase('alpha bravo'));
          await win.keyboard.press('Control+ArrowLeft');
          await win.keyboard.type('WORDLOK', { delay: 25 });
          expect(
            await expectPrinted(win, pid, 'alpha WORDLOKbravo'),
            'Ctrl+Left did not land on the word boundary',
          ).toBe(true);
        });

        await test.step('Ctrl+Right moves by WORD, not by character', async () => {
          /*
           * Travel back two words to the start of `alpha`, then forward ONE word, and mark where the
           * cursor stopped. Two landings are legitimate — `alphaWORDROK bravo` (readline, end of the
           * word) and `alpha WORDROKbravo` (PSReadLine, start of the next). Both are word movement.
           *
           * What neither can be mistaken for is the failure this guards: a chord arriving as a plain
           * Right prints `aWORDROKlpha bravo`, and one not arriving at all prints
           * `WORDROKalpha bravo`. Those are excluded by not being in the accepted set.
           */
          await typeAndEcho(win, pid, flavour.phrase('alpha bravo'));
          await win.keyboard.press('Control+ArrowLeft');
          await win.keyboard.press('Control+ArrowLeft');
          await win.keyboard.press('Control+ArrowRight');
          await win.keyboard.type('WORDROK', { delay: 25 });
          const landed = await printedOneOf(win, pid, ['alphaWORDROK bravo', 'alpha WORDROKbravo']);
          expect(landed, 'Ctrl+Right did not move the cursor by a word').toBeDefined();
          console.log(`[word] ${flavour.label}: Ctrl+Right landed as "${landed}"`);
        });

        await test.step('Ctrl+Home and Ctrl+End scroll the buffer, not the line', async () => {
          /*
           * These are throng's scrollback chords, not line editing: top of buffer and bottom of
           * buffer. An earlier version of this asserted they moved the CURSOR, which is a different
           * feature belonging to Home/End above — it failed on every shell and was wrong to.
           *
           * Runs LAST of the five: it fills the buffer past one screen, and the steps above read the
           * screen for their markers.
           */
          const term = win.getByTestId(`terminal-${pid}`);
          await win.keyboard.type(flavour.fill, { delay: 12 });
          await win.keyboard.press('Enter');
          await expect(term).toContainText('SCROLLMARK120', { timeout: 30_000 });
          await quiesced(term, { what: 'scrollback fill settling before scrolling' });

          expect(
            await rows(win, pid),
            'the newest output should be on screen before scrolling',
          ).toContain('SCROLLMARK120');

          await win.keyboard.press('Control+Home');
          await quiesced(term, { what: 'buffer scrolled to top (Ctrl+Home)' });
          expect(await rows(win, pid), 'Ctrl+Home should show the TOP of the buffer').not.toContain(
            'SCROLLMARK120',
          );

          await win.keyboard.press('Control+End');
          await quiesced(term, { what: 'buffer scrolled back to bottom (Ctrl+End)' });
          expect(await rows(win, pid), 'Ctrl+End should return to the newest output').toContain(
            'SCROLLMARK120',
          );
        });
      });
    } finally {
      cleanupTemp(root);
    }
  });
}
