[throng](../README.md) › [Docs](README.md) › Key bindings

# Key bindings

Every default key binding throng ships with, in the groups the **Key Bindings** editor shows them
in. Every one of them can be rebound, removed or given extra chords in **Preferences → Key
Bindings** (title-bar cog → **Key Bindings**); see [Rebinding and resetting](#rebinding-and-resetting).

Each command has a section of its own: its label, its **action id** (its name in
`keybindings.json`), its one-line description as the Key Bindings tab shows it, its default chord or chords,
and its **scope**: where the chord is live. The **?** beside a command in the Key Bindings tab opens its section.

| Scope | Live while focus is in |
|---|---|
| **Everywhere** | Any surface: an editor, a preview, a terminal, a Find in Files panel, File Explorer or the Projects pane |
| **Editor** | An editor panel |
| **Preview** | A preview panel |
| **Terminal** | A terminal panel |
| **Find in Files** | A Find in Files results panel |
| **File Explorer** | The File Explorer pane |

A command live in several places lists each of them. throng acts on a chord only where its command
is live. Anywhere else, the key goes to whatever has focus, a shell included.

These are the defaults on Windows and Linux. [The focus moves need the keypad on Linux](linux.md#key-bindings), because the desktop keeps the arrow keys. On a Mac, Cmd takes Ctrl's place in every application chord: see [On macOS](#on-macos).

## How the defaults are laid out

The modifiers say how far a chord reaches:

- **Ctrl+Shift+Alt+key**: getting around and the whole window: moving between panes, panels, tabs,
  projects and notices, showing or hiding a side pane, and the window's zoom.
- **Ctrl+Alt+key** or **Ctrl+Shift+key**: the panel or pane that has focus, as a frame
  (its zoom, for instance).
- **One modifier, or none**: the content: editing, finding, saving, file operations.

A handful of long-standing chords break that pattern, because every other editor uses them or a
terminal needs them: `Ctrl+Shift+T` Quick Open,
`Ctrl+Shift+F` / `Ctrl+Shift+H` Find / Replace in Files, `Ctrl+Shift+S` Save All, `Ctrl+Alt+S`
Save As, `Ctrl+Alt+Enter` Replace All, `` Ctrl+` `` / `` Ctrl+Shift+` `` panel cycling, `Ctrl+E,W`
word wrap, `Shift+Alt+Arrow` column selection, the function keys (`F2`, `F3`, `F11`, `Shift+F10`)
and the Menu key.

**Keys a shell needs are left alone.** `Ctrl+C`, `Ctrl+D`, `Ctrl+Z`, `Ctrl+A`, `Ctrl+E`, `Ctrl+W`,
`Ctrl+U`, `Ctrl+K`, `Ctrl+R`, `Ctrl+L` and `Ctrl+Q` are never bound where a terminal is live. Where a
default uses one of them (`Ctrl+C`/`Ctrl+Z` in File Explorer, `Ctrl+G` and `Ctrl+E,W` in an editor),
its scope keeps it out of every terminal, so the shell still receives the key.

**Where a chord names `+`, it means the `+` key.** `Ctrl+Shift+Alt++` is Ctrl, Shift and Alt held
with the key that shares `=` on a UK or US keyboard. The keypad `+` and `-` are the same binding as
their main-row keys, so either fires it. The keypad `0` is **not** the same as the main-row `0`:
`Numpad0` in a chord means the keypad zero only.

**Two entries that look like a clash are not one.** `Ctrl+X` is *Cut* in File Explorer and *Cut
line* in an editor. Their scopes never overlap, so only one fires. That is why the Key Bindings editor shows each row's
scope.

## Zoom

The whole window's zoom. You reach it from the keyboard alone: it has no menu or mouse route.

### Zoom in

**Cog › Key Bindings › Zoom**

`zoom.in`

Increase the interface zoom level.

**Default:** `Ctrl+Shift+Alt++` · **Scope:** Everywhere

### Zoom out

**Cog › Key Bindings › Zoom**

`zoom.out`

Decrease the interface zoom level.

**Default:** `Ctrl+Shift+Alt+-` · **Scope:** Everywhere

### Reset zoom

**Cog › Key Bindings › Zoom**

`zoom.reset`

Return the interface zoom to 100%.

**Default:** `Ctrl+Shift+Alt+Numpad0` · **Scope:** Everywhere

Return the interface zoom to 100%. The keypad zero only: the main-row `0` does not reset the window zoom, and a keyboard with no keypad has no keyboard route to it.

## Focus & Zoom

The focused panel's own zoom, and moving keyboard focus. Panel zoom is **per panel type**: every
terminal, every editor and every Find in Files panel zooms on its own, on top of the window zoom,
and the level persists with your layout.

### Zoom panel type in

**Cog › Key Bindings › Focus & Zoom**

`panel.zoomIn`

Increase the text size of every panel of the active panel's type.

**Default:** `Ctrl+Alt++`, `Ctrl+WheelUp` · **Scope:** Everywhere

Increase the text size of every panel of the active panel's type. Ctrl+wheel acts on the panel under the pointer. With keyboard focus inside a diagram in a preview, this and the two zoom commands below zoom that diagram alone (the reset, and Ctrl+middle-click, return it to Fit); Ctrl+wheel zooms it about the pointer.

### Zoom panel type out

**Cog › Key Bindings › Focus & Zoom**

`panel.zoomOut`

Decrease the text size of every panel of the active panel's type.

**Default:** `Ctrl+Alt+-`, `Ctrl+WheelDown` · **Scope:** Everywhere

Decrease the text size of every panel of the active panel's type. Also reachable by holding Ctrl and scrolling down over a panel.

### Reset panel type zoom

**Cog › Key Bindings › Focus & Zoom**

`panel.zoomReset`

Return the active panel's type to its default text size.

**Default:** `Ctrl+Alt+Numpad0`, `Ctrl+Alt+0`, `Ctrl+MiddleClick` · **Scope:** Everywhere

Return the active panel's type to its default text size: the keypad zero, the main-row zero, or a Ctrl+middle-click over the panel.

### Split Down

**Cog › Key Bindings › Focus & Zoom**

`panel.splitDown`

Split the active panel in two and put a new empty panel below it.

**Default:** `Ctrl+Shift+Alt+End,ArrowDown` · **Scope:** Everywhere

### Split Up

**Cog › Key Bindings › Focus & Zoom**

`panel.splitUp`

Split the active panel in two and put a new empty panel above it.

**Default:** `Ctrl+Shift+Alt+End,ArrowUp` · **Scope:** Everywhere

### Split Right

**Cog › Key Bindings › Focus & Zoom**

`panel.splitRight`

Split the active panel in two and put a new empty panel to its right.

**Default:** `Ctrl+Shift+Alt+End,ArrowRight` · **Scope:** Everywhere

### Split Left

**Cog › Key Bindings › Focus & Zoom**

`panel.splitLeft`

Split the active panel in two and put a new empty panel to its left.

**Default:** `Ctrl+Shift+Alt+End,ArrowLeft` · **Scope:** Everywhere

### Destroy Panel

**Cog › Key Bindings › Focus & Zoom**

`panel.destroy`

Destroy the focused panel, as its Destroy menu item does. A preview closes instead.

**Default:** `Ctrl+Shift+Alt+F4` · **Scope:** Everywhere

Destroy the focused panel of any type, a terminal included, as its menu's Destroy (or Close) does, confirmations and all. Does nothing while a side pane has focus.

### Toggle Focus Mode

**Cog › Key Bindings › Focus & Zoom**

`panel.toggleMaximise`

Focus Mode: let the focused panel fill its tab's middle section, or step back out of it.

**Default:** `Shift+Alt+Enter` · **Scope:** Everywhere

Focus Mode: let the focused panel fill its tab's middle section (Enter Focus Mode), or step back out of it one level at a time (Exit Focus Mode). While it is on, the panel's status bar shows it, the tab's other panels hide, and the panel cannot be split, moved or destroyed. In a terminal this chord no longer reaches the program; `Shift+Enter` still sends a line break.

### Focus panel to the left

**Cog › Key Bindings › Focus & Zoom**

`focus.left`

Move the active panel focus to the adjacent panel on the left.

**Default:** `Ctrl+Shift+Alt+ArrowLeft` · **Scope:** Everywhere

Move focus to the adjacent panel on the left.

### Focus panel to the right

**Cog › Key Bindings › Focus & Zoom**

`focus.right`

Move the active panel focus to the adjacent panel on the right.

**Default:** `Ctrl+Shift+Alt+ArrowRight` · **Scope:** Everywhere

Move focus to the adjacent panel on the right.

### Focus panel above

**Cog › Key Bindings › Focus & Zoom**

`focus.up`

Move the active panel focus to the adjacent panel above.

**Default:** `Ctrl+Shift+Alt+ArrowUp` · **Scope:** Everywhere

Move focus to the adjacent panel above.

### Focus panel below

**Cog › Key Bindings › Focus & Zoom**

`focus.down`

Move the active panel focus to the adjacent panel below.

**Default:** `Ctrl+Shift+Alt+ArrowDown` · **Scope:** Everywhere

Move focus to the adjacent panel below.

### Cycle focus forward

**Cog › Key Bindings › Focus & Zoom**

`focus.cycle`

Move focus to the next panel in layout order, wrapping at the end.

**Default:** `` Ctrl+` `` · **Scope:** Everywhere

### Cycle focus backward

**Cog › Key Bindings › Focus & Zoom**

`focus.cycleBack`

Move focus to the previous panel in layout order, wrapping at the start.

**Default:** `` Ctrl+Shift+` `` · **Scope:** Everywhere

### Focus the most recent notice

**Cog › Key Bindings › Focus & Zoom**

`focus.notice`

Move focus to the newest notice on screen, so its list can be read and scrolled by keyboard.

**Default:** `Ctrl+Shift+Alt+V` · **Scope:** Everywhere

Move focus to the newest notice on screen so its list can be read and scrolled by keyboard; **Esc** returns you to where you were. Does nothing when there is no notice.

### Focus File Explorer

**Cog › Key Bindings › Focus & Zoom**

`focus.explorer`

Move keyboard focus straight to the File Explorer pane.

**Default:** `Ctrl+Shift+Alt+M` · **Scope:** Everywhere

### Focus Projects

**Cog › Key Bindings › Focus & Zoom**

`focus.projects`

Move keyboard focus straight to the Projects pane.

**Default:** `Ctrl+Shift+Alt+B` · **Scope:** Everywhere

### Focus Workspace

**Cog › Key Bindings › Focus & Zoom**

`focus.workspace`

Move keyboard focus back to the active panel in the centre workspace.

**Default:** `Ctrl+Shift+Alt+N` · **Scope:** Everywhere

Move keyboard focus back to the active panel in the centre workspace, without switching tab, panel or project.

The three focus chords run left to right as the surfaces do: **B** Projects, **N** the workspace,
**M** File Explorer. The directional moves act from the focused panel and do nothing while a side
pane has focus; the caret moves with focus, into whichever control in that panel last had it.
**Ctrl+Wheel** over the title bar or a side pane does nothing, and it never scrolls the panel.

**Split mode.** `Ctrl+Shift+Alt+End` puts the active panel into split mode: its border pulses and its
status bar says the chord is waiting. An arrow key, or the keypad's 8, 2, 4 or 6 with NumLock on or
off, then splits the panel that way, with Ctrl+Shift+Alt still held or already released. **Esc** leaves split mode without splitting; any other
key, the chord timeout, or focus moving elsewhere ends it too. Neither key reaches a terminal. The same
four splits are on every panel's **+** button and in its **Split** menu.

## View

### Toggle fullscreen

**Cog › Key Bindings › View**

`view.fullscreen`

Enter or leave fullscreen mode.

**Default:** `F11` · **Scope:** Everywhere

### Toggle Projects sidebar

**Cog › Key Bindings › View**

`view.toggleProjects`

Show or hide the Projects & Sub-workspaces sidebar pane.

**Default:** `Ctrl+Shift+Alt+J` · **Scope:** Everywhere

Show or hide the Projects & Sub-workspaces pane.

### Toggle File Explorer

**Cog › Key Bindings › View**

`view.toggleExplorer`

Show or hide the File Explorer pane.

**Default:** `Ctrl+Shift+Alt+K` · **Scope:** Everywhere

### Resource Monitor

**Cog › Key Bindings › View**

`view.resourceMonitor`

Open the Resource Monitor: what throng and everything it started is using.

**Default:** `Ctrl+Shift+Alt+Y` · **Scope:** Everywhere

Open the [Resource Monitor](../site/guide/resources.md#find-what-is-using-the-most): what throng and everything it started is using, in its own window; brings it forward when it is already open.

### Next Project

**Cog › Key Bindings › View**

`project.next`

Switch to the next project in the Projects pane, skipping any minimised category.

**Default:** `Ctrl+Shift+Alt+PageDown` · **Scope:** Everywhere

Switch to the next project in the Projects pane, skipping the hidden projects of a minimised category (its loaded projects stay listed and are included) and stopping at the end.

### Previous Project

**Cog › Key Bindings › View**

`project.previous`

Switch to the previous project in the Projects pane, skipping any minimised category.

**Default:** `Ctrl+Shift+Alt+PageUp` · **Scope:** Everywhere

Switch to the previous project, skipping the hidden projects of a minimised category and stopping at the start.

### Open context menu

**Cog › Key Bindings › View**

`menu.open`

Open the focused item’s context menu from the keyboard (024 US6).

**Default:** `Shift+F10`, `ContextMenu` · **Scope:** Everywhere

Open the focused item's context menu from the keyboard. `ContextMenu` is the Menu key.

## Application

### Help

**Cog › Key Bindings › Application**

`help.open`

Open the user guide's start page in throng's Help window.

**Default:** `F1` · **Scope:** Everywhere except a terminal

Open the user guide in throng's Help window, at its start page: the guide that ships with this copy of throng, so it works offline. There is one Help window; F1 brings it forward if it is open. In a terminal, F1 goes to the program running there; the cog menu's **Help** still works.

### Open Settings

**Cog › Key Bindings › Application**

`app.settings`

Open Preferences at its Settings tab.

**Default:** `Cmd+,` · **Scope:** Everywhere

macOS only: open Preferences at its Settings tab.

### Install 'throng' command

**Cog › Key Bindings › Application**

`app.installCommandLine`

Put the throng command on your PATH, so throng opens a folder from a terminal.

**Default:** none · **Scope:** Everywhere

macOS only: put the `throng` command on your path, so throng opens a folder from a terminal ([how](install-macos.md#the-throng-command)).

### Uninstall 'throng' command

**Cog › Key Bindings › Application**

`app.uninstallCommandLine`

Take the throng command off your PATH. throng removes it only when it points at throng.

**Default:** none · **Scope:** Everywhere

macOS only: take the `throng` command off your path. Only a command that points at throng is removed.

## Tabs

### Rename tab

**Cog › Key Bindings › Tabs**

`tabs.rename`

Start renaming the active tab from any panel, a terminal included.

**Default:** `Ctrl+Shift+Alt+F2` · **Scope:** Everywhere

Start renaming the active tab from any panel, a terminal included. Focus returns to the panel afterwards.

### Open tab picker

**Cog › Key Bindings › Tabs**

`tabs.openPicker`

Open a searchable list of every tab in the window and jump to the one you choose.

**Default:** `Ctrl+Shift+Alt+T` · **Scope:** Everywhere

Open a searchable list of every tab in the window: type to filter, **Up**/**Down** to move, **Enter** to choose. Works at any tab count, from a focused terminal too.

## Navigate

### Quick Open

**Cog › Key Bindings › Navigate**

`navigate.quickOpen`

Open any file in the current project by typing part of its path.

**Default:** `Ctrl+Shift+T` · **Scope:** Everywhere

Open any file in the current project by typing part of its name or path; **Enter** opens it.

### Go To Line

**Cog › Key Bindings › Navigate**

`navigate.gotoLine`

Jump to a line number in the focused editor. Editors only.

**Default:** `Ctrl+G` · **Scope:** Editor

Open the Go to dialog in the focused editor: it reads "Line 3 of 120", takes only a line that exists, and Enter goes there. A terminal keeps its own `Ctrl+G`.

### Go to next flagged panel

**Cog › Key Bindings › Navigate**

`focus.nextMarkedPanel`

Focus the next panel marked as needing you, switching project if it is in another.

**Default:** `Ctrl+Shift+Alt+G` · **Scope:** Everywhere

Focus the next panel marked as needing you, switching project if it is in another. Does nothing when no panel is marked. Works from a focused terminal. Also in the right-click menu of a project that has a marked panel, where it goes to that project's next marked panel.

### Open Preview

**Cog › Key Bindings › Navigate**

`preview.open`

Open a rendered preview of the focused editor's file or the selected file. Unbound by default.

**Default:** *(unbound)* · **Scope:** Editor · File Explorer

Open a rendered preview of the focused editor's file, or of the file selected in File Explorer.

### Back

**Cog › Key Bindings › Navigate**

`navigate.back`

Show the previous file in the focused editor or preview's history.

**Default:** `Alt+ArrowLeft` · **Scope:** Editor · Preview

Show the previous file in the focused editor or preview's history. In an editor this takes the key from moving by syntax.

### Forward

**Cog › Key Bindings › Navigate**

`navigate.forward`

Show the next file in the focused editor or preview’s history, after going Back.

**Default:** `Alt+ArrowRight` · **Scope:** Editor · Preview

Show the next file in the focused editor or preview's history, after going Back.

### Open Link

**Cog › Key Bindings › Navigate**

`preview.followLink`

Open the link under the caret in an editor, or the focused link in a preview.

**Default:** `Ctrl+Enter` · **Scope:** Editor · Preview

Open the link under the caret in an editor, or the focused link in a preview, as Ctrl+click does. In an editor with no link under the caret it keeps the editor's own meaning.

### Go to Heading, Page or Row…

**Cog › Key Bindings › Navigate**

`preview.goToHeading`

Jump to a heading in a preview; in a PDF, Go to Page; in a CSV or spreadsheet, Go to Row.

**Default:** `Ctrl+G` · **Scope:** Preview

Open a searchable list of the preview's headings over the document and jump to one. Pressed again while the list is open, it returns to the list's search box. In a CSV or workbook grid it is Go to Row: it opens the Go to dialog for rows (also **Go to Row…** on the panel header menu and the cell and row-number menus): Enter makes that row the active cell in the active column and scrolls it to the top. In a PDF preview, Go to Page: type a page number (the dialog names the current page and how many there are, and takes only a page that exists) and press Enter.

### Print…

**Cog › Key Bindings › Navigate**

`preview.print`

Open Print Preview for the active preview. Previews only.

**Default:** `Ctrl+P` · **Scope:** Preview

Open Print Preview for the active preview, to choose a printer and page settings and see the pages before printing. Live in a preview only.

Open Print Preview for the active preview (every type but HTML): choose a printer, paper, orientation, margins, scale, centring, pages and copies, see the pages as they will print, then print them or save them as a PDF. It never prints without showing Print Preview first.

The mouse's own back and forward buttons do the same as **Back** and **Forward** over an editor or
preview panel; they are not a rebindable chord.

**Open Link is not live in a terminal**, where `Ctrl+Enter` reaches the program. That is also why
a terminal link's **Open Link** menu item shows no shortcut. In a terminal, a link is followed with
Ctrl+click or from its Link menu. Where a followed link goes is described with the link settings in
[Preferences → Editor → Links](preferences.md#links).

## File Explorer

Live only while the File Explorer pane has focus.

### Rename

**Cog › Key Bindings › File Explorer**

`file.rename`

Rename the selected file or folder.

**Default:** `F2` · **Scope:** File Explorer

### Undo file operation

**Cog › Key Bindings › File Explorer**

`file.undo`

Reverse the last move, rename, delete or replacing paste made in the file tree.

**Default:** `Ctrl+Z` · **Scope:** File Explorer

Reverse the last move, rename, delete or replacing paste made in the file tree; a move between projects undoes from either project.

### Redo file operation

**Cog › Key Bindings › File Explorer**

`file.redo`

Redo the last file operation you undid.

**Default:** `Ctrl+Y` · **Scope:** File Explorer

### Cut

**Cog › Key Bindings › File Explorer**

`file.cut`

Cut the selected file or folder.

**Default:** `Ctrl+X` · **Scope:** File Explorer

### Copy

**Cog › Key Bindings › File Explorer**

`file.copy`

Copy the selected file or folder.

**Default:** `Ctrl+C` · **Scope:** File Explorer

### Paste

**Cog › Key Bindings › File Explorer**

`file.paste`

Paste into the selected folder, from this project or another.

**Default:** `Ctrl+V` · **Scope:** File Explorer

### Delete

**Cog › Key Bindings › File Explorer**

`file.delete`

Delete the selected file or folder.

**Default:** `Delete` · **Scope:** File Explorer

Delete the selected file or folder to the Recycle Bin or for good, per [Delete files to](preferences.md#file-explorer).

## Editor

### Save

**Cog › Key Bindings › Editor**

`editor.save`

Save the active editor document.

**Default:** `Ctrl+S` · **Scope:** Editor · Terminal

Save the active editor document. Inert in a terminal.

### Save all

**Cog › Key Bindings › Editor**

`editor.saveAll`

Save all open editor documents in scope.

**Default:** `Ctrl+Shift+S` · **Scope:** Editor · Terminal

Save all open editor documents in scope. See [Save-All scope](preferences.md#editor).

### Save as

**Cog › Key Bindings › Editor**

`editor.saveAs`

Save the active document to a new location.

**Default:** `Ctrl+Alt+S` · **Scope:** Editor · Terminal

### Print…

**Cog › Key Bindings › Editor**

`editor.print`

Open Print Preview for the active editor's document, unsaved changes included.

**Default:** `Ctrl+P` · **Scope:** Editor

Open Print Preview for the active editor's document, unsaved changes included, to choose a printer and page settings and see the pages before printing. Live in an editor only.

Open Print Preview for the active editor's document, unsaved changes included: its text in the editor's font, syntax-highlighted in print colours, long lines wrapped. It never prints without showing Print Preview first. Never live in a terminal, where `Ctrl+P` is the shell's.

### Cut line

**Cog › Key Bindings › Editor**

`editor.cutLine`

Cut the selection, or the cursor's whole line when you have no selection.

**Default:** `Ctrl+X` · **Scope:** Editor

Cut the whole line the cursor sits on when you have no selection, or the selection when you have one.

### Indent

**Cog › Key Bindings › Editor**

`editor.indentLines`

Indent every line the selection touches, or insert one level of indentation at the cursor.

**Default:** `Tab` · **Scope:** Editor

### Outdent

**Cog › Key Bindings › Editor**

`editor.outdentLines`

Remove one level of indentation from every line the selection touches.

**Default:** `Shift+Tab` · **Scope:** Editor

### Column select up

**Cog › Key Bindings › Editor**

`editor.columnSelectUp`

Extend a rectangular selection one line upwards.

**Default:** `Shift+Alt+ArrowUp` · **Scope:** Editor

### Column select down

**Cog › Key Bindings › Editor**

`editor.columnSelectDown`

Extend a rectangular selection one line downwards.

**Default:** `Shift+Alt+ArrowDown` · **Scope:** Editor

### Column select left

**Cog › Key Bindings › Editor**

`editor.columnSelectLeft`

Extend a rectangular selection one column to the left.

**Default:** `Shift+Alt+ArrowLeft` · **Scope:** Editor

### Column select right

**Cog › Key Bindings › Editor**

`editor.columnSelectRight`

Extend a rectangular selection one column to the right.

**Default:** `Shift+Alt+ArrowRight` · **Scope:** Editor

### Toggle word wrap

**Cog › Key Bindings › Editor**

`editor.toggleWordWrap`

Wrap or unwrap long lines in the focused editor's document (024 US1).

**Default:** `Ctrl+E,W` · **Scope:** Editor

Wrap or unwrap long lines in the focused editor's document: hold Ctrl, press **E**, then **W**.

### Synchronise Scrolling

**Cog › Key Bindings › Editor**

`preview.toggleSyncScroll`

Turn synchronised scrolling between editors and previews on or off, everywhere. Unbound by default.

**Default:** *(unbound)* · **Scope:** Editor · Preview

Turn synchronised scrolling between editors and their previews on or off, everywhere. It is the [same setting](preferences.md#previews) the menus and status-bar buttons switch.

### Reopen with Encoding…

**Cog › Key Bindings › Editor**

`editor.reopenWithEncoding`

Read the focused editor's file again in an encoding you choose. Unbound by default.

**Default:** *(unbound)* · **Scope:** Editor

Read the focused editor's file again in an encoding you choose, when it was detected wrongly. Unsaved changes are asked about first.

### Change Encoding…

**Cog › Key Bindings › Editor**

`editor.changeEncoding`

Choose the encoding throng saves the focused editor's document in. Unbound by default.

**Default:** *(unbound)* · **Scope:** Editor

Choose the encoding the focused editor's document is saved in. The document is marked changed and you can undo it; nothing is written until you save.

### Convert to LF

**Cog › Key Bindings › Editor**

`editor.convertLineEndingsToLf`

Change every line ending in the focused editor to LF, as one undo step. Unbound by default.

**Default:** *(unbound)* · **Scope:** Editor

Change every line ending in the focused editor's document to LF, as one step you can undo.

### Convert to CR

**Cog › Key Bindings › Editor**

`editor.convertLineEndingsToCr`

Change every line ending in the focused editor to CR, as one undo step. Unbound by default.

**Default:** *(unbound)* · **Scope:** Editor

Change every line ending in the focused editor's document to CR, as one step you can undo.

### Convert to CRLF

**Cog › Key Bindings › Editor**

`editor.convertLineEndingsToCrlf`

Change every line ending in the focused editor to CRLF, as one undo step. Unbound by default.

**Default:** *(unbound)* · **Scope:** Editor

Change every line ending in the focused editor's document to CRLF, as one step you can undo.

### Insert Line Break (LF)

**Cog › Key Bindings › Editor**

`editor.insertLineBreakLf`

Start a new line ending in LF at the cursor, whatever the other lines end in. Unbound by default.

**Default:** *(unbound)* · **Scope:** Editor

Start a new line ending in LF at the cursor, whatever the document's other lines end in.

### Insert Line Break (CR)

**Cog › Key Bindings › Editor**

`editor.insertLineBreakCr`

Start a new line ending in CR at the cursor, whatever the other lines end in. Unbound by default.

**Default:** *(unbound)* · **Scope:** Editor

Start a new line ending in CR at the cursor, whatever the document's other lines end in.

### Insert Line Break (CRLF)

**Cog › Key Bindings › Editor**

`editor.insertLineBreakCrlf`

Start a new line ending in CRLF at the cursor, whatever the other lines end in. Unbound by default.

**Default:** *(unbound)* · **Scope:** Editor

Start a new line ending in CRLF at the cursor, whatever the document's other lines end in.

### View Whitespace

**Cog › Key Bindings › Editor**

`editor.toggleWhitespace`

Show or hide a symbol for every space, tab, line break and invisible character. Unbound by default.

**Default:** *(unbound)* · **Scope:** Editor

Show or hide a symbol for every space, tab, line break and invisible character in the focused editor.

Cut, Copy, Paste, Select All, Undo and Redo inside an editor keep their native bindings
(`Ctrl+X`/`C`/`V`/`A`/`Z`/`Y`) and are not listed in the editor. A rectangular selection can also be
dragged with **Alt** held.

## Markdown

Folding a Markdown document's sections under their headings. Live in a Markdown editor and in a
Markdown preview; the editor and its preview share one fold state, so folding in either folds both.
In an editor *this section* is the one holding the caret; in a preview, the one at the top of the
view. Collapsing a section keeps the state of the sections inside it.

### Toggle this section

**Cog › Key Bindings › Markdown**

`markdown.toggleSection`

Collapse or expand the section containing the caret (editor) or the top of the view (preview).

**Default:** `Ctrl+M,M` · **Scope:** Editor · Preview

Collapse or expand the current section.

### Toggle all sections

**Cog › Key Bindings › Markdown**

`markdown.toggleAll`

Collapse every section if any is open, otherwise expand them all.

**Default:** `Ctrl+M,L` · **Scope:** Editor · Preview

### Collapse this section

**Cog › Key Bindings › Markdown**

`markdown.collapseSection`

Collapse the section containing the caret (editor) or the top of the view (preview).

**Default:** `Ctrl+M,S` · **Scope:** Editor · Preview

Collapse the current section.

### Expand this section

**Cog › Key Bindings › Markdown**

`markdown.expandSection`

Expand the section containing the caret (editor) or the top of the view (preview).

**Default:** *(unbound)* · **Scope:** Editor · Preview

Expand the current section.

### Collapse all sections

**Cog › Key Bindings › Markdown**

`markdown.collapseAll`

Collapse every heading section.

**Default:** `Ctrl+M,A` · **Scope:** Editor · Preview

Collapse every section, at every level.

### Expand all sections

**Cog › Key Bindings › Markdown**

`markdown.expandAll`

Expand every heading section.

**Default:** *(unbound)* · **Scope:** Editor · Preview

Expand every section, at every level.

### Collapse all inside this section

**Cog › Key Bindings › Markdown**

`markdown.collapseAllInside`

Collapse every section nested under the current one, leaving that section itself open.

**Default:** *(unbound)* · **Scope:** Editor · Preview

Collapse every section nested under the current section, leaving the current section itself open; the rest of the document is unchanged.

### Expand all inside this section

**Cog › Key Bindings › Markdown**

`markdown.expandAllInside`

Expand the current section and every section nested under it.

**Default:** *(unbound)* · **Scope:** Editor · Preview

Expand the current section, even when it is collapsed, and every section nested under it; the rest of the document is unchanged.

In an editor of any other language `Ctrl+M` keeps the editor's own meaning. Whether a document opens
with its sections expanded or collapsed is [Markdown sections open](preferences.md#editor).

## CSV grid

Inserting rows and columns in the CSV Preview Editor, at its active cell. Each is also on the grid's row
or column right-click menu. Inside the grid, the arrow keys, Page Up/Down, Home/End and Ctrl+Home/End
move (with Shift to extend), Enter, F2 or a double-click edits a cell (a double-click selects its text;
while a cell is being edited those keys move the caret in it), Delete clears, Ctrl+C, Ctrl+X and Ctrl+V copy, cut
and paste tab-separated cells, Ctrl+Z and Ctrl+Y undo and redo as in the text editor, and
[`editor.save`](#editor) saves. Double-clicking a column letter fits the column to its widest value (double-click again to undo); a row number does nothing, since rows are not resized. The **Lock first row** and **Lock first column** toggles beside it (or the **Lock First Row** and **Lock First Column** menu items) hold the first row under the column letters and the first column beside the row numbers while the rest scrolls. The **Wrap** toggle on a CSV preview's status bar (or its **Wrap** menu item) shows every cell in full, wrapped to its column, each row as tall as its tallest cell. Clicking the corner
above the row numbers selects every row and column. Every
right-click menu in the grid (cell, selection, row number, column letter) offers Cut, Copy and Paste; a
paste overwrites the selection from its top-left cell, and one value pasted onto several cells fills them.
**Reset Column Width** on a column letter puts it back to its default width. With whole rows or
columns copied from a grid, the row and column menus also offer **Insert Copied Rows Above/Below** and
**Insert Copied Columns Left/Right**. [`editor.saveAs`](#editor) and the Save As icon in the title bar save
the CSV under a new name, as in the text editor. A cell longer than the
[Long cell threshold](preferences.md#csv) opens in a dialog on double-click, F2 or Enter, with a JSON value
pretty-printed. **Edit in Dialog…** on the cell menu opens any cell there; Ctrl+Enter saves it as one
line and Esc cancels. The cell-dialog toggle at the bottom right of the status bar turns this on or off for
one panel. **Edit in Dialog…** is greyed while more than one cell is selected. Opening another CSV in a preview that holds unsaved edits asks first: Save & open, Discard & open, Open in new preview or Cancel. Each file keeps its own selection while the preview moves between files, and the pointer over a row number, column letter or the corner shows a select arrow.

### Insert Row Above

**Cog › Key Bindings › CSV grid**

`grid.insertRowAbove`

Insert an empty row above the active cell in the CSV Preview Editor.

**Default:** *(unbound)* · **Scope:** Preview

Insert an empty row above the active cell.

### Insert Row Below

**Cog › Key Bindings › CSV grid**

`grid.insertRowBelow`

Insert an empty row below the active cell in the CSV Preview Editor.

**Default:** *(unbound)* · **Scope:** Preview

Insert an empty row below the active cell.

### Insert Column Left

**Cog › Key Bindings › CSV grid**

`grid.insertColumnLeft`

Insert an empty column left of the active cell in the CSV Preview Editor.

**Default:** *(unbound)* · **Scope:** Preview

Insert an empty column left of the active cell.

### Insert Column Right

**Cog › Key Bindings › CSV grid**

`grid.insertColumnRight`

Insert an empty column right of the active cell in the CSV Preview Editor.

**Default:** *(unbound)* · **Scope:** Preview

### Insert Rows Above…

**Cog › Key Bindings › CSV grid**

`grid.insertRowsAbove`

Ask how many, then insert that many empty rows above the active cell in the CSV Preview Editor.

**Default:** *(unbound)* · **Scope:** Preview

### Insert Rows Below…

**Cog › Key Bindings › CSV grid**

`grid.insertRowsBelow`

Ask how many, then insert that many empty rows below the active cell in the CSV Preview Editor.

**Default:** *(unbound)* · **Scope:** Preview

### Insert Columns Left…

**Cog › Key Bindings › CSV grid**

`grid.insertColumnsLeft`

Ask how many, then insert that many empty columns left of the active cell in the CSV grid.

**Default:** *(unbound)* · **Scope:** Preview

### Insert Columns Right…

**Cog › Key Bindings › CSV grid**

`grid.insertColumnsRight`

Ask how many, then insert that many empty columns right of the active cell in the CSV grid.

**Default:** *(unbound)* · **Scope:** Preview

### Delete Rows

**Cog › Key Bindings › CSV grid**

`grid.deleteRows`

Delete every row the selection spans in the CSV Preview Editor.

**Default:** *(unbound)* · **Scope:** Preview

### Delete Columns

**Cog › Key Bindings › CSV grid**

`grid.deleteColumns`

Delete every column the selection spans, from every row, in the CSV Preview Editor.

**Default:** *(unbound)* · **Scope:** Preview

Insert an empty column right of the active cell.

## Search

The find bar is one control routed to the active panel: in an editor it finds and replaces in the
file; in a Markdown preview it finds in the rendered text, read-only; in a terminal it searches the
scrollback, read-only, and never types at the shell. Find in Files searches the whole project from
any surface.

### Find

**Cog › Key Bindings › Search**

`search.find`

Open find on the active panel.

**Default:** `Ctrl+F` · **Scope:** Editor · Terminal · Preview

### Find next

**Cog › Key Bindings › Search**

`search.findNext`

Move to the next match, wrapping at the end.

**Default:** `F3` · **Scope:** Editor · Terminal · Preview

### Find previous

**Cog › Key Bindings › Search**

`search.findPrevious`

Move to the previous match, wrapping at the start.

**Default:** `Shift+F3` · **Scope:** Editor · Terminal · Preview

### Close find

**Cog › Key Bindings › Search**

`search.close`

Close the find bar and clear its highlights.

**Default:** `Escape` · **Scope:** Editor · Terminal · Preview

### Replace

**Cog › Key Bindings › Search**

`search.replace`

Open find with replace on the active editor.

**Default:** `Ctrl+H` · **Scope:** Editor · Terminal

### Replace match

**Cog › Key Bindings › Search**

`search.replaceCurrent`

Replace the current match and move to the next one.

**Default:** `Alt+Enter` · **Scope:** Editor · Terminal

### Replace all

**Cog › Key Bindings › Search**

`search.replaceAll`

Replace every match in the file as a single undoable step.

**Default:** `Ctrl+Alt+Enter` · **Scope:** Editor · Terminal

### Find in files

**Cog › Key Bindings › Search**

`search.findInFiles`

Search every file in the project and show the matches in a results panel.

**Default:** `Ctrl+Shift+F` · **Scope:** Everywhere

### Replace in files

**Cog › Key Bindings › Search**

`search.replaceInFiles`

Search every file in the project with the replacement row already open.

**Default:** `Ctrl+Shift+H` · **Scope:** Everywhere

The same search with the replacement row already open.

The replace commands do nothing unless an editor is active.

## Terminal

View-only movement through a terminal's retained output. These keys are not delivered to the
running program, except while a program owns the keyboard: one that has asked for enhanced key
reporting (as Claude Code does), or one painting the full screen. Then the scroll chords go to that
program. On a Mac, the scroll chords that use Cmd still scroll throng's view while a program has asked
for enhanced key reporting: see [macOS](macos.md#terminals).

### Scroll line up

**Cog › Key Bindings › Terminal**

`terminal.scrollLineUp`

Scroll the terminal view up by one line.

**Default:** `Ctrl+Shift+ArrowUp` · **Scope:** Terminal

### Scroll line down

**Cog › Key Bindings › Terminal**

`terminal.scrollLineDown`

Scroll the terminal view down by one line.

**Default:** `Ctrl+Shift+ArrowDown` · **Scope:** Terminal

### Scroll page up

**Cog › Key Bindings › Terminal**

`terminal.scrollPageUp`

Scroll the terminal view up by one screen.

**Default:** `Shift+PageUp` · **Scope:** Terminal

### Scroll page down

**Cog › Key Bindings › Terminal**

`terminal.scrollPageDown`

Scroll the terminal view down by one screen.

**Default:** `Shift+PageDown` · **Scope:** Terminal

### Scroll to top

**Cog › Key Bindings › Terminal**

`terminal.scrollToTop`

Jump to the oldest retained line of scrollback.

**Default:** `Ctrl+Home` · **Scope:** Terminal

### Scroll to bottom

**Cog › Key Bindings › Terminal**

`terminal.scrollToBottom`

Jump to the newest output and resume following it.

**Default:** `Ctrl+End` · **Scope:** Terminal

### Refresh / redraw terminal

**Cog › Key Bindings › Terminal**

`terminal.redraw`

Ask the running program to redraw its screen. Changes no content, scrollback, selection or layout.

**Default:** `Ctrl+F5` · **Scope:** Terminal

Ask the running program to redraw its screen. Changes no content, scrollback, selection or layout. Bare `F5` is left to the program.

### Remember the last running command

**Cog › Key Bindings › Terminal**

`terminal.toggleRememberCommand`

Turn on or off whether the focused terminal saves its running command at exit. Unbound by default.

**Default:** *(unbound)* · **Scope:** Terminal

Turn on or off whether the focused terminal saves the command running when it ends as its startup command. The terminal keeps running.

### Reopen in the last directory

**Cog › Key Bindings › Terminal**

`terminal.toggleRememberDirectory`

Turn on or off whether the focused terminal reopens in its last folder. Unbound by default.

**Default:** *(unbound)* · **Scope:** Terminal

Turn on or off whether the focused terminal reopens in the folder it was last working in.

### Terminal notifications

**Cog › Key Bindings › Terminal**

`terminal.toggleNotifications`

Turn on or off whether the focused terminal can raise marks and notifications. Unbound by default.

**Default:** *(unbound)* · **Scope:** Terminal

Turn on or off whether the focused terminal can raise attention marks, pop-ups and desktop notifications.

The last three are the toggles at the right of a terminal's status bar, which are also in its right-click menu.

**Shift+Enter and Ctrl+Enter at a PowerShell prompt need Windows 11 or later (build 22000 and up).** They
insert a line break and move to the `>> ` continuation line only where the Windows console host asks for
Windows key events (win32-input-mode), which those builds' consoles do. The console of Windows 10 and Windows
Server 2022 never asks, and a terminal has no other way to tell PowerShell that Enter was modified. There, the line break
is inserted, but the next characters you type can land on the wrong line. Finish a multi-line command with
a backtick (`` ` ``) at the end of each line instead.

## On macOS

Every application chord in the tables above uses **Cmd** where they show **Ctrl**, and **Option** is Alt:
`Ctrl+Shift+Alt+K` is `Option+Shift+Cmd+K`. A terminal still receives Ctrl itself, so `Ctrl+C`, `Ctrl+R` and the
rest reach your shell. Where macOS keeps the Cmd form for itself, or the Mac has its own convention, the default is
different:

| Command | Action id | macOS default | Why |
|---|---|---|---|
| Cycle focus forward | `focus.cycle` | `` Ctrl+` `` | macOS keeps `` Cmd+` `` for switching windows |
| Cycle focus backward | `focus.cycleBack` | `` Ctrl+Shift+` `` | macOS keeps `` Shift+Cmd+` `` |
| Replace | `search.replace` | `Option+Cmd+F` | macOS keeps Cmd+H for Hide |
| Toggle fullscreen | `view.fullscreen` | `Ctrl+Cmd+F` | The Mac's own full-screen chord; F11 shows the desktop |
| Toggle section | `markdown.toggleSection` | `Ctrl+M,M` | macOS keeps Cmd+M for Minimise |
| Toggle all sections | `markdown.toggleAll` | `Ctrl+M,L` | macOS keeps Cmd+M |
| Collapse section | `markdown.collapseSection` | `Ctrl+M,S` | macOS keeps Cmd+M |
| Collapse all sections | `markdown.collapseAll` | `Ctrl+M,A` | macOS keeps Cmd+M |
| Redraw terminal | `terminal.redraw` | `Shift+Cmd+F5` | macOS keeps Cmd+F5 for VoiceOver |
| Back | `navigate.back` | `Cmd+[` | The Mac convention |
| Forward | `navigate.forward` | `Cmd+]` | The Mac convention |
| Column select up | `editor.columnSelectUp` | `Ctrl+Option+Shift+ArrowUp` | Option+Arrow keeps moving by word |
| Column select down | `editor.columnSelectDown` | `Ctrl+Option+Shift+ArrowDown` | Option+Arrow keeps moving by word |
| Column select left | `editor.columnSelectLeft` | `Ctrl+Option+Shift+ArrowLeft` | Option+Arrow keeps moving by word |
| Column select right | `editor.columnSelectRight` | `Ctrl+Option+Shift+ArrowRight` | Option+Arrow keeps moving by word |
| Open Settings | `app.settings` | `Cmd+,` | The Mac convention; macOS only |

Column selection with the mouse uses Option. A link in a terminal or editor opens with Cmd+click.

## Multi-key chords

A chord can carry **up to three keys under held modifiers**, written with commas: `Ctrl+E,W` means
*hold Ctrl, press E, then W, then let go*. The modifiers pressed with the first key must stay held
until the last key; a later key may add a modifier of its own, which belongs to that key alone:
`Ctrl+E,Shift+W` is Ctrl held throughout, with Shift added for the W. Pressing the first key alone
does nothing visible: throng waits for the next key.

- The **first key must carry a modifier** (Ctrl, Shift or Alt), and every key must be a real key,
  not a modifier on its own.
- A command that is **live in a terminal** takes a multi-key chord only when it is one of the
  window's own commands (zoom, focus, the side panes, the split commands and the rest of the
  *Everywhere* rows) **and** its first key is not one a shell needs (the list above). The window
  catches those keys before the terminal, so the shell receives neither. Any other multi-key chord
  on a terminal command would hand its first key to the shell as typing: the capture box refuses
  it, and a hand-written one in `keybindings.json` is ignored on load.
- For those window commands, the modifiers need not stay held: `Ctrl+Shift+Alt+End` released and
  then a bare arrow completes a split as it does with the modifiers still down.
- A multi-key chord **clashes with a shorter chord that is its own prefix**: with `Ctrl+E,W` bound,
  binding `Ctrl+E` to another command in an overlapping scope would make the longer one unreachable,
  and the capture box tells you. Two multi-key chords that *share* a first key do not clash:
  the next key decides.
- A fourth key is refused. So is a later key struck after you let go of a first-key modifier: that
  makes separate presses.

## On a keyboard that isn't UK or US

**The Ctrl+Shift+Alt chords follow the key's position**, not the character it prints, so they fire
the same way on every layout. Three consequences:

- **Letters are the key in the US position.** On a French AZERTY keyboard, `Ctrl+Shift+Alt+M` (Focus
  File Explorer) is the key labelled **,**. B, G, N, J, K and V sit in the same place on AZERTY and
  QWERTZ as on a UK or US keyboard, so the three focus chords still run left to right.
- **The window zoom's + and - are the keys beside 0 on a US keyboard.** On German, Spanish and
  Italian layouts the keys labelled **+** and **-** sit elsewhere and don't fire it; on Nordic
  layouts the key labelled **+** is in the US **-** position, so Ctrl+Shift+Alt with it zooms
  **out**. The keypad **+** and **-** work on every layout. Resetting the window zoom needs the
  numeric keypad on every layout.
- **A few AltGr+Shift characters are taken.** Where AltGr+Shift types a character on a key a
  Ctrl+Shift+Alt chord uses, the chord wins and the character doesn't type: **Ń** (N) on Polish
  (programmer's); **Ñ** (N) and **Þ** (T) on US-International; and **Ț** (T) on Romanian
  (Programmers). UK, German, French, Spanish, Italian and Nordic layouts lose none. B, G, M, J, K and V
  carry no AltGr+Shift character on any of these layouts, and no default uses P or F, so
  US-International's **Ö** (P) types. If you type one of these, rebind the chord. Characters typed
  with AltGr *without* Shift (**€**, **@**, **{**, **µ** and the rest) still type.

**The Ctrl+Alt panel chords follow the character**, so they never take an AltGr character. On a
layout where AltGr makes `Ctrl+Alt+-` type something, use **Ctrl+Wheel** over the panel instead. On a
UK or US keyboard `Ctrl+Alt++` also fires from the **=** key without Shift, so stepping the panel
zoom needs no keypad, and neither does resetting it: `Ctrl+Alt+0` on the main row, or
`Ctrl+MiddleClick`. Where AltGr+0 types a character (`}` on German, `@` on AZERTY), it keeps typing
it; use `Ctrl+MiddleClick` there.

**NumLock makes no difference.** Windows reports a keypad key pressed with Shift and NumLock on as a
different key with Shift released; throng restores the Shift, so `Ctrl+Shift+Alt+Numpad0` resets
the window zoom with NumLock on or off. With `Ctrl+Shift+Alt` the other keypad keys are read as their
navigation keys in either state, so keypad 8 is `ArrowUp` and keypad 1 is `End`.

The **backtick** chords (`` Ctrl+` ``, `` Ctrl+Shift+` ``) are matched on the physical backtick key,
so they work on layouts where Shift+backtick prints something other than `~`.

## Rebinding and resetting

Open **Preferences → Key Bindings** from the title-bar cog. Each command is a row showing its label,
its scope and its chords as pills; typeahead search filters the list.

- **Add a chord**: double-click the row, then press the chord. The capture box shows the chord
  forming and records it **when every key is released**. For `Ctrl+E,W`, hold Ctrl, press E and
  W, then let go. A command can hold several chords; each is a pill you can delete.
- **What the capture box refuses**: a bare key that cannot stand alone (Esc, Space, Enter, Tab and
  the like) or a lone modifier; a chord Windows reserves (`Ctrl+Alt+Delete`, `Ctrl+Shift+Escape`,
  `Alt+F4`, `Alt+Tab`, `Alt+Escape`, `Alt+Space`, and anything whose only modifier is the Windows
  key); and the multi-key cases [above](#multi-key-chords). **Esc** on its own closes the box.
- **A chord already in use** in an overlapping scope names the command that holds it and offers
  **Reassign** (move it to this command) or **Cancel**.
- **Reset**: a row's **Reset** restores its shipped chords, **Revert** undoes your change this
  session and **Clear** removes every chord; resetting the tab restores every binding. All three are
  always on the row, greyed with a reason while they do not apply. The wider reset scopes are described in
  [Preferences](preferences.md#resetting).

throng saves bindings to `keybindings.json` in the config folder (see
[where the files live](preferences.md#where-the-files-live)). You can also edit it by hand or
through the preferences window's JSON view; it hot-reloads. Each entry maps an action id to a list of
chord strings, written as this page shows them. An upgrade moves a binding to a new default
only where you still had the old default and the new one would not clash with a binding of your own;
a binding you changed is left as you saved it.

The **column-select mouse modifier**, the key you hold to drag a rectangular selection, is **Alt** on
Windows.
