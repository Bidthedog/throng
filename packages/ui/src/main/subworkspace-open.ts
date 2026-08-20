/**
 * Opening a sub-workspace window — the decision path, minus Electron (#287).
 *
 * ══ WHY THIS IS A MODULE AND NOT A HANDLER BODY ══
 *
 * It was a handler body: `ipcMain.on('throng:subworkspace:open', …)` wrapping
 * `void (async () => { … })()`. Two consequences followed from that shape, and the second is the
 * defect #287 records.
 *
 * The first is reach. Nothing below E2E could ask what happens when a sub-workspace is opened,
 * because the only way in was to launch the application and click.
 *
 * The second is silence. A floating promise has no rejection handler, so **anything thrown after the
 * one guarded call became an unhandled rejection**: no window, no error, no notice. The user pressed
 * Open, nothing happened, and pressing it again did the same. That is precisely the failure this
 * repository's own rule forbids — a condition that cannot complete must say so.
 *
 * ── ON THE EXISTING-WINDOW BRANCH ──
 *
 * Raising a window that is already open is a legitimate outcome and NOT a failure, so it is reported
 * as its own result rather than folded into success. The caller needs to tell them apart: `opened`
 * creates a window (and fires Electron's `window` event), `focused` does not. A test that expects a
 * new window and gets a focus has not had a slow window; it has had a different answer.
 */
import type { WindowBounds } from '@throng/core';

/** The minimal window surface this decision needs. Electron's `BrowserWindow` satisfies it. */
export interface OpenableWindow {
  isDestroyed(): boolean;
  isMinimized(): boolean;
  restore(): void;
  focus(): void;
}

/** What happened. Every branch is named, including the two that are not failures. */
export type OpenSubWorkspaceOutcome =
  /** A window for this id was already open; it was restored if minimised, and focused. */
  | { kind: 'focused' }
  /** A new window was created and registered. */
  | { kind: 'opened' }
  /** Nothing was opened, and the user must be told. `reason` is for the log, not for them. */
  | { kind: 'failed'; reason: string };

export interface OpenSubWorkspaceDeps<TWin extends OpenableWindow> {
  /** The window already registered for this id, if any. */
  getChild(id: string): TWin | undefined;
  /**
   * The persisted bounds for this id, already clamped onto a visible display — or `undefined` when
   * there are none, or when they could not be read.
   *
   * Reading them is best-effort BY DESIGN (FR-017a): a sub-workspace that cannot recall where it was
   * should still open at the default size. That is why this may not reject — a caller that let a
   * bounds lookup fail the whole open would turn a cosmetic gap into a window the user cannot get.
   */
  loadBounds(id: string): Promise<WindowBounds | undefined>;
  /** Create the real window. */
  createWindow(id: string, bounds: WindowBounds | undefined): TWin;
  /** Record it so a second open focuses rather than duplicating. */
  registerChild(id: string, win: TWin): void;
  /** Begin persisting this window's bounds on move, resize and close. */
  watchBounds(id: string, win: TWin): void;
}

/**
 * Open — or raise — the sub-workspace window for `id`.
 *
 * Never throws. Every failure is returned, because the caller is an IPC handler whose exceptions go
 * nowhere a user can see.
 */
export async function openSubWorkspace<TWin extends OpenableWindow>(
  id: string,
  deps: OpenSubWorkspaceDeps<TWin>,
): Promise<OpenSubWorkspaceOutcome> {
  const existing = deps.getChild(id);
  if (existing && !existing.isDestroyed()) {
    if (existing.isMinimized()) existing.restore();
    existing.focus();
    return { kind: 'focused' };
  }

  /*
   * Bounds are best-effort and MUST NOT gate the window (FR-017a). Guarded separately from the
   * creation below so a daemon that cannot answer costs the user their window POSITION and not
   * their window.
   */
  let bounds: WindowBounds | undefined;
  try {
    bounds = await deps.loadBounds(id);
  } catch {
    bounds = undefined;
  }

  /*
   * Everything from here is guarded, and returned rather than thrown (#287).
   *
   * The caller is an IPC handler: an exception thrown at it goes nowhere a user can see, which is
   * the original defect wearing better manners. `registerChild` and `watchBounds` are inside the
   * guard as well as the creation, because a throw AFTER the window exists is the nastier case — a
   * window can be on screen while the application believes there is none, so the next open would
   * duplicate it rather than raise it.
   */
  try {
    const win = deps.createWindow(id, bounds);
    deps.registerChild(id, win);
    deps.watchBounds(id, win);
    return { kind: 'opened' };
  } catch (error) {
    // Anything at all can be thrown in JavaScript, and `String(undefined)` in a notice is its own
    // bug — so a non-Error still yields something a log can carry.
    const reason =
      error instanceof Error ? (error.stack ?? error.message) : `non-Error thrown: ${String(error)}`;
    return { kind: 'failed', reason };
  }
}
