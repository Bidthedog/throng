/**
 * Regression E2E for issue 132 — the flash of the DEFAULT (dark) theme when a window
 * opens on a LIGHT saved theme.
 *
 * ## The mechanism (why the earlier fix was not enough)
 *
 * The prior work themed each window's native `backgroundColor` from the saved theme and had the
 * preload paint the theme's `--throng-*` tokens onto `<html>` before first paint. Both were
 * necessary and neither was sufficient, because the document's `color-scheme` was hardcoded `dark`
 * in the stylesheet. `color-scheme` governs the colour Chromium paints its viewport CANVAS BACKDROP —
 * the layer BEHIND the (transparent-until-themed) `<html>` — and that backdrop is composited OVER the
 * window's native `backgroundColor`. So on a light theme the backdrop stayed near-black and flashed
 * through on load and around every repaint, in the main window, sub-workspace windows, the
 * preferences window and the About window alike.
 *
 * The fix derives `color-scheme` from the saved theme's app-background lightness and applies it inline
 * (preload, before first paint; re-affirmed by the ThemeProvider on hot-reload). This spec asserts the
 * derived scheme reaches EVERY window kind, plus that the native backing tracks the theme — the two
 * signals that, together, mean "no dark canvas is ever composited over a light window".
 *
 * It deliberately asserts the DERIVED STATE rather than screenshotting a transient flash: the flash is
 * a Chromium compositing artefact of `color-scheme`, so pinning `color-scheme` (and the native backing)
 * to the theme is the exact, deterministic invariant whose violation IS the bug.
 */
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { runApp, reloadWindow } from './harness.js';

const LIGHT_APP_BG = '#f5f6f8'; // the bundled "Light" theme's appBg (default-themes/index.ts)

/** The computed `color-scheme` of a window's document root ("light" | "dark"). */
const colorScheme = (win: Page): Promise<string> =>
  win.evaluate(() => getComputedStyle(document.documentElement).colorScheme);

/** The `--throng-colour-appBg` custom property painted INLINE on `<html>` (proves the preload paint). */
const inlineAppBg = (win: Page): Promise<string> =>
  win.evaluate(() => document.documentElement.style.getPropertyValue('--throng-colour-appBg').trim());

/** The native BrowserWindow backgroundColor (uppercase hex), by window recency. */
function nativeBg(app: ElectronApplication, which: 'main' | 'newest'): Promise<string> {
  return app.evaluate(({ BrowserWindow }, w) => {
    const wins = BrowserWindow.getAllWindows().sort((a, b) => a.id - b.id);
    const target = w === 'main' ? wins[0] : wins[wins.length - 1];
    return target?.getBackgroundColor?.() ?? '(none)';
  }, which);
}

/**
 * Destroy the newest window (a child: About / preferences / sub-workspace) without close-handler
 * hangs — and DO NOT return until Playwright has observed it actually close.
 *
 * The bug this closes (issue #75, theme-flash flake): the test destroys a child window and then
 * *immediately* clicks the cog to open the next one. Destroy is asynchronous, so the reopen could
 * race an incompletely-torn-down window — the cog click landed while focus was mid-transfer, the
 * menu never opened, and `app.waitForEvent('window')` then hung the full test timeout (the 60s
 * attempt-1 hang on run 29909576080). Waiting for the window count to actually drop makes each
 * open start from a settled single-window state.
 */
async function closeNewest(app: ElectronApplication): Promise<void> {
  const before = app.windows().length;
  await app
    .evaluate(({ BrowserWindow }) => {
      const wins = BrowserWindow.getAllWindows().sort((a, b) => a.id - b.id);
      const child = wins[wins.length - 1];
      if (child && wins.length > 1 && !child.isDestroyed()) child.destroy();
    })
    .catch(() => {});
  await expect.poll(() => app.windows().length, { timeout: 10_000 }).toBeLessThan(before);
}

/**
 * Set the active theme by writing settings.json in the (already first-run-populated) config root,
 * then reload the renderer so it starts fresh on that theme — the cold-load path the flash lives on.
 */
async function activateTheme(win: Page, cfgRoot: string, name: string): Promise<void> {
  mkdirSync(join(cfgRoot, 'themes'), { recursive: true });
  writeFileSync(join(cfgRoot, 'settings.json'), JSON.stringify({ appearance: { theme: name } }, null, 2));
  await reloadWindow(win);
  await win.waitForSelector('.throng-shell', { timeout: 8000 });
  await expect.poll(() => win.evaluate(() => document.documentElement.dataset.theme)).toBe(name);
}

