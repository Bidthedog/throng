/**
 * Wait for a window's first document — the seam startup awaits before it carries on (#286).
 *
 * ══ WHY A BARE `await window.loadFile(...)` IS NOT ENOUGH ══
 *
 * Electron's `loadFile` / `loadURL` promise answers for ONE navigation. If another main-frame
 * navigation starts before it finishes — a renderer `location.reload()`, say — Electron rejects it
 * with `ERR_ABORTED (-3)`, even though the window goes on to load the very same document perfectly
 * well a moment later.
 *
 * `createMainWindow` used to end on exactly that await, and startup awaits `createMainWindow` inside
 * `app.whenReady().then(async …)` with no catch. So a reload landing in that window rejected startup
 * part-way through: one `unhandledRejection` line in `main.log`, and every IPC handler registered after
 * the main window — `throng:subworkspace:open` among them — never registered at all. The user saw an
 * Open button that did nothing, with nothing logged (#286; caught in stress run 39632667614).
 *
 * ══ WHAT COUNTS AS LOADED ══
 *
 * A document that finished loading in these contents. An abort is NOT that — it means a newer
 * navigation replaced the one we were waiting on — so after an abort this waits for the replacement
 * to finish (`did-finish-load`). The replacement can itself be aborted (two reloads), which is the
 * same case again. Anything else still fails as it always did: a main-frame load that genuinely fails
 * rejects with its own error, and contents destroyed before any document loaded reject rather than
 * leaving startup waiting forever.
 *
 * ══ WHY THE LISTENERS GO ON BEFORE THE LOAD STARTS ══
 *
 * The abort reaches us as a promise rejection, one microtask after Electron raised it. Listeners
 * attached in a `catch` could miss a replacement that ends in between, so the contents' events are
 * recorded from the start, and an abort reads whatever the replacement has already done.
 */

/** The slice of Electron's `WebContents` this needs. */
export interface LoadingContents {
  on(event: 'did-finish-load', listener: () => void): unknown;
  on(
    event: 'did-fail-load',
    listener: (event: unknown, errorCode: number, errorDescription: string, url: string, isMainFrame: boolean) => void,
  ): unknown;
  on(event: 'destroyed', listener: () => void): unknown;
  removeListener(event: string, listener: (...args: never[]) => void): unknown;
}

/** Chromium's `net::ERR_ABORTED`. */
const ERR_ABORTED = -3;

function isAbort(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const e = error as { errno?: unknown; code?: unknown };
  return e.errno === ERR_ABORTED || e.code === 'ERR_ABORTED';
}

/** How the contents' current navigation ended, as far as the events have said. */
type Ending = { kind: 'loaded' } | { kind: 'failed'; error: Error } | { kind: 'destroyed' };

/** Resolve once `contents` has a loaded document. `load` starts the load (`loadFile` / `loadURL`). */
export function loadFirstDocument(contents: LoadingContents, load: () => Promise<void>): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let ending: Ending | null = null;
    let aborted = false;
    let settled = false;

    const cleanup = (): void => {
      contents.removeListener('did-finish-load', onLoaded);
      contents.removeListener('did-fail-load', onFailed);
      contents.removeListener('destroyed', onDestroyed);
    };
    const settle = (outcome: Ending): void => {
      if (settled) return;
      settled = true;
      cleanup();
      if (outcome.kind === 'loaded') resolve();
      else if (outcome.kind === 'failed') reject(outcome.error);
      else reject(new Error('the window was destroyed before its first document loaded'));
    };
    // Before the abort these only record; the load's own promise answers for the first navigation.
    // After it, the replacement's ending is the answer.
    const record = (outcome: Ending): void => {
      ending = outcome;
      if (aborted) settle(outcome);
    };

    const onLoaded = (): void => record({ kind: 'loaded' });
    const onFailed = (
      _event: unknown,
      errorCode: number,
      errorDescription: string,
      url: string,
      isMainFrame: boolean,
    ): void => {
      // A sub-frame failing is not the document failing; another abort is another replacement.
      if (!isMainFrame || errorCode === ERR_ABORTED) return;
      record({
        kind: 'failed',
        error: Object.assign(new Error(`${errorDescription} (${errorCode}) loading '${url}'`), {
          errno: errorCode,
          code: errorDescription,
          url,
        }),
      });
    };
    const onDestroyed = (): void => record({ kind: 'destroyed' });

    contents.on('did-finish-load', onLoaded);
    contents.on('did-fail-load', onFailed);
    contents.on('destroyed', onDestroyed);

    let started: Promise<void>;
    try {
      started = load();
    } catch (error) {
      cleanup();
      reject(error instanceof Error ? error : new Error(String(error)));
      return;
    }
    started.then(
      () => settle({ kind: 'loaded' }),
      (error: unknown) => {
        if (!isAbort(error)) {
          settle({ kind: 'failed', error: error instanceof Error ? error : new Error(String(error)) });
          return;
        }
        // Electron rejects the first load only when it has NOT finished, so anything recorded so
        // far belongs to the navigation that replaced it.
        aborted = true;
        if (ending) settle(ending);
      },
    );
  });
}
