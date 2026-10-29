---
description: "Task list for Find in Files Polish (spec 060)"
---

# Tasks: Find in Files Polish

**Input**: Design documents from `/specs/060-find-in-files-polish/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/results-list-ui.md](./contracts/results-list-ui.md)

**Tests**: REQUIRED — Constitution Principle V is test-first and non-negotiable. Every behaviour task is
preceded by a failing test at the lowest layer that proves it (plan, *Test layers*). Run a new test,
watch it fail for the stated reason, then implement.

**Organization**: by user story. Foundational work (core shapes, the preference value, the icon token,
key-based selection) blocks every story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: different files, no dependency on an incomplete task
- Paths are repo-relative. `core` = `packages/core`, `ui` = `packages/ui`.

---

## Phase 1: Setup

No setup: no dependency, package or build change.

---

## Phase 2: Foundational (blocks all stories)

### Core — Folder structure shape (R1–R3)

- [x] T001 [P] Write failing unit tests for `orderGroups(groupRows(rows, 'folderTree', { scopeRel }), sortOrder)` in `core/tests/unit/file-search-folder-tree.test.ts`: one folder heading per level below `scopeRel`; only folders leading to a match; no merge of single-child chains; files as leaves of their folder, rows only in file groups (043 FR-073 invariant); folder `matchCount` = everything beneath (FR-013a); a file at the scope root has no folder heading; children ordered folders-before-files by `sortNodes` for both `natural` and `characters` (FR-014); `markStale` flags only file groups (FR-019)
- [x] T002 Implement the `folderTree` branch in `core/src/search/file-search.ts`: extend `Grouping` to `'file' | 'fileAndFolder' | 'folderTree'`; `groupRows` takes an options bag `{ scopeRel?: string }`, used only by `folderTree`; `orderGroups(groups, explorerOrder?: ExplorerSortOrder)` orders by `sortNodes` from `core/src/explorer/node.ts` (a heading adapts as `{ kind, name: last segment }`) when `explorerOrder` is given, and by 043 FR-035's comparator, untouched, when it is not (FR-024). The panel passes `explorerOrder` only for `folderTree`. Existing `file-search*.test.ts` stay green unmodified
- [x] T003 [P] Write failing unit tests for `leftTruncatePath(relPath, maxChars = 40)` in `core/tests/unit/path-label.test.ts`: a path that fits is returned whole with no ellipsis; a longer one becomes `…/` + the longest suffix of whole segments that fits; a single over-long name is truncated from the left with a leading `…`; the result never exceeds `maxChars` (FR-023, SC-005)
- [x] T004 Implement `leftTruncatePath` in `core/src/search/path-label.ts` and export it from `core/src/index.ts`

### Core — preference value and icon token

- [x] T005 [P] Extend failing unit tests in `core/tests/unit/settings-metadata.test.ts` (descriptor `search.inFiles.defaultGrouping` offers `folderTree` labelled `Folder structure`, default still `file`) and `core/tests/unit/settings-grouping-retired.test.ts` (a persisted `folderTree` parses and survives a write; an unknown value still falls back to `file`) (FR-017)
- [x] T006 Add `'folderTree'` to `FindInFilesGrouping` and `FIND_IN_FILES_GROUPINGS` in `core/src/config/app-settings.ts`; add `optionLabels.folderTree: 'Folder structure'` in `core/src/config/settings-metadata.ts`; add the value to the `search.inFiles.defaultGrouping` row of `docs/preferences.md` (`folderTree` (Folder structure))
- [x] T007 [P] Write a failing unit test in `core/tests/unit/theme-060.test.ts` that tokens `busy` and `groupFolderTree` ship a glyph distinct from `refresh` / `folderOpen` / `file`, carry editor copy, and that the shipped-defaults version is bumped (R10). *(Corrected during implementation: `TOKEN_PARENT` chains colour tokens only — an icon token has no parent, so the 054 pattern is the right one.)*
- [x] T008 Add icon tokens `busy` (`◌`) and `groupFolderTree` (`🗂`) in `core/src/config/theme.ts`, their copy in `core/src/config/theme-copy.ts`, SVG shapes in `ui/src/main/icon-pack-service.ts`; bump `SHIPPED_DEFAULTS_VERSION` 24 → 25 and re-pin the tests that assert it and the icon token count

### Renderer — selection is a key, not an index (R4)

- [x] T009 Write failing component tests in `ui/tests/component/find-in-files-selection.test.ts`: the selected row keeps `data-current="true"` when a later batch appends rows above and below it in the same generation (FR-003); arrow keys, Home, End still step through headings and rows (FR-021); appended rows leave `document.activeElement` where it was (FR-003); `[derived]` a new generation clears the selection (043's shipped reset); `[derived]` collapsing a heading over the selected row moves the selection to that heading
- [x] T010 Replace the index state `current` with `selectedKey` in `ui/src/renderer/find-in-files/results-list.tsx`, deriving the index per render; `onCurrentChange` publishes the selected row (or `null` on a heading); heading items get `data-current` too. Existing `find-in-files-*.test.ts` stay green

**Checkpoint**: core shapes, the preference value, the token and key-based selection exist; stories can start.

---

## Phase 3: User Story 1 — See that a search is running (P1)

**Goal**: busy indicator, rows usable during a scan, cancel keeps what was found.

**Independent test**: run a slow search; the cancel control animates; rows open mid-scan; cancel leaves the rows and a partial notice.

- [x] T011 [P] [US1] Write failing component tests in `ui/tests/component/find-in-files-busy.test.ts`: while running, `fif-cancel-<panel>` has `data-busy="true"` and `aria-busy="true"` and renders the `busy` icon, the list has `aria-busy="true"`; both clear on complete and on cancel; clicking cancels (FR-001, US1 scenario 5)
- [x] T012 [P] [US1] Write a failing unit CSS guard in `ui/tests/unit/find-in-files-busy-css.test.ts`: `find-in-files.css` animates `.fif-btn[data-busy] .fif-busy` and stops the animation under `@media (prefers-reduced-motion: reduce)` (FR-002)
- [x] T013 [US1] Implement the busy cancel control in `ui/src/renderer/find-in-files/find-in-files-panel.tsx` (literal `<Icon token="busy" />` in a `.fif-busy` span; `[derived]` `<Icon token="dismiss" />` shown on hover/focus so the click's effect stays visible; `data-busy` and `aria-busy` on the button, `aria-busy` on the list) and the rotation + reduced-motion rule in `ui/src/renderer/find-in-files/find-in-files.css`
- [x] T014 [US1] Rewrite `ui/tests/component/find-in-files-cancel.test.ts` to assert FR-003a/FR-003d: cancel keeps every listed row, heading and count; status reads cancelled with the listed count; a batch arriving after the cancel adds nothing; cancel with nothing listed shows an empty cancelled list (fails against today's store)
- [x] T015 [US1] Rewrite the `#391` lock block and the cap notice cases in `ui/tests/component/find-in-files-notices.test.ts`: rows are NOT `aria-disabled` while running and open on double-click and `Enter` (FR-003, SC-008); one partial notice `fif-partial-notice-<panel>` for a cancel with rows, for the cap, and for both at once; none for an empty cancel; a re-run clears it (FR-003b, FR-003c)
- [x] T016 [US1] In `ui/tests/component/find-in-files-commit-target.test.ts`, add failing cases: while running, the row menu opens, `Open In` is enabled and `Replace All`, `Replace in …`, `Replace Match in …` are disabled (FR-003, US1 scenario 4); a menu opened before a cancel keeps its replace items disabled until reopened (spec Edge Cases)
- [x] T017 [US1] Change `cancelFindInFiles` in `ui/src/renderer/find-in-files/find-in-files-store.ts` to keep `rows`, `staleFiles` and counts with `status: 'cancelled'` (keep `dropThrough: Infinity`); rewrite its header comment, which cites the superseded reading of 043 FR-043
- [x] T018 [US1] Remove the `locked` prop and every use of it from `ui/src/renderer/find-in-files/results-list.tsx` (rows, keyboard, context menu); in `find-in-files-panel.tsx` withhold the menu's `replaceInFile` / `replaceMatch` handlers while `running`; replace the `capped` notice in `NoticeBar` with one `partial` notice (`capped || (status === 'cancelled' && rows.length > 0)`) whose text names the cause and ends "Replace All acts only on the results listed below."

