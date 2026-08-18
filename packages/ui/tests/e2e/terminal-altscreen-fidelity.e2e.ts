import { basename } from 'node:path';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import {
  openApp,
  createProject as newProject,
  firstPanelId,
  panelIds,
  cleanupTemp,
  quiesced,
  type AppOptions,
  type OpenApp,
} from './harness.js';
import { ALT_MARKER, makeCmdTerminal, runAltScreenProgram, writeAltScreenProgram } from './altscreen-fixture.js';
import { skipIfElevated } from './admin.js';

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
 * 028 follow-up — screen fidelity around a program that repaints only when asked. Reproductions
 * first, per the spec's own rule (FR-001/FR-006): no fix is designed against a mechanism measurement
 * has not confirmed.
 *
 * Two of these need the alternate screen; the third (1b) deliberately does not, because the guard it
 * exercises had nothing to save it on the normal buffer.
 *
 * The stand-in program repaints ONLY on a window change, exactly as a real one does. That is what
 * makes these tests able to fail at all — a program that repainted spontaneously would hide every
 * one of these faults behind its own next frame.
 */

/**
 * DEFECT 1 — clicking into a terminal running a full-screen program wipes its screen down to one
 * line, and only a wheel-up (which sends the program arrow keys, making it redraw) brings it back.
 */
test('clicking into a terminal on the alternate screen does not wipe its screen', { tag: ['@extended', '@terminal'] }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'throng-altclick-'));
  const marker = basename(root);
  writeAltScreenProgram(root);
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'AltClick', root);
      const pid = await firstPanelId(win);
      await makeCmdTerminal(win, pid, marker);
      await runAltScreenProgram(win, pid);
      const term = win.getByTestId(`terminal-${pid}`);

      // Click elsewhere and back — the reported gesture.
      await win.getByTestId('tab-strip').click();
      await term.click();
      // Wait for whatever the click does to the screen to actually happen and settle — a redrawing
      // terminal is exactly what quiesced() exists for, and it keeps waiting if the wipe this test
      // guards against arrives late rather than resolving before it has had its chance.
      const settledText = await quiesced(term, { what: 'terminal after click back' });

      // Every painted row must still be there. The program has not been asked to redraw, so this
      // is a pure question about what throng did to the screen it was already showing.
      for (let i = 1; i <= 5; i += 1) {
        expect(settledText).toContain(`${ALT_MARKER}${i}`);
      }
    });
  } finally {
    cleanupTemp(root);
  }
});

/**
 * DEFECT 2 — switching tabs flashes three or four times before the terminal settles.
 *
 * Each flash is a full repaint. The measurable cause is how many times the screen is rewritten on a
 * single switch: the daemon replays a byte tail (which for an alt-screen program is garbage that
 * will be overwritten anyway), and the repaint nudge then makes the program paint twice more.
 *
 * The tail is the removable one: a program on the alternate screen has no scrollback worth
 * replaying, and painting it is a flash the user sees for nothing.
 */
test('re-attaching to an alternate-screen program replays no scrollback', { tag: ['@extended', '@terminal'] }, async () => {
  // Measured on CI run 30943045917: passes without admin rights, fails with them. An elevated
  // daemon routes terminals through the de-elevated agent, a different process tree these
  // assertions do not describe — the condition this guard exists for.
  skipIfElevated();
  const root = mkdtempSync(join(tmpdir(), 'throng-altflash-'));
  const marker = basename(root);
  writeAltScreenProgram(root);
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'AltFlash', root);
      const p1 = await firstPanelId(win);
      await makeCmdTerminal(win, p1, marker);
      await runAltScreenProgram(win, p1);

      // A second tab, so switching away really does unmount the first.
      await win.getByTestId('tab-add').click();
      const p2 = (await panelIds(win))[0];
      await makeCmdTerminal(win, p2, marker);

      const tab1 = win.getByTestId('tab-strip').locator('.tab-chip').first();
      await tab1.click();
      await expect(win.getByTestId(`terminal-${p1}`)).toContainText(`${ALT_MARKER}1`, {
        timeout: 25000,
      });

      // The screen is correct WITHOUT a replayed tail having been painted first. Asserted at the
      // seam rather than by watching for flicker, which no test can see.
      const replayed = await win.evaluate(
        () =>
          (window as unknown as { __throngLastReplayBytes?: number }).__throngLastReplayBytes ?? -1,
      );
      expect(replayed).toBe(0);
    });
  } finally {
    cleanupTemp(root);
  }
});

/**
 * DEFECT 1b — "the rendering messes up again, seems to only show the last line".
 *
 * `term.clear()` keeps ONLY the cursor's row, which is exactly what "only the last line" looks like.
 * It fires when `shouldDropScrollback` recognises a `cls`: cursor-home followed by an erase per row.
 *
 * A resize repaint has that identical shape, which the code already knows — it arms `resizedAt` in
 * `conformGrid` so a repaint arriving just after a grid change is not mistaken for a clear. But the
 * 028 repaint nudge deliberately publishes NO grid event (no view's size changed), so nothing arms
 * that window, and the redraw it provokes can be read as a screen clear.
 *
 * This drives the shape directly: put real scrollback above a program that repaints exactly like a
 * `cls` when the window changes, then ask for a redraw. The scrollback must survive.
 */
test('a requested redraw is not mistaken for a screen clear', { tag: ['@extended', '@terminal'] }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'throng-redrawclear-'));
  const marker = basename(root);
  // A NORMAL-buffer program: no alt screen, so the existing alt-screen guard cannot save it.
  writeFileSync(
    join(root, 'normalpaint.cjs'),
    `
const out = process.stdout;
function paint() {
  out.write('\u001b[H');
  const rows = process.stdout.rows || 24;
  for (let i = 0; i < rows; i += 1) out.write('\u001b[2K\u001b[' + (i + 1) + ';1H');
  out.write('\u001b[1;1HREPAINTED');
}
process.stdout.on('resize', paint);
process.stdin.resume();
`,
    'utf8',
  );
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'RedrawClear', root);
      const pid = await firstPanelId(win);
      await makeCmdTerminal(win, pid, marker);
      const term = win.getByTestId(`terminal-${pid}`);

      // Real scrollback the user would not expect to lose.
      await term.click();
      await win.keyboard.type('echo KEEPLINE-A && echo KEEPLINE-B && node normalpaint.cjs');
      await win.keyboard.press('Enter');
      await expect(term).toContainText('KEEPLINE-B', { timeout: 25000 });

      // Ask for a redraw — the program repaints in exactly the shape of a `cls`.
      await win.keyboard.press('Control+F5');
      // Wait for the requested redraw to actually land and settle before reading anything — the
      // same redrawing-terminal condition quiesced() exists for.
      const settledText = await quiesced(term, { what: 'terminal after requested redraw' });

      // The scrollback must survive. If it does not, the redraw was mistaken for a screen clear and
      // `term.clear()` threw everything above the cursor away.
      expect(settledText).toContain('KEEPLINE-A');
      expect(settledText).toContain('KEEPLINE-B');
    });
  } finally {
    cleanupTemp(root);
  }
});
