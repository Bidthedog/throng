# Research: CSV Grid and Spreadsheet Previews

**Spec**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md)

## R1 — Where the CSV Preview Editor's document lives

**Decision**: The grid never holds a buffer. Every grid edit is sent to main as a **grid operation**
(set cells, insert rows, insert a column, delete rows) and applied by a new main service,
`CsvGridService`, through `EditorCoordinator.applyExternalEdit`: main parses the document's **current**
text, computes the minimal text changes (R3) and applies them as one external edit — one canonical
change, one undo step, relayed to every view. When no editor holds the file, `CsvGridService` first
opens the document under a **grid-document id** (`csv-grid:<previewPanelId>`) through the coordinator's
own `load`, so the file has exactly one document either way. The document is opened lazily, on the
first edit: a CSV Preview Editor that is only read never opens one, so viewing keeps 044 FR-025's
"never counts as open" until the user edits.

**Rationale**:
- Computing on the authority's current text is the task-toggle pattern (054 R4,
  `task-toggle-service.ts`): no renderer replica, no version to rebase, nothing the renderer can get
  out of step with (Principle XI, *one authority, not two peers*).
- A grid-document id rather than the preview panel's own id keeps every per-panel key in main apart:
  the preview's navigation history, its fold key and its run are all keyed by the panel id, and an
  editor document under that same id would answer first in `resolveFoldKey` and record an editor
  history for a preview panel (Explore report, §6).
- Dirty state, Save, Save All, Auto Save's save, recovery temps and the external-change watch are the
  coordinator's own for any document, whatever its id (§5, §6).

**Consequences handled in the plan**:
- `openInto`, `isOpen` and `documentFor` treat a grid-document holder as "no editor": opening the file in
  an editor opens a new editor panel, whose `load` joins the grid document as a linked panel
  (`joinHolder`, 052 R1). Closing the preview then hands the document to that editor (`handOver`).
- `PreviewService` parents the CSV run to its grid document (the content and dirty state follow it),
  but reports `parent: null` to the renderer, because there is no editor to go to; the run carries a
  new `ownsDocument: true` instead.
- The renderer publishes the CSV Preview Editor into `editor-state` (dirty dot, project prompts) and
  `editor-actions` (Ctrl+S, the panel-close prompt) **only while it owns the document**, so a document an
  editor also shows is counted once (044 FR-044).

**Alternatives considered**:
- *The preview panel as a full document view with its own replica* (the use-editor protocol without an
  EditorView). Rejected: it duplicates use-editor's load/link/recover/replica protocol (≈1,000 lines),
  collides with the preview's per-panel keys in main, and needs rebasing logic the authority already
  does when it computes the edit itself.
- *A grid view mode of the editor panel*. Rejected by the maintainer (Q1).
- *Write-through to disk*, as task toggles do with no open document. Rejected by Q3: nothing is written
  until Save.

## R2 — Undo, Redo, Save and Auto Save from the grid

