/**
 * Per-terminal VIEW state — scrollback position and text selection — by panel id
 * (issue 144, follow-up).
 *
 * Switching projects, active panels or active tabs unmounts the terminal and
 * `term.dispose()`s the xterm instance, throwing away its scroll position and
 * selection. The PTY keeps running in the daemon, so on remount the scrollback is
 * re-streamed into a fresh xterm — but the viewport jumps to the bottom and the
 * selection is gone. This module carries the scroll offset and selection across
 * that unmount/remount, keyed by panel id, so coming back leaves the terminal where
 * the user left it.
 *
 * A sibling of `editor-view-state.ts`; module-scoped for the same reason — it must
 * outlive a React remount. Positions are stored RELATIVE TO THE BOTTOM of the
 * buffer, because live output that arrives while the view is detached appends lines
 * and shifts every absolute index; only the distance from the bottom is stable.
 */

/** A 1-based selection range from xterm's `getSelectionPosition()`. */
export interface TerminalSelection {
  start: { x: number; y: number };
  end: { x: number; y: number };
}

export interface TerminalViewState {
  /**
   * How far the viewport top sat above the bottom of the scrollback at save time
   * (`baseY - viewportY`, clamped ≥ 0). Restored against the new `baseY` so the
   * same slice of history is shown even if the buffer grew while detached.
   */
  offsetFromBottom: number;
  /** The selection at save time, if any (xterm 1-based buffer coordinates). */
  selection?: TerminalSelection;
}

const store = new Map<string, TerminalViewState>();

export function saveTerminalViewState(panelId: string, state: TerminalViewState): void {
  store.set(panelId, state);
}

/** Read the saved view state for a panel and consume it (one save → one restore). */
export function takeTerminalViewState(panelId: string): TerminalViewState | undefined {
  const state = store.get(panelId);
  store.delete(panelId);
  return state;
}

/** Drop any saved view state for a panel (called when the terminal is torn down for good). */
export function clearTerminalViewState(panelId: string): void {
  store.delete(panelId);
}
