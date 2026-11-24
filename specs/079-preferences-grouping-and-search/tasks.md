# Tasks: Preferences grouping and ranked search

**Input**: `specs/079-preferences-grouping-and-search/` (spec.md, plan.md, research.md, data-model.md,
contracts/, quickstart.md)

**Tests**: required. Principle V (test-first) is non-negotiable here: each implementation task follows
a failing test written and run first.

## Phase 1: Setup

None. Only existing files and the existing test projects are involved.

## Phase 2: Foundational

None. US1 and US2 touch different modules and can land in either order. US2's search scenario
(acceptance 4) relies on US1's subgroup tier only for *rank*. Inclusion works either way.

## Phase 3: User Story 1 — The best match comes first (P1)

**Goal**: AND matching plus ranking in the shared search module, rendered in rank order by all three
tabs.

**Independent test**: in Key Bindings, `go to line` puts **Go To Line** first. The unit suite covers
the ladder.

- [x] T001 [US1] Write failing unit tests in `packages/core/tests/unit/settings-search.test.ts`. Invert the OR cases to AND (FR-001, FR-002). Add `rankField` cases for every tier (name via label and via key, subgroup and subsection, value, description, group heading path, split) and every exactness rung (equals, phrase at start, phrase anywhere, word boundary, mid-word `to ⊂ Auto`). Cover tier dominating exactness (FR-005), whitespace collapsing (FR-006), and the #270 worked examples (`go to line`, `Go to` excluding **Go Away**, `line`). Cover `filterFields` display order: sections by best member then A→Z, own fields before subgroups, subgroups and subsections by the same rule, never split (FR-007–FR-009). Cover a section name returning the whole section, ranked in the group tier (FR-010). Cover the blank and whitespace-only query returning registry order (FR-003), and the subset property over the real `SETTINGS_METADATA` (SC-003). For every pair of consecutive words `a b` in every label, `filterFields('a b') ⊆ filterFields('a')`. Run the file and confirm each new case fails for the stated reason.
- [x] T002 [US1] Implement in `packages/core/src/config/settings-search.ts`. Switch `matchesQuery` and `filterFields` to `every`. Add `SearchRank`, `rankField` and `orderRanked` per `contracts/search-ranking.md` and data-model.md (`tier` 0 name … 5 split, `exact` 0 equals … 4 mid-word, lower is better; the word boundary is start-of-text or a preceding non-`\p{L}\p{N}` character, research R3). Make `filterFields` return display order. Rewrite the module header to state AND plus ranking and cite 079 FR-020 for the reversal of 007 FR-049. Make T001 pass.
- [x] T003 [US1] Export `rankField`, `orderRanked` and the `SearchRank` type from `packages/core/src/index.ts` next to the existing `settings-search` exports.
- [x] T004 [US1] Add SC-001/SC-002 unit tests to `packages/core/tests/unit/settings-search.test.ts`. For every descriptor in `KEYBINDINGS_METADATA`, `SETTINGS_METADATA` and `THEME_METADATA`, searching its full label puts that descriptor first in `filterFields`' result. A label shared by two descriptors may resolve to either, so assert that the first result's label equals the query. Run, then fix any failure in `settings-search.ts`.
- [x] T005 [US1] Write a failing component test in `packages/ui/tests/component/preferences-settings-search.test.ts`. A query naming the form-history clear control (067 FR-130) together with a ranked match elsewhere keeps the ranked section order, and does not revert to registry order (research R6). Then change `packages/ui/src/renderer/preferences/settings-tab.tsx` so the anchor row is added through `rankField`/`orderRanked` at the split tier instead of `metadata.filter`.
- [x] T006 [US1] Add a component test to `packages/ui/tests/component/preferences-keybindings-tab.test.ts`. In the Key Bindings tab, `go to line` renders **Go To Line** as the first row of the first section, and `Go to` does not render **Go Away**. FR-011: the debounce, reset (×) and empty state still pass in the existing tests, unchanged.
- [x] T007 [US1] Update every existing test that asserts OR widening or registry-order search results. Find them with `git grep -n "any token\|widen\|OR semantics" -- packages/*/tests` and by running `packages/ui/tests/component/preferences-*search*.test.ts`, `keybindings-tab*.test.ts` and `themes-tab*.test.ts` narrowly. Each changed assertion cites 079 FR-001 or FR-004.

**Checkpoint**: US1 complete. All three tabs rank.

## Phase 4: User Story 2 — One way to sub-group a theme (P2)

**Goal**: The theme registry uses heading fields only, and the token row order is unchanged.

**Independent test**: Themes tab: Editor → Syntax subgroup; General → Buttons → Confirm, Cancel and
Destroy. Same row order.

