# Contract: the grid's menus, commands and keys (073)

## Menus (right-click, Shift+F10 or the menu key)

**Cell (CSV Preview Editor)** — sections in this order:

| Section | Items |
|---|---|
| Edit | Undo · Redo |
| Content | Cut · Copy · Copy as Rich Text · Copy as Plain Text · Paste · Clear Cells · Select All |
| Insert | Insert Row Above · Insert Row Below · Insert Column Left · Insert Column Right |
| View & state | Column Width… |
| File | Save |
| Navigate | Open in Editor / Go to Editor (044 FR-015) |

**Row header (gutter)**: Insert Row Above · Insert Row Below · Cut (removes the rows) · Copy · Paste · Reset Row Height (FR-006b). No Select Row (FR-037h).
**Column header**: Insert Column Left · Insert Column Right · Cut (clears values) · Copy · Paste · Column Width… · Reset Column Width (FR-006b). No Select Column (FR-037h).
*(Amended 2026-11-19: FR-037e, FR-006a.)*

**Spreadsheet preview**: cell menu with Copy · Copy as Rich Text · Copy as Plain Text · Select All; column
header with Column Width… only. Nothing that edits.

Copy follows `editor.previews.copyFormat` (044 FR-035b); the two named variants copy in their format
whatever it says (the constitution's *a preference picks the default; the menu offers every variant*).

## Commands (bindable, `keybindings.json`)

| Action id | Label | Default | Scope |
|---|---|---|---|
| `grid.insertRowAbove` | Insert Row Above | — | preview |
| `grid.insertRowBelow` | Insert Row Below | — | preview |
| `grid.insertColumnLeft` | Insert Column Left | — | preview |
| `grid.insertColumnRight` | Insert Column Right | — | preview |

They ship unbound (no chord collides), act on the active cell of the focused CSV Preview Editor, and are
inert elsewhere.

## Keys inside the grid

| Key | Does |
|---|---|
| Arrows, Page Up/Down, Home/End, Ctrl+Home/End | move the active cell; with Shift, extend the selection |
| Tab / Shift+Tab | move right / left |
| Enter, F2, or typing a character | open the cell editor (typing replaces the value) |
| In the cell editor: Enter / Tab / Esc | commit and move down / commit and move right / cancel |
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
