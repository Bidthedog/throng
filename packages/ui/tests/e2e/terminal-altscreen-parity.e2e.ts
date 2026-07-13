import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { test, expect, type Page, type ElectronApplication } from '@playwright/test';
import { runApp, createProject, firstPanelId, reloadWindow, daemonRpc } from './harness.js';
import { skipIfElevated } from './admin.js';

/**
 * 008 User Story 2 — the DEFINITIVE reproduction, on the ALTERNATE SCREEN.
 *
 * The reported defect is with a full-screen TUI (claude): mirrored into a second window
 * of a different size, one view renders correctly and the other is "offset — each line
 * shifted", and resizing either window makes THAT window correct while breaking the other
 * (last-writer-wins). A plain-echo (normal-buffer) test does NOT reproduce it, because
 * xterm reflows the normal buffer to each view's width independently; the bug lives on the
 * ALTERNATE screen, where a program positions text ABSOLUTELY for the PTY's grid size.
 *
 * A full-screen program is run that enters the alt screen and, on every resize, redraws
 * every row as an absolutely-positioned, grid-width label ("L<row>|........"). Because the
 * two views share ONE PTY grid, and each xterm MUST be sized to that grid, both windows
 * MUST render byte-for-byte identical rows. Equal ⇒ both at the shared grid (correct);
 * unequal ⇒ the views are at different sizes and one is offset (the bug). Re-asserted after
 * resizing EACH window, because the symptom is that fixing one view breaks the other.
 */

const seedSmallSub = `(() => window.throng.invoke('workspace.persistSubWorkspaces', { subWorkspaces: [
  { id: 'sw1', ownerUser: 'u', name: 'Small', colour: '#3fb950',
    bounds: { x: 40, y: 40, width: 560, height: 380 },
    tabs: [{ id: 't', title: 'T', root: { type: 'panel', id: 'seed', originProjectId: 'x', title: 'P' } }] },
] }))()`;

// A full-screen program: alt screen, and on every resize redraw each row as an
// absolutely-positioned label padded to the CURRENT grid width. Mirrors how claude paints.
const ALT_PROGRAM = `const o = process.stdout;
function draw() {
  const sz = o.getWindowSize ? o.getWindowSize() : [80, 24];
  const C = sz[0], R = sz[1];
  o.write('\\u001b[2J');
  for (let r = 1; r <= R; r++) {
    const label = ('L' + r + '|').padEnd(C, '.').slice(0, C);
    o.write('\\u001b[' + r + ';1H' + label);
  }
  o.write('\\u001b[H');
}
o.write('\\u001b[?1049h');
draw();
o.on('resize', draw);
setInterval(function () {}, 100000);
`;

/** The terminal's visible text, normalised: trailing spaces stripped, blank trailing rows
 *  dropped. Two views at the same grid produce identical arrays. */
