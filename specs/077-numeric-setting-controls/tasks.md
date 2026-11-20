# Tasks: Consistent numeric setting controls

**Input**: Design documents from `specs/077-numeric-setting-controls/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/
**Tests**: Required (constitution V, test-first). Each test task precedes the code it covers and must fail first.

## Phase 1: Setup

- [X] T001 Load the `throng-config-preferences` skill and record the numeric-settings baseline: run
  `td run --runner unit --scope file --target packages/core/tests/unit/slider-descriptors.test.ts` and
  `packages/core/tests/unit/settings-metadata.test.ts`, noting results in the PR description draft

## Phase 2: Foundational (blocks every story)

- [X] T002 [P] Write failing unit tests for `toDisplay`, `formatSetting`, `isStop`, `nearestStop`, `checkTyped` and
  `clampToHard` per contracts/numeric-control.md (messages "Up to <hardMax> <unit>", "At least <hardMin> <unit>",
  "Not a whole number"; MB = 1,048,576 bytes; off-stop MB to one decimal) in
  packages/core/tests/unit/numeric-units.test.ts
- [X] T003 Implement packages/core/src/config/numeric-units.ts (display-unit table `MB`, `ms`, `s`, `min`, `days`, own
  units; integer maths in stored units per research R1) and export it from packages/core/src/index.ts
- [X] T004 Extend the numeric descriptor in packages/core/src/config/metadata.ts with `storedUnit`, `display`,
  `unitLabel` and `hardMin`/`hardMax` ("`hardMin ≤ min`, `max ≤ hardMax`"; "`(max − min) % step = 0`")
- [X] T005 Extend packages/core/tests/unit/slider-descriptors.test.ts: for every numeric setting — default is a stop,
  maximum reachable, `storedUnit`/`display` declared, hard bounds containing the slider,
  display unit matches the FR-005 rule, no unit in the label (FR-011, FR-013, SC-001)

## Phase 3: User Story 1 — sizes in MB or exact bytes (P1) 🎯 MVP

**Goal**: Every size setting shows an MB slider and an exact-byte box. **Independent test**: US1 in spec.md.

- [X] T006 [P] [US1] Write failing component tests in packages/ui/tests/component/number-control.test.ts: slider in
  stored units with `aria-valuetext` in MB; value with unit; box digit-grouped; typed `12,345,678` stores `12345678`
  and sets `data-overridden="true"`; dragging clears it; Reset clears it
- [X] T007 [US1] Rebuild `NumberControl` in packages/ui/src/renderer/preferences/form-controls.tsx per
  contracts/numeric-control.md (test ids `setting-<key>-slider|value|box|message`; greyed but enabled; remove the
  min/max refusal in `parse`)
- [X] T008 [US1] Draw the overridden slider dimmed and greyscale in packages/ui/src/renderer/preferences/preferences.css (no colour,
  so no theme token or shipped-defaults bump; was: add a theme token to packages/core/src/config/theme-metadata.ts and every default
  theme; bump `SHIPPED_DEFAULTS_VERSION` and append the leaf to packages/core/tests/fixtures/theme-leaves-by-version.json)
- [X] T009 [US1] Re-declare every size descriptor in packages/core/src/config/settings-metadata.ts and
  packages/core/src/config/preview-settings.ts per research R6 (editor/preview caps 5–250 MB in 5 MB steps, hard 1 KB–2 GB;
  spreadsheet 5–500 MB; diagnostics per R6); rename `spreadsheet.maxPreviewMb` → `maxPreviewBytes`; each size row's description states "MB = 1,048,576 bytes" (FR-003)
- [X] T010 [US1] One size-cap mechanism (FR-018): drop `sizeLimitSetting` and the MB branch of `maxFileBytesFor` /
  `hasOwnSizeCap` in packages/core/src/config/preview-settings.ts and packages/core/src/preview/provider.ts; update
  packages/core/tests/unit/preview-settings*.test.ts
- [X] T011 [US1] Too-large notice (FR-015): main sends `limitKey`; packages/ui/src/renderer/preview/preview-notice.tsx
  renders `formatSetting` for size and limit; update packages/ui/tests/unit/preview-too-large-notice.test.ts first

## Phase 4: User Story 2 — durations in their unit or exact ms (P1)

**Independent test**: US2 in spec.md.

- [X] T012 [P] [US2] Add component cases to packages/ui/tests/component/number-control.test.ts for ms, s, min and
  days displays and an off-stop `45,500` ms
- [X] T013 [US2] Re-declare every duration descriptor in packages/core/src/config/settings-metadata.ts per research R6
  (hover dwells 0–1,500/25; debounces 0–2,000/25; heading jump 0–1,500/50; find debounce default 120 → 125); rename
  `syncHighlightSeconds` → `syncHighlightMs` and its readers in packages/ui/src/renderer/preview/preview-panel.tsx and
  packages/ui/src/renderer/preview/sync-mark-store.ts

## Phase 5: User Story 3 — validated as typed, clamped on confirm (P1)

**Independent test**: US3 in spec.md.

- [X] T014 [P] [US3] Add component cases: out-of-bounds text shows `role="alert"` message while typing; Enter stores the
  nearer hard bound; non-number and Escape restore the stored value
- [X] T015 [US3] Wire `checkTyped` into `NumberControl` (packages/ui/src/renderer/preferences/form-controls.tsx)
- [X] T016 [US3] Read-side clamp (research R5): the typed settings reader in packages/core/src/config/app-settings.ts
  clamps to hard bounds and logs once with `logExpected`; unit test in packages/core/tests/unit/app-settings-bounds.test.ts

## Phase 6: User Story 6 — older units keep their meaning (P1)

**Independent test**: US6 in spec.md.

- [X] T017 [P] [US6] Write a failing integration test for contracts/settings-upgrade-v37.md (each migrated row; both
  keys present; non-numeric old value; idempotent re-run) in packages/core/tests/unit/settings-upgrade-v37.test.ts
- [X] T018 [US6] Implement the v37 rename-and-convert step in packages/core/src/config/shipped-defaults.ts
  (`planSettingsUpgrade`/`applySettingsUpgrade`; factors ×1,000, ×60,000, ×86,400,000, ×1,024, ×1,048,576)
- [X] T019 [US6] Rename the readers: packages/daemon/src/terminal-attention.ts (`quietMs`),
  packages/ui/src/main/attention-service.ts, packages/core/src/resources/settings-resolution.ts (input only; the
  collector protocol keeps seconds and minutes, research R11), packages/ui/src/renderer/preferences/settings-tab.tsx,
  packages/ui/src/renderer/resources/toolbar.tsx, packages/ui/src/main/main.ts and the three log readers
  (`THRONG_LOG_MAX_BYTES`, `THRONG_LOG_MAX_TOTAL_BYTES`); regenerate shipped defaults with `npm run generate:defaults`

## Phase 7: User Story 4 — sensible steps and bounds everywhere (P2)

- [X] T020 [US4] Re-declare the remaining counts, lengths, px and percentages in
  packages/core/src/config/settings-metadata.ts so T005 passes (CSV long-cell threshold 0–1,000/10; indent columns
  step 1); strip units from every label
- [X] T021 [US4] Print dialog bounds (FR-020): declare steps and hard bounds for margins, scale and copies and use
  `checkPrintField` (decimals for margins, so not `checkTyped`) in packages/ui/src/renderer/print-preview/number-field.tsx; component test in
  packages/ui/tests/component/print-preview-app.test.ts (bounds in packages/core/tests/unit/print-field-bounds-077.test.ts)

## Phase 8: User Story 5 — the app uses what Preferences says (P2)

- [X] T022 [P] [US5] Write failing unit tests proving no second clamp: explorer popover delay (app-settings.ts),
  notifications `boundedInt` (packages/core/src/notice/display-mode.ts), diagnostics rotation floor
  (packages/core/src/diagnostics/rotation.ts), capture-interval resolver (packages/core/src/resources/settings-resolution.ts)
- [X] T023 [US5] Remove those clamps (FR-016), leaving R5's read-side clamp as the only bound
- [X] T024 [US5] Interval menu from descriptor stops with the current value checked (FR-017) in
  packages/ui/src/renderer/resources/toolbar.tsx; component test first
- [X] T025 [US5] Fix the remaining 7.3.0 violations (FR-014): the capture-interval description (no copied band table),
  the "5 MB steps" text, and the ungrouped refusal in packages/core/src/editor/drop.ts; a test per surface (SC-005)

## Phase 9: Polish

- [X] T026 Update docs/preferences.md: every numeric setting's stored unit, display unit, range, step and hard bounds;
  MB = 1,048,576 bytes (FR-003, FR-019); run packages/ui/tests/unit/docs-currency.test.ts
- [X] T027 Search every test layer for old keys, labels and notice wording (`quietSeconds`, `maxPreviewMb`, "(ms)",
  "bytes, over the limit") and update each hit, including E2E specs
- [X] T028 Write the manual test plan groups for 077 from quickstart.md into the unified plan's block assigned by the
  orchestrator

## Dependencies

- Phase 2 blocks everything. US1 (T006–T011) is the MVP and supplies the control the other stories extend.
- US2 and US3 extend `NumberControl` after T007; US6 is independent of the UI and can run beside US1.
- US4 needs T005; US5 needs T016 (the one clamp that stays).
- T008 and T018 both bump `SHIPPED_DEFAULTS_VERSION`: do them as one bump (37).

## Parallel opportunities

- T002 with T004; T006 with T009; T012 with T013; T017 with any UI phase; T022 with T020.

## Implementation strategy

MVP = Phases 1–3 (sizes). Then US3 (validation), US6 (migration), US2 (durations), then US4, US5 and polish. Each phase
ends with its covering tests green (`td run --scope file`).
