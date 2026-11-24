/**
 * Preferences typeahead search, shared by the Settings, Key Bindings and Themes tabs (007 FR-049, as
 * superseded by 079 FR-001–FR-012). Pure — zero OS/DOM.
 *
 * ══ MATCHING: EVERY WORD (079 FR-001) ══
 *
 * The query is split on whitespace into tokens; a field qualifies when **every** token is a
 * case-insensitive substring of its key, label, description, its **group** (021 — so a section name
 * returns the whole section), its **subgroup** and **subsection** (040, 054 — the same, for the lower
 * headings), or its current value. An empty query matches every field.
 *
 * 007 chose OR — extra words widened the net, on the theory that the user recalls a setting from
 * half-remembered words. That held for two loose words and failed at three precise ones: typing a
 * setting's full name, the strongest signal there is, buried it under three OR-widened sets. 079 FR-020
 * reverses it: ranking (below) serves 007's goal better, because a loose query still finds the field and
 * a precise one now puts it first.
 *
 * ══ RANKING (079 FR-004–FR-010) ══
 *
 * {@link rankField} scores a match `{ tier, exact }`, lower is better: the first single text that holds
 * every token (name, sub-heading, value, description, heading path, or only the whole haystack), then
 * how well the query fits it. {@link filterFields} returns matches in DISPLAY order — sections by their
 * best member (A→Z on a tie), own fields before sub-headings, sub-headings by the same rule — so the
 * tabs' first-appearance grouping (`groupDescriptors`) draws the ranked order without knowing about it.
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
   * typing a group name returns the whole section, its subgroups and subsections included.
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
  /** 054 FR-050a — the third heading level, searched on the same terms for the same reason. */
  subsection?: string;
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
  return `${field.key} ${field.label} ${field.description} ${field.group ?? ''} ${field.subgroup ?? ''} ${field.subsection ?? ''} ${renderValue(value)}`.toLowerCase();
}

/** True when every query token appears in the field's haystack (blank query → true). 079 FR-001. */
export function matchesQuery(query: string, field: SearchableField, value: unknown): boolean {
  const tokens = searchTokens(query);
  if (tokens.length === 0) return true;
  const hay = fieldHaystack(field, value);
  return tokens.every((t) => hay.includes(t));
}

/**
 * How well a field matched (079 data-model "SearchRank"); lower is better on both axes.
 *
 * `tier`: 0 name (label or key) · 1 sub-heading (subgroup or subsection) · 2 value · 3 description ·
 * 4 group (the heading path read as one text) · 5 split (only the whole haystack holds every token).
 *
 * `exact`: 0 the text equals the query · 1 phrase at the start · 2 phrase anywhere · 3 every token at a
 * word boundary · 4 some token only mid-word.
 */
export interface SearchRank {
  tier: number;
  exact: number;
}

export const SPLIT_TIER = 5;

/** Tier first — it dominates exactness (079 FR-005) — then exactness. */
export function compareRank(a: SearchRank, b: SearchRank): number {
  return a.tier - b.tier || a.exact - b.exact;
}

