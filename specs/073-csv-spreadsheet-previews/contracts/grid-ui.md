# Contract: the grid's menus, commands and keys (073)

## Menus (right-click, Shift+F10 or the menu key)

*(Rewritten 2026-11-27, maintainer's v1 review — FR-037j, FR-008b, FR-050c. Earlier amendment notes are kept below
the tables.)*

**Cell (CSV Preview Editor)** — sections in this order, a divider between groups:

| Section | Items |
|---|---|
| Content | Cut · Copy · Copy as ▸ (Rich Text, Plain Text) · Paste · Select All · Clear Cells (Del) |
| | Undo · Redo |
| | Edit in Dialog… (FR-036a) |
| Create | Insert ▸ (Row Above, Row Below, Column Left, Column Right · Rows Above…, Rows Below…, Columns Left…, Columns Right…) |
| Navigate | Go to Row… |
| View & state | Column Width… |
| | Wrap ✓ · Lock First Row ✓ · Lock First Column ✓ |

**Row header (gutter)**: Cut (removes the rows) · Copy · Copy as ▸ · Paste · Clear Cells · Delete Row(s) | Undo ·
Redo | Insert ▸ (Row Above, Row Below · Rows Above…, Rows Below… · Copied Rows Above/Below while whole rows are on
the clipboard) | Go to Row… | Wrap · Lock First Row · Lock First Column. No Select Row (FR-037h), no Reset Row Height
(FR-006c).

**Column header**: Cut (clears values) · Copy · Copy as ▸ · Paste · Clear Cells · Delete Column(s) | Undo · Redo |
Insert ▸ (Column Left, Column Right · Columns Left…, Columns Right… · Copied Columns Left/Right) | Column Width… ·
Reset Column Width | Wrap · Lock First Row · Lock First Column. No Select Column (FR-037h).

**Select-all corner** (FR-008b): Cut · Copy · Copy as ▸ · Clear Cells | Undo · Redo | Go to Row… | Wrap · Lock First
Row · Lock First Column. Nothing that acts on the active cell, a row or a column.

*(Amended 2026-11-28, v1 review, #732: Save, Save As…, Open in Editor and Print… left every grid menu for the panel title menu, which draws Save and Save As… in Content for a CSV Preview Editor (FR-035a). Wrap, Lock First Row and Lock First Column left the title menu for every grid menu, as checked rows in View & state (FR-013, FR-039a). The title menu no longer offers Go to Row….)*

*(Amended 2026-11-19: FR-037e, FR-006a.)*
*(Amended 2026-11-27, maintainer review on 081: Delete Row(s) and Delete Column(s) act on whole selected rows or columns, one undo step each, and are drawn disabled with the reason otherwise; a file keeps at least one column. A blank file takes Insert Row and Insert Column, writing records of empty fields. Later the same day: the deletes appear only on the row and column header menus, never on the cell or select-all menu (an exception to drawn-disabled, at the maintainer's request); the header menus carry Clear Cells; the counted inserts ask how many, 1 to 10,000, each one undo step. Commands `grid.deleteRows` and `grid.deleteColumns`, unbound.)*

**The number prompt** (Column Width…, the counted inserts): a modal over the grid's own panel. A scrim covers the
grid and takes every press; the prompt sits in its middle with its number selected; Tab stays inside it; Enter
applies; Esc or Cancel closes. Other panels stay usable (FR-006, amended 2026-11-27).

**Spreadsheet preview** (read-only, FR-050c as superseded 2026-11-27): cell and row header menus with Copy ·
Copy as ▸ · Select All · Go to Row…; column header with Copy · Copy as ▸ · Column Width… · Reset Column
Width; the corner with Copy · Copy as ▸ · Go to Row…; every one then Wrap · Lock First Row · Lock First Column
where the provider has them. Nothing that edits, not even disabled. Its values are drawn in the theme's muted text
colour. *(Amended 2026-11-28, v1 review, #732: Print… left these menus for the panel title menu.)*

Copy follows `editor.previews.copyFormat` (044 FR-035b); the two named variants copy in their format
whatever it says (the constitution's *a preference picks the default; the menu offers every variant*).

## Commands (bindable, `keybindings.json`)

| Action id | Label | Default | Scope |
|---|---|---|---|
| `grid.insertRowAbove` | Insert Row Above | — | preview |
| `grid.insertRowBelow` | Insert Row Below | — | preview |
| `grid.insertColumnLeft` | Insert Column Left | — | preview |
| `grid.insertColumnRight` | Insert Column Right | — | preview |
| `grid.insertRowsAbove` | Insert Rows Above… | — | preview |
| `grid.insertRowsBelow` | Insert Rows Below… | — | preview |
| `grid.insertColumnsLeft` | Insert Columns Left… | — | preview |
| `grid.insertColumnsRight` | Insert Columns Right… | — | preview |
| `grid.deleteRows` | Delete Rows | — | preview |
| `grid.deleteColumns` | Delete Columns | — | preview |

They ship unbound (no chord collides), act on the active cell of the focused CSV Preview Editor, and are
inert elsewhere.

## Keys inside the grid

| Key | Does |
|---|---|
| Arrows, Page Up/Down, Home/End, Ctrl+Home/End | move the active cell; with Shift, extend the selection |
| Tab / Shift+Tab | move right / left, wrapping between rows; Tab at the last cell and Shift+Tab at the first both stay |
| Enter, F2, or typing a character | open the cell editor (typing replaces the value) |
| In the cell editor: Enter / Tab / Shift+Tab / Esc | commit and move down / commit and move right / commit and move left / cancel |
| In the cell editor: Shift+Enter or Alt+Enter | insert a line break in the value |
| Delete | clear the selected cells |
| Ctrl+C / Ctrl+X / Ctrl+V | copy / cut / paste (the platform clipboard gestures) |
| Ctrl+A | select every cell |
| Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z | undo / redo — the text editor's own fixed chords |
| Ctrl+S | save — the `editor.save` binding, routed by the active panel |

The preview's shared status bar is unchanged (SC-008); the active cell is shown by its highlighted
column letter and row number.

## Menus, amended 2026-11-19

- Cell, selection, row header and column header menus each carry **Cut**, **Copy**, **Paste** (FR-037e);
  the spreadsheet preview carries **Copy** only. Cut on whole columns clears values.
- Paste lands at the selection's top-left (column A for whole rows); one value fills a multi-cell
  selection (FR-037f).
- Column header and row header menus carry **Reset Size** (FR-006a).

## Pointer (2026-11-19)

| Gesture | Where | Effect |
|---|---|---|
| Double-click | column header or its resize edge | Fit the column to its widest value; again restores the width before the fit (FR-011) |
| Double-click | row header | Expand the row to show its values in full; again collapses it (FR-012) |
| Double-click | cell (CSV Preview Editor) | Open the in-cell editor with all its text selected (FR-043) |

Inside an open in-cell editor, arrows, Home, End, Ctrl+Home and Ctrl+End move the caret and never the
active cell (FR-043).
