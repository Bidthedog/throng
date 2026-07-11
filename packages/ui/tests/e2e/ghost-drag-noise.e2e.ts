import { test, expect } from '@playwright/test';
import { createProject, firstPanelId, runApp } from './harness.js';

// Probe: dragging a Panel/Tab must not spew Chromium widget-rejection errors from
// the drag-ghost OS window (`Message N rejected by interface blink.mojom.Widget`).
test('dragging does not emit blink.mojom.Widget rejections', async () => {
  await runApp(async (app, win) => {
    const stderr: string[] = [];
    const proc = app.process();
    proc.stderr?.setEncoding('utf8');
    proc.stderr?.on('data', (c: string) => stderr.push(c));

    await createProject(win, 'GhostNoise', 'C:/c/ghostnoise');
    await expect(win.locator('.panel-box')).toHaveCount(1);
    const pid = await firstPanelId(win);

    // Start + wiggle + end a Panel drag several times (each triggers ghost start/stop).
    for (let i = 0; i < 5; i += 1) {
      const handle = win.getByTestId(`panel-handle-${pid}`);
      const box = await handle.boundingBox();
      if (!box) throw new Error('no handle box');
      await win.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await win.mouse.down();
      await win.mouse.move(box.x + box.width / 2 + 12, box.y + box.height / 2 + 12, { steps: 4 });
      await win.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2 + 40, { steps: 6 });
      await win.mouse.up();
      await win.waitForTimeout(250);
    }

    const joined = stderr.join('');
    const hits = (joined.match(/blink\.mojom\.Widget/g) ?? []).length;
    console.log(`[probe] blink.mojom.Widget hits: ${hits}`);
    expect(hits, joined).toBe(0);
  });
});
