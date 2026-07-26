/**
 * Imperative "start renaming this panel" registry (024 follow-up, `panel.rename`).
 *
 * A panel's rename box is local state inside its own header — which is right, because nothing else
 * has any business knowing whether a header is currently an input. But the F2 chord is resolved by
 * the window-level keybinding handler, which knows only the ACTIVE PANEL'S ID and cannot reach into
 * a component's state to say "start now".
 *
 * So each header registers how to begin, keyed by its panel id, exactly as the panel FOCUS registry
 * already does for the caret. Module-level rather than React state for the same reason as that one:
 * it is read from a global keydown listener, and threading a ref through the tree to serve one
 * keystroke would be a worse answer than a map.
 */
const starters = new Map<string, () => void>();

/** Register (or replace) how a panel's header begins a rename. */
export function registerPanelRename(panelId: string, start: () => void): void {
  starters.set(panelId, start);
}

/** Remove a panel's starter (call on unmount). Idempotent. */
export function unregisterPanelRename(panelId: string): void {
  starters.delete(panelId);
}

/**
 * Begin renaming the given panel. Returns whether anything was listening — a panel whose header is
 * not mounted (or has already gone) is a no-op, not an error.
 */
export function requestPanelRename(panelId: string): boolean {
  const start = starters.get(panelId);
  if (!start) return false;
  try {
    start();
  } catch {
    /* the header may be tearing down — a missed rename is not worth a crash */
  }
  return true;
}
