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
// The payload's SHAPE and the rule that builds it live in @throng/core (buildTreeDragPayload), so
// the decision is unit-testable without a DOM. This module only holds the value for the duration of
// one drag gesture.
export type { TreeDragPayload } from '@throng/core';
import type { TreeDragPayload } from '@throng/core';

/**
 * e2e seam for a tree drop onto a panel (024 US2/US4), mirroring `throng:os-drop`. A real react-dnd
 * drag cannot be driven from Playwright, so tests dispatch this to exercise the drop targets.
 */
export const TREE_DROP_EVENT = 'throng:tree-drop';
export interface TreeDropDetail {
  /** The panel the drop landed on. Exactly one of `panelId` / `tabId` is set. */
  panelId?: string;
  /** The TAB CHIP the drop landed on (024 US4 follow-up) — opens the file in that tab. */
  tabId?: string;
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

/**
 * The drop effect a throng drop target chose for the CURRENT `dragover` event, handed to the
 * window-level listener that has to re-assert it (024 US2/US4).
 *
 * react-dnd's HTML5 backend installs its own window `dragover` that rewrites `dropEffect` to `none`
 * for anything it does not recognise as a react-dnd target — which is every one of ours. So the
 * tree re-asserts the effect afterwards (file-tree.tsx). It used to force `copy` unconditionally,
 * which meant a target that had deliberately REFUSED the drag (a folder over a panel that only takes
 * single files) still showed the copy cursor and promised something it would then not do. A target
 * leaves its decision here instead, and the window listener applies THAT.
 *
 * Read-and-clear, so it can only ever apply to the event that set it.
 */
let pendingEffect: 'copy' | 'none' | null = null;

export function setTreeDropEffect(effect: 'copy' | 'none'): void {
  pendingEffect = effect;
}

export function takeTreeDropEffect(): 'copy' | 'none' | null {
  const effect = pendingEffect;
  pendingEffect = null;
  return effect;
}