**Checkpoint**: US1 independently testable.

---

## Phase 4: User Story 2 — Read results at a glance (P1)

**Goal**: names not paths, muted folder in Per file, tooltips, text-first rows, shared match style, explorer icons.

**Independent test**: search across folders in each grouping and theme; compare against the [contract](./contracts/results-list-ui.md).

- [x] T019 [P] [US2] Write failing component tests in `ui/tests/component/find-in-files-headings.test.ts`: under `fileAndFolder` and `[derived]` under `folderTree` a file heading's `.fif-group__key` is the base name, and a `folderTree` folder heading's is its last segment; under `file` it is the base name plus `fif-group-dir-<key>` holding the directory (absent for a root file); every heading's `title` is its full root-relative path (`/` for the root folder) in all three groupings (FR-004, FR-005, SC-004)
- [x] T020 [P] [US2] Write failing component tests in `ui/tests/component/find-in-files-row-layout.test.ts`: a row's children are the snippet then `.fif-row__pos` reading `(L:C)` digit-grouped (FR-006); a row's left padding exceeds its heading's at every depth (FR-007); the file heading icon is `fileIconToken(name)` and a folder heading shows `folderOpen` expanded / `folder` collapsed (FR-011); the `<mark>` carries `throng-search-match` (FR-009)
- [x] T021 [P] [US2] Write a failing unit CSS guard in `ui/tests/unit/find-in-files-match-style.test.ts`: `search/find-bar.css` styles `.throng-search-match` under `:where(.cm-editor, .fif-results)`; `find-in-files.css` sets no `background` on `.fif-match`; `.fif-row` has no bold weight and `.fif-group__key` uses `--throng-font-weight-bold` for both heading kinds; the muted folder uses `--throng-colour-textMuted` at normal weight (FR-008, FR-009, FR-010)
- [x] T022 [US2] Implement headings in `ui/src/renderer/find-in-files/results-list.tsx`: base-name label, the muted directory span under `file` grouping (the list needs the grouping as a prop), `title` = full path, icons via `fileIconToken` from `ui/src/renderer/explorer/tree-icons.ts` and literal `folderOpen` / `folder`; rewrite the comment at the heading's `onDoubleClick` that says a heading is not selectable
- [x] T023 [US2] Implement the row layout in `results-list.tsx` (snippet, then `(L:C)` via `formatGrouped`; indent per R12) and the styles in `ui/src/renderer/find-in-files/find-in-files.css` (indent from `--throng-size-icon`, weights, muted folder truncating before the name, delete every Find in Files rule left unused); widen the rule in `ui/src/renderer/search/find-bar.css` to `:where(.cm-editor, .fif-results) .throng-search-match` (and `--current`)

