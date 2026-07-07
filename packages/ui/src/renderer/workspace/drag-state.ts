import { createContext, useContext } from 'react';

/** Drag state shared from the DnD context down to Panels so they can reveal
 *  their edge drop-zones only while another Panel is being dragged (FR-018). */
export interface DragState {
  draggingPanelId: string | null;
}

export const DragStateContext = createContext<DragState>({ draggingPanelId: null });

export function useDragState(): DragState {
  return useContext(DragStateContext);
}

/** Droppable id helpers (avoid `:` so panel UUIDs parse cleanly). */
export const edgeDropId = (panelId: string, edge: string): string => `edge|${panelId}|${edge}`;
export const parseEdgeDropId = (id: string): { panelId: string; edge: string } | null => {
  const parts = id.split('|');
  return parts[0] === 'edge' ? { panelId: parts[1], edge: parts[2] } : null;
};
export const tabDropId = (tabId: string): string => `tab|${tabId}`;
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
