import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import {
  openApp,
  createProject as newProject,
  firstPanelId,
  cleanupTemp,
  type OpenApp,
  TERMINAL_OUTPUT_TIMEOUT_MS,
} from './harness.js';

/*
 * #290 — what a rebuilt terminal view believes about the KEYBOARD NEGOTIATION.
 *
 * The reported defect is that terminal scrolling dies after a project switch and only a window
 * resize brings it back. Underneath it is a belief, not a pixel: `use-terminal.ts` decides on every
 * keydown whether the running program owns the keyboard —
 *
 *     const programOwnsKeyboard = kittyKeyboardActive(kitty) || altBuffer;
 *
 * — and when that is wrongly true on the normal buffer, Ctrl+Home/Ctrl+End are no longer reserved
 * for scrollback (`use-terminal.ts`, the reserveKey call) and plain PageUp/PageDown skip the
 * `term.scrollPages(...)` branch, which is gated on `!programOwnsKeyboard`. Two of the three routes
 * in the report die together, from one stale boolean.
 *
 * ══ WHY THE BELIEF GOES STALE, WHICH IS NOT WHAT ANYONE FIRST THOUGHT ══
 *
 * Not because the negotiation is MISSED while the panel is unmounted. Because on remount it is
 * applied TWICE. Rebuilding a view restores the saved state from `keyboard-mode-store`, and then
 * replays the daemon's scrollback tail — which still contains the very sequences that produced that
 * state, as raw bytes (`appendScrollback` preserves control sequences verbatim). The kitty protocol
 * is a STACK: `CSI > flags u` pushes, `CSI < n u` pops. Two pushes and one pop leaves it enabled, so
 * when the program later turns the protocol off, its pop only cancels the duplicate.
 *
 * ══ WHY THIS IS AN E2E AND NOT SOMETHING CHEAPER ══
 *
 * The double-count needs all three of: a real daemon holding a scrollback tail, a view genuinely
 * torn down and rebuilt, and a program emitting negotiation while no view exists to parse it. A
 * component test has no daemon and no replay, so it cannot produce the second application of the
 * sequence — it would pass with the defect present, which is the worst thing a cheaper layer can do.
 * The tracker itself is unit-tested in core; this is the wiring, and only the app has it.
 *
 * The fixture is a two-line Node program written to disk rather than typed as a shell one-liner,
 * because cmd.exe quoting mangles escape sequences and a test that silently negotiates nothing would
 * pass for the wrong reason.
 */

test.describe.configure({ mode: 'serial' });

let shared: OpenApp;
test.beforeAll(async () => {
  shared = await openApp();
});
test.afterAll(async () => {
  await shared?.close();
});

let projectSeq = 0;
const createProject = (win: Page, name: string, root: string): Promise<void> =>
  newProject(win, `${name}-${(projectSeq += 1)}`, root);

/** The inputs to the `programOwnsKeyboard` decision, as they were at the last keypress. */
type KeyDecision = {
  chord: string;
  reserved: boolean;
  kitty: boolean;
  altBuffer: boolean;
  programOwnsKeyboard: boolean;
};

async function lastKeyDecision(win: Page, pid: string): Promise<KeyDecision> {
  const decision = await win.evaluate((panelId) => {
    const snap = (
      window as unknown as {
        __throngTerminalDiagnostics?: () => Record<string, { keys?: KeyDecision[] }>;
      }
    ).__throngTerminalDiagnostics?.();
    const keys = snap?.[panelId]?.keys ?? [];
    return (keys[keys.length - 1] ?? null) as KeyDecision | null;
  }, pid);
  if (decision === null) {
    throw new Error(
      `no key decision recorded for panel ${pid} — the diagnostics ring is empty, so the ` +
        'assertions below would be about a missing record rather than about the product',
    );
  }
  return decision;
}

/**
 * The file `drop.js` writes once its delayed pop and its trailing output have both been emitted.
 *
 * Named here rather than inlined because two places have to agree on it, and a disagreement would
 * not fail loudly — it would wait the whole budget and then report a product defect.
 */
const DROPPED_FLAG = 'dropped.flag';

/** `CSI > 1 u` — push the disambiguate flag, i.e. "this program wants enhanced key reporting". */
const PUSH = "process.stdout.write('\\x1b[>1u');";
/** `CSI < u` — pop it back off, i.e. "I am done; restore what you had". */
const POP = "process.stdout.write('\\x1b[<u');";

