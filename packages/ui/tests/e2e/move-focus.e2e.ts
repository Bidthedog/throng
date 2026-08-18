import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import {
  openApp,
  createProject as newProject,
  firstPanelId,
  panelIds,
  addPanels,
  commitPanelRename,
  cleanupTemp,
  type AppOptions,
  type OpenApp,
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


// 012 US3 (FR-015, SC-008/008a): directional + cyclic keyboard focus movement over
// the active tab's split tree, in stable layout order, staying put at the edge.

async function expectActive(win: Page, pid: string): Promise<void> {
  await expect(win.getByTestId(`panel-${pid}`)).toHaveAttribute('data-active', 'true');
  await expect(win.locator('.panel-box--active')).toHaveCount(1);
}

test('directional keys move focus in layout order and stay put at the edge', { tag: ['@extended', '@window'] }, async () => {
  await runApp(async (_app, win) => {
    await createProject(win, 'MoveFocus', 'C:/c/mf');
    await addPanels(win, 2); // a row of three: p1 | p2 | p3
    await expect(win.locator('.panel-box')).toHaveCount(3);
    const [p1, p2, p3] = await panelIds(win);

    await win.getByTestId(`panel-${p1}`).click();
    await expectActive(win, p1);

    // Rightward moves walk p1 → p2 → p3.
    await win.keyboard.press('Control+Alt+ArrowRight');
    await expectActive(win, p2);
    await win.keyboard.press('Control+Alt+ArrowRight');
    await expectActive(win, p3);

    // At the right edge there is nowhere to go — focus stays put (no wrap, no error).
    await win.keyboard.press('Control+Alt+ArrowRight');
    await expectActive(win, p3);

    // Leftward walks back p3 → p2 → p1, then stays put at the left edge.
    await win.keyboard.press('Control+Alt+ArrowLeft');
    await expectActive(win, p2);
    await win.keyboard.press('Control+Alt+ArrowLeft');
    await expectActive(win, p1);
    await win.keyboard.press('Control+Alt+ArrowLeft');
    await expectActive(win, p1);

    // A vertical move in a purely horizontal layout also stays put.
    await win.keyboard.press('Control+Alt+ArrowUp');
    await expectActive(win, p1);
  });
});

test('cycle forward/backward visits panels in layout order, wrapping the ring (SC-008a)', { tag: ['@extended', '@window'] }, async () => {
  await runApp(async (_app, win) => {
    await createProject(win, 'CycleFocus', 'C:/c/cf');
    await addPanels(win, 2); // p1 | p2 | p3
    const [p1, p2, p3] = await panelIds(win);

    await win.getByTestId(`panel-${p1}`).click();
    await expectActive(win, p1);

    // Forward cycle: p1 → p2 → p3 → wrap → p1.
    await win.keyboard.press('Control+Backquote');
    await expectActive(win, p2);
    await win.keyboard.press('Control+Backquote');
    await expectActive(win, p3);
    await win.keyboard.press('Control+Backquote');
    await expectActive(win, p1); // wrapped

    // Backward cycle (Ctrl+Shift+backtick → produces `~`): p1 → wrap → p3 → p2.
    await win.keyboard.press('Control+Shift+Backquote');
    await expectActive(win, p3);
    await win.keyboard.press('Control+Shift+Backquote');
    await expectActive(win, p2);
  });
});

test('move-focus works from a focused terminal and editor, and input routing follows (FR-003)', { tag: ['@extended', '@window'] }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'throng-mf-io-'));
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'FocusIO', root);

      // p1 = terminal (cmd), p2 = editor, as a row: [terminal | editor].
      const p1 = await firstPanelId(win);
      await win.getByTestId(`panel-type-select-${p1}`).selectOption('terminal');
      await win.getByTestId('terminal-flavour').selectOption('cmd');
      await win.getByTestId(`panel-type-confirm-${p1}`).click();
      await expect(win.getByTestId(`terminal-${p1}`)).toContainText(basename(root), { timeout: 15000 });

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
