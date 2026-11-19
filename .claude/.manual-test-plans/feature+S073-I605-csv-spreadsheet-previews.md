# Manual test plan: CSV grid editing and spreadsheet previews

Spec: `specs/073-csv-spreadsheet-previews/spec.md`

| ID | Title | Status | Signed off at | Date | Reason |
|---|---|---|---|---|---|
| MT-01 | A CSV opens as a grid | needs retest | | | failed: Horizontal scrolling is a bit laggy inside CSV previews. |
| MT-02 | Editing and saving a CSV in the grid | needs retest | | | failed: Double-clicking a cell should select all text in the cell. Pressing arrows, HOME or END should move the caret accordingly. |
| MT-03 | One document shared with the text editor | untested | | | |
| MT-04 | Clipboard and column widths in the grid | needs retest | | | failed: If I mouse-over a column or row and double click, I would like the column or row to expand / collapse to fit the text that is in it. |
| MT-05 | Workbook previews | untested | | | |
| MT-06 | Open-in settings and turning a provider off | needs retest | | | failed: Open a CSV, customise column sizes, open another CSV: it replaces the first. Open the original again: it opens a new panel. CSV panels should reuse like Markdown previews. |

## MT-01: A CSV opens as a grid

Covers: FR-001, FR-005, FR-008a, FR-022, FR-030, FR-042, FR-046, SC-009, #605
Paths: `packages/ui/src/renderer/grid/**`, `packages/ui/src/renderer/preview/providers/csv/**`, `packages/core/src/csv/**`, `packages/core/src/preview/providers/csv.ts`

### Steps
1. In a project, create `people.csv` with three lines: `name,note`, `"Smith, J","said ""hi"""`, `Lee,plain`. Click it in File Explorer. A panel titled **people.csv - Preview** opens holding a grid.
2. The header strip reads **A**, **B**; row 1 is `name | note`; row 2 shows `Smith, J` and `said "hi"` whole in their cells.
3. Press the arrow keys, Page Down, Ctrl+End and Ctrl+Home. The active cell moves accordingly; Shift with them extends the selection.
3a. In a long CSV scrolled to the top, click a column letter, then a row number, then right-click another column letter. Each selects without the grid moving. Press Down: the active cell moves to row 2 of the selected column.
4. Open a CSV of about 10 MB (100,000 rows). The grid appears within about two seconds and scrolls to the last row smoothly; the app stays responsive while it loads.
5. Zoom the panel with the panel zoom keys. Rows and text grow and shrink together.
6. In a CSV of 100,000 rows and 50 columns, scroll sideways to the last column and back with the wheel (Shift+wheel) and the trackpad. The columns follow without stutter and no blank cells flash at the edges.

### Negative cases
- A CSV with a field holding `<img src=x onerror=alert(1)>` shows that text literally; no image and no alert.
- A CSV whose quote never closes (`a,b` then `1,"open` then `2,3`) shows one notice naming **line 2** with an **Open in Editor** button; the button opens the text editor on that file.

## MT-02: Editing and saving a CSV in the grid

Covers: FR-033, FR-035, FR-035a, FR-036, FR-037, FR-038, FR-040, FR-043
Paths: `packages/ui/src/renderer/preview/providers/csv/csv-body.tsx`, `packages/ui/src/renderer/grid/**`, `packages/ui/src/main/csv-grid-service.ts`, `packages/ui/src/main/editor-coordinator.ts`, `packages/core/src/csv/**`, `packages/core/src/config/keybindings.ts`

