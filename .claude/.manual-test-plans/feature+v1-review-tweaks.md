# Manual test plan: v1 review tweaks

Spec: `specs/081-v1-fixes-and-tweaks/spec.md`

| ID | Title | Status | Signed off at | Date | Reason |
|---|---|---|---|---|---|
| MT-01 | Menu order and the panel title menu's groups | untested | | | |
| MT-02 | Dragging a Markdown table column | untested | | | |
| MT-03 | .gitignore outside a git repository | untested | | | |
| MT-04 | Delete Row and Delete Column in the CSV grid | untested | | | |
| MT-05 | Inserting into a blank CSV | untested | | | |
| MT-06 | Tab across the CSV grid | untested | | | |
| MT-07 | Counted inserts in the CSV grid | untested | | | |
| MT-08 | The grid's number prompt is a modal over its panel | untested | | | |
| MT-09 | Tab stays inside a panel | untested | | | |
| MT-10 | The CSV grid's menus | untested | | | |
| MT-11 | Read-only spreadsheet menus and colour | untested | | | |
| MT-12 | Copy as and Undo across the app's menus | untested | | | |
| MT-13 | Open Preview and Open in Editor | untested | | | |
| MT-14 | Select All in a preview over an existing selection | untested | | | |
| MT-15 | Every menu row shows its key | untested | | | |
| MT-16 | Setting descriptions and their Help | untested | | | |
| MT-17 | Flag icon on the Flag rows | untested | | | |
| MT-18 | Body menus hold the content, title menus the panel | untested | | | |
| MT-19 | Ctrl+Shift+N makes a folder in the File Explorer | untested | | | |

## MT-01: Menu order and the panel title menu's groups

Paths: `packages/core/src/workspace/menu-sections.ts`, `packages/ui/src/renderer/workspace/panel-header-menu.ts`

### Steps
1. Open an editor's title menu. Groups, divided: Save/Revert rows; file rows (Open Preview, Copy Path, Back, Forward, Print); the editor's language, encoding and line endings; then Split, Send to Tab, Refresh, Focus Mode, Zoom, Flag; Close Panel and Destroy Panel last.
2. Open a CSV preview's title menu. Its CSV-only row, Edit Long Cells in Dialog, sits in its own group above the panel group.
3. Open a Markdown preview's title menu. Synchronise Scrolling sits in the panel group; Go to Heading is on the body menu instead.
4. Right-click a file in the File Explorer. Delete is the last item. Right-click a tab: Close is last.

### Negative cases
- No menu shows two dividers in a row or a divider at either end.
- Every item that was on a menu before is still there.

## MT-02: Dragging a Markdown table column

Paths: `packages/ui/src/renderer/preview/table-layout.ts`

### Steps
1. Open `/data/storage/git/throng_tests/test/markdown-preview-extensions/MT-03-callout-colours.md` as a preview.
2. Drag the border between the table's two columns slowly right, then left. The border stays under the pointer the whole way; it does not jump on the first move.
3. Let go. The table keeps its overall width; the column to the right gave or took the width.

### Negative cases
- A column cannot be dragged narrower than a few characters.

## MT-03: .gitignore outside a git repository

Covers: FR-073
Paths: `packages/platform-node/src/git-ignore-oracle.ts`

### Steps
1. Open the project at `/data/storage/git/throng_tests/encodings` (not a git repository; its `.gitignore` holds `*.txt`). Every `.txt` file in the tree is faded.
2. Remove `*.txt` from that `.gitignore` and save. The `.txt` files stop fading without a reload. Put it back; they fade again.

### Negative cases
- No `.git` folder or other new file appears in the project.

## MT-04: Delete Row and Delete Column in the CSV grid

Paths: `packages/ui/src/renderer/preview/providers/csv/**`, `packages/core/src/csv/**`

### Steps
1. Open a CSV in the CSV Preview Editor. Select two rows by their numbers and right-click a row number. **Clear Cells** and **Delete Rows** sit together. Choose Delete Rows: both rows go and the panel is dirty.
2. Undo once. Both rows return.
3. Select a column by its letter, right-click the letter, choose **Delete Column**. It goes from every row, header included. Save, and open the file in an editor: that field is gone from every line.
4. Select a row by its number, right-click it, choose **Clear Cells**. The row stays, empty.

