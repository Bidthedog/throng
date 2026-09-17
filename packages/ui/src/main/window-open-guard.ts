/**
 * Deny renderer-opened browser windows (024 US7, #159 / FR-019b).
 *
 * The reported bug: a URL activated in a terminal (an OSC 8 link, or `window.open` from any renderer)
 * opened a NEW in-app BrowserWindow — an embedded browser — because Electron's default window-open
 * behaviour is `allow`. This guard closes that at the root: every window's `setWindowOpenHandler`
 * DENIES the new window outright, and instead routes a safe target to the OS opener through the same
 * platform seam the rest of the app uses. No call site — present or future — can put a browser window
 * inside throng.
 *
 * The opener is INJECTED as {@link IShellIntegration} (044 FR-091 / R10), not read from Electron's
 * `shell` module directly — Principle II: this file has no Electron dependency of its own, and the
 * seam is exactly what the shared clipboard/shell-integration contract suites cover.
 */
import type { WebContents } from 'electron';
import type { IShellIntegration } from '@throng/core';
import { isSafeExternalUrl } from './external-url.js';

/**
 * The pure decision: a denied window whose target is a safe URL is handed to the OS opener. `window.open`
 * is a terminal's route (024 FR-019b), so it takes the GENERAL policy — `http:`/`https:` only (024 FR-019);
 * a preview's `mailto:` links go through their own channel (`external-url.ts`).
 */
export function windowOpenDecision(url: unknown): { openExternal: boolean } {
  return { openExternal: isSafeExternalUrl(url) };
}

/** Install the deny-and-route handler on a window's web contents. Idempotent per contents. */
export function denyRendererWindows(contents: WebContents, shell: IShellIntegration): void {
  contents.setWindowOpenHandler(({ url }) => {
    if (windowOpenDecision(url).openExternal) void shell.openExternal(url);
    return { action: 'deny' };
  });
}
