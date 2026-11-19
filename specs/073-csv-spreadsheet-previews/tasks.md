# Tasks: CSV Grid and Spreadsheet Previews

**Input**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/](./contracts/)

**Tests**: test-first throughout (Principle V). Each implementation task is preceded by, or includes,
its failing test at the layer R10 names.

## Format: `[ID] [P?] [Story] Description`

## Phase 1: Setup

- [x] T001 Add `@tanstack/react-virtual` 3.14.26 and `xlsx` from `https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz` (exact, integrity-locked) to `packages/ui/package.json` and `package-lock.json`
- [x] T002 [P] Extract the lockfile walk in `scripts/generate-licenses.mjs` into an exported `collectNpmEntries(lock, readPackage)` and assert in `packages/ui/tests/unit/generate-licenses.test.ts` that a URL-resolved entry (`resolved: https://cdn.sheetjs.com/…`) is listed with its licence and homepage

## Phase 2: Foundational (blocking)

- [x] T003 [P] Core CSV model — `parseCsv`, `detectDelimiter`, `cellValue`, `recordFieldCount` in `packages/core/src/csv/csv-model.ts`; tests `packages/core/tests/unit/csv-parse.test.ts` (data-model §1), including a 10 MB / 100,000-row parse timed against SC-001's budget
- [x] T004 [P] Minimal-change writer — `encodeCsvField`, `csvSetCells`, `csvInsertRows`, `csvInsertColumn`, `csvDeleteRows`, `applyCsvChanges` in `packages/core/src/csv/csv-edit.ts`; tests `packages/core/tests/unit/csv-edit.test.ts` (FR-047, SC-005)
- [x] T005 [P] Clipboard formats and column letters — `columnLabel`, `gridToTsv`, `parseTsv`, `gridToHtmlTable` in `packages/core/src/csv/grid-clipboard.ts`; tests `packages/core/tests/unit/grid-clipboard.test.ts`
- [x] T006 Grid operations — `CsvGridOperation`, `validateGridOperation` (integers ≥ 0, `count` 1–10,000, at most 1,000,000 cells, string values) and `resolveGridOperation(text, op)` → changes or `{ refuse: 'malformed' | 'invalid' }` in `packages/core/src/csv/grid-operation.ts`; export the csv modules from `packages/core/src/index.ts`; tests `packages/core/tests/unit/csv-grid-operation.test.ts`
- [x] T007 Descriptor fields `editable` and `sizeLimitSetting` with registry validation (`editable` text-only; `sizeLimitSetting` names a `number` setting) in `packages/core/src/preview/provider.ts` and `registry.ts`; `PreviewUpdate.ownsDocument` and `too-large` `{ size, limit }` in `packages/core/src/preview/wire-types.ts`; tests in `packages/core/tests/unit/preview-registry.test.ts`
- [x] T008 The shared grid component — virtualised rows and columns, sticky letter strip and gutter, range selection, keyboard navigation, tooltip, resize by drag and Column Width…, theme tokens, zoom — in `packages/ui/src/renderer/grid/data-grid.tsx`, `grid-selection.ts`, `grid.css`; component tests `packages/ui/tests/component/data-grid.test.ts` (FR-001 – FR-008, FR-024, FR-025)
- [x] T009 Injectable worker factory `packages/ui/src/renderer/grid/worker-factory.ts` (production: module `Worker`; tests: in-thread)

## Phase 3: User Story 1 — Open a CSV as a table (P1)

**Goal**: a `.csv` opens in the CSV Preview Editor grid. **Independent test**: open `quoted.csv`; every value in its cell; nothing written.