### Negative cases
- Right-clicking a cell, or the top-left corner, shows no Delete Row or Delete Column.
- With every column selected, Delete Columns is greyed out.

## MT-05: Inserting into a blank CSV

Paths: `packages/ui/src/renderer/preview/providers/csv/**`, `packages/core/src/csv/**`

### Steps
1. Create an empty `blank.csv` and open it in the CSV Preview Editor.
2. Insert a column, then a row, from the grid's right-click menu. The grid shows empty cells and the panel is dirty.
3. Save and open the file in an editor. It holds lines of empty fields separated by commas.

### Negative cases
- Clicking around the blank grid without inserting or typing leaves the file empty and clean.

## MT-06: Tab across the CSV grid

Paths: `packages/ui/src/renderer/grid/grid-selection.ts`, `packages/ui/src/renderer/grid/data-grid.tsx`

### Steps
1. In a CSV, select a cell in the last column and press **Tab**. The selection moves to the first cell of the next row.
2. Press **Shift+Tab**. It moves back to the last cell of the row above.
3. Edit a cell, type, and press **Tab**. The value is kept and the next cell along is selected, wrapping at the row's end.

### Negative cases
- Shift+Tab on the first cell, and Tab on the very last cell, leave the selection where it is and keep focus in the grid.

## MT-07: Counted inserts in the CSV grid

Paths: `packages/ui/src/renderer/preview/providers/csv/**`, `packages/ui/src/renderer/grid/grid-number-prompt.tsx`

### Steps
1. Right-click a cell and choose **Insert › Rows Below…**. A prompt asks how many, set to 1. Enter 3 and confirm: three empty rows appear below.
2. Undo once. All three go.
3. Right-click a column letter and choose **Insert › Columns Right…**, enter 2: two empty columns appear.

### Negative cases
- Typing 0, a letter or a number over 10,000 names the problem under the field and greys out the confirm button.

## MT-08: The grid's number prompt is a modal over its panel

Paths: `packages/ui/src/renderer/grid/grid-number-prompt.tsx`, `packages/ui/src/renderer/grid/grid.css`

### Steps
1. In a CSV, right-click a cell and choose **Insert › Rows Below…**. The prompt sits in the middle of the panel over a dimmed grid, with its 1 selected.
2. Type 4 straight away. The 4 replaces the 1.
3. Press **Esc**. The prompt closes and nothing is inserted. Open it again, Tab to the Cancel button and press Esc: it closes.
4. Open it again and click the dimmed grid around it. Nothing under the scrim is selected and the prompt stays.
5. With the prompt open, click into another panel and work there. That panel works; going back, the prompt is still there.
6. Right-click a column letter, choose **Column Width…**. The same centred prompt asks for the width.
7. In a spreadsheet preview, right-click a column letter and choose **Column Width…**. The same prompt.

### Negative cases
- Tab inside the prompt never leaves it.

## MT-09: Tab stays inside a panel

Paths: `packages/ui/src/renderer/common/panel-tab-stop.ts`, `packages/ui/src/renderer/workspace/panel-placeholder.tsx`, `packages/ui/src/renderer/grid/data-grid.tsx`

### Steps
1. In a CSV, select the very last cell and press **Tab**. The selection stays and focus stays in the grid.
2. Click a panel's title-bar button (for example Find in File Explorer's) and press **Tab** repeatedly, then **Shift+Tab** repeatedly. Focus moves among that panel's own controls and stops at either end; it never lands in another panel, the tab strip or the File Explorer.
3. In a Markdown preview with links, Tab through the links. At the last one, Tab does nothing more.

### Negative cases
- Tab in an editor and in a terminal still does what it did (indent, completion).

## MT-10: The CSV grid's menus

Paths: `packages/ui/src/renderer/preview/providers/csv/csv-body.tsx`, `packages/ui/src/renderer/grid/grid-menu-items.ts`, `packages/ui/src/renderer/grid/data-grid.tsx`

