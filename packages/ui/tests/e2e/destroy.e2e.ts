import { basename } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import {
  openApp,
  createProject as newProject,
  daemonRpc,
  firstPanelId,
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


// US3 / SC-005: Destroy flows use the shared confirm dialog with the configured
// confirmation level. A PANEL only confirms when it hosts a live terminal (losing
// a running shell is the destructive case); a plain Panel is removed immediately.
// Tab/Project destroys stay level-based. Cancelling any destroy leaves state
// unchanged (FR-025).

test('destroys an empty Panel immediately — no terminal, no confirmation', { tag: ['@extended', '@window'] }, async () => {
  await runApp(async (_app, win) => {
    await createProject(win, 'Destroyer', 'C:/c/destroyer');
    await expect(win.getByTestId('tab-strip')).toBeVisible();

    // Two Panels so destroying one is allowed (the workspace keeps ≥ 1 Panel).
    const pid = await firstPanelId(win);
    await win.getByTestId(`panel-add-${pid}`).click();
    await expect(win.locator('.panel-box')).toHaveCount(2);
    await win.keyboard.press('Escape'); // dismiss the new Panel's rename input

    // Header × on an empty Panel → removed immediately, no confirmation.
    await win.getByTestId(`panel-close-${pid}`).click();
    await expect(win.getByTestId('confirm-dialog')).toHaveCount(0);
    await expect(win.locator('.panel-box')).toHaveCount(1);
  });
});

test('warns before destroying a Panel that hosts a live terminal', { tag: ['@extended', '@window'] }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'throng-destroy-term-'));
  try {
    await runApp(async (_app, win, { pipeName }) => {
      await createProject(win, 'TermDestroy', root);
      const pid = await firstPanelId(win);

      // A second Panel so destroying the terminal Panel is allowed.
      await win.getByTestId(`panel-add-${pid}`).click();
      await expect(win.locator('.panel-box')).toHaveCount(2);
      await win.keyboard.press('Escape');

      // Turn the first Panel into a live Terminal.
      await win.getByTestId(`panel-type-select-${pid}`).selectOption('terminal');
      await win.getByTestId('terminal-flavour').selectOption('cmd');
      await win.getByTestId(`panel-type-confirm-${pid}`).click();
      // Wait until the shell prompt is live. This Panel is SPLIT (two panels), so the
      // full root path in the cmd prompt wraps across xterm rows; match only the temp
      // dir's trailing (random) chars, which land contiguously on the final wrapped row.
      await expect(win.getByTestId(`terminal-${pid}`)).toContainText(basename(root).slice(-6), {
        timeout: 15000,
      });

      // Header × on the Terminal Panel → confirmation fires (double level), because
      // the Panel hosts a live terminal.
      await win.getByTestId(`panel-close-${pid}`).click();
      await expect(win.getByTestId('confirm-dialog')).toBeVisible();
      await expect(win.getByTestId('confirm-dialog')).toContainText('running terminal');
      await win.getByTestId('confirm-accept').click(); // "Destroy Panel"
      await expect(win.getByTestId('confirm-dialog')).toContainText('absolutely sure');
      await win.getByTestId('confirm-accept').click(); // "Yes, I'm absolutely sure"

      await expect(win.locator('.panel-box')).toHaveCount(1);
      /*
       * Destroying killed the terminal; poll the daemon's OWN session list until it agrees the
       * session is gone, rather than guessing how long that takes — the real signal the app-close
       * handshake needs before teardown, and a poll on daemon state rather than a duration.
       */
      await expect
        .poll(
          async () => {
            const result = (await daemonRpc(pipeName, 'terminal.list', {})) as
              | { sessions?: { panelId: string }[] }
              | null;
            return result?.sessions?.some((s) => s.panelId === pid) ?? false;
          },
          { timeout: 15_000, message: `daemon never cleared the killed terminal's session (panel ${pid})` },
        )
        .toBe(false);
    });
  } finally {
    cleanupTemp(root);
  }
});

test('cancelling a Tab destroy leaves all state unchanged (FR-025)', { tag: ['@extended', '@window'] }, async () => {
  await runApp(async (_app, win) => {
    await createProject(win, 'Canceller', 'C:/c/canceller');
    await win.getByTestId('tab-add').click();
    await expect(win.locator('.tab-chip')).toHaveCount(2);

    const firstTab = win.locator('.tab-chip').first();
    await firstTab.click();
    await firstTab.click({ button: 'right' });
    await win.getByTestId('menu-item-Destroy Tab').click();

    // Cancel the first dialog → nothing is destroyed.
    await expect(win.getByTestId('confirm-dialog')).toBeVisible();
    await win.getByTestId('confirm-cancel').click();
    await expect(win.getByTestId('confirm-dialog')).toHaveCount(0);
    await expect(win.locator('.tab-chip')).toHaveCount(2);
  });
});