**Checkpoint**: US2 independently testable.

---

## Phase 5: User Story 3 — Browse results as a folder tree (P2)

**Goal**: a third grouping mirroring the explorer.

**Independent test**: search with matches at several depths; choose Folder structure; compare with the File Explorer.

- [x] T024 [P] [US3] Write failing component tests in `ui/tests/component/find-in-files-folder-structure.test.ts`: a third toolbar control `fif-grouping-folderTree-<panel>` (title `Group by folder structure`, `aria-pressed` when active); choosing it regroups without a new scan (no `fileSearch.start` call) and totals match the other groupings (FR-015); every level opens expanded; folder headings carry the `.fif-group` hover affordance (043 FR-085); double-click a folder heading toggles it; Collapse all / Expand all reach every level (FR-016); a scoped search starts the tree below the scope (R3); with remembering on, the next search opens in Folder structure (FR-017); the explorer's `sortOrder` preference changes the order (FR-014)
- [x] T025 [US3] Implement in `ui/src/renderer/find-in-files/find-in-files-panel.tsx`: add `folderTree` to `GROUPINGS` with the literal toolbar icon `<Icon token="groupFolderTree" />`; pass `{ scopeRel: state.scopeSubPath }` to `groupRows` and `explorer.sortOrder` (read by name) to `orderGroups`, both only for `folderTree`; `allGroupKeys` already recurses
- [x] T026 [US3] Add `Group by folder structure` (checked when active, `viewState`, after `Group by folder and file`) to `ui/src/renderer/find-in-files/content-menu.ts`, with failing cases first in `ui/tests/unit/find-in-files-menu.test.ts` (FR-018)