function writeFixtures(root: string): void {
  writeFileSync(join(root, 'push.js'), `${PUSH}\nprocess.stdout.write('KITTY_PUSHED\\r\\n');\n`, 'utf8');
  /*
   * Phase 2 gets its OWN markers, and that is not tidiness. `toContainText` is satisfied by
   * anything already on screen, so re-using phase 1's `KITTY_PUSHED` made the wait return
   * instantly against the FIRST run's output — and the assertion after it then read the state
   * from before the second push had even been emitted. It failed for a reason that had nothing
   * to do with the product, which is the whole argument for a distinct token per attempt.
   */
  writeFileSync(
    join(root, 'push2.js'),
    `${PUSH}\nprocess.stdout.write('KITTY_PUSHED_AGAIN\\r\\n');\n`,
    'utf8',
  );
  // The same pop, but immediate — for the phase that pops with the panel MOUNTED.
  writeFileSync(
    join(root, 'pop.js'),
    `${POP}\nprocess.stdout.write('KITTY_POPPED_LIVE\\r\\n');\n`,
    'utf8',
  );
  /*
   * The pop is DELAYED so the test can leave the tab first — the whole point is that it lands while
   * no view exists to parse it. Then a little output after it, so the remount has something to
   * assert on and the tail plainly extends past the pop.
   *
   * ══ AND IT SIGNALS ON DISK, WHICH IS WHAT MAKES THE WAIT OBSERVABLE ══
   *
   * The test has to know the pop has landed WITHOUT looking at the terminal, because the whole
   * premise is that it is not looking at the terminal. It used to guess by toggling tabs and
   * reading the view each time, and that toggling was itself the flake: every switch tears the
   * view down and rebuilds it, so a poll that was too slow to see the text simply destroyed the
   * view it was waiting for and started the replay again. Under CPU starvation that loop can run
   * for its whole 60 s budget without the rebuilt view ever finishing a replay — the test starves
   * the very thing it is waiting for, and reports it as the product's failure.
   *
   * A file is the honest signal: written by the fixture AFTER its last byte of output, readable
   * from Node while the tab stays where it is, and it turns "the pop probably landed unmounted"
   * from an assumption into something the test has actually established.
   */
  writeFileSync(
    join(root, 'drop.js'),
    [
      'setTimeout(() => {',
      `  ${POP}`,
      "  process.stdout.write('KITTY_POPPED\\r\\n');",
      "  const line = 'x'.repeat(120) + '\\r\\n';",
      '  for (let i = 0; i < 5; i++) process.stdout.write(line);',
      "  process.stdout.write('FILLER_DONE\\r\\n');",
      // An ABSOLUTE path rather than a relative one: the fixture's cwd is the shell's, and a test
      // that silently wrote its flag somewhere else would wait the full budget for a file that
      // already existed under another name.
      `  require('fs').writeFileSync(${JSON.stringify(join(root, DROPPED_FLAG))}, '1');`,
      '}, 4000);',
    ].join('\n'),
    'utf8',
  );
}

async function startTerminal(win: Page, root: string): Promise<string> {
  const pid = await firstPanelId(win);
  await win.getByTestId(`panel-type-select-${pid}`).selectOption('terminal');
  await win.getByTestId('terminal-flavour').selectOption('cmd');
  await win.getByTestId(`panel-type-confirm-${pid}`).click();
  const term = win.getByTestId(`terminal-${pid}`);
  await expect(term).toBeVisible();
  await expect(term).toContainText(basename(root), { timeout: TERMINAL_OUTPUT_TIMEOUT_MS });
  return pid;
}

/**
 * Type a command, run it, and wait for a marker in its output.
 *
 * `waitMs` exists for ONE caller and is not general tidiness: the scrollback filler is a 200-
 * iteration `for /l` loop in a real cmd.exe, and its cost scales with that count where every other
 * command here is a single echo or a node start. On a busy machine it is the one command that can
 * outrun the shared 30 s budget — measured reaching only "filler 65" in 30 s with 17 of 20 cores
 * held busy, which reports the SETUP as a failure of the thing under test.
 */
async function runCommand(
  win: Page,
  pid: string,
  cmd: string,
  marker: string,
  waitMs: number = TERMINAL_OUTPUT_TIMEOUT_MS,
): Promise<void> {
  await win.getByTestId(`terminal-${pid}`).click();
  await win.keyboard.type(cmd, { delay: 10 });
  await win.keyboard.press('Enter');
  await expect(win.getByTestId(`terminal-${pid}`)).toContainText(marker, { timeout: waitMs });
}