- [x] T010 [US1] CSV provider descriptor `packages/core/src/preview/providers/csv.ts` (`id: 'csv'`, `.csv`, text, `editable: true`, `flowingDocument: false`, `defaultOpenAction: 'preview'`) and its entry in `packages/core/src/preview/providers/index.ts`; generated-settings tests in `packages/core/tests/unit/preview-settings-073.test.ts`
- [x] T011 [US1] Renderer view + body: `packages/ui/src/renderer/preview/providers/csv/view.ts`, `csv-body.tsx` (parse sync below 512 KiB, else `csv-parse-worker.ts`; malformed → one inline notice with Open in Editor, FR-046; grid read from the model) and the entry in `packages/ui/src/renderer/preview/providers/index.ts`; component test `packages/ui/tests/component/csv-body.test.ts`
- [x] T012 [US1] Chrome: an `editable` provider's body owns paste, cut and drop (the host stops refusing them) in `packages/ui/src/renderer/preview/preview-panel.tsx`; component test extends the read-only case in `packages/ui/tests/component/` (044 FR-020 superseded for CSV only)
- [x] T013 [P] [US1] Fixtures `packages/ui/tests/fixtures/073/quoted.csv`, `quoted.after-b2.csv`, `ragged.csv`, `malformed.csv` — dropped: every test builds its inputs inline, so no fixture files are needed
- [x] T014 [US1] Startup-bundle guard: the grid, CSV body, worker and `xlsx` are lazy (vite `failOnEagerPreview` patterns + `packages/ui/tests/unit/` bundle test) (FR-009, SC-003)

## Phase 4: User Story 2 — Edit a CSV in the grid (P1)

**Goal**: edits, inserts, clipboard, undo/redo, save, Auto Save, close prompt, column widths.
**Independent test**: edit B2, undo, redo, save; only that field's bytes differ.

- [x] T015 [US2] Coordinator grid-document ids (`csv-grid:` prefix): `isOpen`/`openInto` ignore them, `load({ recordHistory: false })` in `packages/ui/src/main/editor-coordinator.ts`; integration test `packages/ui/tests/integration/csv-grid-service.integration.test.ts` (editor opened later joins as a link; closing hands over)
- [x] T016 [US2] `CsvGridService` in `packages/ui/src/main/csv-grid-service.ts`: `edit` (lazy grid document, `applyExternalEdit`, flush), `undo`, `redo`, `save`, `release`; integration tests in the same file (dirty without a write; one undo step per operation; save writes minimal bytes; malformed refused and logged, FR-072)
- [x] T017 [US2] `PreviewService`: `flush(panelId)`, `parentOf` → `null` for a grid document with `ownsDocument: true`, release the grid document when the run is destroyed in `packages/ui/src/main/preview-service.ts`
- [x] T018 [US2] IPC `throng:preview:gridEdit/gridUndo/gridRedo/gridSave` in `packages/ui/src/main/preview-ipc.ts`, wiring in `packages/ui/src/main/main.ts`, preload in `packages/ui/src/preload/preload.cts`, renderer types; contract test `packages/ui/tests/contract/preview-ipc.contract.test.ts` additions
- [x] T019 [US2] Editing in the CSV body: in-cell editor commit → `setCells`; Delete/Cut/Paste; insert row/column menus; Undo/Redo chords; Auto Save timer; `EditorActions` + `editor-state` published only while `ownsDocument` in `csv-body.tsx`; component tests in `packages/ui/tests/component/csv-body.test.ts`
- [x] T020 [US2] Exclude preview panels from `editorPanelsInTab` open-in-place targets in `packages/ui/src/renderer/editor/editor-open.tsx`; destroy path: the panel-close prompt reaches the grid's actions (already keyed on actions) — component test
- [x] T021 [US2] Bindable commands `grid.insertRowAbove/Below`, `grid.insertColumnLeft/Right` (unbound, preview scope) in `packages/core/src/config/keybindings.ts` + `keybindings-metadata.ts`, dispatched to the focused CSV body; tests `packages/core/tests/unit/keybindings-grid.test.ts`
- [x] T022 [US2] Column widths per file: migration `packages/persistence/src/migrations/v13-grid-column-widths.ts`, `schema-guard.ts`, `document-state-repository.ts` (independent leaves; row deleted only when both null), `packages/ipc-contract/src/document.ts`, `packages/daemon/src/document-service.ts`, renderer `document-client.ts`; tests in `packages/persistence/tests/` and the body
- [x] T023 [US2] E2E `packages/ui/tests/e2e/csv-preview-editor.e2e.ts` (`@extended @editor`): open from Files & Folders, edit a cell, Ctrl+S, bytes on disk; re-seed `e2e-budget.json`; `parallel-plan.json` if it drives a context menu

