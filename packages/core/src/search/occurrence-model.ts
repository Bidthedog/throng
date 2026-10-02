/**
 * 049 R8 — what counts as another occurrence of a selection (FR-015), and how occurrences give way to
 * search matches (FR-013). Pure, and shared by the editor (over its source) and the preview (over its
 * rendered text model), so the two panels can never disagree about either rule.
 *
 * Matching is literal and case-sensitive — exactly a substring search, so it is `indexOf` over the text
 * rather than the find bar's `SearchQuery` cursor, which walks character by character to support case
 * folding this rule never uses: on 10,000 lines the cursor cost ~47 ms per selection change against
 * SC-005's 100 ms (049 T035). The word boundary is applied here too, not through CodeMirror's
 * `wholeWord`, which takes its word definition from an editor state's categoriser — FR-015 fixes the
 * definition: a word character is a letter, digit or underscore, and nothing else.
 */
import type { Text } from '@codemirror/state';
import type { Match } from './match-model.js';

/** A selection worth tinting the occurrences of. */
export interface OccurrenceQuery {
  term: string;
  /** Only occurrences that also start and end at word boundaries count. */
  wholeWord: boolean;
}

/** The shortest selection that tints anything (FR-015). */
const MIN_OCCURRENCE_LENGTH = 2;

const WORD_CHAR = /[\p{L}\p{N}_]/u;

/** FR-015's word character: a letter (any script), a digit or an underscore. */
export function isWordChar(ch: string): boolean {
  return WORD_CHAR.test(ch);
}

/** True when `ch` is a boundary: a non-word character, or no character at all (a line or document end). */
const isBoundary = (ch: string): boolean => ch.length === 0 || !isWordChar(ch);

/**
 * The query a selection of `text.slice(from, to)` makes, or `null` when it tints nothing: empty,
 * whitespace-only, shorter than two characters, or spanning a line break. `text` is the text around the
 * selection — at least the selection's line — so the characters either side of it can be read.
 */
export function occurrenceQuery(text: string, from: number, to: number): OccurrenceQuery | null {
  const term = text.slice(from, to);
  if (term.length < MIN_OCCURRENCE_LENGTH || term.trim().length === 0 || /[\r\n]/.test(term)) return null;
  const wholeWord =
    isWordChar(term[0]!) &&
    isWordChar(term[term.length - 1]!) &&
    isBoundary(text.charAt(from - 1)) &&
    isBoundary(text.charAt(to));
  return { term, wholeWord };
}

/**
 * Every other occurrence of the query in `doc`, in document order, excluding `selection` itself. With
 * `within`, only occurrences overlapping those ranges (an editor's visible ranges), in ascending order.
 *
 * `doc` is an editor's `Text`, or a plain string — a preview's rendered text model is already one, and
 * wrapping it in a `Text` would copy the whole document on every draw for nothing.
 */
export function occurrenceMatches(
  source: Text | string,
  query: OccurrenceQuery,
  selection: { from: number; to: number },
  within?: readonly { from: number; to: number }[],
): Match[] {
  const doc: Sliceable =
    typeof source === 'string'
      ? { length: source.length, sliceString: (from, to) => source.slice(from, to) }
      : source;
  const { term, wholeWord } = query;
  const out: Match[] = [];
  let last = -1;
  // One window per range, widened by a character each side beyond the term so a match straddling the
  // range's edge is found AND its boundary characters can be read.
  const windows = within ?? [{ from: 0, to: doc.length }];
  for (const r of windows) {
    const start = Math.max(0, r.from - term.length);
    const text = doc.sliceString(start, Math.min(doc.length, r.to + term.length));
    for (let i = text.indexOf(term); i !== -1; i = text.indexOf(term, i + 1)) {
      const from = start + i;
      const to = from + term.length;
      if (to <= r.from || from >= r.to) continue; // outside the range proper
      if (from <= last) continue; // adjacent ranges can meet the same match twice
      if (from === selection.from && to === selection.to) continue;
      if (wholeWord && !(isBoundaryAt(text, start, from - 1, doc) && isBoundaryAt(text, start, to, doc))) continue;
      out.push({ from, to });
      last = from;
    }
  }
  return out;
}

/** The two things the scan reads from a document, whichever form it arrives in. */
interface Sliceable {
  readonly length: number;
  sliceString(from: number, to: number): string;
}

/** Whether document offset `pos` is a boundary, read from `text` (which starts at `start`) where it can be. */
function isBoundaryAt(text: string, start: number, pos: number, doc: Sliceable): boolean {
  if (pos < 0 || pos >= doc.length) return true;
  const i = pos - start;
  return isBoundary(i >= 0 && i < text.length ? text.charAt(i) : doc.sliceString(pos, pos + 1));
}

/**
 * FR-013, stated once: where a range is both a search match and an occurrence, the search match is
 * painted and the occurrence is not — the two are never layered. Drops every occurrence that overlaps
 * any search match (touching at an edge is not overlapping). Both lists are in document order.
 */
export function withoutSearchMatches(occurrences: readonly Match[], searchMatches: readonly Match[]): Match[] {
  if (searchMatches.length === 0) return [...occurrences];
  const out: Match[] = [];
  let i = 0;
  for (const o of occurrences) {
    while (i < searchMatches.length && searchMatches[i]!.to <= o.from) i++;
    const s = searchMatches[i];
    if (s !== undefined && s.from < o.to) continue;
    out.push(o);
  }
  return out;
}