// One line, deliberately: `e2e-budget.test.ts` and `e2e-tags.test.ts` match the declaration with a
// LINE-based regex, so a signature wrapped across lines is counted in the total and then missed by
// every category — which reads as a budget that is somehow both over and under at once.
test('a program that drops its keyboard negotiation while its panel is unmounted does not leave the belief behind (#290)', { tag: ['@extended', '@terminal', '@reserve:pty'] }, async () => {
  /*
   * THE BUDGET HAS TO EXCEED THE SUM OF THE WAITS INSIDE IT, and it did not — which is the second
   * half of why this test flaked, and the half that made the first half invisible.
   *
   * The config's default is 60 s. This test spends most of that before it gets anywhere near the
   * interesting part: creating a project, starting a REAL cmd shell, and running three commands
   * that each wait on real output. The poll that follows was then given a 60 s budget of its own —
   * the whole test's budget, from a point 20-30 s into it. It could never reach its own deadline,
   * so it never reported its own message; the test simply died with "Test timeout of 60000ms
   * exceeded", which names nothing and sent every reader looking at the terminal code.
   *
   * 180 s, the figure a dozen other real-process specs in this suite already use. The waits below
   * are unchanged in kind and each still fails on its own condition with its own message.
   */
  test.setTimeout(180_000);
  const root = mkdtempSync(join(tmpdir(), 'throng-kbdneg-'));
  writeFixtures(root);
  try {
    const win = shared.win;
    await createProject(win, 'KbdNeg', root);
    const pid = await startTerminal(win, root);
    const term = win.getByTestId(`terminal-${pid}`);

    await runCommand(win, pid, 'echo TOP_OF_HISTORY', 'TOP_OF_HISTORY');
    // Three times the shared budget, because this command does 200 times the work of its
    // neighbours — see `runCommand`'s `waitMs`.
    await runCommand(win, pid, 'for /l %i in (1,1,200) do @echo filler %i', 'filler 200', 90_000);

    // ── The program negotiates, with the panel MOUNTED, so the live view parses it.
    await runCommand(win, pid, 'node push.js', 'KITTY_PUSHED');
    await term.click();
    await win.keyboard.press('Control+Home');
    const armed = await lastKeyDecision(win, pid);
    /*
     * CONTROL. Without this the test cannot tell "the belief was correctly cleared" from "the
     * fixture never negotiated anything", and the latter passes for free.
     */
    expect(armed.kitty, 'the fixture never negotiated — the rest of this test would be vacuous').toBe(
      true,
    );
    expect(armed.programOwnsKeyboard).toBe(true);
    expect(armed.reserved, 'a program that owns the keyboard must RECEIVE Ctrl+Home').toBe(false);
    await win.keyboard.press('Control+End');

    // ── Start the drop, then leave the tab so the pop lands with the panel unmounted.
    await term.click();
    await win.keyboard.type('node drop.js', { delay: 10 });
    await win.keyboard.press('Enter');

    await win.getByTestId('tab-add').click();
    const chips = win.getByTestId('tab-strip').locator('.tab-chip');
    await expect(chips).toHaveCount(2, { timeout: 20_000 });
    await chips.last().click();
    // Unmounted for real: the panel's terminal is not in the DOM at all.
    await expect(win.getByTestId(`terminal-${pid}`)).toHaveCount(0, { timeout: 20_000 });

    /*
     * ── Wait for the drop to have HAPPENED, without looking at the terminal to find out.
     *
     * The fixture writes its flag after its last byte, so this establishes two things the test
     * previously only assumed: that the pop was emitted at all, and — because the tab has not
     * moved since — that it was emitted with NO VIEW MOUNTED, which is the entire premise.
     *
     * What this replaces was a poll that clicked back and forth between the two tabs until it saw
     * the text. That is a poll which destroys its own subject: each switch tears the view down and
     * restarts the replay, so on a machine slow enough that a rebuild takes longer than one
     * iteration, the loop can spend its whole budget rebuilding and never finish once. It failed
     * that way on a hosted runner in two consecutive gate runs, at 59 s of a 60 s budget, then
     * passed on retry in 16 s — the signature of a test starving itself rather than of a defect.
     */
    await expect
      .poll(() => existsSync(join(root, DROPPED_FLAG)), {
        timeout: 60_000,
        message:
          'the fixture never emitted its delayed pop, so the panel was never unmounted across one ' +
          'and the rest of this test would be about nothing',
      })
      .toBe(true);

    // ── Back ONCE, and then wait patiently. One switch means one rebuild and one replay, and
    // `toContainText` retries against a view that is no longer being pulled apart underneath it.
    await chips.first().click();
    await expect(win.getByTestId(`terminal-${pid}`)).toContainText('FILLER_DONE', {
      timeout: TERMINAL_OUTPUT_TIMEOUT_MS,
    });

    const term2 = win.getByTestId(`terminal-${pid}`);
    await expect(term2).toBeVisible();
    await term2.click();

    /*
     * ══ EVERY ROUTE THE REPORT NAMES, ASSERTED AS THE USER WOULD SEE IT ══
     *
     * These come BEFORE the diagnostics below, deliberately. All of them fail from the same stale
     * boolean, so asserting the boolean alone would be enough to make the test go red — but a red on
     * `programOwnsKeyboard` tells a reader that an internal flag is wrong, while a red on "Ctrl+Home
     * does not reach the top of the scrollback" tells them what the person who filed #290 actually
     * experienced. When each half of the fix was disabled to check it was load-bearing, this is
     * where the failure landed.
     *
     * The reporter's own words for the frozen state: "Ctrl+Home / Ctrl+End, PageUp / PageDown"
     * dead together, "typing in to the prompt worked OK". That last clause is not a throwaway — it
     * is the signature that distinguishes THIS defect from a wedged or disconnected terminal, and
     * it is asserted at the end.
     */
    await win.keyboard.press('Control+Home');
    await expect(term2, 'Ctrl+Home did not reach the top of the scrollback (#290)').toContainText(
      'TOP_OF_HISTORY',
    );
    const after = await lastKeyDecision(win, pid);

    await win.keyboard.press('Control+End');
    await expect(term2, 'Ctrl+End did not return to the live bottom (#290)').toContainText(
      'filler 200',
    );

    // PLAIN PageUp/PageDown — not Shift+ — because that is the pair `use-terminal.ts` gates on
    // `!programOwnsKeyboard`, and the pair the report names.
    await win.keyboard.press('PageUp');
    await expect(term2, 'PageUp did not move the viewport off the live bottom (#290)').not.toContainText(
      'filler 200',
    );
    await win.keyboard.press('PageDown');
    await expect(term2, 'PageDown did not bring the live bottom back (#290)').toContainText(
      'filler 200',
    );

    // THE CONTROL THE REPORT HANDS US. A terminal frozen this way still accepts input — so if
    // typing were broken too, the failure above would be something else entirely and this test
    // would be pointing at the wrong defect.
    await runCommand(win, pid, 'echo STILL_ALIVE', 'STILL_ALIVE');

    // …and the mechanism underneath all four, so a future reader knows WHY they died together.
    expect(
      after.kitty,
      'the rebuilt view still believes the program wants enhanced key reporting, after the ' +
        'program turned it off while the panel was unmounted (#290)',
    ).toBe(false);
    expect(after.programOwnsKeyboard).toBe(false);
    expect(
      after.reserved,
      'Ctrl+Home must be reserved for scrollback once no program owns the keyboard (#290)',
    ).toBe(true);

    /*
     * ══ PHASE 2: the STACK DEPTH has to survive a rebuild too, not just the flag ══
     *
     * The phase above passes even if the rebuilt view re-parses the replayed tail, because that tail
     * happens to hold a push AND its pop — replaying both is balanced, so the flag lands right by
     * luck. What it does not land right is the DEPTH: the tail is a suffix applied on top of a state
     * already derived from the whole stream, so its push is counted twice and the stack ends one
     * deeper than the program's.
     *
     * Nothing observable goes wrong until the program pops again. Then the extra entry absorbs it,
     * the flag stays set, and the terminal is right back in the reported state — one program exit
     * later than anyone would think to look.
     *
     * So: negotiate again, rebuild the view again with the negotiation still ON (no pop in the
     * window this time, so the tail's most recent word on the subject is a push), and then pop it
     * live. A view whose stack is honest turns it off; a view carrying a duplicate does not.
     */
    await runCommand(win, pid, 'node push2.js', 'KITTY_PUSHED_AGAIN');
    await term2.click();
    await win.keyboard.press('Control+Home');
    expect((await lastKeyDecision(win, pid)).kitty, 'the second negotiation did not take').toBe(true);

    await chips.last().click();
    await expect(win.getByTestId(`terminal-${pid}`)).toHaveCount(0, { timeout: 20_000 });
    await chips.first().click();
    const term3 = win.getByTestId(`terminal-${pid}`);
    await expect(term3).toBeVisible({ timeout: 20_000 });

    // One pop, live, with the panel mounted — the program saying "I am done".
    await runCommand(win, pid, 'node pop.js', 'KITTY_POPPED_LIVE');
    await term3.click();
    await win.keyboard.press('Control+Home');
    const settled = await lastKeyDecision(win, pid);
    expect(
      settled.kitty,
      'one pop did not undo one push — the rebuilt view was carrying a duplicate on its ' +
        'negotiation stack, so the next program exit strands the protocol on (#290)',
    ).toBe(false);
    expect(settled.reserved).toBe(true);
  } finally {
    cleanupTemp(root);
  }
});