### Steps
1. Right-click a cell. The clipboard rows (Cut, Copy, Copy as ▸, Paste, Select All, Clear Cells) come first, then Undo and Redo in their own group. **Clear Cells** shows **Del**.
2. Hover **Copy as**: it holds Rich Text and Plain Text. Hover **Insert**: it holds the eight inserts.
3. Right-click a row number and a column letter. Each has Undo and Redo in the same place, and an **Insert** submenu with only its own direction's rows.
4. Right-click the top-left corner. Every cell is selected; the menu offers Cut, Copy, Copy as, Clear Cells, Undo, Redo, Go to Row…, Wrap, Lock First Row and Lock First Column.

### Negative cases
- The corner's menu has no Paste, Insert, Edit in Dialog…, Column Width… or Select All.

## MT-11: Read-only spreadsheet menus and colour

Paths: `packages/ui/src/renderer/preview/providers/spreadsheet/**`, `packages/ui/src/renderer/grid/grid.css`

### Steps
1. Open a workbook. Its values are drawn in a muted colour, in every theme you try.
2. Select cells and copy them; paste into a CSV grid. The values arrive.
3. Right-click a cell, a row number, a column letter and the corner. Each menu offers Copy and Copy as ▸; the cell and row menus also Select All and Go to Row…, the column menu Column Width… and Reset Column Width.

### Negative cases
- No menu shows Cut, Paste, Clear Cells, a delete or an insert, greyed or otherwise.

## MT-12: Copy as and Undo across the app's menus

Paths: `packages/ui/src/renderer/preview/content-menu.ts`, `packages/ui/src/renderer/editor/content-menu.ts`, `packages/ui/src/renderer/explorer/context-menu-items.ts`

### Steps
1. Right-click selected text in a Markdown preview and an HTML preview. **Copy as ▸** sits after Copy and holds Rich Text and Plain Text.
2. Right-click in an editor. Undo and Redo sit in their own group directly below Cut, Copy, Paste and Select All.
3. Right-click a file in the File Explorer. Undo and Redo sit in their own group directly below Cut, Copy and Paste.

### Negative cases
- No menu lists Copy as Rich Text or Copy as Plain Text as top-level rows any more.

## MT-13: Open Preview and Open in Editor

Paths: `packages/ui/src/renderer/editor/content-menu.ts`, `packages/ui/src/renderer/workspace/panel-header-menu.ts`, `packages/ui/src/renderer/preview/content-menu.ts`, `packages/ui/src/renderer/editor/status-strip.tsx`, `packages/ui/src/renderer/preview/preview-status-bar.tsx`

### Steps
1. Open a Markdown file in an editor. Its title menu offers **Open Preview**, enabled; choose it. A preview opens.
2. Back in the editor, choose **Open Preview** again. It is still enabled, and the existing preview takes focus; no second preview opens.
3. Open the preview's title menu. **Open in Editor** is enabled; it focuses the editor. Close the editor and choose it again: an editor opens.

### Negative cases
- With the Markdown preview provider turned off in Settings, Open Preview is drawn disabled with the reason.

## MT-14: Select All in a preview over an existing selection

Paths: `packages/ui/src/renderer/preview/preview-selection.ts`, `packages/ui/src/renderer/preview/preview-panel.tsx`

### Steps
1. In a Markdown preview, select a word. Right-click and choose **Select All**. The whole document is selected.
2. Select a word, then press **Ctrl+A** once. Everything is selected on that first press.
3. Select a word, click into another panel, then right-click the preview and choose **Select All**. Everything is selected.

### Negative cases
- Select a word, click into another panel and back without pressing anything: the word is still selected.

## MT-15: Every menu row shows its key

Paths: `packages/ui/src/renderer/**/*menu*`, `packages/ui/src/renderer/preview/providers/csv/csv-body.tsx`, `packages/ui/src/renderer/explorer/context-menu-items.ts`, `packages/ui/src/renderer/editor/content-menu.ts`

### Steps
1. Right-click a CSV cell, row number, column letter and the corner. **Undo** and **Redo** each show their key on every one.
2. Right-click a file in the File Explorer, in an editor, in a terminal and in a preview. Every row whose command has a key shows it.
3. Rebind a command shown on a menu (Preferences › Key Bindings), then open the menu again. It shows the new key.

