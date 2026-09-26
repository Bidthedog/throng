/**
 * Imperative panel-focus registry (012, US3 fix). Each panel VIEW that owns a real
 * input surface (a terminal's xterm textarea, an editor's CodeMirror view) registers
 * a focus callback keyed by its panel id. When keyboard move-focus changes the active
 * panel, the dispatcher calls {@link focusPanel} so DOM focus (and the caret / input
 * routing) actually follows the active-panel indicator — not just the highlight.
 *
 * Module-level (not React state) so it is reachable from the global keydown handler
 * without threading refs through the tree. Callbacks are removed on unmount.
 *
 * 046 FR-125: EVERY panel type registers one. A body made of ordinary controls (the untyped panel's
 * type form, Find in Files) does it through {@link usePanelFocusTarget}; a new panel type is not done
 * until it registers either way.
 */
import { useCallback, useEffect, useRef, type FocusEvent, type RefCallback } from 'react';

const registry = new Map<string, () => void>();

/**
 * A focus asked for BEFORE its panel finished mounting (issue 144).
 *
 * A project switch swaps the whole workspace layout, and the new active tab's editor mounts only
 * AFTER an async `client.load()` round-trip — so a focus requested the instant the switch settles
 * finds no callback yet. Rather than race that mount, the request is parked here and honoured the
 * moment the panel registers (see {@link registerPanelFocus}). Panel ids are unique, so a parked
 * request can only ever be satisfied by the exact panel it named. Null when nothing is pending.
 *
 * ══ ONE SLOT, LAST REQUEST WINS — a decision, not an oversight ══
 *
 * There is exactly one pending id, so a second {@link requestPanelFocus} DISCARDS the first. That is
 * the correct semantic rather than a limitation to grow out of: focus is singular, so two parked
 * requests could only ever mean two panels fighting for one caret, and the later request is the more
 * recent statement of what the user is doing. The discarded one is not "lost work" — the panel it
 * named simply mounts without taking focus, which is what an unfocused panel does anyway.
 *
 * What this does NOT excuse is a registration made before the panel can act on it: `registerPanelFocus`
 * consumes the slot whether or not the callback can deliver, so a view must register only once its
 * input surface is live. `terminal-panel.tsx` documents what that costs to get wrong.
 */
let pendingFocusPanelId: string | null = null;

/**
 * A HOLD on delivering parked focus (046 FR-125 against rename-on-create). While held, a
 * {@link requestPanelFocus} only parks and a registering panel does not take the parked focus.
 *
 * A new tab opens with its name box focused, and the same click makes the new tab active, which
 * `PanelFocusSync` answers by asking for focus in its panel. Delivered, that takes the caret out of the
 * name box, which commits and closes it on blur. So the New Tab control holds delivery for as long as
 * the box is open and releases it when the box closes; the parked request then lands, and focus moves
 * into the new tab's panel as FR-125 requires.
 */
let focusHeld = false;

/** Hold parked-focus delivery (see {@link focusHeld}). Pair with {@link releasePanelFocus}. */
export function holdPanelFocus(): void {
  focusHeld = true;
}

/**
 * End the hold and deliver the parked request, if any — but only when focus is not already somewhere
 * the user put it: a name box closed by clicking elsewhere leaves focus on what was clicked, and that
 * click is the more recent statement of where the user is.
 */
export function releasePanelFocus(): void {
  if (!focusHeld) return;
  focusHeld = false;
  const pending = pendingFocusPanelId;
  if (pending === null) return;
  const active = typeof document === 'undefined' ? null : document.activeElement;
  if (active !== null && active !== document.body) {
    pendingFocusPanelId = null;
    return;
  }
  if (focusPanel(pending)) pendingFocusPanelId = null;
}

/** Register (or replace) the focus callback for a panel view. */
export function registerPanelFocus(panelId: string, focus: () => void): void {
  registry.set(panelId, focus);
  // Honour a focus requested while this panel was still mounting (issue 144) — the project-switch
  // case, where the request beats the deferred editor mount. Clear it so it fires exactly once.
  if (pendingFocusPanelId === panelId && !focusHeld) {
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
  if (focusHeld) return; // delivered on release (see `focusHeld`)
  if (focusPanel(panelId)) pendingFocusPanelId = null;
}

/** Tests only: every registration gone, no focus request left parked, and no hold. */
export function __resetPanelFocus(): void {
  registry.clear();
  pendingFocusPanelId = null;
  focusHeld = false;
}

/** What can take the caret by keyboard: the tabbable controls, in document order. */
const FOCUSABLE =
  'input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), ' +
  'button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';

/**
 * The focus target of a panel whose body is ordinary DOM controls (046 FR-125, constitution v5.6.0
 * Principle XI "Focus follows the active Panel") — the untyped panel's type form and Find in Files.
 *
 * The editor, terminal and preview register their own input surface; a panel made of plain controls
 * gets the same guarantee from here: a keyboard route that makes it the active panel puts the caret
 * on the control inside it that last held focus while that control is still in the panel, else on its
 * first focusable control. A body with no focusable control at all makes its own container focusable
 * (`tabIndex=-1`) and takes focus there, so no route leaves the caret in the panel it left.
 *
 * Returns the two props for the body's ROOT element: the ref it registers against, and the `onFocus`
 * (React's bubbling focusin) that remembers the last control focused inside it.
 */
export function usePanelFocusTarget(panelId: string): {
  ref: RefCallback<HTMLElement>;
  onFocus: (event: FocusEvent<HTMLElement>) => void;
} {
  const containerRef = useRef<HTMLElement | null>(null);
  const lastRef = useRef<HTMLElement | null>(null);

  const ref = useCallback<RefCallback<HTMLElement>>((el) => {
    containerRef.current = el;
  }, []);

  const onFocus = useCallback((event: FocusEvent<HTMLElement>): void => {
    const container = containerRef.current;
    if (event.target instanceof HTMLElement && event.target !== container) lastRef.current = event.target;
  }, []);

  useEffect(() => {
    registerPanelFocus(panelId, () => {
      const container = containerRef.current;
      if (!container) return;
      const last = lastRef.current;
      if (last && last.isConnected && container.contains(last)) {
        last.focus();
        return;
      }
      const first = container.querySelector<HTMLElement>(FOCUSABLE);
      if (first) {
        first.focus();
        return;
      }
      container.tabIndex = -1;
      container.focus();
    });
    return () => unregisterPanelFocus(panelId);
  }, [panelId]);

  return { ref, onFocus };
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
