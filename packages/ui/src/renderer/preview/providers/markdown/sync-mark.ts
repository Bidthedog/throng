/**
 * The Markdown preview's half of the sync mark (073 FR-033d): an indicator in the preview gutter (047 FR-032a), level
 * with the rendered block that holds the source line the pair is in step at.
 *
 * The block is the one `blockLineFor` names for that line — the same reading scroll sync already uses, so no second
 * mapping. The indicator is a class on that block (`preview-sync-mark`, plus `--on` while bright); markdown.css draws it
 * in the gutter strip beside the block, so no node is inserted into the rendered document and nothing here can reach
 * copy, find or the scroll anchor. It is drawn only while the gutter is shown: with the gutter Disabled (047 FR-032b)
 * there is no strip and no class, and the editor's own highlight still shows.
 */
import { blockElementFor } from './scroll-anchor.js';
import type { SyncMark } from '../../sync-mark-store.js';

export const SYNC_MARK_CLASS = 'preview-sync-mark';
export const SYNC_MARK_ON_CLASS = 'preview-sync-mark--on';

/** Put the indicator on the block holding `mark.line` (and only there), or take it off every block. */
export function applySyncMark(root: HTMLElement, mark: SyncMark | null | undefined, gutter: boolean): void {
  const target = mark !== null && mark !== undefined && gutter ? blockElementFor(root, mark.line) : null;
  for (const el of Array.from(root.querySelectorAll<HTMLElement>(`.${SYNC_MARK_CLASS}`))) {
    if (el === target) continue;
    el.classList.remove(SYNC_MARK_CLASS, SYNC_MARK_ON_CLASS);
  }
  if (target === null || mark === null || mark === undefined) return;
  target.classList.add(SYNC_MARK_CLASS);
  target.classList.toggle(SYNC_MARK_ON_CLASS, mark.on);
}
