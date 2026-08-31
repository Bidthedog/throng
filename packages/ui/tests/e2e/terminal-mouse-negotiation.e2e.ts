import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import {
  openApp,
  createProject as newProject,
  firstPanelId,
  type OpenApp,
  TERMINAL_OUTPUT_TIMEOUT_MS,
} from './harness.js';

/*
 * #290, the half PR #343/#346 did not fix — what a rebuilt terminal view believes about the MOUSE.
 *
 * ══ STATUS: SKIPPED, AND FAILING ON PURPOSE ══
 *
 * #290 is `under-observation` with no milestone: the maintainer could not reproduce the defect by
 * hand. This file reproduces it deterministically (2.8s, every run) but through a SYNTHETIC fixture
 * that arms the mouse itself, and it is NOT established that a real session reaches the same state.
 * That gap is exactly why the issue is parked and why this test is skipped rather than deleted — the
 * measurement is worth keeping, the red bar is not. See the skip at the top of the test body for how
 * to run it.
 *
 * The report is that terminal scrolling dies after a project switch and only a window resize brings
 * it back. The KEYBOARD routes (Ctrl+Home/Ctrl+End, PageUp/PageDown) were fixed by making the daemon
 * own the negotiation and hand it back on attach — see terminal-keyboard-negotiation.e2e.ts. The
 * WHEEL was left open, and it dies from the same shape of fault with none of the same fix.
 *
 * ══ THE MECHANISM, MEASURED — AND IT IS NOT THE ONE #290 AND ITS RELEASE NOTE ASSUMED ══
 *
 * A wheel notch is routed by a pure function (core/terminal/wheel-decision.ts):
 *
 *     if (ctx.ctrlKey) return 'zoom';
 *     if (ctx.mouseReporting) return 'program';
 *     return ctx.altBuffer ? 'arrows' : 'viewport';
 *
 * `mouseReporting` is a renderer-local mirror, created EMPTY on every view build
 * (use-terminal.ts, `createMouseReportingState()`), and use-terminal states where it expects to
 * refill it from:
 *
 *     // Mouse reporting is NOT suppressed: the daemon does not track it, so the replayed tail is
 *     // this view's only source for it […]
 *
 * The daemon withholds that tail from exactly the programs this matters for. terminal-service.ts:
 *
 *     const replay = existing.altScreen ? '' : existing.scrollback;
 *
 * A full-screen program is ALWAYS on the alternate screen, so a rebuilt view of one always replays
 * zero bytes — measured here as `__throngLastReplayBytes === 0` — and the only source the mirror has
 * never arrives. Meanwhile `altScreen` IS tracked by the daemon and IS restored (use-terminal writes
 * `CSI ? 1049 h` itself from `res.altScreen`), and so is the keyboard (`res.keyboard`). The attach
 * response carries a `keyboard` field and no mouse equivalent; that asymmetry is the defect.
 *
 * So the rebuilt view holds `altBuffer: true` with `mouseReporting: false` — a pair that was never
 * true at once while the program ran — and `decideWheel` takes the third branch. throng synthesises
 * arrow keys and types them at a program that asked for mouse reports.
 *
 * THE 64 KiB TAIL CAP IS NOT INVOLVED, and believing it was cost a wrong fix once already. #290's
 * release note proposed that the arming sequence had been EVICTED from the bounded tail. It was
 * tested: with the fixture's output cut to ~10 KiB, far inside `MAX_SCROLLBACK`, the defect
 * reproduces identically. The tail is empty because it is withheld, not because it overflowed.
 *
 * That accounts for every observation in the report, including the two nothing else did:
 *   - the viewport does not move (the notch was never a scroll; it became keystrokes), while typing
 *     still works and output still paints — nothing else about the session is wrong; and
 *   - RESIZING RECOVERS IT EVERY TIME, because a program re-asserts its mouse modes on resize, which
 *     use-terminal's own comment already records: "claude re-sends its screen and mouse modes after
 *     every resize". That is a live re-arm, not a replay.
 *
 * ══ WHY THIS IS AN E2E AND NOT SOMETHING CHEAPER ══
 *
 * It needs a real daemon deciding what to replay, a view genuinely torn down and rebuilt from that
 * decision, and a real ConPTY carrying the program's mode sequences. No cheaper layer in this repo
 * can produce any of the three: no test anywhere constructs a real xterm `Terminal`, so the DEC-mode
 * snoop and the replay do not exist on any layer below this one. `decideWheel` itself is already
 * unit-tested (tests/unit/wheel-decision.test.ts) and is NOT what is broken — it is asked the wrong
 * question, and only the wiring can show that.
 *
 * ══ THE FLAVOUR IS LOAD-BEARING — windows-powershell, NOT cmd ══
 *
 * Which DEC private modes survive to the terminal is decided by the SYSTEM ConPTY and varies by
 * Windows build and by what the shell has done to the shared console input mode; the #298 note at
 * platform-windows/src/node-pty-host.ts:127-142 records this. Under `cmd` this fixture's mouse
 * DECSETs never reached xterm's parser at all and the test was vacuous — the anti-vacuity control
 * below is what caught that. Under `windows-powershell` they arrive, which is also the flavour
 * terminal-claude-keys.e2e.ts:472 was driving when it recorded real SGR mouse reports.
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

/**
 * A full-screen program that owns the mouse, in the shape Claude Code has it.
 *
 * Raw mode is taken FIRST, before the negotiation: the console input mode is shared with conhost,
 * and arming the mouse while the fixture's own input was still cooked is a state no real TUI is ever
 * in. Then `CSI ? 1049 h` takes the alternate screen, `CSI ? 1003 h` claims any-event tracking and
 * `CSI ? 1006 h` asks for SGR encoding — the combination measured to actually arm through this
 * machine's ConPTY. (`1002` was tried and comes back DECRQM-reset, so it is not relied on here.)
 *
 * Every byte the program receives is transcribed to a log file, because what reached the PROGRAM is
 * the observable the report is about: the complaint is that the wheel did not scroll, and the reason
 * is that the notch arrived at the program as arrow keys instead.
 */
