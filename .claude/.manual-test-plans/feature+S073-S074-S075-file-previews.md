# Manual test plan: File previews (073 CSV, 074 media, 075 Markdown)

One plan for the merged branch. Each area owns a block of IDs and picks its numbers by hand inside it.

- **[CSV]** 073 CSV editor and spreadsheet previews — owner: the 073 CSV worker — IDs MT-01 to MT-19. 073's MT-01 to MT-10 keep their numbers; MT-11 is 074 MT-13's CSV and Spreadsheet part.
- **[Media]** 074 media previews — owner: the 074 media worker — IDs MT-20 to MT-39. 074 MT-01 to MT-13 become MT-20 to MT-32, in the same order; MT-11 holds the CSV and Spreadsheet part of 074 MT-13.
- **[Markdown]** 075 Markdown preview extensions — owner: the 075 Markdown worker — IDs MT-40 to MT-59. 075 MT-01 to MT-05 become MT-40 to MT-44, in the same order; MT-45 is new.
- **[Print]** Printing previews — owner: the 075 Markdown worker — IDs MT-60 to MT-79. 075 MT-06 and MT-07 become MT-60 and MT-61; MT-62 is new.
- **[Settings]** 077 numeric setting controls — owner: the 077 worker — IDs MT-80 to MT-99. All new.
- **[General]** Behaviour shared by every preview type after the 073/074/075 merge — owner: the orchestrator session — IDs MT-100 to MT-119. All new.

| ID | Title | Status | Signed off at | Date | Reason |
|---|---|---|---|---|---|
| MT-01 | [CSV] A CSV opens as a grid | needs retest | | | failed: Horizontal scrolling is a bit laggy inside CSV previews. |
| MT-02 | [CSV] Editing and saving a CSV in the grid | needs retest | | | failed: Double-clicking a cell should select all text in the cell. Pressing arrows, HOME or END should move the caret accordingly. |
| MT-03 | [CSV] One document shared with the text editor | untested | | | |
| MT-04 | [CSV] Clipboard and column widths in the grid | needs retest | | | failed: If I mouse-over a column or row and double click, I would like the column or row to expand / collapse to fit the text that is in it. |
| MT-05 | [CSV] Workbook previews | untested | | | |
| MT-06 | [CSV] Open-in settings and turning a provider off | needs retest | | | failed: Opening a CSV in preview editor mode, then opening another, will use the same panel. However, if you open a CSV, then open its editor (using the status bar button), click back into the original CSV, then click BACK to the original CSV, two CSV previews will open. Only one CSV preview should exist at a time, unless the user explicitly opens another preview editor. |
| MT-07 | [CSV] Go to Row, Line and Page | untested | | | |
| MT-08 | [CSV] Wrapping cells | untested | | | |
| MT-09 | [CSV] Locking the first row and column | untested | | | |
| MT-10 | [CSV] A CSV and its editor in step; toggle looks | needs retest | | | failed: scrolling from the CSV editor with scroll sync on is still lagging a lot. Scrolling in the synced editor is not as bad (though its worse with wrapped lines), but it still happens. |
| MT-11 | [CSV] CSV and Spreadsheet preview icons and titles | untested | | | |
| MT-12 | [CSV] Print… and Go to Row in the grid menus | untested | | | |
| MT-13 | [CSV] Loading placeholders for workbooks and large CSVs | untested | | | |
| MT-14 | [CSV] The cell dialog is themed like an editor | untested | | | |
| MT-20 | [Media] Open … in, for every preview type | untested | | | carried from 074 MT-01; no sign-off survives the merge |
| MT-21 | [Media] Image Preview | untested | | | carried from 074 MT-02; no sign-off survives the merge |
| MT-22 | [Media] SVG Preview beside its editor | untested | | | carried from 074 MT-03; no sign-off survives the merge |
| MT-23 | [Media] SVG and images in a Markdown preview | untested | | | carried from 074 MT-04; no sign-off survives the merge |
| MT-24 | [Media] PDF Preview | untested | | | carried from 074 MT-05; no sign-off survives the merge |
| MT-25 | [Media] HTML Preview | untested | | | carried from 074 MT-06; no sign-off survives the merge |
| MT-26 | [Media] Hostile files | untested | | | carried from 074 MT-07; no sign-off survives the merge |
| MT-27 | [Media] Size limits and provider settings | untested | | | carried from 074 MT-08; 077 reworded the notice to MB with its bytes |
| MT-28 | [Media] HTML Preview updates in place | untested | | | carried from 074 MT-09; no sign-off survives the merge |
| MT-29 | [Media] Find in HTML and PDF previews | untested | | | carried from 074 MT-10; no sign-off survives the merge |
| MT-30 | [Media] HTML page right-click menu | untested | | | carried from 074 MT-11; no sign-off survives the merge |
| MT-31 | [Media] Safe HTML preview sources | untested | | | carried from 074 MT-12; no sign-off survives the merge |
| MT-32 | [Media] Preview type icons and titles | untested | | | carried from 074 MT-13; no sign-off survives the merge |
| MT-40 | [Markdown] Callouts draw with their type, icon and title | needs retest | | | signed off on 075 at 0c5219b71c9e; later 075 work (loading placeholder, resize hold) and the merge touched its paths |
| MT-41 | [Markdown] Folding callouts | needs retest | | | signed off on 075 at 0c5219b71c9e; later 075 work and the merge touched preview-panel.tsx, markdown-body.tsx and copy.ts |
| MT-42 | [Markdown] Callout colours in the Themes editor | needs retest | 03657a275a3b | 2026-11-20 | 1bb44e9d touched packages/core/src/config/theme-copy.ts |
| MT-43 | [Markdown] Typeset maths | needs retest | | | failed: MT-04-maths-500.md draws 500 equations and the editor lags significantly as they load, render and scroll; print preview is slow to render and to move between pages |
| MT-44 | [Markdown] Print… in a preview's menus and keyboard | needs retest | | | signed off on 075 at 0c5219b71c9e; editor print (FR-064a) and the merge touched its menus and key bindings |
| MT-45 | [Markdown] Dragging beside a preview, and dialogs over a scrolled preview | untested | | | |
| MT-46 | [Markdown] Synchronise Scrolling past folded callouts and closed details | untested | | | |
| MT-47 | [Markdown] A preview whose file no longer exists | untested | | | |
| MT-48 | [Markdown] Copy and find in an HTML page that uses throng's class names | untested | | | |
| MT-60 | [Print] Print Preview and printing | needs retest | | | failed: the page view jitters on load and on a page change, as if drawn full screen then fitted to its panel; it should show once loaded, with a spinner if needed; mouse wheel, arrow keys, Home and End should move between pages |
| MT-61 | [Print] Printing an editor | untested | | | |
| MT-62 | [Print] Print… across every preview type | untested | | | |
| MT-63 | [Print] What prints from a Markdown preview | untested | | | |
| MT-80 | [Settings] A size in MB on the slider, exactly in bytes in the box | untested | | | |
| MT-81 | [Settings] Durations shown in their unit | untested | | | |
| MT-82 | [Settings] Typing a value past a limit, or no number | untested | | | |
| MT-83 | [Settings] A v1.0.0-beta1 settings file after upgrading | untested | | | |
| MT-84 | [Settings] Too-large notices quote the limit as Preferences shows it | untested | | | |
| MT-85 | [Settings] The Resource Monitor interval menu matches Preferences | untested | | | |
| MT-86 | [Settings] Print dialog numbers name their limits | untested | | | |
| MT-100 | [General] One Last Active preview across preview types | untested | | | |
| MT-101 | [General] Preview titles and icons for all eight types | untested | | | |
| MT-102 | [General] One Go to dialog for lines, rows, pages and headings | untested | | | |
| MT-103 | [General] Print… shown everywhere, enabled only where it prints | untested | | | |
| MT-104 | [General] The middle mouse button never pastes | untested | | | |
| MT-105 | [General] Open files in and Open previews in, both ways | untested | | | |

## MT-01: [CSV] A CSV opens as a grid

Covers: 073 FR-001, 073 FR-005, 073 FR-008a, 073 FR-022, 073 FR-030, 073 FR-042, 073 FR-046, 073 SC-009, #605
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

## MT-02: [CSV] Editing and saving a CSV in the grid

Covers: 073 FR-033, 073 FR-035, 073 FR-035a, 073 FR-036, 073 FR-036a, 073 FR-036b, 073 FR-037, 073 FR-038, 073 FR-040, 073 FR-043, 073 FR-060a, 073 FR-036d
Paths: `packages/ui/src/renderer/preview/providers/csv/csv-body.tsx`, `packages/ui/src/renderer/grid/**`, `packages/ui/src/main/csv-grid-service.ts`, `packages/ui/src/main/editor-coordinator.ts`, `packages/core/src/csv/**`, `packages/core/src/config/keybindings.ts`

### Steps
1. In `people.csv`'s grid, click the cell holding `plain`, press Enter, type `now, with a comma`, press Enter. The cell shows the new text and the active cell moves down. The panel title bar, the tab, the project and the file in File Explorer show the unsaved marker, and all of them clear on save.
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
11. Put `{"id":1,"tags":["alpha","beta"],"note":"long enough to pass fifty"}` in a cell. Double-click it: a dialog opens with the JSON indented and highlighted. Change `alpha` to `gamma`, save: the cell shows the JSON on one line, `{ "id": 1, "tags": [ ...`. Ctrl+Z restores the original in one step.
12. Double-click the same cell, change nothing, save: the file stays clean (no unsaved marker). Press F2 and Enter on it: the dialog again. Select it and type a letter: the in-cell editor replaces the value instead.
13. Right-click a short cell, **Edit in Dialog…**, type `first`, Enter, `  second`, save: the cell holds `first   second` (the line break became one space, the indent kept). Open the dialog and press Esc: nothing changes.
12a. Select a block of cells and right-click it: **Edit in Dialog…** is greyed out. Select one cell: it is enabled. The same for whole rows or columns.
13a. Double-click a short cell that holds a line break (e.g. two words on two lines): it opens in the dialog, not in the cell. Turn off **Edit multi-line cells in a dialog** in Preferences: the same double-click edits in the cell.
14. Preferences › Editor › Previews › CSV: **Edit long cells in a dialog** (on) and **Long cell threshold** (50). Set the threshold to 10: a 20-character cell opens the dialog. Turn the setting off: double-click on a long cell opens the in-cell editor, and no menu offers Edit in Dialog….
15. With the setting still off, find the cell-dialog toggle at the bottom right of a CSV panel's status bar; it shows off. Turn it on (mouse, then Tab to it and Space): this panel offers the dialog again; another open CSV panel does not. Restart throng: the panel's toggle is still on. Turn the setting back on: a panel whose toggle you never touched follows it.

### Negative cases
- Edit a cell and close the preview panel. The unsaved-changes prompt appears; Cancel keeps the panel, Discard closes it and the file on disk is unchanged.
- With unsaved grid edits, quit the app. The unsaved prompt lists the file.

## MT-03: [CSV] One document shared with the text editor

Covers: 073 FR-031, 073 FR-032, 073 FR-033, 073 FR-034, 073 Principle XI
Paths: `packages/ui/src/main/editor-coordinator.ts`, `packages/ui/src/main/csv-grid-service.ts`, `packages/ui/src/main/preview-service.ts`, `packages/ui/src/renderer/editor/editor-open.tsx`, `packages/ui/src/renderer/editor/editor-state.ts`

