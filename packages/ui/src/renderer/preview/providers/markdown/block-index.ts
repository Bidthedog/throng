/**
 * The Markdown body's index of its source-mapped blocks (073 T075: bounded per-scroll cost).
 *
 * Two-way scroll sync asks the same questions on EVERY scrolled frame — which block is at the top of the viewport, which at
 * its vertical centre, which block an editor line falls in, where that block is — and `scroll-anchor.ts` answers each by
 * measuring EVERY block (`measure`: two attribute reads and a `getBoundingClientRect` per block) and scanning them all.
 * With a 3,000-line document that is ~3,000 layout reads and ~12,000 attribute reads per frame (measured: 116 ms per
 * sync scroll in the component harness, 346 ms at 10,000 lines, linear in the document).
 *
 * This index is built ONCE per drawn document (and again after a fold changes what is hidden), then answers each question
 * by binary search over the blocks' document order, reading a rectangle only for the handful of blocks the search touches:
 * O(log n) layout reads and no attribute reads per frame, whatever the document's size.
 *
 * ══ WHY A BINARY SEARCH IS SOUND ══
 *
 * `data-source-line` never decreases in document order, and neither does a block's top (blocks flow downward; a nested
 * block starts at or below its parent's top). So "the first block whose top is below the edge" is found by bisection, and
 * the block that STRADDLES the edge can only be the one just before it or one of ITS ancestors (an earlier sibling's
 * subtree ends before that block begins). The parent links recorded at build time make that walk a few steps.
 *
 * The answers are the ones `scroll-anchor.ts` gives (`blockAtTop`'s three rules: the deepest block straddling the edge,
 * else the nearest block below it, else the last one above), which `block-index.test.ts` checks against the full scan.
 *
 * ══ STALENESS ══
 *
 * Only the element list, the lines and the parent links are held; rectangles are read live. The body calls
 * {@link BlockIndex.invalidate} after it draws and after a fold changes what is hidden; as a guard against a missed call,
 * a list whose first or last block is no longer in the document is rebuilt on the next question.
 */

const SELECTOR = '[data-source-line]';
/** As `scroll-anchor.ts`: how far past the viewport's top edge a block edge may sit and still count as AT the edge. */
const EDGE_TOLERANCE_PX = 1;
/** How far back from the end the "last block above the edge" rule looks before giving up (the rule needs no more). */
const TAIL_SCAN = 16;

interface Entry {
  el: HTMLElement;
  line: number;
  /** The nearest enclosing source-mapped block's position in the SAME list, or -1. */
  parent: number;
}

interface Rect {
  top: number;
  height: number;
}

export class BlockIndex {
  /** Every source-mapped block, in document order — hidden ones included, as `blockLineFor` sees them. */
  private all: Entry[] | null = null;
  /** The blocks a reader can see: not hidden, and with no hidden ancestor — what `measure` measures. */
  private shown: Entry[] | null = null;
  /** `all` is non-decreasing in line, so line lookups may bisect; otherwise they scan. */
  private monotonic = true;

  constructor(private readonly root: () => HTMLElement | null) {}

  /** The body drew, or a fold changed what is hidden: rebuild on the next question. */
  invalidate(): void {
    this.all = null;
    this.shown = null;
  }

  private ensure(): { all: Entry[]; shown: Entry[] } | null {
    const root = this.root();
    if (root === null) return null;
    if (this.all !== null && this.shown !== null) {
      const first = this.all[0];
      const last = this.all[this.all.length - 1];
      if (first === undefined || (first.el.isConnected && last!.el.isConnected && root.contains(first.el))) {
        return { all: this.all, shown: this.shown };
      }
    }
    const all: Entry[] = [];
    const shown: Entry[] = [];
    const position = new Map<Element, number>();
    const hiddenAt = new Set<number>();
    let monotonic = true;
    for (const el of root.querySelectorAll<HTMLElement>(SELECTOR)) {
      const line = Number(el.getAttribute('data-source-line'));
      if (!Number.isFinite(line)) continue;
      let parent = -1;
      let hidden = el.hasAttribute('hidden');
      for (let a = el.parentElement; a !== null && a !== root; a = a.parentElement) {
        if (a.hasAttribute('hidden')) hidden = true;
        const at = position.get(a);
        if (at !== undefined) {
          parent = at;
          if (hiddenAt.has(at)) hidden = true;
          break;
        }
      }
      const index = all.length;
      if (index > 0 && line < all[index - 1]!.line) monotonic = false;
      position.set(el, index);
      all.push({ el, line, parent });
      if (hidden) hiddenAt.add(index);
    }
    // The shown list is its own array, so its parent links point INTO it.
    const remap = new Map<number, number>();
    all.forEach((e, i) => {
      if (hiddenAt.has(i)) return;
      remap.set(i, shown.length);
      let parent = e.parent;
      while (parent !== -1 && !remap.has(parent)) parent = all[parent]!.parent;
      shown.push({ el: e.el, line: e.line, parent: parent === -1 ? -1 : remap.get(parent)! });
    });
    this.all = all;
    this.shown = shown;
    this.monotonic = monotonic;
    return { all, shown };
  }

