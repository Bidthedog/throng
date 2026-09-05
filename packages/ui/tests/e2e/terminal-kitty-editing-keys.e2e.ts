import { copyFileSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect, type Page } from '@playwright/test';
import { skipIfConsoleHidesAltScreen } from './admin.js';
import { skipIfHostCannotDeliverReencodedKeys } from './helpers/console-caps.js';

// EVERY test in this file asserts a byte throng re-encodes and writes itself reaching the
// program, so the host declaration applies to all of them rather than one. Applied per test
// rather than per file because this suite is describe.serial: a single failure skips the rest,
// which is how the same limitation looked like six different problems across three runs.
test.beforeEach(() => skipIfHostCannotDeliverReencodedKeys());
import { openApp,
  createProject as newProject,
  firstPanelId,
  step,
  TYPE_DELAY,
  cleanupTemp,
  quiesced,
  type AppOptions,
  type OpenApp, FILE_OP_TIMEOUT_MS } from './harness.js';

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


/**
 * 028 follow-up — inside Claude Code (running in a PowerShell terminal in throng), Ctrl+Backspace
 * deletes a single character instead of a word, and Ctrl+End does not register at all. The same
 * chords work at an ordinary prompt.
 *
 * Claude negotiates the KITTY keyboard protocol, which is the whole difference, so this drives the
 * proven kitty fixture (the one #90 was verified with) and reads the RAW bytes throng transmitted.
 * Recording to a file sidesteps xterm's DOM quirks and any re-parsing of control bytes — and unlike
 * a stand-in reading normalised stdin, it shows what throng actually sent.
 */

const KITTY = fileURLToPath(new URL('./fixtures/kitty-echo.mjs', import.meta.url));
const KITTY_ALT = fileURLToPath(new URL('./fixtures/kitty-alt-echo.mjs', import.meta.url));
const ALT_ONLY = fileURLToPath(new URL('./fixtures/alt-echo.mjs', import.meta.url));
const KITTY_TOGGLE = fileURLToPath(new URL('./fixtures/kitty-alt-toggle.mjs', import.meta.url));

async function runKittyFixture(
  win: Page,
  root: string,
  ready = 'KITTY_ECHO_READY',
): Promise<void> {
  await createProject(win, 'KittyKeys', root);
  const pid = await firstPanelId(win);
  await win.getByTestId(`panel-type-select-${pid}`).selectOption('terminal');
  await win.getByTestId('terminal-flavour').selectOption('cmd');
  await win.getByTestId(`panel-type-confirm-${pid}`).click();
  const term = win.getByTestId(`terminal-${pid}`);
  await expect(term).toBeVisible();
  await expect(term).toContainText(basename(root), { timeout: 20000 });
  await term.click();
  await win.keyboard.type('node k.mjs', { delay: 40 });
  await win.keyboard.press('Enter');
  await expect(term).toContainText(ready, { timeout: 30000 });
  await term.click();
}

/**
 * Switch to a new tab and back — the reported trigger, which unmounts and REBUILDS the terminal view.
 *
 * Every wait here is a condition, never a duration. A rebuilt view that has not finished re-attaching
 * silently DROPS keystrokes, and the markers this file types are one-shot: a lost marker never
 * reappears, so `captured` waits out its whole budget having proved nothing. That is exactly what a
 * fixed `waitForTimeout(1500)` was gambling on, and on CI it lost — run 31305390679, shard 3,
 * captured "ab" where the test had typed "c", the chord, and "d".
 *
 * So the view is made to PROVE it is taking input, with a throwaway character, before any marker is
 * risked on it. The probes land before the left marker, so every captured slice excludes them.
 */
async function switchAwayAndBack(win: Page, root: string): Promise<void> {
  const chips = win.getByTestId('tab-strip').locator('.tab-chip');
  const before = await chips.count();
  await win.getByTestId('tab-add').click();
  await expect(chips).toHaveCount(before + 1);
  await chips.first().click();

  const term = win.locator('[data-testid^="terminal-"]').first();
  await expect(term).toBeVisible();
  await term.click();

  // The fixture truncates cap.bin at startup, so by here it exists and reading it cannot throw.
  const capFile = join(root, 'cap.bin');
  await expect
    .poll(
      async () => {
        await win.keyboard.type('z', { delay: 40 });
        return readFileSync(capFile).toString('latin1').includes('z');
      },
      { timeout: 30000 },
    )
    .toBe(true);
}

