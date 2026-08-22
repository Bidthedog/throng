import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import {
  openApp,
  createProject as newProject,
  firstPanelId,
  cleanupTemp,
  type AppOptions,
  type OpenApp,
  TERMINAL_OUTPUT_TIMEOUT_MS,
} from './harness.js';

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


// 013 US3 — read a long scrollback from the keyboard alone: page, line, top, bottom, and
// jump between matches. None of these keys may reach the running program (FR-014), and at
// the live bottom ordinary typing must still go straight to it (FR-016).
//
// xterm renders ONLY the visible rows, so "is this text in the terminal?" is exactly the
// question "is the viewport showing it?" — which is what these assertions rely on.

async function newTerminal(win: Page, root: string): Promise<string> {
  const pid = await firstPanelId(win);
  await win.getByTestId(`panel-type-select-${pid}`).selectOption('terminal');
  await win.getByTestId('terminal-flavour').selectOption('cmd');
  const confirm = win.getByTestId(`panel-type-confirm-${pid}`);
  await expect(confirm).toBeEnabled();
  await confirm.click();
  const term = win.getByTestId(`terminal-${pid}`);
  await expect(term).toBeVisible();
  await expect(term).toContainText(basename(root), { timeout: TERMINAL_OUTPUT_TIMEOUT_MS });
  return pid;
}

async function run(win: Page, pid: string, cmd: string, marker: string): Promise<void> {
  await win.getByTestId(`terminal-${pid}`).click();
  await win.keyboard.type(cmd, { delay: 15 });
  await win.keyboard.press('Enter');
  await expect(win.getByTestId(`terminal-${pid}`)).toContainText(marker, {
    timeout: TERMINAL_OUTPUT_TIMEOUT_MS,
  });
}

test('page / line / top / bottom move the viewport — and never reach the program', { tag: ['@extended', '@terminal', '@reserve:pty'] }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'throng-nav-'));
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'Nav', root);
      const pid = await newTerminal(win, root);
      const term = win.getByTestId(`terminal-${pid}`);

      await run(win, pid, 'echo TOP_OF_HISTORY', 'TOP_OF_HISTORY');
      await run(win, pid, 'for /l %i in (1,1,200) do @echo filler %i', 'filler 200');

      // The oldest line has scrolled off the top.
      await expect(term).not.toContainText('TOP_OF_HISTORY');

      // Jump to the very start of the retained scrollback.
      await term.click();
      await win.keyboard.press('Control+Home');
      await expect(term).toContainText('TOP_OF_HISTORY');

      // …and back to the live end.
      await win.keyboard.press('Control+End');
      await expect(term).not.toContainText('TOP_OF_HISTORY');
      await expect(term).toContainText('filler 200');

      // A page up leaves the newest line behind; a page down brings it back.
      await win.keyboard.press('Shift+PageUp');
      await expect(term).not.toContainText('filler 200');
      await win.keyboard.press('Shift+PageDown');
      await expect(term).toContainText('filler 200');

      // Line-wise scrolling nudges the viewport by a single row: enough of them and the
      // newest line goes off screen, and the same number back restores it.
      for (let i = 0; i < 12; i++) await win.keyboard.press('Control+Shift+ArrowUp');
      await expect(term).not.toContainText('filler 200');
      for (let i = 0; i < 12; i++) await win.keyboard.press('Control+Shift+ArrowDown');
      await expect(term).toContainText('filler 200');

      // NOT ONE of those navigation keys was delivered to cmd.exe: nothing was typed at
      // the prompt, so no command was mangled and no error was printed (FR-014 / SC-003).
      await expect(term).not.toContainText('is not recognized');
      await run(win, pid, 'echo NAV_CLEAN', 'NAV_CLEAN');
      await expect(term).not.toContainText('is not recognized');
    });
  } finally {
    cleanupTemp(root);
  }
});

test('at the live bottom, ordinary typing still reaches the program (FR-016)', { tag: ['@extended', '@terminal', '@reserve:pty'] }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'throng-nav-'));
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'NavType', root);
      const pid = await newTerminal(win, root);
      const term = win.getByTestId(`terminal-${pid}`);

      // Scroll away, then come back to the live bottom…
      await run(win, pid, 'for /l %i in (1,1,120) do @echo filler %i', 'filler 120');
      await term.click();
      await win.keyboard.press('Shift+PageUp');
      await win.keyboard.press('Control+End');

      // …and typing goes straight to the shell, uninterrupted by the navigation bindings.
      await run(win, pid, 'echo TYPED_THROUGH', 'TYPED_THROUGH');
    });
  } finally {
    cleanupTemp(root);
  }
});

