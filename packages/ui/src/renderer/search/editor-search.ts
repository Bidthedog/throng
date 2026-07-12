/**
 * Editor search engine (013, US1/US4) — the CodeMirror side of the shared find bar.
 *
 * Matching semantics come from the pure model (`search-model.ts`); this file owns only
 * the view concerns: painting the matches as decorations whose colours resolve to THEME
 * TOKENS (never hardcoded), scrolling the current match into view, and committing a
 * replace. Replace-all is a SINGLE transaction, which is what makes it one undo step
 * (FR-008) and what keeps encoding / line endings untouched — the document's text is
 * changed in place and the existing save path writes it back exactly as before.
 */
import { StateEffect, StateField } from '@codemirror/state';
import { Decoration, EditorView, type DecorationSet } from '@codemirror/view';
import type { EditorSearchController } from './search-controller.js';
import {
  countOf,
  editorMatches,
  indexFrom,
  NO_MATCHES,
  seedFrom,
  stepIndex,
  type Match,
  type MatchModes,
  type SearchCount,
} from './search-model.js';

interface Highlights {
  matches: Match[];
  current: number;
}

const setHighlights = StateEffect.define<Highlights>();

/**
 * Per-view "the document changed" hook. Match offsets are absolute, so ANY edit while
 * find is open — the user typing, an auto-save reformat, a replace of our own — invalidates
 * them. Replacing at stale offsets would write over whatever now occupies those positions,
 * so the controller re-runs its query on every document change instead of trusting them.
 */
const docChanged = new WeakMap<EditorView, () => void>();

/**
 * The match decorations. Kept in a field (not recomputed per render) so ordinary
 * editing maps the ranges through the change set rather than losing them.
 */
const highlightField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setHighlights)) {
        const { matches, current } = effect.value;
        return Decoration.set(
          matches.map((m, i) =>
            Decoration.mark({
              class:
                i === current
                  ? 'throng-search-match throng-search-match--current'
                  : 'throng-search-match',
            }).range(m.from, m.to),
          ),
          true,
        );
      }
    }
    return tr.docChanged ? deco.map(tr.changes) : deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

/** The extension an editor view must carry for search highlights to paint. */
export const searchHighlightExtension = [
  highlightField,
  EditorView.updateListener.of((update) => {
    if (update.docChanged) docChanged.get(update.view)?.();
  }),
];

/**
 * Build the search controller for one editor view. `isReadOnly` is asked afresh on
 * every replace so a document that becomes non-editable stops accepting replacements
 * without the bar having to be rebuilt.
 */
export function createEditorSearchController(
  view: EditorView,
  isReadOnly: () => boolean,
  onCount?: (count: SearchCount) => void,
): EditorSearchController {
  let term = '';
  let modes: MatchModes = { caseSensitive: false, wholeWord: false };
  let matches: Match[] = [];
  let current = -1;

  const paint = (): void => {
    view.dispatch({ effects: setHighlights.of({ matches, current }) });
  };

  const reveal = (): void => {
    const m = matches[current];
    if (!m) return;
    view.dispatch({ effects: EditorView.scrollIntoView(m.from, { y: 'center' }) });
  };

  /** Recompute against the live document, keeping the caret's sense of "where I am". */
  const recompute = (anchor: number): SearchCount => {
    matches = editorMatches(view.state.doc, term, modes);
    current = indexFrom(matches, anchor);
    paint();
    reveal();
    return countOf(matches, current);
  };

  /**
   * Re-run the query against the CURRENT document, holding the current match as close to
   * where it was as the new text allows. Called on every document change, so the offsets a
   * replace is about to use always describe the document it is about to modify.
   */
  const resync = (): SearchCount => {
    if (term.length === 0) return NO_MATCHES;
    const anchor = matches[current]?.from ?? view.state.selection.main.from;
    matches = editorMatches(view.state.doc, term, modes);
    current = matches.length === 0 ? -1 : Math.min(indexFrom(matches, anchor), matches.length - 1);
    paint();
    return countOf(matches, current);
  };

  // Any edit — the user typing while the bar is open, or a replace of our own — moves the
  // text out from under our offsets. Re-searching on change is what stops a later replace
  // from writing into whatever now sits at the old positions.
  docChanged.set(view, () => {
    const count = resync();
    onCount?.(count);
  });

  return {
    panelKind: 'editor',

    seedFromSelection(): string {
      const sel = view.state.selection.main;
      return seedFrom(view.state.sliceDoc(sel.from, sel.to));
    },

    setQuery(nextTerm: string, nextModes: MatchModes): SearchCount {
      term = nextTerm;
      modes = nextModes;
      // Search from the caret, so find lands on the next occurrence ahead of you.
      return recompute(view.state.selection.main.from);
    },

    findNext(): SearchCount {
      current = stepIndex(current, matches.length, 1);
      paint();
      reveal();
      return countOf(matches, current);
    },

    findPrevious(): SearchCount {
      current = stepIndex(current, matches.length, -1);
      paint();
      reveal();
      return countOf(matches, current);
    },

    replaceCurrent(replacement: string): SearchCount {
      if (isReadOnly()) return countOf(matches, current);
      // Never replace against remembered offsets: re-derive them from the document as it
      // is RIGHT NOW, so an edit made while the bar was open cannot misplace the write.
      resync();
      const m = matches[current];
      if (!m) return countOf(matches, current);
      view.dispatch({ changes: { from: m.from, to: m.to, insert: replacement } });
      // Re-search from where the replacement ends, so the selection lands on the NEXT
      // match rather than re-finding the text we just inserted.
      return recompute(m.from + replacement.length);
    },

    replaceAll(replacement: string): SearchCount {
      if (isReadOnly()) return countOf(matches, current);
      resync();
      if (matches.length === 0) return NO_MATCHES;
      // ONE transaction ⇒ one undo step (FR-008). Ranges are in document order and never
      // overlap, so CodeMirror applies them as a single change set and shifts the later
      // ones for us — which is why they must all describe the SAME (pre-change) document.
      view.dispatch({
        changes: matches.map((m) => ({ from: m.from, to: m.to, insert: replacement })),
      });
      // The dispatch triggers resync via the document-change hook; report what it found.
      return countOf(matches, current);
    },

    isReadOnly,

    close(opts?: { refocus?: boolean }): void {
      matches = [];
      current = -1;
      term = '';
      docChanged.delete(view);
      view.dispatch({ effects: setHighlights.of({ matches: [], current: -1 }) });
      // Only pull focus back into the content when the user closed find ON this panel.
      // Closing because they moved to ANOTHER panel must not drag focus back here.
      if (opts?.refocus !== false) view.focus();
    },
  };
}
