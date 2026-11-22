/**
 * The Markdown preview's half of the sync mark (073 FR-033d): an indicator in the preview gutter (047 FR-032a), level
 * with the rendered block that holds the source line the pair is in step at.
 *
 * The block is the one the body's `BlockIndex` names for that line — the same reading scroll sync already uses, so no
 * second mapping. The indicator is a class on that block (`preview-sync-mark`, plus `--on` while bright); markdown.css draws
 * it in the gutter strip beside the block, so no node is inserted into the rendered document and nothing here can reach
 * copy, find or the scroll anchor. The class also washes the block as the editor washes its line (2026-11-22), whatever
 * the gutter; the bar is drawn only while the gutter is shown (its rules are scoped to `.preview-markdown--gutter`), so
 * with the gutter Disabled (047 FR-032b) the block is washed and has no bar (073 T108).
 *
 * It remembers the block it marked, so a mark that moves every frame touches TWO elements (take the class off the old
 * block, put it on the new one) and searches no part of the document (T075).
 */
import type { SyncMark } from '../../sync-mark-store.js';
import type { BlockIndex } from './block-index.js';
import { SYNC_MARK_CLASS, SYNC_MARK_ON_CLASS } from '../../sync-mark-classes.js';

export { SYNC_MARK_CLASS, SYNC_MARK_ON_CLASS };

export class SyncMarkIndicator {
  private current: HTMLElement | null = null;

  constructor(private readonly index: BlockIndex) {}

  /** Put the indicator on the block holding `mark.line` (and only there), or take it off. */
  apply(mark: SyncMark | null | undefined): void {
    // A redraw replaced the marked block: there is nothing left to take the class off.
    if (this.current !== null && !this.current.isConnected) this.current = null;
    const target = mark !== null && mark !== undefined ? this.index.shownElementFor(mark.line) : null;
    if (this.current !== null && this.current !== target) {
      this.current.classList.remove(SYNC_MARK_CLASS, SYNC_MARK_ON_CLASS);
      this.current = null;
    }
    if (target === null || mark === null || mark === undefined) return;
    this.current = target;
    if (!target.classList.contains(SYNC_MARK_CLASS)) target.classList.add(SYNC_MARK_CLASS);
    target.classList.toggle(SYNC_MARK_ON_CLASS, mark.on);
  }
}
