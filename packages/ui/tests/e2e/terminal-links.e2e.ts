/**
 * US7 (#159, spec 024): a renderer that opens a browser window is DENIED at the main process; an
 * http(s) target is instead handed to the OS opener, and nothing opens an in-app browser (FR-019b).
 *
 * This is the reported #159 bug's root: an OSC 8 link (and any window.open) used to spawn a new
 * in-app BrowserWindow. On origin/master this test fails — a window is created and no openExternal
 * routing happens. Driving window.open directly is the reliable way to exercise the guard (a precise
 * Ctrl+click on an xterm canvas link is not scriptable); the Ctrl+click routing logic is unit-tested.
 */
import { test, expect } from '@playwright/test';
import { runApp, createProject } from './harness.js';

test('a renderer-opened window is denied; http(s) is routed to the OS opener (#159)', async () => {
  await runApp(async (app, win) => {
    await createProject(win, 'LinksProj', 'C:/c/links');

    // Intercept shell.openExternal and record the baseline window count.
    await app.evaluate(({ shell }) => {
      const w = globalThis as unknown as { __ext?: string[] };
      w.__ext = [];
      const orig = shell.openExternal.bind(shell);
      shell.openExternal = (url: string, opts?: unknown) => {
        w.__ext!.push(url);
        return Promise.resolve();
        void orig;
        void opts;
      };
    });
    const before = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);

    // A renderer opens an https window → denied (no new window), routed to the OS opener.
    await win.evaluate(() => window.open('https://example.com/from-renderer'));
    await expect
      .poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length))
      .toBe(before);
    const routed = await app.evaluate(
      () => (globalThis as unknown as { __ext?: string[] }).__ext ?? [],
    );
    expect(routed).toContain('https://example.com/from-renderer');

    // A javascript: target → denied AND not routed anywhere (the injection guard).
    await win.evaluate(() => window.open('javascript:alert(1)'));
    await expect
      .poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length))
      .toBe(before);
    const routed2 = await app.evaluate(
      () => (globalThis as unknown as { __ext?: string[] }).__ext ?? [],
    );
    expect(routed2).not.toContain('javascript:alert(1)');
  });
});
