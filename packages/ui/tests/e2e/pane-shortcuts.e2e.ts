import { test, expect } from '@playwright/test';
import { shippedPress } from '../shared/window-chords.js';
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

// Ctrl+Shift+Alt+J toggles the Projects (left) pane; Ctrl+Shift+Alt+K toggles the File Explorer
// (right) pane (046 FR-117; Ctrl+Shift+Alt+B / N under FR-102, and Ctrl+Alt+B / Ctrl+Alt+N before
// that). Both are configurable in keybindings.json.
//
// 026 / #165 — these moved off Ctrl+B / Ctrl+N, which belong to the shell (tmux's prefix key and
// readline's next-history). The negative half of this test matters as much as the positive half:
// the pane toggles are in the RESERVED set, so a chord they claim is one a focused terminal can
// never receive. Asserting the old chords now do nothing is what proves the shell got them back.

/*
 * The positive half — Ctrl+Shift+Alt+J and Ctrl+Shift+Alt+K really toggle the two panes — lives in
 * window-chord-resolution.e2e.ts ("the pane toggles still resolve"), which presses the same chords and
 * asserts the same pane-hide-* / pane-rail-* controls, and is what window-chords.ts's COVERED map
 * names for both toggles. This file carried an exact duplicate of it until 046 T048a removed it
 * (Principle V budget offset); no lower layer mounts app.tsx's pane rails, so that surviving E2E is
 * what holds it.
 *
 * What stays here is what that file does not assert: the shell keeps Ctrl+B and Ctrl+N (a shared
 * app), and a keybindings.json rebinding REPLACES the shipped chord (`runOwnApp`, because it writes
 * the config BEFORE the app starts and hands the app that root at launch — its whole subject is what
 * the config replaced, which an app already running cannot show).
 *
 * The shared test's project sits on a path that never exists (C:/code/beta), so there is no real
 * root and no watcher. PANE COLLAPSE STATE is per-window and survives everything short of a
 * relaunch, so the afterEach re-expands whichever rail is showing, using the same `pane-show-*`
 * control panes.e2e.ts uses — an afterEach rather than a `finally` so it runs on the FAILURE path
 * too, and a later test sharing this app never inherits a collapsed pane.
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

test('the shell keeps Ctrl+B and Ctrl+N — no pane responds to them', { tag: ['@extended', '@window', '@reserve:input'] }, async () => {
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

test('the pane-toggle shortcuts are configurable in keybindings.json', { tag: ['@extended', '@window', '@reserve:input'] }, async () => {
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
        await win.keyboard.press(shippedPress('view.toggleProjects'));
        await expect(win.getByTestId('pane-rail-left')).toBeVisible();
      },
      { env: { THRONG_CONFIG_ROOT: cfg } },
    );
  } finally {
    cleanupTemp(cfg);
  }
});
