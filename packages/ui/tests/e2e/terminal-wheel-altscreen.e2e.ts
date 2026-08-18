import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { runApp, createProject, firstPanelId, cleanupTemp, quiesced} from './harness.js';
import { quiesceSampler } from './quiesce-sampler.js';
import { writeAltScreenProgram, makeCmdTerminal, runAltScreenProgram } from './altscreen-fixture.js';
import { skipIfElevated } from './admin.js';

/**
 * 028 T002 / T023 (#187) — where a wheel notch goes.
 *
 * The reported bug is that the wheel does NOTHING over a Claude Code session. It is not a lost
 * event: xterm scrolls the viewport on the normal buffer, the alternate screen has no scrollback to
 * scroll, and xterm only forwards notches as arrow keys once a program enables DEC private mode
 * 1007 — which Claude Code does not. So the gesture arrives and is silently dropped.
 *
 * throng decides explicitly instead, and the decision has one genuinely dangerous branch: synthesised
 * arrow keys must NEVER reach the normal buffer, where they would type into the user's command line.
 * That is why the routing is a pure function pinned by unit tests, and why this drives the real app
 * to prove the wiring matches.
 */

/** The bytes the fixture recorded, as one string — it logs each chunk as a JSON array of codes. */
function keysReceived(root: string): string {
  try {
    return readFileSync(join(root, 'keys.log'), 'utf8');
  } catch {
    return '';
  }
}

/** Arrow keys arrive as `ESC [ A` / `ESC [ B` — 27, 91, then 65 or 66. */
function arrowCount(log: string): number {
  return (log.match(/27,91,(65|66)/g) ?? []).length;
}

/**
 * The arrow count once the fixture's log has stopped changing.
 *
 * Two identical reads in a row, because the only thing that distinguishes "the program received
 * nothing more" from "the write has not landed yet" is time passing without a change. Built on the
 * same {@link quiesceSampler} `quiesced()` uses for a redrawing DOM — this is the identical
 * condition applied to a file instead of a Locator's textContent.
 */
async function settledArrowCount(root: string): Promise<number> {
  const sampler = quiesceSampler();
  await expect
    .poll(() => sampler.sample(String(arrowCount(keysReceived(root)))), {
      timeout: 8_000,
      message: 'the fixture log never stopped changing, so there is no settled arrow count to read',
      intervals: [300],
    })
    .toBe(true);
  return Number(sampler.settled());
}

async function wheelOver(win: Page, panelId: string, deltaY: number, ctrl = false): Promise<void> {
  const term = win.getByTestId(`terminal-${panelId}`);
  const box = await term.boundingBox();
  if (!box) throw new Error('terminal has no box');
  await win.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  if (ctrl) await win.keyboard.down('Control');
  await win.mouse.wheel(0, deltaY);
  if (ctrl) await win.keyboard.up('Control');
  // Let the gesture's effect on the terminal (a repaint, a scroll, a zoom reflow) actually land and
  // settle before the caller looks at anything — the same redrawing-terminal condition quiesced()
  // exists for, applicable here regardless of which of the three effects this particular wheel
  // produced.
  await quiesced(term, { what: 'terminal after wheel gesture' });
}

test('a wheel notch moves an alternate-screen program that never asked for the mouse', { tag: ['@extended', '@terminal'] }, async () => {
  // Measured on CI run 30943045917: passes without admin rights, fails with them. An elevated
  // daemon routes terminals through the de-elevated agent, a different process tree these
  // assertions do not describe — the condition this guard exists for.
  skipIfElevated();
  test.setTimeout(120_000);
  const root = mkdtempSync(join(tmpdir(), 'throng-wheel-alt-'));
  writeAltScreenProgram(root, { rows: 5 });
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'WheelAlt', root);
      const pid = await firstPanelId(win);
      await makeCmdTerminal(win, pid, basename(root));
      await runAltScreenProgram(win, pid);

      await wheelOver(win, pid, -300); // scroll up

      /*
       * Three arrow presses per notch — the conventional scroll step, and what xterm's own alternate
       * scroll sends. The bytes are exactly what a real arrow key produces, so the program cannot
       * tell this from a keyboard (FR-035c). Before this, the gesture reached the program as nothing
       * at all.
       */
      await expect
        .poll(() => arrowCount(keysReceived(root)), { timeout: 15_000 })
        .toBeGreaterThanOrEqual(3);
    });
  } finally {
    cleanupTemp(root);
  }
});

test('a wheel at a SHELL prompt types nothing — it scrolls the viewport', { tag: ['@extended', '@terminal'] }, async () => {
  test.setTimeout(120_000);
  const root = mkdtempSync(join(tmpdir(), 'throng-wheel-shell-'));
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'WheelShell', root);
      const pid = await firstPanelId(win);
      await makeCmdTerminal(win, pid, basename(root));
      const term = win.getByTestId(`terminal-${pid}`);

      // Fill the buffer so there is something to scroll, then leave a marker on the command line.
      await term.click();
      await win.keyboard.type('for /L %i in (1,1,80) do @echo WHEELFILL%i');
      await win.keyboard.press('Enter');
      await expect(term).toContainText('WHEELFILL80', { timeout: 30_000 });
      await win.keyboard.type('echo UNTOUCHED');
      // Wait for the typed marker to actually echo into the terminal and settle before scrolling —
      // the same redrawing-terminal condition quiesced() exists for.
      await quiesced(term, { what: 'terminal after typing the UNTOUCHED marker' });

      await wheelOver(win, pid, -400);
      await wheelOver(win, pid, 400);

      /*
       * The dangerous branch. A wheel that synthesised arrow keys here would walk the cursor through
       * the user's command line — or, with history bound to the arrows, replace it outright. The
       * line must come back exactly as typed.
       */
      await win.keyboard.press('Enter');
      await expect(term).toContainText('UNTOUCHED', { timeout: 15_000 });
      const rows = await win.evaluate((id) => {
        const el = document.querySelector(`[data-testid="terminal-${id}"]`);
        return [...(el?.querySelectorAll('.xterm-rows > div') ?? [])]
          .map((r) => r.textContent ?? '')
          .join(String.fromCharCode(10));
      }, pid);
      expect(rows, 'the wheel typed into the command line').not.toMatch(/UNTOUCHED[^\s]/);
    });
  } finally {
    cleanupTemp(root);
  }
});

test('Ctrl+wheel is left to zoom, not sent to the program', { tag: ['@extended', '@terminal'] }, async () => {
  test.setTimeout(120_000);
  const root = mkdtempSync(join(tmpdir(), 'throng-wheel-zoom-'));
  writeAltScreenProgram(root, { rows: 5 });
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'WheelZoom', root);
      const pid = await firstPanelId(win);
      await makeCmdTerminal(win, pid, basename(root));
      await runAltScreenProgram(win, pid);

      /*
       * Wait for the log to STOP GROWING before taking the baseline.
       *
       * The stand-in writes `keys.log` asynchronously, so anything it received while starting can
       * land after a single instantaneous read — and the count then grows with no Ctrl+wheel
       * involved at all, failing an assertion about a gesture that behaved perfectly. Measured as
       * this test failing and flaking at three workers and at six.
       */
      const before = await settledArrowCount(root);
      await wheelOver(win, pid, -300, true);
      await wheelOver(win, pid, 300, true);

      // Zoom belongs to the window-level binding. A Ctrl+wheel that also reached the program would
      // scroll it while resizing the text — two responses to one gesture (FR-033).
      expect(arrowCount(keysReceived(root)), 'Ctrl+wheel reached the program').toBe(before);
    });
  } finally {
    cleanupTemp(root);
  }
});