### Negative cases
- A command with no key shows none, and no row shows a key that does nothing there.

## MT-16: Setting descriptions and their Help

Paths: `packages/core/src/config/settings-metadata.ts`, `docs/preferences.md`

### Steps
1. Open **Cog › Settings › Terminal › Attention**. **Bell** says in one short line what ticking it does.
2. Skim every settings group. Each row's line says what the setting does without needing anything else.
3. Click a row's (?) for Bell and two others. Help opens on that setting, leading with the same line, then more detail on what it means in throng.

## MT-17: Flag icon on the Flag rows

Paths: `packages/core/src/icons/default-set/flag.svg`, `packages/ui/src/renderer/workspace/panel-header-menu.ts`, `packages/ui/src/renderer/sidebar/project-menu.ts`

### Steps
1. Open a terminal panel's title menu. **Flag** shows a flag icon.
2. Choose **Flag**, then right-click the project in the Projects panel. **Go to Next Marked Panel** shows the same flag icon.
3. Switch to a light and a dark theme. The flag reads clearly in both.

## MT-18: Body menus hold the content, title menus the panel

Paths: `packages/ui/src/renderer/workspace/panel-header-menu.ts`, `packages/ui/src/renderer/editor/content-menu.ts`, `packages/ui/src/renderer/preview/content-menu.ts`, `packages/ui/src/renderer/preview/providers/csv/csv-menu.ts`, `packages/ui/src/renderer/preview/providers/spreadsheet/spreadsheet-menu.ts`, `packages/ui/src/renderer/terminal/terminal-content-menu.ts`

### Steps
1. Right-click in an editor's text. No Split, Open Preview, Print…, Synchronise Scrolling, language, encoding or line-ending rows; Find, Replace and Replace All are there.
2. Open the same editor's title menu. Copy Path ▸, Set Language…, Encoding and Line Endings are there; Find, Replace and Replace All are not.
3. Right-click in a Markdown preview's text, on an image and on a Mermaid diagram. No Split, Copy Path, Open in Editor, Print… or Synchronise Scrolling. The diagram still offers Copy Diagram as Image and its own Enter Focus Mode.
4. Open the preview's title menu. Copy Path ▸ and Open in Editor are there; Find… and Go to Heading… are not.
5. In a CSV preview, right-click a cell, a row number, a column letter, the corner, and the blank area below the grid. None offers Open in Editor, Print…, Save or Save As…; every grid menu offers Wrap, Lock First Row and Lock First Column.
6. Open the CSV preview's title menu. Open in Editor, Save and Save As… are there; Go to Row…, Wrap and the two Lock rows are not.
7. Right-click in a terminal. Find is there; Split, Refresh / redraw terminal and the Remember Command, Remember Directory and Notifications toggles are not. Open its title menu: the three toggles are there, with their keys, and Find is not.
8. Right-click in a blank panel that has no type yet. No menu opens.

### Negative cases
- Every row that left one menu is on the other: nothing a menu used to offer is unreachable.

## MT-19: Ctrl+Shift+N makes a folder in the File Explorer

Paths: `packages/core/src/config/keybindings.ts`, `packages/core/src/config/keybindings-metadata.ts`, `packages/ui/src/renderer/explorer/explorer-keybindings.ts`, `packages/ui/src/renderer/explorer/context-menu-items.ts`, `packages/ui/src/renderer/explorer/toolbar.tsx`

### Steps
1. In the File Explorer, select a folder and press **Ctrl+Shift+N**. A new folder appears inside it with its name box open; type a name and press Enter.
2. Select a file and press **Ctrl+Shift+N**. The new folder appears beside the file.
3. Right-click a folder. **New Folder** shows **Ctrl+Shift+N**. Hover the toolbar's New folder button: its title reads "New folder (Ctrl+Shift+N)".
4. Open **Cog › Key Bindings › File Explorer**. **New folder** is listed with Ctrl+Shift+N. Rebind it to another key; the menu row and the toolbar title show the new key, and it works in the tree.

### Negative cases
- With focus in an editor or a terminal, Ctrl+Shift+N makes no folder.

