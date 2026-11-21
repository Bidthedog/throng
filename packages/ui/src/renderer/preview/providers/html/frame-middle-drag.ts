/**
 * 074 FR-063a — a plain middle-button drag scrolls an HTML page, as it scrolls every other preview body
 * (`middle-drag-scroll.ts`). The page is a frame, so its pointer never reaches the panel body's handler: the drag is
 * listened for here, in the frame's own (same-origin) document. Ctrl+middle-click (Cmd on macOS) stays the panel's
 * zoom reset (`frame-input.ts`).
 *
 * It scrolls the nearest box under the pointer that can scroll, else the page itself, with the move cursor while the
 * button is held. The walk reads node types, not `instanceof`: the page's nodes belong to the frame's realm, and an
 * update's adopted nodes to the window's.
 */

function scrolls(overflow: string): boolean {
  return overflow === 'auto' || overflow === 'scroll';
}

/** The nearest box from `from` up that can scroll on either axis, else the page's scrolling element. */
function scrollTargetOf(doc: Document, from: EventTarget | null): Element | null {
  const view = doc.defaultView;
  for (let at = from as Element | null; at !== null && at.nodeType === 1; at = at.parentElement) {
    if (at === doc.documentElement || at === doc.body) break;
    const style = view?.getComputedStyle(at);
    const y = at.scrollHeight > at.clientHeight && scrolls(style?.overflowY ?? '');
    const x = at.scrollWidth > at.clientWidth && scrolls(style?.overflowX ?? '');
    if (x || y) return at;
  }
  return doc.scrollingElement ?? doc.documentElement;
}

/** Listen in the frame's current document; the returned function removes the listeners. */
export function listenToFrameMiddleDrag(doc: Document): () => void {
  let drag: { target: Element; x: number; y: number; cursor: string } | null = null;
  const root = doc.documentElement;

  const end = (): void => {
    if (drag === null) return;
    root.style.cursor = drag.cursor;
    drag = null;
  };
  const onDown = (e: MouseEvent): void => {
    if (e.button !== 1 || e.ctrlKey || e.metaKey) return;
    const target = scrollTargetOf(doc, e.target);
    if (target === null) return;
    e.preventDefault(); // no autoscroll, no primary paste
    drag = { target, x: e.clientX, y: e.clientY, cursor: root.style.cursor };
    root.style.cursor = 'move';
  };
  const onMove = (e: MouseEvent): void => {
    if (drag === null) return;
    if ((e.buttons & 4) === 0) {
      end();
      return;
    }
    const left = drag.x - e.clientX;
    const top = drag.y - e.clientY;
    drag.x = e.clientX;
    drag.y = e.clientY;
    if (left !== 0 || top !== 0) drag.target.scrollBy({ left, top });
  };
  const onUp = (e: MouseEvent): void => {
    if (e.button === 1) end();
  };

  doc.addEventListener('mousedown', onDown, true);
  doc.addEventListener('mousemove', onMove, true);
  doc.addEventListener('mouseup', onUp, true);
  return () => {
    end();
    doc.removeEventListener('mousedown', onDown, true);
    doc.removeEventListener('mousemove', onMove, true);
    doc.removeEventListener('mouseup', onUp, true);
  };
}