## Phase 5: User Story 3 — Read a spreadsheet workbook (P2)

**Goal**: a read-only preview of seven workbook formats. **Independent test**: three-sheet fixture; hidden marked; stored formula value.

- [x] T024 [P] [US3] `readWorkbook` in `packages/ui/src/renderer/preview/providers/spreadsheet/workbook-read.ts`; tests `packages/ui/tests/unit/spreadsheet-read.test.ts` (xlsx, ods, xls, xlsb, fods; password/malformed refusals; ISO dates; the read options keep macros unextracted and formulas unevaluated, SC-007; every refusal logged, FR-072)
- [x] T025 [US3] Spreadsheet descriptor `packages/core/src/preview/providers/spreadsheet.ts` (binary; seven extensions with MIME types; `firstRowHeader` toggle off; `maxPreviewMb` 5–500 step 5 ships 25; `sizeLimitSetting`) + index entry; unit test that an enabled Spreadsheet provider routes a workbook double-click to its preview, not the OS (FR-065, `packages/ui/tests/unit/editor-open-router.test.ts`)
- [x] T026 [US3] `throng:preview:readSource` through the source handler; protocol cap = provider size-limit setting; binary `readPath` raises `too-large` with `{ size, limit }` in `packages/ui/src/main/preview-protocol.ts`, `preview-service.ts`, `preview-ipc.ts`, preload; integration test `packages/ui/tests/integration/preview-read-source.integration.test.ts`
- [x] T027 [US3] Spreadsheet view + body (`spreadsheet-worker.ts`, sheet switcher, per-sheet scroll kept, header row, notices, reload on update keeping the sheet by name) in `packages/ui/src/renderer/preview/providers/spreadsheet/`; component test `packages/ui/tests/component/spreadsheet-body.test.ts`
- [x] T028 [US3] `too-large` notice wording names size and limit (digit-grouped) in `packages/ui/src/renderer/preview/preview-notice.tsx`; component test

## Phase 6: User Story 4 — Configure the providers (P2)

- [x] T029 [US4] Cherry-pick 074's `feat(074): Open-in preference for every preview type` from `feature/S074-I441-media-file-previews`; declare CSV's option labels (Throng Editor / Throng Preview Editor / Default OS Program, ships `preview`) and Spreadsheet's (Throng Preview / Default OS Program, ships `preview`) with the plurals "CSVs" / "spreadsheets"; tests in `packages/core/tests/unit/preview-settings-073.test.ts`
- [x] T030 [US4] Disabling CSV closes its previews asking first for a dirty grid document (FR-063) in `packages/ui/src/renderer/preview/preview-provider-sync.tsx`; component test
- [x] T031 [US4] Inert-settings and completeness coverage for `firstRowHeader`, `maxPreviewMb` (readers exist), `npm run generate:defaults` output

## Phase 7: Polish

- [x] T032 Docs: `docs/preferences.md`, `docs/key-bindings.md`, `docs/quick-start.md`, `README.md`, `CHANGELOG.md`, `docs/releasing.md` (SheetJS manual update) — `throng-docs` audit
- [x] T033 Branch review against spec, plan, contracts and constitution; lint + typecheck
- [x] T034 Manual test plan `.claude/.manual-test-plans/feature+S073-I605-csv-spreadsheet-previews.md`