**Decision**: Three IPC channels (`throng:preview:gridUndo`, `gridRedo`, `gridSave`) resolve the run's
document id in main and call `coordinator.undo/redo(documentId, GRID_VIEW_ID)` and
`coordinator.save({ panelId: documentId })`. The grid's chords are the text editor's own fixed undo/redo
chords (CodeMirror's `Mod-z`, `Mod-y`, `Mod-Shift-z`), so the two presentations behave the same; Save
arrives through the existing `editor.save` action routing, because the grid registers `EditorActions`
for its panel. Auto Save is scheduled in the renderer after each applied grid edit, reading
`editor.autoSave` and `editor.autoSaveDebounceMs` exactly as `use-editor.ts` does.

**Rationale**: the undo stack belongs to the document (016 FR-026c), so one Undo in either the grid or
an editor undoes the document's latest step. Save goes through the editor's one save path (FR-045).

**Alternatives**: a separate grid undo stack — forbidden by Principle XI.

## R3 — CSV parsing and the minimal-change writer

**Decision**: A pure core module, `packages/core/src/csv/`: `csv-model.ts` (an RFC 4180 tokeniser that
records each record's and field's span in typed arrays, the detected delimiter, the first line ending,
the widest record and the first unterminated quote) and `csv-edit.ts` (grid operations → sorted,
non-overlapping `{from, to, insert}` changes). An edited field is written bare or quoted only where the
format requires; inserted records use the document's delimiter and its first line ending.

**Rationale**: FR-047 needs each field's exact span. The authority's buffer is `\n`-normalised and the
line format is the editor's (059), so the writer only ever inserts `\n` into the buffer and the save
path writes the document's own ending — line-ending fidelity stays where 059 put it.

**Alternatives**: PapaParse (MIT, #605's candidate) — streams well but reports no field offsets, so a
writer built on it would have to re-serialise whole records, which Q3 forbids. Recorded as an issue
constraint ("use existing libraries for parsing") overridden by Q3's fidelity requirement.

## R4 — Parsing off the main thread

**Decision**: The CSV body parses synchronously below 512 KiB of text and in a module Web Worker
(`csv-parse-worker.ts`, the core parser) above it, keeping the last model on screen until the new one
arrives (FR-023, Principle XII). Workbooks always parse in a worker (FR-055). Both workers are created
through one injectable factory so component tests run without `Worker`.

**Rationale**: a 10 MB document (the editor's limit) parses in well under a frame budget per 512 KiB on
the runner class; below that a worker round trip costs more than the parse.

## R5 — The grid component

**Decision**: A throng component, `renderer/grid/data-grid.tsx`, virtualised in both directions with
**`@tanstack/react-virtual` 3.14.26 (MIT)** — rows at a fixed height, columns at their own widths — with
a sticky column-letter strip and row gutter, range selection, keyboard navigation, an in-cell editor
(`<textarea>`, so a newline survives), column resize by drag and by **Column Width…**, and theme tokens
only. Cell text is a React text node, never `innerHTML` (FR-005).

**Rationale**: the headless virtualiser is maintained, MIT (AGPL-compatible), renders nothing itself —
so nothing in a cell can be interpreted as markup — and leaves styling to throng's tokens (FR-007).
#605 asked for an existing library; the virtualisation is the part a library does better.

**Alternatives**: `react-data-grid` (MIT) — only beta releases of the React 19 line, no range selection,
its own CSS; Glide Data Grid (MIT) — canvas-drawn, so theme tokens, zoom and the tooltip would all be
re-implemented and cell text is not in the DOM for tests or assistive technology; AG Grid Community
(MIT) — far beyond the scope, with sort/filter the maintainer ruled out (FR-039).

## R6 — The workbook library

**Decision**: **SheetJS Community Edition 0.20.3** (Apache-2.0), dependency
`"xlsx": "https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz"` in `packages/ui`, locked with its
`sha512` integrity in `package-lock.json`. Read with `{ type: 'array', dense: true, cellDates: true,
cellFormula: false, cellHTML: false, cellStyles: false, bookVBA: false }` in a worker. Display text is
the cell's `w` (the file's formatted text), else an ISO 8601 date for a date, else the raw value.
Formats: `.xlsx .xlsm .xlsb .xls .ods .fods .numbers`.

**Rationale**: the maintainer's Q4 answer. 0.20.3 fixes CVE-2023-30533 (prototype pollution, fixed in
0.19.3) and CVE-2024-22363 (ReDoS, fixed in 0.20.2); the npm-registry `xlsx` stops at 0.18.5 with both.
SheetJS never runs macros (`bookVBA: false` does not even extract them) and has no network code; the
worker has no DOM and the renderer's CSP blocks any fetch it could attempt.

**Manual update requirement**: SheetJS is not on the npm registry, so `npm outdated`, `npm audit` and
the `dependency-updates` sweep cannot see a newer release. Updating is a manual step: check
https://cdn.sheetjs.com/ and https://git.sheetjs.com/sheetjs/sheetjs/src/branch/master/CHANGELOG.md, then
`npm install -w @throng/ui https://cdn.sheetjs.com/xlsx-<version>/xlsx-<version>.tgz --save-exact`. The
release skill's dependency sweep records it as a manual row. `scripts/generate-licenses.mjs` reads the
lockfile entry and the installed `package.json`, so a URL-resolved package is listed like any other
(asserted by a new unit test).

## R7 — Reading a workbook's bytes

**Decision**: A new invoke channel, `throng:preview:readSource { panelId }`, answered in main by the
existing `throng-preview://source` handler itself (`createPreviewProtocolHandler`, called with a
synthesised request), so containment, the MIME allowlist and the size cap are decided by the one route
044 built (FR-070). The cap for a provider that declares a size-limit setting is that setting; otherwise
`editor.maxOpenFileBytes`, as now.

**Rationale**: the renderer's CSP keeps `connect-src` on `'self'`, so the body cannot `fetch` a
`throng-preview:` URL; widening the CSP would loosen every renderer surface to serve one provider.

## R8 — Column widths as per-file state

**Decision**: A nullable `grid_column_widths` TEXT column on `document_state` (migration v13, registered
in `schema-guard.ts`'s additive columns), JSON `{ "<col>": px }`. `DocumentStateDto` gains
`gridColumnWidths`, and `document.setState` takes the two leaves independently, deleting the row only
when both are empty. The renderer reads and writes through `DocumentClient`; widths travel with the file
on rename and move through the existing `movePath`.

**Rationale**: FR-040 says "alongside the document's other persisted state"; `document_state` is that
state (the language override). The repository's `set(…, null)` deleted the whole row, which would have
wiped the widths with a cleared override (Explore report §4, hazard).

## R9 — The Open-in preference

**Decision**: Consumed from 074 (cherry-picked `feat(074): Open-in preference for every preview type`).
This feature only declares, on its two descriptors, the shipped value (`preview`) and the CSV
`preview` option's label "Throng Preview Editor", plus the plural used in the label ("CSVs",
"spreadsheets").

## R10 — Test layers

- **Unit**: the parser, the writer, delimiter detection, clipboard formats, column letters, the
  workbook reader (real files written by SheetJS in each format), provider descriptors and settings,
  the licence collector, the startup-bundle guard (SC-003).
- **Component** (jsdom): the grid — virtualised window, selection, keyboard, in-cell editor, menus,
  clipboard, resize; the CSV body's edit → operation mapping; the spreadsheet body's sheet switcher and
  notices.
- **Integration**: `CsvGridService` over a real `EditorCoordinator` and temp tree — first edit opens the
  grid document, dirty without a write, undo, save writes minimal bytes, an editor opened later joins it,
  closing hands over; `readSource` through the real protocol handler with the size cap; the
  `document_state` migration and repository.
- **E2E** (`@extended`, written here, run by the orchestrator's `pipeline.yml` dispatch): one spec —
  open a CSV from Files & Folders into the CSV Preview Editor, edit a cell, Ctrl+S, file bytes on disk.
  Justification: the routing from a real tree click to a real panel and the real save chord across
  processes is what only a window can show; every rule is proved lower.

## R11 — Column auto-fit (FR-011, 2026-11-19)

- **Decision**: canvas `measureText` over every row's display text in the grid's computed font, plus
  the cell's horizontal padding; the header label counts. Toggle by remembering the width the fit
  replaced, per column, for the panel's life; a second double-click restores it only while the column
  still has the fitted width.
- **Rationale**: exact for proportional fonts, no layout thrash, no DOM for off-screen rows.
- **Alternatives**: measuring rendered cells (only the virtual window exists); a character-count
  estimate (wrong for proportional fonts).

## R12 — Row expansion (FR-012, 2026-11-19)

- **Decision**: variable row heights through the row virtualiser's `estimateSize`, computed from the
  tallest cell's wrapped line count (canvas measurement against each column's width, line breaks
  honoured), capped at 20 lines.
- **Rationale**: keeps virtualisation; no `measureElement` reflow loop on 100,000 rows.
- **Alternatives**: `measureElement` on rendered rows (reflow per scroll); persisting the set (indexes
  shift on insert, Q7).

## R13 — Scrolling smoothness (SC-009, 2026-11-19)

- **Decision**: render the virtual window asynchronously (`useFlushSync: false`), raise column overscan,
  memoise row rendering, and keep scroll reporting out of React state. Verified by a component test that
  counts renders per scroll step and by MT-01 step 6.
- **Alternatives**: a canvas-drawn grid (loses text selection, accessibility and theme tokens).

## R14 — Last Preview Panel reuse for CSV (defect, 2026-11-19)

- **Decision**: reproduce in an integration test over `PreviewService` before any fix; the fix lands where
  the reproduction shows the stale state lives.
