# Data model: Preferences grouping and ranked search

No persisted data changes. These are the in-memory shapes.

## SearchableField (existing, unchanged)

`key`, `label`, `description`, `group?`, `subgroup?`, `subsection?`. The current value comes from
the caller's `valueOf`.

## SearchRank (new)

| Field | Values | Meaning |
|---|---|---|
| `tier` | 0 name (label, or the key when the query equals it) · 1 subgroup (subgroup or subsection) · 2 value · 3 description · 4 group (heading path) · 5 split | The first single text that holds every token (spec FR-004.1) |
| `exact` | 0 equals · 1 phrase at start · 2 phrase anywhere · 3 every token at a word boundary · 4 some token mid-word | How the query fits that text (FR-004.2) |

Comparison: `tier`, then `exact`, then registry index. Lower is better. A field that does not match
has no rank.

## Theme descriptor placement (changed)

| Token family | group | subgroup | subsection |
|---|---|---|---|
| `colours.syntax*` | Editor | Syntax | — |
| `typography.button.*`, `colours.iconButtonSurface` | General | Buttons | — |
| `colours.confirmButton*` | General | Buttons | Confirm |
| `colours.cancelButton*` | General | Buttons | Cancel |
| `colours.destroyButton*` | General | Buttons | Destroy |
| `colours.fileIcon*` | File Explorer | File Icons | — |
| `colours.callout*` | Markdown preview | Callouts | — |
| everything else | its area, as today | — | — |

Invariant: no theme descriptor's `group` contains ` · `, and `group ∈ THEME_AREA_GROUPS` or the
unassigned sentinel.
