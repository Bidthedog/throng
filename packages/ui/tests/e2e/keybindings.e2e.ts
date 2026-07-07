import { test, expect } from '@playwright/test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ElectronApplication } from '@playwright/test';
import { runApp } from './harness.js';

// FR-033 (#1): keyboard accelerators are driven by keybindings.json — edits apply
// across sessions AND hot-reload. We rebind zoom.in to a function key and assert
// the zoom level changes (deterministic, needs no display).

const zoomLevel = (app: ElectronApplication): Promise<number> =>
  app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getZoomLevel());

test('keybindings.json drives accelerators at startup and hot-reloads', async () => {
  const cfg = mkdtempSync(join(tmpdir(), 'throng-cfgroot-'));
  try {
    // Seed BEFORE launch: zoom.in is bound to F8 (proves cross-session read).
    mkdirSync(cfg, { recursive: true });
    writeFileSync(
      join(cfg, 'keybindings.json'),
      JSON.stringify({ version: 1, bindings: { 'zoom.in': ['F8'] } }, null, 2),
      'utf8',
    );

    await runApp(
      async (app, win) => {
        await expect.poll(() => zoomLevel(app)).toBe(0);
        await win.waitForTimeout(600); // let the renderer pull keybindings (config.get)
        await win.locator('body').click(); // ensure the window has keyboard focus
        await win.keyboard.press('F8');
        await expect.poll(() => zoomLevel(app), { timeout: 5000 }).toBeGreaterThan(0);
        const afterFirst = await zoomLevel(app);

        // Hot-reload: rebind zoom.in to F9 → pressing F9 now zooms.
        writeFileSync(
          join(cfg, 'keybindings.json'),
          JSON.stringify({ version: 1, bindings: { 'zoom.in': ['F9'] } }, null, 2),
          'utf8',
        );
        await win.waitForTimeout(500); // watcher debounce + re-read
        await win.keyboard.press('F9');
        await expect.poll(() => zoomLevel(app), { timeout: 5000 }).toBeGreaterThan(afterFirst);
      },
      { env: { THRONG_CONFIG_ROOT: cfg } },
    );
  } finally {
    rmSync(cfg, { recursive: true, force: true });
  }
});
