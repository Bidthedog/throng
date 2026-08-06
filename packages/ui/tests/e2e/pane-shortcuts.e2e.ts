import { test, expect } from '@playwright/test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runApp, createProject, cleanupTemp} from './harness.js';

// Ctrl+Alt+B toggles the Projects (left) pane; Ctrl+Alt+N toggles the Files & Folders
// (right) pane. Both are configurable in keybindings.json.
//
// 026 / #165 — these moved off Ctrl+B / Ctrl+N, which belong to the shell (tmux's prefix key and
// readline's next-history). The negative half of this test matters as much as the positive half:
// the pane toggles are in the RESERVED set, so a chord they claim is one a focused terminal can
// never receive. Asserting the old chords now do nothing is what proves the shell got them back.

test('Ctrl+Alt+B toggles the Projects pane and Ctrl+Alt+N toggles the Files & Folders pane', async () => {
  await runApp(async (_app, win) => {
    await createProject(win, 'Alpha', 'C:/code/alpha'); // makes the Explorer visible
    await win.waitForTimeout(600); // renderer pulls keybindings
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

test('the shell keeps Ctrl+B and Ctrl+N — no pane responds to them', async () => {
  await runApp(async (_app, win) => {
    await createProject(win, 'Beta', 'C:/code/beta');
    await win.waitForTimeout(600);
    await win.locator('body').click();

    // Both panes are open. Neither old chord may move anything.
    await expect(win.getByTestId('pane-hide-left')).toBeVisible();
    await expect(win.getByTestId('pane-hide-right')).toBeVisible();

    await win.keyboard.press('Control+b');
    await win.keyboard.press('Control+n');
    await win.waitForTimeout(300); // a toggle would have rendered by now

    await expect(win.getByTestId('pane-hide-left')).toBeVisible();
    await expect(win.getByTestId('pane-hide-right')).toBeVisible();
    await expect(win.getByTestId('pane-rail-left')).toHaveCount(0);
    await expect(win.getByTestId('pane-rail-right')).toHaveCount(0);
  });
});

test('the pane-toggle shortcuts are configurable in keybindings.json', async () => {
  const cfg = mkdtempSync(join(tmpdir(), 'throng-cfgkb-'));
  writeFileSync(
    join(cfg, 'keybindings.json'),
    JSON.stringify({ version: 1, bindings: { 'view.toggleProjects': ['F7'] } }, null, 2),
    'utf8',
  );
  try {
    await runApp(
      async (_app, win) => {
        await win.waitForTimeout(600);
        await win.locator('body').click();

        // Rebound to F7 → F7 toggles the Projects pane…
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