/** Bytes captured between two marker characters the test typed either side of the chord. */
async function captured(root: string, left: string, right: string): Promise<string> {
  const capFile = join(root, 'cap.bin');
  await expect
    .poll(() => readFileSync(capFile).toString('latin1'), { timeout: FILE_OP_TIMEOUT_MS })
    .toContain(right);
  const got = readFileSync(capFile).toString('latin1');
  return got.slice(got.indexOf(left) + 1, got.indexOf(right));
}

test('Ctrl+Backspace reaches a kitty program in the encoding its flags asked for', { tag: ['@extended', '@terminal', '@reserve:pty'] }, async () => {
  test.setTimeout(120_000);
  const root = mkdtempSync(join(tmpdir(), 'throng-kitty-bksp-'));
  copyFileSync(KITTY, join(root, 'k.mjs'));
  try {
    await runApp(async (_app, win) => {
      await runKittyFixture(win, root);
      await win.keyboard.type('a', { delay: 40 });
      await win.keyboard.press('Control+Backspace');
      await win.keyboard.type('b', { delay: 40 });

      const seq = await captured(root, 'a', 'b');
      // `^H` (0x08) is what a legacy terminal sends, and it is indistinguishable from Ctrl+H — which
      // is why Claude deletes ONE character. A kitty program expects the CSI-u report.
      /*
       * The fixture enables DISAMBIGUATE only (`CSI > 1 u`), and under that flag the kitty spec
       * PRESERVES the legacy encoding of every key that has one. Backspace has one, so `^H` is
       * the conformant answer — not the CSI-u an earlier revision of this test demanded.
       *
       * That revision was wrong in a way worth recording: throng sent CSI-u to a program that
       * had only asked to disambiguate, the program ignored a report it never agreed to
       * receive, and the chord went from 'deletes one character' to 'does nothing at all'.
       *
       * Making Ctrl+Backspace mean delete-a-WORD needs throng to advertise and honour the
       * report-all-keys flag, which it does not yet do. This fence pins what throng sends
       * TODAY, so the next change to it is deliberate rather than incidental.
       */
      expect(seq).toBe(String.fromCharCode(8));
    });
  } finally {
    cleanupTemp(root);
  }
});

test('Ctrl+End reaches a kitty program instead of being taken for scrollback', { tag: ['@extended', '@terminal', '@reserve:pty'] }, async () => {
  test.setTimeout(120_000);
  const root = mkdtempSync(join(tmpdir(), 'throng-kitty-end-'));
  copyFileSync(KITTY, join(root, 'k.mjs'));
  try {
    await runApp(async (_app, win) => {
      await runKittyFixture(win, root);
      await win.keyboard.type('a', { delay: 40 });
      await win.keyboard.press('Control+End');
      await win.keyboard.type('b', { delay: 40 });

      const seq = await captured(root, 'a', 'b');
      // throng binds Ctrl+End to `terminal.scrollToBottom` and reserves it unconditionally, so the
      // program never sees it — "doesn't register at all". On the ALTERNATE screen there is no
      // scrollback to scroll, so the binding has nothing to do there and the key belongs to the
      // program. (The kitty fixture is on the normal screen, so this asserts the general rule: a
      // reserved scrollback chord must still reach a program that asked for enhanced reporting.)
      expect(seq.length).toBeGreaterThan(0);
    });
  } finally {
    cleanupTemp(root);
  }
});

/**
 * The one that explains "it worked once, then stopped".
 *
 * The keyboard negotiation state — kitty flags, win32-input-mode — lives on the VIEW, and an
 * inactive tab is unmounted, so every tab switch rebuilds the terminal and starts that state from
 * zero. The program negotiated once, at startup, and has no reason to do it again just because
 * throng threw its view away. So after the first switch throng no longer believes the program wants
 * enhanced reporting, and both Ctrl+Backspace and Ctrl+End quietly revert to their broken forms.
 *
 * Worse since the replay was suppressed on the alternate screen (rightly — it was a flash): the
 * negotiation can no longer even be re-learned from the replayed tail.
 */
test('a rebuilt view still knows the program negotiated the keyboard', { tag: ['@extended', '@terminal', '@reserve:pty'] }, async () => {
  test.setTimeout(120_000);
  const root = mkdtempSync(join(tmpdir(), 'throng-kitty-rebuild-'));
  // The ALTERNATE-screen variant deliberately: on the normal screen a rebuilt view re-learns the
  // negotiation from the replayed tail, which hides the fault entirely.
  copyFileSync(KITTY_ALT, join(root, 'k.mjs'));
  try {
    await runApp(async (_app, win) => {
      await runKittyFixture(win, root, 'KITTY_ALT_READY');

      // Switch away and back: the panel is unmounted and rebuilt, exactly as in normal use.
      await switchAwayAndBack(win, root);

      await win.keyboard.type('a', { delay: 40 });
      await win.keyboard.press('Control+Backspace');
      await win.keyboard.type('b', { delay: 40 });

      const seq = await captured(root, 'a', 'b');
      // Stability across the rebuild is the subject: the negotiated encoding must not revert.
      expect(seq).toBe(String.fromCharCode(8));
    });
  } finally {
    cleanupTemp(root);
  }
});

