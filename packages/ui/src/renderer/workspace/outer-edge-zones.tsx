import { useDroppable } from '@dnd-kit/core';
import type { ReactElement } from 'react';
import type { Edge } from '@throng/core';
import { outerEdgeDropId, useDragState } from './drag-state.js';
import { useTabMaximise } from './maximise-store.js';

const EDGES: readonly Edge[] = ['top', 'bottom', 'left', 'right'];

function OuterEdgeZone({ tabId, edge }: { tabId: string; edge: Edge }): ReactElement {
  const { setNodeRef, isOver } = useDroppable({ id: outerEdgeDropId(tabId, edge) });
  return (
    <>
      <div
        ref={setNodeRef}
        className={`outer-edge-zone outer-edge-zone--${edge}${isOver ? ' outer-edge-zone--over' : ''}`}
        data-testid={`outer-edge-${edge}`}
        aria-hidden
      />
      {/* FR-065 — the preview of where the panel will land (a third of the axis, full length), drawn in
          CSS so no geometry is measured while the pointer moves (FR-066). Dashed, so it never reads as
          the solid `.edge-zone--over` highlight of a panel split. */}
      {isOver ? (
        <div
          className={`outer-edge-preview outer-edge-preview--${edge}`}
          data-testid={`outer-edge-preview-${edge}`}
          aria-hidden
        />
      ) : null}
    </>
  );
}

/**
 * 048 FR-060 — drop bands along the four outer edges of a tab's body, shown only while a panel is being
 * dragged. A drop on one moves the panel to run along that whole edge at one third of the axis.
 * Rendered only when the tab has another panel to run beside (core treats a lone panel as a no-op).
 */
export function OuterEdgeZones({ tabId, panelCount }: { tabId: string; panelCount: number }): ReactElement | null {
  const { draggingPanelId } = useDragState();
  // 054 FR-074 — a tab with something maximised takes no dropped panel.
  const { isMaximised } = useTabMaximise(tabId);
  if (isMaximised || draggingPanelId === null || panelCount < 2) return null;
  return (
    <div className="outer-edge-zones" data-testid="outer-edge-zones">
      {EDGES.map((edge) => (
        <OuterEdgeZone key={edge} tabId={tabId} edge={edge} />
      ))}
    </div>
  );
}
