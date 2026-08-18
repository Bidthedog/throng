/**
 * US4 (#139) — "About throng" paints its static content immediately and loads the third-party
 * packages list asynchronously, showing a loading affordance until it populates in place; closing
 * the dialog before the list resolves cancels the load (no orphaned work).
 */
import { test, expect } from '@playwright/test';
import { openApp, type AppOptions, type OpenApp } from './harness.js';

/*
 * ONE app for this file, not one per test (034 FR-045, SC-027) — 2 launches -> 1.
 *
 * Nothing is seeded before launch and neither test writes a file. The ONLY thing that made this
 * file two apps is the About window itself: it is a SINGLETON and APP-MODAL
 * (about-window.ts:44 create-or-focus, :52 setEnabled(false) on every window), so a window left
 * open by test 1 turns test 2's waitForEvent('window') into a wait for an event that can never
 * fire, and leaves the main window disabled so the cog click cannot land either. Both are HANGS,
 * not failures.
 *
 * The afterEach below is the whole conversion, and it is the one already shipped in
 * about.e2e.ts:147 — close every about=1 page and POLL until the main process has run that
 * window's own 'closed' handler, which is what nulls the singleton and re-enables every window
 * (about-window.ts:92-100). A closed Page is not yet a closed BrowserWindow.
 *
 * Serial mode is not optional — one window, one daemon.
 */

test.describe.configure({ mode: 'serial' });

let shared: OpenApp;

test.beforeAll(async () => {
  shared = await openApp();
});

test.afterAll(async () => {
  await shared?.close();
});

test.afterEach(async () => {
  if (!shared) return; // beforeAll failed; there is nothing to close
  for (const page of shared.app.windows()) {
    if (!page.isClosed() && page.url().includes('about=1')) await page.close().catch(() => {});
  }
  await expect
    .poll(() => shared.app.windows().filter((w) => w.url().includes('about=1')).length, {
      timeout: 5000,
    })
    .toBe(0);
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

test('About paints static content, then loads the third-party list asynchronously (#139)', { tag: ['@extended', '@window'] }, async () => {
  await runApp(async (app, win) => {
    await win.getByTestId('title-bar-cog').click();
    const [about] = await Promise.all([
      app.waitForEvent('window', { timeout: 15_000 }),
      win.getByTestId('cog-menu-about').click(),
    ]);
    await about.waitForLoadState('domcontentloaded', { timeout: 15_000 });

    // Static identity is present without waiting on the packages list (FR-014).
    await expect(about.getByTestId('about-version')).not.toHaveText('');
    await expect(about.getByTestId('about-build-id')).not.toHaveText('');

    // The packages list loads asynchronously and populates in place (FR-015/FR-017); once ready,
    // the loading affordance is gone and the real content (the full closure) is shown.
    await expect(about.getByTestId('about-thirdparty')).toContainText('better-sqlite3');
    await expect(about.getByTestId('about-thirdparty-loading')).toHaveCount(0);
    expect(await about.getByTestId('about-thirdparty').getByRole('listitem').count()).toBeGreaterThan(50);
  });
});

test('closing About before the list resolves cancels the load without error (#139)', { tag: ['@extended', '@window'] }, async () => {
  const errors: string[] = [];
  await runApp(async (app, win) => {
    win.on('pageerror', (e) => errors.push(String(e)));
    await win.getByTestId('title-bar-cog').click();
    const [about] = await Promise.all([
      app.waitForEvent('window', { timeout: 15_000 }),
      win.getByTestId('cog-menu-about').click(),
    ]);
    about.on('pageerror', (e) => errors.push(String(e)));
    // Close immediately — the in-flight getThirdParty() result is dropped by the `active` guard
    // (FR-016); no "setState on unmounted" or navigation error is raised.
    await about.close();
    // Wait for the CLOSE to actually finish rather than a fixed pause: about-window.ts's own
    // 'closed' handler re-enables every other window once it runs, which is the same handler that
    // any late reaction to the close (in either window) would follow.
    await expect
      .poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isEnabled()))
      .toBe(true);
  });
  expect(errors, `renderer errors on early close:\n${errors.join('\n')}`).toEqual([]);
});