### Steps
1. In `people.csv`'s grid, click the cell holding `plain`, press Enter, type `now, with a comma`, press Enter. The cell shows the new text and the active cell moves down. The tab, the project and the file in File Explorer show the unsaved marker.
2. Press Ctrl+S. The markers clear. Open the file in a text editor (Open In): only that field changed, now `"now, with a comma"`; line endings and every other line are as before.
3. Type a character on any cell: the editor opens holding just that character. Escape cancels; the cell is unchanged.
4. Press Ctrl+Z, then Ctrl+Y. The last edit undoes and redoes.
5. Right-click a row number: **Insert Row Above**, **Insert Row Below** and **Cut Rows** are there and work. Right-click a column letter: **Insert Column Left/Right** work.
6. Select several cells and press Delete. They empty in one undo step.
7. Turn **Editor: Auto save** on, edit a cell, wait. The file saves itself and the marker clears.
8. Assign a chord to **Insert Row Below** in Key Bindings (group **CSV grid**). In the grid it inserts a row.
8a. The CSV preview's title bar shows the Save and Save As icons, as an editor's does; narrowing the panel hides Save As, then Save. Edit a cell and click Save: the marker clears. Click Save As, choose `copy.csv`: `copy.csv` holds the edited table, the original is unchanged, and the panel's title now names `copy.csv`. Save As is also on the grid's right-click menu and on Ctrl+Shift+S.
9. Double-click a cell holding `hello world`. The cell editor opens with all of `hello world` selected. Press Home, then End, then Left and Right: the caret moves within the text and the active cell does not change. Press Shift+Home: the text from the caret to the start is selected. Escape leaves the cell unchanged.
10. Double-click the cell again and type `x`. The whole value is replaced by `x`; Enter commits it.

### Negative cases
- Edit a cell and close the preview panel. The unsaved-changes prompt appears; Cancel keeps the panel, Discard closes it and the file on disk is unchanged.
- With unsaved grid edits, quit the app. The unsaved prompt lists the file.

## MT-03: One document shared with the text editor

Covers: FR-031, FR-032, FR-033, FR-034, Principle XI
Paths: `packages/ui/src/main/editor-coordinator.ts`, `packages/ui/src/main/csv-grid-service.ts`, `packages/ui/src/main/preview-service.ts`, `packages/ui/src/renderer/editor/editor-open.tsx`, `packages/ui/src/renderer/editor/editor-state.ts`

### Steps
1. Open a CSV in the grid, edit a cell (do not save). Open the same file in a text editor (Open In › editor). The editor shows the edited text and is marked unsaved.
2. Type in the editor. The grid updates to match after the preview delay.
3. Close the editor. The grid keeps the unsaved document and its marker; Ctrl+S in the grid saves it.
4. With the editor open, edit in the grid, then Ctrl+Z in the editor. The grid's edit undoes.

### Negative cases
- With the grid holding unsaved edits, clicking the CSV in File Explorer shows the edited text, still marked unsaved, never a clean copy from disk.
- With both open, closing the grid asks nothing: the editor still holds the document.

## MT-04: Clipboard and column widths in the grid

Covers: FR-006, FR-006a, FR-011, FR-012, FR-037c, FR-037d, FR-037e, FR-037f
Paths: `packages/ui/src/renderer/grid/**`, `packages/ui/src/renderer/preview/providers/csv/column-widths.ts`, `packages/ui/src/renderer/preview/providers/csv/csv-body.tsx`, `packages/ui/src/renderer/preview/providers/spreadsheet/spreadsheet-body.tsx`, `packages/daemon/src/document-service.ts`, `packages/persistence/src/**`

### Steps
1. Select a 2×2 block and press Ctrl+C. Paste into a spreadsheet program: four cells arrive. Paste into a text editor: tab-separated text.
2. Copy a 2×2 block from a spreadsheet program, select a cell in the grid, press Ctrl+V. The block lands from that cell in one undo step.
3. Right-click a cell: **Copy**, **Copy as Rich Text** and **Copy as Plain Text** are there.
4. Drag a column's right edge wider. Close and reopen the file, then restart throng. The width is kept.
5. Right-click a column letter, **Column Width…**, enter `300`. The column is 300 pixels.
6. Double-click the letter of a column holding values wider than it. It widens to fit its widest value. Double-click it again: it returns to the width it had. Fit it once more, close and reopen the file: the fitted width is kept.
7. Double-click the row number of a row holding a long value and a value with a line break. The row grows so both show in full, wrapped and on separate lines. Double-click it again: one line high.
8. In a workbook preview, double-click a column letter and a row number. They fit and expand the same way.
9. Right-click a cell, a dragged selection, a row number and a column letter in turn. Each menu offers Cut, Copy and Paste (a workbook preview: Copy).
10. Copy a 2×2 block from another CSV. In this grid drag a selection from C3 up to B2 and press Ctrl+V: B2:C3 now hold the copied values and nothing to the right or below C3 changed. Undo, select the same block with the mouse, right-click it and choose Paste: same result.
11. Copy a single value, select B2:C3, paste. All four cells hold that value.
12. Select whole rows 2–3 by their numbers, paste a 2-row block: it lands from column A of row 2.
13. Right-click a resized column's letter, **Reset Size**: back to the default width; close and reopen the file, still default. Expand a row, right-click its number, **Reset Size**: one line high again.