### Steps
1. Open a CSV in the grid, edit a cell (do not save). Open the same file in a text editor (Open In › editor). The editor shows the edited text and is marked unsaved.
2. Type in the editor. The grid updates to match after the preview delay.
3. Close the editor. The grid keeps the unsaved document and its marker; Ctrl+S in the grid saves it.
4. With the editor open, edit in the grid, then Ctrl+Z in the editor. The grid's edit undoes.

### Negative cases
- With the grid holding unsaved edits, clicking the CSV in File Explorer shows the edited text, still marked unsaved, never a clean copy from disk.
- With both open, closing the grid asks nothing: the editor still holds the document.

## MT-04: [CSV] Clipboard and column widths in the grid

Covers: 073 FR-006, 073 FR-006a, 073 FR-006b, 073 FR-006c, 073 FR-012a, 073 FR-008b, 073 FR-008c, 073 FR-008e, 073 FR-008f, 073 FR-037g, 073 FR-037h, 073 FR-011, 073 FR-012, 073 FR-037c, 073 FR-037d, 073 FR-037i, 073 FR-037e, 073 FR-037f, 073 FR-038, 073 FR-038a
Paths: `packages/ui/src/renderer/grid/**`, `packages/ui/src/renderer/preview/providers/csv/column-widths.ts`, `packages/ui/src/renderer/preview/providers/csv/csv-body.tsx`, `packages/ui/src/renderer/preview/providers/spreadsheet/spreadsheet-body.tsx`, `packages/daemon/src/document-service.ts`, `packages/persistence/src/**`

### Steps
1. Select a 2×2 block and press Ctrl+C. Paste into a spreadsheet program: four cells arrive. Paste into a text editor: tab-separated text.
2. Copy a 2×2 block from a spreadsheet program, select a cell in the grid, press Ctrl+V. The block lands from that cell in one undo step.
3. Right-click a cell: **Copy**, **Copy as Rich Text** and **Copy as Plain Text** are there.
4. Drag a column's right edge wider. Close and reopen the file, then restart throng. The width is kept.
5. Right-click a column letter, **Column Width…**, enter `300`. The column is 300 pixels.
6. Double-click the letter of a column holding values wider than it. It widens to fit its widest value. Double-click it again: it returns to the width it had. Fit it once more, close and reopen the file: the fitted width is kept.
7. Double-click a row number: nothing changes. Its right-click menu has no Reset Row Height.
8. In a workbook preview, double-click a column letter: it fits the same way. A row-number double-click does nothing.
9. Right-click a cell, a dragged selection, a row number and a column letter in turn. Each menu offers Cut, Copy and Paste (a workbook preview: Copy).
10. Copy a 2×2 block from another CSV. In this grid drag a selection from C3 up to B2 and press Ctrl+V: B2:C3 now hold the copied values and nothing to the right or below C3 changed. Undo, select the same block with the mouse, right-click it and choose Paste: same result.
11. Copy a single value, select B2:C3, paste. All four cells hold that value.
11a. Select B2:C3 and press Ctrl+X, then Esc: the four values are back, and pasting elsewhere still pastes them. Press Esc again: nothing changes. Cut again, type in another cell, then Esc: nothing is undone. Cut whole rows 2–3, Esc: the rows are back.
12. Select whole rows 2–3 by their numbers, paste a 2-row block: it lands from column A of row 2.
13. Right-click a resized column's letter, **Reset Column Width**: back to the default width; close and reopen the file, still default. No menu says Reset Size or Reset Row Height.
14. Select rows 2–3 by their numbers and copy. Right-click row 6's number: **Insert Copied Rows Above** and **Insert Copied Rows Below** are there beside **Insert Row Above/Below**. Choose Above: two rows with the copied values appear above row 6; one Ctrl+Z removes both. Copy columns B–C by their letters and use **Insert Copied Columns Right** on column E the same way. Copy text from another app: the Insert Copied items are gone; the blank inserts remain.
15. Open the menus of a cell, a selection, a row number and a column letter, in a CSV and in a workbook preview. Cut, Copy, Paste, Save, Save As, the Insert items, Select All, Edit in Dialog…, Go to Row… and Reset Column Width each show an icon; switch theme and the icons follow it. No row-number or column-letter menu offers Select Row or Select Column.
15a. Rest the pointer on a row number, a column letter and the corner cell: it shows a right arrow, a down arrow and a diagonal arrow. On a column's right edge it shows the resize pointer. Same in a workbook preview. Press on a column letter and drag across five others: the down arrow stays steady the whole way, with no flicker at the column edges. Do the same down the row numbers and across cells.
15b. Select some text in another app (Linux primary selection) and copy something else. In a wide, long CSV, middle-click a cell: nothing is pasted and the selection does not move. Press the middle button and drag up and left: the pointer is the move hand and the table follows it; release ends it. Ctrl+middle-click still resets the zoom. Same in a workbook preview.
16. Scroll a long CSV to the middle and click the empty corner cell above the row numbers. Every row and column is selected and the grid does not move; Ctrl+C copies the whole table. Right-click the corner: everything is selected and the selection menu opens. Same in a workbook preview.

### Negative cases
- Cut a selection of whole rows: the rows are removed and on the clipboard; Ctrl+Z brings them back.
- A column holding only short values double-clicked does not shrink below 40 pixels; one holding a very long value stops at 2,000 pixels.

## MT-05: [CSV] Workbook previews

Covers: 073 FR-050, 073 FR-051, 073 FR-055, 073 FR-056, 073 FR-058, 073 FR-059, 073 FR-062, #323, #604
Paths: `packages/ui/src/renderer/preview/providers/spreadsheet/**`, `packages/core/src/preview/providers/spreadsheet.ts`, `packages/ui/src/main/preview-protocol.ts`, `packages/ui/src/main/preview-service.ts`, `packages/ui/src/renderer/preview/preview-notice.tsx`

### Steps
1. Click an `.xlsx` with two sheets in File Explorer. A **book.xlsx - Preview** opens on the first sheet, with the sheet names along the bottom. Click the second name: its cells show.
2. Repeat with an `.ods`, an `.xls` and a `.numbers` file. Each previews; formula cells show values.
3. A workbook with a hidden sheet lists it as **Name (hidden)**, dimmed.
4. Turn on **Spreadsheet: First row is a header**. The first row moves into the header strip.
5. Choose the second sheet, then change the workbook in Excel or LibreOffice and save. The preview reloads on the same sheet.
6. In Preferences set the Spreadsheet preview size limit below the size of a workbook, and open that workbook. One notice names the file's size and the limit as set in Preferences; Refresh after raising the limit opens the workbook.

### Negative cases
- Enter and typing in the grid open no cell editor; there is no Paste, Delete or Insert anywhere.
- A password-protected workbook shows one notice saying it is protected. A `.xlsx` that is really a text file shows one notice saying it could not be read as a workbook.

## MT-06: [CSV] Open-in settings and turning a provider off

Covers: 073 FR-020, 073 FR-033a, 073 FR-033b, 073 FR-008d, 073 FR-063, 073 FR-064, 073 Q1, 073 Q2, 073 Q5, 073 Q10, 073 FR-060e
Paths: `packages/core/src/preview/providers/**`, `packages/core/src/config/preview-settings.ts`, `packages/ui/src/renderer/preview/preview-provider-sync.tsx`, `packages/ui/src/renderer/preview/open-preview.ts`, `packages/ui/src/main/preview-service.ts`, `packages/ui/src/main/csv-grid-service.ts`, `packages/ui/src/renderer/preview/preview-link-notice.tsx`

### Steps
1. Preferences › Editor › Previews › CSV: **Open CSVs in** offers Throng Editor, Throng Preview Editor and Default OS Program, set to Throng Preview Editor.
2. Set it to Throng Editor; click a CSV. It opens in the text editor. Set it to Default OS Program; the OS program opens it and no panel opens.
3. Spreadsheet: **Open spreadsheets in** offers Throng Preview and Default OS Program only.
4. With a CSV grid holding unsaved edits that no editor shows, turn **CSV: Enabled** off. The unsaved prompt appears; Cancel keeps the panel, Save saves and closes it.
5. With **CSV: Open previews in** = Last Preview Panel, open `a.csv`, resize a column, then open `b.csv`: it replaces `a.csv` in the same panel. Open `a.csv` again: it replaces `b.csv` in that panel, with its resized column; no second panel opens. Edit a cell in `a.csv`, save, open `b.csv`: still the same panel.
6. Edit a cell in `a.csv` and do NOT save; open `b.csv`. The unsaved-changes prompt names both files. **Cancel**: nothing opens. **Open in new preview**: `b.csv` opens in a new panel and `a.csv` keeps its edit and marker. Repeat with **Discard & open**: the panel shows `b.csv` and `a.csv` reopens unedited. Repeat with **Save & open**: `a.csv` is saved and the panel shows `b.csv`. Drop `b.csv` from File Explorer onto the dirty grid: the same prompt. With unsaved edits, Back in that panel shows a notice: "This grid has unsaved changes. Save them to go back or forward."
7. In one panel, select C7 in `a.csv`, then open `b.csv`: it starts at A1. Select B3, reopen `a.csv`: C7 is selected and in view. Back: B3. Forward: C7. Restart throng and reopen both: each starts at A1.
8. With **CSV: Open previews in** = Last Preview Panel, open `a.csv`, click the status bar's open-in-editor button, click back into the preview, open `b.csv`, then open `a.csv` again from Files & Folders: the one preview moves back to `a.csv` beside its editor and no second CSV preview appears. Use Back instead of Files & Folders: the same.

### Negative cases
- Turning **Spreadsheet: Enabled** off closes every spreadsheet preview with no prompt.

## MT-07: [CSV] Go to Row, Line and Page

Covers: 073 FR-043a, 073 FR-043b
Paths: `packages/ui/src/renderer/navigate/**`, `packages/core/src/editor/goto-line.ts`, `packages/ui/src/renderer/grid/**`, `packages/ui/src/renderer/preview/providers/csv/csv-body.tsx`, `packages/ui/src/renderer/preview/providers/spreadsheet/spreadsheet-body.tsx`, `packages/ui/src/renderer/preview/preview-panel.tsx`

### Steps
1. Open a CSV of over 1,000 rows, click a cell in column C and press Ctrl+G. A dialog opens reading "Row <that row> of <row count>", the count digit-grouped.
2. Type 900 and press Enter. C900 is the active cell, its row at the top of the grid, and arrow keys move from it.
3. Right-click a cell, then a row number: both menus offer **Go to Row…**, which opens the same dialog.
4. In a workbook preview, Ctrl+G and Go to Row… do the same on the shown sheet.
5. In a text editor on a 300-line file, put the caret on line 40 and press Ctrl+G. The dialog looks the same and reads "Line 40 of 300". Type 120, Enter: the caret is at the start of line 120.
6. With **Remember Go to Line number** on, press Ctrl+G again: 120 is in the field, selected.

### Negative cases
- In the row and line dialogs, typing a letter, a minus sign, 0 as the first digit, or a number past the count leaves the field as it was.
- Escape, or a click outside the dialog, closes it; focus is back in the grid or the editor and nothing moved.
- Enter on an empty field does nothing and the dialog stays.

## MT-08: [CSV] Wrapping cells

