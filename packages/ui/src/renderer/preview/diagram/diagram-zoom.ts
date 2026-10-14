/**
 * Panel zoom, redirected to the diagram that has keyboard focus (054 MT-04 round, A5).
 *
 * The panel zoom chords (`panel.zoomIn` / `panel.zoomOut` / `panel.zoomReset`) and Ctrl+wheel /
 * Ctrl+middle-click otherwise change the whole panel's font size. With focus inside a diagram's frame the
 * reader is looking at the diagram, so those gestures zoom just that diagram — the same zoom its own
 * buttons drive. With focus anywhere else the callers fall through to panel zoom, as before.
 *
 * A frame announces itself with `data-diagram-zoom-key` on the element that holds its toolbar and viewport
 * (the same element in place and in the maximise layer) and registers what zooming it means here under the
 * same key. Both callers — the window key dispatcher and the mouse-zoom handler — ask one question,
 * {@link zoomFocusedDiagram}, so the two routes cannot disagree about which diagram is "focused".
 */

export const DIAGRAM_ZOOM_KEY_ATTR = 'data-diagram-zoom-key';

export type DiagramZoomAction = 'in' | 'out' | 'reset';

/**
 * Where the pointer was, in client coordinates, when a zoom names one: Ctrl+wheel zooms about it (FR-046l).
 * A zoom without one — a chord, Ctrl+middle-click — zooms about the centre of the diagram's visible box.
 */
export interface DiagramZoomPoint {
  clientX: number;
  clientY: number;
}

type DiagramZoom = (action: DiagramZoomAction, at?: DiagramZoomPoint) => void;

const targets = new Map<string, DiagramZoom>();

/** The key a frame is registered under: unique within a window (panel ids are, sections are within a panel). */
export function diagramZoomKey(panelId: string, sectionId: string): string {
  return `${panelId}::${sectionId}`;
}

/** Register what zooming the diagram under `key` does. Returns the unregister function. */
export function registerDiagramZoom(key: string, zoom: DiagramZoom): () => void {
  targets.set(key, zoom);
  return () => {
    if (targets.get(key) === zoom) targets.delete(key);
  };
}

/**
 * If keyboard focus (`from`, by default the document's active element) is inside a diagram frame, zoom
 * that diagram by `action` — about `at` when the gesture has a pointer position — and return true;
 * otherwise do nothing and return false.
 */
export function zoomFocusedDiagram(
  action: DiagramZoomAction,
  from: Element | null = document.activeElement,
  at?: DiagramZoomPoint,
): boolean {
  const frame = from?.closest?.(`[${DIAGRAM_ZOOM_KEY_ATTR}]`);
  const key = frame?.getAttribute(DIAGRAM_ZOOM_KEY_ATTR);
  if (key === null || key === undefined) return false;
  return zoomByKey(key, action, at);
}

/**
 * Marks a frame that fills its panel — a standalone `.mmd` preview, which IS its one diagram. While that panel
 * is the active one the diagram is the selected thing, focused or not (MT-04 retest, 2026-10-13).
 */
export const DIAGRAM_FILLS_PANEL_ATTR = 'data-diagram-fills-panel';

/**
 * If panel `panelId` is filled by a diagram, zoom that diagram by `action` and return true; otherwise do nothing
 * and return false. The callers ask this after {@link zoomFocusedDiagram}, before falling through to panel zoom.
 */
export function zoomPanelDiagram(panelId: string, action: DiagramZoomAction, at?: DiagramZoomPoint): boolean {
  const frame = document
    .querySelector(`[data-panel-host="${CSS.escape(panelId)}"]`)
    ?.querySelector(`[${DIAGRAM_FILLS_PANEL_ATTR}][${DIAGRAM_ZOOM_KEY_ATTR}]`);
  const key = frame?.getAttribute(DIAGRAM_ZOOM_KEY_ATTR);
  if (key === null || key === undefined) return false;
  return zoomByKey(key, action, at);
}

function zoomByKey(key: string, action: DiagramZoomAction, at?: DiagramZoomPoint): boolean {
  const zoom = targets.get(key);
  if (zoom === undefined) return false;
  if (at === undefined) zoom(action);
  else zoom(action, at);
  return true;
}