- [x] T008 [US2] Before touching the code, record today's `buildThemeMetadata(theme).map(d => d.key)` for every bundled theme in `packages/core/tests/fixtures/theme-row-order-079.json` (theme name → key array). Generate it from the unchanged code with a one-off script in the scratchpad that imports the built `packages/core/dist`; the script is not committed. Add a unit test to `packages/core/tests/unit/theme-metadata.test.ts` asserting `buildThemeMetadata(theme).map(d => d.key)` equals it (FR-015, SC-005). This test passes now and must keep passing.
- [x] T009 [US2] Write failing unit tests in `packages/core/tests/unit/theme-metadata.test.ts`. Rewrite the sibling-string assertions (`Editor · Syntax`, `General · Buttons · <Type>`, `areaOf` and the ordering test at its FR-004 case) to the data-model.md placement table. Assert that no descriptor's `group` contains ` · ` (FR-013, SC-006); that `areaForToken` returns the area only (`'Editor'` and `'General'`); that `assertThemeAreaGroups` still throws on an unplaced token (FR-018); and that every key is unchanged (FR-017). Update `packages/core/tests/unit/callout-theme-tokens.test.ts:42` to `group 'Markdown preview'`, `subgroup 'Callouts'`. Run and confirm the failures.
- [x] T010 [US2] Implement in `packages/core/src/config/theme-metadata.ts`. Add a private `placementForToken` returning `{ group, subgroup?, subsection? }`; make `areaForToken` return its `group`; have `descriptorForThemeToken` spread the placement. In `TYPOGRAPHY_AREA` the button role becomes area `General` with subgroup `Buttons`. Sort on (area index, subgroup with none first then alphabetical, subsection with none first then Confirm/Cancel/Destroy within Buttons and alphabetical elsewhere, token index), replacing `BUTTON_GROUP_ORDER` and `groupTieBreak`. Have `assertThemeAreaGroups` read `group` directly and remove `parentArea` if nothing else uses it. Rewrite the `THEME_AREA_GROUPS` doc comment and the button comments to describe the heading fields (FR-019). Make T008 and T009 pass.
- [x] T011 [US2] Update `packages/ui/src/renderer/preferences/themes-tab.tsx:715` (the comment saying this registry groups by sibling string) to say it now declares subgroups and subsections (079 FR-013).
- [x] T012 [US2] Update every UI test naming an old theme section. Run `git grep -n "Editor · Syntax\|General · Buttons\|· Callouts\|· File Icons" -- packages` (the hits in `settings-search.ts` and `settings-search.test.ts` are fixtures and comments, which T001 and T002 handle); hits are expected in `packages/ui/tests/component/themes-tab-subgroups.test.ts`, `themes-tab-folding.test.ts`, `preferences-themes-tab.test.ts`, `preferences-section-deeplink.test.ts`, `packages/ui/tests/unit/preview-surfaces-name-no-provider.test.ts:320` and `packages/ui/tests/e2e/preferences-row-actions.e2e.ts:214-217`. Move each one to the subgroup or subsection test id `subsection.tsx` emits. In `themes-tab-subgroups.test.ts`, add the US2 acceptance cases: four sections appear once; Buttons holds base tokens then Confirm, Cancel, Destroy; `syntax` returns the whole Syntax subgroup. Run each changed component and unit file narrowly. The E2E change is verified on CI only.

**Checkpoint**: US2 complete.

## Phase 5: Polish & cross-cutting

- [x] T013 [P] In `docs/preferences.md:18`, replace "matches any word" with every-word matching and best-first ranking. Also re-read the rest of that page and run `git grep -n -i "search" -- docs` for any other description of preferences search or theme sections (documentation currency).
- [x] T014 [P] Add supersession notes (FR-020–FR-022), each one line pointing at `specs/079-preferences-grouping-and-search/spec.md`. Put them in `specs/007-preferences-editor/spec.md` (the Clarifications entry at :15 and FR-049), `specs/007-preferences-editor/plan.md` (the I1 slice at :443 and the OR-vs-AND row at :458), `specs/021-theme-token-groups/spec.md` (FR-028; FR-015 noting the group-tier rank), `specs/040-editor-status-bar-and-gutter/spec.md` (FR-037a/FR-037b) and `specs/056-preferences-folding/spec.md` (where it describes sibling-string groups as headings, about :32 and :220).
- [x] T015 Run the quickstart's automated block, plus `npx tsc --noEmit -p packages/core` and `npx tsc --noEmit -p packages/ui`, and `npx eslint` over the changed files.

## Dependencies

- T001 → T002 → T003 → T004 → T005, T006 → T007
- T008 → T009 → T010 → T011 → T012
- US1 and US2 are independent. T013 and T014 can start at any time. T015 comes last.

## Parallel opportunities

US1 (`settings-search.ts` and its tests) and US2 (`theme-metadata.ts` and its tests) share no file.
Both touch `packages/core/src/index.ts` only if US2 changes an export, and it does not. T013 and T014
touch only docs and specs.

## Implementation strategy

One branch, one PR. US1 first, since it is user-visible in all three tabs; then US2; then polish. Both
are small enough for the orchestrator to implement directly. There is one application boundary
(Preferences: core plus renderer), so no subagent fan-out is warranted.
