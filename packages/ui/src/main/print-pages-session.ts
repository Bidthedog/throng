/**
 * The session Print Preview's pages view loads in (075 FR-068, FR-079).
 *
 * The pages are a PDF main writes into the job's folder under the user-data directory, shown by Chromium's own
 * PDF viewer. The default session cannot load it: Layer 4 (044, `renderer-request-filter.ts`) admits a `file:`
 * URL only beneath the renderer's own directory, and widening that rule for every window to reach one view's
 * files would weaken it everywhere. So the view has a partition of its own, whose filter admits a `file:` URL
 * only beneath the jobs folder and refuses every network request. Everything else — the viewer's own
 * `chrome-extension:` and `blob:` parts — fetches nothing and passes.
 *
 * Type-only Electron imports: a structural fake drives it in a unit test.
 */
import { fileURLToPath } from 'node:url';
import type { Session } from 'electron';
import { isUnderPath, logExpected } from '@throng/core';

/** The pages view's partition; in memory, so nothing it loads outlives the app. */
export const PRINT_PAGES_PARTITION = 'throng-print-pages';

const NETWORK = new Set(['http:', 'https:', 'ws:', 'wss:', 'ftp:']);

/** Whether the pages view may make the request for `url`. */
export function decidePagesRequest(url: string, jobsDir: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch (error) {
    logExpected('print: pages view request', 'a URL that does not parse names nothing the pages view needs', error);
    return false;
  }
  if (parsed.protocol === 'file:') {
    // A `..` segment, decoded or not, is refused by `isUnderPath` rather than resolved.
    try {
      return isUnderPath(fileURLToPath(parsed), jobsDir) && !/%2e%2e/i.test(parsed.pathname);
    } catch (error) {
      logExpected('print: pages view request', 'a file: URL naming no local path is not a job file', error);
      return false;
    }
  }
  return !NETWORK.has(parsed.protocol);
}

/** The part of the pages view's web contents {@link closeOnEscape} listens on. */
export interface EscapeSource {
  on(event: 'before-input-event', listener: (event: { preventDefault(): void }, input: { type: string; key: string }) => void): unknown;
}

/**
 * FR-071 — Escape cancels Print Preview wherever its focus is. Once the reader clicks into the pages, keys go to
 * the PDF viewer's web contents, which the window's app never hears; this hands Escape from there to `close`.
 */
export function closeOnEscape(contents: EscapeSource, close: () => void): void {
  contents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || input.key !== 'Escape') return;
    event.preventDefault();
    close();
  });
}

/** Install {@link decidePagesRequest} on the pages view's session. */
export function installPagesRequestFilter(session: Pick<Session, 'webRequest'>, jobsDir: string): void {
  session.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
    callback({ cancel: !decidePagesRequest(details.url, jobsDir) });
  });
}
