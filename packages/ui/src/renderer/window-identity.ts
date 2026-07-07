/**
 * Window identity (US7 / FR-016): a renderer window is either the **main**
 * workspace window or a detached **sub-workspace** window. Which one is encoded
 * in the loaded URL's query string by the main process (`?sw=<id>` for a
 * sub-workspace), so the renderer chooses what to mount with no IPC round-trip.
 *
 * Pure (string in → identity out) so it is unit-testable away from the DOM.
 */
export type WindowIdentity = { kind: 'main' } | { kind: 'subworkspace'; id: string };

/** The query-string key carrying a detached sub-workspace's id. */
export const SUBWORKSPACE_QUERY_KEY = 'sw';

/**
 * Parse a window identity from a `location.search` string (e.g. `?sw=abc`).
 * A missing/blank `sw` value falls back to the main window (defensive: a bad URL
 * never strands a window with no content).
 */
export function parseWindowIdentity(search: string): WindowIdentity {
  const id = new URLSearchParams(search).get(SUBWORKSPACE_QUERY_KEY);
  return id && id.length > 0 ? { kind: 'subworkspace', id } : { kind: 'main' };
}