**Checkpoint**: US3 independently testable.

---

## Phase 6: User Story 4 — Select without opening (P2)

**Goal**: single click selects rows and headings; selection survives regroup.

**Independent test**: click rows and headings, regroup, check what stays selected.

- [x] T027 [P] [US4] Write failing component tests in `ui/tests/component/find-in-files-selection.test.ts` (extend T009's file): single click on a row selects it and opens nothing (FR-020, SC-006); single click on a heading label selects it without toggling, the chevron toggles without selecting, double-click and `Enter` toggle (FR-020a, US4 scenario 4); after a regroup the selected row is still selected and the window's offset puts it in view; a selected `fileAndFolder` folder heading switched to `file` hands the selection to its first row (FR-015a); update `ui/tests/component/find-in-files-open-result.test.ts`'s single-click case to the new wording
- [x] T028 [US4] Implement in `ui/src/renderer/find-in-files/results-list.tsx`: `onClick` selects on rows and heading labels (modifier-guarded like the double-click), the chevron stops propagation; on a regroup, resolve `selectedKey` (fallback per FR-015a) and set the scroll offset so it is in view

**Checkpoint**: US4 independently testable.

---

## Phase 7: User Story 5 — A shorter, narrower menu (P3)

**Goal**: no form controls in the menu; bounded replace labels.

**Independent test**: right-click a result in a deep file.

- [x] T029 [US5] Update `ui/tests/unit/find-in-files-menu.test.ts` and `ui/tests/component/find-in-files-content-menu.test.ts` to fail on today's menu: no `Run search`, `Cancel search` or `Change scope` anywhere (FR-022); `Replace in <label>` / `Replace Match in <label>` use `leftTruncatePath` (FR-023); update the `Change scope` and `Run search` references in `ui/tests/component/find-in-files-panel-controls.test.ts`, `ui/tests/component/find-in-files-open-in.test.ts` and `ui/tests/unit/menu-sections.test.ts`
- [x] T030 [US5] Remove the run/cancel and `Change scope` rows and the `focusScope` action from `ui/src/renderer/find-in-files/content-menu.ts` and its caller in `find-in-files-panel.tsx`; label the narrow replace rows with `leftTruncatePath`; rewrite the file's header comment, which cites the v5.10.0 Principle VI wording

**Checkpoint**: all stories complete.

---

## Phase 8: Polish & cross-cutting

> **Out of scope, recorded:** the constitution's sync report also lists stale citations of the old
> Principle VI wording outside Find in Files (`.claude/skills/throng-renderer-ui/SKILL.md`,
> `workspace/panel-header-menu.ts`, `editor/content-menu.ts`, `preview/preview-status-bar.tsx`, five test
> comments). They change no behaviour and are left for a follow-up, named in the report.
> SC-001, SC-002 and SC-003 are judged by hand: they go into the manual test plan.

- [x] T031 [P] Rewrite comments citing "every panel action has a menu item" in the files this branch touches — `ui/src/renderer/find-in-files/results-list.tsx`, `content-menu.ts`, `find-in-files-panel.tsx` — to Constitution v6.0.0's "every panel action is reachable"
- [x] T032 Run the `throng-docs` audit: `docs/preferences.md` carries the new value; `docs/quick-start.md`'s Find in Files section mentions Folder structure at tour depth if it lists groupings; `npx vitest run --project unit packages/ui/tests/unit/docs-currency.test.ts` green
- [x] T033 Run the covering tests for every touched file (unit + component), then lint and typecheck; fix anything red

---

## Dependencies & execution order

- **Phase 2** blocks everything. Within it: T001→T002, T003→T004, T005→T006, T007→T008, T009→T010; the five pairs are independent.
- **US1** needs T010 (key selection) and T008 (token). **US2** needs nothing beyond Phase 2. **US3** needs T002, T006. **US4** needs T010. **US5** needs T004.
- Stories share `results-list.tsx` and `find-in-files-panel.tsx`, so their implementation tasks run **in sequence** (US1 → US2 → US3 → US4 → US5); their test-writing tasks marked [P] can be written ahead.

## Parallel opportunities

- Phase 2's five test tasks (T001, T003, T005, T007, T009) touch five different files.
- US1: T011 ∥ T012. US2: T019 ∥ T020 ∥ T021. US3: T024 ahead of T025.

## Implementation strategy

MVP = Phase 2 + US1 (the panel stops looking hung, cancel stops losing work). Then US2 (everyday
readability), US3, US4, US5 in order, each a commit that leaves the suite green.

---

## Phase 9: Hand-test feedback (Session 2026-10-25 hand-test feedback)

**Defect** (FR-009, MT-04): the match highlight in a result row is clipped top and bottom.

- [x] T034 [P] Failing component test then fix: in a result row, the `throng-search-match` mark's box (border included) fits inside the row's height — `ui/tests/component/find-in-files-row-layout.test.ts`, fix in `ui/src/renderer/find-in-files/find-in-files.css` (research R18)
- [x] T035 [P] Failing unit test then data: the R17 token list has no `Extended_Pictographic` / `Emoji_Presentation` glyph in `THRONG_THEME` or any bundled theme, and `busy` is ◜, `groupFolderTree` ⋔ — new `core/tests/unit/theme-plain-glyphs.test.ts`; change the defaults in `core/src/config/theme.ts` (and any bundled theme that repeats them) and their copy in `theme-copy.ts` where it names the glyph
- [x] T036 Failing unit test then upgrade: `SHIPPED_DEFAULTS_VERSION` 25 → 26; `V25_MOVED_ICONS` records each R17 "Was" glyph; `planThemeValueUpgrade` moves `icons.<token>` in a reserved theme only where the file still holds exactly the 25 value, and leaves a user's own glyph — `core/src/config/shipped-defaults.ts`, test in `core/tests/unit/theme-icon-upgrade-060.test.ts`; re-pin every test that pins 25
- [x] T037 Update the bundled SVG pack shapes for `busy` (quarter arc) and `groupFolderTree` (fork) in `ui/src/main/icon-pack-service.ts`
- [x] T038 Failing component test then component: `BusyGlyph` in `ui/src/renderer/common/busy-glyph.tsx` (+ css) renders `<Icon token="busy">` in a square box that rotates around its centre and stops under reduced motion; test in `ui/tests/component/busy-glyph.test.ts` plus a unit CSS test for the transform-origin and reduced-motion rule (research R16)
- [x] T039 Use `BusyGlyph` in the Find in Files cancel control (`find-in-files-panel.tsx`, removing the `.fif-busy` rules from `find-in-files.css`), in `Spinner` (`common/loading.tsx`, deleting `.throng-spinner__ring` from `loading.css`) and in the app-closing overlay (`app-close-prompt.tsx`, deleting `.app-closing__spinner` from `theme.css`); update their existing tests — FR-001b
- [x] T040 Covering tests for every touched file (unit + component), lint, typecheck; `docs/preferences.md` if it names a changed glyph

---

## Phase 10: Search exclusions of Find in Files' own (#532, User Story 6)

**Goal**: FR-025–FR-040. **Independent test**: MT-09, MT-10.

### Core, persistence, daemon, main (orchestrator)

- [x] T041 [P] [US6] Failing unit tests then `core/src/search/search-exclude.ts`: `DEFAULT_SEARCH_EXCLUDE_GLOBS`, `parseExcludeBox`, `searchExcludeGlobs` (research R19); export from `core/src/index.ts`; tests in `core/tests/unit/search-exclude.test.ts`
- [x] T042 [US6] Failing unit tests then settings: `search.inFiles.excludeGlobs` and `search.inFiles.useExcludeGlobs` in `core/src/config/app-settings.ts` (types, defaults, tolerant parse, clone) and their descriptors in `settings-metadata.ts`; `docs/preferences.md` rows (R20); tests beside the existing `search.inFiles` settings tests
- [x] T043 [US6] Failing unit tests then `Project.searchExcludeGlobs` + `applySearchExcludeGlobs` in `core/src/projects/project.ts` and `ProjectService.setSearchExcludes` in `project-service.ts` (R21)
- [x] T044 [US6] Failing tests then persistence migration v10 `search_exclude_globs` (`persistence/src/migrations/v10-project-search-excludes.ts`, `schema-guard.ts`, `project-repository.ts`), idempotent on re-run
- [x] T045 [US6] Failing tests then daemon RPC `projects.setSearchExcludes` (`daemon/src/project-service.ts`), `ipc-contract/src/projects.ts`, the DTO field
- [x] T046 [US6] Failing integration tests then `ui/src/main/file-search-service.ts` + `main.ts` wiring: drop explorer globs and hidden paths, take the search list and the project list, `StartScanRequest.useExcludeGlobs` / `extraExcludes`, carried in `adoptQuery`; contract test fields; `file-search-scan` integration cases for FR-025, FR-027, FR-029, FR-030 and the explicit file scope
- [x] T047 [US6] Failing unit tests then icon tokens `projectSettings` ⌂ and `searchExclusions` ⊝ (`theme.ts`, `theme-copy.ts`, `ui/src/main/icon-pack-service.ts`), `SHIPPED_DEFAULTS_VERSION` 26 → 27, re-pin (R24)

### Renderer (web)

- [x] T048 [US6] `setSearchExcludes` in `ui/src/renderer/state/projects-client.ts` and `projects-store.tsx`, with component/unit coverage beside the existing `setHidden` tests
- [x] T049 [US6] Failing component tests then the panel: exclusions toggle (`IconButton`, `aria-pressed`, token `searchExclusions`) and its menu row in `content-menu.ts`; the semicolon box with its one invalid-entry notice; `panel.config` persistence; new-panel defaults; re-run on change of the toggle, the box, the global list setting or the active project's list (FR-032); sent with `fileSearch.start`; adopted from `adoptQuery` — `find-in-files-panel.tsx`, `find-in-files-store.ts` (R22)
- [x] T050 [US6] Failing component tests then **Exclude from Find in Files in this project** on file and folder headings in the results menu (`find-in-files/content-menu.ts`, panel wiring) — FR-034
- [x] T051 [US6] Failing component tests then the same command in the File Explorer's file/folder menu (`explorer/context-menu-items.ts`, `panes/file-explorer-pane.tsx`) — FR-033
- [x] T052 [US6] Failing component tests then the two-section project settings dialog, separately scrolling lists, add boxes and notes (`project-settings/project-settings-dialog.tsx` + css) — FR-035, FR-036
- [x] T053 [US6] The project settings control uses `projectSettings` (`panes/file-explorer-pane.tsx`) — FR-037; update tests asserting `settings` there

### Verification (orchestrator)

- [x] T054 Covering tests for every touched file, lint, typecheck, build; `docs-currency` green; MT-09/MT-10 `Paths:` widened

## Phase 11: Hand-test feedback (2026-10-29)

- [x] T055 [US4] Failing component test then every heading count in brackets, in all three groupings (FR-013b) — `packages/ui/src/renderer/find-in-files/results-list.tsx`, `packages/ui/tests/component/find-in-files-folder-structure.test.ts`
- [x] T056 [US6] Failing component test then the exclusions toggle's hover title naming its state and the preference (FR-027a) — `packages/ui/src/renderer/find-in-files/find-in-files-panel.tsx`, `packages/ui/tests/component/find-in-files-exclusions.test.ts`
- [x] T057 [US6] Failing component test then the project settings dialog's sections sized by content, not a zero flex basis (FR-035, FR-036 — defect) — `packages/ui/src/renderer/project-settings/project-settings.css`, `packages/ui/tests/component/project-settings-dialog.test.ts`
- [x] T058 [US4] Failing component test then Open In on a file heading, opening at line 1 (FR-041) — `packages/ui/src/renderer/find-in-files/find-in-files-panel.tsx`, `packages/ui/tests/component/find-in-files-open-in.test.ts`, `packages/ui/tests/unit/menu-sections.test.ts`
- [x] T059 [US4] The body menu without Replace, exclusions, Group by and Split; the tests that pinned them rewritten (FR-042) — `packages/ui/src/renderer/find-in-files/content-menu.ts`, `packages/ui/tests/unit/find-in-files-menu.test.ts`, `packages/ui/tests/unit/menu-sections.test.ts`, `packages/ui/tests/unit/panel-split-wiring.test.ts`, `packages/ui/tests/component/find-in-files-content-menu.test.ts`, `packages/ui/tests/component/find-in-files-panel-controls.test.ts`
- [x] T060 [US4] Failing unit and component tests then the Show results preference, its descriptor and docs row, and the panel toggle that writes it (FR-043) — `packages/core/src/config/app-settings.ts`, `packages/core/src/config/settings-metadata.ts`, `docs/preferences.md`, `packages/ui/src/renderer/find-in-files/find-in-files-panel.tsx`, `packages/core/tests/unit/settings-show-results.test.ts`, `packages/ui/tests/component/find-in-files-show-results.test.ts`
- [x] T061 [US6] Failing component tests then the project settings dialog's title-row close control, aligned remove controls and per-section Preferences shortcuts (FR-044) — `packages/ui/src/renderer/project-settings/project-settings-dialog.tsx`, `packages/ui/src/renderer/project-settings/project-settings.css`, `packages/ui/tests/component/project-settings-dialog.test.ts`
- [x] T062 [US4] Failing unit and component tests then Current Editor in place of Last Active / New Editor in the File Explorer's and Find in Files' Open In for a file already open (FR-045) — `packages/ui/src/renderer/editor/open-in-targets.ts`, `packages/ui/src/renderer/editor/open-in-perform.ts`, `packages/ui/tests/unit/open-in-targets.test.ts`, `packages/ui/tests/component/explorer-open-in-target.test.ts`
- [x] T063 [US4] Failing unit and component tests then Current Editor in a link's Open In for a file already open (FR-045) — `packages/ui/src/renderer/links/link-open-in.ts`, `packages/ui/src/renderer/links/link-menu.ts`, `packages/ui/src/renderer/links/file-link-menu.ts`, `packages/ui/tests/unit/link-menu-current-editor.test.ts`, `packages/ui/tests/component/terminal-link-menu-open-in.test.ts`
- [x] T064 [US4] Failing unit and component tests then a panel's grouping writing the grouping preference, open panels following it, and `search.inFiles.rememberGrouping` retired (FR-046) — `packages/core/src/config/app-settings.ts`, `packages/core/src/config/settings-metadata.ts`, `packages/ui/src/renderer/find-in-files/find-in-files-store.ts`, `packages/ui/src/renderer/find-in-files/find-in-files-panel.tsx`, `docs/preferences.md`, `packages/core/tests/unit/settings-remember-grouping-retired.test.ts`, `packages/ui/tests/component/find-in-files-grouping-linked.test.ts`
- [x] T065 [US4] Failing component tests then a match revealed in a preview painted with the current-match fill and frame (FR-047) — `packages/ui/src/renderer/preview/preview-search.ts`, `packages/ui/src/renderer/preview/preview-panel.tsx`, `packages/ui/tests/component/preview-find.test.ts`, `packages/ui/tests/component/preview-reveal-match.test.ts`
- [x] T066 [US4] Failing component tests then the preview rows in Find in Files' Open In, from a builder shared with the File Explorer (FR-048) — `packages/ui/src/renderer/preview/preview-open-in.ts`, `packages/ui/src/renderer/explorer/file-tree.tsx`, `packages/ui/src/renderer/explorer/context-menu-items.ts`, `packages/ui/src/renderer/find-in-files/content-menu.ts`, `packages/ui/src/renderer/find-in-files/find-in-files-panel.tsx`, `packages/ui/src/renderer/find-in-files/find-in-files-chrome.tsx`, `packages/ui/src/renderer/find-in-files/result-open.ts`, `packages/ui/tests/component/find-in-files-open-in.test.ts`, `packages/ui/tests/component/find-in-files-open-preview.test.ts`
- [x] T067 [US4] Failing component tests then one Current Preview row in place of Last / New Preview Panel for an already-previewed file, in the shared builder (FR-049) — `packages/ui/src/renderer/preview/preview-open-in.ts`, `packages/ui/tests/component/explorer-open-in-preview.test.ts`, `packages/ui/tests/component/find-in-files-open-in.test.ts`, `packages/ui/tests/unit/menu-sections.test.ts`
