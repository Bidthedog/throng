import { useSyncExternalStore } from 'react';
import {
  LINK_CACHE_TTL_MS,
  isUnderPath,
  samePath,
  type LinkResolution,
  type LinkResolutionRequest,
} from '@throng/core';

// Re-exported so a caller reasoning about the cache reads one name from one place; the value itself
// lives in `core/src/links/limits.ts`, beside the per-line cap it is a sibling of.
export { LINK_CACHE_TTL_MS };

/**
 * The per-window file-link resolution cache (045 FR-070, FR-071; `data-model.md` §7).
 *
 * Module-level, on the `cwd-store.ts` pattern, so the answers are shared across every panel in the
 * window rather than re-fetched per component.
 *
 * ══ IT EXISTS BECAUSE THE PROVIDER CANNOT WAIT ══
 *
 * FR-071 forbids an existence check on the terminal's output path or the editor's typing path, and
 * a link provider is called synchronously as the pointer moves — it has nowhere to await. So the
 * shape is deliberately not "a promise you await":
 *
 *   `peekLink` is SYNCHRONOUS and `undefined` means **not a link** (P3) — nothing underlined,
 *   nothing followable, no menu items. `requestLink` is fire-and-forget. The answer lands, and the
 *   NEXT hover sees it.
 *
 * That reads like a compromise and is in fact the requirement: a link that appears a frame later is
 * the price of a terminal that never blocks on an unreachable network path (P5).
 *
 * ══ AN ANSWER MUST NOT OUTLIVE ITS LOCATION ══
 *
 * Two mechanisms, because one cannot cover both cases. `invalidateLinksUnder` drops entries when
 * the existing file-watcher broadcast says something changed — but a `{ ok: false }` entry has no
 * resolved path to match against, and P6 requires a file created AFTER the text was printed to
 * become a link. So a non-link is matched on where it MIGHT have resolved (its base directory and
 * its own text) rather than on where it did. The TTL is the backstop for everything the watcher
 * never reports.
 *
 * This is **view state** (Principle XI): it holds nothing that shapes content, and a window that
 * loses it re-derives every entry from what is on screen.
 */

interface Entry {
  readonly resolution: LinkResolution;
  readonly at: number;
  /** Kept for `invalidateLinksUnder`, which has to reason about a non-link's possible locations. */
  readonly request: LinkResolutionRequest;
}

const entries = new Map<string, Entry>();
/** Keys with a request in flight. Prevents one request per mouse-move over the same span. */
const inFlight = new Set<string>();
const listeners = new Set<() => void>();

/** `data-model.md` §7's key. NUL-separated because no field can contain one. */
function keyOf(request: LinkResolutionRequest): string {
  const separator = String.fromCharCode(0);
  return [request.kind, request.text, request.baseDirectory ?? '', request.panelId].join(separator);
}

function notify(): void {
  for (const listener of listeners) listener();
}

/**
 * The cached answer, or `undefined` — which means **not a link** (FR-071), never "ask again later".
 * An entry past its TTL is dropped here rather than on a timer: nothing is watching it, and the
 * next reader is exactly who needs to know it has expired.
 */
export function peekLink(request: LinkResolutionRequest): LinkResolution | undefined {
  const key = keyOf(request);
  const entry = entries.get(key);
  if (entry === undefined) return undefined;
  if (Date.now() - entry.at > LINK_CACHE_TTL_MS) {
    entries.delete(key);
    return undefined;
  }
  return entry.resolution;
}

/**
 * Ask main, at most once per key at a time (FR-070). Returns nothing: there is nothing useful to
 * return, and a promise here would invite a caller to await one on the hover path.
 *
 * A FAILED request is not cached. A bridge that was briefly unavailable must not make a real link
 * dead for the rest of the window's life, so the in-flight mark is cleared and the next hover
 * retries.
 */
export function requestLink(request: LinkResolutionRequest): void {
  const key = keyOf(request);
  if (inFlight.has(key) || entries.has(key)) return;
  const resolve = window.throng?.links?.resolve;
  if (resolve === undefined) return;
  inFlight.add(key);
  void Promise.resolve(resolve(request))
    .then((resolution) => {
      entries.set(key, { resolution, at: Date.now(), request });
      notify();
    })
    .catch(() => {
      /* not cached — see above */
    })
    .finally(() => {
      inFlight.delete(key);
    });
}

/**
 * Drop every answer a change at `absPath` could have invalidated (FR-070, P6).
 *
 * A resolved link is matched on its own path. A NON-link has no path, so it is matched on the two
 * places it could have resolved to — its base directory and, when its text is absolute, the text
 * itself. Without that second half, a file created after the text was printed would stay a non-link
 * until the TTL expired, and P6 asks for it on the next hover.
 *
 * Comparison is `isUnderPath` / `samePath`, as every other path comparison in the app is — so case
 * and separators fold, and `D:\p\sr` does not match `D:\p\src`.
 */
export function invalidateLinksUnder(absPath: string): void {
  if (!absPath) return;
  let changed = false;
  for (const [key, entry] of [...entries]) {
    if (affects(absPath, entry)) {
      entries.delete(key);
      changed = true;
    }
  }
  if (changed) notify();
}

function affects(absPath: string, entry: Entry): boolean {
  // A RESOLVED link has one location, so the question is the narrow one: did the change happen at
  // it, or above it?
  if (entry.resolution.ok) return under(entry.resolution.link.path, absPath);

  /*
   * A NON-link has no location, and that is what makes P6 awkward. "A file created after the text
   * was printed becomes a link on the next hover" means the entry has to be freed by a change at a
   * place it MIGHT have resolved to — and `src/foo.ts` based at `D:\p` might have resolved
   * anywhere beneath `D:\p`.
   *
   * So the test is RELATED-IN-EITHER-DIRECTION rather than under: a change deeper than the base
   * (`D:\p\src`) could have created the file, and a change at or above the base (`D:\p`, `D:\`)
   * could have created the whole subtree. Being generous here costs one re-request on the next
   * hover; being narrow costs the user a link that never appears until the TTL expires.
   */
  const base = entry.request.baseDirectory;
  if (base !== undefined && base.length > 0 && related(base, absPath)) return true;
  return related(entry.request.text, absPath);
}

function under(candidate: string, folder: string): boolean {
  return samePath(candidate, folder) || isUnderPath(candidate, folder);
}

function related(a: string, b: string): boolean {
  return under(a, b) || under(b, a);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * The same subscription, for a reader that is not a React component.
 *
 * The editor's decoration plugin is one: it is built by CodeMirror, lives outside the React tree,
 * and still has to repaint when an answer lands (FR-070). `useSyncExternalStore` is not available to
 * it, and a poll would be a timer per open editor.
 */
export function subscribeLinkCache(listener: () => void): () => void {
  return subscribe(listener);
}

/**
 * The React reading of the pair above: peek now, ask if the answer is not here yet, and re-render
 * when it lands. `null` for "there is no link here to ask about", which is what a component passes
 * when the pointer is not over a candidate.
 */
export function useLinkResolution(request: LinkResolutionRequest | null): LinkResolution | undefined {
  const snapshot = useSyncExternalStore(
    subscribe,
    () => (request === null ? undefined : peekLink(request)),
    () => undefined,
  );
  if (request !== null && snapshot === undefined) requestLink(request);
  return snapshot;
}

/** Test seam only: a module-level store outlives a test file without it. */
export function __resetLinkCacheForTests(): void {
  entries.clear();
  inFlight.clear();
  listeners.clear();
}
