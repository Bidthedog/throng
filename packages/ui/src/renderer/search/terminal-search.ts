/**
 * Terminal search engine (013, US2/US3) — the xterm side of the shared find bar.
 *
 * READ-ONLY by construction: this controller has no replace methods (the type forbids
 * them), and nothing here ever writes to the pty. It only reads the retained scrollback
 * and moves the VIEWPORT, so a search can never disturb the running program (FR-010).
 *
 * Auto-follow (FR-012a) needs no mechanism of its own: xterm only follows new output
 * while the viewport is already at the live bottom. Scrolling to a match up in the
 * scrollback therefore parks the view there, and incoming output accumulates without
 * yanking it away; jumping back to the bottom resumes following. The E2E proves it.
 */
import type { Terminal } from '@xterm/xterm';
import type { ISearchOptions, SearchAddon } from '@xterm/addon-search';
import type { TerminalSearchController } from './search-controller.js';
import { NO_MATCHES, seedFrom, type MatchModes, type SearchCount } from './search-model.js';

/** Match-highlight colours, resolved from theme tokens by the caller (FR-019). */
export interface TerminalSearchDecorations {
  matchBackground: string;
  activeMatchBackground: string;
  activeMatchBorder: string;
}

export function createTerminalSearchController(
  term: Terminal,
  addon: SearchAddon,
  /** Read afresh on every search, so re-theming repaints the highlights (FR-019). */
  decorationsOf: () => TerminalSearchDecorations,
): TerminalSearchController {
  let query = '';
  let modes: MatchModes = { caseSensitive: false, wholeWord: false };
  let count: SearchCount = NO_MATCHES;
  const listeners = new Set<(c: SearchCount) => void>();

  // xterm reports the result set asynchronously — and re-reports it as the buffer
  // grows or is trimmed, which is exactly the "stay coherent under streaming output"
  // requirement (FR-012). We keep the latest and push it to whoever is listening.
  addon.onDidChangeResults(({ resultIndex, resultCount }) => {
    count = { current: resultIndex >= 0 ? resultIndex + 1 : 0, total: resultCount };
    for (const l of listeners) l(count);
  });

  const options = (): ISearchOptions => {
    const d = decorationsOf();
    return {
      caseSensitive: modes.caseSensitive,
      wholeWord: modes.wholeWord,
      regex: false,
      decorations: {
        matchBackground: d.matchBackground,
        matchBorder: 'transparent',
        matchOverviewRuler: d.matchBackground,
        activeMatchBackground: d.activeMatchBackground,
        activeMatchBorder: d.activeMatchBorder,
        activeMatchColorOverviewRuler: d.activeMatchBackground,
      },
    };
  };

  return {
    panelKind: 'terminal',

    seedFromSelection(): string {
      return seedFrom(term.getSelection());
    },

    setQuery(nextTerm: string, nextModes: MatchModes): SearchCount {
      query = nextTerm;
      modes = nextModes;
      if (query.length === 0) {
        addon.clearDecorations();
        count = NO_MATCHES;
        return count;
      }
      // `incremental` keeps the current match anchored while the term is still being
      // typed, instead of hopping forward on every keystroke.
      addon.findNext(query, { ...options(), incremental: true });
      return count;
    },

    findNext(): SearchCount {
      if (query.length === 0) return count;
      addon.findNext(query, options());
      return count;
    },

    findPrevious(): SearchCount {
      if (query.length === 0) return count;
      addon.findPrevious(query, options());
      return count;
    },

    onCountChange(cb: (c: SearchCount) => void): () => void {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },

    // — Scrollback navigation (FR-014). Viewport only; never a keystroke to the program.
    scrollLines(delta: number): void {
      term.scrollLines(delta);
    },

    scrollPages(delta: number): void {
      term.scrollPages(delta);
    },

    scrollToTop(): void {
      term.scrollToTop();
    },

    scrollToLiveBottom(): void {
      // Returning to the bottom is also what resumes auto-follow (FR-012a).
      term.scrollToBottom();
    },

    close(opts?: { refocus?: boolean }): void {
      // NB: the count listeners live as long as the terminal does (they are wired once at
      // mount and torn down with the view) — closing a find session must not drop them, or
      // the NEXT search would report no count.
      query = '';
      count = NO_MATCHES;
      addon.clearDecorations();
      // Do not pull focus back into a terminal the user has just navigated away from.
      if (opts?.refocus !== false) term.focus();
    },
  };
}