const seedSub = `(() => window.throng.invoke('workspace.persistSubWorkspaces', { subWorkspaces: [
  { id: 'sw1', ownerUser: 'u', name: 'Detached A', colour: '#3fb950',
    bounds: { x: 0, y: 0, width: 500, height: 380 },
    tabs: [{ id: 't', title: 'T', root: { type: 'panel', id: 'p', originProjectId: 'x', title: 'P' } }] },
] }))()`;

test('every window kind follows the saved LIGHT theme — no dark canvas flash (issue 132)', async () => {
  const cfg = mkdtempSync(join(tmpdir(), 'throng-flash-cfg-'));
  try {
    await runApp(
      async (app, win) => {
        await activateTheme(win, cfg, 'Light');

        // MAIN window: the scheme follows the light theme, the preload painted the token inline, and
        // the native backing is the light colour — so nothing dark is ever composited over it.
        expect(await colorScheme(win)).toBe('light');
        expect((await inlineAppBg(win)).toLowerCase()).toBe(LIGHT_APP_BG);
        expect((await nativeBg(app, 'main')).toLowerCase()).toBe(LIGHT_APP_BG);

        // ABOUT window (a fresh app-modal BrowserWindow): same three invariants on cold open.
        await win.getByTestId('title-bar-cog').click();
        const [about] = await Promise.all([
          app.waitForEvent('window', { timeout: 15_000 }),
          win.getByTestId('cog-menu-about').click(),
        ]);
        // Bound every child-window readiness wait (issue #75). A bare waitForLoadState defaults to
        // the whole test timeout, so a child window that opens but stalls before domcontentloaded
        // hung the full 30s as an unnamed timeout — the exact non-diagnosable shape run 29909576080
        // showed. An explicit budget turns any recurrence into a fast, named failure that also
        // cannot ride out the worker-teardown budget.
        await about.waitForLoadState('domcontentloaded', { timeout: 15_000 });
        expect(await colorScheme(about)).toBe('light');
        expect((await inlineAppBg(about)).toLowerCase()).toBe(LIGHT_APP_BG);
        expect((await nativeBg(app, 'newest')).toLowerCase()).toBe(LIGHT_APP_BG);
        await closeNewest(app);

        // PREFERENCES window.
        await win.getByTestId('title-bar-cog').click();
        const [prefs] = await Promise.all([
          app.waitForEvent('window', { timeout: 15_000 }),
          win.getByTestId('cog-menu-themes').click(),
        ]);
        await prefs.waitForLoadState('domcontentloaded', { timeout: 15_000 });
        await expect(prefs.getByTestId('themes-tab')).toBeVisible();
        expect(await colorScheme(prefs)).toBe('light');
        expect((await nativeBg(app, 'newest')).toLowerCase()).toBe(LIGHT_APP_BG);
        await closeNewest(app);

        // SUB-WORKSPACE window (its own detached BrowserWindow, same preload + createSubWorkspaceWindow).
        await win.evaluate(seedSub);
        await reloadWindow(win);
        await expect(win.getByTestId('subworkspace-name-sw1')).toHaveText('Detached A');
        const [child] = await Promise.all([
          app.waitForEvent('window', { timeout: 15_000 }),
          win.getByTestId('subworkspace-open-sw1').click(),
        ]);
        await child.waitForLoadState('domcontentloaded', { timeout: 15_000 });
        await child.waitForSelector('.throng-shell', { timeout: 8000 });
        expect(await colorScheme(child)).toBe('light');
        expect((await inlineAppBg(child)).toLowerCase()).toBe(LIGHT_APP_BG);
        expect((await nativeBg(app, 'newest')).toLowerCase()).toBe(LIGHT_APP_BG);
        await closeNewest(app);
      },
      { env: { THRONG_CONFIG_ROOT: cfg } },
    );
  } finally {
    rmSync(cfg, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
  }
});

test('the default (dark) throng theme keeps color-scheme dark — the fix does not over-correct (issue 132)', async () => {
  await runApp(async (_app, win) => {
    await win.waitForSelector('.throng-shell', { timeout: 8000 });
    await expect.poll(() => win.evaluate(() => document.documentElement.dataset.theme)).toBe('throng');
    expect(await colorScheme(win)).toBe('dark');
  });
});
