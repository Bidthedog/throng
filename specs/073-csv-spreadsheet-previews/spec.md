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
  Both grids. (FR-012, refining FR-004 for an expanded row)
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
   **When** they double-click it again, **Then** it is one line high again (FR-012).

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
   double-click undoes it, exactly as in the CSV Preview Editor (FR-011, FR-012).

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
  for an expanded row, 2026-11-19.)*
- **FR-005**: Every cell value MUST be rendered as text, never interpreted as markup, a link or a formula.
- **FR-006**: Columns MUST be resizable by dragging the header strip's column edge, and by keyboard from
  the column header's menu (**Column Width…**).
- **FR-006a** *(Q13, 2026-11-19)*: A column header's right-click menu MUST offer **Reset Size**, returning
  the column to the default width and removing its stored width (FR-040). A row header's menu MUST offer
  **Reset Size**, collapsing an expanded row (FR-012) to one line. Both grids.
- **FR-007**: The grid MUST take its colours, fonts and selection highlight from the active theme's
  tokens, and MUST follow the panel's zoom (044 FR-034).
- **FR-008**: The grid MUST be navigable from the keyboard: arrows, Page Up/Down, Home/End,
  Ctrl+Home/End, and Shift with any of them to extend a selection.
- **FR-008a** *(Q14, 2026-11-19)*: Selecting with the pointer (a cell, a drag, a row number, a column letter,
  a right-click) MUST NOT scroll the grid; only keyboard movement (FR-008) brings the active cell into view.
  A whole-column selection's active cell MUST be its top row. Both grids.
- **FR-009**: The grid's code, the CSV parser and the workbook library MUST load only when a grid is
  first needed; application startup MUST load none of it (as 054 FR-047 does for diagrams).
- **FR-010**: Every library this feature adds MUST meet #10's bar: actively maintained, under a licence
  compatible with AGPL-3.0-only distribution, and safe against untrusted local content. Each choice and
  its licence MUST be recorded in research.
- **FR-011** *(Q6, 2026-11-19)*: Double-clicking a column header, or its resize edge, MUST set the column
  to the width of its widest value across every row, header label included, clamped to 40–2000 px at zoom
  1 and stored as FR-040 stores a width. Double-clicking a column that the previous double-click fitted
  MUST restore the width it had before the fit. Both grids.
- **FR-012** *(Q7, 2026-11-19)*: Double-clicking a row header MUST expand that row so each of its cells
  shows its full value, line breaks honoured and wrapped within its column's width, the row as tall as its
  tallest cell up to 20 lines, a taller cell scrolling inside itself. Double-clicking an expanded row's
  header MUST collapse it to one line. Expansion lasts for the life of the panel and is not persisted.
  Both grids.

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
  Back/Forward: the other CSV opens in a new panel instead.
- **FR-034**: *Withdrawn (clarification Q1).* No view switch, so no cursor mapping across one.
- **FR-035**: Every grid edit MUST be a change to the document through the document's authority
  (Principle XI, *one authority, not two peers*), so it appears in every view of the document and in the
  shared undo history. **Undo**, **Redo** and **Save** MUST work in the CSV Preview Editor by their
  editor chords and from its right-click menu, and Auto Save (`editor.autoSave`) MUST save grid edits as
  it saves text edits. *(Supersedes 044 FR-021 for these three commands on the CSV provider.)*
- **FR-036**: Editing a cell: typing on a selected cell or pressing F2 or Enter MUST open an in-cell
  editor; Enter commits and moves down, Tab commits and moves right, Esc cancels. Delete on a cell
  selection MUST clear their values.
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
- **FR-038**: A row header's right-click menu MUST offer **Insert Row Above** and **Insert Row Below**; a
  column header's MUST offer **Insert Column Left** and **Insert Column Right**. Each MUST also be a
  bindable command acting on the active cell (every panel action has a menu item, and the reverse).
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
- Save As and Revert are reached from a text editor of the same document (Open in Editor); the CSV
  Preview Editor offers Save, Undo and Redo, which Q3 names.

## Out of Scope

- Sorting, filtering, search, formulas, cell types, formatting, frozen panes (all three issues).
- Editing workbooks; formula recalculation; charts, pivot tables, conditional formatting.
- Delimiters other than those detected in FR-022, and extensions other than `.csv` for CSV.
- Printing (#484).
- Protecting other applications from formula injection in copied CSV text.
