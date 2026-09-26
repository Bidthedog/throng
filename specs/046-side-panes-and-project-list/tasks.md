# Tasks: Side Panes and Project List

**Feature**: 046 | **Branch**: `feature/S046-I331-I332-I390-I411-I292-side-panes-and-project-list` | **Date**: 2026-09-23

**Input**: [spec.md](./spec.md) (5 stories, 49 requirement ids, 9 SCs), [plan.md](./plan.md),
[research.md](./research.md) (R1–R14, O1–O3), [data-model.md](./data-model.md),
[quickstart.md](./quickstart.md), [contracts/](./contracts/) ×4. Closes #331, #332, #390, #411, #292.

**Tests**: REQUIRED and test-first. Principle V is NON-NEGOTIABLE. Every implementation (GREEN) task
is preceded by the test (RED) task that proves it, at the layer [research.md](./research.md) R13
assigned, and no higher.

**E2E**: **net 0, 573 → 573.** Two declarations are added, both `@extended`, both in files already
in the serial tier of `packages/ui/tests/e2e/parallel-plan.json` (R13). Two existing declarations
are removed first, each only after the test that now holds its assertion has been observed failing
against a deliberately broken implementation (the 044 T163a – T163e pattern). Principle V: the budget
"may fall and MUST NOT rise", so it never reads above 573 at any task boundary. `@core` stays 39.

| Task | File | Tags | Budget after |
|---|---|---|---|
| T048a | removes a declaration from `pane-shortcuts.e2e.ts` | `@extended @window @reserve:input` | total 572, `@window` 196 |
| T048b | deletes `loaded-projects.e2e.ts` (its one declaration) | `@extended @window @reserve:window` | total 571, `@window` 195 |
| T049 | `window-chord-resolution.e2e.ts` | `@extended @window @reserve:input` | total 572, `@window` 196 |
| T065 | `terminal-no-orphans.e2e.ts` | `@extended @terminal @reserve:process` | total 573, `@terminal` 109 |

Each of those four tasks re-seeds `e2e-budget.json` **in the same task** (the ratchet fails both
ways) and adds its one-sentence reason to `measuredFrom`. No other task adds or removes a `test(`
declaration.

**Settled before this file was written** (controller rulings, not reopened here): `focus.explorer`
ships **Ctrl+Alt+F**; FR-026 physical matching is `Digit0`–`Digit9` **without Alt** only; the project
menu carries **Unload**, **Unload and Keep Terminals Running** and **Unload and End Terminals**.
~~The E2E budget rises by exactly 2.~~ *Superseded 2026-09-23 by controller ruling on analysis C1:
the rise is offset by T048a and T048b, net 0.*

## Format: `[ID] [P?] [Story] [derived?] Description`

- **[P]**: parallelisable. Its file footprint is disjoint from every other task in the same consecutive
  `[P]` run, and it depends on nothing unfinished. The shared files watched for this are listed under
  *Parallel runs* at the end.
- **[Story]**: US1–US5, on user-story phase tasks only.
- **[derived]**: the requirement is implied (by the plan, research, a contract or a constitutional
  rule) rather than stated in spec.md. The source is named in the task.
- **RED**: a test task. Run it and observe it FAIL before the GREEN task that follows it.
- **GREEN**: the implementation that turns the named RED task(s) green.
- Every task names exact repo-relative paths and the FR / SC ids it satisfies.

## Layer key

`unit(core)` / `unit(ui)` node · `component` jsdom · `integration` serial forks, real FS / SQLite /
shells · `contract` serial forks · `e2e` Playwright-on-Electron (`@core` / `@extended` plus one
category tag, declaration on one line). Load the **running-tests** skill before running anything and
**throng-testing** before any E2E. Never run the full E2E suite to find out whether something works:
run the one declaration a task names. `npm run gate` (T089) is the only evidence of done-ness.

## Owning agents

core/config → `throng-config-preferences` · core pure rules → `throng-core-architecture` ·
persistence, ipc-contract, daemon → `throng-daemon-persistence` · `terminal-service.ts`, main-process
terminal IPC → `throng-terminal-pty` · renderer → `throng-renderer-ui` · dialog copy →
`throng-failure-notices` · E2E → `throng-e2e-harness` · docs, CHANGELOG → `throng-spec-governance`.

---

## Phase 1: Setup

**Purpose**: none required. No new package, runtime dependency, tool or fixture tree
([plan.md](./plan.md) *Technical Context*: "No new runtime dependency"). Phase 2 starts directly.

---

## Phase 2: Foundational (blocking prerequisites)

**Purpose**: the pieces more than one story needs.

- The `projects` dispatch scope, `ActivePane = 'projects'` and `chordCandidates` are needed by US2
  and US3.
- The three icon tokens and the `SHIPPED_DEFAULTS_VERSION` bump are needed by US2 (cog), US4 (Unload)
  and US5 (categories).
- The category data layer, from migration v9 up to the renderer store, is needed by US2 (`listRows`
  drives the cycle and the tree) and US5.

**⚠️ No user story phase starts until this phase is complete.**

### RED

- [x] T001 [P] RED unit(core): extend `packages/core/tests/unit/keybindings-scope.test.ts`. Assert
  that `DispatchScope` includes `projects`, that `projects` is in `EVERYWHERE` and in no other scope
  set, that `SCOPE_NAMES.projects === 'Projects'`, that `SCOPE_ORDER` contains it, that an
  `EVERYWHERE` command still collapses to the single "Everywhere" pill, and that no `file.*`,
  `editor.*` or `search.*` command is live in `projects`. (FR-015, R3)
- [x] T002 [P] RED unit(ui): create `packages/ui/tests/unit/chord-candidates.test.ts` with every row
  of [contracts/keybindings-and-focus.md](./contracts/keybindings-and-focus.md) §2: US Ctrl+Shift+0,
  US Ctrl+0, US Ctrl+Shift+=, Swiss Ctrl+Shift+1, Czech Ctrl+Digit1, German Ctrl+ß, German AltGr+0,
  AZERTY AltGr+à, US Ctrl+Alt+0 and US-Intl Ctrl+Alt+P. Also assert that duplicates are removed and
  that the physical token comes first. (FR-021, FR-026, R2)
- [x] T003 [P] RED unit(ui): extend `packages/ui/tests/unit/scope.test.ts`. Assert that
  `currentScope` returns `projects` when the active pane is `projects`, `explorer` when it is
  `files`, and the active panel's kind when it is `workspace`. (FR-015, data-model §5)
- [x] T004 [P] RED unit(core): create `packages/core/tests/unit/project-list.test.ts`. Cover:
  - `listRows`: category order (default first, then `createdAt`, then `id`); projects in `position`
    order; a minimised category emits only its header, plus the active project with
    `pinnedActive = true`; `count` includes hidden projects; `collapsible === !isDefault`; an empty
    category is listed with `count` 0.
  - `reachableProjectIds`.
  - `stepProject`: with a project active, `null` at either end and with fewer than two reachable
    projects; skips projects in a minimised category; starts from a pinned active row.
    **[derived]** With `activeId === null` it returns the first project for `+1` and the last for
    `-1`, including when exactly one project is reachable. It returns `null` only with none reachable
    (R5; spec FR-011 *Recorded*).
  - `validateCategoryName`: trimmed, non-empty, unique ignoring case.
  - `mergeIntoDefault`: relative order kept, appended after the default category's members.

  (FR-011, FR-012, FR-050 – FR-054, FR-056, SC-007)
- [x] T005 [P] RED unit(core): create `packages/core/tests/unit/project-category-service.test.ts`
  over an in-memory fake of the category store port. Cover:
  - `list` and `create` call `ensureDefault` first, so a fresh owner gets "In Progress" from
    `SHIPPED_DEFAULT_CATEGORY_NAME`;
  - create, rename and delete refuse an empty name or a duplicate that differs only in case;
  - an unknown id is refused;
  - `delete` and `setMinimised` refuse the default category, whoever calls them;
  - `delete` moves the category's members into the default category in the order
    `mergeIntoDefault` gives.

  (FR-050, FR-051, FR-053, FR-054)
- [x] T006 [P] RED unit(core): extend `packages/core/tests/unit/project-service.test.ts`. Assert
  that `move(id, categoryId, orderedIds)` sets the category and rewrites the global order, and
  applies the same `orderedIds` validation `reorder` does. Assert that `create` assigns the owner's
  default category. (FR-055, FR-059)
- [x] T007 [P] RED unit(core + ui): assert the three new icon tokens `unload`, `category` and
  `projectList`:
  - in `packages/core/tests/unit/theme-copy.test.ts`: each exists in `THRONG_THEME.icons` with a
    label and a description;
  - in `packages/ui/tests/unit/icon-tokens-exist.test.ts`: each has an `SVG_SHAPES` entry;
  - in `packages/core/tests/unit/theme-link-tokens.test.ts:193`: move the pin from `11` to `12`,
    and add an assertion that an install recorded at version 11 receives the three tokens through
    the additive upgrade.

  (FR-061, R11, [contracts/menus.md](./contracts/menus.md) §4)
- [x] T008 [P] RED integration: create
  `packages/persistence/tests/integration/migration-v9.integration.test.ts`. Cover:
  - a fresh database reaches v9;
  - a v8 database holding three projects reaches v9 with all three in "In Progress" in their old
    `position` order;
  - **idempotent re-run**: running v9 a second time leaves every row identical;
  - an interrupted backfill (a category row inserted, projects still `''`) completes on the next run;
  - a database stamped 9 with `projects.category_id` missing is healed by `reconcileSchema`.

  Also move `LATEST_VERSION` from 8 to 9 in
  `packages/persistence/tests/integration/user-version-pin.integration.test.ts:36`, and add
  `projects.category_id` to
  `packages/persistence/tests/integration/migration-drift-repair.integration.test.ts`.
  (FR-058, SC-006, [contracts/project-categories.md](./contracts/project-categories.md) §3)
- [x] T009 [P] RED integration: create
  `packages/persistence/tests/integration/project-category-repository.integration.test.ts` against a
  real SQLite file. Cover:
  - `ensureDefault` and the partial unique index (a second default insert fails);
  - list order;
  - create, rename and `setMinimised`;
  - delete-merge in one transaction: the members are appended to the default category with their
    relative order kept, and the row is gone;
  - the read-time heal: a project with `category_id = ''` and a project with a dangling id both
    read back as the default category;
  - `ProjectRepository.create` lands a new project in the default category;
  - `ProjectRepository.move` sets the category and rewrites `position` in one transaction.

  (FR-050, FR-054, FR-055, FR-057, FR-059)
- [x] T010 [P] RED integration: create
  `packages/daemon/tests/integration/project-categories-ipc.integration.test.ts`. Drive the six new
  methods through the daemon router and assert every result shape and every `RpcError` in
  [contracts/project-categories.md](./contracts/project-categories.md) §1. Assert that
  `projects.list` returns `categoryId` resolved, and never `''`. (FR-050 – FR-057)
- [x] T011 [P] RED component: create
  `packages/ui/tests/component/projects-store-categories.test.ts`, mounting the projects store over a
  mocked bridge. Cover:
  - `categories` loads beside `projects`;
  - `createCategory`, `renameCategory`, `deleteCategory`, `setCategoryMinimised` and `moveProject`
    each call their RPC and then `projects.notifyChanged`;
  - a refusal surfaces through `fail(message, action, subject)` with the category as subject, never
    as a raw RPC string.

  (FR-053, FR-057, [contracts/project-categories.md](./contracts/project-categories.md) §1, §4)

### GREEN

- [x] T012 GREEN (T001): in `packages/core/src/config/keybindings.ts`, add `projects` to
  `DispatchScope`, join it to `EVERYWHERE` only, and add it to `SCOPE_NAMES` and `SCOPE_ORDER`.
  **Unknown footprint**: fix every exhaustive `Record<DispatchScope, …>` or `switch` that `tsc`
  reports outside this file, and list those files in the commit body. (FR-015, R3)
- [x] T013 [P] GREEN (T002): add `chordCandidates(e)` beside `chordKey` in
  `packages/ui/src/renderer/config/chord-key.ts`. It returns the physical digit token only for
  `Digit0`–`Digit9` with Ctrl held and Alt not held, keeping Shift; then the produced token; then
  removes duplicates. It is not wired yet (T050 – T052). (FR-026, FR-021, R2)
- [x] T014 [P] GREEN (T004, T005, T006): create `packages/core/src/projects/project-list.ts`
  (`listRows`, `reachableProjectIds`, `stepProject`, `validateCategoryName`, `mergeIntoDefault`) and
  `packages/core/src/projects/categories.ts` (`ProjectCategory`, `SHIPPED_DEFAULT_CATEGORY_NAME =
  'In Progress'`, the store port, `ProjectCategoryService`). Add `categoryId` to
  `packages/core/src/projects/project.ts`. Add `move()` and default-category assignment on create to
  `packages/core/src/projects/project-service.ts`. Export the new symbols from
  `packages/core/src/index.ts`. (FR-050 – FR-056, FR-059, Principle X)
- [x] T015 [P] GREEN (T007): add the glyphs `unload`, `category` and `projectList` to
  `THRONG_THEME.icons` in `packages/core/src/config/theme.ts`. Add their labels and descriptions in
  `packages/core/src/config/theme-copy.ts` and their art in the `SVG_SHAPES` of
  `packages/ui/src/main/icon-pack-service.ts`. Move `SHIPPED_DEFAULTS_VERSION` from 11 to 12 in
  `packages/core/src/config/shipped-defaults.ts`, and rewrite its comment to name the payload (three
  icon tokens), as the file's own "a bump needs a payload" rule demands. No colour token is added.
  (FR-061, R11)
- [x] T016 [P] GREEN (T003, T012): widen `ActivePane` to `'files' | 'workspace' | 'projects'` in
  `packages/ui/src/renderer/workspace/active-pane.ts`, and return `projects` from `currentScope` in
  `packages/ui/src/renderer/keybindings/scope.ts`. (FR-015)
- [x] T017 [P] GREEN (T008, T014): create
  `packages/persistence/src/migrations/v9-project-categories.ts`. It runs `CREATE TABLE IF NOT
  EXISTS project_categories`, the owner index and the partial unique index `WHERE is_default = 1`;
  then `addColumnsFor(db, 'projects')`; then a `WHERE NOT EXISTS` default insert per owner, named
  from `SHIPPED_DEFAULT_CATEGORY_NAME`; then `UPDATE … WHERE category_id = ''`. Register it in
  `packages/persistence/src/migration-runner.ts` (`LATEST_VERSION` 9). Add
  `projects.category_id TEXT NOT NULL DEFAULT ''` to `ADDITIVE_COLUMNS` in
  `packages/persistence/src/schema-guard.ts`. (FR-058, R9)
- [x] T018 [P] GREEN (T010, types only): in `packages/ipc-contract/src/projects.ts`, add
  `ProjectDto.categoryId`, `ProjectCategoryDto`, the six method constants
  (`projects.categories.list/create/rename/delete/setMinimised`, `projects.move`) and their param
  and result types. Re-export them from `packages/ipc-contract/src/index.ts`. (FR-050 – FR-057)
- [x] T019 GREEN (T009, T017): create `packages/persistence/src/project-category-repository.ts`
  (`ensureDefault`, `list`, `create`, `rename`, `deleteMerge`, `setMinimised`). In
  `packages/persistence/src/project-repository.ts`, read `category_id` with the heal rule, assign the
  default category on create, and add `move()`. Export from `packages/persistence/src/index.ts`.
  (FR-054, FR-055, FR-057, FR-059)
- [x] T020 GREEN (T010, T014, T018, T019): in `packages/daemon/src/project-service.ts`, register
  the six handlers, inject `ProjectCategoryService` by constructor, and refuse invalid input with
  `RpcError` as `PROJECTS_UPDATE_METHOD` does. Bind `ProjectCategoryRepository` and
  `ProjectCategoryService` in `packages/daemon/src/composition-root.ts`. (Principle IX, FR-050 –
  FR-057)
- [x] T021 GREEN (T011, T018): add the six wrappers to
  `packages/ui/src/renderer/state/projects-client.ts`. Add `categories` and the actions
  `createCategory`, `renameCategory`, `deleteCategory`, `setCategoryMinimised` and `moveProject` to
  `packages/ui/src/renderer/state/projects-store.tsx`, with `notifyChanged` and the `fail` path.
  (FR-053, FR-057)

**Checkpoint**: the scope, matcher, tokens and category data layer exist, and the integration tier
proves migration v9. Nothing is visible to a user yet.

---

## Phase 3: User Story 1, one name for the file tree (Priority: P1) 🎯 MVP

**Goal**: every surface calls the right-hand tree **File Explorer**. No identifier changes.

**Independent Test**: read every surface in FR-001, then run
`git grep -n -e "Files & Folders" -e "Files &amp; Folders" -e "Files and Folders" -- packages/*/src README.md CONTRIBUTING.md docs`.
It prints nothing, and a config directory from the previous build loads with no warning.

### RED

- [x] T022 [P] [US1] RED unit(ui): create `packages/ui/tests/unit/file-explorer-name.test.ts`.
  - Scan `packages/*/src`, `README.md`, `CONTRIBUTING.md` and `docs/` for the three spellings, and
    fail on any match with its file and line.
  - Exclude `specs/`, `.specify/memory/constitution.md`, `CHANGELOG.md` and `packages/*/tests`.
    **[derived]** CHANGELOG is excluded as a record, on FR-004's reasoning: its released entries
    already name the pane as it was called then, and T087's line names the old title so a reader can
    find the rename. FR-002 and SC-001 are read as covering the living docs only.
  - Also assert that the identifiers FR-003 freezes still exist as keys: `view.toggleExplorer`,
    `panes.fileExplorer.maxWidth` and `explorer.autoRevealActiveFile` (corrected at implementation:
    the setting is `explorer.autoRevealActiveFile`, not `explorer.followActiveEditor`, which does not
    exist).

  (FR-002, FR-003, FR-004, SC-001)
- [x] T023 [P] [US1] RED component + unit(ui): assert the user-visible names.
  - `packages/ui/tests/component/file-explorer-pane.test.ts`: the header reads "File Explorer".
  - `packages/ui/tests/component/preview-header-actions.test.ts`: the menu item reads "Reveal File
    in File Explorer".
  - `packages/ui/tests/unit/menu-sections.test.ts`: the same label.
  - **[derived]** The rail label and its Show/Hide tooltip are drawn by `app.tsx`, which no
    component test mounts. So the existing declaration *"right pane: rail only while collapsed;
    expand reveals the explorer"* (`packages/ui/tests/e2e/panes.e2e.ts:125`) gains two assertions:
    the rail reads "File Explorer", and `pane-show-right` is titled "Show File Explorer" and
    `pane-hide-right` "Hide File Explorer". This adds a case to a declaration, not a new one, so the
    budget is unchanged.

  (FR-001, US1 scenarios 1 – 3)

### GREEN

- [x] T024 [P] [US1] GREEN (T022): rename to "File Explorer" in core sources and comments.
  - Config: `packages/core/src/config/app-settings.ts`, `keybindings-metadata.ts`,
    `keybindings.ts`, `preview-settings.ts`, `settings-metadata.ts`, `theme-copy.ts` and `theme.ts`.
  - Elsewhere: `packages/core/src/explorer/exclude.ts`, `packages/core/src/preview/registry.ts`,
    `packages/core/src/terminal/drop-paths.ts` and `packages/core/src/workspace/menu-sections.ts`.

  Copy only (FR-003). (FR-001)
- [x] T025 [P] [US1] GREEN (T022): rename in `packages/ui/src/main/editor-coordinator.ts`,
  `packages/ui/src/main/node-file-watcher.ts` and `packages/ui/src/main/preview-service.ts`
  (comments). (FR-001, FR-002)
- [x] T026 [P] [US1] GREEN (T022, T023): rename in the renderer, under `packages/ui/src/renderer/`.
  - Root: `app.tsx` (rail label and the Show/Hide tooltip at `:1003`/`:1012`, plus comments),
    `context-menu-provider.tsx` and `theme.css`.
  - `common/use-hover-suppression.ts`.
  - `editor/`: `editor-open.tsx`, `open-router.ts` and `tree-drop-target.tsx`.
  - `explorer/`: `explorer-commands.ts` and `use-explorer-data.ts`.
  - `keybindings/scope.ts`, `navigate/navigation-chrome.tsx` and `navigation/navigate-history.ts`.
  - `panel-type/editor-inputs.tsx` (the empty-editor placeholder).
  - `panes/`: `file-explorer-pane.tsx` (header) and `panes.css`.
  - `preview/`: `open-preview.ts`, `preview-commands.tsx`, `preview-link-notice.tsx` and
    `preview-panel.tsx`.
  - `terminal/terminal-panel.tsx`.
  - `workspace/`: `active-pane.ts`, `context-menu.tsx`, `panel-header-menu.ts` (the menu item) and
    `tab-group.tsx`.

  No CSS class, `data-testid` or command id changes. (FR-001, FR-003)
- [x] T027 [P] [US1] GREEN (T022): rename in `README.md`, `CONTRIBUTING.md`, `docs/quick-start.md`
  and `docs/testing.md`. This covers only the rename; new content comes in T083 – T086. (FR-001,
  FR-071)
