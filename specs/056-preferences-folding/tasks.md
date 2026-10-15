---

description: "Task list for 056 — fold and unfold Preferences sections"
---

# Tasks: Fold and Unfold Preferences Sections

**Input**: Design documents from `/specs/056-preferences-folding/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/folding.md

**Tests**: Required. Principle V is non-negotiable: every implementation task follows a failing test, and
the test is run and seen to fail before the code is written. Layers are **unit** and **component** only —
no E2E and no integration (research R8).

**Organization**: grouped by user story. Paths below are relative to the repository root.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: US1–US5 from spec.md

---

## Phase 1: Setup — the `warning` icon token

**Purpose**: the one new theme icon FR-007 needs (research R7). The 047 precedent covers every place a token
must land.

- [x] T001 Update `packages/core/tests/unit/default-themes.test.ts`: `EXPECTED_ICON_TOKEN_COUNT` 81 → 82, and
  add `warning` to its named token lists. Run it and see it fail
- [x] T002 Add the `warning` icon token (glyph `⚠`) to `THRONG_THEME.icons` in `packages/core/src/config/theme.ts`.
  Add its label ("Warning") and description ("Marks a folded Preferences section that holds an invalid
  entry") in `packages/core/src/config/theme-copy.ts`. Bump the shipped-defaults version with a "056" rationale
  note in `packages/core/src/config/shipped-defaults.ts`. Add an `SVG_SHAPES` entry for `warning` in
  `packages/ui/src/main/icon-pack-service.ts`. Then run `npm run generate:defaults` and make T001 pass, along
  with `icon-tokens-exist`, `preferences-icons`, `theme-metadata` and `reset-completeness`

---

## Phase 2: Foundational — the shared fold machinery

**Purpose**: the pure helpers, the heading component and the per-tab hook every story uses. ⚠ No story work
starts until this phase is done.

- [x] T003 [P] Write `packages/ui/tests/unit/group-counts.test.ts` for `groupCounts(groups)`:
  - It returns a count per FoldKey (data-model.md: `JSON.stringify([group])`, `[group, subgroup]`,
    `[group, subgroup, subsection]`).
  - A heading's count includes all its descendants.
  - An empty input returns an empty map.

  Run it and see it fail.
- [x] T004 Implement `groupCounts()` and an exported `foldKey(group, subgroup?, subsection?)` in
  `packages/ui/src/renderer/preferences/group-descriptors.ts` beside `groupDescriptors`. T003 passes
- [x] T005 [P] Write `packages/ui/tests/unit/preferences-folds.test.ts` for the store in
  `preferences/preferences-folds.ts`:
  - **Reading** `localStorage["throng.preferences.folds"]`:
    - It reads `{ "v": 1, "settings": [], "keybindings": [], "themes": [] }`.
    - "any other value, or unparseable JSON, reads as empty".
    - "A missing array reads as empty".
  - **Writing**: a write rewrites only its own tab's array and prunes keys that name no current heading in
    that tab.
  - **Failures**: a storage exception on read or write is swallowed.

  Run it and see it fail.
- [x] T006 Implement `packages/ui/src/renderer/preferences/preferences-folds.ts`:
  - `readFolds(tab): Set<string>`
  - `writeFolds(tab, folded: Set<string>, currentKeys: ReadonlySet<string>)`
  - key `throng.preferences.folds`, `v: 1`

  T005 passes.
- [x] T007 [P] Write `packages/ui/tests/component/preferences-fold-heading.test.ts` for `FoldHeading` in
  isolation, against contracts/folding.md F1–F7:
  - `<hN>` holding one `<button type="button">`, with `aria-expanded` and with `aria-controls` pointing at the
    content container.
  - The chevron is drawn from the `chevron` token.
  - When folded, the content container has `hidden` and its children stay mounted: an input's typed draft
    survives fold and unfold.
  - `role="group"` with `aria-labelledby` is kept.
  - The count label is shown, and "N of M" when `matches` differs from `total`; both are digit-grouped.
  - The `warning` marker is shown only while folded **and** the container holds `[aria-invalid="true"]`.
    It appears and clears live as that attribute changes while folded. It has the title and accessible name
    "Contains an invalid entry".
  - Enter and Space on the focused button call `onToggle`.
  - Test ids `<id>-toggle`, `<id>-count`, `<id>-invalid`.

  Run it and see it fail.
- [x] T008 Implement `packages/ui/src/renderer/preferences/fold-heading.tsx` (`FoldHeading`):
  - `MutationObserver` attached only while folded, with `attributeFilter: ['aria-invalid']` and `subtree: true`.
  - Also export `FoldAllButtons`: two `IconButton`s with tokens `expandAll` / `collapseAll`, titles "Expand All
    Sections" / "Collapse All Sections", test ids `<tab>-expand-all` / `<tab>-collapse-all`, and a `disabled`
    prop.
  - Add the heading-button, chevron-rotation, count and warning styles to
    `packages/ui/src/renderer/preferences/preferences.css`, with theme tokens only (no literal colours).
  - The button spans the full heading row (FR-004: "a click anywhere on the heading row").
  - The content container is a dedicated wrapper with no `display` rule of its own, and the stylesheet
    carries `.fold-content[hidden] { display: none }`, so no class can override a fold.

  T007 passes, including a case that clicks the heading's name text (not the chevron) and folds it.
- [x] T009 [P] Write `packages/ui/tests/component/use-preference-folds.test.ts` for `usePreferenceFolds(tab,
  appliedQuery, currentKeys)`:
  - Initial state comes from the store.
  - `toggle` outside a search writes the store.
  - While `appliedQuery` is non-empty: every key reads unfolded, toggles go to a transient set and never
    reach the store, and the transient set resets when `appliedQuery` changes.
  - Clearing the query renders the persisted state again.
  - `expandAll` / `collapseAll` set every current key and write.
  - The `settings` and `themes` namespaces are independent even for identical group names.

  Run it and see it fail.
- [x] T010 Implement `packages/ui/src/renderer/preferences/use-preference-folds.ts` per data-model.md
  "Effective fold state". T009 passes
- [x] T011 [P] Write `packages/ui/tests/component/preferences-aria-invalid.test.ts`: every control that shows an
  invalid state sets `aria-invalid="true"` on its input while invalid and removes it when valid. That means
  `TextControl` and `JsonArrayControl` (`form-controls.tsx`), `MapControl` (`map-control.tsx`) and the
  colour field (`common/colour-picker.tsx`). Assert `NumberControl` too. Audited 2026-10-14: Number
  (`form-controls.tsx:436`), Text (`:496`), JsonArray (`:662`) and the colour field (`colour-picker.tsx:326`)
  already set it, so they pin existing behaviour; only `MapControl` lacks it, so only its case should fail.
  Run it and see that one fail
- [x] T012 Add `aria-invalid` to `MapControl`'s invalid state in
  `packages/ui/src/renderer/preferences/map-control.tsx`. T011 passes

**Checkpoint**: helpers, `FoldHeading`, `FoldAllButtons`, the hook and the invalid signal are all green in
isolation.

---

## Phase 3: User Story 1 — Fold away the sections I am not working in (P1) 🎯 MVP

**Goal**: on the Settings tab, every section, subgroup and nested subsection folds and unfolds by click and
shows its count. Folds persist across a remount.

**Independent Test**: click a Settings section heading, see its rows hide while the heading stays, then click
again and see them return.

- [x] T013 [US1] Write `packages/ui/tests/component/settings-tab-folding.test.ts`, mounted like
  `settings-tab-subgroups.test.ts:57-72`, with `localStorage.clear()` in `beforeEach`:
  - **Folding (US1 scenarios 1–3)**:
    - Clicking the Editor section hides every row and subsection under it, and the heading stays.
    - Clicking it again restores them in the original order.
    - Folding `Editor → Previews` hides its nested Markdown subsection and leaves the rest of Editor visible.
  - **No cascade (FR-003)**: fold Previews, fold Editor, unfold Editor → Previews is still folded.
  - **Counts (FR-006)**: each heading's count equals its descendant rows, and is shown folded or unfolded.
  - **Persistence (FR-011, FR-012)**:
    - Fold state survives an unmount and remount with the same `localStorage`.
    - With no stored state, everything is unfolded.
  - **FR-011a**: a stored key naming a non-existent heading is ignored without error.
  - **FR-007**: type an invalid value in a number setting, fold its section → the warning marker shows;
    unfold → the invalid entry is still in the input.

  Run it and see it fail.
- [x] T014 [US1] Rewrite the FR-036a case in `packages/ui/tests/component/settings-tab-subgroups.test.ts:114-128`
  ("is not collapsible") to assert the 056 opposite: the subgroup heading is a button with `aria-expanded`
  that folds the subgroup. Cite 056 FR-002. Run it and see it fail
- [x] T015 [US1] Make `Subsection` render its heading through `FoldHeading` in
  `packages/ui/src/renderer/preferences/subsection.tsx`:
  - It takes `folded`, `onToggle` and `count` props.
  - Keep `role="group"`, `aria-labelledby`, `useId`, the test ids and the h4/h5 levels.
  - Replace the "Not collapsible (FR-036a)" comment with one citing 056 FR-002, which supersedes it.
- [x] T016 [US1] In `packages/ui/src/renderer/preferences/settings-tab.tsx`:
  - Render each section through `FoldHeading` (h3).
  - Wire `usePreferenceFolds('settings', applied, currentKeys)`.
  - Compute totals with `groupCounts` over the unfiltered registry (`useMemo`).
  - Pass `folded`, `onToggle` and `count` to every `Subsection`.

  T013 and T014 pass, and the other Settings component tests stay green.

**Checkpoint**: US1 delivers value on its own — Settings folds by mouse and the folds are remembered.

---

## Phase 4: User Story 2 — Fold and unfold from the keyboard (P1)

**Goal**: headings are reachable with Tab, Enter and Space toggle them, the state is announced, and hidden rows
never take focus.

**Independent Test**: with the keyboard alone, Tab to a heading, press Enter to fold and Space to unfold, and
read its `aria-expanded`.

- [x] T017 [US2] Add the keyboard cases (US2 scenarios 1–4) to
  `packages/ui/tests/component/settings-tab-folding.test.ts`:
  - Tab reaches each heading button.
  - Enter folds and Space unfolds, and `aria-expanded` follows.
  - With a section folded, Tab from its heading moves to the next visible heading or control and never into a
    hidden row.

  Run it. Any failure is a defect in `fold-heading.tsx` or `settings-tab.tsx`: fix it there until the case
  passes.

---

## Phase 5: User Story 3 — Search finds settings in folded sections (P1)

**Goal**: a search shows matches in folded sections, counts read "N of M", and clearing the search restores
the pre-search folds.

**Independent Test**: fold Editor, search for a setting in Editor and see the match, then clear the search and
see Editor folded again.

- [x] T018 [US3] Add the search cases (US3 scenarios 1–3; FR-008, FR-009) to
  `packages/ui/tests/component/settings-tab-folding.test.ts`, using the fake-timer `search()` helper pattern
  from `settings-tab-subgroups.test.ts:77-82`:
  - Fold Editor and search a term matching an Editor setting → Editor and its subsection are unfolded, the
    match is visible, and each shown heading's count reads "<matches> of <total>".
  - Clearing the search folds Editor again.
  - A toggle made during the search is discarded on clear and never written to `localStorage`.
  - A folded section with no match disappears with its heading (040 FR-036c).

  Run it and see it fail.
- [x] T019 [US3] In `packages/ui/src/renderer/preferences/settings-tab.tsx`, compute match counts from the
  filtered `groups` (`groupCounts`) and pass `matches` alongside `total` to every heading. Confirm the hook's
  search handling (T010) drives the render. T018 passes

---

## Phase 6: User Story 4 — The same folding on Key Bindings and Themes (P2)

**Goal**: Key Bindings and Themes, including the hand-built Icons section, fold exactly as Settings does
(FR-013).

**Independent Test**: repeat US1–US3 on Key Bindings and Themes and see the same outcomes.

- [x] T020 [P] [US4] Write `packages/ui/tests/component/keybindings-tab-folding.test.ts`, mounted like
  `keybindings-tab-subgroups.test.ts:98-110`:
  - A group heading click folds it, and its count equals its bindings.
  - A search match inside a folded group is shown, with "N of M".
  - Folds persist across a remount; with no stored state every group is unfolded (FR-012).
  - Keyboard Enter and Space toggle.

  Run it and see it fail.
- [x] T021 [P] [US4] Write `packages/ui/tests/component/themes-tab-folding.test.ts`, mounted like
  `themes-tab-subgroups.test.ts:113-120`:
  - A token group folds, and so does the **Icons** section. The Icons count is `ICON_TOKENS.length + 2`.
  - A search match is shown inside a folded group.
  - With no stored state every group, Icons included, is unfolded (FR-012).
  - Keyboard: Tab reaches a token-group heading and the Icons heading; Enter and Space toggle them (SC-002).
  - Folding `Editor` on Themes leaves `Editor` on Settings unfolded: write the settings namespace, then
    assert the themes namespace is independent (FR-010).
  - A colour entry made invalid then folded shows the warning marker.

  Run it and see it fail.
- [x] T022 [P] [US4] In `packages/ui/src/renderer/preferences/keybindings-tab.tsx`:
  - Render each group through `FoldHeading`.
  - Wire `usePreferenceFolds('keybindings', …)` and the totals and match counts.
  - Pass the fold props to `Subsection`.

  T020 passes.
- [x] T023 [P] [US4] In `packages/ui/src/renderer/preferences/themes-tab.tsx`, do the same with namespace
  `themes`. Keep the inherited `settings-group-` test ids unchanged. T021 passes for the token groups
- [x] T024 [US4] In `packages/ui/src/renderer/preferences/icon-section.tsx`, render the Icons section through
  `FoldHeading` with key `["Icons"]` in the `themes` namespace. Fold props come from `themes-tab.tsx`. The
  total is `ICON_TOKENS.length + 2`; matches come from its existing filter. T021 passes in full

---

## Phase 7: User Story 5 — Fold or unfold the whole form at once (P3)

**Goal**: Expand All and Collapse All sit beside each tab's search box, act on that tab only, persist, and are
disabled during a search (FR-011b).

**Independent Test**: fold some headings, then Expand All unfolds everything and Collapse All folds
everything; switch tab and see its folds unchanged.

- [x] T025 [US5] Add the US5 cases to the three tab test files: Expand All unfolds every heading, and Collapse
  All folds every heading so only top-level headings stay visible. The buttons are disabled while the search
  box has text. The result persists across a remount. Collapse All on Settings leaves Key Bindings unchanged.
  Both buttons are reachable with Tab and act on Enter (FR-011b keyboard-operable).
  Files:
  - `packages/ui/tests/component/settings-tab-folding.test.ts`
  - `packages/ui/tests/component/keybindings-tab-folding.test.ts`
  - `packages/ui/tests/component/themes-tab-folding.test.ts`

  Run them and see them fail.
- [x] T026 [US5] Render `FoldAllButtons` immediately after each search box's clear control, wired to the hook's
  `expandAll` / `collapseAll` and with `disabled={query !== ''}`. Files:
  - `packages/ui/src/renderer/preferences/settings-tab.tsx`
  - `packages/ui/src/renderer/preferences/keybindings-tab.tsx`
  - `packages/ui/src/renderer/preferences/themes-tab.tsx`

  On Themes, `collapseAll` and `expandAll` cover the Icons key too. T025 passes.

---

## Phase 8: Polish & Cross-Cutting

- [x] T027 [P] Add a "Folding sections" passage to "The preferences window" in `docs/preferences.md` (FR-015).
  Cover:
  - fold and unfold by heading click and with Enter / Space;
  - the count, and "N of M" under search;
  - the invalid-entry warning marker;
  - Expand All / Collapse All, which are disabled during a search;
  - that folds are remembered per tab across restarts;
  - that a search unfolds matching sections and clearing it restores them.

  Keep existing anchors valid (`docs-currency.test.ts`).
- [x] T028 [P] [derived] Principle XII measurement. Add a case to
  `packages/ui/tests/component/settings-tab-folding.test.ts`: with the real Settings registry, Collapse All
  and a single heading toggle perform **zero** forced layout reads. Spy on `getBoundingClientRect`,
  `offsetHeight`, `offsetWidth` and `getComputedStyle`. Record the result in the PR body
- [x] T029 [derived] Run the short gates locally after the last edit and quote their output in the ledger:
  `npm run lint`, `npm run typecheck`, `npx vitest run --project unit`, `npx vitest run --project component`

---

**Manual coverage**: SC-001 (the target section's first row is visible without scrolling at the default
window size) and the visual look of the heading need a real window and a human eye. They go to the branch's
manual test plan, not to an automated task.

## Phase 9: Sections start folded (Session 2026-10-15; FR-016–FR-018, SC-006)

**Goal**: With nothing remembered, each tab shows only folded section headings. Subsections start
unfolded. The user's choice is remembered both ways. The existing E2E suite keeps running on open
sections through a test-only seam (research R9, R10).

**Independent Test**: Open Preferences on a fresh profile and see only section headings. Unfold Terminal,
restart, and it is still open.

- [x] T030 Extend `packages/ui/tests/unit/preferences-folds.test.ts` for store v2 (data-model "Version 2"):
  - `readFolds` returns a `Map<FoldKey, boolean>` of explicit choices.
  - A `v: 1` document reads as `key → true` per listed key.
  - `v: 2` round-trips `true` and `false`.
  - A write prunes keys that name no current heading and writes `v: 2`.
  - Corrupt JSON and other versions read as empty.
  - `sectionsOpenByDefault()` is true only when the page URL carries `foldDefault=open`.

  Run it and see it fail.
- [x] T031 Implement in `packages/ui/src/renderer/preferences/preferences-folds.ts`:
  - store v2 with the v1 read migration;
  - `defaultFolded(key, sectionsOpen)`, where a section (FoldKey of length 1, `["Icons"]` included) is
    folded unless `sectionsOpen`, and a subgroup or subsection is unfolded;
  - `sectionsOpenByDefault()`, which reads `foldDefault` from `window.location.search` on each call, with no
    module-level cache, so component tests that set the URL per test see it; `false` where `window` is
    undefined. The hook reads it once per mount.

  T030 passes.
- [x] T032 Extend `packages/ui/tests/component/use-preference-folds.test.ts`:
  - **Defaults**: with no stored state, a section key reads folded and a subgroup key reads unfolded; with
    the open default, both read unfolded.
  - **Toggles**: toggling a defaulted section records `false`, and a remount keeps it unfolded (FR-017).
  - **Bulk**: Expand All records `false` for every key, and Collapse All records `true`.
  - **Search and gap**: the search and debounce-gap cases still pass against effective state.

  Run it and see it fail.
- [x] T033 Update `packages/ui/src/renderer/preferences/use-preference-folds.ts`:
  - `isFolded` = stored choice ?? `defaultFolded`;
  - `toggle` records the flipped effective value;
  - `expandAll` / `collapseAll` record explicit values for every current key.

  `useTabFolding` gains no new parameter: the default comes from `sectionsOpenByDefault()`. T032 passes.
- [x] T034 Make the tab component tests run in both modes and add FR-016 / SC-006 cases.
  - **Existing cases**: the suites in `packages/ui/tests/component/settings-tab-folding.test.ts`,
    `keybindings-tab-folding.test.ts`, `themes-tab-folding.test.ts`, `settings-tab-subgroups.test.ts`,
    `settings-tab-previews.test.ts` and any other `packages/ui/tests/component/*tab*` or `preferences-*`
    test that reads rows inside a section were written against all-open. Have them set the open default
    (`window.history.replaceState` with `?foldDefault=open` in `beforeEach`) or click Expand All. Choose
    per file, whichever keeps the test's intent.
  - **New cases** in each `*-tab-folding` file, with **no** seam:
    - the tab mounts with every section folded, the Icons section included on Themes, and 0 rows visible
      (SC-006);
    - unfolding a section shows all of its subsections unfolded (US1 scenario 6);
    - unfold Terminal, remount, and Terminal is open while the rest are folded (US1 scenario 7).

  Run the new cases and see them fail.
- [x] T035 Make T034 green. The tabs need no change beyond what T033 gives, unless a case shows otherwise;
  fix the cause there.
  Existing cases titled or asserting FR-012 ("no stored state → everything unfolded") — in T013, T020 and
  T021's files — are retitled "with the open seam" or replaced by the new SC-006 cases; none stays
  presented as the current default. Add one case: a stored v2 state lacking a key reads that key at its
  FR-016 default (section folded, subgroup unfolded).
- [x] T036 Write a unit test in `packages/ui/tests/unit/preferences-window-query.test.ts`: the Preferences
  window's load query carries `foldDefault: 'open'` only when the deps' renderer query says so, and is
  otherwise `{ prefs: <tab> }` alone. Use the existing `preferences-window` unit-test pattern
  (`window-parent-tdz.test.ts`). Run it and see it fail
- [x] T037 Implement the seam. Main reads `THRONG_PREFS_SECTIONS_OPEN` once, in `main.ts`'s
  `rendererQuery()`, beside `THRONG_AUTOSAVE_DEBOUNCE_MS`, and adds `foldDefault: 'open'` when it is `'1'`.
  `PreferencesWindowDeps` gains `query?: Record<string, string>`, merged into
  `loadFile(…, { query: { ...deps.query, prefs: tab } } (tab last, so the renderer query can never replace it))` in `packages/ui/src/main/preferences-window.ts`.
  The one `preferencesDeps` object in `main.ts` (~:961; ~:1031 is the About window's `aboutDeps`, leave it)
  passes `query: rendererQuery()`. Docblock
  it in the voice of `rendererQuery`'s existing one. T036 passes
- [x] T038 Set `THRONG_PREFS_SECTIONS_OPEN: '1'` in `packages/ui/tests/e2e/harness.ts`. That is the app env
  block beside `THRONG_E2E_CLIPBOARD`, plus the second launch path at ~:70 if it launches the app. Give it
  a comment in the style of its neighbours. Add the variable to the testing table in `docs/environment.md`
  ("`1` makes Preferences sections start unfolded, as before 056 FR-016; the harness sets it"). Run
  `npx vitest run --project unit packages/ui/tests/unit/docs-currency.test.ts packages/ui/tests/unit/e2e-tags.test.ts`
- [x] T039 [P] Update `docs/preferences.md` "Folding sections" (FR-018): sections start folded until you
  open them, subsections start open, and your choices either way are remembered. Run `docs-currency`
- [x] T040 [derived] Short gates after the last edit: `npm run lint`, `npm run typecheck`, `npm run build`,
  `npx vitest run --project unit`, `npx vitest run --project component`

## Dependencies & Execution Order

- **Phase 9** (Session 2026-10-15) depends on Phases 1–8. Its order: T030–T031, then T032–T033, then
  T034–T035, then T036–T037, then T038, T039, T040.

- **Phase 1** (T001–T002) → **Phase 2** (T003–T012) → stories.
- **US1** (T013–T016) is the MVP and comes first. **US2** (T017) and **US3** (T018–T019) build on US1's
  Settings wiring, so they run in sequence in the same test file.
- **US4** (T020–T024) depends only on Phase 2, so it can run beside US1–US3. T024 needs T023.
- **US5** (T025–T026) touches all three tabs, so it runs after US1 and US4.
- Polish comes last. T029 is the final task.

## Parallel Examples

- Phase 2: T003, T005, T007, T009 and T011 are five test files with no shared file. Then T004, T006, T008,
  T010 and T012 are five implementation files.
- US4: T020 ∥ T021 (tests), then T022 ∥ T023 (`keybindings-tab.tsx` vs `themes-tab.tsx`), then T024.
- Polish: T027 (docs) ∥ T028 (test).

## Implementation Strategy

MVP = Phase 1 + Phase 2 + US1 (Settings folds by mouse and persists). Then add keyboard (US2), search (US3),
the other two tabs (US4) and Expand/Collapse All (US5), each a green increment.
