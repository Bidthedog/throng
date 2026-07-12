import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { runApp, createProject, firstPanelId } from './harness.js';
import { skipIfElevated } from './admin.js';

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
  await expect(term).toContainText(basename(root), { timeout: 20000 });
  return pid;
}

async function run(win: Page, pid: string, cmd: string, marker: string): Promise<void> {
  await win.getByTestId(`terminal-${pid}`).click();
  await win.keyboard.type(cmd, { delay: 15 });
  await win.keyboard.press('Enter');
  await expect(win.getByTestId(`terminal-${pid}`)).toContainText(marker, { timeout: 20000 });
}

test('page / line / top / bottom move the viewport — and never reach the program', async () => {
  skipIfElevated();
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
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
  }
});

test('at the live bottom, ordinary typing still reaches the program (FR-016)', async () => {
  skipIfElevated();
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
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
  }
});

test('with find open, next/previous jump the viewport between matches (FR-015)', async () => {
  skipIfElevated();
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
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
  }
});
