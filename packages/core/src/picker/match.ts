/**
 * Typeahead matching for the general list-and-choose picker (031 US3, FR-028c, contracts §5).
 *
 * The rule, deliberately, is the simplest one a user can predict: **split the query on whitespace
 * into terms, and an entry matches when every term appears as a case-insensitive substring
 * somewhere in its text, in any order.** Not fuzzy matching, not a subsequence, and not a relevance
 * score — matching here is a filter, so `find file` finds `file find.txt` just as readily as
 * `find any file.md`, and a user who remembers two words about a target need not remember which
 * came first.
 *
 * Terms are matched against the whole text including separators, which is what lets the same
 * control be seeded with file paths later (#219): `find file` matches `src/find/file.ts`.
 *
 * Pure and corpus-agnostic — nothing here knows what a tab is.
 */

/** A run of `text` covered by one of the query's terms. `end` is exclusive. */
export interface MatchSpan {
  start: number;
  end: number;
}

/** Split a query into its terms. An empty or whitespace-only query yields none (K6). */
function terms(query: string): string[] {
  return query.split(/\s+/u).filter((term) => term.length > 0);
}

const REGEX_SPECIAL = /[.*+?^${}()|[\]\\]/g;

/**
 * The first occurrence of `term` in `text`, compared case-insensitively, or `null`.
 *
 * A regular expression with the `i` flag does the folding, rather than `toLowerCase().indexOf()`,
 * because lower-casing can change a string's length (`'İ'` becomes two code units) and would
 * then hand `matchSpans` offsets that do not line up with the original text. The span is taken
 * from what actually matched, for the same reason.
 */
function findFolded(text: string, term: string): MatchSpan | null {
  const found = new RegExp(term.replace(REGEX_SPECIAL, '\\$&'), 'i').exec(text);
  return found === null ? null : { start: found.index, end: found.index + found[0].length };
}

/**
 * Whether every whitespace-separated term of `query` appears in `text`, case-insensitively, in any
 * order (K4, K5, K7). An empty or whitespace-only query matches everything (K6).
 */
export function matches(text: string, query: string): boolean {
  return terms(query).every((term) => findFolded(text, term) !== null);
}

/**
 * The runs of `text` to mark, so the user can see *why* a row matched — which matters most when
 * the terms matched in an order they did not type (K10, FR-028e).
 *
 * One span per term, at that term's first occurrence, sorted by position. Empty for an empty query
 * and for a text that does not match. Terms whose runs overlap or abut merge into one span: a
 * character cannot be highlighted twice, so `ab bc` over `abc` marks `abc` once.
 */
export function matchSpans(text: string, query: string): MatchSpan[] {
  const found: MatchSpan[] = [];
  for (const term of terms(query)) {
    const span = findFolded(text, term);
    if (span === null) return []; // one term missing means the entry does not match at all
    found.push(span);
  }

  found.sort((a, b) => a.start - b.start || a.end - b.end);

  const merged: MatchSpan[] = [];
  for (const span of found) {
    const previous = merged[merged.length - 1];
    if (previous !== undefined && span.start <= previous.end) {
      previous.end = Math.max(previous.end, span.end);
    } else {
      merged.push({ ...span });
    }
  }
  return merged;
}
