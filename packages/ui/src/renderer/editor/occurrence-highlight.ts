/**
 * Other instances of the selected text, softly tinted (049 US4, #324; FR-013 – FR-020, research R8/R9).
 *
 * ══ WHAT IT DOES ══
 *
 * With a non-empty single-line selection of two or more characters, every OTHER occurrence of that text in the
 * document carries `throng-occurrence` (find-bar.css gives it `searchMatchOccurrence`, or the weaker inactive
 * tint while the editor has no focus). Which ranges count is core's rule (`occurrenceQuery` / `occurrenceMatches`:
 * literal, case-sensitive, whole-word when the selection is a word) — the preview applies the same functions to
 * its rendered text, so the two panels cannot disagree.
 *
 * ══ WHY THE WHOLE DOCUMENT, AND NEVER ON A SCROLL ══
 *
 * Tinting is work on the input path (Principle XII). The decorations are rebuilt only when the selection, the
 * document or the find matches change (049 FR-030) — NOT on a scroll. They were once rebuilt on every viewport
 * change over `view.visibleRanges`, which put a scan, a decoration set and a re-decoration on the path of every
 * scrolled frame (research R14). One literal scan of a 10,000-line document is about 2 ms (core's
 * `occurrenceMatches`), CodeMirror paints only the marks in view, and a scroll costs nothing here.
 * (Measured: `editor-occurrence-highlight.test.ts`.)
 *
 * ══ PRECEDENCE ══
 *
 * A range that is a find match carries the find treatment and NO occurrence mark (FR-013): the occurrences are
 * filtered against the painted matches by `withoutSearchMatches`, stated once in core, rather than by the order
 * two layers happen to stack in. The extension sits at `Prec.low`, beneath the syntax layer, like the match
 * decoration — a background under the foreground colours, never a replacement for them (FR-011).
 *
 * Occurrences are not selected, navigated to or acted on: they are decorations, and nothing here touches the
 * selection or the document (FR-017).
 */
import { Compartment, Prec, type Extension } from '@codemirror/state';
import { Decoration, ViewPlugin, type DecorationSet, type EditorView, type ViewUpdate } from '@codemirror/view';
import { occurrenceMatches, occurrenceQuery, withoutSearchMatches } from '@throng/core';
import { searchMatchesChanged, searchMatchRanges } from '../search/editor-search.js';

const OCCURRENCE = Decoration.mark({ class: 'throng-occurrence' });

function build(view: EditorView): DecorationSet {
  const { state } = view;
  const { selection } = state;
  // One non-empty range only: a multi-cursor or rectangular selection has no single "selected text".
  if (selection.ranges.length !== 1) return Decoration.none;
  const { from, to } = selection.main;
  if (from === to) return Decoration.none;
  const line = state.doc.lineAt(from);
  if (to > line.to) return Decoration.none; // spans a line break
  const query = occurrenceQuery(line.text, from - line.from, to - line.from);
  if (!query) return Decoration.none;

  // The whole document (049 FR-030): CodeMirror paints only what is in view, and a scroll then has nothing to add.
  const found = occurrenceMatches(state.doc, query, { from, to });
  if (found.length === 0) return Decoration.none;
  const shown = withoutSearchMatches(found, searchMatchRanges(state, [{ from: found[0]!.from, to: found[found.length - 1]!.to }]));
  return Decoration.set(
    shown.map((m) => OCCURRENCE.range(m.from, m.to)),
    true,
  );
}

const occurrencePlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = build(view);
    }
    update(update: ViewUpdate): void {
      // Not `viewportChanged` (049 FR-030): scrolling does no work here.
      if (update.selectionSet || update.docChanged || searchMatchesChanged(update)) {
        this.decorations = build(update.view);
      }
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

/** The extension an editor view carries while `editor.highlightOccurrences` is on. */
export const occurrenceHighlightExtension: Extension = Prec.low(occurrencePlugin);

/** Holds {@link occurrenceHighlightExtension} (or nothing) so the setting reaches a live view without a remount (FR-019). */
export const occurrenceCompartment = new Compartment();

/** What `occurrenceCompartment` holds for a given setting value. */
export const occurrenceExtensionFor = (enabled: boolean): Extension => (enabled ? occurrenceHighlightExtension : []);