/**
 * The reported sequence, exactly: Ctrl+End works, then you switch to another tab and back, and it
 * stops. Reported as reproducing on this branch, with the latest code.
 *
 * The earlier rebuild test did not catch it because it asserted on Ctrl+BACKSPACE, whose encoding is
 * the legacy byte either way — stable across a rebuild whether or not throng still knows anything
 * about the program. Ctrl+End is the one that turns on what throng believes, because throng only
 * yields the chord to a program it thinks owns the keyboard.
 */
test('Ctrl+End still reaches the program after switching tabs and back', { tag: ['@extended', '@terminal', '@reserve:pty'] }, async () => {
  test.setTimeout(120_000);
  const root = mkdtempSync(join(tmpdir(), 'throng-kitty-end-rebuild-'));
  copyFileSync(KITTY_ALT, join(root, 'k.mjs'));
  try {
    await runApp(async (_app, win) => {
      await runKittyFixture(win, root, 'KITTY_ALT_READY');

      // Before: it works.
      await win.keyboard.type('a', { delay: 40 });
      await win.keyboard.press('Control+End');
      await win.keyboard.type('b', { delay: 40 });
      expect((await captured(root, 'a', 'b')).length).toBeGreaterThan(0);

      // Switch to another tab and back — the reported trigger.
      await switchAwayAndBack(win, root);

      // After: it must still work.
      await win.keyboard.type('c', { delay: 40 });
      await win.keyboard.press('Control+End');
      await win.keyboard.type('d', { delay: 40 });
      const after = await captured(root, 'c', 'd');
      expect(after.length).toBeGreaterThan(0);
    });
  } finally {
    cleanupTemp(root);
  }
});

/**
 * The same sequence against a program that negotiates NOTHING — which is the case that actually
 * reproduces, and the one every earlier test hid.
 *
 * throng advertises no kitty flags, so a program that queries support may reasonably enable none.
 * Then the only thing telling throng the program owns the keyboard is the ALTERNATE SCREEN. A
 * rebuilt view cannot see that: the replay carrying the switch sequence is deliberately suppressed
 * (it was a flash), and a full-screen program does not re-announce the switch just because throng
 * rebuilt a view. So the view believes it is on the normal buffer, takes Ctrl+End back for
 * scrollback, and the chord dies — after a tab switch, exactly as reported.
 */
test('Ctrl+End survives a tab switch even when the program negotiated nothing', { tag: ['@extended', '@terminal', '@reserve:pty'] }, async () => {
  // The ONLY test here whose signal is the alternate screen alone; every sibling also has the
  // kitty negotiation, which older console hosts DO forward. See the guard for the measurement.
  skipIfConsoleHidesAltScreen();
  test.setTimeout(120_000);
  const root = mkdtempSync(join(tmpdir(), 'throng-alt-end-rebuild-'));
  copyFileSync(ALT_ONLY, join(root, 'k.mjs'));
  try {
    await runApp(async (_app, win) => {
      await runKittyFixture(win, root, 'ALT_READY');

      await win.keyboard.type('a', { delay: 40 });
      await win.keyboard.press('Control+End');
      await win.keyboard.type('b', { delay: 40 });
      expect((await captured(root, 'a', 'b')).length).toBeGreaterThan(0);

      await switchAwayAndBack(win, root);

      await win.keyboard.type('c', { delay: 40 });
      await win.keyboard.press('Control+End');
      await win.keyboard.type('d', { delay: 40 });
      expect((await captured(root, 'c', 'd')).length).toBeGreaterThan(0);
    });
  } finally {
    cleanupTemp(root);
  }
});

/**
 * Escape, under a program that asked to DISAMBIGUATE escape codes.
 *
 * Reported from a real Claude Code session in a throng PowerShell terminal: pressing Escape on the
 * agent list re-enters the selected session instead of leaving claude, and only sometimes — the
 * signature of a program waiting to see whether more bytes follow.
 *
 * The user's diagnostics named the cause. At that keypress throng's own state read `kitty: true`:
 * claude had negotiated the kitty keyboard protocol. Disambiguating escape codes is the ONE thing
 * that flag is for, and Escape is the key it exists for — `0x1b` is both the Escape key and the
 * first byte of every escape sequence, so a bare `0x1b` is precisely the ambiguity the program
 * asked to be rid of. Under the flag it must be reported as `CSI 27 u`.
 *
 * throng sends the bare byte, so the keypress is indistinguishable from the start of a sequence and
 * the program is entitled to read it as something else. Intermittent because it depends on what
 * arrives next and how long the program waits.
 *
 * The alternate-screen fixture deliberately: it is the combination the user is in — a full-screen
 * program that has ALSO negotiated the keyboard.
 */
