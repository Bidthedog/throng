import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import type { ElectronApplication } from '@playwright/test';
import {
  openApp,
  runApp as runOwnApp,
  cleanupTemp,
  type AppOptions,
  type OpenApp,
} from './harness.js';

/*
 * ONE app for this file, not one per test.
 *
 * Each test used to launch its own Electron app, daemon and window — roughly two seconds apiece, and
 * 604 such launches across the suite — to run assertions that never needed a pristine app. Only a
 * test that seeds state BEFORE launch genuinely does, and those keep their own app via `runOwnApp`.
 *
 * The shims below exist so the test bodies below are unchanged:
 *   runApp        runs the body against the shared window. It refuses options rather than ignoring
 *                 them: a dropped config root does not fail, it passes for the wrong reason.
 *   createProject appends a counter, because a shared app accumulates projects and duplicate names
 *                 make `.project-item` ambiguous.
 *
 * Serial mode is required — shared window, shared database — and it means a failure skips the rest
 * rather than running them against whatever state the failure left behind.
 */
test.describe.configure({ mode: 'serial' });

let shared: OpenApp;
test.beforeAll(async () => {
  shared = await openApp();
});
test.afterAll(async () => {
  await shared?.close();
});

const runApp = (
  fn: (app: OpenApp['app'], win: OpenApp['win'], ctx: { pipeName: string; userDataDir: string }) => Promise<void>,
  opts?: AppOptions,
): Promise<void> => {
  if (opts) {
    throw new Error(
      'this file shares one app; a test needing launch options must call runOwnApp instead',
    );
  }
  return fn(shared.app, shared.win, {
    pipeName: shared.pipeName,
    userDataDir: shared.userDataDir,
  });
};


/**
 * US1 (007 Phase A): the application-drawn title bar replaces the OS chrome — a
 * full-width bar above the panes bar with working window controls and a cog that
 * opens the single shared, parented, movable preferences window on the matching
 * tab. 021 made that window NON-MODAL: the main + sub windows stay INTERACTIVE while
 * it is open (it floats above the main window rather than blocking it), so a theme
 * can be edited and watched on the live application at once.
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

test('title bar spans the top and hosts the cog + window controls', { tag: ['@extended', '@window', '@reserve:layout'] }, async () => {
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
    cleanupTemp(dir);
});

test('the cog dropdown menu follows the active theme (018/021, FR-008/FR-023)', { tag: ['@extended', '@window', '@reserve:layout'] }, async () => {
  // A theme file carrying `surface`, `surfaceActive` and `accent`. 021 (FR-023) folded the menu card
  // onto `surfaceActive` (the old `menuSurface` is gone), so the cog dropdown — a shared context menu
  // — paints on the theme's OWN `surfaceActive`. This is the end-to-end proof that the menu card
  // follows the theme: the user's theme colours reach the menu, not a hardcoded default.
  const cfgRoot = seedThemeSurfaces('#ff00aa', '#00cc55', '#ffcc00');
  const SURFACE_ACTIVE = 'rgb(0, 204, 85)';
  const ACCENT = 'rgb(255, 204, 0)';
  await runOwnApp(
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

test('window controls maximise/restore (button + double-click) and minimise', { tag: ['@extended', '@window', '@reserve:window'] }, async () => {
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

test('cog opens the single shared preferences window on the matching tab; non-modal + movable', { tag: ['@extended', '@window', '@reserve:focus'] }, async () => {
  /*
   * Its OWN app. The subject here is the cog OPENING that window, and there is only one of them per
   * app — so if any earlier test in this file has already opened it, the cog re-uses it, no `window`
   * event is emitted, and the wait below hangs. Sharing an app is right for this file generally and
   * wrong for the one test whose subject is the window's creation.
   */
  await runOwnApp(async (app, win) => {
    // Settings → the prefs window opens on the Settings tab.
    await win.getByTestId('title-bar-cog').click();
    const [prefs] = await Promise.all([
      app.waitForEvent('window'),
      win.getByTestId('cog-menu-settings').click(),
    ]);
    await prefs.waitForLoadState('domcontentloaded');
    await expect(prefs.getByTestId('preferences-window')).toBeVisible();
    await expect(prefs.getByTestId('prefs-tab-settings')).toHaveAttribute('aria-selected', 'true');

    /*
     * Exactly one preferences window; it is NON-MODAL (021) — the main window stays INTERACTIVE
     * (enabled) so the app can be used while a theme is edited — and it is PARENTED to the main
     * window. It remains movable (FR-014).
     *
     * ══ WHY `alwaysOnTop` IS NOW TRUE WHILE THRONG HAS FOCUS (032, #263 follow-up) ══
     *
     * This used to assert `false` outright, reading FR-013 as "never globally on top". Parenting
     * was doing the work: a parented child stays above its parent even when the parent is clicked.
     *
     * That only ever covered the MAIN window. A sub-workspace is a separate top-level window with
     * no parent relationship to Preferences, so nothing ordered the two — and among siblings there
     * is no defined order. The gap was invisible while sub-workspaces opened DISABLED, because a
     * window that cannot be focused cannot be raised either; removing that (#263, so they accept
     * input) revealed that the layering had never actually been implemented.
     *
     * `moveTop()` on the other window's focus event does not fix it, and not for a tuning reason:
     * the OS raises the clicked window as part of the same interaction, AFTER the handler runs.
     *
     * So `alwaysOnTop` is held, SCOPED TO THRONG HAVING FOCUS. What FR-013 actually promises is
     * "above throng's own windows, not above other applications", and that is preserved exactly —
     * alt-tab to a browser and every throng window drops behind, Preferences included. The flag is
     * therefore true here, where throng is focused, and false the moment it is not.
     */
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
    expect(modal.mainEnabled).toBe(true); // 021: non-modal — the main window stays interactive
    expect(modal.prefsMovable).toBe(true);
    // Held while THRONG has focus, which it does here — that is what keeps Preferences above a
    // sub-workspace, which parenting cannot reach. Dropped the moment throng is not focused, which
    // is what keeps FR-013's real promise: above throng's windows, never above other applications.
    expect(modal.prefsAlwaysOnTop).toBe(true);
    expect(modal.prefsParentIsMain).toBe(true); // FR-013: parented to the main window (floats above it)

    // Re-invoking focuses the SAME window and switches its tab (FR-010/011). The main
    // window is interactive now, but driving it through the bridge is still the most
    // direct way to re-invoke regardless of which window holds focus.
    await win.evaluate(() => window.throng?.openPreferences?.('themes'));
    await expect(prefs.getByTestId('prefs-tab-themes')).toHaveAttribute('aria-selected', 'true');
    expect((await mainWindowState(app)).windowCount).toBe(2); // still one prefs window

    // Closing preferences returns focus to the main window (FR-013a — no other-app
    // window is left overlaying throng). It was interactive throughout (non-modal).
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
// re-asserted as a standalone E2E because programmatically minimising/restoring the
// main window and observing the child follow is not deterministic under the
// Playwright/Electron harness (the OS window-state round-trip doesn't fire reliably);
// the parenting that produces the behaviour IS verified structurally.