- [x] T028 [P] [US1] Update the non-E2E tests that carry the old name or locate the pane by it:
  - core: `packages/core/tests/unit/menu-sections.test.ts` and
    `packages/core/tests/unit/settings-inertness-044.test.ts`;
  - component, under `packages/ui/tests/component/`: `confirm-modality.test.ts`,
    `editor-open-router.test.ts`, `explorer-collapsed-removal.test.ts`,
    `explorer-open-in-preview.test.ts`, `explorer-root-menu.test.ts`,
    `find-in-files-open-in.test.ts`, `menu-keyboard.test.ts`, `menu-section-rendering.test.ts`,
    `navigate-history.test.ts`, `open-preview.test.ts`, `preferences-capture-modal.test.ts`,
    `preview-entry-wiring.test.ts`, `preview-follow.test.ts`, `preview-provider-seam.test.ts`,
    `preview-read-only.test.ts`, `preview-unsaved-markers.test.ts`,
    `status-strip-preview-button.test.ts` and `tree-drop-target.test.ts`;
  - `packages/ui/tests/integration/editor-load-navigation.integration.test.ts`;
  - unit, under `packages/ui/tests/unit/`: `explorer-commands.test.ts`,
    `explorer-preview-target.test.ts` and `preview-surfaces-name-no-provider.test.ts`.

  (FR-001)
- [x] T029 [P] [US1] Update the E2E specs that locate the pane by its old accessible name or carry
  the old name.
  - Specs, under `packages/ui/tests/e2e/`: `editor-basics`, `editor-feedback2`, `editor-feedback3`,
    `explorer-follow-active-editor`, `explorer-keyboard-selection`, `explorer-live-sync`,
    `explorer-new-items`, `explorer-rename-focus`, `explorer-selection-visibility`,
    `explorer-tree-state`, `fileop-undo`, `goto-line-keybinding`, `goto-line`, `hover-suppression`,
    `menu-keyboard`, `navigation-remember`, `notice-subjects`, `pane-shortcuts`, `preview-scroll`,
    `project-missing-root-wedge`, `quick-open-toolbar`, `terminal-path-drop`, `theme-fields` and
    `window-chord-resolution` (each is `<name>.e2e.ts`).
  - Helper: `packages/ui/tests/e2e/helpers/navigation.ts`.

  Do NOT edit the history in `e2e-budget.json`'s `measuredFrom`: it is a record, like CHANGELOG.
  The declaration count must not change, and `e2e-tags.test.ts` must stay green. Run only the
  touched specs whose locators changed, never the full suite. (FR-001, US1 scenario 2)

**Checkpoint**: T022 is green, and the name is the same on every surface.

---

## Phase 4: User Story 2, switch project and reach the side panes from the keyboard (Priority: P1)

**Goal**: `project.next`, `project.previous`, `focus.explorer` and `focus.projects`, live everywhere,
with a cog menu route. The Projects pane becomes a keyboard tree.

**Independent Test**: with three projects and focus in a terminal, press Ctrl+Alt+PageDown twice.
The title bar changes twice and the terminal receives nothing. Press Ctrl+Alt+F, then F2, and the
selected tree entry goes into rename.

### RED

- [x] T030 [P] [US2] RED unit(core), **the FR-020 tier and exception-list test**:
  - `packages/core/tests/unit/keybindings.test.ts`: the four ids are `EVERYWHERE` with Windows
    defaults Ctrl+Alt+PageDown, Ctrl+Alt+PageUp, **Ctrl+Alt+F** and Ctrl+Alt+P, and
    `SHADOWABLE_EXCEPTIONS` still has exactly four entries (`:132`).
  - `packages/core/tests/unit/terminal-reserved-keys.test.ts`: none of the four chords is in
    `RESERVED` or `SHADOWABLE`.
  - `packages/core/tests/unit/keybindings-collision.test.ts`: no chord resolves to two commands in
    any scope, `projects` included.
  - `packages/core/tests/unit/keybindings.file.test.ts`: a saved user keybindings object lacking the
    four ids resolves them to shipped defaults without the file being rewritten.

  (FR-020, FR-021, FR-022, FR-023)
- [x] T031 [P] [US2] RED unit(core): extend `packages/core/tests/unit/keybindings-metadata.test.ts`.
  Assert four descriptors in group `View` labelled Next Project, Previous Project, Focus File
  Explorer and Focus Projects, each with a description. (FR-022, FR-070, configuration-editor
  completeness)
- [x] T032 [P] [US2] RED unit(ui): extend `packages/ui/tests/unit/scope.test.ts`. Assert that
  `isPanelScoped` treats `project.next` and `project.previous` as window commands by **exact** match,
  so that an unrelated `project.`-prefixed id is not swept in. (data-model §4)
- [x] T033 [P] [US2] RED component: create
  `packages/ui/tests/component/side-pane-focus-commands.test.ts`. Drive `KeybindingsHandler` through
  `packages/ui/tests/shared/window-chords.ts`.
  - **Cycling.** With focus in a terminal, `project.next` and `project.previous` call the same
    `switchProject` a click calls, the title bar shows the switch, the event is prevented and never
    reaches the terminal, the status bar shows the new project too (FR-013), they stop at the ends
    with no notice, they skip projects in a minimised
    category, and the Projects pane's visibility does not change.
    **[derived]** With no active project they go to the first or last reachable project (R5).
  - **`focus.explorer`.** With the right pane hidden, it reveals the pane through the same persisted
    setter as the show control, sets the active pane to `files`, and focuses the selected node or
    the first node. A following F2 dispatches `file.rename`.
    **[derived]** With no project open it focuses the empty placeholder (contract §1).
  - **`focus.projects`.** With the left pane hidden, it reveals the pane, focuses the active row
    (the first row with no active project, the create control with no projects), and puts the
    `--active` outline on the pane. F2 there does **not** dispatch `file.rename` (R3).
  - **Unchanged.** `focus.left/right/up/down/cycle` never land on a side pane.
  - **The manifest claim** (analysis H1). In `packages/ui/tests/shared/window-chords.ts`, claim
    `focus.projects` in `COVERED_IN_COMPONENT` as
    `{ test: 'side-pane-focus-commands.test.ts', key: 'p', mods: ['ctrlKey', 'altKey'] }`.
    This file presses that chord, and `packages/ui/tests/unit/window-chord-manifest.test.ts` checks
    the claim. `focus.explorer` is claimed in `COVERED` by T049, so the manifest test is expected red
    for it from T041 until T049, as it already is for `zoom.reset` from T044.

  (FR-010 – FR-018, FR-024, SC-002, SC-003)
- [x] T034 [P] [US2] RED component: create
  `packages/ui/tests/component/projects-panel-keyboard.test.ts`.
  - Markup: `role="tree"`; headers are `treeitem` at `aria-level=1`, with `aria-expanded` except on
    the default category; projects are `treeitem` at `aria-level=2`; roving tabindex.
  - Keys: ArrowUp and ArrowDown move one row, Home and End go to the first and last row, and Enter on
    a project row switches. Moving alone never switches. Enter on the default header does nothing.
  - `pointerdown` and `focusin` set the active pane to `projects`.
    **[derived]** A `pointerdown` in the Sub-workspaces panel does not (T040, A1).
  - The existing `project-item`, `project-list` classes and every `data-testid` are still present.

  (FR-015, FR-018, R4)
- [x] T035 [P] [US2] RED component + unit(ui): the cog Navigate section.
  - `packages/ui/tests/component/title-bar.test.ts`: the cog lists Next Project, Previous Project,
    Focus File Explorer and Focus Projects in a `navigate` section before `application`, each
    showing its live chord. Next and Previous are disabled when `stepProject` returns `null`.
    Choosing an item runs the same handler as the chord.
  - `packages/ui/tests/unit/menu-sections.test.ts`: a `shapeOf` pin for the cog's new
    `[navigate, application]` shape.

  (FR-019, FR-070, Principle VI)
- [x] T036 [P] [US2] RED component: extend
  `packages/ui/tests/component/preferences-keybindings-tab.test.ts`. The four commands appear in the
  View group with their labels, and a rebinding changes the live dispatch with no reload. (FR-022,
  FR-070)

### GREEN

- [x] T037 [US2] GREEN (T030, T031): add the four `ActionId`s, their `COMMAND_SCOPES` (`EVERYWHERE`)
  and `WINDOWS_BINDINGS` to `packages/core/src/config/keybindings.ts`. Add four descriptors in
  group `View` to `packages/core/src/config/keybindings-metadata.ts`. (FR-010, FR-020, FR-022)
- [x] T038 [P] [US2] GREEN (T032): add `project.next` and `project.previous` as exact matches to
  `isPanelScoped` in `packages/ui/src/renderer/keybindings/scope.ts`. (data-model §4)
- [x] T039 [P] [US2] [derived] GREEN (T033, File Explorer half): in
  `packages/ui/src/renderer/panes/file-explorer-pane.tsx`, set the active pane to `files` on
  `focusin` as well as `pointerdown`. Expose a `focusSelectedOrFirst()` handle from
  `packages/ui/src/renderer/explorer/file-tree.tsx`, over react-arborist's `focus`, if the existing
  imperative handle does not already provide one. The `focusin` hook comes from R3: FR-017 requires
  it but does not state it. (FR-017)
- [x] T040 [P] [US2] GREEN (T034): in `packages/ui/src/renderer/sidebar/projects-panel.tsx`, render
  the list from `listRows` as an ARIA tree with roving tabindex and a focused-row pointer
  (`project:<id>` or `category:<id>`, carried as `data-project-row-focused` on whichever row, header
  or project, holds focus). Handle Arrow, Home, End and Enter.
  **[derived]** (analysis A1) The focus target is the **Projects Panel**, meaning the project list,
  not the whole sidebar. The outline surrounds that panel's body. A click in the Sub-workspaces panel
  leaves the active pane as it is today (plan: no `sidebar` scope, YAGNI). Set the active pane on `pointerdown`
  and `focusin`, apply the `--active` modifier, and expose `focusActiveRow()`. Extend the outline
  selector in `packages/ui/src/renderer/panes/panes.css` to the Projects pane body. Add tree-row
  styles to `packages/ui/src/renderer/theme.css`. Keep every existing class and `data-testid`.
  (FR-015, FR-018)
- [x] T041 [US2] GREEN (T033, T037 – T040): in `packages/ui/src/renderer/app.tsx`:
  - add the four ids to `WINDOW_HANDLED_ACTIONS`;
  - dispatch `project.next` and `project.previous` as `switchProject(stepProject(reachableProjectIds(listRows(…)), activeId, ±1))`,
    doing nothing on `null`;
  - add idempotent `revealLeft()` and `revealRight()` over the pane show setters
    (`throng.sidebarVisible`, `throng.explorerVisible` or `throng.explorerVisibleNoProject`);
  - dispatch `focus.projects` and `focus.explorer` as reveal, then set the active pane, then focus
    after render.

  (FR-010 – FR-017)
- [x] T042 [US2] GREEN (T035, T041): add the `navigate` section to
  `packages/ui/src/renderer/title-bar/cog-menu-items.ts`, with icons `moveDown`, `moveUp`, `folder`
  and `projectList`, `shortcut` from the live keybindings, and `disabled` from `stepProject`. Pass
  the dispatch callback and the step state through `packages/ui/src/renderer/title-bar/cog-menu.tsx`.
  (FR-019)
- [x] T043 [US2] [derived] Keep the E2E locators working after the list became a tree. Run
  `git grep -n "getByRole('list\|getByRole('listitem\|role=list" packages/ui/tests/e2e`. Update every
  hit that targets the project list, for example in `packages/ui/tests/e2e/harness.ts` and
  `packages/ui/tests/e2e/sidebar.e2e.ts`. Rows keep `project-item` and their `data-testid`s (T040),
  so class-based locators need no change. **Unknown footprint** until the grep runs. Record the
  files touched in the commit body. The declaration count must not change. (FR-003 in spirit, R4)

**Checkpoint**: US2 is testable on its own, with only the default category.

---

## Phase 5: User Story 3, reset zoom with the Shift key still held (Priority: P3)

**Goal**: Ctrl+Shift+0 resets zoom on any layout, and every existing chord keeps its meaning.

**Independent Test**: zoom in twice and press Ctrl+Shift+0. The zoom is back to 100%.

### RED

- [x] T044 [US3] Test infrastructure (plan R2): make
  `packages/ui/tests/shared/window-chords.ts` import `chordCandidates` rather than re-derive the
  Shift rule (`:100-102`), and let its event builder set `code` (for example `Digit0`) alongside
  `key`. `packages/ui/tests/unit/window-chord-manifest.test.ts` should then discover
  `zoom.reset → Ctrl+Shift+0` as a Shift-keeping chord and go **red** until T049 claims it in
  `COVERED`. This task is not `[P]`, because T045 – T048 use the builder. (FR-026, SC-021 of 043)
- [x] T045 [P] [US3] RED unit(core): extend `packages/core/tests/unit/keybindings.test.ts`.
  - `zoom.reset` ships Ctrl+0, Ctrl+Shift+0 and Ctrl+MiddleClick, and `panel.zoomReset` still ships
    Ctrl+Alt+0.
  - A user override of `zoom.reset` resolves to exactly the user's chords, so Ctrl+Shift+0 is not
    merged in (026 FR-030).
  - Resetting the binding restores all three.

  (FR-025, US3 scenario 3, spec Edge Cases)
- [x] T046 [P] [US3] RED component: create
  `packages/ui/tests/component/window-zoom-reset-shift.test.ts`, using the T044 builder. Check each
  case with focus in a terminal, an editor and a find input:
  - Ctrl+Shift+0 (`key ')'`, `code 'Digit0'`) resets zoom and is prevented;
  - Ctrl++, Ctrl+= and Ctrl+- keep their meanings;
  - German AltGr+0 (`}`, Ctrl+Alt) fires nothing and is not prevented.

  (FR-026, FR-027, SC-004, R2)
- [x] T047 [P] [US3] [derived] RED component: extend
  `packages/ui/tests/component/preferences-capture-modal.test.ts`. Pressing Ctrl+Shift+0 records
  `Ctrl+Shift+0`, not `Ctrl+Shift+)`. R2 derives this as the prerequisite for US3 scenario 3 to
  round-trip.
- [x] T048 [P] [US3] RED component: extend
  `packages/ui/tests/component/preferences-keybindings-tab.test.ts`. Reset Zoom lists Ctrl+0,
  Ctrl+Shift+0 and Ctrl+MiddleClick, and resetting it restores all three. (US3 scenario 3)
- [x] T048a [derived] E2E offset 1 of 2 (Principle V ratchet; analysis C1). Remove
  *"Ctrl+Alt+B toggles the Projects pane and Ctrl+Alt+N toggles the Files & Folders pane"* (T029 may
  already have renamed it to "…the File Explorer pane") from
  `packages/ui/tests/e2e/pane-shortcuts.e2e.ts:72`.
  - **Where its assertion lives.** It is an exact duplicate of *"the pane toggles still resolve —
    Ctrl+Alt+B and Ctrl+Alt+N"* in `packages/ui/tests/e2e/window-chord-resolution.e2e.ts:175`: the
    same presses, the same `pane-hide-*` / `pane-rail-*` assertions. That declaration is also the
    one `COVERED` in `packages/ui/tests/shared/window-chords.ts:122-123` names for both toggles. No
    lower layer mounts `app.tsx`'s pane rails, so the surviving E2E is what holds it, and the removal
    is a de-duplication rather than a demotion.
  - **Observed failing first.** Break `view.toggleProjects`' dispatch in
    `packages/ui/src/renderer/app.tsx`, run `window-chord-resolution.e2e.ts:175` alone, see it fail,
    and revert the break.
  - **The rest of the file.** Rewrite the header comment at `:22-38`, which describes two tests
    sharing one app. Keep the `afterEach` re-expansion, and update the `pane-shortcuts.e2e.ts` row in
    `packages/ui/tests/e2e/launch-sharing.md:129`.
  - **The budget.** In `packages/ui/tests/e2e/e2e-budget.json`, `total` 573 → 572 and `@window`
    197 → 196, with the sentence in `measuredFrom`.
