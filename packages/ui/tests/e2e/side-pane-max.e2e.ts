import { test, expect } from '@playwright/test';
import type { ElectronApplication } from '@playwright/test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runApp, cleanupTemp, settle, geom } from './harness.js';

// The side-pane maximum width is user-configurable per pane in settings.json
// (panes.projects.maxWidth). With a custom max of 300, dragging the sidebar handle
// far out must cap at 300 — not the default.

test('the side-pane maximum width is configurable in settings.json', { tag: ['@extended', '@window', '@reserve:layout'] }, async () => {
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
        // `.throng-shell` is hidden until the config payload — which carries this test's
        // `panes.projects.maxWidth` — has loaded (app.tsx useAppReady), so settling on it is the
        // actual condition "the config payload applied" names.
        await settle(win);

        // Drag the sidebar resize handle far to the right — it must cap at 300.
        const h = await win.getByTestId('sidebar-hresize').boundingBox();
        if (!h) throw new Error('no sidebar handle');
        await win.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
        await win.mouse.down();
        await win.mouse.move(h.x + 1000, h.y + h.height / 2, { steps: 10 });
        await win.mouse.up();

        // not-a-clock: 305 bounds a WIDTH in pixels against the project's configured
        // `panes.projects.maxWidth` of 300 — the drag above asks for 1000px, and the default cap of
        // 400 would let it through, so this is what proves the CONFIGURED maximum is the one in
        // force. Nothing here is timed, so 034 SC-007 does not govern it.
        const w = (await geom(win.locator('.pane--sidebar'))).w;
        expect(w).toBeLessThanOrEqual(305);
        expect(w).toBeGreaterThanOrEqual(295);
      },
      { env: { THRONG_CONFIG_ROOT: cfg } },
    );
  } finally {
    cleanupTemp(cfg);
  }
});
