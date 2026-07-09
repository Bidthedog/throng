/**
 * Settings typeahead search (feature 007, FR-049). Pure — zero OS/DOM.
 *
 * The query is split on whitespace into tokens; a field qualifies when **any**
 * token is a case-insensitive substring of its key, label, description, or its
 * current value. OR semantics (unlike the font typeahead's AND, {@link
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

/** The lowercased text a field is searched against: key + label + description + value. */
export function fieldHaystack(field: SearchableField, value: unknown): string {
  return `${field.key} ${field.label} ${field.description} ${renderValue(value)}`.toLowerCase();
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
