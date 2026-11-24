# Contract: theme registry grouping

Module: `packages/core/src/config/theme-metadata.ts`.

- `descriptorForThemeToken(key)` sets `group` to the area, and sets `subgroup` / `subsection` per
  data-model.md. No `group` contains ` · ` (FR-013).
- `areaForToken(key)` returns the **area only** (`'Editor'` for `colours.syntaxKeyword`, and
  `'General'` for `colours.confirmButtonBg`), or `undefined` for an unplaced token.
- `buildThemeMetadata(theme)` orders descriptors by area index, then subgroup (none first, then
  alphabetical), then subsection (none first, then `Confirm`, `Cancel`, `Destroy` within `Buttons`,
  alphabetical elsewhere), then theme-declared token order. The resulting key order equals today's
  (FR-015, SC-005).
- `assertThemeAreaGroups` rejects a descriptor whose `group` is not in `THEME_AREA_GROUPS` (FR-018).
- `THEME_AREA_GROUPS`: unchanged.

## Rendered headings (Themes tab)

| Before (section test id) | After |
|---|---|
| `settings-group-Editor · Syntax` | section `Editor`, subgroup heading `themes-subgroup-Syntax` |
| `settings-group-General · Buttons` | section `General`, subgroup `Buttons` |
| `settings-group-General · Buttons · Confirm` (Cancel, Destroy) | subsection `Confirm` (Cancel, Destroy) inside `Buttons` |
| `settings-group-File Explorer · File Icons` | section `File Explorer`, subgroup `File Icons` |
| `settings-group-Markdown preview · Callouts` | section `Markdown preview`, subgroup `Callouts` |

The exact subgroup and subsection test-id shapes are whatever `subsection.tsx` already emits for
`testIdPrefix="themes-subgroup"`. Tests read them from there rather than restating them.
