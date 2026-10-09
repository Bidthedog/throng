/**
 * Whether throng is closing with **Terminate all** (005 FR-015, US3).
 *
 * Every terminal exit that arrives from then on is throng's own doing, and it is not an end the panel
 * reacts to: no "Terminal exited" notice, and no revert to the type picker. 005 US3 requires a terminal
 * ended by closing throng to be re-created fresh when its project reopens, and the revert — persisted by
 * the close's own drain — is exactly what stopped that. Command memory needs nothing from this path: the
 * observation is persisted as it changes (025 FR-019) and resolved on the next mount (051 FR-046).
 *
 * Since 051 the close waits for every end to settle (FR-015a), so these exits now reliably reach a window
 * that is still open; before, most arrived after it had gone.
 *
 * Two sources, either enough: the main window's close prompt marks it the moment Terminate all is chosen,
 * and UI main announces it to EVERY window before ending anything — a sub-workspace has no prompt.
 * Module-level and never cleared: the application is closing.
 */
let terminating = false;
let unsubscribeBridge: (() => void) | null = null;

export function markAppTerminating(): void {
  terminating = true;
}

export function isAppTerminating(): boolean {
  return terminating;
}

/** Listen for UI main's announcement. Called as a terminal mounts, like the command bridge. */
export function ensureAppTerminatingBridge(): void {
  if (unsubscribeBridge) return;
  unsubscribeBridge = window.throng?.onAppCloseTerminating?.(markAppTerminating) ?? null;
}

/** Test seam: a fresh renderer, and its bridge re-armed against the next `window.throng`. */
export function resetAppTerminating(): void {
  terminating = false;
  unsubscribeBridge?.();
  unsubscribeBridge = null;
}
