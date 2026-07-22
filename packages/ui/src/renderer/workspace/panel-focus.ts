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

/**
 * A focus asked for BEFORE its panel finished mounting (issue 144).
 *
 * A project switch swaps the whole workspace layout, and the new active tab's editor mounts only
 * AFTER an async `client.load()` round-trip — so a focus requested the instant the switch settles
 * finds no callback yet. Rather than race that mount, the request is parked here and honoured the
 * moment the panel registers (see {@link registerPanelFocus}). Panel ids are unique, so a parked
 * request can only ever be satisfied by the exact panel it named. Null when nothing is pending.
 */
let pendingFocusPanelId: string | null = null;

/** Register (or replace) the focus callback for a panel view. */
export function registerPanelFocus(panelId: string, focus: () => void): void {
  registry.set(panelId, focus);
  // Honour a focus requested while this panel was still mounting (issue 144) — the project-switch
  // case, where the request beats the deferred editor mount. Clear it so it fires exactly once.
  if (pendingFocusPanelId === panelId) {
    pendingFocusPanelId = null;
    try {
      focus();
    } catch {
      /* view may already be tearing down — a missed focus is non-fatal */
    }
  }
}

/** Remove a panel's focus callback (call on unmount). Idempotent. */
export function unregisterPanelFocus(panelId: string): void {
  registry.delete(panelId);
}

/**
 * Move focus into a panel NOW if it is mounted, else the instant it mounts (issue 144).
 *
 * Used on a tab/project SWITCH: the settled active panel must take the caret even though a project
 * switch defers its editor's mount behind an async layout load, and even though the click that
 * triggered the switch left DOM focus on the (focusable) project button in the sidebar. A one-shot
 * `view.focus()` fired inside the async mount is lost in that churn; parking the request until the
 * panel registers is what makes it stick.
 */
export function requestPanelFocus(panelId: string): void {
  pendingFocusPanelId = panelId;
  if (focusPanel(panelId)) pendingFocusPanelId = null;
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
