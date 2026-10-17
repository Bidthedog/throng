/**
 * IFileWatcher (Principle II) — watches a directory and reports changes, driving
 * config hot-reload (research D3). The abstract contract only; the concrete
 * chokidar-backed implementation lives in `platform-windows`.
 */

/** A handle that stops a watch when disposed. */
export interface Disposable {
  dispose(): void;
}

/** Per-watch options (026 / #186). Optional and additive — existing callers pass nothing. */
export interface WatchOptions {
  /**
   * The watch has failed and could NOT be re-established; no further changes will be reported.
   *
   * Called at most once per handle, and never after `dispose()`. It exists because a watcher that
   * quietly stops reporting leaves its caller displaying stale data with no way to discover that —
   * the failure mode behind #186. A caller that omits this still gets re-establishment; it simply
   * is not told when re-establishment gives up.
   */
  onFailed?: (reason: string) => void;
}

/**
 * Everything one report covers (#482). Passed beside the reported path, so a caller that reads only
 * the path is unaffected.
 *
 * Coalescing used to throw all but the LAST path of a burst away, so every consumer that needed to
 * know what changed had to re-read everything it held to be safe — a whole-project walk for the file
 * index, every loaded folder for the tree — once per report, which under steady churn is once a
 * second. Naming each path lets them re-read only what the change touched.
 */
export interface WatchBatch {
  /** Every distinct path that changed in this report, the reported path included, in arrival order. */
  readonly paths: readonly string[];
  /**
   * False when the report cannot name everything that changed: the watch re-armed after its
   * directory came back (nobody saw what happened while it was gone), the platform delivered an
   * event with no filename, or the burst outgrew what a report holds. A caller must then re-read
   * whatever it depends on, exactly as it would with no batch at all.
   */
  readonly complete: boolean;
}

export interface IFileWatcher {
  /**
   * Begin watching `dir`; `onChange(path)` fires (debounced) on create/modify/
   * delete of a file within it. Disposing the returned handle stops callbacks.
   *
   * Two obligations beyond "report changes", both learnt from #186:
   *
   * - **A change MUST be reported within a bounded time, however continuously events arrive.**
   *   A debounce that restarts on every event never fires at all under sustained churn — measured
   *   at 180 events over 3s producing ZERO reports — so coalescing must have a ceiling, not just a
   *   quiet period.
   * - **A runtime failure MUST NOT silently end the watch.** Re-establish, and if that is exhausted
   *   say so via {@link WatchOptions.onFailed}.
   *
   * An implementation that can name every path in a report passes a {@link WatchBatch}; one that
   * cannot passes none, and callers treat that as an incomplete report.
   */
  watch(
    dir: string,
    onChange: (path: string, batch?: WatchBatch) => void,
    options?: WatchOptions,
  ): Disposable;
}
