/**
 * Find in a preview (047, US1, research.md R1) — the third `SearchController`, beside the editor's
 * and the terminal's. Read-only like the terminal's (no replace: `find-bar.tsx` already gates replace
 * on `panelKind === 'editor'`, so a `'preview'` kind needs no new flag), but over a rendered DOM
 * rather than a CodeMirror document or a terminal's scrollback.
 *
 * ══ THE TEXT MODEL IS REBUILT ON EVERY QUERY, NEVER CACHED ══
 *
 * The body re-renders under this controller's feet on every keystroke elsewhere in the file, and
 * `preview-search-model.ts` has no way to be told "the DOM changed" — so every call that needs fresh
 * matches (`setQuery`, `refresh`) rebuilds the model from the live body first. This is cheap: a walk
 * over already-rendered nodes, not a reparse.
 *
 * ══ THE HIGHLIGHT PAINTER SEAM ══
 *
 * The real painter uses the CSS Custom Highlight API (`CSS.highlights`), which paints without
 * touching the sanitised DOM — no `<mark>` wrapper to disturb `data-source-line` measurement or copy
 * (R1). jsdom has neither the API nor its types, so this file never references the global `Highlight`
 * constructor or `CSS.highlights` by NAME — only through {@link HighlightPainter}, which a component
 * test satisfies with a recording double, and {@link createCssHighlightPainter}, which feature-detects
 * the real thing at runtime instead of asserting it exists at compile time.
 */
import { countOf, indexFrom, NO_MATCHES, seedFrom, stepIndex, type MatchModes, type Match, type SearchCount } from '@throng/core';
import type { BaseSearchController } from '../search/search-controller.js';
import { setPanelRanges } from './highlight-registry.js';
import { buildPreviewTextModel, findPreviewMatches, locate, type TextModelNode } from './preview-search-model.js';

/** The two named highlights this feature paints (R1); colours come from theme tokens in `preview.css`. */
export const PREVIEW_MATCH_HIGHLIGHT = 'throng-preview-match';
export const PREVIEW_CURRENT_MATCH_HIGHLIGHT = 'throng-preview-match-current';

/**
 * The seam over the CSS Custom Highlight API. `current: -1` means "no current match" — paint every
 * match but clear the current-match highlight.
 */
export interface HighlightPainter {
  paint(ranges: Range[], current: number): void;
  clear(): void;
}

/** The production painter (R1), per panel (049 R2) — paints through the shared registry. A runtime with no Custom Highlight API silently paints nothing. */
export function createCssHighlightPainter(panelId: string): HighlightPainter {
  return {
    paint(ranges, current) {
      setPanelRanges(PREVIEW_MATCH_HIGHLIGHT, panelId, ranges);
      const cur = ranges[current];
      setPanelRanges(PREVIEW_CURRENT_MATCH_HIGHLIGHT, panelId, cur ? [cur] : []);
    },
    clear() {
      setPanelRanges(PREVIEW_MATCH_HIGHLIGHT, panelId, []);
      setPanelRanges(PREVIEW_CURRENT_MATCH_HIGHLIGHT, panelId, []);
    },
  };
}

/**
 * One frame of the match-frame layer (047 FR-074, R16): a client rect of a match range, in VIEWPORT
 * coordinates, and whether it belongs to the current match (drawn in `searchMatchCurrentBorder`, the
 * others in `searchMatchBorder`).
 */
export interface MatchFrame {
  left: number;
  top: number;
  width: number;
  height: number;
  current: boolean;
}

/**
 * The seam over the frame layer. `::highlight()` accepts no `outline` (R16), so the outline every match
 * carries is drawn as frames in a layer of its own — never in the sanitised content, copy, or find's text model.
 * The controller decides WHICH frames; the painter decides how they reach the screen.
 */
export interface FramePainter {
  paint(frames: MatchFrame[]): void;
  clear(): void;
}

/**
 * The production frame painter: one 1px frame per {@link MatchFrame}, replacing the last paint's, in `layer()` —
 * an element OUTSIDE the body the panel owns (`preview-panel.tsx`), positioned relative to itself. Colours come
 * from theme tokens in `match-frames.css`; nothing here names one.
 */
