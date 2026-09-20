import type { AnchorRect } from '../common/clamp-to-viewport.js';

/**
 * 045 FR-165b, FR-165c (maintainer correction) — collapses any rect to a zero-size POINT at its own
 * bottom-right corner: the link hint's anchor.
 *
 * `clampToViewport` opens a floating surface at `anchor.left, anchor.bottom` by default (its own
 * top-left, at the anchor's bottom edge) and flips/clamps from there. Feeding it a rect whose `left`
 * and `right` already agree, and whose `top` and `bottom` already agree — the "point anchor" form its
 * own doc comment names — makes that opening point land exactly on the source rect's bottom-right
 * corner, so the hint never overlaps the link's own text, while the SAME flip/clamp logic still keeps
 * it fully on screen when that corner is itself near an edge (FR-165c's off-screen case).
 *
 * Shared by all three surfaces (terminal, editor, preview) so "bottom-right of the link's own rect" is
 * decided in exactly one place rather than reimplemented per caller.
 */
export function linkHintAnchor(rect: { left: number; top: number; right: number; bottom: number }): AnchorRect {
  return { left: rect.right, top: rect.bottom, right: rect.right, bottom: rect.bottom };
}
