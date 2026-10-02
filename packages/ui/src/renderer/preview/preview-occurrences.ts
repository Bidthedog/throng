/**
 * Other instances of the selected text, softly tinted in a PREVIEW (049 US4, #324; FR-013 – FR-020, research R8/R9).
 *
 * A preview's body is sanitised DOM that nothing may wrap or mutate (find, copy and scroll anchoring all read
 * it), so occurrences are painted the way find's matches are: as `Range`s under a CSS Custom Highlight name,
 * through the per-panel registry (`highlight-registry.ts`). Which ranges count is core's rule — `occurrenceQuery`
 * and `occurrenceMatches`, the same two functions the editor uses over its source — applied here to the rendered
 * text model preview find searches (FR-014a), so "what is the same text" never differs between the two panels.
 *
 * ══ WHERE THE WORK HAPPENS ══
 *
 * `selectionchange` fires on every caret move and every drag step, so the handler does nothing but schedule one
 * animation frame (Principle XII). The frame maps the DOM selection to text-model offsets, matches, builds the
 * ranges and paints. The model is cached between draws and dropped by {@link PreviewOccurrences.invalidate},
 * which the panel calls from the body's `onDrawn`, because the body replaces its DOM when it redraws.
 *
 * ══ PRECEDENCE AND STRENGTH ══
 *
 * A range that is a find match is removed from the occurrences (`withoutSearchMatches`, FR-013) — find's own
 * highlight is the one painted. The name is `throng-preview-occurrence` while the body has focus and
 * `throng-preview-occurrence-inactive` while it does not (FR-018a), and only the panel's OWN selection counts
 * (FR-014b): a selection elsewhere in the document is outside this host, so this panel paints nothing for it.
 */
import { occurrenceMatches, occurrenceQuery, withoutSearchMatches, type Match } from '@throng/core';
import {
  createModelCache,
  liveRange,
  rangeOver,
  readSelection,
  type ModelCache,
  type ModelSelection,
} from './preview-selection-model.js';
import { setPanelRanges } from './highlight-registry.js';

/** The named highlights this feature paints; colours come from theme tokens in `find-bar.css`. */
export const PREVIEW_OCCURRENCE_HIGHLIGHT = 'throng-preview-occurrence';
export const PREVIEW_OCCURRENCE_INACTIVE_HIGHLIGHT = 'throng-preview-occurrence-inactive';

export type { ModelSelection };

export interface PreviewOccurrencesDeps {
  /** The body host to read — fresh on every call, so a redraw is always picked up. */
  host(): HTMLElement | null;
  panelId: string;
  /** `editor.highlightOccurrences`, read at frame time so a toggle needs no remount (FR-019). */
  enabled(): boolean;
  /** The find matches currently painted, in model offsets, in document order (FR-013). */
  searchMatches(): readonly Match[];
  /** Whether the body has focus right now (FR-018a). */
  isFocused(): boolean;
  /**
   * A selection this panel keeps while it has none of its own in the DOM — the retained selection of a body
   * that lost focus (US5). Its occurrences follow it, at inactive strength.
   */
  retained?(): ModelSelection | null;
  /** The text model of the drawn body, when another controller shares it; otherwise this builds its own. */
  modelCache?: ModelCache;
  /** Test seams for the one frame; default `requestAnimationFrame` / `cancelAnimationFrame`. */
  requestFrame?: (cb: () => void) => number;
  cancelFrame?: (handle: number) => void;
  /** Test seams for the idle model build; default `requestIdleCallback`, with a `setTimeout` fallback. */
  requestIdle?: (cb: () => void) => number;
  cancelIdle?: (handle: number) => void;
}

export interface PreviewOccurrences {
  /** Re-evaluate on the next frame (a selection, focus or setting change, or new find matches). */
  schedule(): void;
  /** The body redrew: drop the cached text model and re-evaluate. */
  invalidate(): void;
  /** Remove the listeners and every range this panel painted. */
  dispose(): void;
}

