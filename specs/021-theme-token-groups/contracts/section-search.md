# Contract: section-name search

**Module**: `@throng/core` — `packages/core/src/config/settings-search.ts`

## Change

```ts
export interface SearchableField {
  key: string;
  label: string;
  description: string;
  group?: string;   // NEW — optional so group-less callers (e.g. the icon-pack row) still satisfy it
}

// fieldHaystack now includes the group:
//   `${key} ${label} ${description} ${group ?? ''} ${renderedValue}`.toLowerCase()
```

`matchesQuery` and `filterFields` both build their haystack via `fieldHaystack`, so both gain
section-name matching with no further change.

## Behaviour (FR-015 / FR-016 / FR-017)

- **Union**: a field matches if any query token is a substring of key/label/description/**group**/value.
  Name matches still work exactly as before; group matches are additive.
- **Whole section**: because every field in a section carries that section's `group` string, a query
  matching the group name matches **every** field in it — even fields whose own name/description/value
  do not contain the query.
- **Sub-groups**: a field in `Editor · Syntax` has `group === 'Editor · Syntax'`, which contains
  `"editor"`, so the query `editor` returns it too (nested inclusion, FR-016).
- **Both tabs**: the Themes tab (`THEME_TOKEN_FIELDS`/`THEME_ICON_FIELDS`) and the Settings tab
  (`SETTINGS_METADATA`) both pass `FieldDescriptor`s (which have `group`) to `filterFields`, so both
  get section search (FR-017). No theme/settings **data** changes.
- **Case-insensitive substring**, unchanged (query and haystack both lowercased).

## Invariants / tests

- `fieldHaystack({…, group:'Editor · Syntax'}, v)` contains `editor · syntax`.
- `filterFields('editor', fields, valueOf)` returns every field whose group is `Editor` or
  `Editor · Syntax`, plus any whose name/value contains `editor` — de-duplicated (a field appears once).
- A group-less field (`group` undefined) behaves exactly as today (no throw, group contributes nothing).