function writeFixture(root: string, logPath: string): void {
  const lines = [
    "const fs = require('node:fs');",
    `const LOG = ${JSON.stringify(logPath)};`,
    'if (process.stdin.isTTY) process.stdin.setRawMode(true);',
    'process.stdin.resume();',
    "process.stdin.on('data', (b) => {",
    "  fs.appendFileSync(LOG, JSON.stringify(b.toString('latin1')) + '\\n');",
    '});',
    "process.stdout.write('\\x1b[?1049h');",
    "process.stdout.write('\\x1b[?1003h');",
    "process.stdout.write('\\x1b[?1006h');",
    /*
     * Enough output to make the session real, and deliberately NOWHERE NEAR the 64 KiB tail cap:
     * ~4 KiB. If this test ever passes only because the fixture floods, the mechanism above has been
     * misread again.
     */
    "const line = 'f'.repeat(96) + '\\r\\n';",
    'for (let i = 0; i < 40; i++) process.stdout.write(line);',
    "process.stdout.write('MOUSE_ARMED\\r\\n');",
    // Still running, still owning the mouse, when the view is rebuilt — the whole premise.
    'setInterval(() => {}, 1000);',
  ];
  writeFileSync(join(root, 'mouse.js'), lines.join('\n'), 'utf8');
}

async function startTerminal(win: Page, root: string): Promise<string> {
  const pid = await firstPanelId(win);
  await win.getByTestId(`panel-type-select-${pid}`).selectOption('terminal');
  await win.getByTestId('terminal-flavour').selectOption('windows-powershell');
  await win.getByTestId(`panel-type-confirm-${pid}`).click();
  const term = win.getByTestId(`terminal-${pid}`);
  await expect(term).toBeVisible();
  await expect(term).toContainText(basename(root), { timeout: TERMINAL_OUTPUT_TIMEOUT_MS });
  return pid;
}

/** One wheel notch over the middle of the terminal, as a user rolls it. */
async function wheelOver(win: Page, pid: string): Promise<void> {
  const box = await win.getByTestId(`terminal-${pid}`).boundingBox();
  if (box === null) throw new Error(`terminal ${pid} has no box — nothing to roll the wheel over`);
  await win.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await win.mouse.wheel(0, -120);
}

/** How many bytes of replayed tail the CURRENT view painted — 0 when the daemon withheld it. */
const replayedBytes = (win: Page): Promise<number> =>
  win.evaluate(
    () => (window as unknown as { __throngLastReplayBytes?: number }).__throngLastReplayBytes ?? -1,
  );

/** What the PROGRAM has received so far, as escaped bytes, one JSON string per chunk. */
function received(logPath: string): string {
  try {
    return readFileSync(logPath, 'utf8');
  } catch {
    return '';
  }
}

/** `CSI < …` — the SGR mouse-report introducer (mode 1006). Nothing else the program can receive starts this way. */
const MOUSE_REPORT = '\\u001b[<';
/** `CSI A` — cursor up, which is what the `arrows` route synthesises, three times per notch. */
const ARROW_UP = '\\u001b[A';

