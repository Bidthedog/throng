# Contract: Foldable Preferences headings (056)

Binding on the Settings, Key Bindings and Themes tabs alike (FR-013). It **replaces rule 3** of
`specs/040-editor-status-bar-and-gutter/contracts/metadata.md` ("A subsection is not collapsible"); 040's
rules 1, 2, 4, 5 and 6 still hold.

## Rendering rules

| # | Rule | Source |
|---|---|---|
| F1 | Every section, subgroup and nested subsection renders through `FoldHeading`: `<hN>` (3, 4, 5) containing one `<button type="button">` with `aria-expanded` and `aria-controls` pointing at the content container | FR-001, FR-002, FR-005 |
| F2 | The button shows, in order: the `chevron` icon (rotated when open), the heading name, the count label, and — only when folded and something inside is invalid — the `warning` icon | FR-006, FR-007 |
| F3 | The content container keeps its children mounted; folded = `hidden` attribute set | FR-003, FR-004, FR-007 |
| F4 | The group element keeps its accessible name (`role="group"` + `aria-labelledby` on the heading) | FR-005 |
| F5 | Folding does not cascade: a descendant keeps its own state | FR-003 |
| F6 | Count label: `formatGrouped(total)`; under an active search `"<matches> of <total>"` | FR-006 |
| F7 | The warning icon has hover title and accessible name "Contains an invalid entry" | FR-007 |

## Test ids

Existing ids are unchanged (`settings-group-<group>`, `<tab>-subgroup-<group>-<subgroup>`,
`<tab>-subsection-…`). New ids, suffixed to the element's existing id `<id>`:

| Element | Test id |
|---|---|
| Heading button | `<id>-toggle` |
| Count | `<id>-count` |
| Warning marker | `<id>-invalid` |
| Expand All | `<tab>-expand-all` (`settings`, `keybindings`, `themes`) |
| Collapse All | `<tab>-collapse-all` |

## Toolbar

| Control | Token | Title | Disabled when |
|---|---|---|---|
| Expand All | `expandAll` | Expand All Sections | the search box has text |
| Collapse All | `collapseAll` | Collapse All Sections | the search box has text |

Both sit immediately after the search box's clear control, in that order.

## Behaviour

| Input | Outcome |
|---|---|
| Click on the heading button, or Enter / Space while it has focus | Toggle that heading |
| Expand All | Every heading in the tab unfolded |
| Collapse All | Every heading in the tab folded (only top-level headings remain visible) |
| Search applied | Every rendered heading unfolded; toggles go to the transient set |
| Search cleared | Persisted state renders again; transient set discarded |
| Tab mounts | Persisted state read; no state → all unfolded *(superseded by FR-016, Session 2026-10-15: no recorded choice → sections folded, subgroups/subsections unfolded; all unfolded only under the `foldDefault=open` test seam)* |
