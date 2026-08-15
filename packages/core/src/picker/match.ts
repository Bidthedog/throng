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
 * The first occurrence of `pattern` in `text`, or `null`.
 *
 * `pattern` carries the `i` flag, which is what does the case folding — rather than
 * `toLowerCase().indexOf()`, because lower-casing can change a string's length (`'İ'` becomes two
 * code units) and would then hand `matchSpans` offsets that do not line up with the original text.
 * The span is taken from what actually matched, for the same reason (C3).
 */
function findFolded(text: string, pattern: RegExp): MatchSpan | null {
  const found = pattern.exec(text);
  return found === null ? null : { start: found.index, end: found.index + found[0].length };
}

/**
 * A query with its per-term regular expressions already built (033, contracts/picker-extensions
 * §1, C1–C3).
 *
 * Compiling is the expensive half of matching, and it depends only on the QUERY — so at 50,000
 * entries and two terms this is two `RegExp` constructions rather than a hundred thousand (C2).
 * `matches` and `matchSpans` below are the same rule expressed per call; both delegate here, so
 * there is exactly one implementation of what a match is.
 */
export interface CompiledQuery {
  /** True for an empty or whitespace-only query — which matches everything (K6). */
  readonly empty: boolean;
  test(text: string): boolean;
  spans(text: string): MatchSpan[];
}

/** Build the reusable matcher for `query`. Pure: the same query always compiles to the same rule. */
export function compileQuery(query: string): CompiledQuery {
  const patterns = terms(query).map((term) => new RegExp(term.replace(REGEX_SPECIAL, '\\$&'), 'i'));
  return {
    empty: patterns.length === 0,

    test(text: string): boolean {
      for (const pattern of patterns) if (findFolded(text, pattern) === null) return false;
      return true;
    },

    /**
     * The runs of `text` to mark, so the user can see *why* a row matched — which matters most
     * when the terms matched in an order they did not type (K10, FR-028e).
     *
     * One span per term, at that term's first occurrence, sorted by position. Empty for an empty
     * query and for a text that does not match. Terms whose runs overlap or abut merge into one
     * span: a character cannot be highlighted twice, so `ab bc` over `abc` marks `abc` once.
     */
    spans(text: string): MatchSpan[] {
      const found: MatchSpan[] = [];
      for (const pattern of patterns) {
        const span = findFolded(text, pattern);
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
    },
  };
}

/**
 * Whether every whitespace-separated term of `query` appears in `text`, case-insensitively, in any
 * order (K4, K5, K7). An empty or whitespace-only query matches everything (K6).
 *
 * One call, one compile. Over a corpus, compile once with `compileQuery` and reuse it (C2).
 */
export function matches(text: string, query: string): boolean {
  return compileQuery(query).test(text);
}

/** The runs of `text` to mark for `query`. See `CompiledQuery.spans` for the rule (K10). */
export function matchSpans(text: string, query: string): MatchSpan[] {
  return compileQuery(query).spans(text);
}
