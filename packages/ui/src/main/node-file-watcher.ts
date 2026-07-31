/**
 * NodeFileWatcher — the UI-main concrete {@link IFileWatcher} (T029). Watches a
 * directory (recursively) for create/modify/delete and reports changes, debounced,
 * to drive config hot-reload (research D3) and the Files & Folders tree (US2).
 * Uses node's `fs.watch` with `{ recursive: true }` (supported on Windows, the
 * first target) so no extra dependency is needed; the OS detail stays behind the
 * IFileWatcher abstraction (Principle II).
 */
import { existsSync, watch, type FSWatcher } from 'node:fs';
import { dirname, join } from 'node:path';
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

/**
 * How many events into a burst before the watch is asked whether its directory still exists
 * (027 / #201).
 *
 * Low enough that a storm — tens of thousands of callbacks — is cut off in its first instants;
 * high enough that ordinary churn pays one `existsSync` per 64 events rather than one per event.
 */
const STORM_CHECK_EVERY = 64;

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
    /** The watch on the nearest existing ancestor, held only while `dir` does not exist. */
    let sentinel: FSWatcher | null = null;
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
    /** Events delivered in the current burst — the only cheap signal a storm gives (027 / #201). */
    let burstEvents = 0;

    const fire = (): void => {
      timer = null;
      burstStartedAt = null;
      burstEvents = 0;
      if (disposed) return;
      onChange(lastPath);
    };

    const onEvent = (_event: string, filename: string | Buffer | null): void => {
      if (disposed) return;
      if (filename) lastPath = join(dir, filename.toString());
      /**
       * Is this a real change, or has the directory gone? (027 / #201.)
       *
       * Removing the root of a recursive `fs.watch` on Windows does not raise an error and does not
       * end the watch — it turns it into an UNBOUNDED EVENT STORM. Measured at 53,957 callbacks
       * from one `rmSync`, still climbing, with no `'error'` event at any point; recreating the
       * directory does not settle it. Every one of those callbacks resets the debounce, so the
       * tree it is meant to be updating goes permanently silent while the event loop is saturated.
       *
       * The watch cannot be trusted to report its own death, so it is asked. Not on every event —
       * that is a syscall on the hot path of a recursive watch over `node_modules` — but once per
       * `STORM_CHECK_EVERY` events within a single burst, which ordinary churn crosses harmlessly
       * (the directory is there, the check costs one `existsSync` per 64 events) and a storm
       * crosses immediately. The storm is then bounded to its first few dozen callbacks, and the
       * watch goes to `waitForPath` — so a directory that is deleted and recreated recovers by
       * exactly the same route as one that is renamed away and back.
       */
      burstEvents += 1;
      if (burstEvents % STORM_CHECK_EVERY === 0 && !existsSync(dir)) {
        watcher?.close();
        watcher = null;
        if (timer) clearTimeout(timer);
        timer = null;
        burstStartedAt = null;
        burstEvents = 0;
        waitForPath();
        return;
      }
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

    /** The nearest ancestor of `target` that exists right now — `target` itself when it is there. */
    const nearestExisting = (target: string): string | null => {
      let cur = target;
      for (;;) {
        if (existsSync(cur)) return cur;
        const parent = dirname(cur);
        if (parent === cur) return null; // walked off the top: even the drive root is gone
        cur = parent;
      }
    };

    const closeSentinel = (): void => {
      sentinel?.close();
      sentinel = null;
    };

    /**
     * The directory is not there YET — so WAIT for it rather than spend the retry budget on it
     * (027 / #161, FR-010b).
     *
     * A path that does not exist is not a watch that is failing. The two were treated as one, and
     * the consequence is the whole of #161: open a project whose folder has been renamed away and
     * every watch bound underneath it — the tree's, and each open editor's — exhausts five attempts
     * in under four seconds and is abandoned for the session. Rename the folder back and NOTHING
     * happens, because there is no longer anybody watching to notice that it did.
     *
     * So we watch the nearest ancestor that DOES exist, non-recursively — we only need to learn
     * that the missing segment appeared — and re-arm the real watch the moment it does. There is no
     * timer and no attempt limit here, deliberately: the user may repair the path in ten seconds or
     * ten minutes, and a bounded wait would simply move the give-up further out. The wait ends when
     * the path returns or when the handle is disposed, and nothing else.
     */
    const waitForPath = (): void => {
      if (disposed) return;
      closeSentinel();
      const ancestor = nearestExisting(dir);
      // Nothing above it exists either (an unplugged drive, a UNC share that is gone). That is a
      // genuine failure rather than an absence we can wait on, so it goes back to the retry budget
      // and, in the end, to `onFailed`.
      if (ancestor === null) {
        scheduleRetry('ENOENT');
        return;
      }
      if (ancestor === dir) {
        arm({ reportOnArm: true }); // it came back while we were looking for it
        return;
      }
      try {
        const created = watch(ancestor, { recursive: false }, () => {
          if (disposed) return;
          if (existsSync(dir)) {
            closeSentinel();
            arm({ reportOnArm: true });
            return;
          }
          // An INTERMEDIATE folder appeared, so the missing segment has moved down: re-target the
          // wait onto the new nearest ancestor, or we would sit watching a grandparent that no
          // longer sees the creation we are waiting for.
          if (nearestExisting(dir) !== ancestor) waitForPath();
        });
        sentinel = created;
        created.on('error', (error: NodeJS.ErrnoException) => {
          if (disposed) return;
          closeSentinel();
          // The WAIT failed, which is a failure like any other — bounded, and reported if it keeps
          // happening. Only the absence itself is waited on indefinitely.
          scheduleRetry(error.code ?? error.message);
        });
      } catch (error) {
        scheduleRetry(
          (error as NodeJS.ErrnoException)?.code ?? 'the missing path could not be waited on',
        );
      }
    };

    const arm = (opts?: { reportOnArm?: boolean }): void => {
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
          // The directory went AWAY under the watch (it was renamed or removed). That is an
          // absence, not a fault, so it waits for the path instead of counting towards the
          // give-up — which is what lets a folder renamed away and back recover by itself.
          if (error.code === 'ENOENT') {
            waitForPath();
            return;
          }
          scheduleRetry(error.code ?? error.message);
        });
        if (opts?.reportOnArm) {
          // A directory that has just (RE)APPEARED is entirely news: nobody was watching while it
          // was away, so no event describes what changed inside it. Report it once, immediately —
          // without that, the watch is live again and every reader stays stale until something
          // else happens to touch the folder.
          attempts = 0;
          onChange(join(dir, '.'));
        }
      } catch (error) {
        const code = (error as NodeJS.ErrnoException)?.code;
        // Not there yet — wait for it (see `waitForPath`), rather than burning the retry budget
        // on a directory whose only problem is that it does not exist.
        if (code === 'ENOENT') {
          waitForPath();
          return;
        }
        scheduleRetry(code ?? 'watch could not be established');
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
        // The wait for a missing path outlives every timer, so it must be closed here too — a
        // sentinel left open would re-arm a watch on a project the user has already left.
        sentinel?.close();
        sentinel = null;
      },
    };
  }
}
