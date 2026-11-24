# Research: Preferences grouping and ranked search

## R1 — Where the ranked order is applied

- **Decision**: `filterFields` returns matches already in **display order**. The flat list is sorted
  by (section rank, section name), (subgroup rank, subgroup name), (subsection rank, subsection name),
  field rank and registry index. Fields with no subgroup sort with their section's own rank keys.
- **Rationale**: All three tabs pass `filterFields`' result to `groupDescriptors`, which builds
  sections, subgroups and subsections in **first-appearance order** and already draws a section's own
  fields before its subgroups (040 FR-036b). A list sorted as above makes first appearance equal rank
  order, so FR-007–FR-009 hold without touching the grouping helper or the three tabs.
- **Alternatives considered**: giving `groupDescriptors` a comparator, which adds an options parameter
  its own header argues against. Ranking in each tab was rejected under FR-012.

## R2 — Rank representation

- **Decision**: `SearchRank = { tier: 0..5, exact: 0..4 }`, compared lexicographically, with registry
  index as the final key. A section's rank is the minimum over its fields.
- **Rationale**: Two small integers are easy to read in test failures. "Tier dominates exactness"
  (FR-005) falls out of lexicographic comparison.

## R3 — Word boundary

- **Decision**: a token is at a word boundary when its occurrence starts the text or follows a
  character that is not a letter or a digit (Unicode `\p{L}\p{N}`). Camel-case humps are not
  boundaries.
- **Rationale**: Matches #270's `to ⊂ Auto` example. Labels are prose, so camel case only occurs in
  keys, and a key hit already ranks in the name tier.

## R4 — The group tier's text

- **Decision**: the heading path, meaning group, subgroup and subsection joined by single spaces.
- **Rationale**: Typing `editor syntax` reads one heading path, and should land in the group tier, not
  the split tier. Before #319 that text was one group string (`Editor · Syntax`). After it, the path
  reproduces it. The `·` separator never mattered to matching, because tokens split on whitespace.

## R5 — Theme placement

- **Decision**: a private `placementForToken(key)` returns `{ group, subgroup?, subsection? }`, and
  `descriptorForThemeToken` spreads it. `areaForToken` stays exported, returns only the **area**
  (the group), and keeps its `undefined` for unplaced tokens. The sort replaces `parentArea(group)`
  with `group` and `BUTTON_GROUP_ORDER`'s string keys with a subgroup and subsection order:
  `Buttons` subsection order `Confirm, Cancel, Destroy`, and every other tie stays alphabetical.
- **Rationale**: Every descriptor's `group` is now an area, so the guard's `parentArea` split is
  redundant. Keeping `areaForToken`'s name and contract avoids churn in its one public use, the
  guard tests.
- **Row order proof**: today's sort is (area index, group string with the button rank, token index).
  The new sort is (area index, subgroup (none first, then alphabetical, Buttons fixed), subsection
  (none first, then Confirm/Cancel/Destroy), token index). Each old group string maps to exactly one
  new path in the same relative position: `Editor` before `Editor · Syntax` becomes own-tokens before
  subgroup `Syntax`, and the same holds for File Explorer, Markdown preview and General. A unit test
  snapshots the key order before and after (SC-005).

## R6 — Settings tab form-history row (067 FR-130)

- **Decision**: when the query names the clear control and its anchor row was not matched, the anchor
  field is added to the ranked list at the split tier (the weakest rank), and the list is re-ordered
  by the same core function. It does not fall back to `metadata.filter`.
- **Rationale**: `metadata.filter` reorders the result to registry order, which would undo the
  ranking for that query.

## R7 — Fold state

- **Decision**: no migration. Old keys such as `["Editor · Syntax"]` stop matching a heading and are
  ignored and pruned (056 FR-011a). The new headings open at their defaults: a subgroup or subsection
  starts unfolded (056 FR-016).
- **Rationale**: This is UI state, not configuration. 056 designed the prune for exactly this case.
