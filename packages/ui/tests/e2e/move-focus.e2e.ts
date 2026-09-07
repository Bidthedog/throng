import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { TERMINAL_OUTPUT_TIMEOUT_MS, addPanels, cleanupTemp, commitPanelRename, createProject as newProject, firstPanelId, openApp, panelIds, type AppOptions, type OpenApp } from './harness.js';

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


// 012 US3 (FR-015, SC-008/008a): directional + cyclic keyboard focus movement over
// the active tab's split tree, in stable layout order, staying put at the edge.

async function expectActive(win: Page, pid: string): Promise<void> {
  await expect(win.getByTestId(`panel-${pid}`)).toHaveAttribute('data-active', 'true');
  await expect(win.locator('.panel-box--active')).toHaveCount(1);
}

/**
 * FR-015 — the directional chord reaches the mover, and the move is RENDERED.
 *
 * ── WHAT LEFT (035 T039) ──
 *
 * This walked p1 → p2 → p3, pressed again at the right edge, walked back to p1, pressed again at the
 * left edge, and then pressed Up in a purely horizontal layout: eight keypresses, each about a second,
 * re-deriving a pure function through an Electron window.
 *
 * Every one of those cases is in `packages/core/tests/unit/focus-move.test.ts` — the directional
 * neighbour, the edge returning null with no wrap, the neighbour that overlaps on the perpendicular
 * axis, and a stable depth-first order independent of focus history.
 *
 * ONE witness is what is left, and it is the only thing the unit tests cannot say: that
 * `Control+Alt+ArrowRight` is bound, is delivered to the window, reaches the mover, and that the
 * panel it names is the one that renders as active. A second press would prove nothing the first
 * did not.
 */
test('the directional chord reaches the mover and the new panel renders active (FR-015)', { tag: ['@extended', '@window'] }, async () => {
  await runApp(async (_app, win) => {
    await createProject(win, 'MoveFocus', 'C:/c/mf');
    await addPanels(win, 2); // a row of three: p1 | p2 | p3
    await expect(win.locator('.panel-box')).toHaveCount(3);
    const [p1, p2] = await panelIds(win);

    await win.getByTestId(`panel-${p1}`).click();
    await expectActive(win, p1);

    await win.keyboard.press('Control+Alt+ArrowRight');
    await expectActive(win, p2);
  });
});

/**
 * SC-008a — the cycle chord reaches the ring, and the move is RENDERED.
 *
 * ── WHAT LEFT (035 T039) ──
 *
 * This pressed forward three times to prove the wrap, then backward twice to prove the reverse: five
 * keypresses for a ring whose behaviour is `focus-move.test.ts`'s ("wraps forward and backward
 * through the ring", and "forward then the same count backward returns to the start").
 *
 * Both chords are kept because they are two different bindings — `Control+Backquote` and
 * `Control+Shift+Backquote`, the second of which produces a different key entirely — and a binding
 * that is not delivered is exactly what a unit test cannot see. The WRAP is not re-proved here.
 */
test('both cycle chords reach the ring and the new panel renders active (SC-008a)', { tag: ['@extended', '@window'] }, async () => {
  await runApp(async (_app, win) => {
    await createProject(win, 'CycleFocus', 'C:/c/cf');
    await addPanels(win, 2); // p1 | p2 | p3
    const [p1, p2] = await panelIds(win);

    await win.getByTestId(`panel-${p1}`).click();
    await expectActive(win, p1);

    await win.keyboard.press('Control+Backquote');
    await expectActive(win, p2);

    // The reverse binding is a DIFFERENT chord, not the same one with a flag — hence a witness of
    // its own. That it lands back on p1 is the mover's business, asserted in core.
    await win.keyboard.press('Control+Shift+Backquote');
    await expectActive(win, p1);
  });
});

test('move-focus works from a focused terminal and editor, and input routing follows (FR-003)', { tag: ['@extended', '@window', '@reserve:pty'] }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'throng-mf-io-'));
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'FocusIO', root);

      // p1 = terminal (cmd), p2 = editor, as a row: [terminal | editor].
      const p1 = await firstPanelId(win);
      await win.getByTestId(`panel-type-select-${p1}`).selectOption('terminal');
      await win.getByTestId('terminal-flavour').selectOption('cmd');
      await win.getByTestId(`panel-type-confirm-${p1}`).click();
      await expect(win.getByTestId(`terminal-${p1}`)).toContainText(basename(root), { timeout: TERMINAL_OUTPUT_TIMEOUT_MS });

      await win.getByTestId(`panel-add-${p1}`).click();
      await commitPanelRename(win);
      const [, p2] = await panelIds(win);
      await win.getByTestId(`panel-type-select-${p2}`).selectOption('editor');
      await win.getByTestId(`panel-type-confirm-${p2}`).click();
      await expect(win.getByTestId(`editor-${p2}`)).toBeVisible();

      // Give the TERMINAL caret focus, then move focus right by keyboard. Git Bash /
      // cmd must NOT swallow the chord — the capture-phase handler intercepts it.
      await win.getByTestId(`terminal-${p1}`).click();
      await win.keyboard.press('Control+Alt+ArrowRight');
      await expect(win.getByTestId(`panel-${p2}`)).toHaveAttribute('data-active', 'true');

      // Input routing followed the move: typing now lands in the EDITOR, not the terminal.
      await win.keyboard.type('HELLO_EDITOR');
      await expect(win.getByTestId(`editor-${p2}`).locator('.cm-content')).toContainText('HELLO_EDITOR');

      // Move back to the terminal; typing a command now lands in the terminal.
      await win.keyboard.press('Control+Alt+ArrowLeft');
      await expect(win.getByTestId(`panel-${p1}`)).toHaveAttribute('data-active', 'true');
      await win.keyboard.type('echo TERM_OK_777');
      await win.keyboard.press('Enter');
      await expect(win.getByTestId(`terminal-${p1}`)).toContainText('TERM_OK_777', { timeout: 15000 });

      // The editor never received the terminal command text (routing was clean).
      await expect(win.getByTestId(`editor-${p2}`).locator('.cm-content')).not.toContainText('TERM_OK_777');
    });
  } finally {
    cleanupTemp(root);
  }
});
