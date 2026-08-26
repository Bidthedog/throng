/**
 * Settings typeahead search (feature 007, FR-049). Pure — zero OS/DOM.
 *
 * The query is split on whitespace into tokens; a field qualifies when **any**
 * token is a case-insensitive substring of its key, label, description, its
 * **group** (021 — so a section name returns the whole section), its **subgroup**
 * (040 — the same, for a subsection), or its current
 * value. OR semantics (unlike the font typeahead's AND, {@link
 * matchFamilies}) so that typing several loosely-remembered words widens rather
 * than narrows the result — the user is recalling a setting, not filtering a
 * known list. An empty query matches every field.
 */
import type { FieldDescriptor } from './metadata.js';

/** The searchable text of an editor field. {@link FieldDescriptor} satisfies it. */
export interface SearchableField {
  key: string;
  label: string;
  description: string;
  /**
   * The section (group) the field sits under (021, FR-015). Optional: a field with no group — e.g.
   * the Themes tab's icon-pack row — still satisfies the interface and simply contributes nothing to
   * the group half of the haystack. When present it makes the field findable by its SECTION name, so
   * typing a group name returns the whole section (nested "Parent · Child" sub-groups included, since
   * the match is a substring — "editor" ⊂ "Editor · Syntax").
   */
  group?: string;
  /**
   * The subsection the field sits under, inside its group (040, FR-036). Optional and searched on
   * exactly the same terms as {@link group}, because it obeys the same invariant: **a heading the
   * user can read is a heading the user can search by.**
   *
   * 040 made that invariant load-bearing rather than incidental. A subgroup renders as a visible
   * `<h4>`, and a heading that returns "No settings match" while its own words are on screen is the
   * search telling the user something untrue. The one subgroup shipped today (`Status Bar`) would
   * appear to work without this — "status" and "bar" happen to be substrings of its fields' keys —
   * which is precisely why the omission was invisible and why the field is modelled here rather
   * than left to luck.
   */
  subgroup?: string;
}

/** Split a query into lowercase tokens, discarding whitespace runs. */
export function searchTokens(query: string): string[] {
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 0);
}

/** Render any config value as searchable text (arrays and objects flattened). */
function renderValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.map(renderValue).join(' ');
  if (typeof value === 'object') return Object.values(value as object).map(renderValue).join(' ');
  return String(value);
}

/**
 * The lowercased text a field is searched against: key + label + description + group + subgroup +
 * value. Both heading levels are in it for the same reason — see {@link SearchableField.subgroup}.
 */
export function fieldHaystack(field: SearchableField, value: unknown): string {
  return `${field.key} ${field.label} ${field.description} ${field.group ?? ''} ${field.subgroup ?? ''} ${renderValue(value)}`.toLowerCase();
}

/** True when any query token appears in the field's haystack (blank query → true). */
export function matchesQuery(query: string, field: SearchableField, value: unknown): boolean {
  const tokens = searchTokens(query);
  if (tokens.length === 0) return true;
  const hay = fieldHaystack(field, value);
  return tokens.some((t) => hay.includes(t));
}

/**
 * The fields matching `query`, in registry order. `valueOf` supplies each
 * field's current value so the search can reach values without this module
 * knowing the shape of the document holding them.
 */
export function filterFields<T extends SearchableField>(
  query: string,
  fields: readonly T[],
  valueOf: (field: T) => unknown,
): T[] {
  const tokens = searchTokens(query);
  if (tokens.length === 0) return [...fields];
  return fields.filter((f) => {
    const hay = fieldHaystack(f, valueOf(f));
    return tokens.some((t) => hay.includes(t));
  });
}

/** Narrowing alias for the settings registry's descriptor type. */
export type SearchableDescriptor = FieldDescriptor & SearchableField;