## Phase 8: Iteration 2026-11-19 (manual-test feedback, clarifications Q6–Q9)

- [x] T035 [US1] Defect (FR-060, 047 FR-010–FR-016): failing integration test in `packages/ui/tests/integration/preview-csv-reuse.integration.test.ts` — Last Preview Panel shows `a.csv`, navigates to `b.csv`, reopening `a.csv` must answer `navigated` on the same panel, not `placeLocally`; a second case with an unsaved grid edit on `a.csv` before switching must not lose the edit (FR-033). Then the fix in `packages/ui/src/main/preview-service.ts` / `packages/ui/src/main/csv-grid-service.ts` where the reproduction shows the stale document
- [x] T036 [US2] FR-043: failing component tests in `packages/ui/tests/component/data-grid.test.ts` — double-click a cell opens the editor with all text selected; Home/End/arrows/Ctrl+Home/Ctrl+End inside the editor leave the active cell unchanged; read-only grid ignores the double-click. Then `packages/ui/src/renderer/grid/data-grid.tsx`
- [x] T037 [US1] FR-011: pure `packages/ui/src/renderer/grid/fit.ts` (widest text over all rows + header, padding, clamp) with unit tests in `packages/ui/tests/unit/grid-fit.test.ts`; component tests in `data-grid.test.ts` for header and resize-edge double-click, the toggle back to the pre-fit width, and the width reported through `onColumnWidthChange`. Then `data-grid.tsx`
- [x] T038 [US1] FR-012 (refines FR-004): component tests in `data-grid.test.ts` — row-header double-click expands to the tallest cell's wrapped line count (cap 20), collapses on the second; hit-testing, keyboard reveal and the cell editor position stay correct below an expanded row; update any existing test asserting fixed `row * rowH` geometry. Then `data-grid.tsx`, `packages/ui/src/renderer/grid/grid.css`
- [x] T039 [US1] SC-009: component test counting grid renders per scroll step (horizontal and vertical) in `data-grid.test.ts`; then `useFlushSync: false`, column overscan, a memoised row, scroll reporting kept out of React state in `data-grid.tsx`, `packages/ui/src/renderer/preview/providers/csv/csv-body.tsx`, `packages/ui/src/renderer/preview/providers/spreadsheet/spreadsheet-body.tsx`
- [x] T040 Docs: double-click gestures in `docs/key-bindings.md` (grid section) and `docs/quick-start.md` where the grid is described — `throng-docs` audit
- [x] T042 [US2] FR-037e: failing component tests in `packages/ui/tests/component/csv-body.test.ts` (and `spreadsheet-body.test.ts` for Copy) — the cell, selection, row-header and column-header menus each offer Cut, Copy and Paste acting on the selection; cutting whole columns clears values. Then `packages/ui/src/renderer/preview/providers/csv/csv-body.tsx`, `packages/ui/src/renderer/preview/providers/spreadsheet/spreadsheet-body.tsx`
- [x] T043 [US2] FR-037f (refines FR-037c): failing tests — a paste by chord and by menu onto a range dragged bottom-right to top-left or top-left to bottom-right lands at the range's top-left; whole rows paste from column A; one value onto a multi-cell selection fills it; one undo step. Update any existing test asserting paste "from the active cell". Then `csv-body.tsx` and the paste event in `packages/ui/src/renderer/grid/data-grid.tsx`
- [x] T044 [US2] FR-006a: failing tests — column header menu Reset Size removes the stored width (default width shown, persisted removal through `column-widths.ts`); row header menu Reset Size collapses an expanded row; both grids. Then `csv-body.tsx`, `spreadsheet-body.tsx`, `packages/ui/src/renderer/preview/providers/csv/column-widths.ts`, `data-grid.tsx` (a handle method to collapse a row)
- [x] T045 Docs for T042–T044 in `docs/key-bindings.md` CSV grid section — `throng-docs` audit
- [x] T046 [US2] FR-008a: pointer selections never scroll; a column selection's active cell is its top row — tests in `packages/ui/tests/component/data-grid.test.ts`, `packages/ui/tests/unit/grid-selection.test.ts`; code in `packages/ui/src/renderer/grid/data-grid.tsx`, `packages/ui/src/renderer/grid/grid-selection.ts`
- [x] T047 [US2] FR-035a: Save and Save As icons in the CSV Preview Editor's title bar (generalised `packages/ui/src/renderer/workspace/panel-header-save-icons.tsx`, wired in `panel-placeholder.tsx`), Save As on the grid menu and the `editor.saveAs` chord; main `CsvGridService.save(panelId, absPath?)` and `throng:preview:gridSave` with a path; the preview follows the new path. Integration test over the coordinator (new file written, original unchanged, run re-pointed, clean); component tests for the icons and menu item
- [x] T048 [US2] FR-038a: Insert Copied Rows Above/Below and Insert Copied Columns Left/Right on the header menus while the clipboard holds whole rows/columns last copied or cut from a CSV grid; one grid operation (one undo step) that inserts rows/columns with values — core `packages/core/src/csv/grid-operation.ts` / `csv-edit.ts` with unit tests, `csv-grid-service` integration, `csv-body.tsx` menus with component tests
- [x] T049 [US2] FR-036a, FR-060a: the cell dialog — settings (`packages/core/src/config/preview-settings.ts` descriptors, defaults, inert-settings guard, `npm run generate:defaults`), pure flatten/pretty-print helpers in core with unit tests (JSON detection, JSON flatten, text flatten, unchanged → no write), the modal with an editor in the renderer (component tests: threshold routing for double-click/F2/Enter, typing still in-cell, menu item on every cell, Esc/cancel, one undo step), `docs/preferences.md`
- [x] T050 [US2] FR-036b: the setting off removes the dialog entirely (menu item too); a per-panel toggle at the bottom right of the CSV Preview Editor status bar, persisted with the panel config, unset panels following the setting — component tests for the toggle (state, keyboard, persistence through panel config) and the availability rule
- [x] T051 [US2] FR-006b: rename the header items to Reset Column Width / Reset Row Height in `csv-body.tsx` and `spreadsheet-body.tsx`; update every test and doc that names Reset Size
- [x] T052 [US2] FR-037g: an icon on every grid menu item with a sensible picture, both grids — existing icon keys where one fits, new drawn keys (icon-keys.ts, default-set SVG, SOURCES.json, README, regenerated module) otherwise; component tests that each item carries its key
- [x] T053 [US2] FR-043b: a shared Go to dialog component (`packages/ui/src/renderer/navigate/`) with a core whole-number rule; the editor's Go to Line rebuilt on it ("Line N of M", keystroke refusal, remembered seed clamped) — failing tests first, existing Go to Line tests updated where FR-043b supersedes 033 FR-022/FR-023
- [x] T054 [US2] FR-043a: Ctrl+G (`preview.goToHeading`) and Go to Row… on the cell and row menus open the shared dialog for rows in both grids; Enter moves the active cell in the active column, scrolls the row to the top, focus back in the grid
- [x] T055 [US2] FR-008b: the corner cell selects every cell on click without scrolling; named "Select all", pointer cursor; right-click selects all and opens the selection menu; both grids — component tests in data-grid.test.ts
- [x] T041 Review of the iteration diff; lint + typecheck; manual test plan Paths widened to the files that implement FR-011/FR-012/FR-043/SC-009

## Dependencies

Setup → Foundational → US1 → US2; US3 needs Foundational (T008) only; US4 needs US1 and US3 descriptors
and 074's commit. US2's E2E (T023) last.

## Parallel examples

T003, T004, T005 together; T024 alongside T010–T014; T013 any time.

## Implementation strategy

MVP is US1 + US2 (the CSV Preview Editor). US3 ships the workbook preview on the same grid. US4 closes the
preferences.
