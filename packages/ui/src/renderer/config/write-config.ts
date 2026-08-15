/**
 * Renderer config-write plumbing (feature 007, T010). The base helpers every
 * preferences tab's apply-client builds on: {@link writeConfig} (the sandbox
 * bridge to the main-process write path) and {@link debounce} (settle text/number
 * edits before applying, FR-016 immediate-apply). Kept free of React/DOM
 * module-scope so the debounce timing is unit-testable in the node env.
 */
import type { ConfigChange, ConfigDocId } from '@throng/core';

/** `error` is the sentence the user reads; `detail` is the raw errno for Copy and the log (#265). */
export type ConfigWriteResult = { ok: true } | { ok: false; error: string; detail?: string };

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

/** Tell every subscriber a write did not land. Never throws — a reporter must not break a writer. */
function publishFailure(id: ConfigDocId, error: string, detail?: string): void {
  for (const listener of failureListeners) {
    try {
      listener(id, error, detail);
    } catch {
      // A listener that throws is its own problem; the write path is already on a failure branch and
      // must not acquire a second one.
    }
  }
}

type WriteListener = (id: ConfigDocId, json: string) => void;
const writeListeners = new Set<WriteListener>();

type PatchListener = (id: ConfigDocId, changes: readonly ConfigChange[]) => void;
const patchListeners = new Set<PatchListener>();

/**
 * `error` is the sentence the user reads; `detail` is the raw errno for Copy and the log (#265).
 *
 * They used to be one string, which is how a notice came to read `"settings.json.2.tmp" is open in
 * another program`: a single value had to be both a human sentence and a machine record, and it
 * could only ever be one of them.
 */
type FailureListener = (id: ConfigDocId, error: string, detail?: string) => void;
const failureListeners = new Set<FailureListener>();

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
 * Observe writes that FAILED (#102).
 *
 * The symmetric half of {@link onConfigWritten}, and it exists here rather than at the call sites
 * for a reason the call sites cannot solve. #99 made `writeConfig` return a truthful outcome and
 * every caller then dropped it — but the DEBOUNCED path could not have done otherwise: it fires from
 * {@link scheduleWrite}'s timer as `void writeConfig(id, json)`, with no caller holding the promise
 * and no component guaranteed to still be mounted (the module keeps that registry precisely so an
 * orphaned write still settles). Every text and number edit in preferences takes that path.
 *
 * So the report is published from the chokepoint this module already is: "THE CHOKEPOINT IS THE
 * DESIGN. Every config write goes through `writeConfig`." One subscriber per window turns these into
 * notices, and a writer added tomorrow is covered without knowing this exists.
 */
export function onConfigWriteFailed(listener: FailureListener): () => void {
  failureListeners.add(listener);
  return () => failureListeners.delete(listener);
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
  if (!write) {
    const unavailable = { ok: false, error: 'bridge-unavailable' } as const;
    publishFailure(id, unavailable.error);
    return unavailable;
  }

  const key = docKey(id);
  const previous = writeChains.get(key) ?? Promise.resolve();
  const result = previous
    .catch(() => undefined) // a failed earlier write must not sink the ones after it
    .then(() => write(id, json))
    .then((res) => {
      if (res.ok) {
        for (const listener of writeListeners) listener(id, json);
      } else {
        publishFailure(id, res.error, res.detail);
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
 * Observe key-scoped changes as they are successfully applied (032).
 *
 * The patch counterpart of {@link onConfigWritten}, and it exists for a NARROWER reason than that
 * one did. #50's immediate-adopt was load-bearing for correctness: every edit serialised the whole
 * document from the renderer's copy, so a copy that lagged the last write produced a silent revert.
 * A patch caller never assembles a document, so that failure mode is gone by construction and this
 * subscription is not holding it up.
 *
 * What it still buys is RESPONSIVENESS. Without it the control the user just changed shows its old
 * value until the watcher's broadcast completes the round trip through the filesystem — under the
 * FR-004 bound, but visible. Adopting the change locally closes that gap, and the broadcast that
 * follows carries the same value, so it confirms rather than corrects.
 */
export function onConfigPatched(listener: PatchListener): () => void {
  patchListeners.add(listener);
  return () => patchListeners.delete(listener);
}

/**
 * Apply a KEY-SCOPED change to a config document (032, FR-001).
 *
 * The whole point of the channel: the caller says what changed and never rebuilds the document, so
 * it cannot revert a key another window changed in the meantime. Prefer this over
 * {@link writeConfig} for anything that is not the user hand-editing the raw file.
 *
 * It rides the SAME per-document chain as {@link writeConfig}, which is not incidental. A patch and
 * a whole-document write to one file are not commutative — the document write would revert the patch
 * — so ordering them against each other is the only way "the last edit wins" stays true when the
 * two channels are mixed, which `revertAll` does deliberately.
 */
export async function writeConfigPatch(
  id: ConfigDocId,
  changes: readonly ConfigChange[],
): Promise<ConfigWriteResult> {
  const writePatch = window.throng?.config?.writePatch;
  if (!writePatch) {
    const unavailable = { ok: false, error: 'bridge-unavailable' } as const;
    publishFailure(id, unavailable.error);
    return unavailable;
  }

  const key = docKey(id);
  const previous = writeChains.get(key) ?? Promise.resolve();
  const result = previous
    .catch(() => undefined) // a failed earlier write must not sink the ones after it
    .then(() => writePatch(id, changes))
    .then((res) => {
      if (res.ok) {
        for (const listener of patchListeners) listener(id, changes);
      } else {
        publishFailure(id, res.error, res.detail);
      }
      return res;
    });

  writeChains.set(key, result);
  try {
    return await result;
  } finally {
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
 * Buffers that hold an un-applied config edit, and know how to apply it (032, FR-017).
 *
 * ══ WHY THIS EXISTS ══
 *
 * The drain below settles ARMED WRITES — writes that have been scheduled and are waiting on a
 * timer. That covered every deferred config write in the application until FR-017 removed the JSON
 * editor's debounce.
 *
 * The JSON editor now applies when the user LEAVES it: closing the JSON view, switching tab, or
 * closing the Preferences window. Closing the whole APPLICATION with Preferences open is a fourth
 * exit that none of those three cover, and without this the buffer would simply be lost — a
 * silently discarded edit, which is the precise failure class this feature exists to remove.
 *
 * A registry rather than a call into the preferences window, for the same reason `armedWrites` is
 * one: the drain must name no writer and no window. A registrant that has nothing to commit
 * commits nothing, which is correct rather than a special case.
 */
type PendingCommit = () => void;
const pendingCommits = new Set<PendingCommit>();

/**
 * Register a buffer whose edit is applied on leaving, so the shutdown drain can apply it too.
 *
 * The commit MUST be a no-op when there is nothing to apply, and must not throw — a drain that
 * fails cannot be allowed to wedge the close.
 */
export function registerPendingCommit(commit: PendingCommit): () => void {
  pendingCommits.add(commit);
  return () => pendingCommits.delete(commit);
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
  /*
   * Un-applied BUFFERS first, then armed TIMERS, then the in-flight writes.
   *
   * The order is load-bearing: a commit schedules a write, so committing after the armed writes had
   * fired would leave the new one behind — settled by nothing and lost, which is exactly what this
   * function exists to prevent.
   */
  for (const commit of [...pendingCommits]) {
    try {
      commit();
    } catch {
      // A buffer that cannot commit must not stop the others, and must not wedge the close.
    }
  }
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