test('with find open, next/previous jump the viewport between matches (FR-015)', { tag: ['@extended', '@terminal', '@reserve:pty'] }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'throng-nav-'));
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'NavMatch', root);
      const pid = await newTerminal(win, root);
      const term = win.getByTestId(`terminal-${pid}`);

      // One marker near the top, one near the bottom, with a lot of noise between.
      await run(win, pid, 'echo HIT_ONE', 'HIT_ONE');
      await run(win, pid, 'for /l %i in (1,1,200) do @echo filler %i', 'filler 200');
      await run(win, pid, 'echo HIT_TWO', 'HIT_TWO');
      // The top marker is far off-screen now.
      await expect(term).not.toContainText('HIT_ONE');

      await win.keyboard.press('Control+f');

      // Finding a match that lives at the TOP of the scrollback carries the viewport all
      // the way up to it — the match, not the live end, is what the view follows.
      await win.getByTestId('find-input').fill('HIT_ONE');
      await expect(win.getByTestId('find-count')).toHaveText(/^\d+ of \d+$/, { timeout: 10000 });
      await expect(term).toContainText('HIT_ONE');
      await expect(term).not.toContainText('filler 200');

      // Stepping between its matches (F3 / Shift+F3 — the same command as find-next, acting
      // in the terminal, FR-015) keeps the viewport on them.
      await win.keyboard.press('F3');
      await expect(win.getByTestId('find-count')).toHaveText(/^\d+ of \d+$/);
      await expect(term).toContainText('HIT_ONE');
      await win.keyboard.press('Shift+F3');
      await expect(term).toContainText('HIT_ONE');

      // …and a match at the far end carries it back down there.
      await win.getByTestId('find-input').fill('HIT_TWO');
      await expect(term).toContainText('HIT_TWO');
      await expect(term).not.toContainText('HIT_ONE');
    });
  } finally {
    cleanupTemp(root);
  }
});