test('Escape reaches a kitty program as the bare byte every working terminal sends', { tag: ['@extended', '@terminal', '@reserve:pty'] }, async () => {
  test.setTimeout(120_000);
  const root = mkdtempSync(join(tmpdir(), 'throng-kitty-esc-'));
  copyFileSync(KITTY_ALT, join(root, 'k.mjs'));
  try {
    await runApp(async (_app, win) => {
      await runKittyFixture(win, root, 'KITTY_ALT_READY');
      await step(win, 'the fixture is up: a full-screen program that negotiated the kitty keyboard');

      await win.keyboard.type('a', { delay: TYPE_DELAY });
      await step(win, "typed 'a' — the marker BEFORE the keypress under test");

      await win.keyboard.press('Escape');
      await step(win, 'pressed Escape — this is the one that must arrive as CSI 27 u');

      await win.keyboard.type('b', { delay: TYPE_DELAY });
      await step(win, "typed 'b' — the marker AFTER; whatever sits between them is what the program got");

      const seq = await captured(root, 'a', 'b');
      console.log(`[step] the program received ${JSON.stringify(seq)} for Escape`);
      /*
       * The BARE byte, not the CSI-u form the specification prescribes.
       *
       * Captured from both terminals with the kitty flags pushed exactly as claude pushes them:
       *
       *   Windows Terminal   1b                 <- the push is ignored outright
       *   throng (before)    1b 5b 32 37 75     <- `CSI 27 u`
       *
       * Windows Terminal does not implement the protocol, and it is the terminal Claude Code works
       * in. Sending the conformant report was the one thing throng did that no working terminal
       * does, so this fence pins the legacy byte deliberately.
       */
      expect(seq).toBe(String.fromCharCode(27));
    });
  } finally {
    cleanupTemp(root);
  }
});

/**
 * The negotiation must survive the program's OWN screen churn.
 *
 * Claude Code leaves and re-enters the alternate screen every time it opens or closes a view, and it
 * does not re-announce its keyboard flags when it does — from its side nothing changed; it
 * negotiated once, at startup. A terminal that reads each switch as "a new program has started"
 * discards a negotiation that is still in force.
 *
 * A user's diagnostics caught exactly that, between consecutive keystrokes in one session:
 *
 *   Escape  kitty: true   sent "[27u"
 *   Escape  kitty: false  sent ""
 *   Escape  kitty: true   sent "[27u"
 *
 * which is why Escape worked "most of the time but not always" — the failing presses were the ones
 * landing after a screen switch and before the program next said anything.
 */
test('a kitty negotiation survives the program leaving and re-entering the alternate screen', { tag: ['@extended', '@terminal', '@reserve:pty'] }, async () => {
  test.setTimeout(120_000);
  const root = mkdtempSync(join(tmpdir(), 'throng-kitty-toggle-'));
  copyFileSync(KITTY_TOGGLE, join(root, 'k.mjs'));
  try {
    await runApp(async (_app, win) => {
      await runKittyFixture(win, root, 'KITTY_TOGGLE_READY');

      // Before the churn: the negotiated encoding.
      await win.keyboard.type('a', { delay: TYPE_DELAY });
      await win.keyboard.press('Escape');
      await win.keyboard.type('b', { delay: TYPE_DELAY });
      expect(await captured(root, 'a', 'b')).toBe(String.fromCharCode(27));

      // `T` makes the fixture churn the alternate screen without renegotiating.
      const term = win.locator('[data-testid^="terminal-"]').first();
      await win.keyboard.type('T', { delay: TYPE_DELAY });
      // Wait for the churn's leave-and-re-enter repaint to actually land and settle, rather than
      // guessing how long it takes — the same redrawing-terminal condition quiesced() exists for.
      await quiesced(term, { what: 'terminal after the alt-screen churn' });
      await step(win, 'the program left and re-entered the alternate screen, saying nothing else');

      // After the churn: it must be the SAME encoding. The program never withdrew anything.
      await win.keyboard.type('c', { delay: TYPE_DELAY });
      await win.keyboard.press('Escape');
      await win.keyboard.type('d', { delay: TYPE_DELAY });
      expect(await captured(root, 'c', 'd')).toBe(String.fromCharCode(27));
    });
  } finally {
    cleanupTemp(root);
  }
});
