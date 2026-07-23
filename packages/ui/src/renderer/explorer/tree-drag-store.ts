/**
 * Shared tree-drag payload (024 US2/US4, #155/#114).
 *
 * The file tree's own drag runs on react-arborist's react-dnd channel, which a native drop target on
 * a terminal or an empty panel cannot read. So on drag start the tree records the dragged items'
 * ABSOLUTE paths here; a panel's native `drop` reads them back. Cleared on drag end.
 *
 * This is deliberately a tiny module-level record, not React state — it is written and read across
 * unrelated component trees within one drag gesture, and must not trigger a re-render to be useful.
 */
export interface TreeDragPayload {
  /** Absolute paths of the dragged items, in selection order. */
  paths: string[];
  /** True iff the drag is exactly ONE file (not a folder, not multi-select) — US4 accepts only this
   *  onto an empty panel; a terminal (US2) ignores it and takes every path. */
  singleFile: boolean;
}

/**
 * e2e seam for a tree drop onto a panel (024 US2/US4), mirroring `throng:os-drop`. A real react-dnd
 * drag cannot be driven from Playwright, so tests dispatch this to exercise the drop targets.
 */
export const TREE_DROP_EVENT = 'throng:tree-drop';
export interface TreeDropDetail {
  panelId: string;
  paths: string[];
  /** US4: whether the drag is a single file (an untyped panel accepts only this). */
  singleFile?: boolean;
}

let current: TreeDragPayload | null = null;

export function setTreeDrag(payload: TreeDragPayload): void {
  current = payload;
}

export function getTreeDrag(): TreeDragPayload | null {
  return current;
}

export function clearTreeDrag(): void {
  current = null;
}
