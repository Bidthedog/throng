# Contract: theme token area groups

**Module**: `@throng/core` — `packages/core/src/config/theme-metadata.ts`

## Exports (new / changed)

```ts
/** The closed, ordered set of Themes-editor area groups (General first, Icons last). */
export const THEME_AREA_GROUPS: readonly string[];

/**
 * The area a token belongs to (the parent area for a "Parent · Child" sub-group), by EXPLICIT rule.
 * Returns undefined for a token no rule places — there is no silent default. `descriptorForThemeToken`
 * turns that undefined into the sentinel group "(unassigned)", which is outside THEME_AREA_GROUPS.
 */
export function areaForToken(key: string): string | undefined;

/** Throws, naming every descriptor whose area (part before " · ") is outside THEME_AREA_GROUPS. */
export function assertThemeAreaGroups(registry: MetadataRegistry): void;
```

## Behaviour

- `descriptorForThemeToken(key).group` returns the **area** group (`areaForToken(key)`), not a type
  group. `colours.appBg` → `General`; `colours.editorGutterBg` → `Editor`; `colours.syntaxKeyword` →
  `Editor · Syntax`; `colours.terminalFg` → `Terminal`; `icons.*` → `Icons`.
- `THEME_METADATA` (= `buildThemeMetadata(THRONG_THEME)`) is ordered so that iterating it yields areas
  in `THEME_AREA_GROUPS` order, `Editor` before `Editor · Syntax`, tokens within an area in theme order.
- `assertThemeAreaGroups(THEME_METADATA)` does not throw. `assertThemeAreaGroups([{…, group:'Nope'}])`
  throws an `Error` whose message contains the offending key and `Nope`.
- `areaForToken('colours.somethingNobodyMapped')` returns `undefined`; the derived descriptor's group
  is then the sentinel `"(unassigned)"`, so `assertThemeAreaGroups` throws naming that key (SC-003 — a
  new, unassigned token fails the build; there is no silent default into General).
- Exactly-one-group is structural (each descriptor has one `group`); combined with
  `assertEveryKeyDescribed(themeEditableTokens(THRONG_THEME), THEME_METADATA)` (unchanged) and the
  explicit-or-sentinel assignment, this is the FR-005/FR-006/FR-009 guarantee.

## Non-goals / invariants

- No theme value changes; `THRONG_THEME` and every bundled theme file are untouched (FR-011/FR-012).
- No token added/removed/renamed (FR-010). Only the `group` field of derived descriptors changes.