Covers: 073 FR-013, 073 FR-060b, 073 FR-004
Paths: `packages/ui/src/renderer/grid/**`, `packages/ui/src/renderer/preview/providers/csv/csv-body.tsx`, `packages/ui/src/renderer/preview/preview-status-bar.tsx`, `packages/ui/src/renderer/workspace/panel-header-menu.ts`, `packages/ui/src/renderer/workspace/panel-placeholder.tsx`, `packages/core/src/preview/providers/csv.ts`, `packages/core/src/workspace/model.ts`

### Steps
1. Preferences › Editor › Previews › CSV: **Wrap cells** is there and off.
2. Open a CSV holding a 300-character value and a value with line breaks. Cells are one line, truncated. The status bar shows a Wrap toggle, off.
3. Turn Wrap on (click it; then Tab to it and press Space). Every row grows to show its cells in full, wrapped within their columns and broken at the line breaks; nothing is cut off however long.
4. Widen a column: its wrapped cells re-flow and the rows get shorter. Scroll quickly through a 100,000-row CSV with Wrap on: no stutter, no blank areas.
5. The panel's title-bar menu has a checked **Wrap** item; unchecking it turns wrapping off.
6. Another open CSV is unaffected. Restart throng: the panel is still wrapped.
7. Turn **Wrap cells** on in Preferences and open a different CSV: it opens wrapped. A panel you turned Wrap off in stays off.

### Negative cases
- A workbook preview has no Wrap toggle.
- Wrap changes nothing in the file: no unsaved marker appears.

## MT-09: [CSV] Locking the first row and column

Covers: 073 FR-039a, 073 FR-039b, 073 FR-060d
Paths: `packages/ui/src/renderer/grid/**`, `packages/ui/src/renderer/preview/providers/csv/csv-body.tsx`, `packages/ui/src/renderer/preview/preview-status-bar.tsx`, `packages/ui/src/renderer/workspace/panel-header-menu.ts`, `packages/ui/src/renderer/workspace/panel-placeholder.tsx`, `packages/core/src/preview/providers/csv.ts`, `packages/core/src/workspace/model.ts`

### Steps
1. Preferences › Editor › Previews › CSV: **Lock first row** and **Lock first column** are there, both off.
2. Open a CSV of about 1,000 rows and 40 columns. The status bar shows Lock first row and Lock first column toggles, both off.
3. Turn on Lock first row (click it; then Tab to it and press Space). Scroll down with the wheel, the scrollbar and Page Down: row 1 stays under the column letters, set apart from the rows scrolling beneath it.
3a. Watch row 1 as you turn Lock first row on and off: a highlighted line appears along its bottom edge and goes again, and no row moves or changes height.
4. Turn on Lock first column. Scroll right with Shift+wheel, the scrollbar and the arrow keys: column A stays beside the row numbers. Scroll diagonally: A1 stays in the corner. A highlighted line runs down the right edge of column A while it is locked, and no column moves or changes width when the lock goes on or off.
5. Click, edit and right-click a locked cell: it behaves like any other cell. Turn Wrap on: locked cells wrap too.
6. The panel's title-bar menu has checked **Lock First Row** and **Lock First Column** items; unchecking one unlocks it.
7. Another open CSV is unaffected. Restart throng: the panel keeps both locks.
8. Turn **Lock first row** on in Preferences and open a different CSV: row 1 is locked there. A panel you turned it off in stays off.

### Negative cases
- A workbook preview has no lock toggles.
- Locking changes nothing in the file: no unsaved marker appears.

## MT-10: [CSV] A CSV and its editor in step; toggle looks

Covers: 073 FR-033c, 073 FR-033d, 073 FR-033e, 073 FR-033f, 073 FR-033g, 073 SC-009, 073 FR-007a
Paths: `packages/ui/src/renderer/preview/sync-scroll-button.tsx`, `packages/ui/src/renderer/preview/preview-status-bar.tsx`, `packages/ui/src/renderer/editor/status-strip.tsx`, `packages/ui/src/renderer/preview/providers/csv/csv-body.tsx`, `packages/ui/src/renderer/grid/**`, `packages/core/src/preview/providers/csv.ts`, `packages/core/src/preview/provider.ts`, `packages/ui/src/renderer/preview/preview-panel.tsx`, `packages/ui/src/renderer/editor/**`, `packages/ui/src/renderer/preview/providers/markdown/**`