- [x] T048b [derived] E2E offset 2 of 2 (Principle V ratchet; analysis C1). Demote
  *"indicates loaded vs not-loaded projects"* (`packages/ui/tests/e2e/loaded-projects.e2e.ts:13`, the
  file's only declaration) to component.
  - **The component test.** Create
    `packages/ui/tests/component/projects-panel-loaded-style.test.ts`, mounting `ProjectsPanel` the
    way `packages/ui/tests/component/projects-panel-form.test.ts` does, seeded with one persisted
    project and a fresh store. That is exactly what a restart gives, because loaded state is
    session-only (spec *Key Entities*).
    - Assert `data-loaded="false"`, `project-item--unloaded`, no `.throng-unsaved-dot` and no
      `.project-item__loaded`.
    - Click the switch control, and assert `data-loaded="true"` and `project-item--unloaded` gone.
    - **The painted italic does not move here** (analysis K1). Principle V says the component layer
      cannot tell how an element was painted. The E2E's `getComputedStyle(...).fontStyle` assertion
      moves instead into T065's declaration, as an extra case after Unload (see T065). The budget is
      unchanged.
  - **Observed failing first.** Drop the `--unloaded` modifier in
    `packages/ui/src/renderer/sidebar/projects-panel.tsx`, see the test fail, and revert.
  - **The E2E file.** Delete `packages/ui/tests/e2e/loaded-projects.e2e.ts`, and remove its row from
    `packages/ui/tests/e2e/launch-sharing.md:125`.
  - **The budget.** In `packages/ui/tests/e2e/e2e-budget.json`, `total` 572 → 571 and `@window`
    196 → 195, with the sentence in `measuredFrom`.
- [x] T049 [US3] RED e2e, and re-seed the budget in the same task:
  - **The declaration.** Add ONE declaration to
    `packages/ui/tests/e2e/window-chord-resolution.e2e.ts`, tagged
    `{ tag: ['@extended', '@window', '@reserve:input'] }` on a single line. From a focused **real
    terminal** running a byte echo (`cat -v`), a real Ctrl+Shift+0 resets a zoomed window, a real
    Ctrl+Alt+PageDown switches project, and a real Ctrl+Alt+F focuses the File Explorer. The shell
    receives no bytes for any of them.
  - **The manifest.** Claim `zoom.reset` and **`focus.explorer`** (analysis H1: this declaration
    presses Ctrl+Alt+F) in `COVERED` in `packages/ui/tests/shared/window-chords.ts`.
    `packages/ui/tests/unit/window-chord-manifest.test.ts` then goes green for both.
  - **The budget.** In `packages/ui/tests/e2e/e2e-budget.json`, move `total` from 571 to 572 and
    `@window` from 195 to 196 (after T048a and T048b). Append the reason sentence to `measuredFrom`: only a real engine
    reports `e.key` and `e.code` for a shifted digit, and Principle V names layout-dependent chords
    as what a synthesised event cannot prove.
  - **The tier plan.** Leave `packages/ui/tests/e2e/parallel-plan.json` unchanged. Confirm that
    `window-chord-resolution.e2e.ts` is already in the serial tier.

  Run this one declaration only and observe it fail on Ctrl+Shift+0. (FR-010, FR-027, SC-002, SC-004,
  R13)

### GREEN

- [x] T050 [P] [US3] GREEN (T045): add Ctrl+Shift+0 to `zoom.reset`'s Windows defaults in
  `packages/core/src/config/keybindings.ts`, and name it in the `zoom.reset` description in
  `packages/core/src/config/keybindings-metadata.ts`. (FR-025)
- [x] T051 [P] [US3] GREEN (T046, T049): in `packages/ui/src/renderer/app.tsx`, resolve the keydown
  through `chordCandidates(e)`, taking the first candidate that names a command live in the current
  scope. The existing Shift rule is kept inside the produced token. (FR-026, FR-027)
- [x] T052 [P] [US3] [derived] GREEN (T047): record `chordCandidates(e)[0]` in
  `packages/ui/src/renderer/preferences/capture-modal.tsx`. (R2)
- [x] T052a [US3] [derived] RED+GREEN unit(core) + UI-main: an EXISTING install's `zoom.reset` never
  received Ctrl+Shift+0 — `seed()` writes it at first run, so it is never MISSING and 026 FR-030's
  per-read fill never reaches it. Add `planKeybindingsUpgrade`/`applyKeybindingsUpgrade` and the
  frozen `V11_ZOOM_RESET_BINDING` guard to `packages/core/src/config/shipped-defaults.ts`
  (RED/GREEN in `packages/core/tests/unit/shipped-defaults-upgrade-v12-keybindings.test.ts`), and
  wire the guarded rewrite into `ShippedDefaultsService.upgrade()` in
  `packages/ui/src/main/shipped-defaults-service.ts`, under the existing `keybindings` document
  lock. (FR-025, controller ruling narrowing 026 FR-030 the way 043 FR-074/FR-075 already narrows it
  for settings)

**Checkpoint**: T044 – T049 are green, and so are the existing zoom tests.

---

## Phase 6: User Story 4, a right-click menu on a project, with Unload (Priority: P2)

**Goal**: a project row menu with Edit, Rename, Remove and the three Unload rows. Unload releases the
main window's view of a project without forgetting anything, under two new preferences.

**Independent Test**: open two projects, right-click the non-active one and choose Unload. Its row
turns greyed and italic. Select it and its previous layout comes back.

### RED

- [x] T053 [P] [US4] RED unit(core): create `packages/core/tests/unit/unload-plan.test.ts`.
  - The whole `planUnload` truth table in data-model §8: busy 0 at every level; `none` with and
    without a variant; `single`; and `double`, where only End terminals adds `confirmEnd`.
    **[derived]** A variant row keeps the dialogs and changes only the focused button (R8).
  - `projectPanelIdsInSubWorkspaces` returns only this project's panels held by a sub-workspace.

  (FR-034, FR-034c, FR-037, SC-005a)
- [x] T054 [P] [US4] RED unit(core): create `packages/core/tests/unit/app-settings-unload.test.ts`.
  `confirmations.unloadProject` defaults to `double` and `projects.unloadTerminalAction` to
  `keepRunning`. An unknown value falls back to the default, and clone keeps both. (FR-034a,
  FR-034b)
- [x] T055 [P] [US4] RED unit(core): extend `packages/core/tests/unit/settings-metadata.test.ts`.
  Two descriptors in the Confirmations group, with `unloadProject` beside `destroyProject` using the
  same `confirmDescriptor()` control and `unloadTerminalAction` directly after it, with the labels
  and `optionLabels` in data-model §3. (FR-034a, FR-034b, configuration-editor completeness)
- [x] T056 [P] [US4] RED integration: create
  `packages/daemon/tests/integration/terminal-unload-filters.integration.test.ts` against real
  sessions (`ping -n 30`, as `terminal-reattach.integration.test.ts` does).
  - `closeIdle {projectId, exceptPanelIds}` spares the busy session and the excepted panel, and
    closes the idle one.
  - `killAll {projectId, exceptPanelIds}` spares only the excepted panel.
  - **[derived]** Both skip `rootless` sessions when scoped to a project (R7).
  - `killAll {}` with no `projectId` is unchanged (app close).

  (FR-034, FR-037)
- [x] T057 [P] [US4] [derived] RED unit(ui): create `packages/ui/tests/unit/terminal-ipc-unload.test.ts`,
  mocking `electron`'s `ipcMain` as `packages/ui/tests/unit/terminal-attach-env.test.ts` does.
  `throng:terminal:closeIdle` and `throng:terminal:killAll` forward `{projectId, exceptPanelIds}`,
  and `throng:terminal:list` forwards `includeBusy`. The renderer reaches the daemon only through
  these handlers, which the plan does not list. (FR-034c, FR-037)
- [x] T058 [P] [US4] RED contract: extend
  `packages/ui/tests/contract/config-write-patch.contract.test.ts`. Both new settings round-trip
  through the config write path. (FR-034a, FR-034b)
- [x] T059 [P] [US4] RED component: create `packages/ui/tests/component/unload-project.test.ts`
  over a mocked bridge.
  - **The unsaved guard.** A dirty project raises `promptDirtyClose` first. Cancel leaves it loaded
    and unchanged. Save goes through `editor.saveAll`, and discard continues.
  - **The dialogs.** At `none` there is no dialog and the default action applies. At `single` there
    is one three-button dialog naming the busy processes, with the default action's button focused.
    At `double`, End terminals asks "Are you absolutely sure?" and Keep running asks nothing more.
    Cancel at any step changes nothing.
  - **[derived]** The variant rows: at `none` they perform their own action, and otherwise they
    focus their own button (R8).
  - **The release.** `unloadProject` runs before `closeIdle` or `killAll`. `exceptPanelIds` is
    passed through. Editors are disposed except those held by a sub-workspace. Unloading the active
    project leaves no project active. A step-6 failure goes to `fail` with the project as subject.

  (FR-034 – FR-037, SC-005a)
- [x] T060 [P] [US4] RED component: create `packages/ui/tests/component/projects-panel-menu.test.ts`.
  - Right-click opens Edit, Rename, Remove and the three Unload rows, with their icons.
  - Shift+F10 and the ContextMenu key on a focused row open the same menu, through the `menu.open`
    redirect with `KeybindingsHandler`.
  - Edit, Rename and Remove behave exactly as the inline ✎, a double-click and the inline ✕, and
    Remove keeps its confirmation and unsaved guard. The inline controls remain.
  - All three Unload rows are drawn and disabled on an unloaded project.
  - Escape closes the menu and returns focus to the row.

  (FR-030, FR-031, FR-038)
- [x] T061 [P] [US4] RED unit(ui): extend `packages/ui/tests/unit/menu-sections.test.ts` with a
  `shapeOf` pin for the project row menu: `content`, `destroy`, `viewState`, with dividers derived.
  (FR-030, Principle VI)
- [x] T062 [P] [US4] RED component: create `packages/ui/tests/component/projects-store-unload.test.ts`.
  `unloadProject(id)` removes the id from `loadedIds`, and sets `openedId` to `null` only when that
  project is active. A later `switchProject(id)` loads it as usual. (FR-032, FR-036, data-model §6)
- [x] T063 [P] [US4] RED component: create
  `packages/ui/tests/component/preferences-unload-settings.test.ts`. The preferences editor's
  Confirmations group shows both new controls with their labels and descriptions, and a change
  writes the key. (FR-034a, FR-034b)
- [x] T064 [P] [US4] RED component: create
  `packages/ui/tests/component/unload-layout-restore.test.ts` with
  `packages/ui/tests/component/helpers/mount-workspace.ts`. Unloading flushes pending layout saves
  and deletes nothing from the saved layout, and selecting the project again restores the same tabs
  and panels.
  **[derived]** On that reload, a terminal spared by Keep running with a busy session calls
  `attach {explicit:false}` and reattaches. A terminal ended by End terminals mounts through the same
  call and gets a new shell ([contracts/unload.md](./contracts/unload.md) §2, *The next load*).
  (FR-033, FR-034, SC-005, US4 scenarios 5 and 7)
- [x] T065 [US4] RED e2e, and re-seed the budget in the same task:
  - **The declaration.** Add ONE declaration to `packages/ui/tests/e2e/terminal-no-orphans.e2e.ts`,
    tagged `{ tag: ['@extended', '@terminal', '@reserve:process'] }` on a single line.
    - Unload with **End terminals** returns the project's conhost count to baseline.
    - Unload with **Keep running** and only an idle shell does the same.
    - Both go through the project row's context menu and its dialogs.
    - **Extra case, from T048b (analysis K1).** After the Unload, the row's `.project-item__name`
      has computed `fontStyle` `italic`. After the project is selected again, it is `normal`. This
      is the painted-style half of the removed `loaded-projects.e2e.ts:13`, and it adds no
      declaration.
  - **The budget.** In `packages/ui/tests/e2e/e2e-budget.json`, move `total` from 572 to 573 and
    `@terminal` from 108 to 109. Append the reason sentence to `measuredFrom`: Principle III requires
    a process-level E2E after every end path, Unload is a new one, and `closeIdle` has never had a
    caller.
  - **The tier plan.** Leave `packages/ui/tests/e2e/parallel-plan.json` unchanged. Confirm that
    `terminal-no-orphans.e2e.ts` is already serial (CPU), which the context-menu rule in
    `tier-plan.test.ts` requires.

  Run this one declaration only and observe it fail. (FR-034, Principle III resource hygiene, R13)

### GREEN

- [x] T066 [P] [US4] GREEN (T053): create `packages/core/src/workspace/unload.ts` (`planUnload`). Add
  `projectPanelIdsInSubWorkspaces` to `packages/core/src/workspace/destroy.ts`. Export both from
  `packages/core/src/index.ts`. (FR-034, FR-034c, FR-037)
- [x] T067 [P] [US4] GREEN (T056, contract types): add the optional `exceptPanelIds?: string[]` to
  the `terminal.closeIdle` and `terminal.killAll` params in `packages/ipc-contract/src/terminal.ts`.
  (FR-037)
- [x] T068 [US4] GREEN (T054, T055): add `confirmations.unloadProject` and
  `projects.unloadTerminalAction` (type, default, tolerant parse, clone) to
  `packages/core/src/config/app-settings.ts`. Add the two descriptors to
  `packages/core/src/config/settings-metadata.ts`. If a new exported type is needed, export it from
  `packages/core/src/index.ts`; this task is not `[P]` for that reason. Leave
  `DestroyConfirmSettings` unwidened. (FR-034a, FR-034b)
- [x] T069 [P] [US4] GREEN (T056, T067): in `packages/daemon/src/terminal-service.ts`, make
  `closeIdle` and `killAll` honour `exceptPanelIds` and **[derived]** skip `rootless` sessions when
  `projectId` is given. The `isBusy` check stays at call time. (FR-034, FR-037)
- [x] T070 [P] [US4] [derived] GREEN (T057, T067): add the `throng:terminal:closeIdle` and
  `throng:terminal:killAll` handlers, and `includeBusy` on `throng:terminal:list`, in
  `packages/ui/src/main/terminal-ipc.ts`. Expose them in `packages/ui/src/preload/preload.cts`, and
  type them in `packages/ui/src/renderer/global.d.ts`. (FR-034c, FR-037)
- [x] T071 [P] [US4] GREEN (T062): add the public `unloadProject(id)` to
  `packages/ui/src/renderer/state/projects-store.tsx`, combining `unmarkLoaded` with clearing
  `openedId` when the project is active. (FR-032, FR-036)
- [x] T072 [P] [US4] GREEN (T060, T061): create `packages/ui/src/renderer/sidebar/project-menu.ts`,
  which returns `MenuAction[]` with `section`, `icon` and `testId` on every item: Edit
  (`editVisual`), Rename (`rename`), Remove (`destroy`) and **[derived]** the three Unload rows
  (`unload`, disabled when not loaded; R8). (FR-030, FR-031, FR-038)
- [x] T073 [US4] GREEN (T059, T066, T068, T070, T071): create
  `packages/ui/src/renderer/sidebar/unload-project.ts`, the orchestrator in
  [contracts/unload.md](./contracts/unload.md) §2, with its collaborators passed as parameters.
  Busy names come from `peekTerminalCommand`, falling back to the panel title. It reuses `useChoose`
  and `useConfirm` from `packages/ui/src/renderer/confirm-dialog.tsx`. Extend `useChoose` with an
  initial-focus option in that file **only if** it lacks one. (FR-032 – FR-037)
- [x] T074 [US4] GREEN (T060, T072, T073): wire the row context menu in
  `packages/ui/src/renderer/sidebar/projects-panel.tsx`. `onContextMenu` opens the shared
  `ContextMenu` with `project-menu.ts`. Edit, Rename and Remove call the existing inline routes
  (`confirmDelete` and the rename state). The Unload rows call `unload-project.ts`. Escape restores
  focus to the row. (FR-030, FR-031)
- [x] T075 [US4] GREEN (T060, T074): in the `menu.open` dispatch in
  `packages/ui/src/renderer/app.tsx`, redirect the synthetic `contextmenu` to the element carrying
  `[data-project-row-focused]`. Category headers carry the same attribute (T040), so this also
  serves US5. Afterwards T065 must go green: run that one declaration only. (FR-030)

**Checkpoint**: US4 works with the shipped confirmations and at `none`, and a sub-workspace's panels
survive an Unload.

---

## Phase 7: User Story 5, put projects away in categories (Priority: P2)

**Goal**: category headers with a minimise toggle and a count, the Move to Category menu, the header
menu, and drag across categories. The data layer is Phase 2.

**Independent Test**: create a category, move two projects into it, minimise it and restart. It is
still minimised and shows "2". Expand it, and both projects are there with their colours and
layouts.

### RED

- [x] T076 [P] [US5] RED component: create
  `packages/ui/tests/component/projects-panel-categories.test.ts`.
  - **Wording.** User copy says "Minimise" and "Expand". `collapse` and `expand` are internal icon
    token names only (analysis T1).
  - **The header.** It shows the name, the count through the shared digit-grouping formatter, and a
    chevron `IconButton` on the `chevron` token titled "Minimise category" or "Expand category". The
    default header has no toggle.
  - **Minimising.** Clicking, Enter or Space on a non-default header toggles it. A minimised
    category hides its rows, except the active project, which carries `data-pinned-active` and
    disappears once another project becomes active. Minimising does not unload.
  - **Listing.** An empty category is listed with 0. Deleting the only non-default category while it
    is minimised lists its projects under the default category.
  - **Naming.** The inline New Category field refuses a duplicate that differs only in case and
    stays open with the reason.

  (FR-018, FR-051 – FR-053, FR-056, FR-060, FR-061, SC-007)
- [x] T077 [P] [US5] RED component: create
  `packages/ui/tests/component/projects-panel-category-menu.test.ts`.
  - A non-default header menu offers Rename Category, Delete Category and a checkable Minimise
    Category.
  - The default header menu offers Rename Category only: the other two are absent, not disabled.
  - Shift+F10 and the ContextMenu key on a focused header open the same menu, through the
    `menu.open` redirect with `KeybindingsHandler` (FR-053's keyboard route; T075).
  - The project row's Move to Category ▸ lists every category except the project's own, then New
    Category….
  - Delete calls `deleteCategory`, and its projects reappear under the default category.

  (FR-050, FR-053, FR-054, US5 scenario 4)
- [x] T078 [P] [US5] RED component: create
  `packages/ui/tests/component/projects-panel-drag-categories.test.ts`. Drive the panel's
  `onDragEnd` and `trackReorder`:
  - a drop within the source category calls `reorderProjects`;
  - a drop between two projects of another category calls `moveProject` at that slot;
  - a drop on a minimised header calls `moveProject` at the end of that category;
  - headers are not draggable.

  (FR-055, S3)
- [x] T079 [P] [US5] RED unit(ui): extend `packages/ui/tests/unit/menu-sections.test.ts` with
  `shapeOf` pins for the non-default header menu (`content`, `destroy`, `viewState`), the default
  header menu (a single `content` section with no divider) and the project menu with Move to
  Category in `viewState`. (FR-053, Principle VI)

### GREEN

- [x] T080 [P] [US5] GREEN (T077, T079): create `packages/ui/src/renderer/sidebar/category-menu.ts`.
  Rename (`rename`) is always present. Delete (`destroy`) and Minimise (`collapse` / `expand`) are
  present only for a non-default category. (FR-050, FR-053)
- [x] T081 [P] [US5] GREEN (T077, T079): add Move to Category ▸ (`category`) to
  `packages/ui/src/renderer/sidebar/project-menu.ts`, listing the other categories and then New
  Category… (`add`). (FR-053)
- [x] T082 [US5] GREEN (T076 – T078, T080, T081): in
  `packages/ui/src/renderer/sidebar/projects-panel.tsx`, add:
  - header rows with the chevron `IconButton`, the name and the formatted count;
  - minimise on click, Enter and Space;
  - the header context menu from `category-menu.ts`;
  - the inline name field shared by New Category and Rename Category, refusing as `commitRename`
    does;
  - category droppables, including minimised headers, with a category-aware `trackReorder` and
    `onDragEnd` choosing between `moveProject` and `reorderProjects`.

  Add header styles from theme tokens in `packages/ui/src/renderer/theme.css`. (FR-051 – FR-056,
  FR-061)

**Checkpoint**: every story is green at its own layers.

---

## Phase 8: Polish and cross-cutting concerns

**Purpose**: documentation currency (FR-071) in the same change, and the gate.

- [x] T083 [P] Update `README.md`: *Highlights* (categories, the project menu and Unload),
  *Configuration* (`confirmations.unloadProject` and `projects.unloadTerminalAction`), and the four
  new chords with Ctrl+Shift+0. (FR-071)
- [x] T084 [P] Update `docs/quick-start.md`:
  - §1 *Create a project*: the row menu, Unload and its dialogs, and categories;
  - the pane chord line (`:35`): Ctrl+Alt+F and Ctrl+Alt+P;
  - the *Keyboard reference* table (`:774-811`): the four commands and Ctrl+Shift+0.

  (FR-071)
- [x] T085 [P] Update `CONTRIBUTING.md`. Where it lists dispatch scopes or E2E budget figures, add
  the sixth `projects` scope and the budget (unchanged at 573: +2 offset by T048a and T048b). If it states neither, change nothing and say
  so in the PR description. (FR-071)
- [x] T086 [P] Update `docs/testing.md`. Add a "046 declarations" section in the shape of the 045
  one: two `@extended` declarations, each with its `@reserve:*` reason; the two declarations T048a and
  T048b removed, and where their assertions now live; the budget unchanged at 573; and no tier-plan
  change. (FR-071, Principle V)
- [x] T087 [P] Add entries to `## Unreleased` in `CHANGELOG.md`, one line each, in user terms, with
  issue links.
  - `### Added`: the project cycling and side-pane focus chords (#332); Ctrl+Shift+0 resets zoom
    (#390); the project right-click menu with Unload and its two preferences (#411); project
    categories (#292).
  - `### Changed`: "Files & Folders" is now called File Explorer (#331). This line is exempt from
    the T022 guard.

  (FR-071; the file's header states the add-to-Unreleased convention)
- [ ] T088 Validate by hand against `specs/046-side-panes-and-project-list/quickstart.md` §1 – §5 in
  the dev build, after a clean dev state, including §2 step 9: the live `bind -p` check that closes
  research O3. Record the O3 result in the PR description. This is a human step, and nothing here
  runs it on the user's behalf. (handed to the maintainer: see the final report's manual test steps)
- [x] T089 **Blocked on T088's O3 result** (FR-021 requires each chord to be *shown* free before it
  ships). If `bind -p` shows any of the four chords bound, stop and apply FR-021's replacement
  first. Then dispatch `.github/workflows/gate.yml` against the branch (`gh workflow run gate.yml --ref
  <branch>`), then `gh run watch <id> --exit-status`, then take the verdict from
  `gh run view --json status,conclusion`. Quote the run URL and the SHA. A red stage means stop,
  fix and re-run (SC-008).
  *O3 answered 2026-09-23 by a live `bind -p` check (spec FR-021, recorded at implementation):
  `\e\C-f` is bound but never sent by throng, so Ctrl+Alt+F stands and no replacement was needed.*

---

## Dependencies and execution order

### Phase dependencies

- **Phase 1** has no tasks.
- **Phase 2 (Foundational)** blocks every story.
- **Phase 3 (US1)** depends on Phase 2 only through file order: T024 and T026 edit files T012, T015
  and T016 edited first. It lands before US2 – US5 so that test locators change once (plan,
  *Delivery order* 1).
- **Phase 4 (US2)** depends on Phase 2: the scope, `ActivePane`, `listRows`, the store's
  `categories` and the `projectList` icon.
- **Phase 5 (US3)** depends on Phase 2 (`chordCandidates`). Its E2E, T049, also presses
  Ctrl+Alt+PageDown and Ctrl+Alt+F, so it depends on US2.
- **Phase 6 (US4)** depends on Phase 2 (the `unload` icon) and on US2's T040, the tree and its
  focused-row attribute.
- **Phase 7 (US5)** depends on Phase 2's data layer and on US4's `project-menu.ts` (T072), which it
  extends.
- **Phase 8** depends on every story. T089 is last.

### Within each story

The RED tasks come first, and each one is observed failing. Then core, then ipc-contract, then
persistence, then daemon, then the main process, then the renderer store, then components, then
`app.tsx` wiring. The E2E declaration comes last among the RED tasks and is run alone.

## Parallel runs, footprint-checked

Each run below is a consecutive `[P]` block. Every task in it was checked for a file disjoint from
every other task in the same run, and for no unfinished dependency.

| Run | Tasks | Shared files that forced a boundary |
|---|---|---|
| A | T001 – T011 | each RED task owns a distinct test file |
| B | T013 – T016 | T014 alone touches `packages/core/src/index.ts`; T015 alone touches the theme files and `shipped-defaults.ts`; T016 waits on T012 (done before the run) |
| C | T017 – T018 | persistence files versus ipc-contract files. T019 (persistence `index.ts`) and T020 (daemon) are sequential |
| D | T022 – T023 | the new guard versus three label tests plus `panes.e2e.ts` (in no other task) |
| E | T024 – T029 | core src, main, renderer, docs, non-E2E tests and E2E tests are disjoint lists. `packages/ui/tests/unit/menu-sections.test.ts` is in T023 only, and `packages/core/tests/unit/menu-sections.test.ts` is in T028 only |
| F | T030 – T036 | `keybindings.test.ts` is in T030 only in this run; `scope.test.ts` is in T032; `menu-sections.test.ts` (ui) is in T035; `window-chords.ts` is in T033 only |
| G | T038 – T040 | T037 (the keybindings registry, `keybindings.ts` + `keybindings-metadata.ts`) is sequential before it; `app.tsx` (T041) is sequential after it |
| H | T045 – T048 | T044 (`window-chords.ts`) is sequential before it; T048a, T048b and T049 (`e2e-budget.json`, `launch-sharing.md`, `window-chords.ts`) are sequential after it, in that order |
| I | T050 – T052 | the keybindings registry, `app.tsx` and `capture-modal.tsx` |
| J | T053 – T064 | each RED task owns a distinct test file. `menu-sections.test.ts` is in T061 only in this run. T065 (`e2e-budget.json`) is sequential |
| K | T066 – T067 | core `index.ts` is in T066 only; T068 (settings registry, may touch `index.ts`) is sequential after it |
| L | T069 – T072 | daemon, main + preload + `global.d.ts`, projects store, and the new `project-menu.ts` |
| M | T076 – T079 | four distinct test files |
| N | T080 – T081 | `category-menu.ts` versus `project-menu.ts`. T082 (`projects-panel.tsx`, `theme.css`) is sequential |
| O | T083 – T087 | README, quick-start, CONTRIBUTING, testing.md and CHANGELOG, one file each |

**Shared files never placed twice in one run**:

- `packages/core/src/index.ts`: T014, T066, T068.
- The keybindings registry, `keybindings.ts` and `keybindings-metadata.ts`: T012, T024, T037, T050.
- The settings metadata registry, `settings-metadata.ts` and `app-settings.ts`: T024, T068.
- The theme token lists, `theme.ts` and `theme-copy.ts`: T015, T024.
- `shipped-defaults.ts`: T015.
- The ipc-contract message maps, `projects.ts`, `terminal.ts` and `index.ts`: T018, T067.
- The migration list, `migration-runner.ts` and `schema-guard.ts`: T017.
- `app.tsx`: T026, T041, T051, T075.
- `projects-panel.tsx`: T040, T074, T082.
- `projects-store.tsx`: T021, T071.
- `project-menu.ts`: T072, T081.
- `theme.css`: T026, T040, T082.
- `menu-sections.test.ts` (ui): T023, T035, T061, T079.
- `keybindings.test.ts`: T030, T045.
- `preferences-keybindings-tab.test.ts`: T036, T048.
- `window-chords.ts`: T033 (Phase 4), then T044, then T049. `window-chord-manifest.test.ts` reads
  it and is edited by no task.
- `e2e-budget.json`: T048a, T048b, T049, T065, in that order, so it never reads above 573.
- `launch-sharing.md`: T048a, T048b.
- `pane-shortcuts.e2e.ts`: T029, then T048a.
- `parallel-plan.json`: read-only in T049 and T065.
- Docs: T027, then T083 – T086.
- `CHANGELOG.md`: T087.

**Unknown footprints**:

- **T012**: the exhaustive `Record<DispatchScope, …>` sites that `tsc` names.
- **T043**: the E2E files that locate the project list by role, found by its grep.
- **T073**: `confirm-dialog.tsx`, only if `useChoose` lacks an initial-focus option.

T012 and T043 are not `[P]`. T073 is sequential.

## Implementation strategy

1. **Phase 2**: the foundation. Integration proves migration v9, including the re-run.
2. **US1**, the MVP. The rename and its guard are shippable alone.
3. **US2**, then **US3**. The keyboard layer; T049 proves both on a real engine.
4. **US4**, then **US5**. The menu first, then the categories that extend it.
5. **Polish**: the docs in the same change, the hand validation, then `npm run gate` on the hosted
   runner. It is the only evidence of done-ness.

Each story is releasable when its tests are green. Nothing is deferred, and Complexity Tracking stays
empty.

---

## Phase 9: Convergence

**Source**: `/speckit-converge` against HEAD `0c22852d`. The code was compared with spec.md (including
every Recorded note), plan.md, contracts/ ×4, data-model.md and tasks.md. The Spec Kit prerequisites
script was blocked by the worktree guard, so its job (resolving FEATURE_DIR and checking that the
docs exist) was done by hand. No constitution MUST is violated. T088 is the maintainer's hand
validation and is not a finding.

- [x] T090 [US2] RED component, then GREEN: in `packages/ui/tests/component/projects-panel-keyboard.test.ts`,
  assert that a project row's `project-switch-<id>` button and a non-default header's
  `category-toggle-<id>` chevron are `tabindex="-1"`, and that ArrowDown, ArrowUp, Home and End still
  move the roving row while DOM focus sits on either one (for example, after a click on the
  already-active project's name). Then fix `packages/ui/src/renderer/sidebar/projects-panel.tsx`:
  give the switch button (`:1098`) `tabIndex={-1}`, give the header's `IconButton` (`:1002`) a way to
  opt out of Tab order (`packages/ui/src/renderer/common/icon-button.tsx` has no `tabIndex` prop), and
  narrow the nested-control guard in `onTreeKeyDown` (`:383-391`) so that it swallows only Enter and
  Space on a nested `<button>`, not the navigation keys. Evidence: review finding 5 (T034's roving
  tabindex) took the grip, Edit and Remove out of Tab order (`:1141`, `:1159`; asserted at
  `projects-panel-keyboard.test.ts:211`) but missed these two. Each is still a Tab stop inside its row,
  and because the guard returns early for any `BUTTON` target, Arrow, Home and End do nothing while
  one of them holds focus. per FR-018, T034 (partial, MEDIUM)
- [x] T091 [US4] Resolve the unbuilt `menu.open` redirect. T075 says to redirect the synthetic
  `contextmenu` to the element carrying `[data-project-row-focused]`, and T040 says to write that
  attribute. The attribute is written (`packages/ui/src/renderer/sidebar/projects-panel.tsx:989`,
  `:1079`), but nothing reads it. `packages/ui/src/renderer/app.tsx:539-575` has no Projects branch,
  and no test references it. Shift+F10 works today only because roving tabindex gives the row real
  DOM focus, so the generic `document.activeElement` path at `app.tsx:545` dispatches on the row
  itself, and a nested control's event bubbles up to the row's `onContextMenu`. Close the gap one
  way or the other. Either delete the dead attribute and record in this file that T075's redirect is
  unnecessary, or wire the redirect and cover it in `packages/ui/tests/component/projects-panel-menu.test.ts`.
  per FR-030, plan: T075 (partial, LOW)
  — RESOLVED by deleting `data-project-row-focused` (both write sites: the category header row and
  the project row). No redirect is needed: a Projects row — header or project — holds real DOM focus
  under roving tabindex exactly the way `app.tsx`'s generic `document.activeElement` path in
  `menu.open` already expects (the File Explorer's redirect exists only because react-arborist keeps
  focus on the tree CONTAINER instead, which the Projects panel never does). Already proven by
  `packages/ui/tests/component/projects-panel-menu.test.ts`'s "Shift+F10 opens the row menu that
  right-click opens" and "the ContextMenu key does the same" — both pass unchanged with the attribute
  gone, so no new test was needed for the deletion itself.

---

## Phase 10: Iterate round 1, the agreed convention (checkpoint 2026-09-24)

**Source**: spec FR-072 – FR-112, SC-010 (upgrade clause), SC-011, SC-012 and SC-014 – SC-016, as
amended at `25fe6911`. Constitution v5.6.0 (`434400fb`). The plan is
[plan.md](./plan.md) → *Iterate round 1: the agreed convention*, and the contracts are §4 – §6 of
each file under [contracts/](./contracts/). The code was audited at `25fe6911` before this phase was
written. The plan's *Where the code stands* lists what each task starts from.

**Already implemented, so no task**: FR-110's `tabs.openPicker` exemption (`3b04ec33`), and FR-072's
bold and uppercase header text (`packages/ui/src/renderer/theme.css:527-538`).

**Superseded, so no task**: the FR-076 – FR-079 rows, FR-085's End Terminals confirmation, FR-089,
FR-090 and FR-094 – FR-100. The one exception is shipped code that a superseding FR must undo:
`zoom.reset`'s `Ctrl+Shift+0` (T099), the unload dialogs and `confirmations.unloadProject`
(T127, T128).

**Rules for this phase**

- Test-first. Every GREEN task names the RED task(s) it turns green.
- **Repro-first** for the three reported defects and FR-093's finding: T123, T124, T130 and T140.
  Follow the `replicating-bugs` skill. Run the test, record the failure output in the task's report,
  and make no production change in the paired GREEN task until the controller confirms it
  reproduces the maintainer's report.
- **E2E budget stays 573 (`@core` 39).** No declaration is added or removed. T129 and T142 change
  assertions and presses in place. `packages/ui/tests/e2e/e2e-budget.json` and
  `packages/ui/tests/e2e/parallel-plan.json` are read-only in this phase.
- Keep these guards green: `window-chord-manifest`, `renderer-chord-resolvers`,
  `terminal-reserved-keys`, `keybindings-collision` and `project-references-cover-imports`.
- Source-parsing tests must tolerate CRLF and LF.

### 10A: the core keybinding model (`throng-config-preferences`)

#### RED

- [x] T092 [P] [US3] RED unit(core): create `packages/core/tests/unit/keybindings-two-stroke.test.ts`.
  Cover FR-092's token model:
  - `Ctrl+E W` parses, formats and normalises as one binding of two strokes;
  - the first stroke must carry a modifier, and the second may be bare;
  - a three-stroke token is refused;
  - `chordCollisions` reports a first stroke that is also bound as a whole single-stroke chord in
    an intersecting scope;
  - validation fails any binding, shipped or saved, that puts a two-stroke chord on a command whose
    `COMMAND_SCOPES` entry contains `terminal`;
  - reset-to-default treats the two strokes as one binding.

  (FR-091, FR-092)
- [x] T093 [P] [US2] RED unit(core): create `packages/core/tests/unit/keybindings-tiers.test.ts`, the
  FR-101 guard. The FR-094 guard it was to extend was never built, so this is a new file.
  - It gives every `ActionId` a tier: tier 1 (navigation and the application), tier 2 (the active
    panel or pane), tier 3 (content), or outside the tiers. It fails for an `ActionId` with none.
  - It fails for a Windows default in the wrong tier, unless the default is on FR-103's
    exhaustive exception list, held in the test as data.
  - It fails for a command shipping two keyboard chords (other than `menu.open`) or two gestures,
    and for any `Numpad…` token (FR-105).
  - It asserts FR-102's table exactly: every *changes* row holds its new value, and every other row
    holds its value at `3b04ec33`.
  - It asserts that plain `Ctrl++`, `Ctrl+-`, `Ctrl+=`, `Ctrl+0` and `Ctrl+Shift+0` are bound to
    nothing.

  (FR-101, FR-102, FR-103, FR-105, SC-014)
- [x] T094 [P] [US2] RED unit(core): extend `packages/core/tests/unit/keybindings-collision.test.ts`
  so that no two shipped defaults share a chord in intersecting scopes once tokens are compared as
  FR-104 / FR-105 resolve them. `Ctrl+Alt+=` ≡ `Ctrl+Alt++`, and gestures are included. Extend
  `packages/core/tests/unit/terminal-reserved-keys.test.ts` so that no `Ctrl+Shift+Alt` default is
  in the reserved or shadowable tier, and the recorded-exception list stays at four. (FR-109
  bullets 2–3)
- [x] T095 [P] [US2] RED unit(core) + integration(ui): create
  `packages/core/tests/unit/shipped-defaults-upgrade-v13-keybindings.test.ts` in the shape of the
  existing `shipped-defaults-upgrade-v12-keybindings.test.ts`.
  - Every FR-108 row moves from its version-11 value and, where listed, its version-12 value.
  - A customised array is left byte-identical.
  - A new default is refused when it would collide, on normalised tokens, with an action whose
    array is not being rewritten. Include the gesture case: a customised `zoom.in` that kept
    `Ctrl+WheelUp` keeps it, and `panel.zoomIn` is not given it.
  - A second run changes nothing (the re-run assertion).
  - The v12 step is unchanged.
  - `editor.toggleWordWrap` moves from `[Ctrl+Alt+W]` to `[Ctrl+E W]`.

  Bump the pinned version in `packages/core/tests/unit/theme-link-tokens.test.ts:193` from 12 to
  13. Add a version-12 → 13 seed case to
  `packages/ui/tests/integration/shipped-defaults-seed-upgrade.test.ts`. (FR-108, SC-010)
- [x] T096 [P] [US5] RED unit(core): create
  `packages/core/tests/unit/theme-category-header.test.ts`:
  - `categoryHeaderBackground` exists in `THRONG_THEME`, with a label and description in
    `theme-copy.ts`;
  - it is listed for the theme editor;
  - it arrives through the additive version-13 upgrade into a theme file that lacks it.

  (FR-072, configuration-editor completeness)
- [x] T097 [US2] RED, sequential after T092 – T096: re-pin every existing assertion that names a
  moved default or group:
  - `packages/core/tests/unit/keybindings-focus-notice.test.ts` (`Ctrl+Alt+M` →
    `Ctrl+Shift+Alt+M`);
  - `packages/core/tests/unit/keybindings-metadata.test.ts`: `focus.explorer` and
    `focus.projects` in **Focus & Zoom**, `project.next` / `previous` still in View (FR-087);
  - `packages/ui/tests/component/keybindings-tab-subgroups.test.ts`;
  - any other non-E2E test that pins an old literal. Find them with
    `git grep -nE "Ctrl\+Alt\+(PageDown|PageUp|M|B|N|F|P|T|W|Arrow|=|\+|-|0)|Ctrl\+Shift\+0" -- 'packages/*/tests' ':!packages/ui/tests/e2e'`.

  Leave out the files owned by T092 – T096 and T105 – T110. List every file you touched in the
  report. (FR-087, FR-102)

#### GREEN

- [x] T098 [US3] GREEN: two-stroke tokens in `packages/core/src/config/keybindings.ts` (parse,
  format, normalise, `chordCollisions`' first-stroke rule, the no-terminal-scope validation) and in
  `packages/core/src/config/chord-capture.ts` (canonical form of a two-stroke capture). Export
  through `packages/core/src/index.ts` if needed. Turns T092 green. (FR-092)
- [x] T099 [US2] GREEN:
  - `packages/core/src/config/keybindings.ts`: `WINDOWS_BINDINGS` per FR-102, which removes
    `zoom.reset`'s `Ctrl+Shift+0` and every plain Ctrl zoom chord, moves the wheel and
    middle-click tokens to `panel.zoom*`, and sets `editor.toggleWordWrap` to `Ctrl+E W`. Add a
    same-binding normaliser beside `chordCollisions` (FR-105) and use it there.
  - `packages/core/src/config/keybindings-metadata.ts`: `focus.explorer` and `focus.projects` move
    to Focus & Zoom (FR-087). The `zoom.*` and `panel.zoom*` descriptions name their new chords and
    gestures.

  Turns T093, T094 and T097 green. (FR-087, FR-101 – FR-105)
- [x] T100 [US2] GREEN:
  - `packages/core/src/config/shipped-defaults.ts`: `SHIPPED_DEFAULTS_VERSION` 12 → 13, and
    `planKeybindingsUpgrade` extended with FR-108's rows, using the T099 normaliser for the
    collision refusal. v12's step is not edited.
  - `categoryHeaderBackground` in `packages/core/src/config/theme.ts`, with its copy in
    `packages/core/src/config/theme-copy.ts` and a parent in `TOKEN_PARENT` if the token model
    needs one.
  - `packages/ui/src/main/shipped-defaults-service.ts`, only if it switches on the version number.

  Run the contract test `packages/core/tests/contract/shipped-defaults-fidelity.contract.test.ts`.
  Turns T095 and T096 green. (FR-072, FR-108)

### 10B: category order persistence (`throng-daemon-persistence`)

These tasks can run alongside 10A, because the files are disjoint.

#### RED

- [x] T101 [P] [US5] RED integration(persistence): create
  `packages/persistence/tests/integration/migration-v10-category-position.integration.test.ts`:
  - a v9 database with three categories keeps its visible order after v10;
  - running v10 twice gives identical rows (the re-run assertion);
  - a database stamped 10 with `project_categories.position` missing is healed by
    `reconcileSchema`.

  Bump `packages/persistence/tests/integration/user-version-pin.integration.test.ts` to **10**, and
  add the column to `packages/persistence/tests/integration/migration-drift-repair.integration.test.ts`.
  (FR-084)
- [x] T102 [P] [US5] RED: in
  `packages/persistence/tests/integration/project-category-repository.integration.test.ts`:
  - `reorder(orderedIds)` persists across a reopened database;
  - `create` appends after every existing category;
  - the default category stays first whatever the positions say.

  In `packages/core/tests/unit/project-category-service.test.ts`, `reorder` refuses the default's
  id, an unknown id, a missing or duplicated id, and a non-string array. (FR-083, FR-084)

#### GREEN

- [x] T103 [US5] GREEN persistence:
  - new `packages/persistence/src/migrations/v10-category-position.ts`;
  - register it in `packages/persistence/src/migration-runner.ts` (`LATEST_VERSION` 10);
  - `project_categories.position` in `ADDITIVE_COLUMNS` (`packages/persistence/src/schema-guard.ts`);
  - `reorder`, append-on-create and position ordering in
    `packages/persistence/src/project-category-repository.ts`;
  - export through `packages/persistence/src/index.ts` if needed.

  v9 is not edited. Turns T101 and T102 (repository half) green. (FR-084)
- [x] T104 [US5] GREEN: `reorder` in the core `ProjectCategoryService` (`packages/core/src/projects/categories.ts`).
  Add `projects.categories.reorder` and `ProjectCategoryDto.position` to
  `packages/ipc-contract/src/projects.ts`, and the handler to `packages/daemon/src/project-service.ts`.
  Turns T102 (service half) green. Contract: [project-categories.md](./contracts/project-categories.md)
  §5. (FR-083, FR-084)

### 10C: renderer matching, capture, scope and zoom routing (`throng-renderer-ui`, `throng-config-preferences`)

Starts after T098 – T100.

#### RED

- [x] T105 [US2] RED unit(ui), sequential first because it owns the shared helper.
  - `packages/ui/tests/shared/chord-event.ts` gains `metaKey` and a layout table.
  - `packages/ui/tests/unit/chord-candidates.test.ts` covers the tier-1 physical rule (FR-104):
    - `KeyA`–`KeyZ`, `Digit0`–`Digit9`, `Equal` / `NumpadAdd` → `+`, `Minus` / `NumpadSubtract`
      → `-`, `Numpad0` → `0`, arrows and `PageDown`;
    - the produced `key` is varied across US, UK, German, French and Polish, including Polish
      AltGr+Shift+N (`Ń`), a dead key and `Numpad0` reporting `Insert`;
    - exactly one candidate for a tier-1 event;
    - `metaKey` declines a tier-1 match;
    - Ctrl+Alt on the `=` key without Shift, and Ctrl+Alt+`NumpadAdd`, both resolve `Ctrl+Alt++`
      (FR-105);
    - German AltGr+0 still yields no chord, so `}` types (R2 unchanged).

  (FR-098's Shift rule as FR-105 keeps it, FR-104, FR-105, SC-014)
- [x] T106 [P] [US2] RED unit(ui):
  - `packages/ui/tests/unit/renderer-chord-resolvers.test.ts` and
    `packages/ui/tests/unit/window-chord-manifest.test.ts`: every `Ctrl+Shift+Alt` default resolves
    at every renderer site from its physical `code` on all five layouts, and the keypad `+` / `-` /
    `0` resolve identically to the main row (FR-109 bullet 1);
  - `packages/ui/tests/unit/window-chords-parser.test.ts`: the shared E2E helper turns
    `Ctrl+Shift+Alt++` into `Control+Shift+Alt+Equal`, and `Ctrl+E W` into two presses.
- [x] T107 [P] [US2] RED component: in
  `packages/ui/tests/component/physical-key-chords-every-resolver.test.ts`, a tier-1 chord fires
  through the window listener, `editor-chrome.tsx`, `search-keybindings.tsx` and
  `preview-commands.tsx` whatever character the layout produced. A `metaKey` press fires nothing.
  (FR-104)
- [x] T108 [P] [US2] RED:
  - `packages/ui/tests/component/preferences-capture-modal.test.ts`:
    - a `Ctrl+Shift+Alt` press records the physical token (`Ctrl+Shift+Alt+F` from a Polish `Ń`
      event);
    - main-row `+` and keypad `+` with Ctrl+Alt both record `Ctrl+Alt++`;
    - no `Numpad…` token is ever recorded;
    - a first stroke followed by a second key records `Ctrl+E W`, and the modal shows the pending
      first stroke. *[derived]* A capture is single-stroke and applies on key-up, as today, unless
      the user first activates the modal's two-stroke control (`data-testid="capture-two-stroke"`),
      an `IconButton` on the existing `add` icon token whose hover title is *Add a second stroke*.
      Then the first stroke is held pending and the next key completes the binding. A plain
      capture's behaviour is unchanged. The control is pointer-only by construction, like the
      modal's Cancel, because the modal captures every keydown, including Tab, Enter and Space;
    - a first stroke that collides with a whole single-stroke chord warns;
    - *[derived]* the Key Bindings row shows a two-stroke binding as `Ctrl+E W`, and a tier-1
      binding as `Ctrl+Shift+Alt++`, never `Numpad…` or `Plus` (FR-091, FR-105's display clause).
  - `packages/core/tests/unit/chord-capture.test.ts`: the matching canonical forms.

  (FR-092, FR-098's capture fix as FR-105 keeps it, FR-104, FR-105, FR-109 bullet 4)
- [x] T109 [P] [US2] RED unit(ui): in `packages/ui/tests/unit/scope.test.ts`, add FR-110's audit:
  - loop over every `ActionId` whose `COMMAND_SCOPES` entry is EVERYWHERE, and require it to be
    exempt in `isPanelScoped` or named on an exported deliberately-panel-scoped list with a
    reason;
  - a new EVERYWHERE id on neither fails;
  - `menu.open` is classified explicitly. Settle the hypothesis with a test from a focused xterm
    helper textarea: does Shift+F10 open the terminal's own context menu, or is it silenced?
    Record the answer in the test name.

  (FR-110, SC-016)
- [x] T110 [P] [US3] RED component: rewrite
  `packages/ui/tests/component/window-zoom-reset-shift.test.ts` in place for FR-080 under FR-102:
  - `Ctrl+Shift+Alt+0`, pressed through the real window key handler from terminal, editor and
    find-input focus, calls the window zoom-reset API and never the per-panel store;
  - `Ctrl+Alt+0` resets only the active panel and never calls the window API;
  - `Ctrl+Shift+0` now does nothing.

  Rename the file only if its name would then mislead. If you rename it, name the new file in the
  report. (FR-080, SC-014)

#### GREEN

- [x] T111 [US2] GREEN:
  - `packages/ui/src/renderer/config/chord-key.ts`: `ChordEventLike.metaKey`, the tier-1 physical
    rule ahead of the digit rule, and the `+` / `-` / `0` same-binding rule. No `AltGraph` decline
    (research R22 hypothesis). T149's probe settles it before T150; if it holds, T151 / T152 add
    the decline, so tier 1 never ships unsettled (FR-104).
  - Mirror it in `packages/ui/tests/shared/window-chords.ts`, including the two-stroke press
    translation.

  Turns T105, T106 and T107 green. (FR-104, FR-105)
- [x] T112 [US2] GREEN: `packages/ui/src/renderer/preferences/capture-modal.tsx` (physical tier-1
  token, keypad as main row, second-stroke capture with a pending display, and the `add`-icon
  two-stroke `IconButton` T108 derives) and
  `packages/core/src/config/chord-capture.ts`. Turns T108 green. (FR-092, FR-104, FR-105)
- [x] T113 [US2] GREEN: in `packages/ui/src/renderer/keybindings/scope.ts`, export the
  deliberately-panel-scoped list and classify `menu.open` as T109 settled. Turns T109 green.
  (FR-110)
- [x] T114 [US3] GREEN, only if T110 is still red after T099 and T111: fix the routing in
  `packages/ui/src/renderer/app.tsx` so that `zoom.reset` reaches the window reset and
  `panel.zoomReset` reaches the store. If T110 is green without it, record that in the report and
  close this task with no change. (FR-080)

### 10D: two-stroke chords in the editor (`throng-editor-documents`)

#### RED

- [x] T115 [P] [US3] RED unit(ui): in `packages/ui/tests/unit/commands.test.ts`, `toCodeMirrorKey('Ctrl+E W')`
  returns CodeMirror's space-separated prefix form (`Ctrl-e w`), and a gesture still returns `null`.
  (FR-092, research R19)
- [x] T116 [P] [US3] RED component: create
  `packages/ui/tests/component/editor-two-stroke-chord.test.ts`, with a mounted editor:
  - Ctrl+E shows a pending indication naming the stroke, and W then toggles word wrap;
  - Escape cancels, is consumed and closes no open find bar;
  - an unbound second stroke is consumed, types nothing and reports that the combination is not
    bound;
  - focus leaving the editor ends the prefix;
  - fake timers show the prefix ending at 4 s;
  - with a terminal focused, the window listener does not consume Ctrl+E, because the command is
    EDITOR_ONLY.

  (FR-091, FR-092)

#### GREEN

- [x] T117 [US3] GREEN: `toCodeMirrorKey` and the keymap install in
  `packages/ui/src/renderer/editor/commands.ts`. Add the pending indication and its ending rules in
  a new `packages/ui/src/renderer/editor/pending-chord.tsx`, mounted from
  `packages/ui/src/renderer/editor/editor-chrome.tsx`, and style it in the editor's existing
  stylesheet. Turns T115 and T116 green. (FR-091, FR-092)

### 10E: gestures zoom the panel under the pointer (`throng-renderer-ui`)

- [x] T118 [US3] RED component: create `packages/ui/tests/component/mouse-zoom-panel.test.ts`:
  - Ctrl+wheel up / down over a **non-active** panel calls the panel-zoom action for that panel's
    type, `preventDefault`s the event and never calls the window `zoomBy`;
  - Ctrl+middle-click resets that panel;
  - over the title bar or a side pane, nothing is dispatched and the window zoom is untouched, but
    the event is still `preventDefault`ed *[derived]*, so Chromium's page zoom never sees it;
  - resolution reads the live keybindings: with `Ctrl+WheelUp` removed from `panel.zoomIn`, the
    gesture does nothing, and bound to another action it runs that action.

  (FR-106, Principle X)
- [x] T119 [US3] GREEN:
  - replace `registerMouseZoom` in `packages/ui/src/renderer/main.tsx` with a keybinding-driven
    resolver in a new `packages/ui/src/renderer/workspace/mouse-zoom.ts`. It finds the panel with
    `closest('[data-panel-id]')` or the existing panel marker, and dispatches the panel zoom by
    panel id through `packages/ui/src/renderer/state/workspace-store.tsx`;
  - the main-process `throng:zoomBy` / `throng:zoomReset` stay, for the keyboard and the cog row.

  Turns T118 green. (FR-106)

### 10F: cog menu (`throng-renderer-ui`)

#### RED

- [x] T120 [P] [US2] RED unit(ui): in `packages/ui/tests/unit/menu-sections.test.ts`, pin three
  shapes:
  - the cog is `[viewState, application]` with no navigate items (FR-074, FR-107);
  - the project menu has two Unload rows in viewState (FR-081);
  - the non-default category header menu has a `navigate` section holding Move Category Up and
    Move Category Down (FR-083).

  Each part goes green with its own GREEN task: T122, T128 and T138.
- [x] T121 [P] [US2] RED component: create `packages/ui/tests/component/cog-zoom-row.test.ts` and
  update `packages/ui/tests/component/title-bar.test.ts` (the `cog-menu-project-next` / `-previous`
  / focus items are gone). The Zoom row:
  - has three icon controls on the `zoomOut`, `zoomReset` and `zoomIn` tokens;
  - each hover title names the control and its live chord;
  - each control dispatches `zoom.out` / `zoom.reset` / `zoom.in` through the chord handler;
  - the menu stays open after a click;
  - Left / Right move between the controls, and Enter / Space activate;
  - Zoom In is disabled at the maximum, Zoom Out at the minimum, and Reset Zoom at 100%, using a
    stubbed window zoom level.

  (FR-107, Principle VI)

#### GREEN

- [x] T122 [US2] GREEN:
  - remove the navigate section from `packages/ui/src/renderer/title-bar/cog-menu-items.ts`, add
    the Zoom row there, and wire it in `packages/ui/src/renderer/title-bar/cog-menu.tsx`;
  - add a generic multi-control row item to `packages/ui/src/renderer/workspace/context-menu.tsx`
    if it has none (not a cog-only special case);
  - style the row in `packages/ui/src/renderer/theme.css`;
  - expose the window zoom level to the renderer through `packages/ui/src/preload/preload.cts`,
    `packages/ui/src/renderer/global.d.ts` and `packages/ui/src/main/main.ts`, as a read or an
    event beside `throng:zoomBy`.

  Turns T121 and T120's cog part green. (FR-074, FR-107)

### 10G: Unload (`throng-renderer-ui`, `throng-core-architecture`, `throng-terminal-pty`)

#### RED

- [x] T123 [P] [US4] RED **repro** (reported defect: "I still get a confirmation prompt"),
  component, in `packages/ui/tests/component/unload-project.test.ts`. Choosing **Unload and Keep
  Terminals Running** and **Unload and End Terminals** with a busy terminal (stub terminal RPC,
  `confirmations.unloadProject: "double"` seeded as a raw, unmodelled settings key so the fixture
  still compiles after T127 withdraws the type) shows **no** dialog, and the chosen action applies. The
  unsaved-editor prompt still comes first when an editor is dirty. Record the observed failure
  (today the choose dialog opens) before T127 / T128 change anything. (FR-111, SC-015)
- [x] T124 [P] [US4] RED **repro** (reported defect: "Keep Terminals Running closes terminals"):
  - component: create `packages/ui/tests/component/unload-keep-terminals.test.ts`. The keep action
    never calls `terminal.closeIdle` or `terminal.killAll`, and the end action calls `killAll` with
    `exceptPanelIds`. Record the observed failure: today keep calls `closeIdle`
    (`unload-project.ts:224`).
  - integration(daemon): create
    `packages/daemon/tests/integration/terminal-unload-keep.integration.test.ts`. With no
    `closeIdle`, an idle session survives, and `attach` returns the same session id and pid. The
    kept session still ends when its project is deleted and under "terminate all". This half is a
    guard and may pass at once. Say so in the report rather than calling it red.
  - *[derived]* FR-086's app-close clause (a kept idle shell is closed at app close) is **not**
    asserted here. `closeIdle`'s only production caller is `unload-project.ts`, and the app-close
    path in `packages/ui/src/main/main.ts` offers leave running or terminate all and never calls it.
    So that clause is a hypothesis: record in the report where, if anywhere, FR-015b's idle rule
    runs at app close, and hand the answer to the controller. T153 lands it.

  (FR-086, SC-011)
- [x] T125 [P] [US4] RED:
  - `packages/core/tests/unit/unload-plan.test.ts`: `planUnload({defaultAction, variant})` returns
    one `apply` step and takes no `level` (data-model §8);
  - `packages/core/tests/unit/app-settings-unload.test.ts`: `confirmations.unloadProject` is not
    modelled, and a saved value survives a write as an unmodelled key *(corrected 2026-09-25: the
    write path drops it — FR-111's supersede note; the contract test
    `config-write-patch.contract.test.ts` asserts the drop)*;
  - `packages/core/tests/unit/settings-metadata.test.ts:531-560`: the descriptor is gone and
    `projects.unloadTerminalAction` remains;
  - `packages/ui/tests/component/preferences-unload-settings.test.ts`: no control for it.

  (FR-111)
- [x] T126 [P] [US4] RED component: in `packages/ui/tests/component/projects-panel-menu.test.ts`:
  - exactly two Unload rows: **Unload Project** plus **Unload Project and End Terminals** under
    `keepRunning`, and **Unload Project and Keep Terminals Running** under `endTerminals`;
  - the labels follow a live preference change on the next open;
  - both rows are disabled on an unloaded project.

  (FR-038, FR-081)

#### GREEN

- [x] T127 [US4] GREEN core:
  - `packages/core/src/workspace/unload.ts`: reduce `planUnload` to one `apply` step;
  - `packages/core/src/config/app-settings.ts`: withdraw `confirmations.unloadProject` (type,
    default, parse, clone);
  - `packages/core/src/config/settings-metadata.ts`: remove its descriptor.

  Turns T125's core parts green. (FR-111)
- [x] T128 [US4] GREEN ui:
  - `packages/ui/src/renderer/sidebar/unload-project.ts`: no `useChoose` and no `useConfirm`.
    Keep calls nothing on the terminal RPC; end calls `killAll({projectId, exceptPanelIds})`. The
    unsaved-editor prompt stays first.
  - `packages/ui/src/renderer/sidebar/project-menu.ts`: the two rows.
  - Drop any Preferences wiring for the withdrawn setting.

  Turns T123, T124 (component), T125 (component), T126 and T120's project-menu part green.
  (FR-081, FR-086, FR-111)
- [x] T129 [US4] E2E in place, `throng-e2e-harness`, in `packages/ui/tests/e2e/terminal-no-orphans.e2e.ts`
  (the T065 declarations; tags and `@reserve:process` unchanged):
  - the keep declaration clicks **Unload Project** (default `keepRunning`) and asserts that the
    idle shell's process **survives** and is the same pid after the project is selected again;
  - the end declaration clicks **Unload Project and End Terminals** and no longer presses Enter for
    a dialog. Its reaping assertion stands.

  Run those two declarations only, at `--workers=1`. The budget is unchanged. (FR-086, FR-111,
  Principle III)

### 10H: Projects pane (`throng-renderer-ui`)

#### RED

- [x] T130 [P] [US2] RED **repro** (reported defect: "clicking a project flashes the active pane"),
  component, in `packages/ui/tests/component/project-switch-active-pane.test.ts`. Record every
  `setActivePane` call.
  - A click on a project row, and Enter on the selected row, switch project. The active pane is
    `projects` throughout, and never `workspace`, even transiently. DOM focus stays on the chosen
    row.
  - `project.next` from the workspace leaves `workspace` active, and from the Projects pane leaves
    `projects`.
  - After a pointer-down in the workspace, Ctrl+S reaches the new project's editor (the
    `52d8f13d` guard).
  - Record the observed failure before T136.

  (FR-082, SC-012)
- [x] T131 [P] [US5] RED component: in `packages/ui/tests/component/projects-panel-drag-categories.test.ts`:
  - a drag starting on the name, the colour swatch or the row's empty space moves the project;
  - a drag starting on Edit, Remove or an open rename or edit input does not;
  - a press under the activation distance still switches project;
  - a double-click on the name still renames.

  (FR-075)
- [x] T132 [P] [US5] RED component: in `packages/ui/tests/component/projects-panel-categories.test.ts`,
  every header, the default's included, uses the `categoryHeaderBackground` colour variable. The
  rename field keeps the stored casing. The count is unaffected. (FR-072)
- [x] T133 [P] [US5] RED component: in `packages/ui/tests/component/projects-panel-category-menu.test.ts`:
  - Move Category Up is disabled on the first non-default category, and Move Category Down on the
    last;
  - both are absent from the default category's menu;
  - each calls the store's reorder with the new order.

  (FR-083)
- [x] T134 [P] [US5] RED component: create
  `packages/ui/tests/component/projects-panel-category-reorder.test.ts`:
  - a non-default header drags to a new position among the non-default categories, carrying its
    projects and its minimised state;
  - the default header is not draggable, and no drop lands above it;
  - a header drag never moves a project, and a project drag never moves a category.

  (FR-083)
- [x] T135 [P] [US2] RED unit(ui): create `packages/ui/tests/unit/side-pane-outline.test.ts`. It
  parses `packages/ui/src/renderer/panes/panes.css` (CRLF-tolerant) and asserts that the
  `.pane-explorer__body--active::after` and `.projects-panel--active::after` outline width equals
  the panes' default border width (1px). The workspace panels' outline rule is untouched. (FR-073)

#### GREEN

- [x] T136 [US2] GREEN: stop `PanelFocusSync` in `packages/ui/src/renderer/app.tsx` from claiming
  the workspace for a list-initiated switch. Mark the switch's origin in
  `packages/ui/src/renderer/sidebar/projects-panel.tsx`, and in
  `packages/ui/src/renderer/state/projects-store.tsx` if the origin must travel with
  `switchProject`. Chord switches leave the active pane alone. Turns T130 green. (FR-082)
- [x] T137 [US5] GREEN, in `packages/ui/src/renderer/sidebar/projects-panel.tsx`:
  - move the `useDraggable` listeners from `ProjectGrip` to the row, and stop propagation from
    Edit, Remove and the inline inputs. The grip stays.
  - In `packages/ui/src/renderer/theme.css`, the header background uses
    `var(--throng-colour-categoryHeaderBackground)`.

  Turns T131 and T132 green. (FR-072, FR-075)
- [x] T138 [US5] GREEN:
  - `reorderCategories` in `packages/ui/src/renderer/state/projects-client.ts` and
    `packages/ui/src/renderer/state/projects-store.tsx`;
  - Move Category Up / Down in `packages/ui/src/renderer/sidebar/category-menu.ts`;
  - a draggable non-default header, and the header drop logic, in
    `packages/ui/src/renderer/sidebar/projects-panel.tsx`.

  Turns T133, T134 and T120's category-menu part green. (FR-083, FR-084)
- [x] T139 [P] [US2] GREEN: set the side-pane active outline to 1px in
  `packages/ui/src/renderer/panes/panes.css`. Turns T135 green. (FR-073)

### 10I: Replace All finding (`throng-editor-documents`)

- [x] T140 [US3] RED **repro** (FR-093's defect finding; the chord is `Ctrl+Alt+Enter` under
  FR-103): create `packages/ui/tests/component/search-replace-all-chord.test.ts` through
  `SearchKeybindings` with a mounted editor.
  - With the find bar open and its replace section shown, `Ctrl+Alt+Enter` replaces every match,
    with focus in the find field, in the replace field and in the document.
  - With the replace section hidden, or no bar open, it is a no-op and passes the key on.

  Record which cases fail. If all pass, record that the defect does not reproduce at component
  level and hand it to the controller. Do not escalate to E2E, because the budget is flat.
  (FR-093)
- [x] T141 [US3] GREEN, only for the cases T140 showed red: fix
  `packages/ui/src/renderer/search/search-keybindings.tsx`, including the replace-section gate.
  (FR-093)

### 10J: E2E presses re-pointed (`throng-e2e-harness`)

- [x] T142 [US2] E2E in place. Re-point every literal press of a moved default, with no declaration
  added or removed and the tags unchanged.
  - `packages/ui/tests/e2e/window-chord-resolution.e2e.ts`: `:77` `Control+Alt+B` →
    `Control+Shift+Alt+B`; `:87` `Control+Shift+0` → `Control+Shift+Alt+0`, still from a focused
    real terminal whose write log stays empty (its `@reserve:input` digit case); `:523` →
    `Control+Shift+Alt+PageDown`.
  - `notice-focus-chord.e2e.ts` (`:46`, `:135`, `:142`).
  - `tab-picker.e2e.ts:70`, `transient-overlays.e2e.ts:71` and `tab-scroll.e2e.ts:209`.
  - `pane-shortcuts.e2e.ts:118`.
  - `editor-word-wrap.e2e.ts` (two presses: `Control+E`, then `W`).
  - `move-focus.e2e.ts` and `status-bar-visibility.e2e.ts`.
  - `preferences-reset.e2e.ts:314-359` and `:448`: its premise that `zoom.in` ships several chords
    is false under FR-105. Re-point the remove-then-reset case to an action that still ships a
    chord plus a gesture (`panel.zoomIn`), so the reset assertion still has something to restore.
  - Any further hit of `git grep -nE "Control\+Alt\+|Control\+Shift\+0|Control\+(Equal|Minus|0)" -- packages/ui/tests/e2e`
    that presses a moved default.

  All files are under `packages/ui/tests/e2e/`. Press tier-1 `+` / `-` as `Equal` / `Minus` with
  Shift. Run each changed declaration alone at `--workers=1`. (FR-102, FR-112)

### 10K: docs, disclosure, hand checks and the gate

- [x] T143 [P] Update `README.md`:
  - Highlights: the two Unload rows and no unload prompt;
  - Configuration: remove `confirmations.unloadProject`;
  - the keyboard lines: FR-102 defaults in the FR-105 form (`Ctrl+Shift+Alt++`), the cog Zoom row,
    and the Ctrl wheel / middle-click zooming the panel under the pointer.

  (FR-112)
- [x] T144 [P] Update `docs/quick-start.md`, the keyboard reference table first:
  - the three tiers and their exceptions, and every FR-102 default in the FR-105 form;
  - the keypad `+` / `-` / `0` as the same binding;
  - `Ctrl+E W` as a two-stroke chord;
  - the gestures on the panel under the pointer, and the cog Zoom row;
  - §1's Unload text (two rows, no prompt; Keep Terminals Running keeps idle shells);
  - category reorder and whole-row drag;
  - the pane chord line (`:35`).

  (FR-088, FR-112)
- [x] T145 [P] Update `CONTRIBUTING.md` where it states chords, dispatch conventions or the E2E
  budget: the tier rule and the unchanged 573. If it states none, change nothing and say so in the
  report. (FR-112)
  *Done 2026-09-25: it states no chord, no dispatch convention and no budget number (only that a
  budget exists), so nothing changed.*
- [x] T146 [P] Update `docs/testing.md`'s 046 section:
  - `terminal-no-orphans.e2e.ts` now asserts survival on the keep path;
  - `window-chord-resolution.e2e.ts` presses tier-1 chords;
  - the other re-pointed presses (T142);
  - the budget unchanged at 573.

  (FR-088, FR-112)
  *Done 2026-09-25 as a new "Iterate round 1" subsection. The `terminal-no-orphans.e2e.ts` table row
  (`docs/testing.md:383`) is left to T129, which owns it; the subsection points at it. The presses
  described are T142's, which had not landed when this was written — re-read the subsection
  against the re-pointed files when T142 lands.*
- [x] T147 [P] Add entries to `## Unreleased` in `CHANGELOG.md`, under `### Changed`: the moved
  defaults, the unbound plain Ctrl++ / Ctrl+- / Ctrl+0 (with #390 retired in favour of
  Ctrl+Shift+Alt+0 and the cog Zoom row), the gestures on the panel zoom, `Ctrl+E W`, Keep
  Terminals Running keeping idle shells, and the withdrawn unload confirmation setting. Replace the
  existing "Ctrl+Shift+0 resets zoom (#390)" line rather than contradicting it. (FR-112)
  *Done 2026-09-25. Unload's prompt-free rows, idle shells kept and the withdrawn setting never
  shipped (Unload is new in this Unreleased section), so they are written into the existing
  `### Added` Unload entry rather than as `### Changed` lines, which would describe a change from a
  release that never had them. The `### Added` project-cycling and categories entries are corrected
  the same way, the cog Zoom row is an `### Added` line, and the AltGr+Shift losses are a
  `### Known issues` line.*
- [x] T148 [P] (`throng-spec-governance`) Complete research.md R22's *owed* AltGr+Shift
  fourth-level check. For each tier-1 bound key (B, F, M, N, P, T, the digits, `=`, `-` and the
  arrows), name the character lost on each of the seven common European layouts that constitution
  IV's AltGr check names, from the published layout tables. Carry the result into
  `docs/quick-start.md`'s keyboard notes after T144. This is constitution v5.6.0 IV's disclosure
  duty. (FR-104)
- [ ] T149 Maintainer hand checks. Nothing here runs them on the user's behalf.
  - In the dev build, validate [quickstart.md](./quickstart.md) §5a, including its step 10.
  - Run the two probes research R22 owes:
    - the `CSI 1;8` arrows: `bind -p | grep '1;8'` in Git Bash, and `Get-PSReadLineKeyHandler` in
      PowerShell 7 (FR-021);
    - whether Chromium reports `getModifierState('AltGraph')` for right AltGr and not for left
      Ctrl+Alt (FR-104 hypothesis) — this is probe (c) of §5a step 10, run once and shared with it.
  - Record both results in research R22 and the PR description. If AltGraph holds, T151 / T152
    add the decline to `chord-key.ts`. If a `1;8` arrow is bound, FR-021's replacement applies
    before the gate.
  - *[derived]* The `AltGraph` probe is FR-104's settling test: only a real keyboard reports the
    real modifier state, and a synthetic event carries whatever the test sets. Both probes gate
    T150, because FR-104 and FR-102 each require their answer before tier 1 ships.
  - **NumLock probe (FR-113, FR-114), quickstart §5a step 10, on a physical keyboard**, with the
    window and one panel both already zoomed in:
    (a) with NumLock **ON**, press Ctrl+Shift+Alt+Numpad0 — **expect** the WINDOW resets, the
    panel's zoom unchanged; record which actually happens (the hypothesis: Windows' fake Shift
    key-up, since Shift overrides NumLock on the keypad, may make the press arrive as
    Ctrl+Alt+Numpad0 and reset the panel instead);
    (b) with NumLock **OFF**, repeat the same press and record which resets.
    Record (a) and (b) in research R22 and the PR description, alongside the two probes above.
    *Result, (a) and (b) (maintainer, 2026-09-25, physical keyboard):* "Ctrl+Shift+Alt+Numpad0 does
    not reset the window zoom — with NumLock ON it resets the active panel's zoom instead; with
    NumLock OFF nothing happens." Recorded in research R22 ("T149 NumLock probe result") and as
    spec FR-120. The defect is carried by T189 / T190. Still owed here: probe (c) (AltGraph), the
    `CSI 1;8` probe, §5a, and §5b (T188). The PR description records (a) and (b) under T187.
    *Follow-up (maintainer, 2026-09-25, fresh build):* (b) was a **stale build**. On a fresh build
    NumLock OFF resets the window, so (b) is not a defect and is dropped. (a) is confirmed and
    measured (research R22's "T149 follow-up"), and FR-120 now specifies the fix, which T190 lands.
- [ ] T151 [US2] RED unit(ui), **only if T149 finds that AltGraph holds**: in
  `packages/ui/tests/unit/chord-candidates.test.ts`, a tier-1 event with
  `getModifierState('AltGraph')` true yields no chord, and left Ctrl+Shift+Alt still does. If
  AltGraph does not hold, close this task with the probe result and no change. (FR-104)
- [ ] T152 [US2] GREEN, only after T151 is red: the `AltGraph` decline in
  `packages/ui/src/renderer/config/chord-key.ts` and its mirror in
  `packages/ui/tests/shared/window-chords.ts`. Turns T151 green. (FR-104)
- [x] T153 (`throng-spec-governance`) Land T124's app-close answer. If an idle shell **is**
  closed at app close, name the path in FR-086's analyze note and close this task. If it is
  **not**, the gap predates 046, because no app-close path has ever called `closeIdle`. Then:
  - record it in plan.md's Complexity Tracking as a known violation of constitution III's
    idle-shell rule, stated as an end-state requirement under Incremental Delivery. Name the
    feature or milestone expected to complete it, as Incremental Delivery requires;
  - file a labelled issue with the `github-issues` skill;
  - update every "pending T153" passage in plan.md (the III row, the Incremental-delivery row, the
    Result line, the Deferrals line and the Complexity Tracking note), FR-086's analyze note, the
    S10 row and `contracts/unload.md` §6, so they cite the row and the issue.

  Building the app-close rule is out of this round's scope. (FR-086, constitution III)

  *Landed 2026-09-25: the **not-closed** branch.* No production path closes an idle shell at app
  close; after T128 `closeIdle` has no caller. Recorded as a pre-existing known violation in
  plan.md's Complexity Tracking, with every "pending T153" passage (plan.md's III row,
  Incremental-delivery row, Result line, Deferrals line, Complexity Tracking note and the
  story-delivery "None needs a deferral" line; spec FR-086, the S10 row, the FR-086 clarification
  and the app-close edge case; `contracts/unload.md` §6) updated to cite it. The issue is filed by
  the controller from T153's report, not by this task; `#TBD-T153` in those passages is replaced
  with its number when it exists.
- [x] T150 Dispatch `.github/workflows/gate.yml` against the branch, run
  `gh run watch <id> --exit-status`, then take the verdict from
  `gh run view <id> --json status,conclusion`. Quote the run URL and SHA. A red stage means stop,
  fix and re-run. The PR closes #390 with FR-113's close text: the global zoom reset is
  **Ctrl+Shift+Alt+Numpad0**, there is no mouse or menu route to it, and the Ctrl+Shift+0 it asked
  for is retired. (SC-008, FR-113, FR-114)

  *Corrected (T170, 2026-09-25): the close text above originally read "Ctrl+Shift+Alt+0 plus the cog
  menu's Zoom row" (FR-107's pre-FR-113 text). FR-113 withdrew the cog menu's Zoom row and FR-114
  moved the reset chord to the physical Numpad0 key; the corrected text above is what #390 actually
  closes on.*

  *Green after Phase 13, 2026-09-26: all 8 stages at `b2585894` —
  https://github.com/Bidthedog/throng/actions/runs/36223483190.*
  *Green after Phase 14, 2026-09-26: all 8 stages at `872f6d2e` —
  https://github.com/Bidthedog/throng/actions/runs/36242059801 (after run 36240911773 failed on
  `editor-language-override.e2e.ts:288`, re-pinned for FR-121).*

### Phase 10 dependencies

- **10A and 10B** start together. **10C** needs T098 – T100. **10D** needs T098. **10E** needs T099.
  **10F** needs T099. **10G** needs nothing from 10A except for T128's menu labels. **10H**'s T138
  needs T104. **10I** is independent. **10J** needs T111 and T117. **10K** comes last, except T148,
  which can start any time. T151 / T152 need T149 and T111. T153 needs T124. T150 needs everything
  else, T149's results, T153 and, when T149 spawns them, T151 / T152.
  *Ordering record (analyze F1, 2026-09-26):* T150 has been dispatched ahead of T149, which is the
  maintainer's hand check and cannot be run here. Each green gate is evidence about the code at its
  SHA only. FR-104's AltGraph question is settled by T149 before the branch **merges**, not before
  a gate runs: PR #440 stays a draft until T149 is recorded, and if T149 finds AltGraph holds,
  T151 / T152 are built and T150 is re-dispatched.

### Phase 10 parallel waves, footprint-checked

| Wave | Tasks | Shared files that forced a boundary |
|---|---|---|
| P1 | T092 – T096, T101, T102 | each owns distinct test files. T097 (unknown footprint, by grep) is sequential after the wave |
| P2 | T105, then T106 – T110, T115, T116, T118, T120, T121, T123 – T126, T130 – T135, T140 | T105 owns `tests/shared/chord-event.ts` and goes first. Everything else owns distinct test files. `menu-sections.test.ts` (ui) is T120 only, `title-bar.test.ts` is T121 only, and `projects-panel-*.test.ts` is one file per task |
| GREEN | T098 → T099 → T100; T103 → T104; T111 → T112 → T113 → T114; T117; T119; T122; T127 → T128; T136 → T137 → T138; T139 [P] | `keybindings.ts` (T098, T099); `chord-capture.ts` (T098, T112); `app.tsx` (T114, T136); `projects-panel.tsx` (T136, T137, T138); `theme.css` (T122, T137); `projects-store.tsx` (T136, T138); `main.tsx` is T119 only; `panes.css` is T139 only |
| E2E | T129, then T142 | one E2E run at a time, one declaration at a time |
| Docs | T143 – T148 | one file each. T148 writes research.md and then feeds T144 |

**Shared files never placed twice in one run**:

- `keybindings.ts`: T098, T099.
- `keybindings-metadata.ts`: T099.
- `shipped-defaults.ts`, `theme.ts` and `theme-copy.ts`: T100.
- `chord-key.ts`: T111.
- `scope.ts`: T113.
- `app.tsx`: T114, T136.
- The cog menu: T122.
- `context-menu.tsx`: T122.
- `theme.css`: T122, T137.
- `e2e-budget.json` and `parallel-plan.json`: none.

## Phase 11: Iterate round 2, maintainer mid-build decisions (checkpoint 2026-09-25)

**Source**: spec FR-113 – FR-115, SC-017, supersessions S24 – S25, the new "Session 2026-09-25
(maintainer, mid-build)" clarification. Constitution v5.6.0, amended in the same change (its fourth
revision before publication). The maintainer's two decisions, verbatim: "Remove the new "Zoom"
options from the menu." and "The "Zoom Reset" key bindings need to use the numpad zero, NOT the 0
key."

**Not amended in this round**: `plan.md`. It still describes the iterate-round-1 cog Zoom row and
goes stale until a future round reconciles it; that is a known gap, not a task here.

**Rules for this phase** (as Phase 10): test-first, every GREEN task names the RED task(s) it turns
green. **E2E budget stays 573 (`@core` 39).** No declaration is added or removed; T164 edits an
existing declaration in place. Keep `window-chord-manifest`, `renderer-chord-resolvers`,
`terminal-reserved-keys`, `keybindings-collision` and `project-references-cover-imports` green.
Source-parsing tests must tolerate CRLF and LF.

### 11A: remove the cog menu Zoom row (`throng-renderer-ui`)

- [x] T154 [US3] RED component: invert every assertion T121 wrote in
  `packages/ui/tests/component/cog-zoom-row.test.ts` — assert the `cog-menu-zoom-in` /
  `cog-menu-zoom-out` / `cog-menu-zoom-reset` controls and the `viewState` "Zoom" section are ABSENT
  from the rendered cog menu, whatever `windowZoomLevel` the harness passes. (FR-113)
- [x] T155 [US3] [P] RED unit(ui): extend `packages/ui/tests/unit/menu-sections.test.ts` so the cog
  menu is pinned back to its single Application section — no `viewState` section — restoring the
  shape the 2026-09-09 audit (constitution Principle VI) describes. (FR-113)
- [x] T156 [US3] GREEN, turns T154 and T155 green: remove `zoomControls`, the `viewState` "Zoom"
  section, the `windowZoomLevel` prop and the `onZoomIn` / `onZoomOut` / `onZoomReset` callbacks from
  `packages/ui/src/renderer/title-bar/cog-menu-items.ts`, and their wiring — including the
  `window.throng?.zoomLevel?.()` read — from `packages/ui/src/renderer/title-bar/cog-menu.tsx:50`.
  (FR-113)
- [x] T157 [US3] Remove the now-dead `throng:zoomLevel` IPC round trip, only if T156 leaves it with no
  caller: `grep -rn "throng:zoomLevel\|\.zoomLevel(" packages/ui/src` before starting — at the time
  this task was written the only caller was `cog-menu.tsx:50`. If still true, remove the main-process
  handler (`packages/ui/src/main/main.ts:302`), the preload hook (`packages/ui/src/preload/preload.cts:118`)
  and its type (`packages/ui/src/renderer/global.d.ts:48`), with a test asserting the handler is gone.
  If a new caller has appeared, leave it and say so in the report. (FR-113)

### 11B: the Numpad0 reset remap (`throng-config-preferences`, `throng-renderer-ui`)

- [x] T158 [US3] [P] RED unit(core): extend `packages/core/tests/unit/keybindings-tiers.test.ts`'s
  FR-102 table assertion so `zoom.reset` MUST equal `['Ctrl+Shift+Alt+Numpad0']` and
  `panel.zoomReset` MUST equal `['Ctrl+Alt+Numpad0', 'Ctrl+MiddleClick']`; a shipped
  `Ctrl+Shift+Alt+0` or `Ctrl+Alt+0` on either command now fails the guard. Extend the FR-105 "no
  shipped `Numpad…` token" guard with the two-command carve-out: it MUST still fail a `Numpad…` token
  shipped on any OTHER command. (FR-114)
- [x] T159 [US3] GREEN, turns T158 green: in `packages/core/src/config/keybindings.ts`
  `WINDOWS_BINDINGS`, change `'zoom.reset': ['Ctrl+Shift+Alt+0']` (currently line 382) to
  `['Ctrl+Shift+Alt+Numpad0']`, and `'panel.zoomReset': ['Ctrl+Alt+0', 'Ctrl+MiddleClick']` (currently
  line 388) to `['Ctrl+Alt+Numpad0', 'Ctrl+MiddleClick']`. (FR-114)
- [x] T160 [US3] [P] RED unit(core): extend
  `packages/core/tests/unit/shipped-defaults-upgrade-v13-keybindings.test.ts` so the `zoom.reset` /
  `panel.zoomReset` rewrite targets are the Numpad0 values, still gated on FR-108's old v11 / v12
  values and its collision guard; assert the re-run stays idempotent. (FR-115)
- [x] T161 [US3] GREEN, turns T160 green: update the version-13 rewrite table (alongside T100's file,
  `packages/core/src/config/shipped-defaults.ts`) so `zoom.reset` and `panel.zoomReset` rewrite to
  the Numpad0 values, not FR-102's `0` values. (FR-115)
- [x] T162 [US3] RED unit(core) + unit(ui), after T159/T161: extend
  `packages/core/tests/unit/chord-capture.test.ts` and
  `packages/ui/tests/unit/renderer-chord-resolvers.test.ts` so:
  - `zoom.reset` and `panel.zoomReset` resolve ONLY from a keydown whose physical `code` is
    `Numpad0`, with and without NumLock (NumLock off still reports `code: 'Numpad0'`), and never from
    `Digit0` or a produced `'0'`;
  - the capture modal (`packages/ui/tests/component/preferences-capture-modal.test.ts`) records a
    `Numpad0` press on these two commands as `Numpad0`, displayed as `Ctrl+Shift+Alt+Numpad0` /
    `Ctrl+Alt+Numpad0`, never folded into the same-binding `0` token;
  - every OTHER command's `+` / `-` same-binding rule (FR-105) is unaffected by this change; no
    other command's keypad `0` resolves the same as its main-row `0` either — a binding on `0` for
    any other command fires only from the main-row key.
  (FR-114)

  *Wording corrected (T168, 2026-09-25): the bullet above originally read "... `+` / `-` / `0`
  same-binding rule (FR-105) is unaffected by this change", implying every OTHER command keeps the
  keypad `0` == main-row `0` reading. That was never what the tests this task added assert, and it
  contradicts the code: `Numpad0` is its own key for every command, not only these two (see FR-105's
  and FR-114's 2026-09-25 amendments). Corrected in place rather than left to mislead a future
  reader.*
- [x] T163 [US3] GREEN, turns T162 green: in `packages/ui/src/renderer/config/chord-key.ts`, replace
  `digitCandidate`'s blanket `e.code === 'Numpad0' ? '0' : undefined` alias with an explicit
  two-command exception — a `Numpad0` press produces its OWN candidate token (`Numpad0`, not `'0'`),
  which only the `zoom.reset` / `panel.zoomReset` resolvers accept, while `Digit0` keeps resolving
  every other Ctrl+digit command exactly as today. Mirror the change in
  `packages/core/src/config/chord-capture.ts`'s `sameBindingSymbolOfCode` / capture-token model,
  keeping both in sync per the file's own header comment warning against re-deriving one from the
  other. Add the `Numpad0` display form to `eventToToken` (the Key Bindings editor / menu shortcut
  renderer) and the capture modal. (FR-114)

  *Wording corrected (T168, 2026-09-25): "an explicit two-command exception... which only the
  zoom.reset / panel.zoomReset resolvers accept" described the shipped-default guard, not the
  resolver's general behaviour, and read as though `Numpad0` only ever produces its own token for
  those two commands. What the code this task landed actually does is general: a `Numpad0` press
  ALWAYS produces its own candidate token, for every command; `zoom.reset` and `panel.zoomReset` are
  simply the only commands whose SHIPPED default is written to accept it. `Digit0` keeps resolving
  every other Ctrl+digit command exactly as before because those commands' defaults are `Digit0` /
  `'0'`-based, not because `Numpad0` is scoped away from them.*
- [x] T164 [US3] E2E, no declaration added or removed, budget stays 573: re-point
  `packages/ui/tests/e2e/window-chord-resolution.e2e.ts:87` from its `Control+Shift+Alt+0` press for
  `zoom.reset` to a `Numpad0`-coded press, still from a focused real terminal whose write log stays
  empty. If T142 (Phase 10, 10K) has already landed with the old press, this task corrects it in
  place; if T142 has not yet run, fold this repoint into T142 directly instead of touching the line
  twice. (FR-114)

### 11C: docs (`throng-spec-governance`)

- [x] T165 [P] Update `README.md`'s keyboard lines (T143's passage): drop the cog Zoom row from the
  Highlights and keyboard sections, and change the zoom-reset chords to `Ctrl+Shift+Alt+Numpad0`
  (window, no other route) and `Ctrl+Alt+Numpad0` (panel, plus Ctrl+MiddleClick), noting the
  main-row `0` no longer resets either. (FR-113, FR-114)
- [x] T166 [P] Update `docs/quick-start.md`'s keyboard reference table (T144's passage) the same way,
  and its description of the cog menu's Application-only section. (FR-113, FR-114)
- [x] T167 [P] Update `CHANGELOG.md`: since 046 is unreleased, record the cog menu Zoom row and the
  `0`-key reset as never having shipped rather than as a user-visible removal, and record the
  Numpad0-only reset chords as the shipped defaults. (FR-113, FR-114)

### Phase 11 dependencies

- **11A** (T154 – T157) and **11B** (T158 – T164) are independent of each other. Both build on files
  Phase 10 already created or touched: T098 – T100's `keybindings.ts` / `shipped-defaults.ts`, T111's
  `chord-key.ts`, T112's `chord-capture.ts`, T121's `cog-zoom-row.test.ts`, T122's cog-menu wiring,
  and T142's E2E repoints.
- **11C** needs 11A and 11B's final shapes to describe truthfully.
- Re-dispatch `.github/workflows/gate.yml` after this phase. If T150 (Phase 10) has not yet run, one
  dispatch after both phases covers both; if it has already run, a fresh dispatch is owed before
  either round is claimed done (CLAUDE.md's tree-vs-SHA rule: the tree changed, so the old green run
  is no longer evidence).

## Phase 12: Convergence

**Source**: `/speckit-converge` against HEAD `b67029fa`, scoped to iterate rounds 1 – 2 (FR-072 –
FR-115, SC-009 – SC-017, T092 – T167). The Spec Kit prerequisites script was not run; FEATURE_DIR
was resolved by hand. No constitution MUST is violated. Not raised, because they are already known
and accepted: T149 (maintainer hand checks), T150 (the gate), T151 / T152 (conditional on T149), the
app-close idle-shell known violation T153 recorded (`d34a0502`), `closeIdle` having no caller (a
hardening note), and the round-1 v13 dev-config note. Every FR-072 – FR-115 code obligation was
found built; the four findings below are one spec/code disagreement and three artifact or tracking
gaps.

- [x] T168 [US3] Settle whether `Numpad0` is a key of its own for **every** command or only for
  `zoom.reset` / `panel.zoomReset`, then make spec and code agree. The code makes it a key of its
  own everywhere: `sameBindingSymbolOfCode` returns `'Numpad0'` unconditionally
  (`packages/core/src/config/chord-capture.ts:91-92`), so `captureToken` records `Ctrl+Alt+Numpad0`
  or `Ctrl+Shift+Alt+Numpad0` for **any** command (`:144-149`). `chordCandidates` returns only the
  `Numpad0` candidate for a Ctrl+Alt or Ctrl+Shift+Alt press (`packages/ui/src/renderer/config/chord-key.ts:121-122`,
  `:91`), and commit `b67029fa` removed the fold from binding identity. The spec says the opposite:
  the FR-105 supersede note (spec.md:1422-1426), FR-114 (spec.md:1818-1821), and T162 / T163
  (tasks.md:1758, :1762-1764, "which only the `zoom.reset` / `panel.zoomReset` resolvers accept")
  all keep the keypad `0` as the same binding as the main-row `0` for every other command. What a
  user sees: bind any other command to `Ctrl+Alt+0` or `Ctrl+Shift+Alt+0` in Key Bindings, and the
  keypad zero does not fire it. Capturing that press on any command records `…+Numpad0`, not
  `…+0`. Either amend FR-105 / FR-114 through `throng-spec-governance` to say what the code does,
  with the reason `b67029fa` gives, or make the `Numpad0` fold command-scoped in both files, test
  first, with a capture and resolver case for a non-reset command. per FR-105, FR-114, SC-017
  (contradicts, MEDIUM)

  *Landed 2026-09-25: controller decision — **the code is right**. `Numpad0` is its own key for
  every command (`b67029fa`; `chord-capture.ts` / `chord-key.ts`), and keypad `0` is never the same
  binding as main-row `0`, for any command. Keypad `+` and `-` still equal main-row `+` and `-`
  everywhere, unaffected. Rationale: the maintainer's instruction ("The "Zoom Reset" key bindings
  need to use the numpad zero, NOT the 0 key") named these two commands because they were the only
  ones with a shipped `0`-family default; the earlier keypad-0-equals-main-row-0 reading for every
  other command was a derived extension of the maintainer's separate `+` / `-` request, and no other
  shipped default ever used `0`. Consequence recorded: a user who binds any other command to
  `Ctrl+Alt+0` fires it only from the main-row `0`. Amended additively, dated 2026-09-25 and marked
  derived: spec.md's FR-105 supersede note and FR-114 (a further-amended paragraph appended to each,
  history kept); T162 / T163's wording notes corrected in place; constitution.md's Principle IV
  keypad bullet corrected with a fifth SYNC IMPACT REPORT revision, still v5.6.0 (unpublished).*
- [x] T169 Bring PR #440's description in line with iterate rounds 1 – 2. The body still promises
  pre-round-1 behaviour. Outcomes lists Next / Previous Project on Ctrl+Alt+PageDown / PageUp and
  Focus on Ctrl+Alt+F / P, "sit at the top of the cog menu", and "Ctrl+Shift+0 resets zoom". FR-102,
  FR-074 and FR-107 retired all of these. T150's own close-text clause (tasks.md:1657-1659) still
  names "Ctrl+Shift+Alt+0 plus the cog menu's Zoom row", which FR-113 withdrew. When the PR closes
  #390, use FR-113's close text: the global reset is **Ctrl+Shift+Alt+Numpad0**, there is no mouse
  or menu route to it, and the Ctrl+Shift+0 it asked for is retired. Read the body back for
  attribution lines before `gh pr edit`. per FR-113, FR-074, FR-102, FR-112 (contradicts, LOW)

  *Landed 2026-09-25: the round-1 and round-2 edits had already brought the Outcomes to the tiered
  chords, the keyboard-only navigation and the Numpad0 resets, and T150's close text already names
  FR-113's. This pass added FR-113's close text to the #390 line of the body, extended the
  supersession pointer to S26, and added `Related to #442`. The body was read back with no
  attribution lines, and the closing set reads back as #292, #331, #332, #390, #411.*
- [x] T170 (`throng-spec-governance`) Reconcile the design artifacts with FR-113 – FR-115. Append
  supersede notes, and delete nothing. Phase 11 recorded only plan.md as stale, and it is not the
  only one:
  - `data-model.md:127-128` still gives `zoom.reset` `Ctrl+Shift+Alt+0` and `panel.zoomReset`
    `Ctrl+Alt+0`, and `:133-134` says "no `Numpad…` token exists";
  - `contracts/menus.md:103-112` §3 still specifies the cog `[viewState, application]` Zoom row;
  - `contracts/keybindings-and-focus.md:53` gives `panel.zoomReset` `Ctrl+Alt+0` "(unchanged)", and
    `:99` and `:108` map `Numpad0` → `0`;
  - `plan.md:439`, `:493`, `:495`, `:508`, `:525`, `:537`, `:539` and `:544` still describe the cog
    Zoom row, the window zoom level read and `Ctrl+Shift+Alt+0`.

  If T168 settles on the code's reading, carry it into the same notes. per FR-113, FR-114, FR-115,
  documentation currency (contradicts, LOW)

  *Landed 2026-09-25: all six passages updated with supersede notes (nothing deleted). T168's
  general reading (`Numpad0` distinct from main-row `0` for every command) carried into the same
  notes where relevant. `data-model.md`'s §4 defaults table and its FR-105 bullet;
  `contracts/menus.md` §3 (struck through, cog menu is `[application]` only, no Zoom row);
  `contracts/keybindings-and-focus.md`'s example table, tier-1 physical rule and same-binding
  paragraph; `plan.md`'s gap-analysis Cog-menu bullet, the VI / VIII / Themeable-icon-controls
  Constitution Check rows, the re-evaluation finding, and the zoom-routing / cog-menu / E2E rows of
  the layers table.*
- [x] T171 File T153's tracking issue and replace every `#TBD-T153` placeholder with its number. T153
  (tasks.md:1652-1653) handed the filing to the controller, and no open issue exists yet. The
  placeholders are at `plan.md:291`, `:490`, `:502`, `:512` and `:567`, at spec.md:1638 (the FR-086
  note) and :1869 (the S10 row), and at `contracts/unload.md:117`. Use the `github-issues` skill. The
  violation itself is accepted, and this task leaves it alone. What it closes is the Incremental
  Delivery rule that a known violation carries an open labelled issue. per FR-086, constitution
  Incremental Delivery (partial, LOW)

  *Landed 2026-09-25: NOT filed. This gap is known only from reading the code (`closeIdle` has no
  production caller after T128) and was never reproduced by hand — no keyboard/mouse steps, no
  observed frequency — so the repo's rule against filing an unreproduced bug applies and no GitHub
  issue is created. Every `#TBD-T153` placeholder (`plan.md:291`, `:490`, `:502`, `:512`, `:567`;
  `spec.md:1638`, `:1869`, and an additional occurrence at `:701` found during this pass;
  `contracts/unload.md:117`) is replaced with "not filed — unreproduced; recorded in PR #440's
  description for the maintainer to reproduce and file." The known violation itself, and its
  end-state requirement, stay recorded in `plan.md`'s Complexity Tracking exactly as T153 left them
  — this task only closes the placeholder, not the gap. The maintainer is asked, via PR #440's
  description, to reproduce and file it themselves if it is confirmed.*

## Phase 13: Iterate round 3, the B / N / M focus row and a route back to the workspace (2026-09-25)

**Source**: spec FR-116 – FR-119, SC-018, supersession S27, the new "Session 2026-09-25
(maintainer, iterate round 3 — hand-testing)" clarification, and research R22's iterate-round-3
check. Constitution v5.6.0 is amended in the same change, as a sixth revision of its SYNC IMPACT
REPORT (a record, not a new rule). The maintainer, verbatim: "There does not seem to be a way to get
back to the center pane from the keyboard." and "all shortcuts use Ctrl+Shift+Alt. Focus should be
B, N and M (from left to right). Collapse / expand side panes should be J and K, from left to right.
V for notices if it is not already reserved."

**Rules for this phase** (as Phases 10 and 11):
- Test-first. Every GREEN task names the RED task(s) it turns green.
- **E2E budget stays 573 (`@core` 39).** No declaration is added or removed. T181 edits titles,
  comments and one literal press in place. `focus.workspace` is proven at the component layer
  (FR-116), which is the lowest layer that mounts the side panes, the workspace and the real
  `KeybindingsHandler` together.
- Keep `window-chord-manifest`, `renderer-chord-resolvers`, `terminal-reserved-keys`,
  `keybindings-collision`, `keybindings-tiers` and `project-references-cover-imports` green.
  Source-parsing tests must tolerate CRLF and LF.
- Load **running-tests** before any command, and **throng-testing** before any E2E. Only one agent
  on the machine runs a test command at a time, so whoever holds the baton runs these tasks' tests.

**The hits this phase re-pins**, from `git grep` / ripgrep over `packages/*/tests` for
`Shift+Alt+<B|N|M|F|P>` and `code: 'Key<B|N|M|F|P>'`, on the branch at `69127230`. They are listed
so no task has to re-derive them:
- defaults asserted directly: `core/tests/unit/keybindings-tiers.test.ts:242-249`,
  `pane-toggle-defaults.test.ts:33-34, :68-69`, `keybindings-focus-notice.test.ts:47-58`,
  `keybindings.test.ts:229-230`, `keybindings.file.test.ts:57-58`,
  `shipped-defaults-upgrade-v13-keybindings.test.ts:132-133`;
- a chord named with the command that owns it: `ui/tests/component/physical-key-chords-every-resolver.test.ts:255-270`
  (B as `view.toggleProjects`), `:278-354` (M, disabled as `focus.notice`),
  `preferences-keybindings-tab.test.ts:387, :418, :481-500, :629`,
  `side-pane-focus-commands.test.ts:325, :338, :353, :379, :393` (`press('F')`) and `:424`
  (`press('P')`), and `ui/tests/shared/window-chords.ts:155-160, :178-187, :208-213`;
- E2E: `window-chord-resolution.e2e.ts:187` (title), `:406` and `:498-504` (title, comment and
  message), `notice-focus-chord.e2e.ts:46, :135, :142` (the one literal press), and
  `pane-shortcuts.e2e.ts:15, :25` (comments). Every other E2E press goes through `chordFor()` /
  `shippedPress()` and follows the defaults on its own;
- resolver-shape cases that use a letter as an example only and do **not** move:
  `chord-candidates.test.ts:215-265`, `chord-capture.test.ts:57-71`,
  `preferences-capture-modal.test.ts:155-173`, `window-chords-parser.test.ts:89, :97`. Re-read each
  and change only a comment that names an owning command.

### 13A: core defaults, metadata and the version-14 upgrade (`throng-config-preferences`)

- [x] T172 [US2] [P] RED unit(core). Change these, and change nothing else:
  - extend `packages/core/tests/unit/keybindings-tiers.test.ts`'s FR-102 table assertion to FR-117's
    rows: `focus.projects` `['Ctrl+Shift+Alt+B']`, `focus.workspace` `['Ctrl+Shift+Alt+N']`,
    `focus.explorer` `['Ctrl+Shift+Alt+M']`, `view.toggleProjects` `['Ctrl+Shift+Alt+J']`,
    `view.toggleExplorer` `['Ctrl+Shift+Alt+K']` and `focus.notice` `['Ctrl+Shift+Alt+V']`;
  - give `focus.workspace` tier 1. The FR-101 guard fails on an `ActionId` with no tier;
  - assert that no shipped default holds `Ctrl+Shift+Alt+F` or `Ctrl+Shift+Alt+P`;
  - re-pin the direct-default hits listed above (`pane-toggle-defaults`, `keybindings-focus-notice`,
    `keybindings`, `keybindings.file`) to the same values;
  - extend `keybindings-metadata.test.ts` so `focus.workspace` is listed in **Focus & Zoom** with a
    label and a description, and `COMMAND_SCOPES['focus.workspace']` is EVERYWHERE.

  Red until T173. (FR-116, FR-117, FR-087)

  *Landed 2026-09-25 (`c8847a2e`, with T173): RED observed, 10 failing across the six files for the
  stated reason (old chords, no `focus.workspace` descriptor or scope, F/P still owned). Also re-pinned
  `keybindings.test.ts`'s "resolves the default keyboard shortcuts" case (it pressed B / N as the pane
  toggles), which the preamble's hit list missed; `chord-capture.test.ts:57-71` is resolver-shape and
  unchanged.*
- [x] T173 [US2] GREEN, turns T172 green. In `packages/core/src/config/keybindings.ts`:
  - add `'focus.workspace'` to the `ActionId` union, with `COMMAND_SCOPES` EVERYWHERE;
  - set `WINDOWS_BINDINGS` to FR-117's six values (`:415`, `:429-430`, `:440-441`, plus the new row);
  - rewrite the comments above them (`:411-441`), which name B / N as the pane toggles, to FR-117.
    Keep 026's "Ctrl+B and Ctrl+N stay unclaimed" note.

  In `packages/core/src/config/keybindings-metadata.ts`, add `chord('focus.workspace', 'Focus &
  Zoom', 'Focus Workspace', …)` beside `focus.explorer` / `focus.projects` (`:95-106`). Its
  description names no chord (FR-119). (FR-116, FR-117)

  *Landed 2026-09-25 (`c8847a2e`): `focus.workspace` added, EVERYWHERE, `['Ctrl+Shift+Alt+N']`; the
  six FR-117 values set; comments rewritten, 026's Ctrl+B / Ctrl+N note kept. Descriptor placed after
  `focus.projects`. All 261 core unit files green after T175.*
- [x] T174 [US2] RED unit(core), after T173: add
  `packages/core/tests/unit/shipped-defaults-upgrade-v15-keybindings.test.ts`, which asserts:
  - `SHIPPED_DEFAULTS_VERSION` is 14, and `theme-link-tokens.test.ts:193`'s pin of 13 is re-pinned
    to 14 in the same task;
  - an untouched **version-13** document (FR-102's tier-1 values for the five rows) moves all five
    to FR-117's chords, and every other row is byte-identical;
  - untouched **version-11** and **version-12** documents move the five straight to FR-117. A
    version-13 chord never appears in the result;
  - a customised `view.toggleProjects` that still holds `Ctrl+Shift+Alt+B` (for example
    `['Ctrl+Shift+Alt+B', 'F7']`) is left alone, and `focus.projects` keeps its saved chord,
    refused by the fixed-point collision guard. A customised `focus.projects` is left alone;
  - a document with `view.toggleExplorer` customised to include `Ctrl+Shift+Alt+N` gets
    `focus.workspace: []` written. A document with no binding on N leaves `focus.workspace` absent,
    and `parseKeybindings` then fills `['Ctrl+Shift+Alt+N']`;
  - a second `applyKeybindingsUpgrade` over each result plans nothing (the idempotent re-run),
    including the file where `[]` was written.

  In `shipped-defaults-upgrade-v13-keybindings.test.ts:132-133`, re-point the collision case that
  pre-binds `Ctrl+Shift+Alt+M` for `focus.notice` to `Ctrl+Shift+Alt+V`, `focus.notice`'s target
  now. Wherever else that file hard-codes an FR-102 target for the five rows, re-pin it to FR-117.
  Red until T175. (FR-118)

  *Landed 2026-09-25 (`7a4d23f5`, with T175): RED observed, 6 failing — version 13 not 14, the v13
  document's rows not moving (`focus.notice` stayed `Ctrl+Shift+Alt+M`), both refusal cases, and both
  `focus.workspace: []` cases. The v11 / v12 straight-to-FR-117 cases were green before T175 (targets
  are the live shipped values) and stay as regression pins. The v13 file's only other FR-102 target is
  read live, so only `:132-133` moved.*
- [x] T175 [US2] GREEN, turns T174 green. In `packages/core/src/config/shipped-defaults.ts`:
  - add a frozen `V13_KEYBINDINGS` record for the five rows. It is a copy of what version 13 wrote,
    never a reference to the live constant, for `V4_EXCLUDE_GLOBS`'s reason;
  - append it to `planFR108Rows`'s `guardedRows` (`:712-715`). The `candidates.has(action)` skip
    already handles an action with several sources;
  - add the `focus.workspace` rule. Where the key is absent and `Ctrl+Shift+Alt+N` collides, by
    `collidesWithAnotherAction`'s comparison, with a binding that is not moving, plan
    `{ action: 'focus.workspace', value: [] }`. Evaluate it after the fixed point settles;
  - bump `SHIPPED_DEFAULTS_VERSION` to 14, with a history paragraph in the file's own style: the
    payload, why version 13 is not edited (the maintainer's config already holds a 13 marker), and
    the new-action fill collision.

  Update `planKeybindingsUpgrade`'s doc comment ("fifteen rows") to match. (FR-118)

  *Landed 2026-09-25 (`7a4d23f5`): `V13_KEYBINDINGS` frozen and exported; appended to `guardedRows`;
  the `focus.workspace: []` rule runs after the fixed point, only for an absent key, against the live
  shipped chord; version 14 with its history paragraph; both doc comments updated.*
- [x] T176 [US2] RED integration, after T175: extend
  `packages/ui/tests/integration/shipped-defaults-seed-upgrade.test.ts` with a config root seeded at
  marker **13**, holding version-13 keybindings. Run `upgrade()` and assert:
  - the five rows move, and the marker reads 14;
  - a second `upgrade()` writes nothing.

  This is the migration's idempotent re-run over the real file store. If it is red after T175, the
  fix is in `packages/ui/src/main/shipped-defaults-service.ts`, and T175's owner takes it. (FR-118)

  *Landed 2026-09-25 (`55587742`): green on its first run after T175, so no service change was
  needed; also covers a root where a kept N binding gets `focus.workspace: []` and a second
  `upgrade()` leaves it byte-identical. 28/28 in the file.*

### 13B: `focus.workspace` in the renderer (`throng-renderer-ui`)

- [x] T177 [US2] RED component, after T173: in
  `packages/ui/tests/component/side-pane-focus-commands.test.ts`, add a `describe` for
  `focus.workspace` that presses `Ctrl+Shift+Alt+N` (`code: 'KeyN'`) through the real
  `KeybindingsHandler`. It asserts:
  - from a focused Projects pane and from a focused File Explorer, `getActivePane()` becomes
    `'workspace'`, and the active tab's active panel's input surface holds DOM focus;
  - the active tab, the active panel and the active project are unchanged, and both side panes'
    visibility (`localStorage` keys) is unchanged;
  - with no project, or a tab with no panel, nothing changes and no notice is raised;
  - with the workspace already active and DOM focus moved elsewhere, the chord puts focus back in the
    panel.

  In the same file, re-point `press('P')` (`:424`) to `press('B')` and every `press('F')` (`:325`,
  `:338`, `:353`, `:379`, `:393`) to `press('M')`, and update the header comment (`:1-7`) to name
  five commands. (FR-116, FR-117, FR-024)

  *Landed 2026-09-25 (`56d62cbd`, with T179): RED observed, 4 failing — the chord was not prevented
  and focus stayed put, because `focus.workspace` was not handled. The new describe wires
  `WorkspaceProvider` to the live project and registers one textarea per panel in the real
  panel-focus registry as its input surface. "No active tab" and "a tab with no panel" are covered as
  two cases. 17/17 green after T179.*
- [x] T178 [US2] RED unit(ui), after T173. In `packages/ui/tests/shared/window-chords.ts`:
  - `COVERED_IN_COMPONENT`'s `focus.projects` claim moves from key `'P'` to `'B'`;
  - add `['focus.workspace', { test: 'side-pane-focus-commands.test.ts', key: 'N', mods: ['ctrlKey', 'shiftKey', 'altKey'] }]`;
  - `COVERED_ELSEWHERE`'s `focus.notice` press becomes `'Control+Shift+Alt+V'`. It is red until
    T181 changes the spec's literal, which the manifest guard reads;
  - rewrite the comments at `:155-160`, `:178-187` and `:208-213` to FR-117's letters.

  Extend FR-110's `isPanelScoped` audit test so `focus.workspace` is classified as a window command.
  Red until T179 (the manifest guard reads `handledActions()`). (FR-116, FR-110)

  *Landed 2026-09-25 (`512e6236`, with T181): RED observed as specified — `stale: focus.workspace`
  until T179, and the `Control+Shift+Alt+V` exemption until T181. The audit gained an explicit
  `focus.workspace` case: EVERYWHERE, exempt, and resolved from a focused terminal textarea.*
- [x] T179 [US2] GREEN, turns T177 and T178 green (T178's `focus.notice` literal waits for T181). In
  `packages/ui/src/renderer/app.tsx`, handle `focus.workspace`: take `activeFocus()`. If it returns
  null, do nothing. Otherwise call `goToPanel(f.tabId, f.activeId)` unconditionally. Unlike
  `dispatchMove` / `dispatchCycle`, do not skip when the target is the active panel, because that is
  the whole case. No change to `keybindings/scope.ts` is expected, since the `focus.` prefix already
  exempts it. If the audit disagrees, the fix is there. (FR-116)

  *Landed 2026-09-25 (`56d62cbd`): `focus.workspace` joins `WINDOW_HANDLED_ACTIONS` and a
  `case 'focus.workspace'` calls `goToPanel` unconditionally. `scope.ts` unchanged; the audit
  agrees.*

### 13C: re-pin the tests that name a moved chord

- [x] T180 [US2] (`throng-renderer-ui`) Re-pin in place, after T173 and T179, with no assertion
  weakened. Each re-pin keeps the case's subject and changes only which command owns the chord:
  - `packages/ui/tests/component/physical-key-chords-every-resolver.test.ts:255-270`: the AZERTY
    case pressed B as `view.toggleProjects`. Press J for it, or keep B and assert `focus.projects`;
  - `:278-354`: each case rebinds a command to `Ctrl+Shift+Alt+M` and disables `focus.notice`.
    M is now `focus.explorer`'s, so disable `focus.explorer` instead (`'focus.explorer': []`), or
    the rebind collides;
  - `preferences-keybindings-tab.test.ts:387, :418, :481-500, :629`: the seeded and expected
    defaults for `view.toggleProjects` (J), `view.toggleExplorer` (K) and `focus.projects` (B). At
    `:481`, the "chosen because `view.toggleProjects` actually holds it" premise must still be true.
    Pick the chord its owner holds now;
  - the resolver-shape files listed in the preamble: re-read, and change comments only.

  Run each changed file alone. (FR-117)

  *Landed 2026-09-25 (`75ab24a0`): the AZERTY case presses J for `view.toggleProjects`; the three M
  rebinds disable `focus.explorer`; the keybindings tab moves to J / K / B, and the Reassign case
  presses J, which `view.toggleProjects` really holds. Of the resolver-shape files only
  `chord-candidates.test.ts`'s "bound letters" comment changed. 73/73 across the three files.*
- [x] T181 [US2] (`throng-e2e-harness`) E2E in place. No declaration is added or removed, the tags
  are unchanged, and the budget stays 573:
  - `packages/ui/tests/e2e/window-chord-resolution.e2e.ts:187`: retitle to "the pane toggles still
    resolve — Ctrl+Shift+Alt+J and Ctrl+Shift+Alt+K". Its presses use `chordFor()`;
  - `:406`: retitle "Ctrl+Shift+Alt+F" to "Ctrl+Shift+Alt+M", and `:498-504`'s comment and failure
    message likewise;
  - `notice-focus-chord.e2e.ts:142`: `win.keyboard.press('Control+Shift+Alt+V')`, with the comments
    at `:46` and `:135`. This turns T178's `COVERED_ELSEWHERE` claim green;
  - `pane-shortcuts.e2e.ts:15, :25`: comments only.

  Run each changed declaration alone at `--workers=1`. No full run. (FR-117)

  *Landed 2026-09-25 (`512e6236`): titles, comments, the failure message and the one literal press
  changed in place; no declaration or tag changed. The E2E run results are in the Phase 13 report.*

### 13D: docs, artifacts, PR and hand check (`throng-spec-governance`)

- [x] T182 [P] `README.md:58` and every other keyboard line in it: Focus Projects / Workspace /
  File Explorer on **Ctrl+Shift+Alt+B / N / M**, the pane toggles on **J / K**, and the notice on
  **V**. (FR-119)

  *Landed 2026-09-25 (`4c6e9fbe`): README.md:57-62 puts Focus Projects / Workspace / File Explorer
  on Ctrl+Shift+Alt+B / N / M and the newest notice on V; :64-65 adds the pane toggles on J / K,
  which the README had given no chord before. No F or P chord is left.*
- [x] T183 [P] `docs/quick-start.md`:
  - the pane chord lines (`:35-37`);
  - the keyboard reference table (`:851-852`, `:860`, and a new Focus Workspace row);
  - the AZERTY note (`:904`, which now names `focus.explorer` on M);
  - T148's AltGr disclosure, extended with research R22's iterate-round-3 table (J, K, V add no
    loss, `Ń` moves to `focus.workspace`, US-International `Ö` is recovered).

  (FR-119, FR-104)

  *Landed 2026-09-25 (`4c6e9fbe`): docs/quick-start.md:35-41 moves the pane chord lines to J / K and
  the focus chords to B / N / M; :853-855 and :863 update the keyboard reference, with a new Focus
  Workspace row, and move the notice to V; :907-909 names `focus.explorer` on AZERTY's `,` key;
  :917-921 adds R22's round-3 table (`Ń` now `focus.workspace`'s, US-International `Ö` recovered,
  J / K / V cost nothing).*
- [x] T184 [P] `docs/testing.md`:
  - the quoted titles at `:382` and `:390`;
  - the re-pointed presses at `:418-428` (T181);
  - the budget, unchanged at 573.

  Then re-check `CONTRIBUTING.md` for a chord. T145 found none. If that still holds, change nothing
  and say so. (FR-119)

  *Landed 2026-09-25 (`4c6e9fbe`): docs/testing.md:382 and :390 quote T181's titles, :418-420 and
  :427 re-point the presses to J / K, M and V, :442-453 records round 3 with the budget unchanged at
  573 (@core 39), and :456-457 names the v14 upgrade. CONTRIBUTING.md states no chord, as T145
  found, and is unchanged.*
- [x] T185 [P] `CHANGELOG.md` `## Unreleased`: update the entry at `:37` and every other 046 line
  naming F / P / B / N / M, plus the AltGr `### Known issues` line. 046 is unreleased, so record
  FR-117's chords as the shipped defaults, not as a change (T167's precedent). Add
  `focus.workspace` to the `### Added` side-pane entry. (FR-119)

  *Landed 2026-09-25 (`4c6e9fbe`): CHANGELOG.md:36-41 records Focus Projects / Workspace / File
  Explorer on Ctrl+Shift+Alt+B / N / M and adds `focus.workspace`; :65-67 states the notice and
  pane-toggle defaults as moves from the released Ctrl+Alt chords to V and J / K, naming no
  version-13 chord (T167's precedent); :86 drops US-International `Ö` from the AltGr known issue.
  README.md:57-65 (T182) likewise.*
- [x] T186 [P] Reconcile the design artifacts with FR-116 – FR-118, appending supersede notes and
  deleting nothing (T170's precedent):
  - `data-model.md:126` and `:135`;
  - every chord mention in `contracts/keybindings-and-focus.md` and `plan.md`
    (`grep -n "Ctrl+Shift+Alt+[BNMFP]"`);
  - the defaults table and upgrade section in `data-model.md`, which gain version 14 and
    `V13_KEYBINDINGS`. (FR-116, FR-117, FR-118)

  *Landed 2026-09-25 (`253f2c2c`): data-model.md:138-158 supersedes :126 and :135 with FR-117's
  table (`focus.workspace` included), and :171-186 adds version 14 and `V13_KEYBINDINGS` to the
  upgrade section; contracts/keybindings-and-focus.md:156-205 adds §5; plan.md:17-21 and :580-644
  add the round-3 pointer and section, naming each earlier chord mention they supersede (plan.md
  had no `Ctrl+Shift+Alt+[BNMFP]` hit, only Ctrl+Alt+F / M history). Nothing deleted. Pre-existing,
  left alone: T170's italic note at data-model.md:130-133 sits inside the round-1 table and breaks
  its rendering after the `panel.zoom…` rows.*
- [x] T187 Update PR #440's description, after T182 – T185:
  - the Outcomes' keyboard lines move to FR-117;
  - Focus Workspace is added;
  - the version-14 upgrade is named;
  - S27 is added to the supersession pointer;
  - T149's NumLock result and FR-120 are recorded as an open defect, not as fixed.

  Read the body back for attribution lines before `gh pr edit`. (FR-119, FR-120)
- [ ] T188 Maintainer hand check. Nothing here runs it on the user's behalf. In the dev build, whose
  config already holds a version-13 marker (the case FR-118 exists for), validate
  [quickstart.md](./quickstart.md) §5b. That covers the upgrade on the existing config, Ctrl+Shift+Alt+B / N / M from each
  surface, J / K, V, and F / P doing nothing. Record the result in the PR description. (SC-018)

### 13E: Numpad0 reset defect, under reproduction elsewhere (kept separate from 13A – 13D)

- [x] T189 [US3] RED repro, pending the maintainer's confirmation. Another agent is reproducing
  spec FR-120 in parallel at the lowest layer that shows it: "Ctrl+Shift+Alt+Numpad0 does not reset
  the window zoom — with NumLock ON it resets the active panel's zoom instead; with NumLock OFF
  nothing happens" (maintainer, 2026-09-25, physical keyboard). This task records that test's
  file:line, layer and failure output once it exists. No production code changes until the
  maintainer confirms it reproduces the report (the repo's replicating-bugs gate). A synthetic event
  carries whatever the test sets, so if no layer below a real keyboard can show it, the task says
  so rather than inventing a synthetic case. (FR-120, FR-113, FR-114, SC-017)
  *Confirmed 2026-09-25 by the maintainer ("It should work in both instances"). RED tests:
  `packages/core/tests/unit/chord-capture.test.ts`, `packages/ui/tests/unit/chord-candidates.test.ts`,
  `packages/ui/tests/unit/zoom-reset-numlock-shift.test.ts`,
  `packages/ui/tests/component/preferences-capture-modal.test.ts`,
  `packages/ui/tests/component/window-zoom-reset-shift.test.ts`; each NumLock-ON case resolves or
  records `Ctrl+Alt+Numpad0` instead of the tier-1 chord.*
- [x] T190 [US3] GREEN fix, as FR-120's resolution specifies: a keypad digit key reporting its
  navigation `key` with `shiftKey` false while NumLock is ON reads as Shift held. The rule lives in
  `packages/core/src/config/chord-capture.ts` and is reused by
  `packages/ui/src/renderer/config/chord-key.ts`; no NumLock state available → unchanged
  behaviour. Turns T189 green. (FR-120)

  *Landed 2026-09-26: core `keypadHidesShift`, applied in `captureToken`; the renderer's
  `chordCandidates` / `resolveKeydown` and the capture modal's Shift go through it. Unit 5940,
  component 2717, window-chord-resolution + panel-zoom E2E 14 pass.*

### Phase 13 dependencies

- **13A**: T172 → T173. T174 → T175 → T176. T174 needs T173 for the FR-117 targets.
- **13B**: T177 and T178 need T173. T179 turns both green, except T178's `focus.notice` literal,
  which needs T181.
- **13C**: T180 needs T173 and T179. T181 needs T178.
- **13D**: T182 – T186 can start once FR-117 is final, and each touches one file. T187 needs
  T182 – T185. T188 needs everything in 13A – 13C built.
- **13E** is independent of 13A – 13D. T190 needs T189 (confirmed).
- The gate (T150) is re-dispatched after Phase 13. Every earlier green run describes a different
  tree (CLAUDE.md's tree-vs-SHA rule).

**Shared files never placed twice in one run**: `keybindings.ts` (T173); `keybindings-metadata.ts`
(T173); `shipped-defaults.ts` (T175); `app.tsx` (T179); `window-chords.ts` (T178);
`side-pane-focus-commands.test.ts` (T177); `theme-link-tokens.test.ts` (T174);
`shipped-defaults-upgrade-v13-keybindings.test.ts` (T174); `e2e-budget.json` and
`parallel-plan.json` (none).

---

## Phase 14: Iterate round 4, the active pane gates the outline and the arrows; Ctrl held for Ctrl+E W (2026-09-26)

Spec FR-121 – FR-123, SC-019, S28; plan.md *Iterate round 4*. No chord, default or persisted
state changes. Test-first: each RED task is run and seen failing for the reason named before its
GREEN task starts.

### 14A: the active pane gates the workspace outline and the arrows (`throng-renderer-ui`)

- [x] T191 [US2] RED component: in a new `packages/ui/tests/component/workspace-outline-active-pane.test.ts`,
  render the workspace beside the side panes; with the active pane set to `projects`, then `files`,
  assert no panel frame carries `panel-box--active` or `panel-box--active-dimmed`; set it back to
  `workspace` and assert the same panel carries `panel-box--active` again; with the window in the
  background and the workspace active, assert `panel-box--active-dimmed` as today. (FR-121, S28, SC-012, SC-019)
- [x] T192 [US2] GREEN: `packages/ui/src/renderer/workspace/panel-placeholder.tsx` requires
  `useActivePane() === 'workspace'` for both classes; the active panel id is untouched. Turns T191
  green; `panel-box.test.ts` stays green. (FR-121)
- [x] T193 [US2] RED component: in `packages/ui/tests/component/window-arrow-chords.test.ts`, with
  two panels side by side and the active pane `projects`, then `files`, press
  Ctrl+Shift+Alt+ArrowRight through the real window listener; assert the active panel id and the
  active pane are unchanged and the event is consumed; with the active pane `workspace`, assert the
  move happens as today. (FR-122, SC-019)
- [x] T194 [US2] GREEN: `dispatchMove` in `packages/ui/src/renderer/app.tsx` returns unless
  `getActivePane() === 'workspace'`; `dispatchCycle` unchanged. Turns T193 green. (FR-122)
- [x] T195 [US2] Check `move-focus.e2e.ts`, `focus-context.e2e.ts` and `focus-zoom-layout.e2e.ts`
  (and any component test T192 / T194 turn red) for an assertion that FR-121 / FR-122 contradict;
  re-pin it in place, no declaration added or removed, budget stays 573. Run each touched E2E file
  alone at `--workers=1`. (FR-121, FR-122)

### 14B: Ctrl held through the second stroke (`throng-editor-documents`)

- [x] T196 [US2] RED unit: in `packages/ui/tests/unit/chord-candidates.test.ts` (or a new
  `carried-modifiers.test.ts` beside it), the shared carried-modifier rule in
  `packages/ui/src/renderer/config/chord-key.ts`: modifiers held at the first stroke are carried; a
  modifier keyup drops it; a second stroke with Ctrl carried reads as its bare key; with Ctrl
  released and re-pressed it keeps Ctrl. (FR-123)
- [x] T197 [US2] RED component: in `packages/ui/tests/component/editor-two-stroke-chord.test.ts`,
  Ctrl down, E down, E up, W down (ctrlKey true, no Ctrl keyup) toggles word wrap and shows no "not
  bound" notice; Ctrl released before W still toggles it; a bound `Ctrl+E Ctrl+W` test binding is
  still reached by Ctrl released and re-pressed. (FR-123, FR-091)
- [x] T198 [US2] RED component: in `packages/ui/tests/component/preferences-capture-modal.test.ts`,
  capturing a two-stroke chord with Ctrl held through the W records `Ctrl+E W`. (FR-123)
- [x] T199 [US2] GREEN: the carried-modifier rule in `chord-key.ts`; the two-stroke engine in
  `packages/ui/src/renderer/editor/commands.ts` matches the carried-cleared second stroke only
  (corrected during T199 from "raw, then cleared"; FR-123's MUST), and labels an unbound stroke
  from it; the capture modal
  (`packages/ui/src/renderer/preferences/capture-modal.tsx`) records the carried-cleared second
  stroke. Turns T196 – T198 green; `editor-word-wrap.e2e.ts` run alone at `--workers=1`. (FR-123, SC-019)

### 14C: docs and PR (orchestrator)

- [x] T200 `docs/quick-start.md`: the directional chords act from a workspace panel; Ctrl may stay
  held for Ctrl+E W. `CHANGELOG.md` Unreleased: the same two lines and the outline rule.
  `contracts/keybindings-and-focus.md` §3: a supersede note for FR-121 / FR-122, deleting nothing
  (analyze F2). (FR-121 – FR-123)
- [x] T201 PR #440's description: round 4's three outcomes, S28 in the supersession pointer, and
  the new gate. Read the body back for attribution lines before `gh pr edit`.

### Phase 14 dependencies

- 14A and 14B are independent and share no file. T192 needs T191; T194 needs T193; T195 needs T192
  and T194. T199 needs T196 – T198.
- 14C needs 14A and 14B. The gate (T150) is re-dispatched after Phase 14.

**Shared files never placed twice in one run**: `app.tsx` (T194); `panel-placeholder.tsx` (T192);
`chord-key.ts`, `commands.ts`, `capture-modal.tsx` (T199); `e2e-budget.json` (none).

---

## Phase 15: Iterate round 5, focus into every panel; `Mods+K1,K2` chords; Enter keeps the list (2026-09-26)

Spec FR-124, FR-125, the FR-082 defect, SC-020, S29; constitution v5.6.0 Principle XI "Focus follows
the active Panel"; plan.md *Iterate round 5*. The three maintainer-confirmed RED repros are
committed (`c7e5fd84`). Test-first: every RED task is run and seen failing for the reason named
before its GREEN task starts.

### 15A: the `Mods+K1,K2` token in core (`throng-config-preferences`)

- [x] T202 [US2] RED unit, in `packages/core/tests/unit/keybindings-two-stroke-comma.test.ts` (new):
  `normalizeToken` / `parseTwoStroke` read `Ctrl+E,W` as the strokes `Ctrl+E` then `Ctrl+W`, and
  `Ctrl+E,Shift+W` as `Ctrl+E` then `Ctrl+Shift+W`; `Ctrl+,,W` is Ctrl+comma then W; a legacy
  `Ctrl+E W` normalises to `Ctrl+E,W`; three keys are refused; the display/save form is the comma
  form. (FR-124, SC-020)
- [x] T203 [US2] GREEN: `packages/core/src/config/keybindings.ts` and the two-stroke paths of
  `packages/core/src/config/chord-capture.ts`. Turns T202 green; existing core two-stroke tests are
  re-pinned in place to the comma form, not deleted. (FR-124)
- [x] T204 [US2] RED unit, in `packages/core/tests/unit/shipped-defaults-upgrade-v15-keybindings.test.ts`
  (new): a saved `editor.toggleWordWrap: ['Ctrl+E W']` with marker 13 or 14 moves to `Ctrl+E,W`; a
  customised row is byte-identical; a re-run is idempotent. (FR-124)
- [x] T205 [US2] GREEN: `packages/core/src/config/shipped-defaults.ts` version **15**, frozen
  `V14_KEYBINDINGS` as a guard source (version 14 not edited); `editor.toggleWordWrap` default
  `Ctrl+E,W` in `keybindings.ts`. Turns T204 green. (FR-124)

### 15B: the capture box records the press (`throng-config-preferences`)

- [x] T206 [US2] RED component, in `packages/ui/tests/component/preferences-capture-modal.test.ts`:
  a third key under the held modifiers is refused inline ("Only two keys can follow the
  modifiers."); no `capture-two-stroke` control is rendered. (FR-124)
- [x] T207 [US2] GREEN: `packages/ui/src/renderer/preferences/capture-modal.tsx` records only when
  every key is up, writes `Mods+K1,K2`, refuses a third key, and loses the two-stroke control. Turns
  `c7e5fd84`'s capture block and T206 green; the existing tests built on the armed control or on a
  first-keyup record are re-pinned in place (the press helper sends the modifier keyups). (FR-124)

### 15C: the editor engine and focus (`throng-renderer-ui`)

- [x] T208 [US2] RED component, in `packages/ui/tests/component/editor-two-stroke-chord.test.ts`:
  Ctrl held through E then W toggles word wrap under `Ctrl+E,W`; Ctrl released after E then W does
  NOT toggle it, types `w` and shows no "not bound" notice; round 4's assertions that FR-124
  supersedes are re-pinned in place. (FR-124, SC-020)
- [x] T209 [US2] GREEN: `packages/ui/src/renderer/editor/commands.ts` (raw match of the expanded
  second stroke; a first-stroke modifier keyup ends the prefix silently) and
  `packages/ui/src/renderer/config/chord-key.ts` (round 4's carried clearing no longer used for
  matching). Turns T208 green. (FR-124)
- [x] T210 [US2] RED component, in `packages/ui/tests/component/move-focus-dom-focus.test.ts`: move
  onto a Find in Files panel whose replace field last had focus lands in the replace field; an
  untyped panel with nothing focused before lands on its type picker. (FR-125)
- [x] T211 [US2] GREEN: focus targets for the untyped panel and Find in Files, with last-focused
  memory, through `packages/ui/src/renderer/workspace/panel-focus.ts`. Turns `c7e5fd84`'s
  move-focus repro and T210 green. (FR-125, Principle XI)
- [x] T212 [US2] RED component, in `packages/ui/tests/component/project-switch-restored-editor-focus.test.ts`:
  the same Enter-back case with a TERMINAL as the target project's active panel keeps focus on the
  row (step up to E2E only if the component layer cannot mount a terminal). (FR-082)
- [x] T213 [US2] GREEN: `packages/ui/src/renderer/editor/use-editor.ts` and
  `packages/ui/src/renderer/terminal/use-terminal.ts` self-focus also require the workspace to hold
  the active pane. Turns `c7e5fd84`'s list-Enter repro and T212 green. (FR-082)
- [x] T214 [US2] E2E re-pin: every declaration pressing or asserting `Ctrl+E W` (grep
  `packages/ui/tests/e2e` and `tests/shared`), in place, no declaration added or removed (budget 573);
  then `editor-word-wrap`, `status-bar-visibility`, `editor-caret-persist`, `move-focus` each alone
  at `--workers=1`. (FR-124, FR-125, FR-082)

### 15D: docs and PR (orchestrator)

- [x] T215 `docs/quick-start.md` (Ctrl+E,W; recording a two-key chord by holding the modifiers;
  moving into any panel takes the caret), `CHANGELOG.md` Unreleased, `README.md` if it names the
  chord; `contracts/keybindings-and-focus.md` and `data-model.md` supersede notes for the token
  format and version 15, deleting nothing. (FR-124, FR-125)
- [x] T216 PR #440's description: round 5's outcomes, S29, the constitution revision, the new gate.
  Read the body back for attribution lines before `gh pr edit`.

- [x] T217 [US2] [derived] Gate fix: a new tab's name box keeps focus while open, then focus moves
  into its active panel (FR-125 with the existing rename-on-create). T211 let the tab-switch focus
  request land on the untyped panel's type picker, which closed the box (gate 36247830190,
  `notice-a11y.e2e.ts:142`, 4/4). RED/GREEN `packages/ui/tests/component/new-tab-rename-focus.test.ts`;
  `workspace/panel-focus.ts` hold/release, `workspace/tab-group.tsx`. (FR-125)

### Phase 15 dependencies

- 15A: T202 → T203; T204 → T205 (needs T203's format). 15B needs T203. 15C: T208 → T209 (needs
  T203); T210 → T211; T212 → T213; T214 after T205, T207, T209, T211, T213.
- 15D after 15A – 15C. The gate (T150) is re-dispatched after Phase 15.

**Shared files never placed twice in one run**: `keybindings.ts` (T203, T205 — one agent, in
order); `shipped-defaults.ts` (T205); `capture-modal.tsx` (T207); `commands.ts`, `chord-key.ts`
(T209); `panel-focus.ts` (T211); `use-editor.ts`, `use-terminal.ts` (T213); `e2e-budget.json` (none).

---

## Phase 16: Iterate round 6, three keys and a refusal that does not stick (2026-09-26)

Spec FR-126, SC-021, S30; plan.md *Iterate round 6*. Test-first. The heavy gate (T150) waits for
the maintainer's manual sign-off.

- [x] T218 [US2] RED unit, in `packages/core/tests/unit/keybindings-two-stroke-comma.test.ts`:
  `Ctrl+E,W,Q` parses into `Ctrl+E`, `Ctrl+W`, `Ctrl+Q` and formats back; four keys are refused; a
  two-key chord that prefixes a three-key one in an intersecting scope is a collision. (FR-126)
- [x] T219 [US2] GREEN: `packages/core/src/config/keybindings.ts`, `chord-capture.ts` and the
  collision helper in `shipped-defaults.ts`. Turns T218 green. (FR-126) — `config`
- [x] T220 [US2] RED component, in `packages/ui/tests/component/preferences-capture-modal.test.ts`:
  Ctrl held, E, W, Q, release → `Ctrl+E,W,Q`; a fourth key shows "Only three keys can follow the
  modifiers.", and releasing every key then records `Ctrl+E,W,Q` and closes the box. (FR-126,
  SC-021)
- [x] T221 [US2] GREEN: `packages/ui/src/renderer/preferences/capture-modal.tsx`. Turns T220 green;
  round 5's two-key refusal test is re-pinned in place. (FR-126) — `config`
- [x] T222 [US2] RED component, in `packages/ui/tests/component/editor-two-stroke-chord.test.ts`: a
  bound `Ctrl+E,W,Q` runs when Ctrl is held through E, W and Q; releasing Ctrl after W ends it
  silently. (FR-126, SC-021)
- [x] T223 [US2] GREEN: `packages/ui/src/renderer/editor/commands.ts` (engine and
  `toCodeMirrorKey`). Turns T222 green. (FR-126) — `renderer`
- [x] T224 `docs/quick-start.md` and `CHANGELOG.md`: up to three keys after the modifiers. (FR-126)
  — `main`

T219 before T221 and T223. **Shared files**: `keybindings.ts` (T219); `capture-modal.tsx` (T221);
`commands.ts` (T223).

---

## Phase 17: Iterate round 7, Ctrl+Alt+0 resets the panel zoom too (2026-09-26)

Spec FR-127, S31; constitution v5.6.0 IV named exception (eighth revision). Test-first. The heavy
gate waits for the maintainer's manual sign-off.

- [x] T225 [US3] RED unit, in `packages/core/tests/unit/shipped-defaults-upgrade-v16-keybindings.test.ts`
  (new) and the tier / one-chord guards in `keybindings-tiers.test.ts`: `panel.zoomReset` ships
  `['Ctrl+Alt+Numpad0', 'Ctrl+Alt+0', 'Ctrl+MiddleClick']`; a saved version-15 default gains
  `Ctrl+Alt+0`, a customised row is byte-identical, a kept collision refuses the row, a re-run plans
  nothing; the one-chord guard allows exactly this named exception. (FR-127)
- [x] T226 [US3] GREEN: `packages/core/src/config/keybindings.ts` default and
  `packages/core/src/config/shipped-defaults.ts` version **16** with a frozen `V15_KEYBINDINGS`
  guard source (version 15 not edited). Turns T225 green; tests pinning version 15 re-pinned in place.
  (FR-127) — `config`
- [x] T227 [US3] RED → GREEN component: through the real window listener, Ctrl+Alt+0 (US, key `0`)
  resets the active panel's zoom, never the window's; German AltGr+0 (key `}`, Ctrl+Alt) does not.
  (FR-127) — `config`
- [x] T228 `docs/quick-start.md`, `CHANGELOG.md`, the manual test plan's MT-05 and MT-08, and the
  Key Bindings / cog docs that list the panel reset. (FR-127) — `main`
