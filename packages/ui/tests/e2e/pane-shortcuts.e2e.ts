import { test, expect } from '@playwright/test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runApp, createProject } from './harness.js';

// Ctrl+B toggles the Projects (left) pane; Ctrl+N toggles the Files & Folders
// (right) pane. Both are configurable in keybindings.json.

test('Ctrl+B toggles the Projects pane and Ctrl+N toggles the Files & Folders pane', async () => {
  await runApp(async (_app, win) => {
    await createProject(win, 'Alpha', 'C:/code/alpha'); // makes the Explorer visible
    await win.waitForTimeout(600); // renderer pulls keybindings
    await win.locator('body').click(); // focus the window

    // Projects (left): shown by default → Ctrl+B collapses → Ctrl+B expands.
    await expect(win.getByTestId('pane-hide-left')).toBeVisible();
    await win.keyboard.press('Control+b');
    await expect(win.getByTestId('pane-rail-left')).toBeVisible();
    await win.keyboard.press('Control+b');
    await expect(win.getByTestId('pane-hide-left')).toBeVisible();

    // Files & Folders (right): shown with a project → Ctrl+N collapses → expands.
    await expect(win.getByTestId('pane-hide-right')).toBeVisible();
    await win.keyboard.press('Control+n');
    await expect(win.getByTestId('pane-rail-right')).toBeVisible();
    await win.keyboard.press('Control+n');
    await expect(win.getByTestId('pane-hide-right')).toBeVisible();
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

        // …and the default Ctrl+B no longer does (it was replaced).
        await win.keyboard.press('Control+b');
        await expect(win.getByTestId('pane-rail-left')).toBeVisible();
      },
      { env: { THRONG_CONFIG_ROOT: cfg } },
    );
  } finally {
    rmSync(cfg, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
