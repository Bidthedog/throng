import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { openApp, createProject as newProject, firstPanelId, cleanupTemp, quiesced, type AppOptions, type OpenApp } from './harness.js';
import { writeAltScreenProgram, makeShellTerminal, runAltScreenProgram } from './altscreen-fixture.js';
import { skipIfElevated } from './admin.js';

/*
 * ONE app for this file, not one per test: none of these tests seeds state before launch, so each launch
 * bought nothing (see `launch-sharing.md`). `runApp` runs the body against the shared window and refuses
 * options rather than ignoring them; `createProject` appends a counter because a shared app accumulates
 * projects and duplicate names make `.project-item` ambiguous. Serial mode: shared window, shared database;
 * a failure skips the rest rather than running them against whatever state it left.
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
  fn: (app: OpenApp['app'], win: OpenApp['win']) => Promise<void>,
  opts?: AppOptions,
): Promise<void> => {
  if (opts) throw new Error('this file shares one app; a test needing launch options must use runOwnApp');
  return fn(shared.app, shared.win);
};

let projectSeq = 0;
const createProject = (win: OpenApp['win'], name: string, root: string): Promise<void> =>
  newProject(win, `${name}-${(projectSeq += 1)}`, root);

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

async function wheelOver(win: Page, panelId: string, deltaY: number): Promise<void> {
  const term = win.getByTestId(`terminal-${panelId}`);
  const box = await term.boundingBox();
  if (!box) throw new Error('terminal has no box');
  await win.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await win.mouse.wheel(0, deltaY);
  // Let the gesture's effect on the terminal (a repaint, a scroll, a zoom reflow) actually land and
  // settle before the caller looks at anything — the same redrawing-terminal condition quiesced()
  // exists for, applicable here regardless of which of the three effects this particular wheel
  // produced.
  await quiesced(term, { what: 'terminal after wheel gesture' });
}

test('a wheel notch moves an alternate-screen program that never asked for the mouse', { tag: ['@extended', '@terminal', '@reserve:pty'] }, async () => {
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
      await makeShellTerminal(win, pid, basename(root));
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

test('a wheel at a SHELL prompt types nothing — it scrolls the viewport', { tag: ['@extended', '@terminal', '@reserve:pty'] }, async () => {
  test.setTimeout(120_000);
  const root = mkdtempSync(join(tmpdir(), 'throng-wheel-shell-'));
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'WheelShell', root);
      const pid = await firstPanelId(win);
      await makeShellTerminal(win, pid, basename(root));
      const term = win.getByTestId(`terminal-${pid}`);

      // Fill the buffer so there is something to scroll, then leave a marker on the command line.
      await term.click();
      await win.keyboard.type(
        process.platform === 'win32' ? 'for /L %i in (1,1,80) do @echo WHEELFILL%i' : 'for i in $(seq 1 80); do echo WHEELFILL$i; done',
      );
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

