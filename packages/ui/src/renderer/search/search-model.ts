/**
 * Pure search model (013). Match finding, wrap-around index maths, the "N of M"
 * count, and selection seeding — the logic that is identical whether the search
 * runs over an editor document or a terminal's scrollback.
 *
 * Deliberately free of DOM and of any engine object: CodeMirror's `Text` and
 * `SearchQuery` are pure JS, so the real case / whole-word semantics are settled
 * here (and unit-tested) rather than only observable through the running app.
 */
import { SearchQuery } from '@codemirror/search';
import type { Text } from '@codemirror/state';

/** The visible, session-persistent match toggles (FR-007). Regex is deferred. */
export interface MatchModes {
  caseSensitive: boolean;
  wholeWord: boolean;
}

/** One occurrence, as absolute document offsets. */
export interface Match {
  from: number;
  to: number;
}

/** What the find bar renders as "current of total" (FR-002). */
export interface SearchCount {
  current: number;
  total: number;
}

export const NO_MODES: MatchModes = { caseSensitive: false, wholeWord: false };
export const NO_MATCHES: SearchCount = { current: 0, total: 0 };

/**
 * Every match of `term` in the document, in document order. An empty term matches
 * nothing — a search with no term is not a search (FR-009's no-results state is for
 * a real term that misses, not for an empty box).
 */
export function editorMatches(doc: Text, term: string, modes: MatchModes): Match[] {
  if (term.length === 0) return [];
  const query = new SearchQuery({
    search: term,
    caseSensitive: modes.caseSensitive,
    wholeWord: modes.wholeWord,
    literal: true,
  });
  if (!query.valid) return [];

  const out: Match[] = [];
  const cursor = query.getCursor(doc);
  for (let it = cursor.next(); !it.done; it = cursor.next()) {
    out.push({ from: it.value.from, to: it.value.to });
  }
  return out;
}

/**
 * The match the search should land on given the caret/viewport position: the first
 * one at or after `pos`, wrapping to the top when the caret sits past the last match.
 */
export function indexFrom(matches: Match[], pos: number): number {
  if (matches.length === 0) return -1;
  const i = matches.findIndex((m) => m.from >= pos);
  return i === -1 ? 0 : i;
}

/** Step the current match forward/back, wrapping at both ends (FR-006 / FR-011). */
export function stepIndex(current: number, total: number, step: 1 | -1): number {
  if (total === 0) return -1;
  return (((current + step) % total) + total) % total;
}

/** The 1-based count the bar shows; `{0, 0}` is the no-results state (FR-009). */
export function countOf(matches: Match[], current: number): SearchCount {
  if (matches.length === 0 || current < 0) return NO_MATCHES;
  return { current: current + 1, total: matches.length };
}

/**
 * The term a selection seeds the find input with (FR-002b): a non-empty, single-line
 * selection only. A multi-line selection is a block of text, not a search term, so it
 * is ignored and find opens with its previous term instead.
 */
export function seedFrom(selection: string | null | undefined): string {
  const s = selection ?? '';
  if (s.length === 0 || s.includes('\n') || s.includes('\r')) return '';
  return s;
}
