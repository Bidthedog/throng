/**
 * Close and quit on macOS (070 FR-028, contracts/app-lifecycle-macos.md *Close and quit*, research R18).
 *
 * | Event                         | No quit in progress            | Quit in progress |
 * |-------------------------------|--------------------------------|------------------|
 * | main window `close`           | hide it (no quit flow)         | the close flow   |
 * | `activate` (Dock click)       | show the hidden main window    | —                |
 * | `before-quit` (Cmd+Q, Dock…)  | hold it; start the shutdown    | hold it (wait)   |
 * | shutdown finishes             | the next `before-quit` is let through                |
 * | shutdown cancelled            | back to running                                     |
 * | renderer reloads or crashes   | —                              | back to running  |
 *
 * The main window is hidden, never destroyed, so its renderer and layout stay alive and no second main window is
 * ever made: the close and shutdown wiring stays bound to the one window. Windows and Linux do not use this; their
 * window close runs the shutdown, as it always has. Pure, so every transition is unit-tested on any host.
 */
export interface MacLifecycle {
  /** Whether a quit has been asked for and its shutdown has not finished or been cancelled. */
  readonly quitting: boolean;
  /** Whether the main window was hidden by a close and not shown since. */
  readonly hidden: boolean;
  /** The main window's `close`: hide it, or run the close flow (the quit's shutdown, or past it). */
  onMainWindowClose(): 'hide' | 'close-flow';
  /** `activate`: show the main window when a close hid it. */
  onActivate(): 'show' | 'none';
  /** `before-quit`: let it go (the shutdown finished), start the shutdown, or wait for the one running. */
  onBeforeQuit(): 'allow' | 'start-shutdown' | 'wait';
  onShutdownFinished(): void;
  onShutdownCancelled(): void;
  /**
   * The main window's renderer started loading again (a reload, a crash's recovery). The quit prompt and its shutdown
   * lived in the old renderer, so a quit in progress can neither finish nor be cancelled: it is abandoned, or every
   * later Cmd+Q would wait on it for good. A finished shutdown stays finished.
   */
  onRendererReloaded(): void;
}

export function createMacLifecycle(): MacLifecycle {
  let quitting = false;
  let finished = false;
  let hidden = false;
  return {
    get quitting() {
      return quitting;
    },
    get hidden() {
      return hidden;
    },
    onMainWindowClose() {
      if (quitting || finished) return 'close-flow';
      hidden = true;
      return 'hide';
    },
    onActivate() {
      if (!hidden) return 'none';
      hidden = false;
      return 'show';
    },
    onBeforeQuit() {
      if (finished) return 'allow';
      if (quitting) return 'wait';
      quitting = true;
      // The shutdown shows its progress in the main window, so a quit from the Dock brings it back first.
      hidden = false;
      return 'start-shutdown';
    },
    onShutdownFinished() {
      finished = true;
    },
    onShutdownCancelled() {
      quitting = false;
    },
    onRendererReloaded() {
      if (!finished) quitting = false;
    },
  };
}
