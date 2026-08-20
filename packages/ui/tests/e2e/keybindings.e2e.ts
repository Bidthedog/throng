import { test, expect } from '@playwright/test';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ElectronApplication, Page } from '@playwright/test';
import { runApp, cleanupTemp} from './harness.js';
import { writeConfigAtomic } from './helpers/config-write.js';

// FR-033 (#1): keyboard accelerators are driven by keybindings.json — edits apply
// across sessions AND hot-reload. We rebind zoom.in to a function key and assert
// the zoom level changes (deterministic, needs no display).

const zoomLevel = (app: ElectronApplication): Promise<number> =>
  app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getZoomLevel());

/**
 * Press `key` until the zoom level rises above `from` — or give up.
 *
 * 032 T031: this replaces two fixed `waitForTimeout` sleeps, and the difference is not tidiness. A
 * sleep waits for a DURATION guessed on one machine; this waits for the CONDITION the test is
 * actually about — "the accelerator is live". Under load the sleep is too short and the test flakes;
 * on an idle machine it is too long and the suite pays for it. The poll is both correct and faster.
 *
 * Pressing inside the poll is what makes it work: a keypress delivered before the binding is
 * installed is simply discarded, so the press has to be retried, not merely the assertion. A single
 * press followed by a retrying assertion would poll a value that nothing is going to change.
 */
async function pressUntilZoomRises(
  win: Page,
  app: ElectronApplication,
  key: string,
  from: number,
): Promise<void> {
  await expect
    .poll(
      async () => {
        await win.keyboard.press(key);
        return zoomLevel(app);
      },
      { timeout: 10_000 },
    )
    .toBeGreaterThan(from);
}

test('keybindings.json drives accelerators at startup and hot-reloads', { tag: ['@extended', '@prefs', '@reserve:input'] }, async () => {
  const cfg = mkdtempSync(join(tmpdir(), 'throng-cfgroot-'));
  try {
    // Seed BEFORE launch: zoom.in is bound to F8 (proves cross-session read). A plain write is
    // correct here and stays — no app is running, no watcher exists, and there is nothing to race.
    mkdirSync(cfg, { recursive: true });
    writeFileSync(
      join(cfg, 'keybindings.json'),
      JSON.stringify({ version: 1, bindings: { 'zoom.in': ['F8'] } }, null, 2),
      'utf8',
    );

    await runApp(
      async (app, win) => {
        await expect.poll(() => zoomLevel(app)).toBe(0);
        await win.locator('body').click(); // ensure the window has keyboard focus
        await pressUntilZoomRises(win, app, 'F8', 0);
        const afterFirst = await zoomLevel(app);

        /*
         * Hot-reload: rebind zoom.in to F9 → pressing F9 now zooms.
         *
         * ATOMICALLY (032 FR-013, G8). The app IS running and IS watching this file, so a plain
         * `writeFileSync` — truncate, then fill — can be read by the watcher while it is empty. It
         * then broadcasts the shipped defaults as though they were the user's bindings, and nothing
         * re-reads, because the writer has finished and the file is not touched again. The rebind is
         * lost rather than late, which is why a longer sleep never helped.
         */
        writeConfigAtomic(
          join(cfg, 'keybindings.json'),
          JSON.stringify({ version: 1, bindings: { 'zoom.in': ['F9'] } }, null, 2),
        );
        await pressUntilZoomRises(win, app, 'F9', afterFirst);
      },
      { env: { THRONG_CONFIG_ROOT: cfg } },
    );
  } finally {
    cleanupTemp(cfg);
  }
});
