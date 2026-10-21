import { useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { clampToViewport } from './clamp-to-viewport.js';

/** Breathing room between the anchor and the surface, baked into the anchor rect. */
export const ANCHOR_GAP = 6;

/**
 * Where a hover popover goes: under `anchor`, flipped or clamped by {@link clampToViewport} so it stays
 * on screen — shared by the tab popover (031 FR-051) and the attention popover (057 FR-097), which had
 * the same measurement written out twice.
 *
 * Measured in a layout effect, from the surface's OWN rendered size (it is as tall as it has lines, so
 * there is no constant to guess with), so the caller can hold the surface `visibility: hidden` while
 * `pos` is `null` and it never paints for a frame at the wrong position. `contentKey` is anything that
 * changes the surface's size while it is open (a renamed panel, a line added): a surface positioned for
 * the size it used to be is a surface off the edge of the screen. A move of under half a pixel keeps the
 * previous object so it costs no render.
 */
export function useAnchoredPosition<T extends HTMLElement>(
  anchor: HTMLElement | null,
  contentKey: string,
): { ref: RefObject<T | null>; pos: { left: number; top: number } | null } {
  const ref = useRef<T>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !anchor) return;
    const a = anchor.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    const next = clampToViewport(
      { left: a.left, right: a.right, top: a.top - ANCHOR_GAP, bottom: a.bottom + ANCHOR_GAP },
      { width: r.width, height: r.height },
      { width: window.innerWidth, height: window.innerHeight },
    );
    setPos((prev) =>
      prev && Math.abs(prev.left - next.left) < 0.5 && Math.abs(prev.top - next.top) < 0.5 ? prev : next,
    );
  }, [anchor, contentKey]);

  return { ref, pos };
}
