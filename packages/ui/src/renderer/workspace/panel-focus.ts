/**
 * Imperative panel-focus registry (012, US3 fix). Each panel VIEW that owns a real
 * input surface (a terminal's xterm textarea, an editor's CodeMirror view) registers
 * a focus callback keyed by its panel id. When keyboard move-focus changes the active
 * panel, the dispatcher calls {@link focusPanel} so DOM focus (and the caret / input
 * routing) actually follows the active-panel indicator — not just the highlight.
 *
 * Module-level (not React state) so it is reachable from the global keydown handler
 * without threading refs through the tree. Callbacks are removed on unmount.
 */
const registry = new Map<string, () => void>();

/** Register (or replace) the focus callback for a panel view. */
export function registerPanelFocus(panelId: string, focus: () => void): void {
  registry.set(panelId, focus);
}

/** Remove a panel's focus callback (call on unmount). Idempotent. */
export function unregisterPanelFocus(panelId: string): void {
  registry.delete(panelId);
}

/**
 * Move DOM focus into the panel's input surface, if one is registered. Returns
 * whether a focus callback existed (a plain placeholder panel has none — the caller
 * can then fall back to focusing its container).
 */
export function focusPanel(panelId: string): boolean {
  const focus = registry.get(panelId);
  if (!focus) return false;
  try {
    focus();
  } catch {
    /* the view may be tearing down — a missed focus is non-fatal */
  }
  return true;
}
