import type { StripMetrics } from '@throng/core';

/**
 * Sub-pixel slack, the same 0.5 `stripCounts` uses (`core/workspace/tab-strip.ts`): a tab overlapping an
 * edge by a third of a pixel is hidden as far as a reader is concerned. Kept equal on purpose — the mark
 * on an overflow control must name the tabs its COUNT counts, or the control would show "2 hidden" and
 * mark for a third.
 */
const EPSILON = 0.5;

/**
 * Which tabs `stripCounts` counts on each side, by id (057 FR-011).
 *
 * `stripCounts` reports how MANY tabs are wholly off each edge; the overflow control's mark needs to
 * know WHICH, to ask whether any of them holds a marked panel. A tab partly in view is on neither side.
 * One pass over the offsets the strip already measured for the counts — no further layout read.
 */
export function hiddenTabIds(
  m: Pick<StripMetrics, 'tabOffsets' | 'scrollLeft' | 'viewportWidth'>,
  tabIds: readonly string[],
): { left: string[]; right: string[] } {
  const viewLeft = m.scrollLeft;
  const viewRight = m.scrollLeft + m.viewportWidth;
  const left: string[] = [];
  const right: string[] = [];
  m.tabOffsets.forEach((tab, i) => {
    const id = tabIds[i];
    if (id === undefined) return;
    if (tab.right <= viewLeft + EPSILON) left.push(id);
    else if (tab.left >= viewRight - EPSILON) right.push(id);
  });
  return { left, right };
}
