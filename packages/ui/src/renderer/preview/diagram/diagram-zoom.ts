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

const targets = new Map<string, (action: DiagramZoomAction) => void>();

/** The key a frame is registered under: unique within a window (panel ids are, sections are within a panel). */
export function diagramZoomKey(panelId: string, sectionId: string): string {
  return `${panelId}::${sectionId}`;
}

/** Register what zooming the diagram under `key` does. Returns the unregister function. */
export function registerDiagramZoom(key: string, zoom: (action: DiagramZoomAction) => void): () => void {
  targets.set(key, zoom);
  return () => {
    if (targets.get(key) === zoom) targets.delete(key);
  };
}

/**
 * If keyboard focus (`from`, by default the document's active element) is inside a diagram frame, zoom
 * that diagram by `action` and return true; otherwise do nothing and return false.
 */
export function zoomFocusedDiagram(action: DiagramZoomAction, from: Element | null = document.activeElement): boolean {
  const frame = from?.closest?.(`[${DIAGRAM_ZOOM_KEY_ATTR}]`);
  const key = frame?.getAttribute(DIAGRAM_ZOOM_KEY_ATTR);
  if (key === null || key === undefined) return false;
  const zoom = targets.get(key);
  if (zoom === undefined) return false;
  zoom(action);
  return true;
}