### Steps
1. Open a 2,000-row CSV in the text editor and choose Open Preview. The preview opens linked to the editor (its title bar shows the link as a Markdown preview's does).
2. With Synchronise Scrolling on, scroll the editor to about line 500: the grid's top row is the same record. Scroll the grid: the editor follows. A record holding a line break maps to its first line.
3. The Synchronise Scrolling button is on both status bars; turning it off on either stops both following.
4. On the CSV status bar, with each toggle off — cell dialog, Wrap, Lock first row, Lock first column, Synchronise Scrolling — its icon is greyed with a diagonal line through it and its tooltip ends ": disabled". Turn each on: the line goes, the icon is bright on a highlighted background, and the tooltip ends ": enabled".
5. The editor status bar's Synchronise Scrolling button looks and reads the same way.
6. With the CSV editor and preview side by side and Synchronise Scrolling on, scroll the editor: a soft highlight marks the line in the middle of the editor and the same record's row in the grid, while the tops of the two views stay in step, and fades about a second and a half after you stop. Keyboard focus stays in the editor. Scroll the grid: the same, the other way.
7. Scroll the grid with Wrap on, so its rows are taller than the editor's lines: the highlight sits on the row in the middle of the grid, and on the matching line in the editor wherever that is, not necessarily its middle.
8. Do the same with a long Markdown file and its preview, the preview gutter enabled: the editor highlights the matching line and the preview's gutter shows a marker beside the matching block. Turn the Markdown preview gutter off in Preferences: no marker, the editor highlight remains.
9. Preferences › Editor › Previews › **Scroll-sync highlight duration** shows 1.5. Set it to 4: both highlights stay about four seconds after you stop scrolling. Set it to 0: no highlight in either view.
10. Scroll either view continuously: no highlight while you scroll; about 0.3 s after you stop it appears on the pair in step. Start scrolling again: it clears.
11. With a 3,000+ row CSV and Wrap on, scroll the grid and then the editor quickly: both views keep up with no visible lag.

### Negative cases
- A CSV preview has no Go to Heading; Ctrl+G still opens Go to Row.

## MT-11: [CSV] CSV and Spreadsheet preview icons and titles

Covers: 074 FR-103, 074 FR-104
Paths: `packages/core/src/icons/default-set/previewCsv.svg`, `packages/core/src/icons/default-set/previewSpreadsheet.svg`, `packages/core/src/icons/icon-keys.ts`, `packages/core/src/preview/providers/csv.ts`, `packages/core/src/preview/providers/spreadsheet.ts`, `packages/core/src/preview/provider.ts`, `packages/core/src/workspace/panel-title.ts`

### Steps
1. Open `people.csv` and `book.xlsx` as previews. Each panel header shows its own preview icon: the preview icon's upper corners and eye, with the letters CSV beneath for the CSV and a small grid of cells for the workbook, in the same family as the Markdown, Image and PDF preview icons.
2. The titles read `people.csv - CSV Preview` and `book.xlsx - Spreadsheet Preview`.
3. Hover the tab holding them: its list of panels shows each with its type's icon.
4. Open `people.csv` in an editor: the status bar's preview button and Open In › Preview show the CSV preview icon. In Files & Folders, right-click `book.xlsx`: Open In › Preview shows the Spreadsheet preview icon.

### Negative cases
- Narrow the CSV preview panel until its title shortens: the file name gives way and ` - CSV Preview` stays whole.
- Neither preview shows the generic preview icon.

## MT-12: [CSV] Print… and Go to Row in the grid menus

Covers: 075 FR-062, 075 FR-063, 073 FR-043a
Paths: `packages/ui/src/renderer/grid/grid-print-row.ts`, `packages/ui/src/renderer/preview/providers/csv/csv-body.tsx`, `packages/ui/src/renderer/preview/providers/spreadsheet/spreadsheet-body.tsx`, `packages/ui/src/renderer/workspace/panel-header-menu.ts`, `packages/core/src/preview/provider.ts`, `packages/core/src/preview/providers/csv.ts`, `packages/core/src/preview/providers/spreadsheet.ts`, `packages/core/src/config/keybindings-metadata.ts`

### Steps
1. Open `people.csv` as a preview. Right-click a cell, then a row number, then a column letter: each menu has a **Print…** row, greyed out; hovering it reads "This preview type cannot be printed."
2. Do the same in `book.xlsx`: the cell, row-number and column-letter menus each show the same greyed-out **Print…** with that hover text.
3. Right-click the CSV preview's panel header: the menu has **Go to Row…** with the Go to Row icon and the Ctrl+G shortcut. Click it: the Go to dialog for rows opens. Do the same on the workbook preview's header.
4. Open Preferences › Key Bindings and find the Ctrl+G preview binding: it reads **Go to Heading, Page or Row…**, and its description names Go to Row in a CSV or spreadsheet preview.

### Negative cases
- Clicking the greyed-out **Print…** does nothing.
- A CSV or workbook header menu shows neither **Go to Heading…** nor **Go to Page…**.

## MT-13: [CSV] Loading placeholders for workbooks and large CSVs

Covers: 075 FR-043a
Paths: `packages/ui/src/renderer/preview/providers/spreadsheet/spreadsheet-body.tsx`, `packages/ui/src/renderer/preview/providers/csv/csv-body.tsx`, `packages/ui/src/renderer/preview/loading-placeholder.css`

### Steps
1. Open a large workbook (several MB) as a preview. While it is read, the panel shows the spinner with **Loading workbook…**, the same placeholder a PDF shows while it opens; the grid then replaces it.
2. Open a CSV larger than 512 KB as a preview. While it is parsed, the panel shows the spinner with **Loading CSV…**; the grid then replaces it.

### Negative cases
- Neither preview shows an empty panel or an empty grid while it loads.
- A small CSV opens straight into its grid with no placeholder flash.

## MT-14: [CSV] The cell dialog is themed like an editor

Covers: 073 FR-036f
Paths: `packages/ui/src/renderer/grid/cell-dialog.tsx`, `packages/ui/src/renderer/grid/cell-dialog.css`, `packages/ui/src/renderer/editor/editor.css`

### Steps
1. Choose the shipped dark theme (throng). Open a text file in an editor panel, and a CSV in the CSV Preview Editor beside it.
2. Double-click a long or multi-line cell to open the cell dialog. Its text area has the same background, text colour and caret as the editor panel, and the text is easy to read.
3. Press Ctrl+A in the dialog. The selection is the editor panel's selection colour and the selected text stays readable.
4. Click the dialog's title, so its text loses focus. The selection turns the editor's dimmer, kept-selection colour and stays readable.
5. Cancel, switch to the Light theme, and repeat steps 2 to 4. The dialog matches the light editor panel throughout.

### Negative cases
- The dialog's text is never drawn on a background other than the editor's, and no selection is a pale colour over a dark editor or the other way round.

## MT-20: [Media] Open … in, for every preview type

Covers: 074 FR-016, 074 FR-017, 074 FR-018, 074 FR-019, 074 SC-008
Paths: `packages/core/src/config/preview-settings.ts`, `packages/ui/src/renderer/editor/open-router.ts`, `packages/ui/src/renderer/editor/editor-open.tsx`, `packages/ui/src/renderer/navigate/quick-open.tsx`, `packages/ui/src/renderer/links/use-open-in-os.ts`, `packages/ui/src/main/preview-service.ts`

### Steps
1. Open Preferences → Editor → Previews. The subsections run Markdown, Mermaid, CSV, Spreadsheet, Image, SVG, PDF, HTML. Each of Markdown, Mermaid, Image, SVG, PDF and HTML has a row named **Open Markdown files in**, **Open Mermaid files in**, **Open images in**, **Open SVG files in**, **Open PDFs in**, **Open HTML files in**.
2. Open the list on **Open Markdown files in**. It offers Throng Editor, Throng Preview and Default OS Program. **Open images in** and **Open PDFs in** offer only Throng Preview and Default OS Program.
3. Set **Open PDFs in** to Default OS Program. Click a `.pdf` in Files & Folders. The system's PDF reader opens it; no throng panel opens.
4. Press Ctrl+P, type the PDF's name, press Enter. The system's PDF reader opens it again.
5. In a Markdown preview, Ctrl+click a link to that PDF. The system's PDF reader opens it.
6. Set **Open Markdown files in** to Default OS Program. Run Find in Files for a word in a `.md` file and open the result. An editor opens at the match.
7. Right-click the PDF in Files & Folders → Open In → Preview. A PDF Preview opens.

### Negative cases
- With **PDF: Enabled** off and Open PDFs in at Default OS Program, click a `.pdf`: it does not go to the OS program; it opens as throng opens a file no preview claims.

## MT-21: [Media] Image Preview

Covers: 074 FR-020, 074 FR-022, 074 FR-023, 074 FR-024, 074 FR-026, 074 FR-027, 074 FR-028, 074 FR-030, 074 FR-031, 074 FR-034
Paths: `packages/core/src/preview/providers/image.ts`, `packages/ui/src/renderer/preview/providers/image/**`, `packages/ui/src/renderer/preview/blocks/picture.ts`, `packages/ui/src/renderer/preview/diagram/**`, `packages/ui/src/renderer/preview/preview-status-bar.tsx`

### Steps
1. Click a `.png` in Files & Folders. An Image Preview titled `<name>.png - Image Preview` shows it fitted to the panel. The status bar shows its size in pixels and bytes.
2. Use Fit, Zoom In, Zoom 100%, Zoom Out; middle-drag to pan; Ctrl+wheel over a detail; Ctrl+middle-click. Each behaves as on a Mermaid preview, with the fading zoom percentage.
3. Zoom past 100% on a small icon. The pixels show as squares, not blurred.
4. Open a PNG with transparency. A checkerboard shows behind the transparent parts, in a dark and a light theme.
5. Right-click the picture → Copy Image. Paste into an image editor: the picture pastes.
6. Overwrite the file on disk with another image. The preview shows the new picture without reopening.
7. Open an animated GIF: it plays. Turn on the OS "reduce motion" setting and reopen it: it shows its first frame only.
8. Set **Image: Default fit** to Actual size and open an image larger than the panel. It opens at 100%.

### Negative cases
- A `.png` that is really a text file shows one notice saying it is not an image throng can show; never a blank panel or a broken-image icon.
- The body menu offers no text Copy or Select All.

## MT-22: [Media] SVG Preview beside its editor

Covers: 074 FR-040, 074 FR-041, 074 FR-042, 074 FR-045, 074 FR-046, 074 FR-047, 074 FR-048
Paths: `packages/core/src/preview/providers/svg.ts`, `packages/ui/src/renderer/preview/providers/svg/**`, `packages/ui/src/renderer/preview/blocks/picture.ts`, `packages/ui/src/renderer/preview/diagram/**`

### Steps
1. Click a `.svg` in Files & Folders. An SVG Preview draws it, fitted, with the Mermaid view controls.
2. Open the same file in an editor and press the status-bar preview button. Change a `fill` colour without saving. The preview redraws within the update delay.
3. Type a stray `<` into the source. A notice says the SVG could not be drawn; the last good drawing stays dimmed beneath it. Remove the `<`: the notice clears.
4. Run Find in Files for a word inside the SVG and open the result. The SVG Preview opens alone, focused.
5. Right-click the picture → Copy Image, and paste into an image editor.

### Negative cases
- The SVG Preview and its editor offer no Synchronise Scrolling, in menus or the status bar.

## MT-23: [Media] SVG and images in a Markdown preview

Covers: 074 FR-050, 074 FR-051, 074 FR-052, 074 FR-053, 074 FR-054, 074 FR-055, 074 FR-035, 074 SC-007
Paths: `packages/ui/src/renderer/preview/providers/markdown/framed-images.ts`, `packages/ui/src/renderer/preview/providers/markdown/markdown-body.tsx`, `packages/ui/src/renderer/preview/blocks/**`, `packages/ui/src/renderer/preview/providers/markdown/embeds.ts`

### Steps
1. Preview a Markdown file holding `![Logo](img/logo.svg)` alone on a line. The SVG draws in a frame with Fit, Zoom, Maximise and the right-click menu, as an inline Mermaid diagram has.
2. Add `![Shot](img/shot.png)` alone on a line. It is framed the same way; Copy Image from its right-click menu pastes the picture.
3. Add a fenced block with the info string `svg` holding a small `<svg>` drawing. It draws as a picture in a frame.
4. Add `![[logo.svg]]`. It draws as an embedded image.

### Negative cases
- A badge image in the middle of a sentence stays inline with its text, unframed.
- Raw `<svg>…</svg>` markup written straight into the `.md` file shows nothing.

## MT-24: [Media] PDF Preview

Covers: 074 FR-060, 074 FR-062, 074 FR-063, 074 FR-064, 074 FR-065, 074 FR-066, 074 FR-067, 074 FR-068
Paths: `packages/core/src/preview/providers/pdf.ts`, `packages/ui/src/renderer/preview/providers/pdf/**`, `packages/ui/src/renderer/navigate/go-to-dialog.tsx`, `packages/core/src/navigation/go-to-input.ts`, `packages/ui/src/main/preview-protocol.ts`, `packages/ui/src/main/preview-ipc.ts`

### Steps
1. Click a multi-page `.pdf`. A PDF Preview shows its pages one after another. The status bar reads `Page 1 of <n>`.
2. Scroll with the wheel, the scrollbar, Page Up / Page Down and Home / End. The page number follows.
3. Zoom the panel in and out. The pages redraw sharp at the new size.
4. Ctrl+click an internal link (a table of contents entry). The preview scrolls to its page. Ctrl+click a web link: the browser opens it.
5. Regenerate the PDF on disk while reading page 3. The preview reloads and stays at page 3.
6. Open a several-hundred-page PDF. The first page shows within about two seconds and scrolling never stalls the window.
7. Press Ctrl+G. The shared Go to dialog opens reading `Page 1 of <n>`. A page past the last is refused as it is typed; Enter scrolls to the page; Escape closes and focus returns to the pages.

### Negative cases
- A plain click on any link follows nothing.
- An encrypted or a truncated PDF shows one notice saying it cannot be displayed and why; no password prompt.
- The body menu offers no Copy or Select All.
- The PDF's Go to dialog looks and behaves like a CSV grid's Go to Row.

## MT-25: [Media] HTML Preview

Covers: 074 FR-070, 074 FR-071, 074 FR-072, 074 FR-073, 074 FR-079, 074 FR-081, 074 FR-082, 074 FR-083, 074 FR-084, 074 FR-086, 074 FR-087
Paths: `packages/core/src/preview/providers/html.ts`, `packages/ui/src/renderer/preview/providers/html/**`, `packages/ui/src/main/window-open-guard.ts`, `packages/ui/src/renderer/index.html`, `packages/ui/src/main/preview-protocol.ts`, `packages/ui/src/renderer/preview/providers/html/frame-input.ts`

### Steps
1. Click an `.html` file with a stylesheet and an image beside it. An HTML Preview shows the page styled, with its image.
2. Open it in an editor beside its preview and type. The preview follows the unsaved text within the update delay.
3. Ctrl+click an `https:` link in the page: the browser opens it. Ctrl+click a relative link to another project file: it opens as a link from a Markdown preview would. Click a `#section` link: the page scrolls to it.
4. Zoom the panel. The page scales.
5. Select text in the page and press Ctrl+C. Paste elsewhere: the plain text pastes.
6. Run Find in Files for a word in the HTML file and open the result. An editor opens at the match.

### Negative cases
- A plain click on a link follows nothing and the page stays.
- A page with a `<script>` shows "Scripts in this page do not run in the preview" once; dismissing it keeps it gone.
- A stylesheet referenced as `../../outside.css` from outside the project does not apply.

## MT-26: [Media] Hostile files

Covers: 074 FR-044, 074 FR-066, 074 FR-074, 074 FR-075, 074 FR-076, 074 FR-077, 074 FR-078, 074 FR-090, 074 FR-093, 074 SC-002
Paths: `packages/ui/src/renderer/preview/blocks/picture.ts`, `packages/ui/src/renderer/preview/providers/html/**`, `packages/ui/src/renderer/preview/providers/pdf/**`, `packages/ui/src/main/renderer-request-filter.ts`, `packages/core/src/preview/request-policy.ts`, `packages/ui/src/main/preview-protocol.ts`

### Steps
1. Copy `hostile.svg`, `hostile.html`, `hostile-style.css`, `hostile.pdf` and `polyglot.png` from `packages/ui/tests/fixtures/preview/` into a project. Open each from Files & Folders.
2. The SVG draws its two shapes. The HTML shows its static text. The PDF shows its page. The PNG shows a small coloured picture.

### Negative cases
- No dialog, alert, new window or navigation happens for any of them.
- With a network monitor (a dev build's devtools Network tab), nothing is requested from `hostile.invalid` or any web address.
- Keyboard focus never jumps into the HTML page on its own.

## MT-27: [Media] Size limits and provider settings

Covers: 074 FR-010, 074 FR-011, 074 FR-012, 074 FR-013, 074 FR-014, 074 FR-015, 074 SC-005
Paths: `packages/core/src/preview/providers/media-settings.ts`, `packages/core/src/config/preview-settings.ts`, `packages/core/src/config/numeric-units.ts`, `packages/ui/src/main/preview-service.ts`, `packages/ui/src/renderer/preview/preview-notice.tsx`, `packages/ui/src/main/preview-protocol.ts`

### Steps
1. In Preferences → Editor → Previews → Image, drag **Maximum file size** to 5 MB (the box reads 5,242,880). Open an image larger than 5 MB. One notice says: *This file is too large to preview: X MB (N bytes), over the 5 MB (5,242,880 bytes) limit set in Preferences.*, both sizes digit-grouped.
2. Raise the limit and press Refresh. The image shows.
3. Turn **HTML: Enabled** off. Every open HTML Preview closes and `.html` files open in an editor.
4. Turn it back on. Clicking an `.html` file opens its preview again.

### Negative cases
- While a provider is off, its other settings are drawn disabled, not hidden.
- A workbook over **Spreadsheet → Preview size limit** shows the same notice wording, in MB with its bytes.

## MT-28: [Media] HTML Preview updates in place

Covers: 074 FR-071, 074 FR-071b
Paths: `packages/ui/src/renderer/preview/providers/html/**`, `packages/ui/src/renderer/preview/providers/html/html-frame-update.ts`

### Steps
1. Open a long `.html` file in an editor and its preview beside it. Scroll the preview halfway down.
2. Type in the editor, in a paragraph near the top. The preview shows the change and stays where it was scrolled.
3. Save the file from another program (or let an agent edit it). The preview updates and stays at the same place.
4. Scroll sideways in a wide page, then edit. The horizontal position is kept too.

### Negative cases
- At no point does the panel go blank, white or flicker between the old and new page.
- Deleting most of the page while scrolled to its end leaves the preview at the new end, not past it.

## MT-29: [Media] Find in HTML and PDF previews

Covers: 074 FR-086b, 074 FR-086c, 074 FR-086a
Paths: `packages/ui/src/renderer/preview/providers/html/**`, `packages/ui/src/renderer/preview/providers/pdf/**`, `packages/ui/src/renderer/preview/preview-search.ts`, `packages/ui/src/renderer/preview/preview-search-model.ts`, `packages/ui/src/renderer/preview/highlight-registry.ts`

### Steps
1. Open an HTML Preview and press the Find chord. Type a word on the page. Every match is highlighted and the count shows.
2. Press Enter / Shift+Enter. Each match scrolls into view in turn.
3. Open a PDF of several pages. Find a word that appears only on a late page you have not scrolled to. It is found and its page scrolls into view.

### Negative cases
- No preview's find bar offers Replace.
- An Image or SVG preview still has no Find.

## MT-30: [Media] HTML page right-click menu

Covers: 074 FR-085, 074 FR-085a
Paths: `packages/ui/src/renderer/preview/providers/html/**`, `packages/ui/src/renderer/preview/content-menu.ts`, `packages/ui/src/renderer/preview/preview-panel.tsx`, `packages/ui/src/renderer/preview/copy.ts`

### Steps
1. Select some formatted text (bold, a link, a list) in an HTML Preview and right-click it. The menu offers Split, Select All, Copy, Copy as Rich Text and Find.
2. Choose Copy as Rich Text and paste into a rich-text editor (a document, an email). The formatting comes with it.
3. Choose Copy and paste into a plain editor. Plain text pastes.
4. Choose Select All, then Copy. The whole page's text is copied.
5. Choose Find. The find bar opens on the page.

### Negative cases
- A plain click on a link in the page still follows nothing.

## MT-31: [Media] Safe HTML preview sources

Covers: 074 FR-072a, 074 FR-093a, 074 FR-075, 074 FR-093
Paths: `packages/ui/src/renderer/preview/providers/html/**`, `packages/core/src/preview/request-policy.ts`, `packages/ui/src/main/renderer-request-filter.ts`, `packages/ui/src/renderer/project-settings/**`, `packages/core/src/preview/providers/html.ts`, `packages/core/src/preview/safe-sources.ts`, `packages/ui/src/main/frame-sources.ts`, `packages/ui/src/renderer/index.html`, `packages/ui/src/renderer/project-settings/project-settings-dialog.tsx`, `packages/ui/src/renderer/preferences/form-controls.tsx`, `packages/core/src/config/metadata.ts`, `packages/persistence/src/migrations/v14-project-html-safe-sources.ts`, `packages/persistence/src/migration-runner.ts`, `packages/persistence/src/schema-guard.ts`, `packages/persistence/src/project-repository.ts`

### Steps
1. Preview a page that links a Google Fonts stylesheet. The font applies with the shipped preferences.
2. Preview a page with a remote image from another site. The image is missing and one notice lists it under its source, with **Allow this source**.
3. Choose **Allow this source**. The image loads, and Project Settings now lists that source for this project.
4. The notice named the global **HTML: Safe preview sources** preference. Add a source there and open the page in another project: it loads there too.
5. Remove the source from Project Settings and reopen the page. It is left out and listed again.
6. Allow a source again, quit throng and start it again. Project Settings still lists the source, and the page loads it.

### Negative cases
- A script from a safe source does not run.
- An `http:` source is listed without **Allow this source**.
- An SVG or PDF preview loads nothing remote whatever the list says.
- Several blocked resources raise one notice, not one each.

## MT-32: [Media] Preview type icons and titles

Covers: 074 FR-103, 074 FR-104
Paths: `packages/core/src/workspace/panel-title.ts`, `packages/core/src/preview/providers/**`, `packages/core/src/icons/**`, `packages/ui/src/renderer/workspace/panel-placeholder.tsx`, `packages/ui/src/renderer/preview/**`, `packages/ui/src/renderer/workspace/use-panel-display-names.ts`, `packages/ui/src/renderer/editor/status-strip.tsx`, `packages/ui/src/renderer/editor/content-menu.ts`, `packages/ui/src/renderer/workspace/panel-header-menu.ts`, `packages/ui/src/renderer/links/link-menu.ts`, `packages/ui/src/renderer/links/file-link-menu.ts`

### Steps
1. (CSV and Spreadsheet icons and titles are tested in the [CSV] block.) Open a Markdown, a Mermaid, an image, an SVG, a PDF and an HTML file as previews side by side. Each header shows its own preview icon, all recognisably the preview icon, each with its type's mark.
2. Each title names its type: `notes.md - Markdown Preview`, `flow.mmd - Mermaid Preview`, `logo.png - Image Preview`, `drawing.svg - SVG Preview`, `datasheet.pdf - PDF Preview`, `page.html - HTML Preview`.
3. Hover the tab holding them: its popover lists each preview with its type's icon and title.
4. Open an HTML file in an editor: its status-bar preview button shows the HTML preview icon. Right-click the file in Files & Folders → Open In: the Preview row shows it too.
5. Switch theme and icon set. Each icon follows the theme.

### Negative cases
- Narrow a preview panel until its title truncates: the name shortens and ` - <Type> Preview` stays whole.

## MT-40: [Markdown] Callouts draw with their type, icon and title

Covers: 075 FR-001, 075 FR-002, 075 FR-003, 075 FR-004, 075 FR-005, 075 FR-011, 075 FR-012, 075 FR-013, 075 FR-016, 075 FR-019a, 075 FR-024, 075 SC-001, 075 SC-002
Paths: `packages/ui/src/renderer/preview/providers/markdown/callouts.ts`, `packages/ui/src/renderer/preview/providers/markdown/callout-dom.ts`, `packages/ui/src/renderer/preview/providers/markdown/callout-sanitise.ts`, `packages/ui/src/renderer/preview/providers/markdown/markdown.css`, `packages/ui/src/renderer/preview/loading-placeholder.ts`, `packages/ui/src/renderer/preview/loading-placeholder.css`, `packages/ui/src/renderer/preview/resize-freeze.ts`, `packages/ui/src/renderer/preview/diagram/diagram-block.tsx`, `packages/core/src/preview/callouts.ts`, `packages/core/src/icons/default-set/callout*.svg`

### Steps
1. Make a file `callouts.md` with one blockquote per type: `> [!note]`, `[!abstract]`, `[!info]`, `[!todo]`, `[!tip]`, `[!success]`, `[!question]`, `[!warning]`, `[!failure]`, `[!danger]`, `[!bug]`, `[!example]`, `[!quote]`, each followed by a line of body text. Open it and press **Open Preview**. Each draws as a tinted box with a coloured left edge, an icon and its type's title (Note, Abstract, …), the body below.
2. Add `> [!warning] Read this first` and a body line. The title reads "Read this first", with the warning icon.
3. Add `> [!caution]` and `> [!hint]`. They draw as Warning and Tip: an alias takes its type's colour, icon and title.
4. Add `> [!nonsense]`. It draws as a Note box titled "Nonsense".
5. Add a callout whose body holds a list, a code block, a link and a second callout nested inside it. All render inside the box; the link opens like any other.
6. Switch theme to Light, then back. The callouts recolour with the theme.

### Negative cases
- A plain `> quote` with no `[!type]` stays an ordinary blockquote.
- A ```` ```ad-note ```` fence stays a code block.
- `> [!note]` written inside a code block or a fenced block stays text.

## MT-41: [Markdown] Folding callouts

Covers: 075 FR-006, 075 FR-007, 075 FR-008, 075 FR-009, 075 FR-010, 075 FR-014, 075 SC-003
Paths: `packages/ui/src/renderer/preview/providers/markdown/callout-dom.ts`, `packages/ui/src/renderer/preview/providers/markdown/markdown-body.tsx`, `packages/ui/src/renderer/preview/node-reveal.ts`, `packages/ui/src/renderer/preview/preview-panel.tsx`, `packages/ui/src/renderer/preview/copy.ts`

### Steps
1. Write `> [!tip]- Folded` with a body line containing the word `zebra`, and `> [!tip]+ Open` with a body line. The first shows only its title with an expand chevron; the second shows its body with a collapse chevron. A callout with no sign has no chevron.
2. Click the first callout's title. It opens. Click again. It closes.
3. Press Tab until the first callout's title has the focus outline. Press Enter, then Space. It opens, then closes. Hover the chevron: "Expand callout" or "Collapse callout".
4. Open it, then type a character elsewhere in the editor. The preview re-renders and the callout stays open.
5. Close it. Press **Ctrl+F** in the preview and search `zebra`. The callout opens to show the match.
6. Use the preview menu's **Outlining › Collapse All**, then **Expand All**. Sections fold; the callouts keep their own state.
7. Select the whole preview (**Ctrl+A**) and **Copy**. Paste into an editor: no chevron or icon glyph is in the text.

### Negative cases
- Changing `[!tip]-` to `[!tip]+` in the editor makes that callout start open, whatever it was before.
- Closing and reopening the preview starts every callout from its sign.

## MT-42: [Markdown] Callout colours in the Themes editor

Covers: 075 FR-018, 075 FR-019, 075 FR-020, 075 FR-021, 075 FR-022, 075 FR-023, 075 SC-004
Paths: `packages/core/src/config/callout-colours.ts`, `packages/core/src/config/theme-metadata.ts`, `packages/core/src/config/theme-copy.ts`, `packages/core/src/config/default-themes/index.ts`, `packages/core/src/config/shipped-defaults.ts`

### Steps
1. Open **Themes**. A **Markdown preview › Callouts** area follows Editor, with seven colours (Neutral, Info, Accent, Success, Question, Warning, Danger Callout Accent).
2. Change **Warning Callout Accent** to a bright red. Warning and caution callouts in an open preview turn red at once; other types do not change.
3. Restore that colour to the theme's default. The preview returns to the shipped warning colour.
4. With an install that had a theme file from before this build, start the app. Its callouts show that theme's shipped colours, not blanks.

### Negative cases
- No callout's title, body or icon is unreadable against its box, in any shipped theme.

## MT-43: [Markdown] Typeset maths

Covers: 075 FR-040, 075 FR-041, 075 FR-042, 075 FR-043, 075 FR-043a, 075 FR-044, 075 FR-045, 075 FR-046, 075 FR-047, 075 FR-048, 075 FR-049, 075 FR-050, 075 FR-093a, 075 SC-005, 075 SC-006, 075 SC-007
Paths: `packages/ui/src/main/preview-service.ts`, `packages/ui/src/renderer/preview/preview-panel.tsx`, `packages/ui/src/renderer/preview/preview.css`, `packages/ui/src/renderer/preview/providers/markdown/math.ts`, `packages/ui/src/renderer/preview/providers/markdown/math-typeset.ts`, `packages/ui/src/renderer/preview/providers/markdown/math-dom.ts`, `packages/ui/src/renderer/preview/math-host.ts`, `packages/ui/src/renderer/preview/providers/markdown/markdown-body.tsx`, `packages/ui/src/renderer/preview/providers/markdown/markdown.css`, `packages/ui/src/renderer/preview/preview-search-model.ts`, `packages/ui/src/renderer/preview/copy.ts`, `packages/core/src/preview/math-delimiters.ts`, `packages/core/src/preview/providers/markdown.ts`

### Steps
1. Write `Area is $\pi r^2$.`, a block `$$` / `\frac{a}{b}` / `$$`, a code-span form `` $`x_1`$ `` and a ```` ```math ```` fence holding `E = mc^2`. The preview typesets all four; the block and fence are centred on their own lines.
2. Write `It costs $5 and $10.` It stays prose, with both dollar signs.
3. Write `$\frac{a$`. It shows that source in the error colour; hovering it reads "Maths error: …"; the rest of the line renders.
4. Search **Ctrl+F** for `pi`. Nothing inside the typeset equation matches.
5. Select the paragraph holding `$\pi r^2$` and **Copy as Plain Text**; paste into an editor. It reads `Area is $\pi r^2$.` **Copy as Rich Text** into a word processor shows the equation.
6. In Settings, turn off **Markdown: Typeset math**. Every expression shows as its source text; the `math` fence is a code block. Turn it back on.
7. Open `MT-04-maths-500.md` (500 inline expressions) with its preview beside it. The equations appear together within about a second, and the editor keeps up with typing and scrolling while they load.
8. Scroll the preview from top to bottom with the mouse wheel. It moves smoothly, with no stutter.
9. Type a few characters at the end of the file. The preview redraws without the equations flickering or the editor stalling.
10. Reopen `MT-04-maths-500.md`'s preview. Until they are typeset, each inline equation shows a small turning spinner in its place and each displayed one a "Typesetting equation…" line, the same spinner a Mermaid block shows beside "Drawing diagram…".
11. In a document with an image from a slow or large file, the image's place shows the same spinner until it appears.
12. Drag the splitter between the editor and the `MT-04-maths-500.md` preview back and forth. The drag keeps up with the mouse as it does beside a plain-text preview; the preview's scrollbar hides while you drag and the text reflows to the new width a moment after you stop.
13. With `MT-04-maths-500.md`'s preview open from the editor's preview button, open another `.md` file in the same editor and press its preview button. The same preview panel now shows the second file; no second preview opens. Press it again on `MT-04-maths-500.md`: still one preview.

### Negative cases
- `$\href{javascript:alert(1)}{x}$` and `$\url{https://example.com}$` show as errors or text; nothing is clickable and nothing is requested.
- A document with no maths loads no maths fonts (DevTools › Network shows no KaTeX request).
- `\$5` stays a literal dollar sign.

## MT-44: [Markdown] Print… in a preview's menus and keyboard

Covers: 075 FR-061, 075 FR-062, 075 FR-063, 075 FR-064, 075 SC-011, 075 SC-012
Paths: `packages/ui/src/renderer/preview/print/print-command.ts`, `packages/ui/src/renderer/preview/preview-commands.tsx`, `packages/ui/src/renderer/preview/content-menu.ts`, `packages/ui/src/renderer/workspace/panel-header-menu.ts`, `packages/ui/src/renderer/workspace/panel-placeholder.tsx`, `packages/ui/src/renderer/preview/preview-panel.tsx`, `packages/core/src/config/keybindings.ts`, `packages/core/src/preview/provider.ts`

### Steps
1. Open a Markdown preview. Its header menu and its right-click menu both have **Print…** with the printer icon and **Ctrl+P**.
2. Click either. Print Preview opens; nothing is sent to a printer.
3. Close it. Focus the preview and press **Ctrl+P**. Print Preview opens.
4. Open a `.mmd` preview. **Print…** is enabled there too.
5. In **Key Bindings**, find **Print…** under Navigate; rebind it to another chord. The menus show the new chord, and it works.

### Negative cases
- **Ctrl+P** in a terminal does not open Print Preview; the shell receives it. (In an editor it prints the editor: MT-61.)
- A preview whose provider cannot print shows **Print…** greyed, with the hover "This preview type cannot be printed."

## MT-45: [Markdown] Dragging beside a preview, and dialogs over a scrolled preview

Covers: 075 SC-006, 075 FR-043a, 073 FR-036a, 074 FR-062b
Paths: `packages/ui/src/renderer/preview/preview.css`, `packages/ui/src/renderer/preview/resize-freeze.ts`, `packages/ui/src/renderer/preview/providers/pdf/pdf-body.tsx`, `packages/ui/src/renderer/grid/cell-dialog.tsx`, `packages/ui/src/renderer/navigate/go-to-dialog.tsx`

### Steps
1. Open a CSV of a few hundred rows in the CSV Preview Editor and scroll halfway down. Double-click a long cell to open the cell dialog. It opens in the middle of the window, over everything, with the rest of the window dimmed.
2. Close it. Still scrolled down, press **Ctrl+G**. The Go to dialog opens near the top of the window, fully visible.
3. Open a PDF of 20 or more pages, scroll to page 10 and press **Ctrl+G**. The Go to Page dialog opens fully visible near the top of the window, not inside the panel.
4. Open a large PDF. Until its pages show, the panel shows a spinner and "Loading PDF…", the same placeholder a Markdown image or diagram shows while loading.
5. Drag the splitter beside a Markdown preview holding many equations, then beside the CSV preview and the PDF. Each drag keeps up with the mouse; the preview's scrollbar hides during the drag and comes back when you stop, at the same scroll position.
6. In the CSV Preview Editor, scrolled down, open the cell dialog again and resize the whole throng window by dragging its corner, slowly then quickly. The dialog stays whole and centred in the window throughout, never cut off at the panel's edge. Repeat with the PDF's Go to Page dialog open.

### Negative cases
- No dialog opened from inside a preview is clipped to that preview's panel or scrolls with the document.

## MT-46: [Markdown] Synchronise Scrolling past folded callouts and closed details

Covers: 075 FR-033d, 073 FR-033d, 047 FR-032a
Paths: `packages/ui/src/renderer/preview/providers/markdown/block-index.ts`, `packages/ui/src/renderer/preview/providers/markdown/sync-mark.ts`, `packages/ui/src/renderer/preview/providers/markdown/callout-dom.ts`, `packages/ui/src/renderer/preview/providers/markdown/markdown-body.tsx`

### Steps
1. Open `MT-01-callouts.md` in an editor with its preview beside it and Synchronise Scrolling on. Fold a long callout near the top of the preview (`> [!note]-` starts folded). Scroll the preview to the very top: the editor shows line 1, not the line after the callout.
2. Scroll the editor slowly down through the folded callout. The preview stays on the callout's title while the editor is inside it, then moves on to the block after it; nothing jumps.
3. With the preview gutter shown, scroll the editor into the folded callout. The sync bar sits beside the callout's title, not beside a hidden line or at the top of the preview.
4. Unfold the callout. Scrolling either side lines up again with the callout's own lines, and the bar follows them.
5. Repeat steps 1 to 4 with a closed `<details>` block, opening and closing it by its summary.

### Negative cases
- No scroll in either pane ever lands the other pane at the top of the document because a fold sits above.

## MT-47: [Markdown] A preview whose file no longer exists

Covers: 044 FR-026, 044 FR-026a, 044 US2 scenario 6, 073 *A file deleted under an open panel*
Paths: `packages/ui/src/renderer/preview/preview-panel.tsx`, `packages/ui/src/renderer/preview/preview-notice.tsx`, `packages/ui/src/main/preview-service.ts`, `packages/ui/src/main/editor-coordinator.ts`, `packages/ui/src/main/node-file-watcher.ts`

### Steps
1. Open a Markdown file's preview on its own (no editor), scroll half way down, and delete the file in the Files & Folders tree. The panel stays open and shows only "This file no longer exists." — no trace of the document. The notice offers Try again, Copy details and Clear panel type, and no way to dismiss it; the panel's own Close still works.
2. Restore the file (Undo the delete in the tree). The document shows again at the place you were reading.
3. Open a PNG, a PDF, an HTML file and a `.mmd` diagram, each in its own preview, and delete each file from a terminal (`rm`) rather than in throng. Each preview shows the same notice within a second or two.
4. Preview a file inside a folder, then rename that folder in a terminal (`mv docs docs-old`). The preview shows the notice. Rename the folder back: the document shows again.
5. Open a Markdown file in an editor and its preview beside it. Type some text without saving, then delete the file. The editor keeps your text and shows its own deleted banner; the preview shows only "This file no longer exists.". Save the editor: the file exists again and the preview shows your text.
6. In a preview showing the notice, use Last Active reuse (open another existing file's preview from the tree) or follow Back to an earlier file. That file shows in the same panel and the notice is gone.
7. Maximise a Mermaid diagram in a Markdown preview so it fills the middle section, then delete the Markdown file. The maximised diagram goes too; only the notice remains.

### Negative cases
- A CSV open in the CSV Preview Editor with an unsaved edit keeps the grid and the edit on screen when its file is deleted; saving re-creates the file. The read-only Spreadsheet Preview of an `.xlsx` shows the notice instead.
- Saving a file from an external editor that writes through a temporary file (vim, for example) never leaves the notice behind, and the preview keeps its place.

## MT-48: [Markdown] Copy and find in an HTML page that uses throng's class names

Covers: 075 FR-035, 074 FR-040
Paths: `packages/ui/src/renderer/preview/copy.ts`, `packages/ui/src/renderer/preview/find/preview-search-model.ts`

### Steps
1. Open an HTML file in its preview whose body holds `<p class="preview-loading">Loading text kept</p>` and `<span data-math-typeset>x squared</span>`. Select across both and copy; paste into an editor. Both texts are there, unchanged.
2. Press **Ctrl+F** in that preview and search for `Loading text kept`, then `x squared`. Each is found and highlighted.
3. In a Markdown preview with a diagram and an equation, select across them and copy. The paste holds the diagram's source and the equation's TeX, as before.

### Negative cases
- Copy from the HTML page never drops or rewrites the page's own text because of its class names.

## MT-60: [Print] Print Preview and printing

Covers: 075 FR-066, 075 FR-067, 075 FR-068, 075 FR-068a, 075 FR-068b, 075 FR-068c, 075 FR-068d, 075 FR-069, 075 FR-070, 075 FR-071, 075 FR-072, 075 FR-073, 075 FR-074, 075 FR-075, 075 FR-076, 075 FR-077, 075 FR-078, 075 FR-079, 075 FR-080, 075 FR-081, 075 SC-008, 075 SC-012, 075 SC-013
Paths: `packages/ui/src/renderer/print-preview/**`, `packages/ui/src/renderer/preview/pdf-library.ts`, `packages/ui/src/renderer/preview/print/**`, `packages/ui/src/main/print-*.ts`, `packages/ui/src/main/electron-print-engine.ts`, `packages/core/src/preview/print.ts`, `packages/core/src/preview/print-palette.ts`

### Steps
1. With a dark theme active, open Print Preview on a long Markdown preview holding headings, a code block with a very long line, a table, an image, a folded section, a folded callout, a Mermaid diagram and display maths. The window is modal: the main window cannot be clicked until it closes. The pages show dark text on white, the folded section and callout open, the long code line wrapping, the diagram as wide as the text, no fold chevrons or diagram buttons. One page shows at a time, whole, with "Page 1 of N" above it between a greyed **Back** and an enabled **Forward**. Until that page is ready a spinner shows; the page then appears once, at its final size, with no jump.
1a. Press **Forward** until the last page. Each press shows the next page alone and counts up; on the last page **Forward** greys. Press **Back** once: the page before shows and **Forward** is enabled again. No page change jitters: the old page stays until the new one replaces it at the same size.
1b. Over the page, roll the mouse wheel down one notch, then up one notch. Each notch moves one page.
1c. Press **Right**, **Down** and **Page Down**: each shows the next page. Press **Left**, **Up** and **Page Up**: each shows the page before. **End** shows the last page and **Home** the first.
1d. Click into **Copies** and press **Up**: the number changes and the page does not. Click into the page range box and press **End**: the caret moves and the page does not.
1e. Open Print Preview on `MT-04-maths-500.md`. The first page appears within a couple of seconds, and each page change is immediate.
1f. Resize the Print Preview window. The page refits to the new size.
1g. Click another application's window. Print Preview stays in front of it.
1h. Set Margins to Custom, untick Fit to page width, set Scale to Custom and Pages to a range, then shrink the window as small as it goes. Every setting stays visible and the settings pane shows no scrollbar in either direction.
1i. In a dark theme, open Print Preview. The page is white edge to edge, with a dashed outline where the margins are.
1j. Set Margins to Custom. The four margin boxes sit round a small white page, one at each edge, each followed by "mm". Change one; the dashed outline moves to match.
1k. Untick Fit to page width. Scale offers 25 % to 200 % and Custom; choose 150 % and the page relays out; choose Custom and type 137 into the box that appears.
1l. Type "abc" into Copies and wait a moment. The box is outlined red and Print is disabled; type 2 and both clear.
1m. The title bar shows Close only — no maximise or restore.
1n. Add a printer in the OS's printer settings while Print Preview is open. Within a few seconds it appears in the Printer list.
1o. Print `MT-01-callouts.md` with Pages set to 1. One page prints, matching the preview exactly; print all pages and compare each sheet with its preview page — same breaks, nothing lost between pages.
2. Change paper to Letter, orientation to Landscape, margins to Minimum. Within two seconds of each change the pages lay out again, with "Laying out pages…" meanwhile.
3. Untick **Fit to page width**, set Scale to 50. The pages shrink. Set Pages to `1` and confirm only page 1 is shown, as "Page 1 of 1" with **Back** and **Forward** both greyed. Set Pages to `2, 4`: **Forward** steps from document page 2 to document page 4, reading "Page 2 of 2".
4. Choose a real printer, Copies 2, and press **Print**. The window closes and two copies of page 1 print, landscape, Letter, with no OS print dialog.
5. Open Print Preview again. Printer, paper, orientation, margins, scale and copies are as last set; Pages is back to All.
6. Quit and relaunch throng; open Print Preview. The same settings are still there.
7. Press **Ctrl+P** again in the main window while Print Preview is open. No second window opens; the open one comes to the front.
8. Open Print Preview on a `.mmd` file. The diagram fills one page.
9. Press Escape. The window closes and nothing prints.
10. Type an unsaved line into the editor of a parented preview, then open Print Preview. The pages include the unsaved line.
11. Tear a preview off into a sub-workspace window and open Print Preview from there. It opens modal to that window and lays out the pages.

### Negative cases
- With no printer installed, Print Preview reads "No printer is available." and **Print** is greyed; the pages still show.
- With the printer turned off or unplugged, **Print** shows one inline "Printing failed: …" notice and the window stays open; **Print** again retries.
- A page break never splits a heading from its first paragraph, a code block, a table row, a callout, the diagram, an image or a display equation.
- A remote image the preview showed prints; one blocked by **Load remote images** off prints as its alt text, and nothing new is requested.
- On page 3 of a document, change orientation so it lays out to fewer than 3 pages: the last page shows, and the count matches.
- Pages typed as `3-1` show a hint and do not lay out; **Print** stays greyed.

## MT-61: [Print] Printing an editor

Covers: 075 FR-064a
Paths: `packages/ui/src/renderer/print/text-printable.ts`, `packages/ui/src/renderer/editor/editor-print.ts`, `packages/ui/src/renderer/editor/editor-chrome.tsx`, `packages/ui/src/renderer/workspace/panel-header-menu.ts`, `packages/ui/src/renderer/workspace/panel-placeholder.tsx`, `packages/core/src/config/keybindings.ts`, `packages/core/src/config/keybindings-metadata.ts`

### Steps
1. Open a `.ts` file in an editor and type a line without saving. Its header menu has **Print…** with the printer icon and **Ctrl+P**.
2. Click it. Print Preview opens with the whole file, your unsaved line included, in the editor's font, coloured as code on white paper, long lines wrapped.
3. Close it. Focus the editor and press **Ctrl+P**. Print Preview opens again.
4. Open a `.txt` file and print it. It shows as plain text, whitespace kept.
5. Print a page range and compare the paper with the preview, as MT-60 step 1o.

### Negative cases
- A terminal's header menu has no **Print…**, and **Ctrl+P** in a terminal reaches the shell.

## MT-62: [Print] Print… across every preview type

Covers: 075 FR-060, 075 FR-061, 075 FR-062, 075 FR-063, 075 FR-064
Paths: `packages/core/src/preview/provider.ts`, `packages/core/src/preview/providers/*.ts`, `packages/ui/src/renderer/preview/providers/*/view.ts`, `packages/ui/src/renderer/preview/print/print-command.ts`, `packages/ui/src/renderer/preview/content-menu.ts`, `packages/ui/src/renderer/workspace/panel-header-menu.ts`

### Steps
1. Open a `.mmd` preview and choose **Print…** from its header menu. Print Preview shows the diagram fitted to one page; print it and the paper matches.
2. Open, one at a time, a CSV, an `.xlsx` workbook, a PNG, an SVG, a PDF and an HTML file in their previews. Each preview's header menu and right-click menu show **Print…** greyed, with the hover "This preview type cannot be printed."
3. In each of those previews press **Ctrl+P**. Nothing opens: no Print Preview, and no browser print dialog.
4. Open the Panels list of a tab holding one of each preview type. Every row offers **Print…** the same way its panel's menu does: enabled for Markdown and Mermaid, greyed for the rest.

### Negative cases
- Ctrl+P in a CSV cell being edited types nothing and opens nothing.

## MT-63: [Print] What prints from a Markdown preview

Covers: 075 FR-066, 075 FR-068
Paths: `packages/ui/src/renderer/preview/print/printable.ts`, `packages/ui/src/renderer/preview/sync-mark-classes.ts`, `packages/ui/src/renderer/preview/diagram/rasterise.ts`

### Steps
1. With the preview gutter shown and Synchronise Scrolling on, scroll the editor so the sync bar shows beside a block in the preview, then open Print Preview. No sync bar shows on any page.
2. Print Preview a Markdown file holding a ` ```svg ` fenced block. The picture shows on the page, not a blank box; print it and the paper matches.
3. Turn on the OS's reduced-motion setting, open a Markdown file that embeds an animated GIF or SVG, and open Print Preview. The picture shows as a still image on the page.

### Negative cases
- No printed page carries throng's own screen furniture: no sync bar, fold chevron or diagram button.

## MT-80: [Settings] A size in MB on the slider, exactly in bytes in the box

Covers: 077 FR-001, 077 FR-003, 077 FR-004, 077 FR-006, 077 FR-007
Paths: `packages/ui/src/renderer/preferences/form-controls.tsx`, `packages/core/src/config/numeric-units.ts`, `packages/core/src/config/settings-metadata.ts`, `packages/ui/src/renderer/preferences/preferences.css`

### Steps
1. Open Preferences → Editor and find **Max open file size**. Beside the slider it reads `10 MB`; the box reads `10,485,760`.
2. Drag the slider. It moves in 5 MB steps; the value beside it and the box change together (`15 MB`, `15,728,640`).
3. Type `10,000,000` in the box and press Enter. The value beside the slider reads `9.54 MB` and the slider turns grey.
4. Drag the grey slider. It moves, lands on a 5 MB step, and is no longer grey.
5. Look at Logging → **Log file size** and **Log folder limit**, and a preview's **Maximum file size**. Each shows MB beside its slider and bytes in its box.

### Negative cases
- No label ends in a unit such as `(MB)` or `(ms)`.
- The box never shows MB, and the value beside the slider never shows bytes.

## MT-81: [Settings] Durations shown in their unit

Covers: 077 FR-001, 077 FR-004, 077 FR-005
Paths: `packages/ui/src/renderer/preferences/form-controls.tsx`, `packages/core/src/config/numeric-units.ts`, `packages/core/src/config/settings-metadata.ts`

### Steps
1. Open Preferences → Editor → Previews. **Preview update delay** reads `300 ms`; **Scroll-sync highlight duration** reads `1.5 s`, its box `1,500`.
2. Open Behaviour. **Submenu hover delay** reads in ms and steps by 25 ms.
3. Open Resource Monitor. **Capture interval** reads `2 s` (box `2,000`); **History window** reads `5 min` (box `300,000`).
4. Open Terminals → Attention. **Quiet time** reads `10 s`, its box `10,000`.
5. Drag each slider. The value beside it stays in its unit and the box in milliseconds.

### Negative cases
- No duration shows seconds in its box.

## MT-82: [Settings] Typing a value past a limit, or no number

Covers: 077 FR-008, 077 FR-009, 077 FR-010, 077 FR-011, 040 FR-007
Paths: `packages/ui/src/renderer/preferences/form-controls.tsx`, `packages/core/src/config/numeric-units.ts`, `packages/core/src/config/settings-metadata.ts`

### Steps
1. In Editor → **Max open file size**, clear the box and type `9,999,999,999`. As you type, a message under the box reads `Up to 2,147,483,648 bytes`.
2. Press Enter. The box reads `2,147,483,648`, the message goes, and the value beside the slider reads `2,048 MB`.
3. In Behaviour → **Submenu hover delay**, type `20000` and press Tab. The box reads `10,000`.
4. Type `abc` in any number box. The message reads `Not a whole number`. Press Enter: the text and the message stay, and nothing is saved.
5. Press Esc. The box shows the saved value again and the message goes.
6. Clear a box completely. No message shows until you press Enter.

### Negative cases
- Folding the section while `abc` is in a box keeps it, with its warning marker, for when the section unfolds.
- A value stored past a limit is never written to settings.json: check the JSON tab after step 2.

## MT-83: [Settings] A v1.0.0-beta1 settings file after upgrading

Covers: 077 FR-001, 077 FR-002
Paths: `packages/core/src/config/shipped-defaults.ts`, `packages/ui/src/main/shipped-defaults-service.ts`

### Setup
Quit throng. In the config folder ([Where the files live](../../docs/preferences.md#where-the-files-live)), set `defaults-state.json` to `{ "version": 36 }`. In `settings.json`, delete the keys `terminals.attention.quietMs`, `resourceMonitor.captureIntervalMs`, `resourceMonitor.historyMs`, `diagnostics.maxFileBytes` and `diagnostics.maxTotalBytes` if present, and add the old ones: `"terminals": { "attention": { "quietSeconds": 30 } }`, `"resourceMonitor": { "captureIntervalSeconds": 5, "historyMinutes": 10 }`, `"diagnostics": { "maxFileSizeKb": 2048, "maxTotalMb": 300 }`, merged into the sections already there.

### Steps
1. Start throng and open Preferences. **Quiet time** reads `30 s`; **Capture interval** `5 s`; **History window** `10 min`; **Log file size** `2 MB`; **Log folder limit** `300 MB`.
2. Open the JSON tab. The new keys hold `30000`, `5000`, `600000`, `2097152` and `314572800`; the old keys are gone.
3. Quit and start throng again. The values are unchanged.

### Negative cases
- **Days of logs kept** still reads in days and was not converted.
- No notice about the upgrade appears.

## MT-84: [Settings] Too-large notices quote the limit as Preferences shows it

Covers: 077 FR-014, 077 FR-015
Paths: `packages/ui/src/renderer/preview/preview-notice.tsx`, `packages/core/src/editor/drop.ts`, `packages/core/src/config/numeric-units.ts`

### Steps
1. Set Editor → **Max open file size** to 5 MB. Drag a text file larger than 5 MB from the system file manager onto an editor. The refusal reads *File is too large to open: X MB (N bytes), over the 5 MB (5,242,880 bytes) limit set in Preferences.*
2. Set a PDF preview's **Maximum file size** to 5 MB and open a larger PDF. The notice quotes the limit the same way: `5 MB (5,242,880 bytes)`.
3. Type an exact value such as `6,000,000` into the PDF limit and reopen the PDF. The notice quotes `5.72 MB (6,000,000 bytes)`, the value you set.

### Negative cases
- No notice quotes a limit you did not set (a default or a rounded figure).

## MT-85: [Settings] The Resource Monitor interval menu matches Preferences

Covers: 077 FR-016, 077 FR-017
Paths: `packages/ui/src/renderer/resources/toolbar.tsx`, `packages/core/src/resources/settings-resolution.ts`

### Steps
1. In Preferences → Resource Monitor, set **History window** to 5 min and **Capture interval** to 7 s.
2. Open the Resource Monitor. **Capture every** shows `7`; its list offers every second from 2 to 60.
3. Set **History window** to 30 min. The menu now starts at 30 and shows 30, and Preferences notes the interval in force beside the field.
4. Choose 45 in the menu. Preferences' **Capture interval** reads `45 s`.

### Negative cases
- The capture interval's description quotes no table of history bands.

## MT-86: [Settings] Print dialog numbers name their limits

Covers: 077 FR-020
Paths: `packages/ui/src/renderer/print-preview/number-field.tsx`, `packages/ui/src/renderer/print-preview/print-preview-app.tsx`, `packages/ui/src/renderer/print-preview/print-preview.css`, `packages/core/src/preview/print.ts`

### Steps
1. Open a Markdown preview and choose **Print…**. Type `150` in **Copies** and pause. A message beside it reads `Up to 99 copies` and the box is outlined red; **Print** is disabled.
2. Press Tab. The box reads `99` and the message goes.
3. Choose Scale → Custom and press ArrowUp in its box. It goes up by 5.
4. Choose Margins → Custom, type `70` in the left margin and pause. `Up to 50 mm` hangs below the box without moving the page drawing. Press Enter: it reads `50`.
5. Type `abc` in **Copies** and press Tab. The text stays with `Not a whole number`, and **Print** stays disabled until you put it right.

### Negative cases
- Pausing while typing never changes what you typed; only leaving the box or Enter does.
- ArrowUp at 99 copies stays at 99.

## MT-100: [General] One Last Active preview across preview types

Covers: 075 FR-093a, 073 FR-060e, 047 FR-012, 073 T035
Paths: `packages/ui/src/main/preview-service.ts`, `packages/ui/src/renderer/preview/open-preview.ts`, `packages/core/src/preview/wire-types.ts`

### Steps
1. In Preferences › Previews, set "Markdown: Open previews in", "CSV: Open previews in" and "PDF: Open previews in" to Last Active. Open a project holding two `.md`, two `.csv` and two `.pdf` files.
2. Open the first `.md` in a preview, then the second. The second replaces the first in the same preview panel; no second preview panel appears.
3. Do the same with the two `.csv` files, then the two `.pdf` files. Each type reuses its own last preview panel the same way.
4. Open the `.md` in an editor, then press its status-bar preview button. The existing preview panel shows the Markdown; no new panel opens beside the editor.
5. Edit a cell in the CSV preview without saving, then open the `.md` from the File Explorer. A prompt asks to save, discard or open a new panel. Choose **New**: the Markdown opens in a new panel and the CSV, still unsaved, stays where it was.

### Negative cases
- With "Markdown: Open previews in" set to New Panel, step 2 opens a second panel instead.
- Choosing **Save** or **Discard** in step 5 never loses the edit silently: Save writes it, Discard drops it, and the panel then shows the Markdown.

## MT-101: [General] Preview titles and icons for all eight types

Covers: 074 FR-103, 074 FR-104, 074 FR-103a, 074 FR-104a
Paths: `packages/core/src/workspace/panel-title.ts`, `packages/core/src/icons/icon-keys.ts`, `packages/core/src/preview/providers/**`

### Steps
1. Open one preview each of a `.md`, `.mmd`, `.csv`, `.xlsx`, `.png`, `.svg`, `.pdf` and `.html`, in separate panels.
2. Each panel title reads `<file> - <Type> Preview`: Markdown, Mermaid, CSV, Spreadsheet, Image, SVG, PDF and HTML.
3. Hover each tab to show its popover. Each preview shows its own type icon, and no two types share one.
4. Open the tab's Panels list. Each preview row shows the same icon and title as its panel.
5. Switch to another theme and repeat step 3. The icons redraw in the new theme's colours.

### Negative cases
- No title reads plain `<file> - Preview`.

## MT-102: [General] One Go to dialog for lines, rows, pages and headings

Covers: 073 FR-043a, 074 FR-062b
Paths: `packages/ui/src/renderer/navigate/go-to-dialog.tsx`, `packages/core/src/navigation/go-to-input.ts`, `packages/ui/src/renderer/preview/providers/pdf/**`, `packages/core/src/config/keybindings-metadata.ts`

### Steps
1. In a text editor, press Ctrl+G. A Go to dialog asks for a line; type a line number and press Enter. The caret moves there.
2. In a CSV preview, press Ctrl+G. The same dialog, drawn the same way, asks for a row. Enter a row; the grid scrolls to it and selects it.
3. In a PDF preview, press Ctrl+G. The same dialog asks for a page and shows "Page n of m". Enter a page; the view moves to it.
4. In a Markdown preview, press Ctrl+G. The heading picker opens.
5. Scroll each preview well down before pressing Ctrl+G. The dialog is centred in the window, not inside or clipped by the preview.
6. Open Preferences › Key Bindings and find the Go to binding. Its label reads "Go to Heading, Page or Row…".

### Negative cases
- Typing a number past the end (row, line or page) shows the dialog's message and does not move.
- The dialog's default action (Go) is drawn in the Confirm button colour; Cancel is not.

## MT-103: [General] Print… shown everywhere, enabled only where it prints

Covers: 075 FR-062, 075 FR-063
Paths: `packages/ui/src/renderer/workspace/panel-header-menu.ts`, `packages/ui/src/renderer/workspace/panel-placeholder.tsx`, `packages/ui/src/renderer/preview/content-menu.ts`, `packages/ui/src/renderer/grid/**`

### Steps
1. Open a Markdown and a Mermaid preview. Each one's header menu and body right-click menu offer Print…, enabled. Ctrl+P opens Print Preview.
2. Open a CSV, a spreadsheet, an image, an SVG, a PDF and an HTML preview. In each, the header menu and the body right-click menu (in a grid: cell, row-number and column-letter menus) show Print… greyed out, with a tooltip saying why.
3. In each of those six, press Ctrl+P. Nothing opens.

### Negative cases
- Print… is never missing from any preview menu; it is greyed, not hidden.

## MT-104: [General] The middle mouse button never pastes

Covers: 073 FR-008g, 073 FR-008f, 073 FR-036e
Paths: `packages/ui/src/renderer/common/no-middle-paste.ts`, `packages/ui/src/renderer/main.tsx`, `packages/ui/src/renderer/preview/providers/html/frame-input.ts`, `packages/ui/src/renderer/grid/**`, `packages/ui/src/renderer/preview/middle-drag-scroll.ts`, `packages/ui/src/renderer/preview/diagram/**`

### Steps
1. On Linux, select a word in another app (the primary selection) and copy a different word (the clipboard).
2. Open a text file in the editor, click into its text, then middle-click in it. Nothing is pasted and the caret does not move.
3. Open a CSV in the CSV Preview Editor. Middle-click a cell, then open a cell's in-place editor and middle-click in it. Nothing is pasted.
4. Double-click a long or multi-line cell to open the cell dialog and middle-click in its text. Nothing is pasted. Press Ctrl+V: the clipboard pastes.
5. In the file tree, press F2 on a file to rename it and middle-click in the name box. Nothing is pasted. Press Escape.
6. Open Preferences, click into a number box (a size or duration setting), and middle-click in it. Nothing is pasted.
7. Open Print Preview from a Markdown preview (Ctrl+P), click into the page range or copies field, and middle-click in it. Nothing is pasted.
8. Open a terminal and middle-click in it. Nothing is pasted at the prompt.
9. Open an HTML preview of a page with a text box, click into the text box, and middle-click it. Nothing is pasted.
10. Hold the middle button over a Mermaid diagram and drag: the diagram pans with the move cursor. Do the same in a PDF preview: the pages scroll with the pointer.
11. Ctrl+middle-click a panel that is zoomed in: its zoom resets to 100%, and nothing is pasted.

### Negative cases
- No middle-click anywhere in throng starts Chromium's autoscroll (the round scroll icon).
- A Ctrl+V straight after a middle-click still pastes.

## MT-105: [General] Open files in and Open previews in, both ways

Covers: 075 FR-093b, 075 FR-093a, 023 FR-026, 047 FR-010, 044 FR-015c
Paths: `packages/ui/src/renderer/preview/open-in-editor.ts`, `packages/ui/src/renderer/editor/editor-open.tsx`, `packages/ui/src/renderer/workspace/panel-body.tsx`, `packages/ui/src/renderer/workspace/panel-placeholder.tsx`, `packages/ui/src/renderer/preview/open-preview.ts`, `packages/ui/src/renderer/preview/preview-commands.tsx`

### Steps
1. In Preferences set **Open files in** to **Last Active Editor**. In one tab open `other.txt` in an editor and click into it. Open a Markdown file's preview from the Files & Folders tree (Open In → New Preview Panel), then press the preview's **Open in Editor** status-bar button. The Markdown file opens in the `other.txt` editor; no new panel appears, and the preview now shows **Go to Editor**.
2. Repeat step 1 with a CSV file (its preview's header menu → Open in Editor) and with an HTML file (its preview's right-click menu → Open in Editor). Each opens in the last active editor, with no new panel.
3. Repeat step 1 with unsaved changes in the `other.txt` editor. throng asks about the unsaved changes before replacing it; Cancel leaves everything as it was.
4. Set **Open files in** to **New Editor** and repeat steps 1 and 2. Each time a new editor opens immediately to the left of the preview, and `other.txt` stays in its editor.
5. With **Last Active Editor** again, open a Markdown preview in a tab holding no editor and press Open in Editor. A new editor opens to the left of the preview.
6. Set the Markdown provider's **Open previews in** to **Last Active**. Open two Markdown files in two editors in one tab. Press the first editor's preview button, then the second's. The second press reuses the first preview, which now shows the second file.
7. Set Markdown's **Open previews in** to **New** and repeat step 6. The second press opens a second preview beside the second editor.
8. Repeat steps 6 and 7 with two CSV files (the CSV provider's Open previews in) and with two HTML files (the HTML provider's). Each follows its own provider's setting.

### Negative cases
- A file already open in an editor anywhere is focused there, whichever **Open files in** says; it is never opened twice.
- A CSV Preview Editor is never chosen as the "last active editor" an Open in Editor reuses.
- A preview's **Go to Editor** (when it already has an editor) only focuses that editor, under either setting.
