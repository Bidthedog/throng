# Contract: SearchController (renderer)

The dependency-inversion seam between the shared find bar and the two search engines. The find bar depends
only on this interface; it never imports `@codemirror/search` or `@xterm/addon-search` directly (Principle
VIII/IX). One instance backs one panel **view**.

```ts
/** Ordinary vs current match roles map to theme tokens (see theme-tokens.md). */
export interface MatchModes {
  caseSensitive: boolean;   // default false (D9)
  wholeWord: boolean;       // default false (D9)
}

export interface SearchCount {
  current: number;          // 1-based index of the current match, 0 when none
  total: number;            // total matches in the searchable content
}

/** Read-only find, common to editor and terminal. */
export interface SearchController {
  readonly panelKind: 'editor' | 'terminal';

  /** Non-empty single-line selection in the panel, for seeding the input (FR-002b). '' if none. */
  seedFromSelection(): string;

  /** Set/replace the active query; recomputes matches incrementally (debounced by the caller, D7).
   *  MUST NOT mutate panel content (FR-003). Returns the resulting count. */
  setQuery(term: string, modes: MatchModes): SearchCount;

  /** Advance / retreat the current match, wrapping at the ends (FR-006/FR-011). */
  findNext(): SearchCount;
  findPrevious(): SearchCount;

  /** Subscribe to count changes (e.g. terminal streaming re-eval, FR-012). Returns an unsubscribe. */
  onCountChange(cb: (count: SearchCount) => void): () => void;

  /** Clear highlights and release engine resources; return focus target to the panel (FR-004). */
  close(): void;
}

/** Editor-only: replace (Phase C). Terminal controllers do NOT implement this (read-only, FR-010). */
export interface EditorSearchController extends SearchController {
  readonly panelKind: 'editor';
  /** Replace the current match; selection advances to the next match (FR-008 AC1). */
  replaceCurrent(replacement: string): SearchCount;
  /** Replace every match in ONE undoable transaction; preserves encoding & line endings (FR-008). */
  replaceAll(replacement: string): SearchCount;
}

/** Terminal-only: scrollback navigation + auto-follow freeze (FR-012a/014/016). */
export interface TerminalSearchController extends SearchController {
  readonly panelKind: 'terminal';
  scrollLines(delta: number): void;      // line up/down (FR-014)
  scrollPages(delta: number): void;      // page up/down (FR-014)
  scrollToTop(): void;                   // jump to start of retained scrollback (FR-014)
  scrollToLiveBottom(): void;            // jump to live end; resumes auto-follow (FR-014/FR-012a)
  /** True when the viewport shows newest output (gates pass-through typing, FR-016). */
  isAtLiveBottom(): boolean;
  /** Suspend/resume auto-follow while parked on a match (FR-012a). View-only; no pty keystroke. */
  setAutoFollow(enabled: boolean): void;
}
```

## Contract behaviours (test targets)

| # | Behaviour | Requirement | Verified by |
|---|-----------|-------------|-------------|
| C1 | `setQuery` highlights all matches, marks current, returns count; no content change | FR-005/010, FR-003 | unit + E2E |
| C2 | `findNext`/`findPrevious` wrap at ends | FR-006/011 | unit + E2E |
| C3 | Terminal controller sends **zero** keystrokes to the pty for find/nav | FR-010/014, SC-002 | E2E (process/output assert) |
| C4 | `EditorSearchController.replaceAll` = one undo step; encoding/line endings preserved | FR-008, SC-004 | integration + E2E |
| C5 | `seedFromSelection` returns the current single-line selection, else '' | FR-002b | unit |
| C6 | `onCountChange` fires when terminal scrollback grows/trims (re-eval) | FR-012 | integration |
| C7 | `setAutoFollow(false)` keeps viewport on the match as output streams; `scrollToLiveBottom` resumes | FR-012a | E2E |
| C8 | Terminal controller exposes **no** `replace*` (type-level read-only) | FR-010 | typecheck/unit |

The find bar selects `EditorSearchController` vs `TerminalSearchController` from the active panel type
(012 active-pane context) and renders replace controls only for the editor (FR-002).