test('scrollback still scrolls after a project switch and back (#290)', { tag: ['@extended', '@terminal', '@reserve:pty'] }, async () => {
  /*
   * #290 — "Terminal scrolling dies after a project switch until the window is resized."
   *
   * Every scroll route dies at once: wheel, PageUp/PageDown, and Ctrl+Home/Ctrl+End. The terminal
   * is otherwise alive — it accepts input and paints new output — so it is specifically the
   * VIEWPORT that will not move. A window resize recovers it every time; `Ctrl+F5`
   * (`terminal.redraw`) does not, and the reporter flagged that second fact as the one that
   * identifies the fault.
   *
   * They are right, and reading xterm 6.0.0 says why. `Terminal.refresh()` is
   * `this._renderService?.refreshRows(e,t)` and nothing else, while the viewport's scroll area is
   * synced from exactly two places: `_bufferService.onResize` and the input handler's `onScroll`.
   * So a redraw cannot restore it, a resize always can, and more output sometimes does — which is
   * the reporter's three observations, in order. `Terminal.resize()` also early-returns when the
   * dimensions are unchanged, so the same-grid branch in `use-terminal.ts` has no public route to
   * a sync at all.
   *
   * WHY THIS TEST IS AT E2E, WHICH IS NOT THE CHEAP ANSWER. The defect is a scroll area computed
   * from real layout during a real render. jsdom has no layout, so a component test would assert
   * against dimensions that are zero whatever the code does — it would pass with the bug present,
   * which is the worst outcome a cheaper layer can produce. This is the constitution's E2E reserve
   * as written: compositing and hardware rendering.
   *
   * The control assertion before the switch is deliberate. Without it a red here could equally mean
   * "the keys never worked in this file", and the whole value of the test is telling those apart.
   */
  const rootA = mkdtempSync(join(tmpdir(), 'throng-nav-a-'));
  const rootB = mkdtempSync(join(tmpdir(), 'throng-nav-b-'));
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'NavSwitchA', rootA);
      const nameA = (
        await win.locator('.project-item[data-active="true"]').evaluate((el) => el.textContent ?? '')
      ).trim();
      const pid = await newTerminal(win, rootA);

      await run(win, pid, 'echo TOP_OF_HISTORY', 'TOP_OF_HISTORY');
      await run(win, pid, 'for /l %i in (1,1,200) do @echo filler %i', 'filler 200');
      await expect(win.getByTestId(`terminal-${pid}`)).not.toContainText('TOP_OF_HISTORY');

      // CONTROL: the viewport moves before any project switch, so a failure after one is about
      // the switch and not about these keys.
      await win.getByTestId(`terminal-${pid}`).click();
      await win.keyboard.press('Control+Home');
      await expect(win.getByTestId(`terminal-${pid}`)).toContainText('TOP_OF_HISTORY');
      await win.keyboard.press('Control+End');
      await expect(win.getByTestId(`terminal-${pid}`)).toContainText('filler 200');

      // Away to another project and back. Creating one opens it, which unmounts A's panels;
      // clicking A's row remounts them against the session the daemon still holds.
      await createProject(win, 'NavSwitchB', rootB);
      const nameB = (
        await win.locator('.project-item[data-active="true"]').evaluate((el) => el.textContent ?? '')
      ).trim();
      await win.locator('.project-item').filter({ hasText: nameA }).first().click();
      await expect(win.locator('.project-item[data-active="true"]')).toContainText(nameA);

      // The terminal is back and still holds its history…
      const back = await firstPanelId(win);
      const term2 = win.getByTestId(`terminal-${back}`);
      await expect(term2).toBeVisible();
      await expect(term2).toContainText('filler 200', { timeout: TERMINAL_OUTPUT_TIMEOUT_MS });

      // …and the viewport must still move. This is the assertion #290 breaks: the panel paints,
      // accepts input and shows live output, while every scroll route does nothing at all.
      await term2.click();
      await win.keyboard.press('Control+Home');
      await expect(term2).toContainText('TOP_OF_HISTORY');
      await win.keyboard.press('Control+End');
      await expect(term2).toContainText('filler 200');

      /*
       * SEVERAL MORE ROUND TRIPS, because one was not enough to reproduce it.
       *
       * The report opens with "After throng has been running for a while", and the recovery it
       * describes is inconsistent — sometimes more output frees it, sometimes an arrow key does.
       * That is the shape of a race, and a race needs its window hit rather than merely approached.
       * Each switch is a fresh unmount and remount of the panel, which is the moment the viewport
       * either gets its scroll area or does not, so repeating the trip is sampling the window a
       * handful of times instead of once.
       *
       * This is a SCENARIO, not a statistical re-run: the same assertion, deterministic in shape,
       * inside one test. It is not "run the suite until it goes red", which would be gambling and
       * would prove nothing when it eventually did.
       *
       * ══ HOW A GREEN HERE MAY BE READ, AND HOW IT MAY NOT ══
       *
       * This test passing does NOT mean #290 is absent. It means six samples did not hit it. The
       * difference matters to whoever reads this next: "we tested it and it was fine" would say the
       * area was investigated and found clear, and that is the opposite of what is known. What is
       * known is that the defect is real, reported with recovery behaviour consistent enough to
       * identify the mechanism, and that these particular conditions do not trigger it.
       *
       * A RED on any trip is a different matter entirely — that is a reproduction, and the fix
       * follows from it directly.
       */
      for (let trip = 0; trip < 5; trip++) {
        await win.locator('.project-item').filter({ hasText: nameB }).first().click();
        await expect(win.locator('.project-item[data-active="true"]')).toContainText(nameB);
        await win.locator('.project-item').filter({ hasText: nameA }).first().click();
        await expect(win.locator('.project-item[data-active="true"]')).toContainText(nameA);

        const pidN = await firstPanelId(win);
        const termN = win.getByTestId(`terminal-${pidN}`);
        await expect(termN).toBeVisible();
        await expect(termN).toContainText('filler 200', { timeout: TERMINAL_OUTPUT_TIMEOUT_MS });

        await termN.click();
        await win.keyboard.press('Control+Home');
        await expect(termN, `scroll died on round trip ${trip + 1} (#290)`).toContainText(
          'TOP_OF_HISTORY',
        );
        await win.keyboard.press('Control+End');
        await expect(termN).toContainText('filler 200');
      }
    });
  } finally {
    cleanupTemp(rootA);
    cleanupTemp(rootB);
  }
});
