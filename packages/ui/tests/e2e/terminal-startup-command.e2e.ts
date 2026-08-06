import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import {
  openApp,
  runApp as runOwnApp,
  createProject as newProject,
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


/**
 * 025 — Startup Commands, command memory, and the user-defined-flavour launch gap (#113).
 *
 * The last of these is why this file exists at all: `terminal-flavours.e2e.ts` says in its own
 * header "No terminal launches yet (that is Phase C)", and Phase C never added one — so nothing
 * in the suite has ever proven a user-defined flavour can actually start a terminal. This feature
 * adds a per-flavour command recipe to that same launch chain, so the gap is closed here.
 */

/** A user flavour pointing at a real executable every Windows machine has, under a distinct id
 *  so it cannot be confused with the built-in `cmd`. No fixture binary, no machine assumptions. */
const USER_FLAVOUR = {
  id: 'my-cmd',
  label: 'My CMD',
  file: 'C:\\Windows\\System32\\cmd.exe',
  args: [],
  defaultShellArguments: '',
  commandRecipe: ['/K', '{command}'],
};

test('the form offers Shell Arguments, Startup Command and the memory checkbox (FR-001/FR-002/FR-015)', async () => {
  const root = mkdtempSync(join(tmpdir(), 'throng-025-form-'));
  try {
  await runApp(async (_app, win) => {
    await createProject(win, 'StartupCmd', root);
    const pid = await firstPanelId(win);
    await win.getByTestId(`panel-type-select-${pid}`).selectOption('terminal');

    // FR-002: the two fields are distinct and share no words, so "arguments handed to the shell"
    // cannot be mistaken for "a command the shell runs".
    await expect(win.getByTestId('terminal-shell-arguments')).toBeVisible();
    await expect(win.getByTestId('terminal-startup-command')).toBeVisible();

    // Ships ON, like the directory control beside it — asserted rather than assumed, so a
    // silently flipped default fails here. An opt-in a user has to discover first means the
    // feature does nothing for everyone who never found the checkbox.
    const remember = win.getByTestId('terminal-remember-command');
    await expect(remember).toBeVisible();
    await expect(remember).toBeChecked();
  });
  } finally {
    cleanupTemp(root);
  }
});

test('a startup command runs and leaves an interactive prompt behind (FR-004/FR-005)', async () => {
  const root = mkdtempSync(join(tmpdir(), 'throng-025-runs-'));
  try {
  await runApp(async (_app, win) => {
    await createProject(win, 'RunsCmd', root);
    const pid = await firstPanelId(win);
    await win.getByTestId(`panel-type-select-${pid}`).selectOption('terminal');
    await win.getByTestId('terminal-flavour').selectOption('cmd');
    // A marker that cannot be confused with anything the shell prints on its own.
    await win.getByTestId('terminal-startup-command').fill('echo STARTUP_MARKER_OK');
    await win.getByTestId(`panel-type-confirm-${pid}`).click();

    const term = win.getByTestId(`terminal-${pid}`);
    await expect(term).toBeVisible();
    // The command ran...
    await expect(term).toContainText('STARTUP_MARKER_OK', { timeout: 30_000 });
    // ...and the shell is STILL THERE. This is the assertion that catches a wrong recipe: `cmd /C`
    // or a bash `-c` without the re-exec would have closed the terminal, reverting the panel to
    // its type-selection form.
    await expect(win.getByTestId(`panel-type-select-${pid}`)).toHaveCount(0);
  });
  } finally {
    cleanupTemp(root);
  }
});

test('an empty startup command behaves exactly as before (FR-006)', async () => {
  const root = mkdtempSync(join(tmpdir(), 'throng-025-nocmd-'));
  try {
  await runApp(async (_app, win) => {
    await createProject(win, 'NoCmd', root);
    const pid = await firstPanelId(win);
    await win.getByTestId(`panel-type-select-${pid}`).selectOption('terminal');
    await win.getByTestId('terminal-flavour').selectOption('cmd');
    await win.getByTestId(`panel-type-confirm-${pid}`).click();

    const term = win.getByTestId(`terminal-${pid}`);
    await expect(term).toBeVisible();
    // A live shell, and nothing injected into it.
    await expect(term).not.toContainText('STARTUP_MARKER_OK');
  });
  } finally {
    cleanupTemp(root);
  }
});

test('a USER-DEFINED flavour actually launches — the gap #113 records (FR-042)', async () => {
  const cfg = mkdtempSync(join(tmpdir(), 'throng-cfgroot-'));
  const root = mkdtempSync(join(tmpdir(), 'throng-025-userflav-'));
  try {
    writeFileSync(
      join(cfg, 'settings.json'),
      JSON.stringify({ terminals: { flavours: [USER_FLAVOUR] } }, null, 2),
      'utf8',
    );
    await runOwnApp(
      async (_app, win) => {
        await createProject(win, 'UserLaunch', root);
        const pid = await firstPanelId(win);
        await win.getByTestId(`panel-type-select-${pid}`).selectOption('terminal');
        const flavour = win.getByTestId('terminal-flavour');
        await expect(flavour.locator('option[value="my-cmd"]')).toHaveCount(1);
        await flavour.selectOption('my-cmd');
        await win.getByTestId(`panel-type-confirm-${pid}`).click();

        // It LAUNCHED — not merely appeared in the dropdown, which is all the suite proved before.
        const term = win.getByTestId(`terminal-${pid}`);
        await expect(term).toBeVisible();
        await expect(win.getByTestId(`panel-type-select-${pid}`)).toHaveCount(0);
      },
      { env: { THRONG_CONFIG_ROOT: cfg } },
    );
  } finally {
    cleanupTemp(cfg);
    cleanupTemp(root);
  }
});

test('a user-defined flavour launches WITH a startup command, via its own recipe (FR-043)', async () => {
  const cfg = mkdtempSync(join(tmpdir(), 'throng-cfgroot-'));
  const root = mkdtempSync(join(tmpdir(), 'throng-025-userflav-'));
  try {
    writeFileSync(
      join(cfg, 'settings.json'),
      JSON.stringify({ terminals: { flavours: [USER_FLAVOUR] } }, null, 2),
      'utf8',
    );
    await runOwnApp(
      async (_app, win) => {
        await createProject(win, 'UserLaunchCmd', root);
        const pid = await firstPanelId(win);
        await win.getByTestId(`panel-type-select-${pid}`).selectOption('terminal');
        await win.getByTestId('terminal-flavour').selectOption('my-cmd');
        await win.getByTestId('terminal-startup-command').fill('echo USER_FLAVOUR_MARKER');
        await win.getByTestId(`panel-type-confirm-${pid}`).click();

        const term = win.getByTestId(`terminal-${pid}`);
        await expect(term).toContainText('USER_FLAVOUR_MARKER', { timeout: 30_000 });
      },
      { env: { THRONG_CONFIG_ROOT: cfg } },
    );
  } finally {
    cleanupTemp(cfg);
    cleanupTemp(root);
  }
});

test('the empty-panel form pre-fills from what the panel remembered (FR-007a)', async () => {
  const root = mkdtempSync(join(tmpdir(), 'throng-025-prefill-'));
  try {
  await runApp(async (_app, win) => {
    await createProject(win, 'Prefill', root);
    const pid = await firstPanelId(win);
    await win.getByTestId(`panel-type-select-${pid}`).selectOption('terminal');
    await win.getByTestId('terminal-flavour').selectOption('cmd');
    await win.getByTestId('terminal-shell-arguments').fill('/K');
    await win.getByTestId('terminal-startup-command').fill('echo PREFILL_MARKER');
    await win.getByTestId('terminal-remember-command').check();
    await win.getByTestId(`panel-type-confirm-${pid}`).click();

    const term = win.getByTestId(`terminal-${pid}`);
    await expect(term).toContainText('PREFILL_MARKER', { timeout: 30_000 });

    // End the terminal from inside. The panel returns to its empty state — which IS the edit
    // screen (FR-007b): there is no separate settings dialog anywhere.
    await term.click();
    await win.keyboard.type('exit');
    await win.keyboard.press('Enter');

    const form = win.getByTestId(`panel-type-select-${pid}`);
    await expect(form).toBeVisible({ timeout: 30_000 });
    await form.selectOption('terminal');

    // Pre-filled from memory rather than reset to defaults.
    await expect(win.getByTestId('terminal-startup-command')).toHaveValue('echo PREFILL_MARKER');
    await expect(win.getByTestId('terminal-remember-command')).toBeChecked();
  });
  } finally {
    cleanupTemp(root);
  }
});
