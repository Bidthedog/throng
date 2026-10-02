/**
 * The mapping between a preview body's DOM selection and its text model's offsets, shared by the two controllers
 * that need it (049): `preview-occurrences.ts` (the tint of other instances of the selected text) and
 * `preview-selection.ts` (the selection retained while the body is not focused).
 *
 * It is the model preview find searches (`preview-search-model.ts`), so "the same text" and "the selected text"
 * mean what find means, and an offset names the same characters in every one of them.
 */
import { buildPreviewTextModel, locate, type PreviewTextModel, type TextModelNode } from './preview-search-model.js';

/** A selection as offsets into the preview's text model. */
export interface ModelSelection {
  from: number;
  to: number;
}

/** Block-level elements: a selection that crosses between two of them spans lines (FR-015). */
const BLOCK_TAGS = new Set([
  'ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'DD', 'DETAILS', 'DIV', 'DL', 'DT', 'FIELDSET', 'FIGCAPTION', 'FIGURE',
  'FOOTER', 'FORM', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HEADER', 'HR', 'LI', 'MAIN', 'NAV', 'OL', 'P', 'PRE',
  'SECTION', 'SUMMARY', 'TABLE', 'TBODY', 'TD', 'TFOOT', 'TH', 'THEAD', 'TR', 'UL',
]);

export function blockOf(node: Node, host: Node): Node {
  for (let n: Node | null = node; n && n !== host; n = n.parentNode) {
    if (n.nodeType === 1 && BLOCK_TAGS.has((n as Element).tagName)) return n;
  }
  return host;
}

export interface CachedModel {
  model: PreviewTextModel;
  byNode: Map<Node, { from: number; to: number }>;
}

export function cacheModel(host: HTMLElement): CachedModel {
  const model = buildPreviewTextModel(host as unknown as TextModelNode);
  const byNode = new Map<Node, { from: number; to: number }>();
  for (const e of model.entries) byNode.set(e.node as unknown as Node, { from: e.from, to: e.to });
  return { model, byNode };
}

/**
 * One text model per drawn body, built on first use and dropped when the body redraws (it replaces its DOM).
 * Shared by the controllers so a draw is walked once, not once per controller.
 */
export interface ModelCache {
  /** The model of `host()` as drawn now, or `null` when there is no body. */
  get(): CachedModel | null;
  /** The body redrew: the next `get()` rebuilds. */
  invalidate(): void;
}

export function createModelCache(host: () => HTMLElement | null): ModelCache {
  let cached: CachedModel | null = null;
  return {
    get(): CachedModel | null {
      if (cached) return cached;
      const h = host();
      if (h) cached = cacheModel(h);
      return cached;
    },
    invalidate(): void {
      cached = null;
    },
  };
}

/**
 * The model offset of a DOM boundary point, or `null` when it names no searchable text. A text node answers
 * directly; an element boundary (a select-all, a triple click) resolves to the first searchable text at or after
 * the point.
 */
export function offsetOfPoint(cache: CachedModel, node: Node, offset: number): number | null {
  const direct = cache.byNode.get(node);
  if (direct) return direct.from + Math.min(offset, direct.to - direct.from);
  if (node.nodeType === 3) return null; // a text node the model excludes (aria-hidden, fold chrome)
  const point = node.ownerDocument!.createRange();
  point.setStart(node, offset);
  point.collapse(true);
  for (const e of cache.model.entries) {
    const textNode = e.node as unknown as Node;
    if (point.comparePoint(textNode, 0) >= 0) return e.from;
  }
  return cache.model.text.length;
}

/** The DOM selection while it lies inside `host` — cheap, and needs no text model. `sameBlock` also requires one block. */
export function liveRange(host: HTMLElement, sameBlock: boolean): Range | null {
  const sel = host.ownerDocument.defaultView?.getSelection();
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  if (!host.contains(range.startContainer) || !host.contains(range.endContainer)) return null;
  if (sameBlock && blockOf(range.startContainer, host) !== blockOf(range.endContainer, host)) return null;
  return range;
}

/** `range` as model offsets, or `null` when an end names no searchable text. */
export function readSelection(range: Range, cache: CachedModel): ModelSelection | null {
  const from = offsetOfPoint(cache, range.startContainer, range.startOffset);
  const to = offsetOfPoint(cache, range.endContainer, range.endOffset);
  return from === null || to === null || to <= from ? null : { from, to };
}

/** A `Range` over model offsets `[from, to)`, or `null` when either end falls outside the model. */
export function rangeOver(host: HTMLElement, model: PreviewTextModel, from: number, to: number): Range | null {
  const start = locate(model, from);
  const end = locate(model, to);
  if (!start || !end) return null;
  const range = host.ownerDocument.createRange();
  range.setStart(start.node as unknown as Node, start.offset);
  range.setEnd(end.node as unknown as Node, end.offset);
  return range;
}
