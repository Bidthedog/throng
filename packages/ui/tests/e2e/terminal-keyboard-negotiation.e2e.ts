import { mkdtempSync, writeFileSync } from 'node:fs';
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

async function runCommand(win: Page, pid: string, cmd: string, marker: string): Promise<void> {
  await win.getByTestId(`terminal-${pid}`).click();
  await win.keyboard.type(cmd, { delay: 10 });
  await win.keyboard.press('Enter');
  await expect(win.getByTestId(`terminal-${pid}`)).toContainText(marker, {
    timeout: TERMINAL_OUTPUT_TIMEOUT_MS,
  });
}

// One line, deliberately: `e2e-budget.test.ts` and `e2e-tags.test.ts` match the declaration with a
// LINE-based regex, so a signature wrapped across lines is counted in the total and then missed by
// every category — which reads as a budget that is somehow both over and under at once.
test('a program that drops its keyboard negotiation while its panel is unmounted does not leave the belief behind (#290)', { tag: ['@extended', '@terminal', '@reserve:pty'] }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'throng-kbdneg-'));
  writeFixtures(root);
  try {
    const win = shared.win;
    await createProject(win, 'KbdNeg', root);
    const pid = await startTerminal(win, root);
    const term = win.getByTestId(`terminal-${pid}`);

    await runCommand(win, pid, 'echo TOP_OF_HISTORY', 'TOP_OF_HISTORY');
    await runCommand(win, pid, 'for /l %i in (1,1,200) do @echo filler %i', 'filler 200');

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

    // ── Back, once the drop has certainly happened. The tail now contains the pop, and the
    // rebuilt view must not end up believing the protocol is still on.
    await expect
      .poll(
        async () => {
          await chips.first().click();
          const back = win.getByTestId(`terminal-${pid}`);
          if ((await back.count()) === 0) return false;
          const text = (await back.textContent()) ?? '';
          if (text.includes('FILLER_DONE')) return true;
          await chips.last().click();
          return false;
        },
        {
          timeout: 60_000,
          message: 'the dropped negotiation never reached the terminal, so nothing was tested',
        },
      )
      .toBe(true);

    const term2 = win.getByTestId(`terminal-${pid}`);
    await expect(term2).toBeVisible();
    await term2.click();
    await win.keyboard.press('Control+Home');
    const after = await lastKeyDecision(win, pid);

    // THE ASSERTION. The program turned the protocol off; the rebuilt view must agree.
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
    // …and the user-visible consequence: the viewport actually moves.
    await expect(term2).toContainText('TOP_OF_HISTORY');

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
