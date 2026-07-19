import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import type { ElectronApplication } from '@playwright/test';
import { runApp } from './harness.js';

/**
 * US1 (007 Phase A): the application-drawn title bar replaces the OS chrome — a
 * full-width bar above the panes bar with working window controls and a cog that
 * opens the single shared, always-on-top, movable preferences window on the
 * matching tab; the main + sub windows are non-interactive while it is open.
 */

/** State of the earliest-created (main) window, read in the main process. */
function mainWindowState(app: ElectronApplication): Promise<{
  minimized: boolean;
  maximized: boolean;
  enabled: boolean;
  windowCount: number;
}> {
  return app.evaluate(({ BrowserWindow }) => {
    const wins = BrowserWindow.getAllWindows().sort((a, b) => a.id - b.id);
    const main = wins[0];
    return {
      minimized: main.isMinimized(),
      maximized: main.isMaximized(),
      enabled: main.isEnabled(),
      windowCount: wins.length,
    };
  });
}

test('title bar spans the top and hosts the cog + window controls', async () => {
  await runApp(async (app, win) => {
    const bar = win.getByTestId('title-bar');
    await expect(bar).toBeVisible();

    // Full-width, pinned to the very top of the window (no OS bar above it).
    const box = await bar.boundingBox();
    const viewport = win.viewportSize();
    expect(box).not.toBeNull();
    expect(box!.y).toBeLessThanOrEqual(1);
    if (viewport) expect(box!.width).toBeGreaterThanOrEqual(viewport.width - 2);

    // The cog and the three window controls are present (extensible action area).
    await expect(win.getByTestId('title-bar-cog')).toBeVisible();
    await expect(win.getByTestId('window-min')).toBeVisible();
    await expect(win.getByTestId('window-max')).toBeVisible();
    await expect(win.getByTestId('window-close')).toBeVisible();

    // The cog is a standard, uniform gear glyph (H3, FR-005) — a single svg icon.
    await expect(win.getByTestId('cog-glyph')).toHaveCount(1);
  });
});

test('the cog reveals exactly Settings / Key Bindings / Themes and is dismissible', async () => {
  await runApp(async (_app, win) => {
    await win.getByTestId('title-bar-cog').click();
    const menu = win.getByTestId('cog-menu');
    await expect(menu).toBeVisible();
    await expect(menu.getByRole('menuitem')).toHaveText(['Settings', 'Key Bindings', 'Themes', 'About throng']);
    // Dismiss without a selection.
    await win.keyboard.press('Escape');
    await expect(menu).toBeHidden();
  });
});

// The cog dropdown must re-theme with the active theme (FR-030). Its surfaces are
// styled from `--surface` / `--surface-active`, which must resolve to the theme's
// tokens rather than silently falling back to a hardcoded literal.
const cfgRoots: string[] = [];
function seedThemeSurfaces(surface: string, surfaceActive: string, accent?: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'throng-cfg-chrome-'));
  cfgRoots.push(dir);
  mkdirSync(join(dir, 'themes'), { recursive: true });
  const colours: Record<string, string> = { surface, surfaceActive };
  if (accent !== undefined) colours.accent = accent;
  writeFileSync(
    join(dir, 'themes', 'throng.json'),
    JSON.stringify({ name: 'throng', colours }, null, 2),
    'utf8',
  );
  return dir;
}
test.afterAll(() => {
  for (const dir of cfgRoots.splice(0))
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
});

test('the cog dropdown menu follows the active theme (018/021, FR-008/FR-023)', async () => {
  // A theme file carrying `surface`, `surfaceActive` and `accent`. 021 (FR-023) folded the menu card
  // onto `surfaceActive` (the old `menuSurface` is gone), so the cog dropdown — a shared context menu
  // — paints on the theme's OWN `surfaceActive`. This is the end-to-end proof that the menu card
  // follows the theme: the user's theme colours reach the menu, not a hardcoded default.
  const cfgRoot = seedThemeSurfaces('#ff00aa', '#00cc55', '#ffcc00');
  const SURFACE_ACTIVE = 'rgb(0, 204, 85)';
  const ACCENT = 'rgb(255, 204, 0)';
  await runApp(
    async (_app, win) => {
      await win.getByTestId('title-bar-cog').click();
      const menu = win.getByTestId('cog-menu');
      await expect(menu).toBeVisible();

      // The menu card resolves `surfaceActive` — the theme's own value, not throng's default.
      await expect
        .poll(() => menu.evaluate((el) => getComputedStyle(el).backgroundColor))
        .toBe(SURFACE_ACTIVE);

      // A hovered item paints on the MENU HIGHLIGHT, which is carved out of `accent`.
      //
      // This is a deliberate change from the pre-split behaviour (it used to follow `surfaceActive`)
      // and it is the whole point of FR-013: the cog menu now highlights exactly as the shared
      // context menu always has, because there is one menu implementation and the shared one is the
      // survivor. Two menus that highlighted differently was the defect.
      const item = win.getByTestId('cog-menu-settings');
      await item.hover();
      await expect
        .poll(() => item.evaluate((el) => getComputedStyle(el).backgroundColor))
        .toBe(ACCENT);
    },
    { env: { THRONG_CONFIG_ROOT: cfgRoot } },
  );
});