export function createDomFramePainter(layer: () => HTMLElement | null): FramePainter {
  return {
    paint(frames) {
      const el = layer();
      if (!el) return;
      // The layer sits inside the scrolling body (049 FR-029): its origin moves with the content, as do the
      // frames placed against it, and the body's own overflow clips what is under the header and bars.
      const origin = el.getBoundingClientRect();
      const doc = el.ownerDocument;
      const drawn = frames.map((f) => {
        const frame = doc.createElement('div');
        frame.className = f.current ? 'preview-match-frame preview-match-frame--current' : 'preview-match-frame';
        frame.style.left = `${f.left - origin.left}px`;
        frame.style.top = `${f.top - origin.top}px`;
        frame.style.width = `${f.width}px`;
        frame.style.height = `${f.height}px`;
        return frame;
      });
      el.replaceChildren(...drawn);
    },
    clear() {
      const el = layer();
      if (!el) return;
      el.replaceChildren();
    },
  };
}

/**
 * The preview's own `SearchController` — `search/search-controller.ts`'s `PreviewSearchController`
 * (already in the shared `SearchController` union) plus one extra member this file alone calls.
 * Find-only by TYPE — there are no replace methods to gate.
 */
export interface PreviewSearchController extends BaseSearchController {
  readonly panelKind: 'preview';
  /**
   * FR-005 — re-run the ACTIVE query against the body as it stands now, keeping the current match
   * nearest to its old text offset rather than snapping back to the first match. A no-op while no
   * query is active. The chrome calls this from the body's `onDrawn` (T025), so a re-render (an edit
   * in the paired editor, a live update) does not lose the reader's place in their search.
   */
  refresh(): SearchCount;
  /**
   * 047 FR-074 (R16) — the frames must be redrawn from the geometry as it is NOW: the body scrolled, the
   * panel was resized, or a redraw moved the matches. Coalesced to one `requestAnimationFrame`, so any number
   * of triggers in a frame cost one repaint; a no-op while no query is active.
   */
  repaintFrames(): void;
  /**
   * 049 FR-029 — the body scrolled. The frames scroll with their text and need no work, so this does nothing
   * (reads two numbers) unless the viewport has left the band the frames were drawn for, and then asks for one repaint.
   */
  scrolled(): void;
  /**
   * 049 R4 — bring the CURRENT match into view, re-locating it from its text offset against the body as it is
   * now. The panel finishes a reveal with this: expanding a collapsed section redraws the body, and the node the
   * reveal started from may be gone. A no-op with no current match.
   */
  scrollToCurrent(): void;
  /**
   * 049 FR-013 — the matches currently painted, as text-model offsets in document order. The occurrence tint reads
   * this to leave a range that is a find match to find's own highlight.
   */
  matchRanges(): readonly Match[];
}

export interface PreviewSearchDeps {
  /** The body host to search — read fresh on every call, so a re-render is always picked up. */
  host(): HTMLElement | null;
  painter: HighlightPainter;
  /** 047 FR-074 — where each match's outline is drawn. Omitted: the matches carry their fill alone. */
  frames?: FramePainter;
  /** Test seams for the one repaint frame; default `requestAnimationFrame` / `cancelAnimationFrame`. */
  requestFrame?: (cb: () => void) => number;
  cancelFrame?: (handle: number) => void;
  /**
   * FR-040 (T050) — reveal the section containing `node` (expand its collapsed ancestors) BEFORE it is
   * scrolled to. Supplied by the panel. Revealing a COLLAPSED section changes the document's fold
   * state, which only reaches the DOM on the next render — so this returns `true` when it started a
   * reveal, telling the caller to leave the scroll to the panel (which finishes it once the section's
   * blocks are no longer `hidden`) rather than calling `scrollIntoView` on an element still collapsed.
   * A falsy return (including the default, absent, undefined dep) means nothing needed revealing, and
   * this function should scroll immediately — correct for a document with no folds at all.
   */
  revealBeforeScroll?: (node: Node) => boolean | void;
  /** Called after every paint or clear of the matches — the occurrence tint re-evaluates against the new set (049 FR-013). */
  onPaint?: () => void;
}

/** Viewports of margin, each side, that are framed ahead of a scroll (049 FR-029). */
const BAND = 3;

