/**
 * Font-family typeahead matcher (feature 007, FR-038b). Pure. The query is split
 * on whitespace into tokens; a family qualifies only if EVERY token is a
 * case-insensitive substring of its name (order-independent). An empty query
 * returns all families. Used by the Themes font picker over the cached installed
 * families (or the curated fallback). No OS/DOM.
 */
export function matchFamilies(query: string, families: readonly string[]): string[] {
  const tokens = query.toLowerCase().split(/\s+/).filter((t) => t.length > 0);
  if (tokens.length === 0) return [...families];
  return families.filter((family) => {
    const lower = family.toLowerCase();
    return tokens.every((t) => lower.includes(t));
  });
}
