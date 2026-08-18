import { test, expect } from '@playwright/test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  openApp,
  runApp as runOwnApp,
  createProject,
  cleanupTemp,
  type AppOptions,
  type OpenApp,
} from './harness.js';

// Ctrl+Alt+B toggles the Projects (left) pane; Ctrl+Alt+N toggles the Files & Folders
// (right) pane. Both are configurable in keybindings.json.
//
// 026 / #165 — these moved off Ctrl+B / Ctrl+N, which belong to the shell (tmux's prefix key and
// readline's next-history). The negative half of this test matters as much as the positive half:
// the pane toggles are in the RESERVED set, so a chord they claim is one a focused terminal can
// never receive. Asserting the old chords now do nothing is what proves the shell got them back.

/*
 * ONE app for the first two tests (034 FR-045, SC-027) — 3 launches -> 2.
 *
 * Test 3 keeps `runOwnApp`, and genuinely has to: it writes `keybindings.json` rebinding
 * view.toggleProjects to F7 BEFORE the app starts (:60) and hands the app that root at launch.
 * Its whole subject is what the config REPLACED, which an app already running cannot show.
 *
 * Tests 1 and 2 share. Both projects sit on paths that never exist (C:/code/alpha,
 * C:/code/beta), so there is no real root and no watcher.
 *
 * The one leftover is PANE COLLAPSE STATE, which is per-window and survives everything short of
 * a relaunch. Test 2's opening claim is that both panes are OPEN and neither rail is drawn
 * (:53-54) — a claim test 1 would break outright if it failed halfway through a toggle. The
 * afterEach re-expands whichever rail is showing, using the same `pane-show-*` control
 * panes.e2e.ts:168 uses. It is an afterEach rather than a `finally` so it runs on the FAILURE
 * path, and not one line of either test body changes.
 */
test.describe.configure({ mode: 'serial' });

let shared: OpenApp;

test.beforeAll(async () => {
  shared = await openApp();
});

test.afterAll(async () => {
  await shared?.close();
});

test.afterEach(async () => {
  if (!shared) return;
  for (const side of ['left', 'right'] as const) {
    if ((await shared.win.getByTestId(`pane-rail-${side}`).count()) === 0) continue;
    await shared.win.getByTestId(`pane-show-${side}`).click();
    await expect(shared.win.getByTestId(`pane-rail-${side}`)).toHaveCount(0);
  }
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

test('Ctrl+Alt+B toggles the Projects pane and Ctrl+Alt+N toggles the Files & Folders pane', { tag: ['@extended', '@window'] }, async () => {
  await runApp(async (_app, win) => {
    await createProject(win, 'Alpha', 'C:/code/alpha'); // makes the Explorer visible
    // createProject() already waited for `.throng-shell` to render, which is hidden until the
    // SAME config payload that carries keybindings has loaded (app.tsx useAppReady) — so no
    // separate wait for "the renderer pulls keybindings" is needed here.
    await win.locator('body').click(); // focus the window

    // Projects (left): shown by default → Ctrl+Alt+B collapses → Ctrl+Alt+B expands.
    await expect(win.getByTestId('pane-hide-left')).toBeVisible();
    await win.keyboard.press('Control+Alt+b');
    await expect(win.getByTestId('pane-rail-left')).toBeVisible();
    await win.keyboard.press('Control+Alt+b');
    await expect(win.getByTestId('pane-hide-left')).toBeVisible();

    // Files & Folders (right): shown with a project → Ctrl+Alt+N collapses → expands.
    await expect(win.getByTestId('pane-hide-right')).toBeVisible();
    await win.keyboard.press('Control+Alt+n');
    await expect(win.getByTestId('pane-rail-right')).toBeVisible();
    await win.keyboard.press('Control+Alt+n');
    await expect(win.getByTestId('pane-hide-right')).toBeVisible();
  });
});

test('the shell keeps Ctrl+B and Ctrl+N — no pane responds to them', { tag: ['@extended', '@window'] }, async () => {
  await runApp(async (_app, win) => {
    await createProject(win, 'Beta', 'C:/code/beta');
    // createProject() already waited on `.throng-shell` (and thus on keybindings loading —
    // see the equivalent comment in the test above), so no extra wait is needed here.
    await win.locator('body').click();

    // Both panes are open. Neither old chord may move anything.
    await expect(win.getByTestId('pane-hide-left')).toBeVisible();
    await expect(win.getByTestId('pane-hide-right')).toBeVisible();

    await win.keyboard.press('Control+b');
    await win.keyboard.press('Control+n');
    // sleep-justified: Ctrl+B/Ctrl+N are meant to do nothing at all here (the shell keeps them),
    // so there is no positive event a "toggle did not fire" claim could fence on.
    await win.waitForTimeout(300);

    await expect(win.getByTestId('pane-hide-left')).toBeVisible();
    await expect(win.getByTestId('pane-hide-right')).toBeVisible();
    await expect(win.getByTestId('pane-rail-left')).toHaveCount(0);
    await expect(win.getByTestId('pane-rail-right')).toHaveCount(0);
  });
});

test('the pane-toggle shortcuts are configurable in keybindings.json', { tag: ['@extended', '@window'] }, async () => {
  const cfg = mkdtempSync(join(tmpdir(), 'throng-cfgkb-'));
  writeFileSync(
    join(cfg, 'keybindings.json'),
    JSON.stringify({ version: 1, bindings: { 'view.toggleProjects': ['F7'] } }, null, 2),
    'utf8',
  );
  try {
    await runOwnApp(
      async (_app, win) => {
        await win.locator('body').click();

        // Rebound to F7 → F7 toggles the Projects pane…
        // (the toBeVisible() immediately below already waits for `.throng-shell` — and so for
        // keybindings.json — to have loaded before F7 is pressed.)
        await expect(win.getByTestId('pane-hide-left')).toBeVisible();
        await win.keyboard.press('F7');
        await expect(win.getByTestId('pane-rail-left')).toBeVisible();

        // …and the shipped default no longer does, because this config REPLACED it.
        await win.keyboard.press('Control+Alt+b');
        await expect(win.getByTestId('pane-rail-left')).toBeVisible();
      },
      { env: { THRONG_CONFIG_ROOT: cfg } },
    );
  } finally {
    cleanupTemp(cfg);
  }
});
