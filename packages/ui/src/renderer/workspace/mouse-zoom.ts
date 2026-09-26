/**
 * Ctrl+wheel / Ctrl+middle-click zoom the PANEL under the pointer (046 iterate round 1, T118/T119,
 * FR-106) — replacing `registerMouseZoom`'s hard-coded WINDOW zoom (`main.tsx`, pre-round). That
 * function ran at module scope, before the composition root even mounted, with no access to the
 * workspace store or the live keybindings, and dispatched straight to `window.throng.zoomBy` /
 * `zoomReset` unconditionally. Both gaps are what this module closes: it is a MOUNTED component,
 * so it can read `useWorkspace()` and the live keybindings, and it dispatches by PANEL id rather
 * than the window.
 *
 * Resolution reads the LIVE keybindings (Principle X): whichever action `Ctrl+WheelUp` /
 * `Ctrl+WheelDown` / `Ctrl+MiddleClick` is bound to right now is what runs — by default
 * `panel.zoomIn` / `panel.zoomOut` / `panel.zoomReset` (`packages/core/src/config/keybindings.ts`),
 * but a user who rebinds the gesture elsewhere gets THAT action, and a user who removes it from
 * every action gets nothing. Deliberately scope-INDEPENDENT, unlike `resolveAction`'s keyboard
 * callers: a mouse gesture answers "which panel is under the pointer", not "where is keyboard
 * focus", so it is resolved by a direct scan of the live bindings rather than through
 * `resolveScoped`.
 *
 * Every Ctrl+wheel / Ctrl+middle-click over the window is `preventDefault`ed regardless of whether
 * a panel is under the pointer (FR-106, derived) — otherwise Chromium's own page zoom sees whatever
 * a miss over the title bar or a side pane leaves unhandled.
 *
 * Mounted once per workspace window (the main window's `App` and each sub-workspace's
 * `SubWorkspaceApp`), following `PanelStateSync`'s shape: no props, an effect that installs the
 * window listeners and tears them down on unmount, live values read through refs so the listener is
 * not resubscribed on every keybindings/layout change.
 */
import { useEffect, useRef } from 'react';
import { eventToToken, normalizeToken, type ActionId, type Keybindings } from '@throng/core';
import { useKeybindings } from '../config/config-store.js';
import { useWorkspace } from '../state/workspace-store.js';

type Gesture = 'WheelUp' | 'WheelDown' | 'MiddleClick';

/** The action bound to a Ctrl+`gesture`, read from the LIVE keybindings — or null if none is. */
function actionForGesture(kb: Keybindings, gesture: Gesture): ActionId | null {
  const token = eventToToken({ ctrl: true, gesture });
  if (!token) return null;
  const norm = normalizeToken(token);
  for (const [action, tokens] of Object.entries(kb.bindings)) {
    if (tokens.some((t) => normalizeToken(t) === norm)) return action as ActionId;
  }
  return null;
}

/**
 * The panel under `target`, from a marker ONLY the panel host itself emits
 * (`panel-placeholder.tsx`'s `data-panel-host`).
 *
 * NOT `data-panel-id`: `notification.tsx`'s notice "affected panels" rows carry that too, purely as
 * a test hook (FR-038) — a row naming a panel is not that panel, and is not even inside its DOM
 * subtree, so `closest('[data-panel-id]')` would match the row itself and zoom whatever panel it
 * happened to name (046 fix round, IMPORTANT review finding).
 */
function panelIdUnder(target: EventTarget | null): string | null {
  if (!(target instanceof Element)) return null;
  return target.closest('[data-panel-host]')?.getAttribute('data-panel-host') ?? null;
}

export function MouseZoomHandler(): null {
  const keybindings = useKeybindings();
  const ws = useWorkspace();
  const kbRef = useRef(keybindings);
  kbRef.current = keybindings;
  const wsRef = useRef(ws);
  wsRef.current = ws;

  useEffect(() => {
    /*
     * `action` is resolved once, independently of whether a panel is under the pointer — a WINDOW
     * command (`zoom.in`/`zoom.out`/`zoom.reset`) fires regardless, exactly as the pre-round
     * hard-coded handler zoomed the window from anywhere; a PANEL command needs a `panelId` and
     * no-ops without one.
     *
     * 046 fix round (FR-108, IMPORTANT review finding) — a REBOUND `zoom.in`/`zoom.out`/`zoom.reset`
     * is left exactly as saved (FR-108's own note), so a user whose document still carries the
     * pre-round `Ctrl+WheelUp`/`Ctrl+WheelDown`/`Ctrl+MiddleClick` on one of THESE actions (only an
     * UNTOUCHED document is migrated off the gesture) keeps the WINDOW-zoom meaning that chord has
     * always had. Without these three cases the gesture still resolved to the action — and still
     * `preventDefault`ed it away from Chromium — but dispatched nothing: worse than the pre-round
     * behaviour it replaced, not merely unchanged.
     */
    const dispatch = (action: ActionId | null, panelId: string | null): void => {
      switch (action) {
        case 'panel.zoomIn':
          if (panelId) wsRef.current.bumpZoom(panelId, 1);
          break;
        case 'panel.zoomOut':
          if (panelId) wsRef.current.bumpZoom(panelId, -1);
          break;
        case 'panel.zoomReset':
          if (panelId) wsRef.current.resetZoom(panelId);
          break;
        case 'zoom.in':
          window.throng?.zoomBy?.(1);
          break;
        case 'zoom.out':
          window.throng?.zoomBy?.(-1);
          break;
        case 'zoom.reset':
          window.throng?.zoomReset?.();
          break;
        default:
          break; // unbound, or rebound to something no gesture here can run
      }
    };
    const onWheel = (event: WheelEvent): void => {
      // A tilt-wheel / horizontal-swipe event (deltaY 0) carries no vertical zoom intent at all —
      // ignored outright, not read as WheelDown (046 fix round, MINOR review finding).
      if (!event.ctrlKey || event.deltaY === 0) return;
      event.preventDefault(); // suppress Chromium's own page zoom, hit or miss
      dispatch(
        actionForGesture(kbRef.current, event.deltaY < 0 ? 'WheelUp' : 'WheelDown'),
        panelIdUnder(event.target),
      );
    };
    const onMouseDown = (event: MouseEvent): void => {
      if (!event.ctrlKey || event.button !== 1) return;
      event.preventDefault(); // suppress middle-click autoscroll, hit or miss
      dispatch(actionForGesture(kbRef.current, 'MiddleClick'), panelIdUnder(event.target));
    };
    window.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('mousedown', onMouseDown);
    return () => {
      window.removeEventListener('wheel', onWheel);
      window.removeEventListener('mousedown', onMouseDown);
    };
  }, []);

  return null;
}
