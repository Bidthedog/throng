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
import { logExpected, type IShellIntegration } from '@throng/core';
import { isSafeExternalUrl } from './external-url.js';

/**
 * The pure decision: a denied window whose target is a safe URL is handed to the OS opener. `window.open`
 * is a terminal's route (024 FR-019b), so it takes the GENERAL policy — `http:`/`https:` only (024 FR-019);
 * a preview's `mailto:` links go through their own channel (`external-url.ts`).
 */
export function windowOpenDecision(url: unknown): { openExternal: boolean } {
  return { openExternal: isSafeExternalUrl(url) };
}

/** 074 R6 — the channel a Ctrl+clicked link in an HTML preview's sandboxed page reaches its window on. */
export const FRAME_LINK_CHANNEL = 'throng:preview:frameLink';

/** The host of the preview protocol route an HTML preview's links point at (`preview-protocol.ts`, 204). */
const FOLLOW_PREFIX = 'throng-preview://follow/';

/**
 * 074 research R6, FR-079 — the link a denied window request names, when it is a Ctrl+click on a link in an HTML
 * preview: a `throng-preview://follow/<panelId>?href=<link>` URL with Chromium's `background-tab` disposition
 * (Ctrl+click, Ctrl+Enter). `null` for every other request — a plain click on a `target` link
 * (`foreground-tab`), Shift+click (`new-window`), any other URL. The renderer re-checks the panel id against its
 * own panels; it is an address, not an authority.
 */
export function frameLinkOf(details: { url: string; disposition?: string }): { panelId: string; href: string } | null {
  if (details.disposition !== 'background-tab' || !details.url.startsWith(FOLLOW_PREFIX)) return null;
  let parsed: URL;
  try {
    parsed = new URL(details.url);
  } catch (error) {
    logExpected('window-open-guard: parse a follow URL', 'a page link may be malformed; it follows nothing', error);
    return null;
  }
  const panelId = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  const href = parsed.searchParams.get('href');
  if (panelId.length === 0 || panelId.includes('/') || href === null || href.length === 0) return null;
  return { panelId, href };
}

/** Install the deny-and-route handler on a window's web contents. Idempotent per contents. */
export function denyRendererWindows(contents: WebContents, shell: IShellIntegration): void {
  contents.setWindowOpenHandler((details) => {
    // 074 R6 — a follow URL is never a window and never leaves the app; a Ctrl+click on one goes back to the
    // window's own renderer, whose preview follows it as it follows a Markdown link.
    if (details.url.startsWith(FOLLOW_PREFIX)) {
      const link = frameLinkOf(details);
      if (link !== null) contents.send(FRAME_LINK_CHANNEL, link);
      return { action: 'deny' };
    }
    if (windowOpenDecision(details.url).openExternal) void shell.openExternal(details.url);
    return { action: 'deny' };
  });
}
