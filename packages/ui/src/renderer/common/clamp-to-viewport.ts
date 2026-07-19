/**
 * US11 / FR-036 — the ONE viewport positioner (Principle VIII).
 *
 * Extracted from the context menu, which already flipped and clamped a floating surface on BOTH
 * axes before paint; the colour picker only flipped vertically and so clipped off the right edge.
 * Both now share this pure function, so there is a single place that "keep it on screen" is decided.
 *
 * Places a floating element of `size` against `anchor`:
 * - It opens at the anchor's LEFT / BOTTOM by default.
 * - When that would overflow the right edge it FLIPS to right-align to the anchor
 *   (`anchor.right - size.width`); when it would overflow the bottom it FLIPS ABOVE
 *   (`anchor.top - size.height`).
 * - Whatever remains is CLAMPED so no part leaves the viewport.
 *
 * A point anchor (a cursor position) is expressed as a zero-size rect
 * (`left === right`, `top === bottom`) — which is exactly how the context menu calls it, so its
 * behaviour is unchanged by the extraction.
 */
export interface AnchorRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface Viewport {
  width: number;
  height: number;
}

export function clampToViewport(
  anchor: AnchorRect,
  size: Size,
  viewport: Viewport,
): { left: number; top: number } {
  // Flip when opening at the anchor edge would overflow; otherwise open at the anchor edge.
  let left = anchor.left + size.width > viewport.width ? anchor.right - size.width : anchor.left;
  let top = anchor.bottom + size.height > viewport.height ? anchor.top - size.height : anchor.bottom;
  // Clamp so no part is ever off-screen (covers an element larger than the viewport too).
  left = Math.max(0, Math.min(left, viewport.width - size.width));
  top = Math.max(0, Math.min(top, viewport.height - size.height));
  return { left, top };
}
