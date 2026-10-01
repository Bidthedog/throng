import { createContext, useContext } from 'react';

/** Drag state shared from the DnD context down to Panels so they can reveal
 *  their edge drop-zones only while another Panel is being dragged (FR-018). */
export interface DragState {
  draggingPanelId: string | null;
  /**
   * The Tab being reordered, if any (031 US7 / FR-059).
   *
   * A tab drag was previously known only to `TabGroup` itself, because nothing below it cared. The
   * close affordance does: a reorder drags the pointer ACROSS the strip by definition, so every chip
   * it passes over would otherwise start arming its X, and the drop would land on a destroy.
   */
  draggingTabId: string | null;
}

export const DragStateContext = createContext<DragState>({
  draggingPanelId: null,
  draggingTabId: null,
});

export function useDragState(): DragState {
  return useContext(DragStateContext);
}

/** Droppable id helpers (avoid `:` so panel UUIDs parse cleanly). */
export const edgeDropId = (panelId: string, edge: string): string => `edge|${panelId}|${edge}`;
export const parseEdgeDropId = (id: string): { panelId: string; edge: string } | null => {
  const parts = id.split('|');
  return parts[0] === 'edge' ? { panelId: parts[1], edge: parts[2] } : null;
};
/** Drop target: a Tab's OUTER edge band (048 FR-060) — `outer|<tabId>|<edge>`. */
export const outerEdgeDropId = (tabId: string, edge: string): string => `outer|${tabId}|${edge}`;
export const parseOuterEdgeDropId = (id: string): { tabId: string; edge: string } | null => {
  const parts = id.split('|');
  return parts[0] === 'outer' && parts.length === 3 ? { tabId: parts[1], edge: parts[2] } : null;
};
/**
 * FR-060 — collision narrowing: when the pointer is inside an outer-edge band it is also inside the
 * panel's own edge zone underneath, and the band must win (it is the more specific, narrower target).
 * Left/right beat top/bottom at a corner (FR-064): the top/bottom bands are inset by the band width in
 * CSS, so a corner only ever lies in a left/right band, and this still resolves an overlap explicitly.
 */
export function preferOuterEdge<T extends { id: string | number }>(collisions: T[]): T[] {
  const outer = collisions.filter((c) => parseOuterEdgeDropId(String(c.id)));
  if (outer.length === 0) return collisions;
  const side = outer.filter((c) => {
    const e = parseOuterEdgeDropId(String(c.id))!.edge;
    return e === 'left' || e === 'right';
  });
  return [(side.length > 0 ? side : outer)[0]];
}
export const tabDropId =(tabId: string): string => `tab|${tabId}`;
export const parseTabDropId = (id: string): string | null =>
  id.startsWith('tab|') ? id.slice(4) : null;
export const panelDragId = (panelId: string): string => `panel|${panelId}`;
export const parsePanelDragId = (id: string): string | null =>
  id.startsWith('panel|') ? id.slice(6) : null;
export const tabDragId = (tabId: string): string => `tabdrag|${tabId}`;
export const parseTabDragId = (id: string): string | null =>
  id.startsWith('tabdrag|') ? id.slice(8) : null;
/** Drop target: the New-Tab (+) button — drop a Panel here to move it into a new solo Tab (FR-027). */
export const NEW_TAB_DROP_ID = 'newtab|+';
