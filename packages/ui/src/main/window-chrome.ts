import type { OsName } from '@throng/core';
import type { BrowserWindowChromeOptions } from '@throng/platform';

/** The chrome options a secondary window adds on macOS, beside the platform's own. */
export type SecondaryWindowChrome = BrowserWindowChromeOptions & {
  readonly minimizable?: boolean;
  readonly maximizable?: boolean;
  readonly fullscreenable?: boolean;
};

/**
 * The chrome of a secondary window — Preferences, About, the Resource Monitor (070 FR-026).
 *
 * On macOS the title bar draws none of throng's own controls; the native traffic lights stand in for them. So a
 * window that offers fewer controls greys the lights it does not offer: minimise always (none of these windows
 * minimises apart from its parent), zoom unless it offers maximise, and full screen always, since a window parented
 * to the main one does not take a Space of its own. Windows and Linux get the platform's options unchanged; their
 * controls are throng's own, drawn by the title bar.
 */
export function secondaryWindowChrome(
  chrome: BrowserWindowChromeOptions,
  os: OsName,
  offers: { readonly maximise: boolean },
): SecondaryWindowChrome {
  if (os !== 'macos') return chrome;
  return {
    ...chrome,
    minimizable: false,
    ...(offers.maximise ? {} : { maximizable: false }),
    fullscreenable: false,
  };
}

/**
 * The Resource Monitor window's chrome (055 FR-085, 070 FR-026). Its minimise is throng's own — it closes into the
 * status bar — so the OS minimise is off where throng draws that button (Windows, Linux). On macOS the title bar draws
 * no controls, so the yellow light IS the monitor's minimise ({@link routeMonitorMinimise}); full screen stays greyed.
 */
export function monitorWindowChrome(chrome: BrowserWindowChromeOptions, os: OsName): SecondaryWindowChrome {
  return os === 'macos' ? { ...chrome, minimizable: true, fullscreenable: false } : { ...chrome, minimizable: false };
}

/**
 * On macOS, a native minimise of the monitor ends in the status bar, as throng's own Minimise does elsewhere.
 * Electron's `minimize` cannot be cancelled, and macOS has already animated the window away, so throng finishes the
 * reduced-motion form: remember the window and close it. Nothing is routed on Windows or Linux.
 */
export function routeMonitorMinimise(
  win: { on(event: 'minimize', listener: () => void): unknown },
  os: OsName,
  minimise: (opts: { reducedMotion: boolean }) => void,
): void {
  if (os !== 'macos') return;
  win.on('minimize', () => minimise({ reducedMotion: true }));
}
