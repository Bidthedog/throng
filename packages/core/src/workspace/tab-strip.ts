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
  /**
   * The width of the fade drawn over each edge while there is more strip beyond it (#382). A tab
   * under a fade is not shown whole, so a step or a reveal lands it this far clear of the edge.
   * Omitted, it is 0: the edges are bare.
   */
  edgeInset?: number;
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

function inset(m: StripMetrics): number {
  return m.edgeInset ?? 0;
}

/**
 * The part of the viewport no fade covers. A fade is drawn at an edge only while there is more strip
 * beyond it, so at the start there is no left fade and at the end no right one.
 */
function clearView(m: StripMetrics): { left: number; right: number } {
  const fade = inset(m);
  return {
    left: m.scrollLeft + (m.scrollLeft > EPSILON ? fade : 0),
    right: m.scrollLeft + m.viewportWidth - (m.scrollLeft < maxScroll(m) - EPSILON ? fade : 0),
  };
}

/** Where the strip rests to show `tab`'s leading edge clear of the left fade. */
function leadingStop(m: StripMetrics, tab: { left: number }): number {
  return clampScroll(m, tab.left - inset(m));
}

/**
 * Counts of **fully** hidden tabs each side (S1). A tab straddling an edge is partly visible, so it
 * is counted on neither side.
 *
 * This holds in the degenerate case of one tab wider than the whole viewport (S6): it straddles
 * both edges at once, so both counts read 0 while `overflowing` is true.
 *
 * The counts say what is hidden; they do not say whether a step is possible. A strip scrolled a few
 * pixels into its first tab hides nothing entirely, and can still step back (#382, `stepTarget`).
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
 * Target `scrollLeft` for a step: move to the next tab boundary that way, landing that tab's leading
 * edge clear of the left fade (#382, superseding S3/S4).
 *
 * - **left** — the nearest tab start behind the current position. From a strip scrolled part-way
 *   into a tab, that is the start of the tab it cut off; from a tab boundary, the tab before it.
 * - **right** — the nearest tab start ahead of the current position.
 *
 * Available whenever the strip can move that way at all — `null` only at the start (left) or the end
 * (right). It used to be `null` whenever no tab was ENTIRELY hidden that way, which left a strip
 * scrolled by a few pixels with its first tab cut off and no control leading back to it. The hidden
 * counts are unchanged (S1); they no longer decide whether a step is possible.
 *
 * The target is clamped to the content, so a step near the end stops at the end rather than
 * scrolling into empty space.
 */
export function stepTarget(m: StripMetrics, direction: 'left' | 'right'): number | null {
  const max = maxScroll(m);
  if (direction === 'left') {
    if (m.scrollLeft <= EPSILON) return null;
    // The start is always a stop, and the strip is past it.
    let target = 0;
    for (const tab of m.tabOffsets) {
      const stop = leadingStop(m, tab);
      if (stop < m.scrollLeft - EPSILON && stop > target) target = stop;
    }
    return target;
  }
  if (m.scrollLeft >= max - EPSILON) return null;
  // The end is always a stop, and the strip is short of it.
  let target = max;
  for (const tab of m.tabOffsets) {
    const stop = leadingStop(m, tab);
    if (stop > m.scrollLeft + EPSILON && stop < target) target = stop;
  }
  return target;
}

/**
 * Target `scrollLeft` that brings tab `index` into view, or `null` when it is **already fully
 * visible** so the strip must not move (S5, FR-029a).
 *
 * "Fully visible" means clear of the edge fades as well as inside the viewport (#382): a tab under a
 * fade is not shown whole. A tab off the left is brought clear of the left fade; one off the right is
 * brought clear of the right fade — the shortest movement that reveals it. A tab too wide to show
 * whole between the fades has its start shown: a name is read from the left.
 */
export function revealTarget(m: StripMetrics, index: number): number | null {
  if (!Number.isInteger(index)) return null;
  const tab = m.tabOffsets[index];
  if (tab === undefined) return null;

  const view = clearView(m);
  const offLeft = tab.left < view.left - EPSILON;
  const offRight = tab.right > view.right + EPSILON;
  if (!offLeft && !offRight) return null;

  const fade = inset(m);
  const tooWide = tab.right - tab.left > m.viewportWidth - 2 * fade;
  const target =
    offLeft || tooWide ? leadingStop(m, tab) : clampScroll(m, tab.right - m.viewportWidth + fade);
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
