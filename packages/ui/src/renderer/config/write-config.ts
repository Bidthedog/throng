/**
 * Renderer config-write plumbing (feature 007, T010). The base helpers every
 * preferences tab's apply-client builds on: {@link writeConfig} (the sandbox
 * bridge to the main-process write path) and {@link debounce} (settle text/number
 * edits before applying, FR-016 immediate-apply). Kept free of React/DOM
 * module-scope so the debounce timing is unit-testable in the node env.
 */
import type { ConfigDocId } from '@throng/core';

export type ConfigWriteResult = { ok: true } | { ok: false; error: string };

/** Stable key for a config document, so writes to the same document can be ordered. */
function docKey(id: ConfigDocId): string {
  return id.kind === 'theme' ? `theme:${id.name}` : id.kind;
}

/**
 * The tail of the in-flight write chain per document (issue #50).
 *
 * Every edit serialises the WHOLE document, so two writes to the same file are not
 * commutative: if the second one lands first, it wins, and the first edit is lost. Chaining
 * them per document makes the last write the last to land, which is what the user means.
 */
const writeChains = new Map<string, Promise<unknown>>();

type WriteListener = (id: ConfigDocId, json: string) => void;
const writeListeners = new Set<WriteListener>();

/**
 * Observe documents as they are successfully written (issue #50).
 *
 * The renderer's copy of the config is refreshed by the config watcher, which round-trips
 * through the filesystem. An edit made inside that window used to be computed from the
 * PRE-edit copy and would silently revert the edit before it — nothing errored, the change
 * was simply gone. The config store listens here and applies the written document at once, so
 * the next edit always builds on the last one rather than on a stale snapshot. The watcher
 * broadcast that follows carries the same values, so it is a confirmation, not a correction.
 */
export function onConfigWritten(listener: WriteListener): () => void {
  writeListeners.add(listener);
  return () => writeListeners.delete(listener);
}

/**
 * Persist a config document as raw JSON via the preload bridge. Returns the
 * main-process {@link ConfigWriteResult}; if the bridge is unavailable (e.g. a
 * test render without preload) it resolves to a failure rather than throwing so
 * callers can surface it without crashing.
 *
 * Writes to the same document are serialised, and a successful one is published to
 * {@link onConfigWritten} (issue #50).
 */
export async function writeConfig(id: ConfigDocId, json: string): Promise<ConfigWriteResult> {
  const write = window.throng?.config?.write;
  if (!write) return { ok: false, error: 'bridge-unavailable' };

  const key = docKey(id);
  const previous = writeChains.get(key) ?? Promise.resolve();
  const result = previous
    .catch(() => undefined) // a failed earlier write must not sink the ones after it
    .then(() => write(id, json))
    .then((res) => {
      if (res.ok) {
        for (const listener of writeListeners) listener(id, json);
      }
      return res;
    });

  writeChains.set(key, result);
  try {
    return await result;
  } finally {
    // Let the map drain once this write is the last one standing.
    if (writeChains.get(key) === result) writeChains.delete(key);
  }
}

/** A debounced function with imperative {@link Debounced.cancel}/{@link Debounced.flush}. */
export interface Debounced<A extends unknown[]> {
  (...args: A): void;
  /** Drop any pending invocation. */
  cancel(): void;
  /** Invoke a pending call now (with its latest args), if one is scheduled. */
  flush(): void;
}

/**
 * Trailing-edge debounce: coalesces rapid calls into a single invocation `ms`
 * after the last call, using the most recent arguments. Used to settle
 * text/number edits before applying (FR-016; consistent with the editor's
 * existing auto-save debounce).
 */
export function debounce<A extends unknown[]>(fn: (...args: A) => void, ms: number): Debounced<A> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pendingArgs: A | null = null;

  const run = (): void => {
    timer = null;
    const args = pendingArgs;
    pendingArgs = null;
    if (args) fn(...args);
  };

  const debounced = ((...args: A): void => {
    pendingArgs = args;
    if (timer) clearTimeout(timer);
    timer = setTimeout(run, ms);
  }) as Debounced<A>;

  debounced.cancel = (): void => {
    if (timer) clearTimeout(timer);
    timer = null;
    pendingArgs = null;
  };

  debounced.flush = (): void => {
    if (timer) {
      clearTimeout(timer);
      run();
    }
  };

  return debounced;
}
