/**
 * F2 renames the active panel (024 follow-up, `panel.rename`).
 *
 * F2 is the rename key everywhere else in throng — the file tree already uses it — and everywhere
 * else in Windows. A panel header that could only be renamed by double-clicking it or hunting
 * through a context menu was the odd one out. In a TERMINAL it must also be TAKEN: a chord throng
 * advertises must not simultaneously be handed to the running program.
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import {
  openApp,
  createProject,
  firstPanelId,
  cleanupTemp,
  type AppOptions,
  type OpenApp,
} from './harness.js';

/*
 * ONE app for this file, not one per test (034 FR-045).
 *
 * Neither test seeds anything before launch: each creates its own project and its own panel, which
 * a shared window does just as well as a pristine one. The shim REFUSES launch options rather than
 * ignoring them — a swallowed config root does not fail, it passes for the wrong reason.
 *
 * The second test used to end by closing the window and answering the terminate prompt. That was
 * teardown, not an assertion, and `openApp`'s own teardown already kills the app-spawned daemon and
 * the shell tree behind it — which is why `panel-zoom.e2e.ts` shares one app across tests that
 * leave two live `cmd` sessions behind. `app-close-terminals.e2e.ts` and `terminate-all-drain.e2e.ts`
 * are where the close PROMPT is the subject, and they are untouched.
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
  fn: (app: OpenApp['app'], win: OpenApp['win']) => Promise<void>,
  opts?: AppOptions,
): Promise<void> => {
  if (opts) {
    throw new Error(
      'this file shares one app; a test needing launch options must call runOwnApp instead',
    );
  }
  return fn(shared.app, shared.win);
};

/*
 * MOVED to `packages/ui/tests/unit/menu-sections.test.ts` (034 FR-045) — the menu half of the test
 * below, which opened a real context menu to read two accelerator labels.
 *
 *   names the chord beside Rename and beside each Zoom item, and names the RIGHT one
 *   shows a REBOUND chord rather than the shipped one, so the menu teaches the live key
 *
 * STRONGER than what it replaces, in the way that matters: the E2E asserted `menu-item-Zoom In`
 * "contains Ctrl", which is true of every chord in the application and would have passed with Zoom
 * In showing Zoom Out's binding. The unit test pins all three zoom chords by value, and adds the
 * half no fixed string can prove — that a REBOUND `panel.rename` moves what the menu shows, which
 * a menu hard-coding "F2" would fail. `panelHeaderMenu` is a pure function of its `keybindings`
 * argument, so this is the layer the claim actually lives at.
 *
 * The two Escapes (FR-018b — one steps out of the sub-menu, one closes the root) were ALREADY
 * covered against the real mounted menu, before this trim, by
 * `packages/ui/tests/component/menu-keyboard.test.ts:120` ("Escape inside a sub-menu steps back to
 * the parent and leaves the root menu open") and `:134` ("Escape at the root closes the whole
 * menu"). Nothing about them moved; they were simply already there.
 *
 * WHAT DID NOT MOVE, and is why this test keeps its place: the KEY. That F2 reaches the active
 * panel and opens its rename box, that the Enter which commits the name does not also land in the
 * CodeMirror document behind it, and that focus returns to the editor afterwards — a real keyboard,
 * a real focus path and a real document. Its title is rewritten to say so; the old one named the
 * menu, which is no longer here.
 */
test('F2 opens the rename box on the active panel, and its Enter never reaches the document', { tag: ['@extended', '@window', '@reserve:input'] }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'throng-f2-'));
  writeFileSync(join(root, 'a.txt'), 'x\n');
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'F2Proj', root);
      const pid = await firstPanelId(win);
      await win.getByTestId(`panel-type-select-${pid}`).selectOption('editor');
      await win.getByTestId(`panel-type-confirm-${pid}`).click();
      await win.getByTestId(`editor-${pid}`).click();


      // F2 opens the rename box on the ACTIVE panel.
      await win.getByTestId(`editor-${pid}`).click();
      await win.keyboard.press('F2');
      const input = win.getByTestId(`panel-rename-input-${pid}`);
      await expect(input).toBeVisible();
      await input.fill('Renamed by key');
      await input.press('Enter');
      await expect(win.getByTestId(`panel-title-${pid}`)).toHaveText('Renamed by key');

      // The Enter that CONFIRMED the name must not also reach the document behind it. Focusing the
      // panel synchronously from inside that keydown let the rest of the keystroke land in the newly
      // focused editor and type a newline into the user's file.
      const content = win.getByTestId(`editor-${pid}`).locator('.cm-content');
      await expect(content).toHaveText('');
      // …and focus DID come back, so the next keystroke goes where the user expects.
      await expect
        .poll(() => win.evaluate(() => document.activeElement?.closest('.cm-editor') != null))
        .toBe(true);
      await win.keyboard.type('typed');
      await expect(content).toContainText('typed');
    });
  } finally {
    cleanupTemp(root);
  }
});

test('F2 renames a terminal panel, and is not delivered to the shell', { tag: ['@extended', '@window', '@reserve:pty'] }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'throng-f2t-'));
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'F2TermProj', root);
      const pid = await firstPanelId(win);
      await win.getByTestId(`panel-type-select-${pid}`).selectOption('terminal');
      await win.getByTestId('terminal-flavour').selectOption('cmd');
      await win.getByTestId(`panel-type-confirm-${pid}`).click();
      await expect(win.getByTestId(`terminal-${pid}`)).toBeVisible({ timeout: 15000 });

      // Focus the terminal, then press F2. In cmd, F2 is a console editing key ("copy up to
      // character") — throng must take it before the program ever sees it.
      await win.getByTestId(`terminal-${pid}`).click();
      await win.keyboard.press('F2');
      const input = win.getByTestId(`panel-rename-input-${pid}`);
      await expect(input).toBeVisible({ timeout: 8000 });
      await input.fill('Build shell');
      await input.press('Enter');
      await expect(win.getByTestId(`panel-title-${pid}`)).toHaveText('Build shell');
    });
  } finally {
    cleanupTemp(root);
  }
});