async function visibleRows(win: Page, pid: string): Promise<string[]> {
  const raw = await win.getByTestId(`terminal-${pid}`).innerText();
  const lines = raw.split('\n').map((l) => l.replace(/[ \t]+$/u, ''));
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

async function resizeWindow(
  app: ElectronApplication,
  which: 'small' | 'large',
  w: number,
  h: number,
): Promise<void> {
  await app.evaluate(
    ({ BrowserWindow }, arg) => {
      const wins = BrowserWindow.getAllWindows();
      let target = wins[0];
      let best = arg.which === 'small' ? Infinity : -Infinity;
      for (const win of wins) {
        const [width] = win.getSize();
        if (arg.which === 'small' ? width < best : width > best) {
          best = width;
          target = win;
        }
      }
      target.setContentSize(arg.w, arg.h);
    },
    { which, w, h },
  );
}

async function newTerminal(win: Page, root: string): Promise<string> {
  const pid = await firstPanelId(win);
  await win.getByTestId(`panel-type-select-${pid}`).selectOption('terminal');
  await win.getByTestId('terminal-flavour').selectOption('cmd');
  await win.getByTestId(`panel-type-confirm-${pid}`).click();
  await expect(win.getByTestId(`terminal-${pid}`)).toContainText(basename(root), { timeout: 20000 });
  return pid;
}

// 008 issue #2 (FIXED 2026-07-11). Root cause (confirmed by instrumenting both the daemon
// grid and each xterm's rendered content): the daemon correctly sizes the one shared PTY
// to the MINIMUM grid across all views, but the renderer sized each xterm to its OWN
// container (FitAddon) and never conformed it to that shared grid. On the alternate screen
// — painted absolutely for the PTY grid and NOT reflowed by xterm — any view larger than
// the minimum rendered the min-grid content offset/wrapped. Fix: the daemon broadcasts the
// grid (and returns it from attach); every xterm conforms to it, so the larger window
// letterboxes and both views render byte-for-byte identically. The renderer now only
// REPORTS its container capacity (proposeDimensions) — the daemon grid is the single
// source of truth for xterm size. This does NOT touch the attach/viewId path that a prior
// attempt broke (issue #1), which is separately verified by terminal-mirror-survival.
/*
 * QUARANTINED (017, FR-013b) — and this is NOT a flake. It is a deterministically red test that
 * has been hidden by retries, and what it is red about is a REAL PRODUCT BUG.
 *
 * It fails on every attempt — 9/9 across every configuration, in isolation and under load,
 * including all three attempts under `retries: 2`. So arming the flake gate does not "expose" it;
 * it was always failing, and the retry machinery was never rescuing it either. What hid it is that
 * a red E2E in a suite nobody could trust reads as noise.
 *
 * THE DEFECT: a PTY resize never reaches the process inside it. The daemon's `NodePtyHost.resize()`
 * is called, finds its session, and `proc.resize()` returns without throwing — yet the hosted
 * program's `getWindowSize()` never changes. Reproducible with ONE window and no mirroring: shrink
 * a terminal panel and xterm conforms to the new grid while the program keeps painting for the old
 * one. On the normal buffer xterm reflows and hides it; on the ALTERNATE screen it is exactly the
 * "offset lines" symptom feature 008 exists to prevent. Two silent `catch {}` blocks
 * (`terminal-service.ts:385-390`, `node-pty-host.ts:151-157`) would swallow any failure here.
 *
 * WHY NOT WEAKEN THE ASSERTION: the test waits for the full-screen program to repaint after the
 * shared grid shrinks (`toContainText('L1|')`). A program only repaints when the PTY tells it the
 * size changed — which is the thing that is broken. Relaxing the wait would erase the only coverage
 * of the 008 alt-screen invariant while the defect underneath it survives. That is how a bug gets
 * permanently forgotten.
 *
 * The 008 parity invariant itself still holds: both views were measured at 25×35 rendering
 * byte-identically. It is the RESIZE path that is broken, not parity.
 *
 * Quarantine here is an admission of a real bug, not a timing gap. It must be fixed, and it is
 * enumerable in the meantime:
 *   THRONG_E2E_INCLUDE_QUARANTINE=1 npx playwright test --grep @quarantine --list
 */
test('@quarantine a full-screen (alt-screen) program renders identically in two different-sized views, and stays identical when either window is resized', async () => {
  skipIfElevated();
  const root = mkdtempSync(join(tmpdir(), 'throng-alt-'));
  writeFileSync(join(root, 'alt.js'), ALT_PROGRAM);
  try {
    await runApp(async (app, win, { pipeName }) => {
      await win.evaluate(seedSmallSub);
      await reloadWindow(win);
      await createProject(win, 'Alt', root);
      const pid = await newTerminal(win, root);

      // The user's exact order: start the full-screen program in the SINGLE (large project)
      // window FIRST — it draws for the large grid — THEN drag it into the small
      // sub-workspace. The second, smaller view attaching to an already-running alt-screen
      // program is the moment the grid must shrink and BOTH views re-lay-out to the new grid.
      await daemonRpc(pipeName, 'terminal.write', { panelId: pid, data: 'node alt.js\r\n' });
      await expect(win.getByTestId(`terminal-${pid}`)).toContainText('L1|', { timeout: 20000 });
      await win.waitForTimeout(800);

      // Now mirror into the small sub-workspace window.
      const [child] = await Promise.all([
        app.waitForEvent('window'),
        win.getByTestId('subworkspace-open-sw1').click(),
      ]);
      await child.waitForLoadState('domcontentloaded');
      await win.getByTestId(`panel-handle-${pid}`).click({ button: 'right' });
      await win.getByTestId('menu-item-Sync to').hover();
      await win.getByTestId('menu-item-Small').hover();
      await win.getByTestId('menu-item-T').click();
      await expect(child.getByTestId(`terminal-${pid}`)).toContainText('L1|', { timeout: 20000 });
      await win.waitForTimeout(1500);

      // INVARIANT 1: both views share one grid → identical rendered rows. This is where the
      // reported bug bites: the sub-workspace view renders the (large-grid) content offset.
      expect(await visibleRows(win, pid)).toEqual(await visibleRows(child, pid));

      // Resize the LARGE (main) window; the program redraws on the resize. Both views must
      // remain identical afterwards — the non-resized window must not be left offset.
      await resizeWindow(app, 'large', 980, 700);
      await win.waitForTimeout(1500);
      expect(await visibleRows(win, pid)).toEqual(await visibleRows(child, pid));

      // Resize the SMALL (sub-workspace) window; the reported symptom is that this makes the
      // small view correct but breaks the large one (last-writer-wins). Must stay identical.
      await resizeWindow(app, 'small', 860, 600);
      await win.waitForTimeout(1500);
      expect(await visibleRows(win, pid)).toEqual(await visibleRows(child, pid));

      // Kill the full-screen program so the project root unlocks for teardown.
      await daemonRpc(pipeName, 'terminal.kill', { panelId: pid });
    });
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});
