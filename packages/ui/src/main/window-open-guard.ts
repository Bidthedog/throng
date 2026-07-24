/**
 * Deny renderer-opened browser windows (024 US7, #159 / FR-019b).
 *
 * The reported bug: a URL activated in a terminal (an OSC 8 link, or `window.open` from any renderer)
 * opened a NEW in-app BrowserWindow — an embedded browser — because Electron's default window-open
 * behaviour is `allow`. This guard closes that at the root: every window's `setWindowOpenHandler`
 * DENIES the new window outright, and instead routes an `http(s)` target to the OS browser through
 * the same external-URL seam the rest of the app uses. No call site — present or future — can put a
 * browser window inside throng.
 */
import { shell, type WebContents } from 'electron';
import { isSafeExternalUrl } from './external-url.js';

/** The pure decision: a denied window whose target is a safe URL is handed to the OS opener. */
export function windowOpenDecision(url: unknown): { openExternal: boolean } {
  return { openExternal: isSafeExternalUrl(url) };
}

/** Install the deny-and-route handler on a window's web contents. Idempotent per contents. */
export function denyRendererWindows(contents: WebContents): void {
  contents.setWindowOpenHandler(({ url }) => {
    if (windowOpenDecision(url).openExternal) void shell.openExternal(url);
    return { action: 'deny' };
  });
}
