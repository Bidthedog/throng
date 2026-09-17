/**
 * The main-process request filter and the navigation guard (044 FR-092, FR-093;
 * contracts/security-policy.md Layer 4 and "Navigation guard", research R8).
 *
 * The LAST line of the network rule. The sanitiser should already have removed a hostile URL and the
 * CSP should already have refused its load; this is what still refuses it when one of them did not —
 * and the only one of the three that lives outside the renderer, where a compromised document cannot
 * reach it.
 *
 * The decision is core's (`decideRendererRequest`), pinned row by row there. This file owns only the
 * wiring, and both halves of it are easy to get subtly wrong:
 *
 * - **Which requests are filtered.** Only a renderer's — one that names a web contents. The daemon
 *   talks over a pipe, not HTTP, but main's own `net` requests (an update check, say) carry no web
 *   contents and are not a document's to refuse.
 * - **When remote images are read.** On EVERY request, from the settings getter. Capturing the answer
 *   at install time would leave a user who turned *Load remote images* off still loading them until the
 *   next restart — FR-092 says no request is made while it is off, not "after a relaunch".
 *
 * Type-only Electron imports: nothing here calls Electron, so a structural fake drives it in a unit test.
 */
import type { App, Session, WebContents } from 'electron';
import {
  decideRendererRequest,
  remoteImagesPermitted,
  type AppSettings,
  type PreviewProviderRegistry,
} from '@throng/core';

/** The part of a session the filter installs on. */
export type RequestFilterSession = Pick<Session, 'webRequest'>;

/** The part of a window's web contents the guard installs on. */
export type NavigationGuardTarget = Pick<WebContents, 'on' | 'getURL' | 'getType'>;

/** The part of the app the guard installer listens on. */
export type NavigationGuardApp = Pick<App, 'on'>;

/**
 * Install Layer 4 on `session` (the default session, in `main.ts`). Installed once: Electron keeps a
 * single `onBeforeRequest` listener per session, so a second call replaces the first.
 *
 * `rendererDir` is the directory the renderer's own files load from — the only place a `file:` URL is
 * allowed to reach.
 */
export function installRendererRequestFilter(
  session: RequestFilterSession,
  settings: () => AppSettings,
  registry: PreviewProviderRegistry,
  rendererDir: string,
): void {
  session.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
    // Either field marks a renderer's request; a contents that has since been destroyed still leaves
    // its id, and such a request is no less a document's.
    if (details.webContents === undefined && details.webContentsId === undefined) {
      callback({});
      return;
    }
    const decision = decideRendererRequest(
      { url: details.url, resourceType: details.resourceType },
      { rendererDir, remoteImages: remoteImagesPermitted(registry, settings().editor.previews) },
    );
    callback(decision === 'cancel' ? { cancel: true } : {});
  });
}

/**
 * Refuse every navigation a window's own document starts AWAY from itself (a clicked link,
 * `location.href = …`, a file dropped on the window). throng never navigates its document from inside
 * it; `loadFile` / `loadURL` from main are not renderer navigations and do not raise `will-navigate`,
 * so a window's first load is unaffected.
 *
 * ══ A RELOAD IS NOT A NAVIGATION AWAY ══
 *
 * `location.reload()` DOES raise `will-navigate`, with the document's own URL as the target. The first
 * cut refused it, and the E2E harness's `reloadWindow` (40 call sites) then timed out waiting for a
 * load that never came. So a target equal to `getURL()` — the same document, query included — passes.
 * A fragment change needs no rule: same-document navigations never raise this event.
 */
export function guardNavigation(contents: NavigationGuardTarget): void {
  contents.on('will-navigate', (event) => {
    if (event.url !== contents.getURL()) event.preventDefault();
  });
}

/**
 * Install {@link guardNavigation} on EVERY web contents the app creates, from one place.
 *
 * Per-window calls are how a window kind added later misses a guard — the omission #263 was, for a
 * different per-window hook. `web-contents-created` fires for every one, so it must be installed
 * before the first window exists (module top level in `main.ts`).
 *
 * Contents of type `remote` are skipped: that is what Electron reports for web contents it did not
 * create through its own API, which is where the DevTools frontend lives — not a document of ours.
 * (Electron's `getType()` union has no `'devtools'` member.) Even unskipped, DevTools would not break:
 * its frontend is loaded by the browser, not navigated by a renderer, and a reload is allowed above.
 */
export function installNavigationGuards(app: NavigationGuardApp): void {
  app.on('web-contents-created', (_event, contents) => {
    if (contents.getType() === 'remote') return;
    guardNavigation(contents);
  });
}
