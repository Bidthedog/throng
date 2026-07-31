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
   */
  watch(dir: string, onChange: (path: string) => void, options?: WatchOptions): Disposable;
}