  /**
   * The index of the block `blockAtTop`'s three rules choose for an edge `limit` px below the viewport's top, reading only
   * the rectangles the search needs. `tailLimit` is the line "the last block that started above the edge" compares with.
   */
  private blockAt(shown: Entry[], viewportTop: number, limit: number, tailLimit: number): number {
    const n = shown.length;
    const seen = new Map<number, Rect>();
    const rect = (i: number): Rect => {
      let r = seen.get(i);
      if (r === undefined) {
        const box = shown[i]!.el.getBoundingClientRect();
        r = { top: box.top - viewportTop, height: box.height };
        seen.set(i, r);
      }
      return r;
    };
    // The first block that starts below the edge.
    let lo = 0;
    let hi = n;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (rect(mid).top > limit) hi = mid;
      else lo = mid + 1;
    }
    // 1. The deepest block straddling the edge: the block before the boundary or one of its ancestors.
    for (let i = lo - 1; i >= 0; i = shown[i]!.parent) {
      const r = rect(i);
      if (r.top <= limit && r.top + r.height > limit) return i;
    }
    // 2. The edge is in a margin: the nearest block below it — the deepest of those on the same top.
    if (lo < n) {
      let deepest = lo;
      const top = rect(lo).top;
      while (deepest + 1 < n && rect(deepest + 1).top === top) deepest += 1;
      return deepest;
    }
    // 3. Scrolled past every block: the last one that started above the edge.
    for (let i = n - 1; i >= 0 && i >= n - TAIL_SCAN; i -= 1) if (rect(i).top <= tailLimit) return i;
    return -1;
  }

  /** The source line of the block at the TOP of `scroller`'s viewport, as `topBlockLine` answers it. `null`: no blocks. */
  topLine(scroller: HTMLElement): number | null {
    const built = this.ensure();
    if (built === null || built.shown.length === 0) return null;
    const at = this.blockAt(built.shown, scroller.getBoundingClientRect().top, EDGE_TOLERANCE_PX, 0);
    return (built.shown[at] ?? built.shown[0]!).line;
  }

  /** The source line of the block at the vertical CENTRE of `scroller`'s viewport, as `centreBlockLine` answers it. */
  centreLine(scroller: HTMLElement): number | null {
    const built = this.ensure();
    if (built === null || built.shown.length === 0) return null;
    const box = scroller.getBoundingClientRect();
    const middle = box.height / 2;
    const at = this.blockAt(built.shown, box.top, middle, middle);
    return (built.shown[at] ?? built.shown[0]!).line;
  }

  /** The greatest `data-source-line` at or before `line` — the position in `all`, the FIRST block holding it; -1 for none. */
  private firstAtOrBefore(all: Entry[], line: number): number {
    if (!this.monotonic) {
      let found = -1;
      for (let i = 0; i < all.length; i += 1) {
        if (all[i]!.line > line) continue;
        if (found === -1 || all[i]!.line > all[found]!.line) found = i;
      }
      return found;
    }
    // Upper bound: the first block after `line`; the block before it holds the greatest line at or before.
    let lo = 0;
    let hi = all.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (all[mid]!.line > line) hi = mid;
      else lo = mid + 1;
    }
    if (lo === 0) return -1;
    const wanted = all[lo - 1]!.line;
    // Lower bound of that line: its first block.
    let a = 0;
    let b = lo - 1;
    while (a < b) {
      const mid = (a + b) >> 1;
      if (all[mid]!.line >= wanted) b = mid;
      else a = mid + 1;
    }
    return a;
  }

  /**
   * 044 FR-121g — the block `line` is shown in: the block at or before it, or — for a line above every block — the first
   * block. `null` only for a body with no blocks. (`blockOf` in `markdown-body.tsx`.)
   */
  blockOf(line: number): number | null {
    const built = this.ensure();
    if (built === null || built.all.length === 0) return null;
    const at = this.firstAtOrBefore(built.all, line);
    return (at === -1 ? built.all[0]! : built.all[at]!).line;
  }

  /** 073 FR-033d — the element of the block holding `line` (the block at or before it), or `null` when every block starts after it. */
  elementFor(line: number): HTMLElement | null {
    const built = this.ensure();
    if (built === null) return null;
    const at = this.firstAtOrBefore(built.all, line);
    return at === -1 ? null : built.all[at]!.el;
  }

  /**
   * `restoreScrollAnchor({ line, offsetRatio: 0 })` for a sync scroll: bring the deepest shown block on the nearest line at
   * or before `line` to the top of `scroller`, reading one rectangle. The first block stands in for a line above every block.
   */
  scrollLineToTop(scroller: HTMLElement, line: number): void {
    if (line <= 0) {
      scroller.scrollTop = 0;
      return;
    }
    const built = this.ensure();
    if (built === null || built.shown.length === 0) return;
    const { shown } = built;
    // The LAST shown block whose line is at or before `line` (ties go to the later, the deeper).
    let lo = 0;
    let hi = shown.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (shown[mid]!.line > line) hi = mid;
      else lo = mid + 1;
    }
    const target = shown[Math.max(0, lo - 1)]!;
    scroller.scrollTop += target.el.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
  }
}
