import { test, expect } from '@playwright/test';
import type { ElectronApplication } from '@playwright/test';
import { runApp } from './harness.js';

// Collapse/expand is animated (grid columns transition), and the layout is pinned
// so the bottom status bar (fixed height) and the right pane (fixed width, on the
// right) stay in place during window resizes — no smear/ghost.

test('the side panes animate (grid-template-columns transition)', async () => {
  await runApp(async (_app, win) => {
    await expect(win.getByTestId('throng-shell')).toBeVisible();
    const transition = await win.evaluate(
      () => getComputedStyle(document.querySelector('[data-testid="throng-shell"]')!).transitionProperty,
    );
    expect(transition).toContain('grid-template-columns');
  });
});

test('status bar is fixed-height at the bottom and the right pane is pinned right, across resizes', async () => {
  await runApp(async (app: ElectronApplication, win) => {
    await expect(win.getByTestId('status-bar')).toBeVisible();
    await expect(win.getByTestId('file-explorer-pane')).toBeVisible();
    const measure = () =>
      win.evaluate(() => {
        const sb = (document.querySelector('[data-testid="status-bar"]') as HTMLElement).getBoundingClientRect();
        const rp = (document.querySelector('[data-testid="file-explorer-pane"]') as HTMLElement).getBoundingClientRect();
        return {
          iw: window.innerWidth,
          ih: window.innerHeight,
          sbHeight: Math.round(sb.height),
          sbBottom: sb.bottom,
          sbLeft: sb.left,
          sbRight: sb.right,
          rpRight: rp.right,
          rpWidth: Math.round(rp.width),
        };
      });

    const before = await measure();
    expect(before.sbHeight).toBe(24); // fixed-height status bar
    expect(Math.abs(before.sbBottom - before.ih)).toBeLessThanOrEqual(1); // anchored to the bottom
    expect(before.sbLeft).toBeLessThanOrEqual(1);
    expect(Math.abs(before.sbRight - before.iw)).toBeLessThanOrEqual(1); // spans full width
    expect(Math.abs(before.rpRight - before.iw)).toBeLessThanOrEqual(1); // right pane pinned right

    // Resize the window — everything stays anchored, status bar height unchanged.
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(900, 620));
    await win.waitForTimeout(250);
    const after = await measure();
    expect(after.sbHeight).toBe(24);
    expect(Math.abs(after.sbBottom - after.ih)).toBeLessThanOrEqual(1);
    expect(Math.abs(after.sbRight - after.iw)).toBeLessThanOrEqual(1);
    expect(Math.abs(after.rpRight - after.iw)).toBeLessThanOrEqual(1); // still pinned right
    expect(after.rpWidth).toBe(before.rpWidth); // right pane width fixed
  });
});
