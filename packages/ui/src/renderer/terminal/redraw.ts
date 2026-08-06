import { countReconcile, type ReconcileTrigger } from './diagnostics.js';

/**
 * Ask the daemon to make a terminal's running program redraw its whole screen (028, #162/#163).
 *
 * This is the single route for both halves of the feature: the automatic one (a rebuilt view has
 * just attached, so what it reconstructed from the replayed byte tail may not be what the program
 * believes is on screen) and the manual one (the "Refresh / redraw terminal" action and `Ctrl+F5`).
 * One route because they must behave identically — FR-047 requires the manual action to work even
 * when nothing about the panel's measured size has changed, which is exactly the automatic case too.
 *
 * Deliberately fire-and-forget. A repaint is a best-effort nudge: it cannot fail in a way the user
 * could act on, and making the caller await it would put a daemon round-trip in front of a tab
 * switch (SC-012 — activation must never block).
 */
/**
 * How to repaint a panel's own view, registered by the terminal that owns it.
 *
 * The daemon's half of a redraw only applies to a program on the ALTERNATE screen: a nudge is the
 * only way to make one repaint, and it is unsafe anywhere else — a console resize reflows the normal
 * buffer, and one Ctrl+F5 at a shell prompt was measured destroying 120 lines of output. The normal
 * screen never needed the pty for this: its content is already in the view's buffer, so the redraw
 * it wants is a client-side repaint.
 */
const refreshers = new Map<string, () => void>();

/** Register a terminal view's own repaint. Returns the matching deregistration. */
export function registerTerminalRefresh(panelId: string, refresh: () => void): () => void {
  refreshers.set(panelId, refresh);
  return () => {
    if (refreshers.get(panelId) === refresh) refreshers.delete(panelId);
  };
}

export function requestRedraw(panelId: string, trigger: ReconcileTrigger): void {
  countReconcile(panelId, trigger);
  // Ask the program, for the case where only the program can answer…
  void window.throng?.terminal?.repaint?.(panelId);
  // …and repaint the view regardless, which is the whole of a normal-screen redraw and harmless
  // alongside the nudge. Synchronous and local: no round-trip in front of a tab switch (SC-012).
  refreshers.get(panelId)?.();
}
