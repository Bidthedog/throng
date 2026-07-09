/**
 * CSS font-family stack ⇄ pill-list conversion (feature 007, H4 — FR-038b). The
 * font control renders a stack (e.g. `"Segoe UI", system-ui, sans-serif`) as
 * ordered, deletable pills; these pure helpers parse the saved theme value into
 * pills and serialise the pills back to the comma-separated string. No OS/DOM.
 */

/** Strip a single pair of matching surrounding quotes from a family name. */
function stripQuotes(s: string): string {
  if (s.length >= 2) {
    const q = s[0];
    if ((q === "'" || q === '"') && s[s.length - 1] === q) return s.slice(1, -1).trim();
  }
  return s;
}

/**
 * Parse a CSS font-family stack into its ordered family names: split on commas,
 * trim each, strip matching surrounding quotes, and drop empty entries. Tolerant
 * of a non-string / empty value (returns `[]`).
 */
export function parseFontStack(value: string): string[] {
  if (typeof value !== 'string') return [];
  return value
    .split(',')
    .map((part) => stripQuotes(part.trim()))
    .filter((family) => family.length > 0);
}

/**
 * Serialise an ordered family list to a CSS font-family stack: drop empties,
 * single-quote any family containing whitespace or a comma (so it is a valid
 * CSS identifier list), and join with `, `.
 */
export function serializeFontStack(families: readonly string[]): string {
  return families
    .map((family) => family.trim())
    .filter((family) => family.length > 0)
    .map((family) => (/[\s,]/.test(family) ? `'${family}'` : family))
    .join(', ');
}