### Negative cases
- Cut a selection of whole rows: the rows are removed and on the clipboard; Ctrl+Z brings them back.
- A column holding only short values double-clicked does not shrink below 40 pixels; one holding a very long value stops at 2,000 pixels.
- A row with a value longer than 20 lines expands to 20 lines; the cell scrolls to show the rest.

## MT-05: Workbook previews

Covers: FR-050, FR-051, FR-055, FR-056, FR-058, FR-059, FR-062, #323, #604
Paths: `packages/ui/src/renderer/preview/providers/spreadsheet/**`, `packages/core/src/preview/providers/spreadsheet.ts`, `packages/ui/src/main/preview-protocol.ts`, `packages/ui/src/main/preview-service.ts`, `packages/ui/src/renderer/preview/preview-notice.tsx`

### Steps
1. Click an `.xlsx` with two sheets in File Explorer. A **book.xlsx - Preview** opens on the first sheet, with the sheet names along the bottom. Click the second name: its cells show.
2. Repeat with an `.ods`, an `.xls` and a `.numbers` file. Each previews; formula cells show values.
3. A workbook with a hidden sheet lists it as **Name (hidden)**, dimmed.
4. Turn on **Spreadsheet: First row is a header**. The first row moves into the header strip.
5. Choose the second sheet, then change the workbook in Excel or LibreOffice and save. The preview reloads on the same sheet.
6. Set **Spreadsheet: Preview size limit (MB)** to 5 and open a larger workbook. A notice names its size and the 5 MB limit. Raise the limit and choose **Refresh**: it loads.

### Negative cases
- Enter and typing in the grid open no cell editor; there is no Paste, Delete or Insert anywhere.
- A password-protected workbook shows one notice saying it is protected. A `.xlsx` that is really a text file shows one notice saying it could not be read as a workbook.

## MT-06: Open-in settings and turning a provider off

Covers: FR-020, FR-033a, FR-063, FR-064, Q1, Q2, Q5, Q10
Paths: `packages/core/src/preview/providers/**`, `packages/core/src/config/preview-settings.ts`, `packages/ui/src/renderer/preview/preview-provider-sync.tsx`, `packages/ui/src/renderer/preview/open-preview.ts`, `packages/ui/src/main/preview-service.ts`, `packages/ui/src/main/csv-grid-service.ts`, `packages/ui/src/renderer/preview/preview-link-notice.tsx`

### Steps
1. Preferences › Editor › Previews › CSV: **Open CSVs in** offers Throng Editor, Throng Preview Editor and Default OS Program, set to Throng Preview Editor.
2. Set it to Throng Editor; click a CSV. It opens in the text editor. Set it to Default OS Program; the OS program opens it and no panel opens.
3. Spreadsheet: **Open spreadsheets in** offers Throng Preview and Default OS Program only.
4. With a CSV grid holding unsaved edits that no editor shows, turn **CSV: Enabled** off. The unsaved prompt appears; Cancel keeps the panel, Save saves and closes it.
5. With **CSV: Open previews in** = Last Preview Panel, open `a.csv`, resize a column, then open `b.csv`: it replaces `a.csv` in the same panel. Open `a.csv` again: it replaces `b.csv` in that panel, with its resized column; no second panel opens. Edit a cell in `a.csv`, save, open `b.csv`: still the same panel.
6. Edit a cell in `a.csv` and do NOT save; open `b.csv`. It opens in a new panel and `a.csv` keeps its unsaved edit and marker. With unsaved edits, Back in that panel shows a notice: "This grid has unsaved changes. Save them to go back or forward."

### Negative cases
- Turning **Spreadsheet: Enabled** off closes every spreadsheet preview with no prompt.
