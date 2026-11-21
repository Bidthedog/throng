/**
 * 074 FR-071b (research R6b) — an HTML Preview's page replaced IN the frame that shows it.
 *
 * The frame shares the renderer's origin (FR-074a), so its document can be written from here. The first page is the
 * frame's `srcdoc`; every later version of the page is drawn into the SAME document by {@link updateFrameInPlace}:
 *
 * 1. the sanitised page is parsed (`DOMParser` — an inert document: nothing in it loads or runs);
 * 2. the head is reconciled: a node whose serialisation is unchanged is the same node, left where it is, so an
 *    unchanged stylesheet is not fetched or applied again; the rest are replaced;
 * 3. the body's children are replaced in one call and the `<html>` and `<body>` attributes copied across;
 * 4. the reader's scroll, read before, is written back after, clamped to the new page's extent.
 *
 * All four run in one task, so no frame is painted between the old page and the new one: never blank, white or
 * flashing. Nothing here depends on the page — it runs no script of its own (FR-074, FR-088).
 */

/** Where a reader is in the page: the frame document's scroll on both axes, in CSS pixels. */
export interface FrameScroll {
  x: number;
  y: number;
}

/** The element that scrolls the frame's viewport (`<html>` in a standards-mode page, `<body>` in quirks mode). */
function scrollerOf(doc: Document): Element | null {
  return doc.scrollingElement ?? doc.documentElement;
}

/** The frame document's scroll now; the top-left corner when nothing scrolls. */
export function readFrameScroll(doc: Document): FrameScroll {
  const scroller = scrollerOf(doc);
  return scroller === null ? { x: 0, y: 0 } : { x: scroller.scrollLeft, y: scroller.scrollTop };
}

/** Scroll the frame document to `place`, clamped to the page's current extent on each axis. */
export function writeFrameScroll(doc: Document, place: FrameScroll): void {
  const scroller = scrollerOf(doc);
  if (scroller === null) return;
  const maxX = Math.max(0, scroller.scrollWidth - scroller.clientWidth);
  const maxY = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
  scroller.scrollLeft = Math.min(Math.max(0, place.x), maxX);
  scroller.scrollTop = Math.min(Math.max(0, place.y), maxY);
}

/** A head node's identity for the reconcile: its markup, or its kind and text for a text or comment node. */
function serialisationOf(node: Node): string {
  return node instanceof Element ? node.outerHTML : `#${node.nodeType}:${node.textContent ?? ''}`;
}

/** Make `target`'s attributes exactly `source`'s. */
function copyAttributes(source: Element, target: Element): void {
  for (const name of target.getAttributeNames()) if (!source.hasAttribute(name)) target.removeAttribute(name);
  for (const name of source.getAttributeNames()) {
    const value = source.getAttribute(name) ?? '';
    if (target.getAttribute(name) !== value) target.setAttribute(name, value);
  }
}

/**
 * Reconcile `head` with `next`'s children: each unchanged node is kept (matched by serialisation, first unused match
 * in order), each new one adopted, each left over removed. A kept node is moved only when its position changed.
 */
function reconcileHead(doc: Document, head: HTMLHeadElement, next: HTMLHeadElement): void {
  const available = new Map<string, Node[]>();
  for (const node of [...head.childNodes]) {
    const key = serialisationOf(node);
    const list = available.get(key);
    if (list === undefined) available.set(key, [node]);
    else list.push(node);
  }
  const wanted: Node[] = [...next.childNodes].map((node) => available.get(serialisationOf(node))?.shift() ?? doc.adoptNode(node));
  for (const unused of available.values()) for (const node of unused) node.parentNode?.removeChild(node);
  wanted.forEach((node, i) => {
    const at = head.childNodes[i] ?? null;
    if (at !== node) head.insertBefore(node, at);
  });
}

/**
 * Draw `html` (a sanitised page) into `doc` in place, keeping the reader's scroll unless `place` names another one
 * (a history step or a navigation: the place that page is shown at).
 */
export function updateFrameInPlace(doc: Document, html: string, place?: FrameScroll): void {
  const scroll = place ?? readFrameScroll(doc);
  const next = new DOMParser().parseFromString(html, 'text/html');
  const root = doc.documentElement;
  copyAttributes(next.documentElement, root);

  let head = doc.head;
  if (head === null) head = root.insertBefore(doc.createElement('head'), root.firstChild);
  reconcileHead(doc, head, next.head);

  let body = doc.body;
  if (body === null) body = root.appendChild(doc.createElement('body'));
  copyAttributes(next.body, body);
  body.replaceChildren(...[...next.body.childNodes].map((node) => doc.adoptNode(node)));

  writeFrameScroll(doc, scroll);
}
