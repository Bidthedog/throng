import { useEffect, useLayoutEffect, useRef, useState, type ReactElement } from 'react';
import { clampToViewport } from '../common/clamp-to-viewport.js';
import { hideLinkHint, useLinkHint } from './link-hint-store.js';
import './link-hint.css';

/**
 * 045 FR-165, FR-166 (round four) — the ONE plain-click link hint, mounted once in
 * `composition-root.tsx` (and its sub-workspace counterpart), identical in editors, terminals and the
 * Markdown preview (FR-166; S6 supersedes 044 FR-094's own plain-click remedy as far as the plain
 * click goes).
 *
 * ══ POSITION (FR-165b, FR-165c) ══
 *
 * Anchored at the BOTTOM-RIGHT of the link's own bounding rect (the last row's, for a link spanning
 * several — the caller supplies that rect, this component does not know about rows), then clamped
 * fully on screen by the SAME positioner the context menu, the colour picker and the tab popover
 * share (`clampToViewport`, US11/FR-036) — generalised there already, so this is a caller of it
 * rather than a second implementation. Measured in a layout effect and held `visibility: hidden`
 * until placed, so it never paints at the wrong spot first (the tab popover's own pattern).
 *
 * ══ CLICK-THROUGH, NEVER FOCUSABLE (FR-165a) ══
 *
 * No `tabIndex` — a plain `<div>` is not a tab stop — and `pointer-events: none` in `link-hint.css`,
 * so the click that raised it keeps its ordinary meaning (placing the caret, starting a selection, or
 * reaching a mouse-reporting program) and input over it reaches the panel beneath.
 *
 * ══ WHAT HIDES IT (FR-165d) ══
 *
 * `LINK_HINT_MS` alone, through the store's own timer — but this component owns the DOM-level
 * triggers the store cannot know about by itself: a Ctrl keydown (which, because holding Ctrl during
 * a click means Ctrl went down FIRST, also covers "a link Ctrl+click" — there is no click without a
 * prior keydown to catch), window blur, and a scroll the USER makes.
 *
 * "User" is the whole of FR-165d's note, and it names THREE scrolls: wheel, scrollbar, a scrolling
 * key. The first and the third are their own events. The second is not — a scrollbar drag fires only
 * `scroll`, which is also what a terminal's own output fires, and hiding on every `scroll` would
 * take the hint away while the user has done nothing. What separates them is the POINTER: a drag
 * scrolls with a button held, output scrolls with nothing pressed. So `scroll` hides the hint only
 * while a pointer is down (review round four, terminal I4 / editor L2).
 *
 * ══ POSITION IS RE-MEASURED ON A RESIZE (FR-165c) ══
 *
 * The clamp is against the viewport, so a viewport that changes size invalidates it: dragging the
 * window edge used to leave the hint at a page position computed for the old one, possibly off
 * screen. The layout effect re-runs on a `resize` for that reason, and for no other.
 */
export function LinkHint(): ReactElement | null {
  const hint = useLinkHint();
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  /** Bumped by a `resize`, purely to re-run the measurement below against the new viewport. */
  const [viewportGeneration, setViewportGeneration] = useState(0);

  useEffect(() => {
    const onResize = (): void => setViewportGeneration((n) => n + 1);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useLayoutEffect(() => {
    if (hint === null) {
      setPos(null);
      return;
    }
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos(
      clampToViewport(
        hint.anchor,
        { width: r.width, height: r.height },
        { width: window.innerWidth, height: window.innerHeight },
      ),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-measure on a new hint's own identity, or a new viewport
  }, [
    hint?.text,
    hint?.anchor.left,
    hint?.anchor.top,
    hint?.anchor.right,
    hint?.anchor.bottom,
    viewportGeneration,
  ]);

  useEffect(() => {
    const SCROLL_KEYS = new Set(['PageUp', 'PageDown', 'Home', 'End']);
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Control' || e.key === 'Meta' || SCROLL_KEYS.has(e.key)) hideLinkHint();
    };
    const onWheel = (): void => hideLinkHint();
    // FR-165d's scrollbar case. `pointerDown` is the whole of what tells a drag from output.
    let pointerDown = false;
    const onPointerDown = (): void => {
      pointerDown = true;
    };
    const onPointerUp = (): void => {
      pointerDown = false;
    };
    const onScroll = (): void => {
      if (pointerDown) hideLinkHint();
    };
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('wheel', onWheel, { capture: true, passive: true });
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('pointerup', onPointerUp, true);
    window.addEventListener('pointercancel', onPointerUp, true);
    window.addEventListener('scroll', onScroll, { capture: true, passive: true });
    window.addEventListener('blur', hideLinkHint);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('wheel', onWheel, true);
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('pointerup', onPointerUp, true);
      window.removeEventListener('pointercancel', onPointerUp, true);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('blur', hideLinkHint);
    };
  }, []);

  if (hint === null) return null;

  return (
    <div
      ref={ref}
      className="link-hint"
      data-testid="link-hint"
      style={{
        left: pos?.left ?? hint.anchor.left,
        top: pos?.top ?? hint.anchor.bottom,
        visibility: pos ? 'visible' : 'hidden',
      }}
    >
      {hint.text}
    </div>
  );
}