test('window controls maximise/restore (button + double-click) and minimise', async () => {
  await runApp(async (app, win) => {
    // Maximise then restore via the control.
    await win.getByTestId('window-max').click();
    await expect.poll(async () => (await mainWindowState(app)).maximized).toBe(true);
    await win.getByTestId('window-max').click();
    await expect.poll(async () => (await mainWindowState(app)).maximized).toBe(false);

    // Double-clicking the drag region toggles maximise (FR-004).
    await win.getByTestId('title-bar-identity').dblclick();
    await expect.poll(async () => (await mainWindowState(app)).maximized).toBe(true);
    // Restore for the following steps.
    await app.evaluate(({ BrowserWindow }) => {
      const main = BrowserWindow.getAllWindows().sort((a, b) => a.id - b.id)[0];
      if (main.isMaximized()) main.unmaximize();
    });

    // Minimise, then restore in the main process so the run can continue.
    await win.getByTestId('window-min').click();
    await expect.poll(async () => (await mainWindowState(app)).minimized).toBe(true);
    await app.evaluate(({ BrowserWindow }) => {
      const main = BrowserWindow.getAllWindows().sort((a, b) => a.id - b.id)[0];
      main.restore();
    });
  });
});

test('cog opens the single shared preferences window on the matching tab; app-modal + movable', async () => {
  await runApp(async (app, win) => {
    // Settings → the prefs window opens on the Settings tab.
    await win.getByTestId('title-bar-cog').click();
    const [prefs] = await Promise.all([
      app.waitForEvent('window'),
      win.getByTestId('cog-menu-settings').click(),
    ]);
    await prefs.waitForLoadState('domcontentloaded');
    await expect(prefs.getByTestId('preferences-window')).toBeVisible();
    await expect(prefs.getByTestId('prefs-tab-settings')).toHaveAttribute('aria-selected', 'true');

    // Exactly one preferences window; the main window is non-interactive but the
    // preferences window remains movable (FR-013/014). Post-2026-07-08: the prefs
    // window is PARENTED to the main window and is NOT globally always-on-top
    // (FR-013 — above throng only, not above other OS apps).
    const modal = await app.evaluate(({ BrowserWindow }) => {
      const wins = BrowserWindow.getAllWindows().sort((a, b) => a.id - b.id);
      const [main, ...rest] = wins;
      const prefsWin = rest[rest.length - 1];
      return {
        windowCount: wins.length,
        mainEnabled: main.isEnabled(),
        prefsMovable: prefsWin.isMovable(),
        prefsAlwaysOnTop: prefsWin.isAlwaysOnTop(),
        prefsParentIsMain: prefsWin.getParentWindow()?.id === main.id,
      };
    });
    expect(modal.windowCount).toBe(2);
    expect(modal.mainEnabled).toBe(false);
    expect(modal.prefsMovable).toBe(true);
    expect(modal.prefsAlwaysOnTop).toBe(false); // FR-013: not globally on top
    expect(modal.prefsParentIsMain).toBe(true); // FR-013: parented to the main window

    // Re-invoking focuses the SAME window and switches its tab (FR-010/011). The
    // main window is OS-disabled, but its renderer JS still runs, so drive it
    // through the bridge directly.
    await win.evaluate(() => window.throng?.openPreferences?.('themes'));
    await expect(prefs.getByTestId('prefs-tab-themes')).toHaveAttribute('aria-selected', 'true');
    expect((await mainWindowState(app)).windowCount).toBe(2); // still one prefs window

    // Closing preferences re-enables the main window and returns focus to it
    // (FR-013a — no other-app window is left overlaying throng).
    await prefs.getByTestId('window-close').click();
    await expect.poll(async () => (await mainWindowState(app)).windowCount).toBe(1);
    expect((await mainWindowState(app)).enabled).toBe(true);
    await expect
      .poll(() =>
        app.evaluate(({ BrowserWindow }) => {
          const main = BrowserWindow.getAllWindows().sort((a, b) => a.id - b.id)[0];
          return main.isFocused();
        }),
      )
      .toBe(true);
  });
});

// NB: "minimise/restore together with the main window" (FR-013a) is delivered by
// the native `parent` window relationship asserted above (prefsParentIsMain) — a
// parented child minimises/returns with its parent at the OS level. It is not
// re-asserted as a standalone E2E because programmatically minimising/restoring an
// app-modal (disabled) main window is not deterministic under the Playwright/Electron
// harness (the OS window-state round-trip doesn't fire reliably); the parenting that
// produces the behaviour IS verified structurally.
