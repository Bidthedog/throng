# Contract: `@throng/core` settings search

Module: `packages/core/src/config/settings-search.ts`. Pure; no OS or DOM.

## Matching

- `searchTokens(query)`: unchanged. It lowercases the query and splits it on whitespace, discarding
  empties.
- `matchesQuery(query, field, value) → boolean`: **every** token is a substring of
  `fieldHaystack(field, value)`. A blank query → `true`.
- `fieldHaystack`: unchanged. It joins key, label, description, group, subgroup, subsection and the
  rendered value.

## Ranking

- `rankField(query, field, value) → SearchRank | undefined`: `undefined` when the field does not match
  or the query is blank. Otherwise it returns the best tier and exactness, per data-model.md.
  - **Texts per tier**: name = label, plus the key only when the query equals it; subgroup = subgroup, and
    subsection (the better); value = the rendered value; description; group = the heading path joined
    by spaces; split = the haystack.
  - **Exactness** is computed on lowercased text with whitespace runs collapsed. The phrase is the
    tokens joined by one space.

## Display order

- `filterFields(query, fields, valueOf) → T[]`
  - Blank query → `[...fields]` (registry order, unchanged).
  - Otherwise → only the matching fields, ordered by section (best member rank, then section name A→Z),
    then within it the section's own fields first, then subgroups (best member rank, then name A→Z),
    then within those the subgroup's own fields first, then subsections (same rule), and finally by
    field rank and registry index.
- `orderRanked(entries: { field, rank, index }[]) → T[]`: the same ordering, exported for a caller
  that adds a field of its own (the Settings tab's FR-130 row).

## Must not change

- A blank query lists every field in registry order (FR-003).
- Every tab and the Themes icon-pack row call these functions; none re-implements them (FR-012).
