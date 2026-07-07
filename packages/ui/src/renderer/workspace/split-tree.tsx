import { Fragment, useRef, type PointerEvent as ReactPointerEvent, type ReactElement } from 'react';
import { isPanel, type SplitNode, type LayoutNode } from '@throng/core';
import { useWorkspace } from '../state/workspace-store.js';
import { PanelPlaceholder } from './panel-placeholder.js';
import { clampAdjacent } from './resize-math.js';

/** Minimum cell extent (px) a split divider may shrink a neighbour to (FR-011/038). */
const MIN_CELL_PX = 60;

function Divider({
  node,
  index,
  tabId,
  path,
  containerRef,
}: {
  node: SplitNode;
  index: number;
  tabId: string;
  path: number[];
  containerRef: { current: HTMLDivElement | null };
}): ReactElement {
  const ws = useWorkspace();
  const horizontal = node.orientation === 'row';

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    event.preventDefault();
    event.stopPropagation();
    const container = containerRef.current;
    if (!container) return;
    const total = horizontal ? container.clientWidth : container.clientHeight;
    if (total <= 0) return;
    const startPos = horizontal ? event.clientX : event.clientY;
    const startSizes = [...node.sizes];
    const minFraction = MIN_CELL_PX / total;
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);

    const onMove = (e: globalThis.PointerEvent): void => {
      const pos = horizontal ? e.clientX : e.clientY;
      const deltaFraction = (pos - startPos) / total;
      ws.resizeSplit(tabId, path, clampAdjacent(startSizes, index, deltaFraction, minFraction));
    };
    const onUp = (e: globalThis.PointerEvent): void => {
      target.releasePointerCapture?.(e.pointerId);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  return (
    <div
      className={`split__divider split__divider--${node.orientation}`}
      data-testid={`split-divider-${tabId}-${path.join('.')}-${index}`}
      onPointerDown={onPointerDown}
      aria-hidden
    />
  );
}

function SplitContainer({
  node,
  tabId,
  path,
}: {
  node: SplitNode;
  tabId: string;
  path: number[];
}): ReactElement {
  const containerRef = useRef<HTMLDivElement | null>(null);
  return (
    <div
      ref={containerRef}
      className={`split split--${node.orientation}`}
      data-testid="split-node"
    >
      {node.children.map((child, index) => (
        <Fragment key={index}>
          <div className="split__cell" style={{ flexGrow: node.sizes[index] ?? 1, flexBasis: 0 }}>
            <SplitTree node={child} tabId={tabId} path={[...path, index]} />
          </div>
          {index < node.children.length - 1 ? (
            <Divider
              node={node}
              index={index}
              tabId={tabId}
              path={path}
              containerRef={containerRef}
            />
          ) : null}
        </Fragment>
      ))}
    </div>
  );
}

/**
 * Recursive renderer for a Tab's split tree (FR-013): a SplitNode becomes a flex
 * row/column sized by its fractional `sizes`; leaves are Panels. Dividers between
 * cells are draggable to resize the neighbours (FR-038), addressed by their path
 * from the Tab root and persisted via the workspace store.
 */
export function SplitTree({
  node,
  tabId,
  path,
}: {
  node: LayoutNode;
  tabId: string;
  path: number[];
}): ReactElement {
  if (isPanel(node)) {
    return <PanelPlaceholder panel={node} tabId={tabId} />;
  }
  return <SplitContainer node={node} tabId={tabId} path={path} />;
}
