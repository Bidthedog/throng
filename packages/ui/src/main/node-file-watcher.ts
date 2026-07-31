/**
 * NodeFileWatcher — the UI-main concrete {@link IFileWatcher} (T029). Watches a
 * directory (recursively) for create/modify/delete and reports changes, debounced,
 * to drive config hot-reload (research D3) and the Files & Folders tree (US2).
 * Uses node's `fs.watch` with `{ recursive: true }` (supported on Windows, the
 * first target) so no extra dependency is needed; the OS detail stays behind the
 * IFileWatcher abstraction (Principle II).
 */
import { watch, type FSWatcher } from 'node:fs';
import { join } from 'node:path';
import type { Disposable, IFileWatcher, WatchOptions } from '@throng/core';

/** Tuning, all overridable per instance (Principle X). */
export interface NodeFileWatcherOptions {
  /**
   * The longest a change may go unreported while events keep arriving (026 / #186, FR-006).
   *
   * This is the ceiling on coalescing, and the whole reason the tree stops lying during a build.
   */
  maxWaitMs?: number;
  /** How many times to re-establish a watch that failed at runtime before giving up (FR-010). */
  maxRetries?: number;
  /** Backoff base; the nth attempt waits `retryBaseMs * n`. */
  retryBaseMs?: number;
}

export class NodeFileWatcher implements IFileWatcher {
  private readonly maxWaitMs: number;

  private readonly maxRetries: number;

  private readonly retryBaseMs: number;

  constructor(
    private readonly debounceMs = 100,
    options: NodeFileWatcherOptions = {},
  ) {
    this.maxWaitMs = options.maxWaitMs ?? 1000;
    this.maxRetries = options.maxRetries ?? 5;
    this.retryBaseMs = options.retryBaseMs ?? 250;
  }

  watch(dir: string, onChange: (path: string) => void, options?: WatchOptions): Disposable {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let lastPath = dir;
    let watcher: FSWatcher | null = null;
    let disposed = false;
    let attempts = 0;
    /**
     * When the current coalescing burst began, or null between bursts.
     *
     * THE FIELD THIS FIX IS ABOUT. Without it the debounce has only a "quiet period" and no
     * ceiling, so while events arrive closer together than `debounceMs` the timer is cleared and
     * re-armed forever and NOTHING is ever reported. A project root holding node_modules, .git or
     * build output does exactly that during any build, install or git operation — measured at 180
     * raw events across 3s of churn producing ZERO reports, the first landing only once the churn
     * stopped. That is precisely the reported "the tree only catches up on some later unrelated
     * action" (#186).
     */
    let burstStartedAt: number | null = null;

    const fire = (): void => {
      timer = null;
      burstStartedAt = null;
      if (disposed) return;
      onChange(lastPath);
    };

    const onEvent = (_event: string, filename: string | Buffer | null): void => {
      if (disposed) return;
      if (filename) lastPath = join(dir, filename.toString());
      // A delivered event proves this watch works, so the retry budget is spent, not consumed.
      // Resetting on a successful *arm* instead would let a watch that errors immediately after
      // every arm retry forever.
      attempts = 0;
      const now = Date.now();
      if (burstStartedAt === null) burstStartedAt = now;
      if (timer) clearTimeout(timer);
      if (now - burstStartedAt >= this.maxWaitMs) {
        // The burst has run past its ceiling: report NOW rather than waiting for a quiet moment
        // that may never arrive. The next event opens a fresh burst.
        fire();
        return;
      }
      timer = setTimeout(fire, this.debounceMs); // coalesce rapid successive writes
    };

    const scheduleRetry = (reason: string): void => {
      if (disposed) return;
      attempts += 1;
      if (attempts > this.maxRetries) {
        // Diagnostics matter most here: this path is silent to the user until now, and an
        // intermittent failure that leaves no trace is how #186 survived four wrong diagnoses.
        // console.* is tee'd into the durable log (#123), which is why this is not an injected logger.
        console.warn(
          `[file-watcher] gave up watching ${dir} after ${this.maxRetries} attempts: ${reason}`,
        );
        options?.onFailed?.(reason);
        return;
      }
      console.warn(
        `[file-watcher] re-establishing watch on ${dir} (attempt ${attempts}/${this.maxRetries}): ${reason}`,
      );
      retryTimer = setTimeout(() => {
        retryTimer = null;
        arm();
      }, this.retryBaseMs * attempts);
    };

    const arm = (): void => {
      if (disposed) return;
      try {
        const created = watch(dir, { recursive: true }, onEvent);
        watcher = created;
        // fs.watch reports RUNTIME failures via an 'error' event, not the try/catch
        // (which only guards synchronous creation). Windows commonly emits EPERM/ENOENT
        // when a watched directory is renamed or removed underneath a recursive watch
        // (churning temp dirs, heavy load). With no listener Node re-throws it as an
        // uncaught exception that crashes the main process — so swallow it.
        //
        // Swallowing was always right; STAYING DEAD was not. The original handler closed the
        // watcher and set it to null with no re-establish, so one transient EPERM left the tree
        // stale for the whole session with nothing said to anyone (026 / #186, FR-010).
        created.on('error', (error: NodeJS.ErrnoException) => {
          if (disposed) return;
          created.close();
          if (watcher === created) watcher = null;
          scheduleRetry(error.code ?? error.message);
        });
      } catch (error) {
        // The directory may not exist yet, or may have gone between attempts.
        scheduleRetry((error as NodeJS.ErrnoException)?.code ?? 'watch could not be established');
      }
    };

    arm();

    return {
      dispose: () => {
        // Latch FIRST: everything else checks it, so nothing armed below can fire afterwards.
        // Without this a re-establishment scheduled moments before disposal would quietly resume
        // watching a project the user has already left (FR-011).
        disposed = true;
        if (timer) clearTimeout(timer);
        timer = null;
        if (retryTimer) clearTimeout(retryTimer);
        retryTimer = null;
        watcher?.close();
        watcher = null;
      },
    };
  }
}
