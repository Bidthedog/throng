import { test, expect } from '@playwright/test';
import type { ElectronApplication } from '@playwright/test';
import { openApp, geom, type AppOptions, type OpenApp } from './harness.js';

/*
 * ONE app for this file, not one per test (034 FR-045, SC-010) — 2 launches -> 1.
 *
 * Nothing is seeded before launch and neither test touches disk or makes a project.
 *
 * The only leftover is the WINDOW SIZE: test 2 sets it to 900x620 (:47) and never restores it. Test
 * 1 reads only `transitionProperty` so it does not care today — but that is the reasoning that
 * breaks a file the day someone adds a third test, so the size is captured once and put back after
 * every test.
 *
 * The shim below REFUSES launch options rather than ignoring them.
 *
 * Serial mode is not optional — one window, so a failure SKIPS the rest rather than running them
 * against what it left behind.
 */
test.describe.configure({ mode: 'serial' });

let shared: OpenApp;
let defaultSize: number[];

test.beforeAll(async () => {
  shared = await openApp();
  defaultSize = await shared.app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0]!.getSize(),
  );
});

/*
 * The one piece of window state a test here changes and does not change back.
 *
 * In an `afterEach` rather than a `finally` inside the test: this way it also runs on the failure
 * path, and on a test added later that forgets — and not one line of any test body has to move, so
 * nothing about what these tests assert can have changed with it.
 */
test.afterEach(async () => {
  await shared.app.evaluate(({ BrowserWindow }, [w, h]) => {
    BrowserWindow.getAllWindows()[0]?.setSize(w!, h!);
  }, defaultSize);
});

test.afterAll(async () => {
  await shared?.close();
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

// Collapse/expand is animated (grid columns transition), and the layout is pinned
// so the bottom status bar (fixed height) and the right pane (fixed width, on the
// right) stay in place during window resizes — no smear/ghost.

test('the side panes animate (grid-template-columns transition)', { tag: ['@extended', '@window', '@reserve:layout'] }, async () => {
  await runApp(async (_app, win) => {
    await expect(win.getByTestId('throng-shell')).toBeVisible();
    const transition = await win.evaluate(
      () => getComputedStyle(document.querySelector('[data-testid="throng-shell"]')!).transitionProperty,
    );
    expect(transition).toContain('grid-template-columns');
  });
});

test('status bar is fixed-height at the bottom and the right pane is pinned right, across resizes', { tag: ['@extended', '@window', '@reserve:layout'] }, async () => {
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

    // Resize the window — everything stays anchored, status bar height unchanged. Wait for the
    // pinned right pane to stop moving (the resize propagates through a CSS grid transition)
    // before measuring, rather than assuming a fixed duration is always enough.
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(900, 620));
    await geom(win.getByTestId('file-explorer-pane'));
    const after = await measure();
    expect(after.sbHeight).toBe(24);
    expect(Math.abs(after.sbBottom - after.ih)).toBeLessThanOrEqual(1);
    expect(Math.abs(after.sbRight - after.iw)).toBeLessThanOrEqual(1);
    expect(Math.abs(after.rpRight - after.iw)).toBeLessThanOrEqual(1); // still pinned right
    expect(after.rpWidth).toBe(before.rpWidth); // right pane width fixed
  });
});
