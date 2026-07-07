import { test, expect } from '@playwright/test';
import type { ElectronApplication } from '@playwright/test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runApp } from './harness.js';

// The side-pane maximum width is user-configurable per pane in settings.json
// (panes.projects.maxWidth). With a custom max of 300, dragging the sidebar handle
// far out must cap at 300 — not the default.

test('the side-pane maximum width is configurable in settings.json', async () => {
  const cfg = mkdtempSync(join(tmpdir(), 'throng-cfgmax-'));
  writeFileSync(
    join(cfg, 'settings.json'),
    JSON.stringify({ panes: { projects: { maxWidth: 300 } } }),
  );
  try {
    await runApp(
      async (app: ElectronApplication, win) => {
        await app.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()[0].setSize(1500, 800),
        );
        await win.waitForTimeout(300); // let the config payload apply
        const widthOf = (): Promise<number> =>
          win.evaluate(() =>
            Math.round((document.querySelector('.pane--sidebar') as HTMLElement).getBoundingClientRect().width),
          );

        // Drag the sidebar resize handle far to the right — it must cap at 300.
        const h = await win.getByTestId('sidebar-hresize').boundingBox();
        if (!h) throw new Error('no sidebar handle');
        await win.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
        await win.mouse.down();
        await win.mouse.move(h.x + 1000, h.y + h.height / 2, { steps: 10 });
        await win.mouse.up();
        await win.waitForTimeout(100);

        const w = await widthOf();
        expect(w).toBeLessThanOrEqual(305); // configured max 300 (default would allow 400)
        expect(w).toBeGreaterThanOrEqual(295);
      },
      { env: { THRONG_CONFIG_ROOT: cfg } },
    );
  } finally {
    rmSync(cfg, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
