/**
 * Tab strip geometry (031 US3, contracts/tab-strip.md §2).
 *
 * The renderer measures — `offsetLeft`, `offsetWidth`, `scrollLeft`, `clientWidth` — and this
 * module decides. Everything here is arithmetic over those numbers: how many tabs are hidden each
 * side, where a step or a reveal should land, and the curve a scroll follows. No DOM, no timers.
 *
 * Coordinates are the track's own content space: a tab's `left`/`right` are its edges within the
 * scrollable content, and the viewport shows `[scrollLeft, scrollLeft + viewportWidth]`.
 */

/** Measurements of one strip, as taken from the DOM by the caller. */
export interface StripMetrics {
  /** Every tab's content-space edges, in strip order. */
  tabOffsets: ReadonlyArray<{ left: number; right: number }>;
  /** The track's current horizontal scroll offset. */
  scrollLeft: number;
  /** The visible width of the track. */
  viewportWidth: number;
}

/** What the tab-actions group displays (FR-021). */
export interface StripCounts {
  /** Tabs entirely off the left edge. */
  hiddenLeft: number;
  /** Tabs entirely off the right edge. */
  hiddenRight: number;
  /** Every tab in the strip, hidden or not. */
  total: number;
  /** Whether the tabs are wider than the track shows. */
  overflowing: boolean;
}

/**
 * Sub-pixel slack. Layout produces fractional widths, so a tab overlapping the edge by a third of
 * a pixel is hidden as far as a reader is concerned — and treating it as visible would leave a
 * step control enabled that reveals nothing.
 */
const EPSILON = 0.5;

/** Content width, i.e. how far the track can scroll before running out of tabs. */
function contentWidth(m: StripMetrics): number {
  let widest = 0;
  for (const tab of m.tabOffsets) if (tab.right > widest) widest = tab.right;
  return widest;
}

/** The largest legal `scrollLeft`: past this there is nothing left to reveal. */
function maxScroll(m: StripMetrics): number {
  return Math.max(0, contentWidth(m) - m.viewportWidth);
}

function clampScroll(m: StripMetrics, target: number): number {
  return Math.min(Math.max(target, 0), maxScroll(m));
}

/**
 * Counts of **fully** hidden tabs each side (S1). A tab straddling an edge is partly visible, so it
 * is counted on neither side — which is exactly the tab a step lands flush with the left edge.
 *
 * This holds in the degenerate case of one tab wider than the whole viewport (S6): it straddles
 * both edges at once, so both counts read 0 while `overflowing` is true, and the step controls are
 * correctly inert rather than scrolling to a position that reveals nothing.
 */
export function stripCounts(m: StripMetrics): StripCounts {
  const viewLeft = m.scrollLeft;
  const viewRight = m.scrollLeft + m.viewportWidth;
  let hiddenLeft = 0;
  let hiddenRight = 0;
  for (const tab of m.tabOffsets) {
    if (tab.right <= viewLeft + EPSILON) hiddenLeft += 1;
    else if (tab.left >= viewRight - EPSILON) hiddenRight += 1;
  }
  return {
    hiddenLeft,
    hiddenRight,
    total: m.tabOffsets.length,
    overflowing: contentWidth(m) > m.viewportWidth + EPSILON,
  };
}

/**
 * The index of the left-most tab that is not fully hidden to the left — the tab the strip is
 * currently anchored on. `-1` when there are no tabs.
 */
function anchorIndex(m: StripMetrics): number {
  const viewLeft = m.scrollLeft;
  for (let i = 0; i < m.tabOffsets.length; i += 1) {
    if (m.tabOffsets[i]!.right > viewLeft + EPSILON) return i;
  }
  return m.tabOffsets.length - 1;
}

/**
 * Target `scrollLeft` for a step (S3, S4): move by exactly one tab, landing it flush with the
 * viewport's left edge.
 *
 * - **left** — the last tab that is fully hidden to the left becomes flush with the left edge.
 * - **right** — the tab after the current anchor becomes flush with the left edge.
 *
 * `null` when nothing is hidden that way, so the control is unavailable (FR-025), and also when
 * the strip is already at the position the step would produce. The target is clamped to the
 * content, so a step near the end stops at the end rather than scrolling into empty space — the
 * revealed tab is then as far left as it can go.
 */
export function stepTarget(m: StripMetrics, direction: 'left' | 'right'): number | null {
  const counts = stripCounts(m);
  if (direction === 'left' && counts.hiddenLeft === 0) return null;
  if (direction === 'right' && counts.hiddenRight === 0) return null;

  const anchor = anchorIndex(m);
  if (anchor < 0) return null;
  const index = direction === 'left' ? anchor - 1 : anchor + 1;
  const tab = m.tabOffsets[index];
  if (tab === undefined) return null;

  const target = clampScroll(m, tab.left);
  return Math.abs(target - m.scrollLeft) <= EPSILON ? null : target;
}

/**
 * Target `scrollLeft` that brings tab `index` into view, or `null` when it is **already fully
 * visible** so the strip must not move (S5, FR-029a).
 *
 * A tab off the left is brought flush with the left edge; one off the right is brought flush with
 * the right edge — the shortest movement that reveals it. A tab wider than the viewport cannot be
 * shown whole, so its start is shown: a name is read from the left.
 */
export function revealTarget(m: StripMetrics, index: number): number | null {
  if (!Number.isInteger(index)) return null;
  const tab = m.tabOffsets[index];
  if (tab === undefined) return null;

  const viewLeft = m.scrollLeft;
  const viewRight = m.scrollLeft + m.viewportWidth;
  const offLeft = tab.left < viewLeft - EPSILON;
  const offRight = tab.right > viewRight + EPSILON;
  if (!offLeft && !offRight) return null;

  const tooWide = tab.right - tab.left > m.viewportWidth;
  const target = clampScroll(m, offLeft || tooWide ? tab.left : tab.right - m.viewportWidth);
  return Math.abs(target - m.scrollLeft) <= EPSILON ? null : target;
}

/**
 * easeInOutCubic over `[0,1]` (A4, A5): accelerates from rest, is fastest around the middle, and
 * decelerates to a stop. One curve at every duration, so a 30ms scroll and a 3000ms scroll are the
 * same motion at different speeds (FR-030b).
 *
 * `t` is clamped, so a frame that arrives late — or a NaN from a zero-length duration — cannot
 * overshoot the target.
 */
export function ease(t: number): number {
  if (!Number.isFinite(t) || t <= 0) return 0;
  if (t >= 1) return 1;
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}
