/**
 * Move-focus geometry (012, US3 / contracts/focus-move.md). Given a Tab's split
 * tree and the active panel id, compute the directional and cyclic focus targets.
 * Pure, deterministic, DOM-free (Principle II) — the split tree already encodes
 * orientation + fractional sizes, so normalized rectangles are derived from it
 * rather than measured from the DOM.
 */
import { isPanel, type LayoutNode } from './model.js';

/** A normalized rectangle in the `[0,1]²` layout space. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type Direction = 'left' | 'right' | 'up' | 'down';

const EPS = 1e-6;

/**
 * Assign every Panel in the split tree a normalized rectangle. A `row` split
 * divides its rectangle along **x** by the children's fractional sizes (left →
 * right); a `column` split divides along **y** (top → bottom).
 */
export function panelRects(root: LayoutNode): Map<string, Rect> {
  const out = new Map<string, Rect>();
  const walk = (node: LayoutNode, rect: Rect): void => {
    if (isPanel(node)) {
      out.set(node.id, rect);
      return;
    }
    const horizontal = node.orientation === 'row';
    const total = node.sizes.reduce((a, b) => a + b, 0) || 1;
    let offset = horizontal ? rect.x : rect.y;
    node.children.forEach((child, i) => {
      const frac = (node.sizes[i] ?? 1 / node.children.length) / total;
      const span = (horizontal ? rect.w : rect.h) * frac;
      const childRect: Rect = horizontal
        ? { x: offset, y: rect.y, w: span, h: rect.h }
        : { x: rect.x, y: offset, w: rect.w, h: span };
      walk(child, childRect);
      offset += span;
    });
  };
  walk(root, { x: 0, y: 0, w: 1, h: 1 });
  return out;
}

/** Whether two 1-D intervals `[a0,a1]` and `[b0,b1]` overlap by more than EPS. */
function overlaps(a0: number, a1: number, b0: number, b1: number): boolean {
  return Math.min(a1, b1) - Math.max(a0, b0) > EPS;
}

/**
 * The nearest Panel on the `dir` side of `activeId` that overlaps it on the
 * perpendicular axis, or `null` when none exists — the clarified stay-put-at-edge
 * (no wrap, FR-015). Ties break toward the candidate whose perpendicular centre is
 * closest to the active's, so a move is spatially predictable.
 */
export function moveFocus(root: LayoutNode, activeId: string, dir: Direction): string | null {
  const rects = panelRects(root);
  const active = rects.get(activeId);
  if (!active) return null;

  const aCentreX = active.x + active.w / 2;
  const aCentreY = active.y + active.h / 2;

  let best: { id: string; primary: number; secondary: number } | null = null;
  for (const [id, r] of rects) {
    if (id === activeId) continue;

    let onSide = false;
    let primary = 0; // distance along the move axis (smaller = nearer)
    let perpOverlap = false;
    let secondary = 0; // perpendicular-centre distance (tie-break)

    switch (dir) {
      case 'right':
        onSide = r.x >= active.x + active.w - EPS;
        primary = r.x - (active.x + active.w);
        perpOverlap = overlaps(active.y, active.y + active.h, r.y, r.y + r.h);
        secondary = Math.abs(r.y + r.h / 2 - aCentreY);
        break;
      case 'left':
        onSide = r.x + r.w <= active.x + EPS;
        primary = active.x - (r.x + r.w);
        perpOverlap = overlaps(active.y, active.y + active.h, r.y, r.y + r.h);
        secondary = Math.abs(r.y + r.h / 2 - aCentreY);
        break;
      case 'down':
        onSide = r.y >= active.y + active.h - EPS;
        primary = r.y - (active.y + active.h);
        perpOverlap = overlaps(active.x, active.x + active.w, r.x, r.x + r.w);
        secondary = Math.abs(r.x + r.w / 2 - aCentreX);
        break;
      case 'up':
        onSide = r.y + r.h <= active.y + EPS;
        primary = active.y - (r.y + r.h);
        perpOverlap = overlaps(active.x, active.x + active.w, r.x, r.x + r.w);
        secondary = Math.abs(r.x + r.w / 2 - aCentreX);
        break;
    }

    if (!onSide || !perpOverlap) continue;
    if (
      best === null ||
      primary < best.primary - EPS ||
      (Math.abs(primary - best.primary) <= EPS && secondary < best.secondary)
    ) {
      best = { id, primary, secondary };
    }
  }
  return best ? best.id : null;
}

/**
 * The stable in-order depth-first leaf sequence = layout order (panes left → right,
 * top → bottom; tabs in order within a pane). Independent of focus history.
 */
export function cycleOrder(root: LayoutNode): string[] {
  const out: string[] = [];
  const walk = (node: LayoutNode): void => {
    if (isPanel(node)) {
      out.push(node.id);
      return;
    }
    node.children.forEach(walk);
  };
  walk(root);
  return out;
}

/**
 * The next (`step === 1`) or previous (`step === -1`) panel id in the cycle order,
 * wrapping within the ordered ring. Returns `activeId` unchanged if it is not in
 * the order (or the ring is empty).
 */
export function nextInCycle(order: string[], activeId: string, step: 1 | -1): string {
  if (order.length === 0) return activeId;
  const idx = order.indexOf(activeId);
  if (idx < 0) return activeId;
  const next = (idx + step + order.length) % order.length;
  return order[next];
}
