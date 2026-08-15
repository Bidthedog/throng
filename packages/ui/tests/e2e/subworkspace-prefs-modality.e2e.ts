import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import type { ElectronApplication } from '@playwright/test';
import { cleanupTemp, runApp } from './harness.js';

/**
 * #263 — a sub-workspace opened while Preferences is open must still be interactive.
 *
 * ══ THE DEFECT ══
 *
 * Feature 007 made the Preferences window app-modal: opening it disabled every other window, and any
 * window created afterwards was disabled on creation so Preferences stayed the only live surface.
 *
 * Spec 021 FR-042 reversed that, in terms that leave nothing to interpret:
 *
 *     "The Preferences window MUST be non-modal: opening it MUST NOT disable any other window...
 *      (Supersedes the app-modal setEnabled(false) behaviour of 007 FR-013/FR-014.)"
 *
 * `preferences-window.ts` was updated and says so — "deliberately NOT app-modal: every other window
 * stays INTERACTIVE". What was missed is the OTHER half of the old behaviour: the two
 * `setEnabled(false)` calls on the window-CREATION paths in `main.ts`, which fire when a window is
 * born while Preferences happens to be open.
 *
 * So the app is non-modal for every window that already existed, and app-modal for every window
 * created afterwards. A sub-workspace opened while Preferences is up paints, and accepts nothing.
 *
 * And because the disable happened at creation rather than as part of an open/close pairing, there
 * was nothing to undo it: closing Preferences left the sub-workspace permanently dead. That is the
 * issue's "bug 2", and it needs no separate fix — a window that is never disabled needs no
 * re-enabling.
 *
 * ══ WHY THE ASSERTION GOES THROUGH `app.evaluate` ══
 *
 * `setEnabled(false)` is a NATIVE window property. The renderer cannot observe it: the DOM is
 * identical, the CSS is identical, and clicks simply never arrive. A test driving the page would see
 * a perfectly healthy window and pass. So the check asks Electron's main process directly, which is
 * the only place the truth exists.
 */
const seedSub = `(() => window.throng.invoke('workspace.persistSubWorkspaces', { subWorkspaces: [
  { id: 'sw1', ownerUser: 'u', name: 'Detached A', colour: '#3fb950',
    bounds: { x: 0, y: 0, width: 500, height: 380 },
    tabs: [{ id: 't', title: 'T', root: { type: 'panel', id: 'p', originProjectId: 'x', title: 'P' } }] },
] }))()`;

/** Every window's enabled state, straight from main — the only place `setEnabled` is visible. */
async function enabledStates(app: ElectronApplication): Promise<boolean[]> {
  return app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .filter((w) => !w.isDestroyed())
      .map((w) => w.isEnabled()),
  );
}

test('a sub-workspace opened while Preferences is open is interactive (#263)', async () => {
  test.setTimeout(120_000);
  const cfgRoot = mkdtempSync(join(tmpdir(), 'throng-cfg-263-'));

  try {
    await runApp(
      async (app, win) => {
        await win.waitForSelector('.throng-shell', { timeout: 15_000 });

        // A sub-workspace to open later. Seeded and reloaded so the row exists in the sidebar.
        await win.evaluate(seedSub);
        await win.reload();
        await win.waitForSelector('.throng-shell', { timeout: 15_000 });
        await expect(win.getByTestId('subworkspace-name-sw1')).toHaveText('Detached A');

        // ── Preferences first. This is the whole precondition: the sub-workspace window is created
        //    while Preferences is already open, which is the path that still disabled it.
        await win.getByTestId('title-bar-cog').click();
        const [prefs] = await Promise.all([
          app.waitForEvent('window', { timeout: 15_000 }),
          win.getByTestId('cog-menu-settings').click(),
        ]);
        await prefs.waitForLoadState('domcontentloaded', { timeout: 15_000 });
        await expect(prefs.getByTestId('settings-tab')).toBeVisible();

        // FR-042 already, for the windows that existed before Preferences opened.
        expect(
          await enabledStates(app),
          'opening Preferences must not disable any existing window (021 FR-042)',
        ).not.toContain(false);

        // ── Now open the sub-workspace, with Preferences still up.
        const [child] = await Promise.all([
          app.waitForEvent('window', { timeout: 15_000 }),
          win.getByTestId('subworkspace-open-sw1').click(),
        ]);
        await child.waitForLoadState('domcontentloaded', { timeout: 15_000 });
        await child.waitForSelector('.throng-shell', { timeout: 15_000 });

        /*
         * BUG 1 — the sub-workspace is born disabled.
         *
         * Asserted on EVERY window rather than just the newest: the failure is that some window is
         * disabled, and naming which one in advance assumes the very ordering the bug disturbs.
         */
        expect(
          await enabledStates(app),
          'a window created while Preferences is open must not be disabled (#263, 021 FR-042)',
        ).not.toContain(false);

        /*
         * ── AND PREFERENCES OWNS THE TOP OF THE STACK WHILE THRONG HAS FOCUS.
         *
         * Interactivity and layering are separate properties, and the old `setEnabled(false)` was
         * quietly providing both: a window that cannot be focused cannot be raised either. Removing
         * it fixed the first and exposed that the second had never been implemented for
         * sub-workspaces — Preferences is parented to the MAIN window, and a sub-workspace is a
         * sibling with no defined order against it.
         *
         * A first attempt raised Preferences with `moveTop()` on the other window's focus event.
         * That does not hold, for a structural reason rather than a tuning one: the OS raises the
         * clicked window as part of the same interaction, AFTER the handler runs. It was racing the
         * event it was hooked to.
         *
         * So `alwaysOnTop` is used, SCOPED to throng having focus. Its historic objection — that it
         * is OS-global and would float over the user's browser, which 007 reversed once — is
         * answered by dropping the flag the moment no throng window is focused.
         */
        const topmostWhileFocused = await app.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()
            .filter((w) => !w.isDestroyed())
            .some((w) => w.isAlwaysOnTop()),
        );
        expect(
          topmostWhileFocused,
          'Preferences must be topmost while throng has focus, or a sub-workspace can cover it',
        ).toBe(true);

        // ── BUG 2 — and it stays dead after Preferences closes. A consequence of bug 1: nothing
        //    ever re-enables it, because the disable was never part of a pairing.
        await prefs.close();
        await expect
          .poll(() => enabledStates(app), { timeout: 10_000 })
          .not.toContain(false);
      },
      { env: { THRONG_CONFIG_ROOT: cfgRoot } },
    );
  } finally {
    cleanupTemp(cfgRoot);
  }
});