export function createPreviewOccurrences(deps: PreviewOccurrencesDeps): PreviewOccurrences {
  const requestIdle =
    deps.requestIdle ??
    ((cb: () => void): number =>
      typeof requestIdleCallback === 'function' ? requestIdleCallback(() => cb()) : (setTimeout(cb, 50) as unknown as number));
  const cancelIdle =
    deps.cancelIdle ??
    ((h: number): void => (typeof cancelIdleCallback === 'function' ? cancelIdleCallback(h) : clearTimeout(h)));
  const requestFrame = deps.requestFrame ?? ((cb: () => void): number => requestAnimationFrame(cb));
  const cancelFrame = deps.cancelFrame ?? ((h: number): void => cancelAnimationFrame(h));
  const models = deps.modelCache ?? createModelCache(deps.host);
  let handle: number | null = null;
  let idleHandle: number | null = null;
  let disposed = false;
  /** What is painted, so a frame that finds nothing to paint clears only if something is there. */
  let paintedName: string | null = null;

  const clear = (): void => {
    if (paintedName === null) return;
    setPanelRanges(PREVIEW_OCCURRENCE_HIGHLIGHT, deps.panelId, []);
    setPanelRanges(PREVIEW_OCCURRENCE_INACTIVE_HIGHLIGHT, deps.panelId, []);
    paintedName = null;
  };

  const frame = (): void => {
    handle = null;
    if (disposed) return;
    const host = deps.host();
    if (!host || !deps.enabled()) return clear();
    // Nothing selected here and nothing retained: nothing to evaluate, and no model to build for it.
    const range = liveRange(host, true);
    if (!range && !deps.retained?.()) return clear();
    // Built by the idle task after the last draw; built here only when a selection beat it (correctness first).
    const cache = models.get();
    if (!cache) return clear();

    // The DOM selection while this body holds one; otherwise whatever it retained (US5).
    const live = range ? readSelection(range, cache) : null;
    const selection = live ?? deps.retained?.() ?? null;
    if (!selection) return clear();
    // A retained selection can span blocks (select-all); a selection that spans lines has no occurrences (FR-015).
    if (cache.model.text.slice(selection.from, selection.to).includes('\n')) return clear();
    // `occurrenceQuery` wants the text around the selection — its line — so it can read the characters either side.
    const { text } = cache.model;
    const lineStart = text.lastIndexOf('\n', selection.from - 1) + 1;
    const lineEnd = text.indexOf('\n', selection.to);
    const line = text.slice(lineStart, lineEnd === -1 ? text.length : lineEnd);
    const query = occurrenceQuery(line, selection.from - lineStart, selection.to - lineStart);
    if (!query) return clear();

    const found = occurrenceMatches(text, query, selection);
    const shown = withoutSearchMatches(found, deps.searchMatches());
    const ranges: Range[] = [];
    for (const m of shown) {
      const r = rangeOver(host, cache.model, m.from, m.to);
      if (r) ranges.push(r);
    }
    if (ranges.length === 0) return clear();

    // Focused panel with a selection of its own: full strength. Anything else — focus elsewhere, or a retained
    // selection — is the weaker inactive tint (FR-018a).
    const active = live !== null && deps.isFocused();
    const name = active ? PREVIEW_OCCURRENCE_HIGHLIGHT : PREVIEW_OCCURRENCE_INACTIVE_HIGHLIGHT;
    const other = active ? PREVIEW_OCCURRENCE_INACTIVE_HIGHLIGHT : PREVIEW_OCCURRENCE_HIGHLIGHT;
    setPanelRanges(other, deps.panelId, []);
    setPanelRanges(name, deps.panelId, ranges);
    paintedName = name;
  };

  /** Build the text model while the browser is idle after a draw, so the first selection finds it ready (SC-005). */
  const buildWhenIdle = (): void => {
    idleHandle = null;
    if (disposed) return;
    models.get();
  };

  const schedule = (): void => {
    if (disposed || handle !== null) return;
    handle = requestFrame(frame);
  };

  // Document-level, so the listeners need no host to exist yet and survive the body being replaced. Each does
  // nothing but schedule (Principle XII).
  const onChange = (): void => schedule();
  const doc = deps.host()?.ownerDocument ?? document;
  doc.addEventListener('selectionchange', onChange);
  doc.addEventListener('focusin', onChange);
  doc.addEventListener('focusout', onChange);

  return {
    schedule,
    invalidate(): void {
      models.invalidate();
      // Superseded by the next draw: only the LAST draw's model is worth building.
      if (idleHandle !== null) cancelIdle(idleHandle);
      idleHandle = deps.enabled() ? requestIdle(buildWhenIdle) : null;
      schedule();
    },
    dispose(): void {
      disposed = true;
      if (handle !== null) cancelFrame(handle);
      handle = null;
      if (idleHandle !== null) cancelIdle(idleHandle);
      idleHandle = null;
      doc.removeEventListener('selectionchange', onChange);
      doc.removeEventListener('focusin', onChange);
      doc.removeEventListener('focusout', onChange);
      paintedName = PREVIEW_OCCURRENCE_HIGHLIGHT;
      clear();
    },
  };
}
