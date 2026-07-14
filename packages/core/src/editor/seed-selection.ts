/**
 * What a selection seeds the find input with (013 FR-002b, extended by 016 FR-025i).
 *
 * 013's rule was written when a selection was one range: seed from a **non-empty, single-line**
 * selection, and from nothing else. This feature introduced two selections that rule never
 * anticipated — a rectangular block, and a multi-cursor set — and the natural way to retrofit them
 * is the wrong one: read `selection.main` and seed from that. It compiles, it looks right, and it
 * picks ONE ROW OF A TEN-ROW BLOCK to search for, arbitrarily, because "main" is wherever the head
 * of the drag happened to end.
 *
 * So the rule is extended by its own logic rather than by convenience: seed only from an
 * **unambiguous single line of text**. One non-empty fragment, on one line, or nothing at all.
 *
 *   • an ordinary single-line selection — seeds (unchanged);
 *   • a ONE-ROW block — seeds: it *is* a single-line selection, and nothing distinguishes it;
 *   • a MULTI-ROW block — seeds nothing: there is no single term, and any choice among its rows
 *     would be arbitrary;
 *   • a multi-cursor set with more than one non-empty selection — seeds nothing, for the same
 *     reason;
 *   • bare carets, or an empty selection — seeds nothing (unchanged).
 *
 * Seeding nothing is not a failure: find opens with the term it had before, which is what 013
 * already does for a multi-line selection.
 */
export function seedFromSelections(texts: readonly string[]): string {
  const nonEmpty = texts.filter((text) => text.length > 0);
  if (nonEmpty.length !== 1) return '';

  const [only] = nonEmpty;
  // A multi-line fragment is a block of text, not a search term (013 FR-002b).
  if (only.includes('\n') || only.includes('\r')) return '';
  return only;
}
