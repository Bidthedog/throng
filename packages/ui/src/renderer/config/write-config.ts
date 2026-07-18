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

/**
 * Every ARMED debounced write, keyed by document (019 FR-010, issue #86).
 *
 * Keyed by `ConfigDocId` rather than held by whoever scheduled it, because the writer is the
 * wrong place to track this from: a component that is re-rendered rather than unmounted
 * strands its armed timer, and an unmount flush never runs on that path. The module keeps the
 * registry, so an orphan is still registered and still settles.
 *
 * Per-id keying is also 018 FR-023's captured-at-edit-time guarantee, enforced here rather
 * than by a payload convention: theme A's pending write is keyed to A and theme B's to B, so
 * neither displaces the other.
 */
const armedWrites = new Map<string, { timer: ReturnType<typeof setTimeout>; fire: () => void }>();

/**
 * Schedule a debounced config write for `id`, coalescing rapid edits `ms` after the last one.
 *
 * `produce` runs at FIRE time and returns the document to write, or **`null` to write
 * nothing** — the JSON tab needs both: its body parses the edit buffer, and an unparseable
 * buffer must not reach the config file (007 FR-017), while its echo-suppression and
 * dirty/external bookkeeping still has to run exactly when it does today. Passing a finished
 * string instead would have forced all of that to the call site, per keystroke.
 */
export function scheduleWrite(id: ConfigDocId, produce: () => string | null, ms: number): void {
  const key = docKey(id);
  const armed = armedWrites.get(key);
  if (armed) clearTimeout(armed.timer);

  const fire = (): void => {
    armedWrites.delete(key);
    const json = produce();
    if (json !== null) void writeConfig(id, json);
  };
  armedWrites.set(key, { timer: setTimeout(fire, ms), fire });
}

/**
 * Drop `id`'s armed write without firing it.
 *
 * Load-bearing for the JSON tab's `reload`: a debounced apply of the edit we are ABANDONING
 * must not fire afterwards and silently write it back over the document we just adopted.
 * Without this, adopting an external change is silently clobbered — a silent config
 * write-back, inside the sweep against silent write-backs.
 */
export function cancelWrite(id: ConfigDocId): void {
  const key = docKey(id);
  const armed = armedWrites.get(key);
  if (!armed) return;
  clearTimeout(armed.timer);
  armedWrites.delete(key);
}

/**
 * Settle every deferred config write this window owns (019 FR-010): fire what is armed, then
 * await what is in flight.
 *
 * THE CHOKEPOINT IS THE DESIGN. Every config write goes through {@link writeConfig}, so the
 * drain settles the MODULE and counts nothing — not writers, not tabs, not windows. Each
 * earlier attempt modelled a list and each was wrong, because a design whose correctness
 * depends on an accurate list is wrong again the next time someone adds a writer. Settling
 * *n* writes is the same call as settling one, and a window with nothing pending settles
 * immediately.
 *
 * {@link writeChains} is REUSED for the in-flight half: it already tracks each document's tail
 * (issue #50) and it never asked whether its caller dropped the promise, so it covers the
 * debounced, the undebounced and the awaited alike. A failure is swallowed, as a flush does —
 * a write that cannot land must not wedge the close.
 */
export async function settleConfigWrites(): Promise<void> {
  for (const armed of [...armedWrites.values()]) armed.fire();
  await Promise.all([...writeChains.values()].map((p) => p.catch(() => undefined)));
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
