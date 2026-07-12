/**
 * The seam between the one shared find bar and the two search engines (013).
 *
 * The bar depends only on these interfaces — it never imports `@codemirror/search`
 * or `@xterm/addon-search`. A terminal controller has **no** replace methods at all
 * (read-only by type, FR-010); an editor controller has no scrollback navigation.
 * Panels register their controller here, exactly as they already register their
 * focus handler and editor actions.
 */
import type { MatchModes, SearchCount } from './search-model.js';

interface BaseSearchController {
  /** A non-empty single-line selection to seed the find input with (FR-002b); '' if none. */
  seedFromSelection(): string;
  /** Set the query and recompute matches. Never mutates panel content (FR-003). */
  setQuery(term: string, modes: MatchModes): SearchCount;
  /** Step the current match, wrapping at both ends (FR-006 / FR-011). */
  findNext(): SearchCount;
  findPrevious(): SearchCount;
  /**
   * Clear highlights and hand focus back to the panel content (FR-004).
   * `refocus: false` closes WITHOUT taking focus — used when find is dismissed because the
   * user moved to a different panel, where pulling focus back would fight them.
   */
  close(opts?: { refocus?: boolean }): void;
}

/** Editor: find AND replace (FR-008). */
export interface EditorSearchController extends BaseSearchController {
  readonly panelKind: 'editor';
  /** Replace the current match, then advance to the next (FR-008). */
  replaceCurrent(replacement: string): SearchCount;
  /** Replace every match in ONE undoable transaction (FR-008). */
  replaceAll(replacement: string): SearchCount;
  /** A read-only document disables replace; find still works (spec Edge Cases). */
  isReadOnly(): boolean;
}

/** Terminal: read-only find + scrollback navigation (FR-010, FR-012a, FR-014). */
export interface TerminalSearchController extends BaseSearchController {
  readonly panelKind: 'terminal';
  scrollLines(delta: number): void;
  scrollPages(delta: number): void;
  scrollToTop(): void;
  /** Jump to the newest output; resumes auto-follow (FR-012a / FR-014). */
  scrollToLiveBottom(): void;
  /** Matches are re-evaluated as output streams in (FR-012). */
  onCountChange(cb: (count: SearchCount) => void): () => void;
}

export type SearchController = EditorSearchController | TerminalSearchController;

const registry = new Map<string, SearchController>();

export function registerPanelSearch(panelId: string, controller: SearchController): void {
  registry.set(panelId, controller);
}

export function unregisterPanelSearch(panelId: string): void {
  registry.delete(panelId);
}

export function getPanelSearch(panelId: string): SearchController | undefined {
  return registry.get(panelId);
}