/** Lowercase, whitespace runs collapsed to one space, trimmed (079 FR-006). */
function normalise(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

const WORD_CHAR = /[\p{L}\p{N}]/u;

/** True when some occurrence of `token` starts the text or follows a non-letter, non-digit (research R3). */
function atWordBoundary(text: string, token: string): boolean {
  for (let i = text.indexOf(token); i >= 0; i = text.indexOf(token, i + 1)) {
    if (i === 0 || !WORD_CHAR.test(text[i - 1])) return true;
  }
  return false;
}

/** The exactness rung of `text` for the query, or undefined when the text does not hold every token. */
function exactness(text: string, tokens: readonly string[], phrase: string): number | undefined {
  const t = normalise(text);
  if (t === '' || !tokens.every((tok) => t.includes(tok))) return undefined;
  if (t === phrase) return 0;
  if (t.startsWith(phrase)) return 1;
  if (t.includes(phrase)) return 2;
  return tokens.every((tok) => atWordBoundary(t, tok)) ? 3 : 4;
}

/** The best rung across a tier's texts. */
function bestExactness(texts: readonly (string | undefined)[], tokens: readonly string[], phrase: string): number | undefined {
  let best: number | undefined;
  for (const text of texts) {
    if (!text) continue;
    const e = exactness(text, tokens, phrase);
    if (e !== undefined && (best === undefined || e < best)) best = e;
  }
  return best;
}

/**
 * The rank of one field for `query` (079 FR-004), or undefined when it does not match or the query is
 * blank. Tier texts, best first: name (label, key) · sub-heading (subgroup, subsection) · value ·
 * description · heading path (group, subgroup, subsection joined) · the whole haystack.
 */
export function rankField(query: string, field: SearchableField, value: unknown): SearchRank | undefined {
  const tokens = searchTokens(query);
  if (tokens.length === 0) return undefined;
  const phrase = tokens.join(' ');
  const headingPath = [field.group, field.subgroup, field.subsection].filter(Boolean).join(' ');
  // The key is a name only when the query IS the key: a dotted key is typed whole or not at all, and
  // every `terminals.*` key starting with "terminal" must not tie with a label that really does. Any
  // other key hit still admits the field, through the whole haystack (the split tier).
  const keyIsTheQuery = normalise(field.key) === phrase ? field.key : undefined;
  const tiers: (readonly (string | undefined)[])[] = [
    [field.label, keyIsTheQuery],
    [field.subgroup, field.subsection],
    [renderValue(value)],
    [field.description],
    [headingPath],
    [fieldHaystack(field, value)],
  ];
  for (let tier = 0; tier < tiers.length; tier++) {
    const exact = bestExactness(tiers[tier], tokens, phrase);
    if (exact !== undefined) return { tier, exact };
  }
  return undefined;
}

/** One matched field with its rank and its registry index (the final tie-break). */
export interface RankedEntry<T extends SearchableField> {
  field: T;
  rank: SearchRank;
  index: number;
}

/** Best rank per key, over the entries `keyOf` places under it. */
function bestBy<T extends SearchableField>(
  entries: readonly RankedEntry<T>[],
  keyOf: (e: RankedEntry<T>) => string,
): Map<string, SearchRank> {
  const best = new Map<string, SearchRank>();
  for (const e of entries) {
    const k = keyOf(e);
    const cur = best.get(k);
    if (!cur || compareRank(e.rank, cur) < 0) best.set(k, e.rank);
  }
  return best;
}

/**
 * Ranked entries in DISPLAY order (079 FR-007–FR-009): sections by their best member, A→Z on a tie;
 * within a section its own fields first, then subgroups by the same rule; within a subgroup its own
 * fields first, then subsections by the same rule; at the bottom, field rank then registry index.
 * Exported for a caller that adds a field of its own to a ranked result (the Settings tab's 067 FR-130
 * row, research R6).
 */
export function orderRanked<T extends SearchableField>(entries: readonly RankedEntry<T>[]): T[] {
  const g = (e: RankedEntry<T>): string => e.field.group ?? '';
  const sg = (e: RankedEntry<T>): string => JSON.stringify([g(e), e.field.subgroup || '']);
  const ss = (e: RankedEntry<T>): string => JSON.stringify([g(e), e.field.subgroup || '', e.field.subsection || '']);
  const groupBest = bestBy(entries, g);
  const subgroupBest = bestBy(entries, sg);
  const subsectionBest = bestBy(entries, ss);
  // A heading's own fields come before its sub-headings: "no sub-heading" sorts first at its level.
  const level = (
    a: RankedEntry<T>,
    b: RankedEntry<T>,
    nameOf: (e: RankedEntry<T>) => string,
    keyOf: (e: RankedEntry<T>) => string,
    best: Map<string, SearchRank>,
  ): number => {
    const na = nameOf(a);
    const nb = nameOf(b);
    if (na === nb) return 0;
    if (na === '') return -1;
    if (nb === '') return 1;
    return compareRank(best.get(keyOf(a))!, best.get(keyOf(b))!) || na.localeCompare(nb);
  };
  return [...entries]
    .sort((a, b) => {
      if (g(a) !== g(b)) return compareRank(groupBest.get(g(a))!, groupBest.get(g(b))!) || g(a).localeCompare(g(b));
      return (
        level(a, b, (e) => e.field.subgroup || '', sg, subgroupBest) ||
        level(a, b, (e) => e.field.subsection || '', ss, subsectionBest) ||
        compareRank(a.rank, b.rank) ||
        a.index - b.index
      );
    })
    .map((e) => e.field);
}

/**
 * The fields matching `query`, best first in display order ({@link orderRanked}); a blank query returns
 * every field in registry order, unchanged (079 FR-003). `valueOf` supplies each field's current value
 * so the search can reach values without this module knowing the shape of the document holding them.
 */
export function filterFields<T extends SearchableField>(
  query: string,
  fields: readonly T[],
  valueOf: (field: T) => unknown,
): T[] {
  if (searchTokens(query).length === 0) return [...fields];
  const entries: RankedEntry<T>[] = [];
  fields.forEach((field, index) => {
    const rank = rankField(query, field, valueOf(field));
    if (rank) entries.push({ field, rank, index });
  });
  return orderRanked(entries);
}

/** Narrowing alias for the settings registry's descriptor type. */
export type SearchableDescriptor = FieldDescriptor & SearchableField;
