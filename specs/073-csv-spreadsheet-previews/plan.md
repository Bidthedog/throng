# Implementation Plan: CSV Grid and Spreadsheet Previews

**Branch**: `feature/S073-I605-csv-spreadsheet-previews` | **Date**: 2026-11-18 | **Spec**: [spec.md](./spec.md)

**Input**: `specs/073-csv-spreadsheet-previews/spec.md` — 4 user stories, one clarification session (5
answers). Refs #605, #323, #604.

## Summary

- **One grid** (`renderer/grid/`), virtualised with `@tanstack/react-virtual`, drawn by both new
  providers: editable for CSV, read-only for workbooks (R5).
- **CSV Preview Editor** (#605 + #323): an `editable` text provider whose body turns each grid action
  into a **grid operation**; main's new `CsvGridService` resolves it against the document's current text
  into minimal text changes (core `csv/`) and applies them through the editor coordinator's authority —
  opening a **grid document** on the first edit when no editor holds the file (R1, R3). Undo, Redo,
  Save and Auto Save are the document's (R2).
- **Spreadsheet preview** (#604): a binary provider for seven workbook formats, parsed by SheetJS CE
  0.20.3 (CDN tarball) in a worker from bytes read through the confined source route (R6, R7).
- **Per-file column widths** in `document_state` (migration v13, R8).
- **Open-in preference** consumed from 074 (R9).

## Technical Context

**Language/Version**: TypeScript (repo toolchain, ES2022), Node 24, Electron 44.

**Primary Dependencies**: React 19, CodeMirror 6 (`@codemirror/state` `ChangeSet` in main only),
InversifyJS, Vitest, Playwright. **New runtime dependencies** in `packages/ui`, both lazy:
`@tanstack/react-virtual` 3.14.26 (MIT) and `xlsx` 0.20.3 (Apache-2.0, from
`https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`, integrity-locked).

**Storage**: `document_state.grid_column_widths` (migration v13). Settings: two providers' generated
leaves plus Spreadsheet's `firstRowHeader` and `maxPreviewMb`. No layout schema change.

**Testing**: unit, component (jsdom; injected worker factory), integration (real coordinator + temp tree,
real protocol handler, real SQLite), one E2E spec (`@extended @editor`).

**Target Platform**: Windows, Linux and macOS desktop (Electron); nothing per-OS.

**Project Type**: Desktop application, npm-workspaces monorepo.

**Performance Goals**: SC-001 (first screen ≤ 1.5 s for 10 MB CSV), SC-002 (≤ 1.5 s / 8 s workbooks),
SC-004 (no input waits > 100 ms while scrolling 100k × 50).

**Constraints**: untrusted content — cells are text nodes; no macro, no network; parsing above 512 KiB
off the main thread; nothing of the grid, parser or SheetJS in the startup bundle (SC-003).

**Scale/Scope**: `core` (csv, preview descriptors and settings), `ui` (main services, IPC, renderer
grid and bodies, preload), `persistence` + `daemon` + `ipc-contract` (one column). No platform package.

## Constitution Check

*GATE: evaluated before Phase 0 and re-evaluated after Phase 1.* Constitution v7.0.0. No amendment.

| Principle | Assessment |
|---|---|
| **I. Project-First Context Isolation** | **Engaged, satisfied.** Every grid channel resolves the project and file from main's run; the grid document is opened with the run's project as owner, through `EditorService`'s confinement; `readSource` is the 044 route's own containment. |
| **II. Platform-Abstracted Core** | **Engaged, satisfied.** Parser, writer, operations, clipboard formats are pure core. File I/O stays in main behind `IFileSystem`; the renderer never reads a file. |
| **III. Terminals** | Not engaged. |
| **IV. Native Terminal Support** | **Engaged lightly.** Four new actions ship unbound and are scoped to previews, so no terminal key is taken. The grid's undo/redo chords are the editor's own, inside the grid only. |
| **V. Test-First (NON-NEGOTIABLE)** | **Engaged, satisfied.** Every task test-first at the lowest layer (R10). Tests that change by supersession: `preview-read-only*` (044 FR-020) gains a CSV exception case; `preview-settings*` for the generated rows and the new descriptor fields; `renderer-bundle`/startup guards for the new lazy chunks. One E2E spec, budget re-seeded. |
| **VI. Simple, Modern, Discoverable UX** | **Engaged; see the rules table.** |
| **VII. Change Review & Approval** | **Engaged.** A preview now edits a document: through the one authority, undoable, never written until Save (Q3). |
| **VIII. SOLID, DRY & YAGNI** | **Engaged.** DRY: one grid for both providers; one save, undo and dirty path (the editor's); one source route. YAGNI: no sort/filter/format, no grid find, no Save As in the grid (reached from the editor). |
| **IX. DI & Composition Root** | **Engaged.** `CsvGridService` is constructed in `main.ts` with the coordinator, `EditorService`-backed reads and `PreviewService`'s run lookup injected; the renderer's worker factory is injected for tests. |
| **X. Externalised Configuration** | **Engaged.** New settings have descriptors and docs. Recorded constants (Complexity Tracking): the 512 KiB worker threshold, row height and default column width (layout, follow zoom), the operation size caps (abuse limits). |
| **XI. Dockable Workspace** | **Engaged — high-risk row.** The grid holds no buffer; every edit goes through the authority; a grid document is one document that an editor joins as a link and inherits on close. Selection and scroll are per panel; column widths are per file (document state). |
| **XII. Responsive UI (NON-NEGOTIABLE)** | **Engaged.** Virtualised drawing; worker parsing above the threshold and always for workbooks; each edit one async IPC. |
| **XIII. Every Failure Leaves a Trace** | **Engaged.** Refused operations, malformed CSV, workbook read failures, worker crashes and `readSource` refusals each `logExpected`/`logCaught` with the cause. |

### Principle VI — its named rules

| Rule | Assessment |
|---|---|
| **Every panel action has a menu item** | Every grid action is on the cell, row or column menu (contracts/grid-ui.md); chords are accelerators. Insert commands are bindable. |
| **Disabled when unavailable, absent when meaningless** | Paste disabled with an empty clipboard is not knowable synchronously, so Paste is always enabled and an empty paste does nothing; editing rows are absent from the spreadsheet preview; Redo disabled is not tracked in the renderer, so Undo/Redo are always enabled and act on nothing when the stack is empty (the editor's own behaviour). |
| **Themeable icon controls** | The sheet switcher's tabs are named tabs, not icon controls (they are selectors, like editor tabs). No new action icon. |
| **One condition, one notice** | Malformed CSV is one inline notice owned by the body; workbook refusals one inline notice; read refusals stay the run's notice. |
| **A preference picks the default; the menu offers every variant** | Copy / Copy as Rich Text / Copy as Plain Text. |
| **Displayed quantities digit-grouped** | Row numbers in the gutter and the too-large notice's sizes go through `formatGrouped`. |

### Development Workflow & Quality Gates

| Gate | Assessment |
|---|---|
| **Incremental delivery** | Engaged: the Open-in rows depend on 074's commit (contract-open-in.md); if it is not available they stay open in tasks.md. |
| **Particular-scrutiny review** | Engaged: a migration; a preview editing a document; a URL-sourced dependency. |
| **Documentation currency** | Engaged: `docs/preferences.md` (two subsections), `docs/key-bindings.md` (four actions), `docs/quick-start.md` (CSV and workbooks), `README.md` (one Highlights line), `CHANGELOG.md` (unreleased), `docs/releasing.md` (SheetJS manual update). |
| **Configuration-editor completeness** | Engaged: every new leaf and action has a descriptor; the inert-settings guard covers `firstRowHeader` and `maxPreviewMb`. |

**Result: PASS.**

### Re-evaluation after Phase 1

Re-checked against the data model and contracts; verdict unchanged. One refinement recorded: the
coordinator learns a grid-document id prefix (contracts/preview-ipc-073.md, *Coordinator*). That is a
naming rule inside main, not a new authority — the document is an ordinary coordinator document.

## Project Structure

### Documentation (this feature)

```text
specs/073-csv-spreadsheet-previews/
├── spec.md
├── plan.md
├── research.md          # R1–R10
├── data-model.md        # §1–§7
├── quickstart.md
├── contracts/
│   ├── preview-ipc-073.md
│   └── grid-ui.md
├── checklists/requirements.md
└── tasks.md
```

### Source Code

```text
packages/core/src/csv/                    csv-model.ts, csv-edit.ts, grid-clipboard.ts, grid-operation.ts
packages/core/src/preview/                provider.ts (+editable, +sizeLimitSetting), wire-types.ts (+ownsDocument, too-large size)
packages/core/src/preview/providers/      csv.ts, spreadsheet.ts, index.ts (+2 entries)
packages/core/src/config/                 preview-settings.ts (size-limit read), keybindings*.ts (+4 actions)
packages/ui/src/main/                     csv-grid-service.ts (new), editor-coordinator.ts (grid-document ids),
                                          preview-service.ts (flush, parentOf), preview-protocol.ts (cap),
                                          preview-ipc.ts (+5 channels), main.ts (wiring)
packages/ui/src/preload/preload.cts       preview.gridEdit/gridUndo/gridRedo/gridSave/readSource
packages/ui/src/renderer/grid/            data-grid.tsx, grid-selection.ts, grid.css, worker-factory.ts
packages/ui/src/renderer/preview/providers/csv/          view.ts, csv-body.tsx, csv-parse-worker.ts
packages/ui/src/renderer/preview/providers/spreadsheet/  view.ts, spreadsheet-body.tsx, workbook-read.ts, spreadsheet-worker.ts
packages/ui/src/renderer/preview/providers/index.ts      (+2 entries)
packages/persistence/src/                 migrations/v13-grid-column-widths.ts, document-state-repository.ts, schema-guard.ts
packages/ipc-contract/src/document.ts     DocumentStateDto.gridColumnWidths
packages/daemon/src/document-service.ts   pass-through of the new leaf
```

**Structure Decision**: the existing monorepo layout; new code sits beside the Markdown and Mermaid
providers and the task-toggle service it mirrors.

## Complexity Tracking

| Item | Why | Simpler alternative rejected because |
|---|---|---|
| Grid-document id prefix in the coordinator | A grid edit with no editor open needs a document (Q3), and the preview panel's own id is taken by its history and fold keys | Keying the document by the preview panel id collides in `resolveFoldKey` and the navigation history (R1) |
| `CSV_WORKER_THRESHOLD = 512 KiB`, row height 22 px, default column 120 px, operation caps | Layout and abuse limits, not preferences (Principle X recorded deviation) | Settings for them would be inert to any user decision |
| URL-sourced dependency (`xlsx`) | Q4: the registry copy is abandoned with two CVEs | Registry `xlsx` 0.18.5 fails FR-057; ExcelJS/odf-kit cover two formats of seven |
| Grid undo/redo chords fixed (`Mod-z`, `Mod-y`, `Mod-Shift-z`) | The text editor's undo/redo are CodeMirror's fixed keymap; Q3 asks the grid to behave the same | A bindable grid undo would make the two presentations differ |
| Manual SheetJS updates | Not on the registry, so no automated sweep sees it | Recorded in `docs/releasing.md` and research R6 |

## Iteration 2026-11-19

Clarification session 2026-11-19 (Q6–Q9) and one defect from manual testing (MT-06). Additive: nothing
above changes.

| Item | Where | Approach |
|---|---|---|
| FR-011 column auto-fit | `packages/ui/src/renderer/grid/data-grid.tsx`, a pure `grid/fit.ts` | Double-click on a column header or its resize edge measures the column's widest display text (every row, header label included) with one offscreen canvas context in the grid's computed font, adds cell padding, clamps 40–2000, and reports it through the existing `onColumnWidthChange` (FR-040 storage unchanged). The grid remembers, per column for the panel's life, the width a fit replaced; a double-click on a column whose width still equals its last fit restores that width (R11) |
| FR-012 row expand | `data-grid.tsx`, `grid.css` | An `expandedRows` set in grid state (panel life, never persisted). The row virtualiser's `estimateSize` returns the expanded height for those rows; an expanded row's cells render with `white-space: pre-wrap` and a max height of 20 lines, scrolling inside beyond. Every place that assumes `row * rowH` (hit-testing, `ensureVisible`, the cell editor's top) reads the virtualiser's measurements instead (R12) |
| FR-043 double-click edit | `data-grid.tsx` `CellEditor` | `onDoubleClick` on a cell opens the editor with `select()` instead of caret-at-end. The editor already stops key propagation, so arrows/Home/End are the textarea's own; Ctrl+Home/End are confirmed to stay in the textarea and never reach the grid |
| SC-009 smooth scrolling | `data-grid.tsx`, `csv-body.tsx`, `spreadsheet-body.tsx` | Hypothesis to confirm by profiling a component render count per scroll: both virtualisers flush synchronously on every scroll event (`useFlushSync` default) and every row re-renders every cell. Approach: `useFlushSync: false`, column overscan raised, a memoised row component keyed on the visible column window so a vertical-only scroll does not rebuild unchanged rows, and `onScrollChange` reporting kept off React state (R13) |
| Defect: Last Preview Panel reuse for CSV | `packages/ui/src/main/preview-service.ts`, `csv-grid-service.ts` | Reproduce first in an integration test over `PreviewService`. Hypothesis: a document for the first CSV outlives the run's navigation, so reopening it takes `open`'s "file has a document" branch and places a new panel. Fix belongs to whatever the reproduction shows owns the stale state; a dirty grid document is never dropped silently (FR-033) (R14) |

Constitution Check for the iteration: no new dependency, setting, IPC channel or persisted state. FR-012's
expansion is view state for the panel's life (Principle X: no setting is created, so nothing is inert).
Principle XII: the fit measures on the renderer thread; at the editor's 10 MB limit that is one
`measureText` per row of one column, inside SC-004's 100 ms (verified by a component test with a
100,000-row model). Passes.