// One line, deliberately: e2e-budget.test.ts and e2e-tags.test.ts match the declaration with a LINE-based regex.
test('a wheel notch still reaches a full-screen program after its panel has been rebuilt (#290)', { tag: ['@extended', '@terminal', '@reserve:pty'] }, async () => {
  /*
   * SKIPPED BY DEFAULT — #290 is under observation, not scheduled.
   *
   * This test FAILS, on purpose: it is the reproduction, and no fix has been written. The
   * maintainer could not reproduce the defect by hand, so #290 was reclassified `under-observation`
   * with no milestone, and a red test for unscheduled work would make `npm run gate` permanently
   * red — which is how a gate stops meaning anything.
   *
   * It is skipped IN THE BODY rather than with `test.skip(...)` as the declaration, and that is not
   * a style choice. Both guards match a declaration with `/^\s*test\(/`
   * (tests/unit/e2e-budget.test.ts and tests/unit/e2e-tags.test.ts), so `test.skip(` at the front
   * would drop this file out of BOTH counts: the budget total would fall below its own ratchet, and
   * the test would carry no visible tags and therefore run in neither lane.
   *
   * Run it deliberately:
   *
   *     THRONG_I290_REPRO=1 npx playwright test packages/ui/tests/e2e/terminal-mouse-negotiation.e2e.ts --workers=1
   *
   * Un-skip it for good when #290 is scheduled, or when someone reproduces the defect from a real
   * session rather than from this fixture — see the CAVEAT in the header.
   */
  test.skip(
    process.env.THRONG_I290_REPRO !== '1',
    '#290 is under observation; this reproduction fails by design. Set THRONG_I290_REPRO=1 to run it.',
  );

  const root = mkdtempSync(join(tmpdir(), 'throng-mouseneg-'));
  const logPath = join(root, 'received.log');
  writeFixture(root, logPath);

  const win = shared.win;
  await createProject(win, 'MouseNeg', root);
  const pid = await startTerminal(win, root);
  const term = win.getByTestId(`terminal-${pid}`);

  await term.click();
  await win.keyboard.type('node mouse.js', { delay: 10 });
  await win.keyboard.press('Enter');
  await expect(term).toContainText('MOUSE_ARMED', { timeout: TERMINAL_OUTPUT_TIMEOUT_MS });

  /*
   * ══ ANTI-VACUITY CONTROL ══
   *
   * With the panel MOUNTED, the live view parsed the arming, so the wheel must reach the program as
   * a mouse report. Without this the test cannot tell "the wheel was routed correctly" from "the
   * fixture never armed the mouse, so nothing was ever going to be forwarded" — and the latter makes
   * every assertion below pass for free. It is not hypothetical: under the `cmd` flavour this
   * control fails, because that ConPTY path never delivers the mouse modes at all.
   */
  await wheelOver(win, pid);
  await expect
    .poll(() => received(logPath), {
      timeout: TERMINAL_OUTPUT_TIMEOUT_MS,
      message: 'the fixture never armed the mouse — the rest of this test would be vacuous',
    })
    .toContain(MOUSE_REPORT);

  const beforeRebuild = received(logPath).length;

  // ── Tear the view down for real: a second tab unmounts the panel entirely.
  await win.getByTestId('tab-add').click();
  const chips = win.getByTestId('tab-strip').locator('.tab-chip');
  await expect(chips).toHaveCount(2, { timeout: 20_000 });
  await chips.last().click();
  await expect(win.getByTestId(`terminal-${pid}`)).toHaveCount(0, { timeout: 20_000 });

  // ── Back. The view is rebuilt, and for an alt-screen program the daemon replays nothing.
  await chips.first().click();
  const term2 = win.getByTestId(`terminal-${pid}`);
  await expect(term2).toBeVisible({ timeout: 20_000 });
  await term2.click();

  /*
   * The mechanism, asserted where a reader can see it rather than left in the header. This is the
   * fact that makes the defect inevitable rather than incidental, and it is also what distinguishes
   * this from the eviction theory: zero replayed bytes at ~4 KiB of session output is a WITHHELD
   * tail, not an overflowed one.
   */
  expect(
    await replayedBytes(win),
    'the rebuilt view was expected to replay nothing, because the daemon withholds the tail for an ' +
      'alternate-screen program (terminal-service.ts) — if this is non-zero the mechanism has changed',
  ).toBe(0);

  /*
   * ══ THE DEFECT, AS THE PERSON WHO FILED #290 EXPERIENCED IT ══
   *
   * The program never released the mouse and is still running, so a notch must still arrive as a
   * mouse report. What arrives today is `ESC [ A`, three times — the `arrows` route — because the
   * rebuilt view believes there is no mouse reporting while the alternate screen was restored.
   */
  await wheelOver(win, pid);
  await expect
    .poll(() => received(logPath).slice(beforeRebuild), {
      timeout: TERMINAL_OUTPUT_TIMEOUT_MS,
      message: 'the wheel notch after the rebuild reached the program as nothing at all',
    })
    .not.toBe('');

  const afterRebuild = received(logPath).slice(beforeRebuild);

  expect(
    afterRebuild,
    'throng synthesised ARROW KEYS at a program that owns the mouse: the rebuilt view has no source ' +
      'for the mouse-reporting state, because the daemon withholds the replay for an alt-screen ' +
      'program and its attach response carries no mouse field to adopt instead (#290)',
  ).not.toContain(ARROW_UP);

  expect(
    afterRebuild,
    'a wheel notch must still reach a program that owns the mouse after its panel is rebuilt (#290)',
  ).toContain(MOUSE_REPORT);
});
