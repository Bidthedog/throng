/**
 * 013's pure search model, MOVED TO CORE by 043 (R1) — match finding, wrap-around index
 * maths, the "N of M" count, and selection seeding. The logic that is identical whether the
 * search runs over an editor document, a terminal's scrollback, or a file on disk.
 *
 * ══ WHY IT LIVES HERE NOW ══
 *
 * It was declared in `packages/ui/src/renderer/search/search-model.ts`, a RENDERER module.
 * 043 scans a project's files from the MAIN process (research R2: the renderer is sandboxed
 * and single-threaded, so a large walk there is exactly the stall FR-041 forbids) — and main
 * never imports from the renderer. So the match semantics had two consumers in two processes
 * and one of them could not reach them, which is Constitution II's test exactly.
 *
 * Re-exported from its old home, so no existing caller or test changes. This is the
 * {@link ../editor/refusal.ts} precedent, followed deliberately rather than re-derived.
 *
 * ══ WHY THE ENGINE COMES WITH IT ══
 *
 * `@codemirror/state` and `@codemirror/search` are new dependencies of the domain layer, and
 * that is stated in 043's Constitution Check rather than slipped through. Both are pure JS
 * with no DOM and no OS call: `SearchQuery` is a matching object with a cursor, and `Text` is
 * a rope. Nothing here mounts an extension, binds a key or renders anything — the guard at
 * `packages/ui/tests/unit/codemirror-search-absent.test.ts` is what holds that line.
 *
 * The alternative was hand-writing case-folding and word-boundary matching in core, which
 * FR-039 forbids for the reason it would obviously drift from the find bar's semantics.
 */
import { SearchQuery } from '@codemirror/search';
import type { Text } from '@codemirror/state';
import { seedFromSelections } from '../editor/seed-selection.js';

/**
 * The visible, session-persistent match toggles (013 FR-007).
 *
 * These two, and only these two — a file search takes the SAME vocabulary rather than
 * declaring a second one (043 FR-039), and regex is not a mode on either surface (043 FR-040).
 * Adding a third member here is therefore a decision about both surfaces at once, which is the
 * whole reason the type is shared.
 */
export interface MatchModes {
  caseSensitive: boolean;
  wholeWord: boolean;
}

/** One occurrence, as absolute document offsets. */
export interface Match {
  from: number;
  to: number;
}

/** What the find bar renders as "current of total" (013 FR-002). */
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
 * The term a ONE-range selection seeds the find input with (013 FR-002b) — the Terminal's case,
 * where a selection is always a single range.
 *
 * The rule itself lives in {@link seedFromSelections}, because the EDITOR can now hold a
 * rectangular block or a multi-cursor set, and the decision of what an ambiguous selection seeds
 * (nothing — never an arbitrary row of it, 041 FR-025i) has to be the same rule in both places.
 */
export function seedFrom(selection: string | null | undefined): string {
  return seedFromSelections([selection ?? '']);
}