const EMPTY_MODEL ={ text: '', entries: [] } as const;

/** Build a `PreviewSearchController` over `deps.host()`'s current content. */
export function createPreviewSearchController(deps: PreviewSearchDeps): PreviewSearchController {
  const { host, painter } = deps;
  const revealBeforeScroll = deps.revealBeforeScroll ?? ((): void => {});

  let term = '';
  let modes: MatchModes = { caseSensitive: false, wholeWord: false };
  let model: ReturnType<typeof buildPreviewTextModel> = EMPTY_MODEL;
  let matches: Match[] = [];
  let current = -1;
  /** The text offset of the current match the last time there was one — see `restore` (049 R1). */
  let lastFrom: number | null = null;

  const runQuery = (): void => {
    const h = host();
    model = h ? buildPreviewTextModel(h as unknown as TextModelNode) : EMPTY_MODEL;
    matches = findPreviewMatches(model, term, modes);
  };

  const rangesFor = (ms: Match[]): Range[] => {
    const h = host();
    if (!h) return [];
    const doc = h.ownerDocument;
    const out: Range[] = [];
    for (const m of ms) {
      const start = locate(model, m.from);
      const end = locate(model, m.to);
      if (!start || !end) continue;
      const range = doc.createRange();
      range.setStart(start.node as unknown as Node, start.offset);
      range.setEnd(end.node as unknown as Node, end.offset);
      out.push(range);
    }
    return out;
  };

  const framePainter = deps.frames;
  const requestFrame = deps.requestFrame ?? ((cb: () => void): number => requestAnimationFrame(cb));
  const cancelFrame = deps.cancelFrame ?? ((handle: number): void => cancelAnimationFrame(handle));
  // The ranges of the last paint, so a scroll or resize re-reads their GEOMETRY without re-walking the body.
  let ranges: Range[] = [];
  let frameHandle: number | null = null;
  /** The scroll-content region the last paint framed (049 FR-029); null before the first paint. */
  let band: { left: number; right: number; top: number; bottom: number } | null = null;

  /**
   * FR-074 — a frame per client rect of each match range still inside the body's viewport. A range with no
   * client rects (its section collapsed, `display: none`) has none; a runtime without `Range.getClientRects`
   * (jsdom) draws none.
   */
  const paintFrames = (): void => {
    if (!framePainter) return;
    const h = host();
    if (!h) return framePainter.clear();
    const view = h.getBoundingClientRect();
    // 049 FR-029 — frames are drawn in the scrolling content, so they move with their text and a scroll costs no
    // script. A match scrolled into view must already have one: a BAND of three viewports each way is framed,
    // and `scrolled()` rebuilds it only when the viewport leaves it.
    const bandX = view.width * BAND;
    const bandY = view.height * BAND;
    band = {
      left: h.scrollLeft - bandX,
      right: h.scrollLeft + h.clientWidth + bandX,
      top: h.scrollTop - bandY,
      bottom: h.scrollTop + h.clientHeight + bandY,
    };
    const out: MatchFrame[] = [];
    ranges.forEach((range, i) => {
      if (typeof range.getClientRects !== 'function') return;
      for (const r of Array.from(range.getClientRects())) {
        if (r.right < view.left - bandX || r.left > view.right + bandX || r.bottom < view.top - bandY || r.top > view.bottom + bandY) continue;
        out.push({ left: r.left, top: r.top, width: r.width, height: r.height, current: i === current });
      }
    });
    framePainter.paint(out);
  };

  const paint = (): void => {
    const from = matches[current]?.from;
    if (from !== undefined) lastFrom = from;
    ranges = rangesFor(matches);
    painter.paint(ranges, current);
    paintFrames();
    deps.onPaint?.();
  };

  const cancelPendingFrame = (): void => {
    if (frameHandle === null) return;
    cancelFrame(frameHandle);
    frameHandle = null;
  };

  /**
   * FR-040 (reveal), then bring the current match into view — a no-op with no current match. Skips
   * ITS OWN `scrollIntoView` when `revealBeforeScroll` reports it started a reveal (T050): the match's
   * element is still `hidden` until the fold state reaches the DOM, and the panel finishes the scroll
   * once it does.
   */
  const revealAndScroll = (): void => {
    const m = matches[current];
    if (!m) return;
    const start = locate(model, m.from);
    if (!start) return;
    const node = start.node as unknown as Node;
    if (revealBeforeScroll(node)) return;
    const el = node.nodeType === 1 ? (node as unknown as Element) : node.parentElement;
    el?.scrollIntoView({ block: 'center' });
  };

  return {
    panelKind: 'preview',

    seedFromSelection(): string {
      const h = host();
      const sel = h?.ownerDocument.defaultView?.getSelection();
      if (!h || !sel || sel.isCollapsed || sel.rangeCount === 0) return '';
      const range = sel.getRangeAt(0);
      if (!h.contains(range.commonAncestorContainer)) return '';
      return seedFrom(sel.toString());
    },

    setQuery(nextTerm: string, nextModes: MatchModes): SearchCount {
      term = nextTerm;
      modes = nextModes;
      runQuery();
      current = matches.length === 0 ? -1 : 0;
      paint();
      revealAndScroll();
      return countOf(matches, current);
    },

    findNext(): SearchCount {
      if (matches.length === 0) return countOf(matches, current);
      current = stepIndex(current, matches.length, 1);
      paint();
      revealAndScroll();
      return countOf(matches, current);
    },

    findPrevious(): SearchCount {
      if (matches.length === 0) return countOf(matches, current);
      current = stepIndex(current, matches.length, -1);
      paint();
      revealAndScroll();
      return countOf(matches, current);
    },

    refresh(): SearchCount {
      if (term.length === 0) return NO_MATCHES;
      // Anchor on the OLD current match's text offset (R1) — never on its index, which a document
      // change can make point at an unrelated match once the count shifts.
      const anchor = matches[current]?.from ?? lastFrom ?? 0;
      runQuery();
      current = matches.length === 0 ? -1 : Math.min(indexFrom(matches, anchor), matches.length - 1);
      paint();
      return countOf(matches, current);
    },

    /**
     * 049 R1 — re-establish a find session on a REBUILT body. The body may not have drawn yet (it arrives a
     * moment after the panel mounts), in which case the query finds nothing now and `refresh()` — run from
     * `onDrawn` — re-lands on `anchor` once it has. Never scrolls or reveals: the body's restored scroll
     * position stands.
     */
    restore(nextTerm: string, nextModes: MatchModes, anchor: number | null): SearchCount {
      term = nextTerm;
      modes = nextModes;
      lastFrom = anchor;
      runQuery();
      current = matches.length === 0 ? -1 : indexFrom(matches, anchor ?? 0);
      paint();
      return countOf(matches, current);
    },

    currentFrom(): number | null {
      return matches[current]?.from ?? null;
    },

    matchRanges(): readonly Match[] {
      return matches;
    },

    scrollToCurrent(): void {
      const m = matches[current];
      const h = host();
      if (!m || !h) return;
      // The body may have been redrawn since the model was built; the offsets still describe the same text.
      model = buildPreviewTextModel(h as unknown as TextModelNode);
      const start = locate(model, m.from);
      if (!start) return;
      const node = start.node as unknown as Node;
      const el = node.nodeType === 1 ? (node as unknown as Element) : node.parentElement;
      el?.scrollIntoView({ block: 'center' });
    },

    scrolled(): void {
      const h = host();
      if (!h || band === null) return;
      const inside =
        h.scrollTop >= band.top &&
        h.scrollTop + h.clientHeight <= band.bottom &&
        h.scrollLeft >= band.left &&
        h.scrollLeft + h.clientWidth <= band.right;
      if (!inside) this.repaintFrames();
    },

    repaintFrames(): void {
      if (!framePainter || ranges.length === 0 || frameHandle !== null) return;
      frameHandle = requestFrame(() => {
        frameHandle = null;
        paintFrames();
      });
    },

    close(opts?: { refocus?: boolean }): void {
      term = '';
      matches = [];
      current = -1;
      lastFrom = null;
      model = EMPTY_MODEL;
      ranges = [];
      cancelPendingFrame();
      painter.clear();
      framePainter?.clear();
      deps.onPaint?.();
      // Do not pull focus back into a body the reader has already navigated away from.
      if (opts?.refocus !== false) host()?.focus({ preventScroll: true });
    },
  };
}
