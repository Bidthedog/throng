/**
 * Middle-button drag scrolls a preview (074, maintainer's request 2026-11-19), as it already pans a diagram or a
 * picture (054 FR-046e, 074 FR-031a): press the middle button anywhere in a preview's body and the content follows
 * the pointer, with the move cursor, and Chromium's own middle-click autoscroll never starts.
 *
 * One handler set on the preview panel body, so every provider whose body scrolls — Markdown, PDF, and any to come —
 * gets the gesture without wiring it itself. It scrolls the NEAREST scrollable box under the pointer, up to and
 * including the body: a Markdown document scrolls the body itself, a PDF its own page column.
 *
 * It stands aside where a press is already someone else's:
 * - a diagram or picture frame pans its own drawing and prevents the press first (React runs the innermost handler
 *   first), so `defaultPrevented` leaves it alone;
 * - Ctrl+middle-click is the panel's zoom reset (`mouse-zoom.ts`), not a drag.
 *
 * An HTML preview's page is an isolated frame (074 FR-074): its pointer events never reach this document, so it
 * cannot be dragged from here.
 */
import { useCallback, useRef, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react';

/** On the body for as long as a drag lasts: the move cursor everywhere in it (`preview.css`). */
export const PREVIEW_PANNING_CLASS = 'preview-panel__body--panning';

function scrolls(overflow: string): boolean {
  return overflow === 'auto' || overflow === 'scroll';
}

/** The nearest box from `from` up to `boundary` (inclusive) that can scroll on either axis, else `null`. */
export function scrollableAncestor(from: Element | null, boundary: Element): HTMLElement | null {
  for (let at: Element | null = from; at !== null; at = at.parentElement) {
    if (at instanceof HTMLElement) {
      const style = getComputedStyle(at);
      const y = at.scrollHeight > at.clientHeight && scrolls(style.overflowY);
      const x = at.scrollWidth > at.clientWidth && scrolls(style.overflowX);
      if (x || y) return at;
    }
    if (at === boundary) break;
  }
  return null;
}

export interface MiddleDragScrollHandlers {
  onPointerDown(e: ReactPointerEvent<HTMLElement>): void;
  onPointerMove(e: ReactPointerEvent<HTMLElement>): void;
  onPointerUp(e: ReactPointerEvent<HTMLElement>): void;
  onPointerCancel(e: ReactPointerEvent<HTMLElement>): void;
  onLostPointerCapture(e: ReactPointerEvent<HTMLElement>): void;
  onMouseDown(e: ReactMouseEvent<HTMLElement>): void;
  onAuxClick(e: ReactMouseEvent<HTMLElement>): void;
}

/** The handlers for the element the drag starts in (the preview body); spread them onto it. */
export function useMiddleDragScroll(): MiddleDragScrollHandlers {
  const drag = useRef<{ pointerId: number; target: HTMLElement; x: number; y: number; left: number; top: number } | null>(null);
  /** A middle press this body took: its compatibility mousedown and auxclick are swallowed too. */
  const took = useRef(false);

  const onPointerDown = useCallback((e: ReactPointerEvent<HTMLElement>): void => {
    took.current = false;
    if (e.button !== 1 || e.ctrlKey || e.metaKey || e.defaultPrevented) return;
    const target = scrollableAncestor(e.target as Element, e.currentTarget);
    if (target === null) return;
    e.preventDefault();
    took.current = true;
    drag.current = { pointerId: e.pointerId, target, x: e.clientX, y: e.clientY, left: target.scrollLeft, top: target.scrollTop };
    e.currentTarget.classList.add(PREVIEW_PANNING_CLASS);
    (e.currentTarget as Element & { setPointerCapture?: (id: number) => void }).setPointerCapture?.(e.pointerId);
  }, []);

  const onPointerMove = useCallback((e: ReactPointerEvent<HTMLElement>): void => {
    const d = drag.current;
    if (d === null || d.pointerId !== e.pointerId) return;
    // The content follows the pointer, so the scroll moves against it.
    d.target.scrollLeft = d.left - (e.clientX - d.x);
    d.target.scrollTop = d.top - (e.clientY - d.y);
  }, []);

  const end = useCallback((e: ReactPointerEvent<HTMLElement>): void => {
    if (drag.current?.pointerId !== e.pointerId) return;
    drag.current = null;
    e.currentTarget.classList.remove(PREVIEW_PANNING_CLASS);
  }, []);

  // The compatibility mousedown would start autoscroll, and the auxclick would follow a link under the pointer.
  const swallow = useCallback((e: ReactMouseEvent<HTMLElement>): void => {
    if (e.button === 1 && took.current) e.preventDefault();
  }, []);

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp: end,
    onPointerCancel: end,
    onLostPointerCapture: end,
    onMouseDown: swallow,
    onAuxClick: swallow,
  };
}
