---
description: "Task list for feature 014 — Theme Editor: Restore & Create Controls"
---

# Tasks: Theme Editor — Restore & Create Controls

**Input**: Design documents from `specs/014-theme-editor/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/themes-editor-controls.md

**Tests**: REQUIRED. Constitution Principle V (Test-First, NON-NEGOTIABLE) mandates Red-Green-Refactor
with unit/integration/contract layers, and **E2E for every user-facing UI change**. Test tasks are
written first and MUST fail before their implementation.

**Organization**: grouped by user story (US1 P1, US2 P2, US3 P2) for independent implementation/testing.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency)
- All paths are repo-relative (within the `014-theme-editor` worktree).

---

## Phase 1: Setup

- [x] T001 Ensure workspace links resolve in the worktree: run `npm install` at the worktree root
  (junction links for `@throng/*`, no lockfile change), then `npm run build` to confirm a clean baseline.
  (Lint/type-check gates are added on rebase to `master` — see plan Complexity Tracking.)

---

## Phase 2: Foundational (Blocking Prerequisites)

**⚠️ CRITICAL**: no user-story work begins until this phase is complete. These are the shared pure model,
the reusable themeable icon button, the shared confirm dialog, the row-list restructure, and the service DI wiring.

- [x] T002 [P] Unit tests (write first, must FAIL): `packages/core/tests/unit/theme-editor-model.test.ts`
  covering `classifyThemes(present, reserved)` (built-in vs custom tagging, deleted-restorable rows for
  absent reserved names, ordering/stability), `validateThemeName(name, ctx)` (empty → reserved →
  duplicate → ok precedence; `renamingFrom` excluded from duplicate), and `cloneName(source)`.
- [x] T003 Implement `packages/core/src/config/theme-editor-model.ts` — `classifyThemes`,
  `validateThemeName`, `cloneName`, and the `ThemeRow`/`ThemeRowKind`/`ThemeNameValidation` types — to
  green against T002. Reuse `reservedThemeNames`/`isReservedThemeName` from `config/shipped-defaults.ts`.
- [x] T004 Export the new pure surface from `packages/core/src/index.ts`.
- [x] T005 [P] New reusable themeable button `packages/ui/src/renderer/common/icon-button.tsx` —
  `IconButton({ token, title, onClick, testId, disabled, className })`, resolving the glyph via the active
  theme's icon tokens and colours via theme colour tokens (no hardcoded CSS colour, no inline SVG).
- [x] T006 Refactor `packages/ui/src/renderer/common/dismiss-button.tsx` to be a thin wrapper over
  `IconButton` (token `dismiss`); behaviour and existing test-ids unchanged (DRY).
- [x] T007 [P] New shared modal `packages/ui/src/renderer/preferences/confirm-dialog.tsx` —
  `ConfirmDialog` (`role="dialog"`, `aria-modal`, `data-testid="theme-confirm-dialog"`), text-labelled
  decision buttons whose colours derive from theme tokens (v3.12.0 dialog exception). Model on
  `capture-modal.tsx`.
- [x] T008 Restructure the Themes tab picker in `packages/ui/src/renderer/preferences/themes-tab.tsx`:
  replace the `<select data-testid="theme-select">` dropdown **and** the in-place rename field with a
  **row list** built from `classifyThemes(listThemes(), reservedThemeNames())` — one
  `theme-list-row-<name>` per present theme (click = activate via `theme-activate-<name>`, preserving
  select-to-activate), and one non-activatable `theme-list-row-<name>-deleted` per deleted built-in
  (visually distinguished via theme tokens). NB: `theme-row-<name>` is NOT used — feature 007 already
  owns that testid for the token-editing rows. Rows are the
  host for per-story action icons added later. Update `preferences.css` (row list + deleted-row styles).
  **Migrate the existing E2E**: `packages/ui/tests/e2e/preferences-themes.e2e.ts` currently drives the
  old `theme-select` dropdown and in-place rename field (select-activate, rename-collision, delete,
  restore assertions). Update those existing assertions to the new row-list interactions
  (`theme-row-<name>` click-to-activate) and the dialog-based rename (US3) so the suite stays green after
  the dropdown/in-place-field removal; do not leave assertions targeting removed selectors.
- [x] T009 Wire the 010 service to the IPC layer: add `shippedDefaults: ShippedDefaultsService` to
  `ConfigManagementDeps` in `packages/ui/src/main/config-write-ipc.ts` and pass it from the UI-main
  composition root (`packages/ui/src/main/composition-root.ts`) — constructor injection, no ambient state.

**Checkpoint**: pure model + IconButton + ConfirmDialog + row list + service DI ready.

---

## Phase 3: User Story 1 — Restore all built-in themes (Priority: P1) 🎯 MVP

**Goal**: A single "Restore All" returns every built-in to shipped values, recreates deleted built-ins,
leaves customs untouched, atomically — replacing the weak create-if-missing path.

**Independent Test**: edit two built-ins, delete a third, create one custom, invoke Restore All + confirm;
assert all built-ins match shipped, the deleted one is recreated, the custom is byte-unchanged, and a
locked-file attempt changes nothing.

### Tests (write first, must FAIL)

- [x] T010 [P] [US1] Restore-all integration coverage — **already provided by feature 010's
  `packages/ui/tests/integration/shipped-defaults-restore.test.ts`**, which exercises
  `restoreAllThemes()` against a real `FileConfigStore` + temp `configRoot` for exactly the four cases
  this task names (edited built-in reset, deleted built-in recreated, custom byte-identical, and
  whole-operation rollback on a locked/unwritable file). A duplicate test file was deliberately NOT
  added (DRY). The thin IPC adapter over it is pinned by the channel-parity contract test (T011) and
  exercised end-to-end by the US1 E2E (T012).
- [x] T011 [P] [US1] Contract test `packages/ui/tests/contract/themes-ipc.contract.test.ts` (restore-all
  portion): preload `config.restoreAllThemes()` maps to `throng:config:restoreAllThemes` and returns
  `RestoreResult`.
- [x] T012 [P] [US1] E2E in `packages/ui/tests/e2e/preferences-themes.e2e.ts`: Restore All
  (`theme-restore-all`) → confirm (`theme-confirm-dialog`) → assert on-disk `themes/*.json` equal shipped,
  deleted built-in file recreated, custom file unchanged, active theme hot-applied, success feedback shown.

### Implementation

- [x] T013 [US1] Register the `throng:config:restoreAllThemes` handler in `config-write-ipc.ts` →
  `deps.shippedDefaults.restoreAllThemes()`.
- [x] T014 [US1] Add `restoreAllThemes(): Promise<RestoreResult>` to `window.throng.config` in
  `packages/ui/src/preload/preload.cts`.
- [x] T015 [US1] In `themes-tab.tsx`, add the **Restore All** control as an `IconButton` (token `retry`,
  hover title) that opens `ConfirmDialog`; on confirm call `config.restoreAllThemes()`, hot-apply the
  result, and show success/failure feedback. Remove the old `doRestore()` path that called the weak
  `config.restoreDefaultThemes()`.

**Checkpoint**: MVP — Restore All works end-to-end and is independently testable.

---

## Phase 4: User Story 2 — Restore / recreate a single built-in (Priority: P2)

**Goal**: Restore one built-in to shipped values (confirmed), and recreate a deleted built-in from its
deleted-restorable row (no confirm), affecting no other theme.

**Independent Test**: edit two built-ins, restore exactly one (confirm) → only it changes; delete a
built-in → it stays as a deleted-restorable row → recreate (no confirm) → it reappears at shipped values.

### Tests (write first, must FAIL)

- [x] T016 [P] [US2] Integration test `packages/ui/tests/integration/restore-theme.test.ts`:
  `ShippedDefaultsService.restoreTheme(name)` — overwrite an edited built-in, recreate a deleted built-in,
  `not-reserved` guard writes nothing, locked-file single-file atomic fail, and idempotent double-recreate.
- [x] T017 [P] [US2] Contract test (restore-theme portion, in `themes-ipc.contract.test.ts`): preload
  `config.restoreTheme(name)` maps to `throng:config:restoreTheme`; service method signature/return per
  contract.
- [x] T018 [P] [US2] E2E in `preferences-themes.e2e.ts`: per-theme restore (`theme-restore-<name>`) +
  confirm changes only that theme; delete → `theme-row-<name>-deleted` present → recreate
  (`theme-recreate-<name>`, no confirm) → theme file reappears at shipped values, others untouched.

### Implementation

- [x] T019 [US2] Add `restoreTheme(name): Promise<RestoreResult>` to
  `packages/ui/src/main/shipped-defaults-service.ts` — write `themes/<name>.json` = `shipped.themes[name]`
  via `FileConfigStore.writeFilesAtomic`; `not-reserved` guard for non-built-in names; no version-marker
  change. (Reuses 010's record + atomic primitive; does not re-implement them — FR-011.)
- [x] T020 [US2] Register `throng:config:restoreTheme` handler in `config-write-ipc.ts` →
  `deps.shippedDefaults.restoreTheme(name)`.
- [x] T021 [US2] Add `restoreTheme(name)` to `window.throng.config` in `preload.cts`.
- [x] T022 [US2] In `themes-tab.tsx`: on **built-in** rows add a per-theme restore `IconButton` (token
  `retry`, hover title) → `ConfirmDialog` → `config.restoreTheme(name)`; on **deleted-restorable** rows add
  a recreate `IconButton` (token `retry`, hover title) → `config.restoreTheme(name)` **without** confirm.
  Hot-apply + feedback for both.

**Checkpoint**: US1 + US2 both independently functional.

---

## Phase 5: User Story 3 — Create a custom theme via Clone (Priority: P2)

**Goal**: Clone is the sole creation path — duplicate the selected theme into a new custom theme via a
modal name dialog prefilled `"<source> - Clone"` ("Clone" pre-selected); the same dialog replaces 007's
in-place rename. Reserved built-in names (incl. deleted built-ins), empty, and duplicate names are refused.

**Independent Test**: Clone a theme → dialog prefilled with "Clone" pre-selected → confirm a new name →
custom copy appears and is editable; attempt reserved/deleted-reserved/empty/duplicate names → refused;
rename a custom via the dialog.

### Tests (write first, must FAIL)

- [x] T023 [P] [US3] E2E in `preferences-themes.e2e.ts`: Clone (`theme-clone-<name>`) opens
  `theme-name-dialog` with `theme-name-input` = `"<source> - Clone"` and "Clone" selected; confirm → new
  custom theme (copy of source) appears and activates; reserved / deleted-built-in / empty / duplicate
  names are refused inline and create nothing; rename (`theme-rename-<name>`) via the dialog renames a
  custom. (Name-validation logic itself is unit-covered by T002/T003.)

### Implementation

- [x] T024 [US3] New modal `packages/ui/src/renderer/preferences/name-dialog.tsx` — `NameDialog`
  (`role="dialog"`, `data-testid="theme-name-dialog"`, input `theme-name-input`): accepts an initial value
  and an optional pre-selection range (Clone pre-selects the trailing "Clone" word via `setSelectionRange`),
  runs `validateThemeName` live for inline `reserved`/`duplicate`/`empty` feedback, text-labelled
  Confirm/Cancel (colours from theme tokens). Reserved set comes from `reservedThemeNames()` imported
  directly from `@throng/core` (pure, no IPC); `existingCustom` from the current custom rows.
- [x] T025 [US3] In `themes-tab.tsx`: add a **Clone** `IconButton` (token `add`, hover title) on every
  present row → `NameDialog(cloneName(source), preselect "Clone")`; on confirm, create the new theme by
  writing `themes/<newName>.json` with the source theme's content (via the existing `config.write`/
  `writeConfig` path) and activate it.
- [x] T026 [US3] In `themes-tab.tsx`: add a **Rename** `IconButton` (token `rename`, hover title) on
  **custom** rows → `NameDialog(currentName)` → `config.renameTheme(from, to)` gated by `validateThemeName`
  (with `renamingFrom` set). Confirm the old in-place rename field is fully removed (T008).

**Checkpoint**: all three user stories independently functional.

---

## Phase 6: Polish & Cross-Cutting

- [x] T027 [P] Completeness check: run `packages/core/tests/unit/theme-metadata.test.ts` — confirm every
  shipped theme token (incl. 009's `editorGutterBg`/`editorGutterFg` and the `dismiss` icon) stays exposed
  and no token is unregistered. No new icon token is introduced (research D5); if one is later added, add
  its `THEME_TOKEN_COPY` entry so the test stays green.
- [x] T028 [P] Themeable-icon audit (v3.12.0): verify Restore All, per-theme restore, recreate, Clone,
  Rename, and Delete are `IconButton`s taking glyph+colours from theme tokens; only the ConfirmDialog
  decision buttons and the NameDialog field/confirm are text. Remediate the pre-existing text-labelled
  `.prefs-toolbtn` controls in `themes-tab.tsx` flagged at the v3.12.0 amendment.
- [x] T029 Documentation currency (constitution v3.10.0): update `README.md` (Themes editor now supports
  Restore All / per-theme restore / recreate deleted built-ins / Clone-based creation) and mark the
  corresponding `ROADMAP.md` item delivered; keep `CONTRIBUTING.md` consistent. (README describes the
  current finite state, not a per-feature changelog.)
- [x] T030 Run `quickstart.md` scenarios 1–6 and the full suite (`npm test`): unit → integration →
  contract → E2E all green; confirm no orphaned test artifacts remain (Principle V cleanup rule).

---

## Dependencies & Execution Order

- **Setup (T001)** → **Foundational (T002–T009)** blocks all stories.
  - T002 → T003 → T004 (model). T005 → T006 (buttons). T007 (confirm dialog). T008 needs T003 (classify)
    + T005 (IconButton usable by rows). T009 (service DI) independent of the renderer tasks.
- **US1 (T010–T015)**: needs Foundational. Tests T010–T012 before impl T013–T015. T015 needs T007
  (ConfirmDialog) + T008 (rows) + T005 (IconButton) + T013/T014 (IPC/preload).
- **US2 (T016–T022)**: needs Foundational; reuses ConfirmDialog (T007) and the row list (T008). T019
  before T020/T021; T022 needs T007+T008+T019–T021.
- **US3 (T023–T026)**: needs Foundational (model T003, rows T008). T024 before T025/T026.
- **Polish (T027–T030)**: after all desired stories.

### Parallel opportunities

- T002, T005, T007 can start together (different files). T010/T011/T012, T016/T017/T018 are `[P]` test
  sets. T027/T028 are `[P]`.

## Implementation Strategy

1. Setup + Foundational → foundation ready.
2. **US1 (MVP)** → validate Restore All independently → demo.
3. **US2** → validate per-theme restore + recreate → demo.
4. **US3** → validate Clone creation + rename dialog → demo.
5. Polish (completeness, icon audit, docs, quickstart) → full green suite.

## Notes

- Tests are required (Principle V); verify each test fails before implementing.
- The reserved built-in name set is a **pure** core function (`reservedThemeNames()`), imported directly
  in the renderer — no IPC needed for name validation or row classification.
- `restoreTheme` and Restore All both delegate to feature 010's shipped record + atomic write; this feature
  adds controls, not restore logic (FR-011).
- Commit after each task or logical group; stop at any checkpoint to validate a story independently.

---

## Phase 7: Convergence

- [x] T031 Correct the stale comment above `classifyThemes` in
  `packages/ui/src/renderer/preferences/themes-tab.tsx` (~L96): it still describes "one
  deleted-restorable entry per reserved name absent from disk", but a deleted built-in is no longer
  listed at all — the picker shows only present themes, and Restore All is the only way back
  per FR-005a (contradicts)
