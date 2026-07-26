import { useEffect, useRef, type ReactElement, type ReactNode } from 'react';
import {
  getTreeDrag,
  clearTreeDrag,
  setTreeDropEffect,
  TREE_DROP_EVENT,
  type TreeDropDetail,
} from '../explorer/tree-drag-store.js';

/**
 * Dropping a file dragged from Files & Folders onto a panel (024 US4, #114 and its follow-ups).
 *
 * This is the counterpart to {@link PanelDropTarget}, which serves drags that come in from the
 * OPERATING SYSTEM. A drag that starts inside throng's own tree runs on react-arborist's react-dnd
 * channel, whose payload a native drop target cannot read — so the tree records the dragged paths in
 * the tree-drag store and this component reads them back at drop time.
 *
 * It is one component rather than two implementations because the drop must behave IDENTICALLY
 * wherever it lands: an untyped panel becomes an editor showing the file, an existing editor opens
 * the file in place, and in both cases a folder or a multi-select is refused with the "not allowed"
 * cursor rather than half-working. The caller supplies only what differs — what to do with the path,
 * and whether this panel accepts the drag at all.
 *
 * The wrapper is `display: contents` deliberately: it must add NO box. A plain block div collapsed
 * to its content height and left most of the panel body uncovered, so a drop into the empty space
 * below hit an element with no handler and nothing happened at all.
 */
export function TreeDropTarget({
  panelId,
  accepts,
  onDrop,
  children,
}: {
  panelId: string;
  /** Whether this panel will take the current drag (paths + whether it is exactly one file). */
  accepts: (paths: string[], singleFile: boolean) => boolean;
  /** Act on an accepted drop. */
  onDrop: (paths: string[], singleFile: boolean) => void;
  children: ReactNode;
}): ReactElement {
  // Held in refs so the e2e seam listener below registers once per panel and never re-subscribes
  // when the caller passes a fresh closure on re-render.
  const acceptsRef = useRef(accepts);
  const onDropRef = useRef(onDrop);
  acceptsRef.current = accepts;
  onDropRef.current = onDrop;

  // e2e seam: a real react-dnd → native drop cannot be driven from Playwright (mirrors throng:os-drop).
  useEffect(() => {
    const onTreeDrop = (e: Event): void => {
      const detail = (e as CustomEvent<TreeDropDetail>).detail;
      if (!detail || detail.panelId !== panelId) return;
      const single = detail.singleFile ?? false;
      if (!acceptsRef.current(detail.paths, single)) return;
      onDropRef.current(detail.paths, single);
    };
    window.addEventListener(TREE_DROP_EVENT, onTreeDrop);
    return () => window.removeEventListener(TREE_DROP_EVENT, onTreeDrop);
  }, [panelId]);

  return (
    <div
      data-testid={`tree-drop-${panelId}`}
      style={{ display: 'contents' }}
      onDragOver={(e) => {
        const drag = getTreeDrag();
        if (!drag) return; // not our tree drag — let PanelDropTarget / OS handling run
        e.preventDefault();
        // 'none' shows the "not allowed" cursor, which is the refusal the user can see. It is also
        // handed to the window-level re-assert (see setTreeDropEffect) so react-dnd's blanket 'none'
        // cannot erase an accept, and the tree's re-assert cannot erase a refusal.
        const effect = acceptsRef.current(drag.paths, drag.singleFile) ? 'copy' : 'none';
        e.dataTransfer.dropEffect = effect;
        setTreeDropEffect(effect);
      }}
      onDrop={(e) => {
        const drag = getTreeDrag();
        if (!drag) return;
        e.preventDefault();
        clearTreeDrag();
        if (!acceptsRef.current(drag.paths, drag.singleFile)) return;
        onDropRef.current(drag.paths, drag.singleFile);
      }}
    >
      {children}
    </div>
  );
}
