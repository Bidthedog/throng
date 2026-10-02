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
import { Prec, StateEffect, StateField, type EditorState } from '@codemirror/state';
import { Decoration, EditorView, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import type { EditorSearchController } from './search-controller.js';
import { seedFromSelections } from '@throng/core';
import {
  countOf,
  editorMatches,
  indexFrom,
  NO_MATCHES,
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

/**
 * The extension an editor view must carry for search highlights to paint.
 *
 * The match decoration is mounted at LOW precedence, BENEATH the syntax layer (016, FR-007a).
 * A match is a BACKGROUND and the syntax colour stays the FOREGROUND, so matched code keeps its
 * highlighting instead of flattening into a solid block — which is what "the match wins" would do,
 * and what no serious editor does. The two layers are deliberately disjoint in what they set (this
 * one paints `background`, the highlight style paints `color`), and the explicit precedence is
 * what keeps that composition from depending on the order extensions happen to be listed in.
 */
export const searchHighlightExtension = [
  Prec.low(highlightField),
  EditorView.updateListener.of((update) => {
    if (update.docChanged) docChanged.get(update.view)?.();
  }),
];

/**
 * The find matches painted in `state`, within `ranges`, in document order (049 FR-013). Read from the decoration
 * set rather than a remembered array: the set is mapped through every edit, so it is correct even in the moment
 * between a change and the controller's re-search, which is when the occurrence tint asks.
 */
export function searchMatchRanges(state: EditorState, ranges: readonly { from: number; to: number }[]): Match[] {
  const set = state.field(highlightField, false);
  if (!set) return [];
  const out: Match[] = [];
  let last = -1;
  for (const r of ranges) {
    set.between(r.from, r.to, (from, to) => {
      if (from > last) {
        out.push({ from, to });
        last = from;
      }
    });
  }
  return out;
}

/** True when this update changed which find matches are painted (a new query, a step, an edit mapping them). */
export function searchMatchesChanged(update: ViewUpdate): boolean {
  return update.startState.field(highlightField, false) !== update.state.field(highlightField, false);
}

/**
 * What an editor panel supplies for a document that can hide text (a Markdown section fold, 049 R5). Absent for
 * an editor with nothing foldable, where every method below is a no-op and find behaves as it always did.
 */
export interface EditorSearchDeps {
  /**
   * Make offset `pos` visible BEFORE the controller scrolls to it or edits it: open the collapsed sections whose
   * fold hides it, through the document's fold authority (never a bare unfold, never a collapse — FR-006).
   */
  revealBeforeScroll?: (pos: number) => boolean | void;
  /** The collapsed sections whose fold hides `pos`, own or ancestor (none when it is visible). */
  hidingSections?: (pos: number) => string[];
  /** Open exactly these sections, in one fold-state write (Replace All's "Replace and unfold"). */
  revealSections?: (slugs: readonly string[]) => void;
}

/**
 * Build the search controller for one editor view. `isReadOnly` is asked afresh on
 * every replace so a document that becomes non-editable stops accepting replacements
 * without the bar having to be rebuilt.
 */
export function createEditorSearchController(
  view: EditorView,
  isReadOnly: () => boolean,
  onCount?: (count: SearchCount) => void,
  deps: EditorSearchDeps = {},
): EditorSearchController {
  let term = '';
  let modes: MatchModes = { caseSensitive: false, wholeWord: false };
  let matches: Match[] = [];
  let current = -1;
  /**
   * The offset of the current match the last time there was one (049 R1). A controller rebuilt by a remount
   * is restored against a document that may not have arrived yet — the view is created empty and the text
   * lands a moment later — so `resync` needs somewhere to re-land when `matches` is still empty.
   */
  let lastFrom: number | null = null;

  const paint = (): void => {
    const from = matches[current]?.from;
    if (from !== undefined) lastFrom = from;
    view.dispatch({ effects: setHighlights.of({ matches, current }) });
  };

  const reveal = (): void => {
    const m = matches[current];
    if (!m) return;
    // 049 FR-005: a match inside a collapsed section is opened (through the fold authority) before we scroll to it.
    deps.revealBeforeScroll?.(m.from);
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
    const anchor = matches[current]?.from ?? lastFrom ?? view.state.selection.main.from;
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

    /**
     * EVERY range, not `selection.main` (FR-025i).
     *
     * `main` is one row of a rectangular block — whichever row the drag's head ended on. Seeding
     * from it would open find searching for an arbitrary line of the user's ten-row block, which is
     * both wrong and impossible to notice: the find bar is pre-filled with something that came from
     * the selection, so it looks exactly like it worked.
     */
    seedFromSelection(): string {
      return seedFromSelections(
        view.state.selection.ranges.map((range) => view.state.sliceDoc(range.from, range.to)),
      );
    },

    setQuery(nextTerm: string, nextModes: MatchModes): SearchCount {
      term = nextTerm;
      modes = nextModes;
      // Search from the caret, so find lands on the next occurrence ahead of you.
      return recompute(view.state.selection.main.from);
    },

    restore(nextTerm: string, nextModes: MatchModes, anchor: number | null): SearchCount {
      term = nextTerm;
      modes = nextModes;
      lastFrom = anchor;
      matches = editorMatches(view.state.doc, term, modes);
      current = matches.length === 0 ? -1 : indexFrom(matches, anchor ?? 0);
      paint(); // never `reveal()`: the view's own restored scroll position stands (049 FR-001)
      return countOf(matches, current);
    },

    currentFrom(): number | null {
      return matches[current]?.from ?? null;
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
      // 049 FR-007: never edit text the user cannot see — open its section first.
      deps.revealBeforeScroll?.(m.from);
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

    foldedMatchCount(): number {
      if (!deps.hidingSections) return 0;
      return matches.filter((m) => deps.hidingSections!(m.from).length > 0).length;
    },

    foldedSectionSlugs(): string[] {
      if (!deps.hidingSections) return [];
      const seen = new Set<string>();
      for (const m of matches) for (const slug of deps.hidingSections(m.from)) seen.add(slug);
      return [...seen];
    },

    revealSections(slugs: readonly string[]): void {
      deps.revealSections?.(slugs);
    },

    close(opts?: { refocus?: boolean }): void {
      matches = [];
      current = -1;
      term = '';
      lastFrom = null;
      docChanged.delete(view);
      view.dispatch({ effects: setHighlights.of({ matches: [], current: -1 }) });
      // Only pull focus back into the content when the user closed find ON this panel.
      // Closing because they moved to ANOTHER panel must not drag focus back here.
      if (opts?.refocus !== false) view.focus();
    },
  };
}
