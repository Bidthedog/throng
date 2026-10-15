/**
 * Moving a tile or a row to its new place (055 FR-090): a short slide from where it was, played with the
 * Web Animations API, and none at all under reduced motion.
 *
 * Only the DISTANCE is passed in — the callers know where things were without reading the layout back (a
 * tile's place is the treemap's own arithmetic, a row's is its index times one row height), because a
 * layout read per row is exactly what the monitor must not cost (Principle XII, SC-003).
 */

/** How long a move takes (FR-090: "a short animation"). */
export const MOVE_MS = 200;

export function prefersReducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
}

/** Slide `el` from `(dx, dy)` away to where it now is. A no-op under reduced motion or without animation support. */
export function moveFrom(el: Element, dx: number, dy: number): void {
  if (typeof el.animate !== 'function' || prefersReducedMotion()) return;
  el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration: MOVE_MS, easing: 'ease-out' });
}
