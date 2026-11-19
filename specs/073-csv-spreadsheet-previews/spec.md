# Feature Specification: CSV Grid and Spreadsheet Previews

**Feature Branch**: `feature/S073-I605-csv-spreadsheet-previews`

**Created**: 2026-11-18

**Status**: Clarified

**Issues**: closes [#605](https://github.com/Bidthedog/throng/issues/605) (CSV preview as a spreadsheet
grid), [#323](https://github.com/Bidthedog/throng/issues/323) (read and edit a `.csv` as a grid) and
[#604](https://github.com/Bidthedog/throng/issues/604) (Excel and OpenDocument spreadsheet previews). All
three are maintainer-agreed and in milestone v1.0.0. Related: [#388](https://github.com/Bidthedog/throng/issues/388)
(PDF preview, the other binary provider), [#603](https://github.com/Bidthedog/throng/issues/603)
(word-processor sibling with the same open-format floor), [#484](https://github.com/Bidthedog/throng/issues/484)
(printing, out of scope). Sibling: **074** (image, SVG, PDF and HTML previews), which owns the
per-preview-type **Open … in** preference this feature consumes.

**Input**: The three issues as written, plus the maintainer's agreement comment on #323: *"a grid view
and the plain-text view of the same file, a user-set default for which opens, a free switch per open
document, cell/row selection and clipboard, row and column insertion before or after, per-file column
widths, horizontal scroll, and every text value quoted and escaped on save. Explicitly out of scope and
to stay out: sorting, filtering, formulas, cell types, formatting, frozen panes."* — and the maintainer's
clarification round of 2026-11-18 (below), which moves the editable grid into the CSV preview and
replaces "every text value quoted" with a minimal-change write.

This feature builds on **044** (file previews, #10), **047** (Markdown preview enhancements), **054**
(Markdown previews) and **074** (the Open-in preference). Every requirement of theirs not named below
stands unchanged.

---

## Clarifications

### Session 2026-11-18

- Q1: Where does #323's editable grid live? → A: In the CSV **preview** panel, not in the text editor. If
  the user can edit a CSV in throng's preview they do not need the text view at the same time, so the
  editable grid **is** the CSV's preview — the **CSV Preview Editor**, offered as "Throng Preview
  Editor". The text editor gains no grid mode and no view switch.
- Q2: How does the user choose what opens, and what ships? → A: One preference, **Open CSVs in**, with
  **Throng Editor**, **Throng Preview Editor** and **Default OS Program**; Throng Preview Editor ships.
  It is the CSV provider's instance of 074's per-preview-type Open-in preference
  (`editor.previews.providers.csv.defaultOpenAction`, values `editor` / `preview` / `os`).
- Q3: When does a save rewrite the file? → A: The grid is an editor. Nothing is written to disk until the
  user saves, unless Auto Save is on in Preferences. The grid and the text editor behave the same way for
  dirty state, save, auto save, undo and close-with-unsaved-changes. A save writes **minimal-change CSV**:
  records and fields the user did not change keep their original bytes exactly (quoting, line endings,
  delimiter); an edited field is written with quotes only where the format requires them.
- Q4: Which library reads workbooks, and which formats ship? → A: The requirement is "support all common
  spreadsheet formats". **SheetJS Community Edition 0.20.3** (Apache-2.0), installed from the SheetJS CDN
  tarball, not the abandoned npm `xlsx` 0.18.5 (CVE-2023-30533, CVE-2024-22363). At least `.xlsx`,
  `.xlsm`, `.xlsb`, `.xls`, `.ods`, `.fods` and `.numbers` ship.
- Q5: What does opening a workbook do? → A: A preference, **Open spreadsheets in**, with **Throng
  Preview** and **Default OS Program**; Throng Preview ships. Throng Preview is a dedicated read-only
  spreadsheet preview panel built in this feature.

### Session 2026-11-19

From the maintainer's manual testing (MT-01, MT-02, MT-04). Answers marked *(derived)* were settled from
the feedback, the code and precedent rather than stated by the maintainer.

- Q6: Can a column be fitted to its content? → A: Yes. Double-clicking a column header, or its resize
  edge, sets the column to the width of its widest value, header label included, within the 40–2000 px
  limits, stored as FR-040 stores any width. Double-clicking it again puts back the width it had before
  the fit. Both grids. (FR-011)
- Q7: Can a row be expanded to show its content? → A: Yes. Double-clicking a row header expands the row
  so every cell shows its full value, line breaks honoured and wrapped within its column's width; the row
  is as tall as its tallest cell. Double-clicking it again collapses it to one line. *(derived)* An
  expanded row is at most 20 lines tall, and a cell taller than that scrolls inside itself; expansion
  lasts for the life of the panel and is not persisted, because row indexes shift as rows are inserted.
  Both grids. (FR-012, refining FR-004 for an expanded row) *(Superseded by Q24: there is no row expand.)*
- Q8: What does double-clicking a cell do? → A: In the CSV Preview Editor it opens the in-cell editor
  with the cell's whole text selected. While the editor is open, the arrow keys, Home and End move the
  caret within the text, *(derived)* Ctrl+Home and Ctrl+End move it to the start and end of the text,
  and none of them moves the active cell. Typing, F2 and Enter open the editor as before. (FR-043)
- Q9: How smooth must scrolling be? → A: Horizontal scrolling must not lag. *(derived)* Scrolling either
  way across a 100,000-row by 50-column grid runs no main-thread task over 50 ms and shows no blank cell
  area at ordinary wheel or trackpad speed. (SC-009)
- Q10: CSV previews reuse the Last Preview Panel like Markdown previews (MT-06 defect, FR-060). What
  happens to a CSV Preview Editor holding unsaved edits when another CSV opens? → A: *(derived)* It is
  not reused: the other CSV opens in a new panel, and the unsaved edits stay on screen, as an editor tab
  with unsaved changes is never replaced. Once saved, the panel is reused again. (FR-033a)
- Q11: Which right-click menus offer the clipboard? → A: Every one: a cell, a row header, a column header
  and a selection all offer **Cut**, **Copy** and **Paste** (Copy only in the read-only spreadsheet
  preview). *(derived)* Cutting whole columns clears their values; it does not remove the columns, since
  deleting a column is outside #323's agreed list. (FR-037e)
- Q12: Where does a paste land when cells are selected? → A: Over the selection: it overwrites the selected
  values, starting at the selection's top-left cell (column A for whole rows), never after it.
  *(derived)* A single value pasted onto a larger selection fills every selected cell. (FR-037f, refining
  FR-037c)
- Q13: Can a header's size be reset? → A: Yes. A column header's right-click menu offers **Reset Size**,
  putting the column back to the default width and forgetting its stored width. *(derived)* A row
  header's menu offers it too, collapsing an expanded row to one line. Both grids. (FR-006a)
- Q14: Does selecting scroll the grid? → A: No. Selecting with the pointer — a column letter, a row number,
  a cell, a drag or a right-click — never scrolls; the reported fault was a column click jumping to the
  file's last row. Only keyboard movement brings the active cell into view. *(derived)* A selected
  column's active cell is its top row, so the next arrow key moves from there. (FR-008a)
- Q15: Does the CSV Preview Editor get Save and Save As like an editor? → A: Yes: the Save and Save As icons in
  its title bar, as an editor panel has them (067 FR-069 – FR-074), and Save As on its right-click menu and
  chord. *(derived)* Save As writes through the editor's one save path and the preview follows the file to
  its new location. This supersedes the Assumption that Save As is reached only from a text editor. (FR-035a)
- Q16: Can copied rows or columns be inserted, not pasted over? → A: Yes. With whole rows or columns on the
  clipboard, the row and column menus offer inserting them above or below (left or right of) the clicked
  header, alongside the blank Insert Row / Insert Column items, which stay. *(derived)* "On the clipboard"
  means the clipboard still holds the whole rows or columns this grid (any CSV grid) last copied or cut;
  the items are named **Insert Copied Rows Above** / **Below** and **Insert Copied Columns Left** /
  **Right**, and one insertion is one undo step. (FR-038a)
- Q17: How are long cells (long strings, JSON) edited? → A: In a modal dialog holding an editor, which allows
  line breaks. Double-click, F2 and Enter on a cell whose value is longer than a threshold open the dialog
  instead of the in-cell editor; typing a character still replaces the cell in place. Every cell's menu
  offers **Edit in Dialog…**, whatever its length. A value that is a JSON object or array opens
  pretty-printed; saving flattens it, each line break with the indentation after it becoming one space.
  Any other text is flattened by turning each line break into one space, indentation kept. Two CSV
  settings: the dialog on or off (ships on), and the threshold in characters (ships **50**).
  *(derived)* Saving a dialog whose text is unchanged writes nothing; the dialog's save is one undo step;
  Esc cancels. (FR-036a, FR-060a)
- Q18: Can the cell dialog be switched off completely, and per panel? → A: Yes. With the setting off there is
  no cell dialog at all, the **Edit in Dialog…** menu item included (this replaces Q17's "whatever the
  setting" for the menu item). A toggle at the bottom right of the CSV Preview Editor's status bar turns
  the dialog on or off for that panel alone. *(derived)* A panel whose toggle was never used follows the
  setting, as 076's terminal toggles follow theirs; a used toggle is saved with the panel and survives a
  restart; the toggle is keyboard-reachable and shows its state. (FR-036b)
- Q19: What is Reset Size called? → A: **Reset Column Width** on a column header. *(derived)* **Reset Row
  Height** on a row header. The behaviour is unchanged; this supersedes Q13's and FR-006a's item name.
  (FR-006b)
- Q20: Do the grid's menu items carry icons? → A: Yes, every item where an icon makes sense, as the File
  Explorer's menus do. *(derived)* Icons are themeable icon keys, an existing key reused where one fits
  (Cut, Copy, Paste, Save, Save As, Select All, Edit in Dialog) and a new drawn key otherwise; an item with no
  sensible picture (Column Width…) keeps the empty icon column. (FR-037g)
- Q21: What does Ctrl+G do in a CSV preview? → A: It opens the same **Go to** dialog the PDF preview opens
  for pages (074 FR-062b), here for rows, and the editor's Go to Line becomes the same dialog with the same
  features. The dialog is one shared component. *(derived)* Its features, for every user: it names where
  the user is and how far the document goes ("Row 3 of 120", "Line 3 of 120", "Page 3 of 120", digit-grouped);
  its field takes only a whole number from 1 to that count, refusing any other keystroke; Enter goes there
  and closes it; Escape or a click outside closes it; focus returns to what it was opened over. In a CSV
  (and a workbook sheet) **Go to Row…** is also on the cell and row menus; Enter moves the active cell to
  that row in the active column and scrolls the row to the top. Go to Line keeps its remembered number
  (033 FR-057 – FR-061), the seed clamped into range. (FR-043a, FR-043b)
- Q22: What does the corner cell above the row numbers do? → A: Clicking it selects every row and column, as
  Select All does. *(derived)* It never scrolls (FR-008a); it is a named control ("Select all") with a pointer
  cursor; right-clicking it selects everything and opens the selection's menu. Both grids. (FR-008b)
- Q23: Should a row number's menu offer Select Row? → A: No — clicking or right-clicking the row number has
  already selected the row, so the item is removed. *(derived)* The column letter's **Select Column** goes for the
  same reason. Both grids. Supersedes scenario 20's "Select Row / Column". (FR-037h)
- Q24: How are long values shown, and is there a row resize? → A: A cell either fits (column auto-fit,
  FR-011), wraps, or truncates. A **Wrap** toggle in the CSV Preview Editor's status bar, off by default,
  wraps every cell so each shows its whole value, line breaks honoured, rows as tall as their tallest cell; a
  CSV setting sets the default. There is no row resize: row expand on a row-number double-click and **Reset
  Row Height** go. *(derived)* The setting is **Wrap cells** (ships off); the toggle is per panel, saved with
  the panel, an untouched panel following the setting (as FR-036b); a wrapped row has no line cap; the
  toggle is keyboard-reachable and shows its state; Wrap is on the panel menu too. CSV only: a workbook
  preview fits or truncates. (FR-013, FR-012a, FR-006c, FR-060b)
- Q25: Which cells open in the dialog? → A: Any cell holding a line break, as well as any longer than the
  threshold. *(derived)* Only while the dialog is available for the panel (FR-036b); typing still edits in
  place. (FR-036c, refining FR-036a)
- Q26: Can multi-line cells be kept out of the dialog? → A: Yes, by a CSV setting, on by default. *(derived)*
  **Edit multi-line cells in a dialog**; off, a cell holding a line break opens in the dialog only when it is
  also longer than the threshold. (FR-060c)
- Q27: Does the pointer show that a header selects? → A: Yes. Over a row number, a column letter or the
  corner, the pointer changes to say clicking selects it. *(derived)* A row number shows a right-pointing
  arrow, a column letter a down-pointing arrow, and the corner a diagonal arrow, as spreadsheet programs do;
  a column's resize edge keeps the resize pointer. Both grids. (FR-008c, refining FR-008b's pointer)
- Q28: When is Edit in Dialog… offered? → A: It is shown disabled when more than one cell is selected (whole
  rows, whole columns, or a block). (FR-036d)
- Q29: What happens when another CSV is opened over a CSV Preview Editor with unsaved edits? → A: The editor's
  unsaved-changes prompt (006 US9) asks: save and open, discard and open, open in a new preview, or cancel.
  This replaces FR-033a's silent new panel for an open or a drop. *(derived)* The third choice is labelled
  **Open in new preview**; Back and Forward stay refused with the existing notice. (FR-033b)
- Q30: Is the selection carried from one CSV to the next in a reused panel? → A: No. Each CSV keeps its own
  last selection: reopening it, or going Back or Forward to it, restores that file's selection; a CSV opened
  for the first time starts at A1. Kept for the session only, never across a restart. *(derived)* Kept per
  panel history entry, alongside its scroll position; scroll is restored with it. Both grids. (FR-008d)
- Q31: What does the pointer show while dragging across rows or columns? → A: The select arrow the drag began
  with, steadily: crossing another header or a column's resize edge must not change it. *(derived)* A drag
  across cells keeps the ordinary arrow the same way. (FR-008e)
- Q32: What does the middle mouse button do in a grid? → A: It never pastes. Pressing it puts the grid in move
  mode: dragging moves the table under the pointer, as a Mermaid diagram pans (054 FR-046e). *(derived)* The move
  cursor shows for the drag's life, pinned over the whole grid; the selection does not change; Chromium's
  autoscroll does not start; Linux's middle-click paste of the primary selection is suppressed; Ctrl+middle-click
  stays the zoom reset. Both grids. (FR-008f)

## Terminology

| Term | Meaning |
|---|---|
| **grid** | One component that shows tabular data as rows and columns with a column-header strip, a row-number gutter, virtualised scrolling in both directions, and column resizing. Both surfaces in this feature draw their table with it |
| **CSV Preview Editor** | The CSV provider's preview panel: an editable grid over the CSV's **one document** (Principle XI). Offered as "Throng Preview Editor" |
| **spreadsheet preview** | A read-only **binary provider** (044 Terminology) for workbooks, showing every sheet as a grid (#604) |
| **minimal-change CSV** | What a save writes after grid edits: every byte the user did not change kept as it was; each edited field written bare, or quoted with its quotes doubled where it holds the delimiter, a quote, a carriage return or a line feed (FR-047) |
| **preview size limit** | The Spreadsheet provider's setting above which its preview shows a notice instead of loading the file (FR-061) |

## Why the editable grid is the CSV's preview

#605 asked for a read-only grid *preview*; #323 asked for an editable grid. The maintainer's answer to Q1
merges them: there is **one** CSV grid, it edits, and it is reached the way every preview is reached —
Open In → Preview, the default open action, the editor's Open Preview. That means it is a preview panel
whose body edits, which 044 forbade (FR-020, FR-025, FR-040–FR-043). This feature supersedes those
requirements **for the CSV provider only** (table below), on one ground: the CSV Preview Editor is a
**view of the document**, exactly as an editor panel is. It joins the file's one document — opening it if
no editor has — so the buffer, dirty state, undo history, encoding, line endings, save, auto save and the
dirty-close prompt are the editor's own, unchanged, and a text editor open on the same file stays in step
with every grid edit (Principle XI, *one document, one state*; 016 FR-028f).

## Requirements this feature changes

Each was found by searching `specs/*/spec.md` and the tests for the behaviour first (CLAUDE.md, *Before
you add a requirement*).

| Requirement | By | What changes |
|---|---|---|
| 044 FR-020 / FR-021 | FR-030, FR-035 | **Superseded for the CSV provider.** Its preview edits the document, and Save, Undo and Redo act in it |
| 044 FR-025 | FR-030 | **Superseded for the CSV provider.** A standalone CSV Preview Editor opens the file as a document (it counts as open, can be dirty, and an editor opened later joins it) |
| 044 FR-040 – FR-043 | FR-033 | **Superseded for the CSV provider.** A CSV Preview Editor shows its document's unsaved marker whether or not an editor is open, and closing the last view of a dirty document prompts as closing an editor does. 044 FR-044 (one document, one count) is unchanged and relied on |
| 044 FR-026 | FR-062 | For the Spreadsheet provider, "larger than the size limit the editor applies" becomes "larger than the provider's preview size limit". The CSV provider keeps the editor's limit, because it opens a document (FR-041) |
| 044 FR-035a / FR-035c | FR-024 | In a grid, Copy copies the selected cells as tab-separated text (Plain) and as a text-only table (Rich); Select All selects every cell |
| 044 FR-050 / FR-051, 054 FR-030 | FR-031, FR-064 | Superseded by **074**'s Open-in preference, which owns the mechanism; this feature only declares the CSV and Spreadsheet providers' options and shipped values |
| 067 FR-116 / FR-117 | FR-065 | Refinement, not supersession: with the Spreadsheet provider enabled, its file types are no longer files "throng cannot open", so a double-click follows its Open-in preference |
| 006 FR-062 | FR-041 | Unchanged and relied on: the CSV Preview Editor is bound by `editor.maxOpenFileBytes` exactly as the text editor is |
| 044 FR-073 | FR-050 | Unchanged and relied on: the spreadsheet preview, a binary provider, is always standalone |

054 FR-051/FR-053 (one **Open previews in** setting per provider), 044 FR-070–FR-074 (adding a provider
is registration only), 044 FR-081/FR-082 (nothing in a previewed file runs) and 067 FR-015–FR-021 (Open
in OS Default Program on every preview, inherited from the shared title menu) are **not** changed; this
feature must satisfy them.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Open a CSV as a table (Priority: P1)

A user has a `.csv` in their project and opens it from Files & Folders. With the shipped preference it
opens in the CSV Preview Editor, titled `<name>.csv - Preview`: column letters, row numbers, values in
their cells, a wide table scrolling sideways.

**Why this priority**: It is the read path every other story builds on, it ships the shared grid, and it
is useful alone.

**Independent Test**: Open a fixture CSV with quoted commas, embedded newlines, doubled quotes and an HTML
string; check every value lands in its cell, the HTML shows literally, and nothing is written.

**Acceptance Scenarios**:

1. **Given** a `.csv` containing `"a, b"`, a value spanning two lines and `""quoted""`, **When** it is
   opened in the CSV Preview Editor, **Then** each sits whole in its own cell.
2. **Given** a cell containing `<img src=x onerror=alert(1)>`, **When** it is shown, **Then** the cell
   shows that text literally and nothing runs.
3. **Given** a table wider than the panel, **When** it is shown, **Then** it scrolls horizontally and no
   cell wraps beyond its row.
4. **Given** Open CSVs in = Throng Preview Editor (shipped), **When** a `.csv` is opened from Files &
   Folders, **Then** the CSV Preview Editor opens; **given** Throng Editor, **Then** a text editor opens;
   **given** Default OS Program, **Then** the OS default program opens it and no throng panel opens.
5. **Given** a CSV open in a text editor, **When** the user chooses Open Preview, **Then** a CSV Preview
   Editor of the same document opens beside it, and a text edit appears in the grid (after the preview
   update delay, 044 FR-022) while a grid edit appears in the text at once.
6. **Given** a CSV Preview Editor with no unsaved edits, **When** the file changes on disk, **Then** the
   grid shows the new content, as an editor does.
7. **Given** a 100,000-row by 50-column CSV in the grid, **When** the user scrolls sideways and back with
   the wheel or trackpad, **Then** the columns follow the pointer without stutter and no blank cell area
   shows (SC-009).
8. **Given** a column whose values are wider than it, **When** the user double-clicks its header, **Then**
   the column widens to its widest value; **When** they double-click it again, **Then** it returns to the
   width it had before (FR-011).
9. **Given** a row holding a long value and a value with a line break, **When** the user double-clicks
   its row number, **Then** the row grows to show both values in full, wrapped and on their own lines;
   **When** they double-click it again, **Then** it is one line high again (FR-012). *(Superseded by
   FR-012a: there is no row expand.)*

---

### User Story 2 - Edit a CSV in the grid (Priority: P1)

A user edits values in cells, inserts rows and columns, copies and pastes cells, undoes and redoes, and
saves — exactly as they would in the text editor, with the same unsaved marker, Auto Save and
close-with-unsaved-changes prompt.

**Why this priority**: It is #323's whole ask, and it makes the CSV a document the user can work on.

**Independent Test**: Open a fixture CSV in the CSV Preview Editor, change a cell, check the panel shows
the unsaved marker and the file on disk is unchanged, undo, redo, save, and compare the file with the
expected bytes: only the edited field differs.

**Acceptance Scenarios**:

1. **Given** the grid, **When** the user edits a cell and presses Enter, **Then** the document is dirty,
   the file on disk is unchanged, and one Undo reverts exactly that edit.
2. **Given** Auto Save on, **When** the user edits a cell, **Then** the file is saved after the auto-save
   delay, as for a text edit.
3. **Given** unsaved grid edits, **When** the user closes the last panel showing the document, **Then**
   the editor's dirty-close prompt appears with its Save, Don't Save and Cancel choices.
4. **Given** a row selected, **When** the user chooses **Insert Row Above** or **Insert Row Below** from
   the row header's right-click menu, **Then** an empty row appears there; likewise **Insert Column
   Left** / **Insert Column Right** from a column header.
5. **Given** cells copied from the grid, **When** they are pasted into another application, **Then** they
   arrive as tab-separated rows; **given** tab-separated text on the clipboard, **When** it is pasted into
   the grid, **Then** it fills cells from the active cell, as one undo step.
6. **Given** a column resized, **When** the file is closed and reopened, or throng restarts, **Then** the
   column has the width it was left at.
7. **Given** a file with mixed quoting and CRLF line endings, **When** one field is edited and the file
   saved, **Then** every other byte of the file is unchanged, and the edited field is quoted only if its
   new value needs it.
8. **Given** the grid, **When** the user looks for sort, filter, reorder, formula, type or format
   controls, **Then** there are none.
9. **Given** a cell holding `hello world`, **When** the user double-clicks it, **Then** the in-cell editor
   opens with `hello world` selected, and typing replaces it; **When** they press Home, End or an arrow
   key instead, **Then** the caret moves within the text and the active cell stays where it is (FR-043).
10. **Given** a cell, a selected range, a row header or a column header, **When** the user right-clicks
    it, **Then** the menu offers Cut, Copy and Paste for that selection (FR-037e).
11. **Given** a 2×2 block copied from another CSV and a 2×2 selection dragged from B2 to C3, **When** the
    user pastes, **Then** B2:C3 hold the copied values and nothing after C3 changes (FR-037f).
12. **Given** a resized column, **When** the user chooses **Reset Size** from its header's menu, **Then**
    it returns to the default width, and stays so after reopening the file (FR-006a).
13. **Given** the grid scrolled to its top, **When** the user clicks a column letter, **Then** the whole
    column is selected and the grid does not move; pressing Down then moves to row 2 (FR-008a).
14. **Given** a CSV Preview Editor, **When** the user clicks the Save As icon in its title bar and chooses
    `copy.csv`, **Then** `copy.csv` holds the document, the original file is unchanged, and the panel shows
    `copy.csv` (FR-035a).
15. **Given** rows 2–3 copied by their row numbers, **When** the user right-clicks row 6's number and
    chooses **Insert Copied Rows Above**, **Then** two rows holding the copied values appear above row 6,
    and one Undo removes both; likewise columns with **Insert Copied Columns Left/Right** (FR-038a).
16. **Given** a cell holding `{"id":1,"tags":["a","b"]}` (over 50 characters with the threshold at 50),
    **When** the user double-clicks it, **Then** a dialog opens with the JSON indented over several lines;
    **When** they change `"a"` to `"x"` and save, **Then** the cell holds the JSON on one line with each
    line break and its indent turned into one space, and one Undo restores the original (FR-036a).
17. **Given** a short cell, **When** the user right-clicks it and chooses **Edit in Dialog…**, types two
    lines and saves, **Then** the cell holds the two lines joined by one space (FR-036a).
18. **Given** Edit long cells in a dialog off, **When** the user double-clicks a long cell or right-clicks
    any cell, **Then** the in-cell editor opens and the menu has no Edit in Dialog…; **When** they turn the
    status-bar toggle on in that panel, **Then** that panel offers the dialog again and other CSV panels do
    not (FR-036b).
19. **Given** a widened column and an expanded row, **When** the user right-clicks the column letter,
    **Then** the menu offers **Reset Column Width** (no Reset Size), and the row number's menu offers
    **Reset Row Height**, each doing what Reset Size did (FR-006b).
20. **Given** any grid menu, **When** it opens, **Then** Cut, Copy, Paste, Save, Save As, the Insert items,
    Select All, Edit in Dialog…, Go to Row… and the Reset items each show an icon in the
    theme's colours (FR-037g).
21. **Given** a 1,200-row CSV with the active cell in column C, **When** the user presses Ctrl+G, **Then** a
    dialog reads "Row 1 of 1,200"; typing a letter or 1300 changes nothing in its field; typing 900 and Enter
    makes C900 the active cell at the top of the grid and focus is back in the grid (FR-043a, FR-043b).
22. **Given** an editor on a 300-line file, **When** the user presses Ctrl+G, **Then** the same dialog reads
    "Line <caret line> of 300" and refuses a letter or 301; Escape closes it with focus back in the editor
    (FR-043b).
23. **Given** a grid scrolled to row 500, **When** the user clicks the corner cell above the row numbers,
    **Then** every row and column is selected, the grid stays at row 500, and Ctrl+C copies the whole table
    (FR-008b).
24. **Given** Wrap cells off and a CSV holding a 300-character value and a value with line breaks, **When**
    the user turns on Wrap in the status bar, **Then** every row grows to show its cells in full, wrapped
    within their columns and broken at the line breaks; turning it off truncates them again. Another CSV
    panel is unaffected, and the panel keeps its choice after a restart (FR-013).
25. **Given** Wrap cells on in Preferences, **When** the user opens a CSV, **Then** it opens wrapped; a
    row-number double-click changes nothing and the row-number menu has no Reset Row Height (FR-012a,
    FR-006c, FR-060b).
26. **Given** a 10-character cell holding a line break, **When** the user double-clicks it, **Then** it opens
    in the cell dialog with the break shown (FR-036c).
27. **Given** Edit multi-line cells in a dialog off, **When** the user double-clicks that cell, **Then** the
    in-cell editor opens (FR-060c).
28. **Given** a grid, **When** the pointer rests on a row number, a column letter and the corner in turn,
    **Then** it shows a right arrow, a down arrow and a diagonal arrow; on a column's edge it shows the
    resize pointer (FR-008c). **When** they drag across several column letters, **Then** the down arrow stays
    steady as it crosses each column's edge (FR-008e).
32. **Given** a CSV with text on the clipboard and in the primary selection, **When** the user presses the middle
    button over a cell and drags up and left, **Then** nothing is pasted, the selection is unchanged, the pointer
    is the move cursor, and the table moves with the pointer; releasing ends it (FR-008f).
29. **Given** a block of cells selected, **When** the user right-clicks it, **Then** Edit in Dialog… is shown
    disabled; with one cell selected it is enabled (FR-036d).
30. **Given** `a.csv` with an unsaved edit in a Last Preview Panel, **When** the user opens `b.csv`, **Then**
    the unsaved-changes prompt asks how to open it; Save & open saves a.csv and shows b.csv in the panel,
    Discard & open drops the edit and shows b.csv, Open in new preview opens b.csv in a new panel, Cancel
    opens nothing (FR-033b).
31. **Given** C7 selected in `a.csv`, **When** the user opens `b.csv` in the same panel, **Then** b.csv starts
    at A1; selecting B3 there and reopening a.csv (or going Back) selects C7 again, and Forward selects B3.
    After a restart both start at A1 (FR-008d).

---

### User Story 3 - Read a spreadsheet workbook (Priority: P2)

A user has a workbook (`.xlsx`, `.xlsm`, `.xlsb`, `.xls`, `.ods`, `.fods` or `.numbers`) in their
project. They open it from Files & Folders and read it in a read-only preview panel: a sheet switcher
listing every sheet, each sheet as a grid, formula cells showing the value stored in the file. Neither
LibreOffice nor Office is needed.

**Why this priority**: Useful, but read-only and binary, so it depends on the grid of US1 and carries
more security surface.

**Independent Test**: Open a fixture `.ods` and `.xlsx` with three sheets, a formula and a hidden sheet;
check every sheet is reachable, the formula shows its stored value, and nothing runs or is fetched.

**Acceptance Scenarios**:

1. **Given** a three-sheet workbook, **When** it is previewed, **Then** a sheet switcher lists all three
   in the file's order and each shows its cells.
2. **Given** a cell holding `=SUM(A1:A3)` with stored value 6, **When** it is previewed, **Then** the cell
   shows 6 and nothing recalculates.
3. **Given** a workbook with a macro and an external data link, **When** it is previewed, **Then** no
   macro runs and no network request is made.
4. **Given** an open spreadsheet preview, **When** the file changes on disk, **Then** the preview reloads,
   keeping the selected sheet when it still exists.
5. **Given** a password-protected, malformed or over-limit workbook, **When** it is previewed, **Then**
   one inline notice says which, with no blank panel and no raw error string.
6. **Given** Open spreadsheets in = Default OS Program, **When** a workbook is opened from Files &
   Folders, **Then** the OS default program opens it and no throng panel opens.
7. **Given** a sheet in the preview, **When** the user double-clicks a column header or a row number,
   **Then** the column fits its widest value or the row expands to show its values in full, and a second
   double-click undoes it, exactly as in the CSV Preview Editor (FR-011, FR-012). *(Superseded by FR-012a
   for rows: a row-number double-click does nothing.)*

---

### User Story 4 - Configure the CSV and spreadsheet providers (Priority: P2)

Under **Editor → Previews**, the user finds a **CSV** and a **Spreadsheet** subsection following the
Markdown and Mermaid pattern, each setting working as labelled.

**Why this priority**: The issues require it, but every story above works on the shipped defaults.

**Independent Test**: For each setting, change it in Preferences and check the behaviour it names.

**Acceptance Scenarios**:

1. **Given** CSV: Enabled off, **When** the user right-clicks a `.csv`, **Then** Open In → Preview is
   disabled and any open CSV Preview Editors close (044 FR-062/FR-063) — a dirty one asking first, as a
   closing editor does (FR-063) — and the text editor stays available.
2. **Given** a workbook larger than the Spreadsheet preview size limit, **When** it is previewed, **Then**
   one inline notice names the size and the limit; **When** the limit is raised above the file's size,
   **Then** Refresh loads it.
3. **Given** Spreadsheet: First row is a header on, **When** a workbook is previewed, **Then** the header
   strip shows each sheet's first row and the data starts at its second.

---

### Edge Cases

- **Ragged rows** (fewer or more fields than the widest row): the grid shows missing fields as empty
  cells. Typing into a missing field appends the delimiters needed to reach it to that record only;
  other records are not padded.
- **Malformed CSV** (an unterminated quote): the CSV Preview Editor refuses to show the grid — one inline
  notice naming the first bad line, with **Open in Editor** as its action — because a grid edit could not
  be written back faithfully (FR-046). The document is untouched.
- **Empty file**: the grid shows one empty cell; typing in it writes the first field.
- **Delimiter**: a file whose delimiter is detected as `;` or tab is split on it, and edits are written
  with the same delimiter (FR-047). Extensions other than `.csv` (`.tsv`) are out of scope.
- **Byte-order mark, encoding, line endings**: the document's own, as the editor already detects and
  keeps them (059). An inserted row uses the line ending of the document (the first one found; the
  editor's default for a one-line file).
- **A cell holding a newline**: shown on one row height with the line break visible as a marker; editing
  it in the cell editor preserves the newline, and the field is written quoted.
- **Leading `=`, `+`, `-`, `@` in a cell**: shown as text. throng evaluates nothing; protecting another
  spreadsheet application from formula injection on copy is out of scope.
- **A CSV over `editor.maxOpenFileBytes`**: the CSV Preview Editor shows the editor's too-large notice,
  as the text editor does (006 FR-062); Open in OS Default Program remains on its menu.
- **The same CSV in a text editor and a CSV Preview Editor**: one document; an edit in either appears in
  the other, and Undo in either undoes the latest edit of the document (Principle XI). Each panel keeps
  its own selection and scroll.
- **The same CSV in two windows**: one CSV Preview Editor per file (044 FR-012); a second window shows the
  same panel's run, sharing the document.
- **A text edit that makes the document malformed while the grid is open**: the grid is replaced by the
  FR-046 notice; when the text is fixed, the grid returns.
- **Workbook features with no grid meaning** — charts, images, pivot tables, conditional formatting,
  comments: not shown, and their absence raises no notice. **Merged cells** show their value in the
  top-left cell. **Hidden sheets** are listed in the switcher, marked hidden.
- **Very wide sheets** (thousands of columns) and very tall ones: virtualised in both directions.
- **A file deleted under an open panel**: the CSV Preview Editor behaves as an editor whose file was
  deleted (it keeps its buffer); the spreadsheet preview shows 044 FR-026's notice.

## Requirements *(mandatory)*

### Functional Requirements

#### The shared grid

- **FR-001**: The CSV Preview Editor and the spreadsheet preview MUST draw their tables with one grid
  component, editable in the first and read-only in the second.
- **FR-002**: The grid MUST show a column-header strip and a row-number gutter, both staying visible
  while the body scrolls. The column-header strip MUST show column letters (A, B, …, Z, AA, …), or the
  first row's values where First row is a header applies (FR-059).
- **FR-003**: The grid MUST virtualise rows and columns, so only what is on screen is drawn.
- **FR-004**: The grid MUST scroll horizontally rather than wrap. A cell's content MUST stay on its row's
  single line, truncated with an ellipsis, with the full value in the cell's tooltip. *(Refined by FR-012
  for an expanded row, 2026-11-19; refined by FR-013 while Wrap is on in a CSV Preview Editor.)*
- **FR-005**: Every cell value MUST be rendered as text, never interpreted as markup, a link or a formula.
- **FR-006**: Columns MUST be resizable by dragging the header strip's column edge, and by keyboard from
  the column header's menu (**Column Width…**).
- **FR-006a** *(Q13, 2026-11-19)*: A column header's right-click menu MUST offer **Reset Size**, returning
  the column to the default width and removing its stored width (FR-040). A row header's menu MUST offer
  **Reset Size**, collapsing an expanded row (FR-012) to one line. Both grids.
- **FR-006b** *(Q19, 2026-11-19)*: The column header's item MUST be named **Reset Column Width** and the
  row header's **Reset Row Height**. *(Supersedes FR-006a's item name, "Reset Size"; its behaviour stands.)*
- **FR-006c** *(Q24, 2026-11-19)*: The row header's menu MUST NOT offer **Reset Row Height**; **Reset Column
  Width** stays. *(Supersedes FR-006a and FR-006b for rows.)*
- **FR-007**: The grid MUST take its colours, fonts and selection highlight from the active theme's
  tokens, and MUST follow the panel's zoom (044 FR-034).
- **FR-008**: The grid MUST be navigable from the keyboard: arrows, Page Up/Down, Home/End,
  Ctrl+Home/End, and Shift with any of them to extend a selection.
- **FR-008a** *(Q14, 2026-11-19)*: Selecting with the pointer (a cell, a drag, a row number, a column letter,
  a right-click) MUST NOT scroll the grid; only keyboard movement (FR-008) brings the active cell into view.
  A whole-column selection's active cell MUST be its top row. Both grids.
- **FR-008b** *(Q22, 2026-11-19)*: Clicking the corner cell where the column letters meet the row numbers MUST
  select every cell, exactly as Select All does, without scrolling. It MUST be a named control ("Select all")
  showing a pointer cursor; a right-click on it selects every cell and opens the selection's menu. Both grids.
- **FR-009**: The grid's code, the CSV parser and the workbook library MUST load only when a grid is
  first needed; application startup MUST load none of it (as 054 FR-047 does for diagrams).
- **FR-010**: Every library this feature adds MUST meet #10's bar: actively maintained, under a licence
  compatible with AGPL-3.0-only distribution, and safe against untrusted local content. Each choice and
  its licence MUST be recorded in research.
- **FR-011** *(Q6, 2026-11-19)*: Double-clicking a column header, or its resize edge, MUST set the column
  to the width of its widest value across every row, header label included, clamped to 40–2000 px at zoom
  1 and stored as FR-040 stores a width. Double-clicking a column that the previous double-click fitted
  MUST restore the width it had before the fit. Both grids.
- **FR-008c** *(Q27, 2026-11-19)*: Over a row number the pointer MUST be a right-pointing select arrow, over a
  column letter a down-pointing select arrow, and over the corner cell a diagonal select arrow; a column's
  resize edge keeps the resize pointer. Both grids. *(Refines FR-008b's pointer cursor.)*
- **FR-008e** *(Q31, 2026-11-19)*: While a selection drag is under way, the pointer MUST stay the one it began
  with — the row select arrow for a row drag, the column select arrow for a column drag, the ordinary arrow for a
  cell drag — over every part of the grid, resize edges included, until the button is released. Both grids.
- **FR-008f** *(Q32, 2026-11-19)*: A middle-button press in a grid MUST NOT paste, select, or start the
  platform's autoscroll. While the middle button is held, dragging MUST scroll the grid so the table follows the
  pointer, both ways, with the **move** cursor shown over the whole grid until release. Ctrl+middle-click remains
  the zoom reset (Cmd on macOS). Both grids.
- **FR-008d** *(Q30, 2026-11-19)*: A grid's selection MUST belong to the file it shows. When a panel shows
  another file (Last Preview Panel reuse, Back, Forward), the file it leaves keeps its selection in that
  history entry, and the file it shows gets back its own last selection, or A1 when it has none. Selections
  last for the session only and are not persisted. Both grids.
- **FR-012** *(Q7, 2026-11-19)*: Double-clicking a row header MUST expand that row so each of its cells
  shows its full value, line breaks honoured and wrapped within its column's width, the row as tall as its
  tallest cell up to 20 lines, a taller cell scrolling inside itself. Double-clicking an expanded row's
  header MUST collapse it to one line. Expansion lasts for the life of the panel and is not persisted.
  Both grids. *(Superseded by FR-012a.)*
- **FR-012a** *(Q24, 2026-11-19)*: There MUST be no row resize in either grid: a row-number double-click
  MUST do nothing, and no menu offers expanding or resetting a row's height. *(Supersedes FR-012.)*
- **FR-013** *(Q24, 2026-11-19)*: The CSV Preview Editor's status bar MUST show a **Wrap** toggle that, when
  on, wraps every cell within its column's width, line breaks honoured, each row as tall as its tallest cell
  so every value shows in full, with no line cap; off, cells truncate as FR-004 says. The toggle MUST show its
  state, be reachable by keyboard, and have a matching checked item on the panel menu. Whether Wrap is on is
  decided per panel: the panel's own choice, saved with the panel so it survives a restart, else **Wrap
  cells** (FR-060b). Scrolling with Wrap on still meets SC-009. *(Refines FR-004.)*

#### CSV parsing

- **FR-020**: A **CSV** text provider MUST accept `.csv`, registered as 044 FR-070–FR-072 require.
- **FR-021**: *Withdrawn (clarification Q1, 2026-11-18).* The CSV grid is an editor; First row is a header
  would hide the first record from editing, so it is a Spreadsheet setting only (FR-059).
- **FR-022**: Parsing MUST follow RFC 4180 quoting: a quoted field may contain the delimiter, a line
  break and doubled quotes. The delimiter MUST be detected (comma, semicolon or tab), defaulting to comma
  where detection is inconclusive.
- **FR-023**: Parsing MUST keep the panel responsive (Principle XII): a document at the editor's size
  limit MUST be parsed off the renderer's main thread.
- **FR-024**: In a grid, the selection is a range of cells. **Copy** MUST put the selected cells on the
  clipboard as tab-separated rows in Plain text format, and additionally as a text-only table in Rich
  text format (044 FR-035a, as this feature refines it); **Select All** MUST select every cell.
- **FR-025**: A grid MUST keep its scroll position and its selection across a content update, clamped to
  the data that remains.

#### CSV Preview Editor (#323, #605)

- **FR-030**: The CSV provider's preview MUST be the **CSV Preview Editor**: an editable grid that is a
  view of the file's one document. Opening it MUST join the document an editor already holds for the
  file, or open the document if none does; it MUST NOT hold a buffer, dirty state or undo history of its
  own. *(Supersedes 044 FR-020, FR-025 for the CSV provider.)*
- **FR-031**: The CSV provider's Open-in preference (074) MUST be labelled **Open CSVs in**, offer
  **Throng Editor**, **Throng Preview Editor** and **Default OS Program**, and ship **Throng Preview
  Editor**.
- **FR-032**: *Withdrawn (clarification Q1).* There is no grid/text view switch; Open in Editor / Go to
  Editor on the CSV Preview Editor's menu (044 FR-015) and Open Preview on the text editor reach the other
  presentation.
- **FR-033**: The CSV Preview Editor MUST show the unsaved marker exactly while its document is dirty, and
  closing the last panel showing a dirty document MUST raise the editor's dirty-close prompt with the same
  choices. A dirty document MUST be counted once wherever unsaved documents are counted (044 FR-044).
  *(Supersedes 044 FR-040 – FR-043 for the CSV provider.)*
- **FR-033a** *(Q10, 2026-11-19)*: A CSV Preview Editor MUST follow its **Open previews in** setting
  (054 FR-051; 047 FR-010 – FR-016) as a Markdown preview does: with Last Preview Panel, opening another
  CSV moves the panel to it, and reopening the first moves it back, never adding a panel. A CSV Preview
  Editor whose document has unsaved edits only it shows MUST NOT be moved — by an open, a drop or
  Back/Forward: the other CSV opens in a new panel instead. *(Superseded for an open or a drop by FR-033b.)*
- **FR-033b** *(Q29, 2026-11-19)*: Opening or dropping another CSV onto a CSV Preview Editor whose document has
  unsaved edits only it shows MUST raise the editor's unsaved-changes prompt (006 US9), naming the grid's file
  and the arriving one, with **Save & open**, **Discard & open**, **Open in new preview** and **Cancel**. Save and
  Discard then reuse the panel as FR-033a describes; Open in new preview opens the arriving CSV in a new panel and
  leaves the grid as it was; Cancel opens nothing. Back and Forward stay refused while it is dirty.
  *(Supersedes FR-033a's new panel for an open or a drop.)*
- **FR-034**: *Withdrawn (clarification Q1).* No view switch, so no cursor mapping across one.
- **FR-035**: Every grid edit MUST be a change to the document through the document's authority
  (Principle XI, *one authority, not two peers*), so it appears in every view of the document and in the
  shared undo history. **Undo**, **Redo** and **Save** MUST work in the CSV Preview Editor by their
  editor chords and from its right-click menu, and Auto Save (`editor.autoSave`) MUST save grid edits as
  it saves text edits. *(Supersedes 044 FR-021 for these three commands on the CSV provider.)*
- **FR-035a** *(Q15, 2026-11-19)*: The CSV Preview Editor's title bar MUST show the **Save** and **Save As**
  icon controls as an editor panel's does (067 FR-069 – FR-074, narrow-header hiding included). **Save As**
  MUST also be on the grid's right-click menu and on the `editor.saveAs` chord; it asks for a location with
  the editor's Save As dialog, writes the document there through the editor's save path (FR-045), and the
  preview then shows the file at its new path. *(Supersedes the Assumption "Save As and Revert are reached
  from a text editor" for Save As; Revert still is.)*
- **FR-036**: Editing a cell: typing on a selected cell or pressing F2 or Enter MUST open an in-cell
  editor; Enter commits and moves down, Tab commits and moves right, Esc cancels. Delete on a cell
  selection MUST clear their values.
- **FR-036a** *(Q17, 2026-11-19)*: With **Edit long cells in a dialog** on, double-click, F2 and Enter on a
  cell whose value is longer than **Long cell threshold** characters MUST open a modal **cell dialog** in
  place of the in-cell editor; typing a character on a cell still opens the in-cell editor. Every cell's
  right-click menu MUST offer **Edit in Dialog…**, whatever the value's length or the setting. The dialog
  holds an editor that accepts line breaks. A value whose whole text parses as a JSON object or array MUST
  open pretty-printed (two-space indent) with JSON highlighting. Saving MUST flatten the text to one line:
  for a value that parses as JSON, each line break together with the whitespace after it becomes one space;
  for any other text, each line break becomes one space and the rest is kept. The flattened value is
  written as one grid edit (one undo step), and nothing is written when the dialog's text is unchanged from
  what it opened with. Esc and Cancel close it without writing. *(Refines FR-036 for long cells.)*
- **FR-036d** *(Q28, 2026-11-19)*: **Edit in Dialog…** MUST be shown disabled while more than one cell is
  selected.
- **FR-036c** *(Q25, 2026-11-19)*: A cell whose value holds a line break MUST open in the cell dialog on
  double-click, F2 and Enter, whatever its length, wherever FR-036a sends a long cell there. *(Refines FR-036a.)*
- **FR-036b** *(Q18, 2026-11-19)*: Whether the cell dialog is available MUST be decided per panel: the
  panel's own choice when it has one, else **Edit long cells in a dialog**. When it is unavailable there is
  no cell dialog at all — no threshold routing and no **Edit in Dialog…** menu item. *(Supersedes FR-036a's
  "whatever the value's length or the setting" for the menu item.)* The CSV Preview Editor's status bar MUST
  show, at its bottom right, a toggle for the cell dialog that shows the panel's current state, is
  reachable by keyboard, and records the panel's choice with the panel's saved state, so it survives a
  restart; a panel that has never used it follows the setting.
- **FR-037**: Selection MUST cover text within a cell (while its editor is open), single cells, cell
  ranges and whole rows (by the row gutter). **Copy**, **Cut** and **Paste** MUST be offered on the
  grid's right-click menu and work by their chords.
  - **FR-037a**: Copying cells or rows MUST put tab-separated rows on the clipboard (FR-024's format).
  - **FR-037b**: Cutting cells MUST copy them and clear their values; cutting whole rows MUST copy them
    and remove the rows.
  - **FR-037c**: Pasting text into an open cell editor MUST insert at the caret. Pasting tab-separated
    text on a cell selection MUST overwrite cells from the active cell, extending the table where it runs
    past the last row or column.
  - **FR-037d**: One paste MUST be one undo step.
  - **FR-037e** *(Q11, 2026-11-19)*: The right-click menu of a cell, a selection, a row header and a
    column header MUST each offer **Cut**, **Copy** and **Paste**, acting on the selection the right-click
    leaves (the read-only spreadsheet preview offers Copy only). Cutting whole columns MUST clear their
    values without removing the columns.
  - **FR-037f** *(Q12, 2026-11-19)*: Pasting tab-separated text, by chord or menu, onto a selection MUST
    overwrite from the selection's top-left cell (column A for whole rows), extending the table only where
    the pasted block runs past its last row or column; a single value pasted onto a selection of more than
    one cell MUST fill every selected cell. *(Refines FR-037c's "from the active cell".)*
- **FR-037g** *(Q20, 2026-11-19)*: Every grid menu item with a sensible picture MUST show a themeable icon
  in the menu's icon column, as the File Explorer's menus do: an existing icon key where one fits, a new
  drawn key otherwise. Items with no sensible picture keep the empty icon column. Both grids.
- **FR-037h** *(Q23, 2026-11-19)*: The row header and column header menus MUST NOT offer **Select Row** or
  **Select Column**: opening either menu has already selected the row or column. Both grids.
- **FR-038**: A row header's right-click menu MUST offer **Insert Row Above** and **Insert Row Below**; a
  column header's MUST offer **Insert Column Left** and **Insert Column Right**. Each MUST also be a
  bindable command acting on the active cell (every panel action has a menu item, and the reverse).
- **FR-038a** *(Q16, 2026-11-19)*: While the clipboard holds whole rows or whole columns last copied or cut
  from a CSV grid, a row header's menu MUST also offer **Insert Copied Rows Above** and **Insert Copied
  Rows Below**, and a column header's **Insert Copied Columns Left** and **Insert Copied Columns Right**,
  inserting that many rows or columns holding the copied values at that place, as one undo step, with the
  document's delimiter and line ending (FR-047). The blank inserts of FR-038 stay.
- **FR-039**: The grid MUST offer no sort, filter, reorder, formula, cell type, formatting or frozen pane
  control (#323, maintainer agreement).
- **FR-040**: Column widths MUST be stored per file, as document state alongside the document's other
  persisted state, and restored when the file is next shown in a grid, across restarts. A width MUST be
  shared by every panel showing the file.
- **FR-041**: The CSV Preview Editor MUST honour `editor.maxOpenFileBytes` exactly as the text editor
  does (006 FR-062).
- **FR-042**: The CSV Preview Editor MUST show the header strip as column letters and the first record as
  row 1, so every value is reachable for editing.
- **FR-043** *(Q8, 2026-11-19)*: Double-clicking a cell MUST open the in-cell editor with the cell's whole
  text selected. While the in-cell editor is open, the arrow keys, Home, End, Ctrl+Home and Ctrl+End MUST
  move the caret within the text (Shift extending the text selection) and MUST NOT move the active cell.
  *(Refines FR-036 and FR-037; FR-008's navigation applies while no in-cell editor is open.)*
- **FR-043a** *(Q21, 2026-11-19)*: In a CSV Preview Editor or a workbook sheet, the preview's Go to command
  (`preview.goToHeading`, `Ctrl+G`) and a **Go to Row…** item on the cell and row-header menus MUST open
  the shared Go to dialog (FR-043b) for rows, naming the active cell's row and the row count as the row
  header numbers them. Enter MUST move the active cell to that row in the active column, scroll the row to
  the top, and return focus to the grid.
- **FR-043b** *(Q21, 2026-11-19)*: The Go to dialog MUST be one shared component, used by the PDF preview's
  Go to Page (074 FR-062b), the grids' Go to Row (FR-043a) and the editor's Go to Line (033 FR-019). Each use
  MUST name the current position and the count ("Line 3 of 120", digit-grouped), accept only a whole number
  from 1 to the count — any other keystroke refused — go there on Enter and close, close on Escape or a
  click outside, and return focus to what it was opened over. *(Supersedes 033 FR-022 and FR-023 for typed
  input: an out-of-range or non-numeric value can no longer be typed. A remembered Go to Line number
  (033 FR-057 – FR-061) is still seeded and selected, clamped into the document's range.)*

#### Writing CSV

- **FR-045**: A save MUST write through the editor's existing save path, keeping the document's encoding,
  byte-order mark and line endings (059).
- **FR-046**: The grid MUST NOT be shown over a document it cannot parse without loss (an unterminated
  quote); the panel MUST show one inline notice naming the first bad line, with **Open in Editor** as its
  action (*one condition, one notice*).
- **FR-047**: A grid edit MUST change only the bytes of the fields it changes, and the delimiters and line
  endings it inserts or removes: every other byte of the document MUST stay as it was. An edited field
  MUST be written bare, or quoted with its embedded quotes doubled when its value contains the
  document's delimiter, a quote, a carriage return or a line feed. Inserted records MUST use the
  document's delimiter and line ending.
- **FR-048**: Edits made in a text editor MUST be written exactly as typed (text fidelity); the grid never
  rewrites text it did not edit.

#### Spreadsheet preview (#604)

- **FR-050**: A **Spreadsheet** binary provider MUST accept `.xlsx`, `.xlsm`, `.xlsb`, `.xls`, `.ods`,
  `.fods` and `.numbers`.
- **FR-051**: The preview MUST show a sheet switcher listing every sheet in the file's order, hidden
  sheets included and marked hidden, opening on the workbook's first visible sheet. Switching sheet MUST
  keep each sheet's scroll position for the life of the panel.
- **FR-052**: A formula cell MUST show the value stored in the file. Nothing MUST be recalculated.
- **FR-053**: A cell MUST show its value as the file records it for display where the file holds one,
  and otherwise its raw value; a date cell with no display text MUST show as an ISO 8601 date. No other
  cell formatting (fonts, colours, borders, number styles) is applied.
- **FR-054**: Macros MUST never run; external data links MUST NOT be followed; the preview MUST make no
  network request. The preview route's sandbox and content security policy apply (044 FR-081/FR-082,
  FR-093).
- **FR-055**: Parsing a workbook MUST run off the renderer's main thread, so the panel and the rest of the
  app stay responsive while it parses (Principle XII).
- **FR-056**: A password-protected, encrypted, malformed or unsupported workbook MUST show one inline
  notice saying which (044 FR-026), never a blank panel or a raw error string.
- **FR-057**: The workbook library MUST meet FR-010's bar, MUST carry no known unpatched advisory at the
  version adopted, and MUST need neither Office nor LibreOffice installed. Its licence and its manual
  update route MUST be recorded.
- **FR-058**: The preview MUST reload when the file changes on disk (044 FR-023, standalone), keeping the
  selected sheet when a sheet of that name still exists.
- **FR-059**: A **First row is a header** setting of the Spreadsheet provider MUST, when on, show each
  sheet's first row in the column-header strip instead of the body. It ships **off**.

#### Preferences

- **FR-060**: Each of the two providers MUST have its own subsection under **Editor → Previews**,
  following the Markdown and Mermaid pattern (`editor.previews.providers.<id>.*`). CSV: Enabled, Open CSVs
  in, Open previews in (054 FR-051). Spreadsheet: Enabled, Open spreadsheets in, Open previews in, First
  row is a header, Preview size limit. Every setting MUST have a descriptor the preferences editor
  renders, and MUST be documented in `docs/preferences.md`.
- **FR-060a** *(Q17, 2026-11-19)*: The CSV provider MUST have two more settings, rendered and documented as
  FR-060 requires: **Edit long cells in a dialog** (on/off, ships **on**) and **Long cell threshold**
  (characters, a whole number of at least 1, ships **50**).
- **FR-060b** *(Q24, 2026-11-19)*: The CSV provider MUST have a **Wrap cells** setting (on/off, ships **off**),
  rendered and documented as FR-060 requires: the Wrap state of every CSV panel that has not chosen its own.
- **FR-060c** *(Q26, 2026-11-19)*: The CSV provider MUST have an **Edit multi-line cells in a dialog** setting
  (on/off, ships **on**), rendered and documented as FR-060 requires. Off, FR-036c does not apply: a cell
  holding a line break opens in the dialog only when it is longer than the threshold.
- **FR-061**: **Preview size limit** MUST be a Spreadsheet provider setting, shipping at **25 MB**.
- **FR-062**: A workbook above the preview size limit MUST show one inline notice naming the file's size
  and the limit, with Refresh retrying under the current limit. This **supersedes 044 FR-026**'s "the size
  limit the editor applies" for the Spreadsheet provider only.
- **FR-063**: Disabling the CSV provider MUST close every CSV Preview Editor as 044 FR-063 closes
  previews, except that a panel whose document is dirty and shown nowhere else MUST ask first through the
  editor's dirty-close prompt; the text editor stays available.
- **FR-064**: The Spreadsheet provider's Open-in preference (074) MUST be labelled **Open spreadsheets
  in**, offer **Throng Preview** and **Default OS Program**, and ship **Throng Preview**.
- **FR-065**: With the Spreadsheet provider enabled, its file types MUST NOT count as files throng
  "cannot open" for 067 FR-116/FR-117: a double-click follows FR-064. With it disabled, 067 FR-116
  applies to them as before.

#### Constitution touchpoints

- **FR-070**: Files MUST be read through the existing file abstractions and the preview's confined source
  route or the editor's document, never by the renderer reading the file system (Principle II).
- **FR-071**: A preview MUST read only within the project it belongs to (Principle I, 044 FR-074).
- **FR-072**: Every new failure path — parse failure, refused grid, over-limit file, library load
  failure — MUST leave a diagnostic log entry (Principle XIII).

### Key Entities

- **CSV document**: the editor's existing document for a `.csv`, viewed by text editors and at most one
  CSV Preview Editor run; gains **column widths** (per column index) as persisted per-file state.
- **Grid model**: the parsed table derived from a CSV document's text — records of fields with each
  field's span in the text, the detected delimiter, line ending, the widest record's field count, and any
  parse fault with its line. Derived, never an authority.
- **Workbook**: sheets in order, each with a name, hidden flag and cells; each cell with its display
  text.
- **Provider settings**: `editor.previews.providers.csv.*` and `editor.previews.providers.spreadsheet.*`
  as FR-060 lists.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A 10 MB, 100,000-row CSV (the editor's shipped size limit) shows its first screen in the
  CSV Preview Editor within **1.5 seconds** of the open request on the CI runner class.
- **SC-002**: A 1 MB workbook preview shows its first sheet within **1.5 seconds**, and one at the 25 MB
  limit within **8 seconds**, with the rest of the app answering input throughout.
- **SC-003**: Application startup loads none of the grid's, the CSV parser's or the workbook library's
  code; a test asserts it.
- **SC-004**: Scrolling a 100,000-row by 50-column grid keeps the panel responsive: no input waits more
  than 100 ms.
- **SC-009** *(Q9, 2026-11-19)*: Scrolling horizontally or vertically across a 100,000-row by 50-column
  grid runs no main-thread task longer than 50 ms, and at ordinary wheel or trackpad speed no blank cell
  area is drawn.
- **SC-005**: A fixture covering every RFC 4180 quoting case round-trips: parse, edit one field, write,
  parse again yields the edited value in that cell, every other cell unchanged, and every byte outside the
  edited field identical to the original.
- **SC-006**: Twenty grid edits followed by twenty undos return the document to its original text, byte
  for byte, and the document reads clean.
- **SC-007**: A fixture workbook with a macro and an external data link produces no process start and no
  network request during preview; a test asserts it.
- **SC-008**: Adding both providers changes no file in the preview panel's shared chrome, its menus, the
  editor status bar or the Previews preferences page other than registration (044 FR-070), except the
  CSV provider's document-view seam that FR-030 and FR-033 require, which the plan names.

## Assumptions

- The CSV Preview Editor is bound by the editor's existing too-large limit; raising it for CSV is a later
  decision, not a side effect.
- The time budgets in SC-001/SC-002 are this spec's proposal; the maintainer may change them without
  changing the design.
- The CSV parser and the minimal-change writer are written for this feature, not taken from a library:
  FR-047 needs each field's exact span in the text, which PapaParse (MIT, #605's candidate) does not
  report. The grid's virtualisation uses an existing library, chosen in research.
- SheetJS Community Edition is not published to the npm registry at current versions; it is installed
  from its CDN tarball, and updating it is a manual step the plan records (Q4).
- Find within a grid (047's find bar) is not offered; search is a later viewing tool per #605 and #604.
- Deleting a column from the grid is not in #323's agreed list; a column can be removed in the text
  editor. Cutting whole rows removes them (FR-037b).
- *(Superseded for Save As by FR-035a, 2026-11-19.)* Save As and Revert are reached from a text editor of the same document (Open in Editor); the CSV
  Preview Editor offers Save, Undo and Redo, which Q3 names.

## Out of Scope

- Sorting, filtering, search, formulas, cell types, formatting, frozen panes (all three issues).
- Editing workbooks; formula recalculation; charts, pivot tables, conditional formatting.
- Delimiters other than those detected in FR-022, and extensions other than `.csv` for CSV.
- Printing (#484).
- Protecting other applications from formula injection in copied CSV text.
