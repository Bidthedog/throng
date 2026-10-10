[throng](../README.md) › [Docs](README.md) › Key bindings

# Key bindings

Every default key binding throng ships with, in the groups the **Key Bindings** editor shows them
in. Every one of them can be rebound, removed or given extra chords in **Preferences → Key
Bindings** (title-bar cog → **Key Bindings**); see [Rebinding and resetting](#rebinding-and-resetting).

Each row gives the command's label, its **action id** — the name it has in `keybindings.json` —
its default chord or chords, and its **scope**: where the chord is live.

| Scope | Live while focus is in |
|---|---|
| **Everywhere** | Any surface: an editor, a preview, a terminal, a Find in Files panel, File Explorer or the Projects pane |
| **Editor** | An editor panel |
| **Preview** | A preview panel |
| **Terminal** | A terminal panel |
| **Find in Files** | A Find in Files results panel |
| **File Explorer** | The File Explorer pane |

A command live in several places lists each of them. A chord is only ever acted on where its command
is live — anywhere else, the key goes to whatever has focus, a shell included.

## How the defaults are laid out

The modifiers say how far a chord reaches:

- **Ctrl+Shift+Alt+key** — getting around and the whole window: moving between panes, panels, tabs,
  projects and notices, showing or hiding a side pane, and the window's zoom.
- **Ctrl+Alt+key** or **Ctrl+Shift+key** — the panel or pane that has focus, rather than what it
  shows (its zoom, for instance).
- **One modifier, or none** — the content: editing, finding, saving, file operations.

A handful of long-standing chords sit outside that pattern on purpose, because they are the ones
every other editor uses or because a terminal needs them: `Ctrl+Shift+T` Quick Open,
`Ctrl+Shift+F` / `Ctrl+Shift+H` Find / Replace in Files, `Ctrl+Shift+S` Save All, `Ctrl+Alt+S`
Save As, `Ctrl+Alt+Enter` Replace All, `` Ctrl+` `` / `` Ctrl+Shift+` `` panel cycling, `Ctrl+E,W`
word wrap, `Shift+Alt+Arrow` column selection, the function keys (`F2`, `F3`, `F11`, `Shift+F10`)
and the Menu key.

**Keys a shell needs are left alone.** `Ctrl+C`, `Ctrl+D`, `Ctrl+Z`, `Ctrl+A`, `Ctrl+E`, `Ctrl+W`,
`Ctrl+U`, `Ctrl+K`, `Ctrl+R`, `Ctrl+L` and `Ctrl+Q` are never bound where a terminal is live. Where a
default uses one of them — `Ctrl+C`/`Ctrl+Z` in File Explorer, `Ctrl+G` and `Ctrl+E,W` in an editor —
its scope keeps it out of every terminal, so the shell still receives the key.

**Where a chord names `+`, it means the `+` key.** `Ctrl+Shift+Alt++` is Ctrl, Shift and Alt held
with the key that shares `=` on a UK or US keyboard. The keypad `+` and `-` are the same binding as
their main-row keys, so either fires it. The keypad `0` is **not** the same as the main-row `0`:
`Numpad0` in a chord means the keypad zero only.

**Two entries that look like a clash are not one.** `Ctrl+X` is *Cut* in File Explorer and *Cut
line* in an editor. Their scopes never overlap, so only one ever fires. The Key Bindings editor shows each row's scope for exactly
this reason.

## Zoom

The whole window's zoom. Keyboard only — there is no menu or mouse route to it.

| Command | Action id | Default | Scope | What it does |
|---|---|---|---|---|
| Zoom in | `zoom.in` | `Ctrl+Shift+Alt++` | Everywhere | Increase the interface zoom level. |
| Zoom out | `zoom.out` | `Ctrl+Shift+Alt+-` | Everywhere | Decrease the interface zoom level. |
| Reset zoom | `zoom.reset` | `Ctrl+Shift+Alt+Numpad0` | Everywhere | Return the interface zoom to 100%. The keypad zero only: the main-row `0` does not reset the window zoom, and a keyboard with no keypad has no keyboard route to it. |

## Focus & Zoom

The focused panel's own zoom, and moving keyboard focus. Panel zoom is **per panel type**: every
terminal, every editor and every Find in Files panel zooms on its own, on top of the window zoom,
and the level persists with your layout.

| Command | Action id | Default | Scope | What it does |
|---|---|---|---|---|
| Zoom panel type in | `panel.zoomIn` | `Ctrl+Alt++`, `Ctrl+WheelUp` | Everywhere | Increase the text size of every panel of the active panel's type. Ctrl+wheel acts on the panel under the pointer. With keyboard focus inside a diagram in a preview, this and the two zoom commands below zoom just that diagram (Zoom 100% for the reset). |
| Zoom panel type out | `panel.zoomOut` | `Ctrl+Alt+-`, `Ctrl+WheelDown` | Everywhere | Decrease the text size of every panel of the active panel's type. |
| Reset panel type zoom | `panel.zoomReset` | `Ctrl+Alt+Numpad0`, `Ctrl+Alt+0`, `Ctrl+MiddleClick` | Everywhere | Return the active panel's type to its default text size — the keypad zero, the main-row zero, or a Ctrl+middle-click over the panel. |
| Split Down | `panel.splitDown` | `Ctrl+Shift+Alt+End,ArrowDown` | Everywhere | Split the active panel in two and put a new empty panel below it. |
| Split Up | `panel.splitUp` | `Ctrl+Shift+Alt+End,ArrowUp` | Everywhere | Split the active panel in two and put a new empty panel above it. |
| Split Right | `panel.splitRight` | `Ctrl+Shift+Alt+End,ArrowRight` | Everywhere | Split the active panel in two and put a new empty panel to its right. |
| Split Left | `panel.splitLeft` | `Ctrl+Shift+Alt+End,ArrowLeft` | Everywhere | Split the active panel in two and put a new empty panel to its left. |
| Destroy Panel | `panel.destroy` | `Ctrl+Shift+Alt+F4` | Everywhere | Destroy the focused panel — any type, a terminal included — exactly as its menu's Destroy (or Close) does, confirmations and all. Does nothing while a side pane has focus. |
| Maximise / Restore Panel | `panel.toggleMaximise` | `Shift+Alt+Enter` | Everywhere | Let the focused panel fill its tab's middle section, or put it back. While it is maximised the tab's other panels are hidden and new panels cannot be added. In a terminal this chord no longer reaches the program; `Shift+Enter` still sends a line break. |
| Focus panel to the left | `focus.left` | `Ctrl+Shift+Alt+ArrowLeft` | Everywhere | Move focus to the adjacent panel on the left. |
| Focus panel to the right | `focus.right` | `Ctrl+Shift+Alt+ArrowRight` | Everywhere | Move focus to the adjacent panel on the right. |
| Focus panel above | `focus.up` | `Ctrl+Shift+Alt+ArrowUp` | Everywhere | Move focus to the adjacent panel above. |
| Focus panel below | `focus.down` | `Ctrl+Shift+Alt+ArrowDown` | Everywhere | Move focus to the adjacent panel below. |
| Cycle focus forward | `focus.cycle` | `` Ctrl+` `` | Everywhere | Move focus to the next panel in layout order, wrapping at the end. |
| Cycle focus backward | `focus.cycleBack` | `` Ctrl+Shift+` `` | Everywhere | Move focus to the previous panel in layout order, wrapping at the start. |
| Focus the most recent notice | `focus.notice` | `Ctrl+Shift+Alt+V` | Everywhere | Move focus to the newest notice on screen so its list can be read and scrolled by keyboard; **Esc** returns you to where you were. Does nothing when there is no notice. |
| Focus File Explorer | `focus.explorer` | `Ctrl+Shift+Alt+M` | Everywhere | Move keyboard focus straight to the File Explorer pane. |
| Focus Projects | `focus.projects` | `Ctrl+Shift+Alt+B` | Everywhere | Move keyboard focus straight to the Projects pane. |
| Focus Workspace | `focus.workspace` | `Ctrl+Shift+Alt+N` | Everywhere | Move keyboard focus back to the active panel in the centre workspace, without switching tab, panel or project. |

The three focus chords run left to right as the surfaces do: **B** Projects, **N** the workspace,
**M** File Explorer. The directional moves act from the focused panel and do nothing while a side
pane has focus; the caret moves with focus, into whichever control in that panel last had it.
**Ctrl+Wheel** over the title bar or a side pane does nothing, and it never scrolls the panel.

**Split mode.** `Ctrl+Shift+Alt+End` puts the active panel into split mode: its border pulses and its
status bar says the chord is waiting. An arrow key then splits the panel that way — with
Ctrl+Shift+Alt still held or already released. **Esc** leaves split mode without splitting; any other
key, the chord timeout, or focus moving elsewhere ends it too. Neither key reaches a terminal. The same
four splits are on every panel's **+** button and in its **Split** menu.

## View

| Command | Action id | Default | Scope | What it does |
|---|---|---|---|---|
| Toggle fullscreen | `view.fullscreen` | `F11` | Everywhere | Enter or leave fullscreen mode. |
| Toggle Projects sidebar | `view.toggleProjects` | `Ctrl+Shift+Alt+J` | Everywhere | Show or hide the Projects & Sub-workspaces pane. |
| Toggle File Explorer | `view.toggleExplorer` | `Ctrl+Shift+Alt+K` | Everywhere | Show or hide the File Explorer pane. |
| Next Project | `project.next` | `Ctrl+Shift+Alt+PageDown` | Everywhere | Switch to the next project in the Projects pane, skipping any minimised category and stopping at the end. |
| Previous Project | `project.previous` | `Ctrl+Shift+Alt+PageUp` | Everywhere | Switch to the previous project, skipping any minimised category and stopping at the start. |
| Open context menu | `menu.open` | `Shift+F10`, `ContextMenu` | Everywhere | Open the focused item's context menu from the keyboard. `ContextMenu` is the Menu key. |

## Tabs

| Command | Action id | Default | Scope | What it does |
|---|---|---|---|---|
| Open tab picker | `tabs.openPicker` | `Ctrl+Shift+Alt+T` | Everywhere | Open a searchable list of every tab in the window — type to filter, **Up**/**Down** to move, **Enter** to choose. Works at any tab count, from a focused terminal too. |

## Navigate

| Command | Action id | Default | Scope | What it does |
|---|---|---|---|---|
| Quick Open | `navigate.quickOpen` | `Ctrl+Shift+T` | Everywhere | Open any file in the current project by typing part of its name or path; **Enter** opens it. |
| Go To Line | `navigate.gotoLine` | `Ctrl+G` | Editor | Jump to a line number in the focused editor. A terminal keeps its own `Ctrl+G`. |
| Open Preview | `preview.open` | *(unbound)* | Editor · File Explorer | Open a rendered preview of the focused editor's file, or of the file selected in File Explorer. |
| Back | `navigate.back` | `Alt+ArrowLeft` | Editor · Preview | Show the previous file in the focused editor or preview's history. In an editor this takes the key from moving by syntax. |
| Forward | `navigate.forward` | `Alt+ArrowRight` | Editor · Preview | Show the next file in the focused editor or preview's history, after going Back. |
| Open Link | `preview.followLink` | `Ctrl+Enter` | Editor · Preview | Open the link under the caret in an editor, or the focused link in a preview, exactly as Ctrl+click does. In an editor with no link under the caret it keeps the editor's own meaning. |
| Go to Heading | `preview.goToHeading` | `Ctrl+G` | Preview | Open a searchable list of the preview's headings over the document and jump to one. Pressed again while the list is open, it returns to the list's search box. |

The mouse's own back and forward buttons do the same as **Back** and **Forward** over an editor or
preview panel; they are not a rebindable chord.

**Open Link is not live in a terminal**, where `Ctrl+Enter` reaches the program — which is also why
a terminal link's **Open Link** menu item shows no shortcut. In a terminal, a link is followed with
Ctrl+click or from its Link menu. Where a followed link goes is described with the link settings in
[Preferences → Editor → Links](preferences.md#links).

## File Explorer

Live only while the File Explorer pane has focus.

| Command | Action id | Default | Scope | What it does |
|---|---|---|---|---|
| Rename | `file.rename` | `F2` | File Explorer | Rename the selected file or folder. |
| Undo file operation | `file.undo` | `Ctrl+Z` | File Explorer | Reverse the last move, rename, delete or replacing paste made in the file tree; a move between projects undoes from either project. |
| Redo file operation | `file.redo` | `Ctrl+Y` | File Explorer | Re-apply the last file operation that was undone. |
| Cut | `file.cut` | `Ctrl+X` | File Explorer | Cut the selected file or folder. |
| Copy | `file.copy` | `Ctrl+C` | File Explorer | Copy the selected file or folder. |
| Paste | `file.paste` | `Ctrl+V` | File Explorer | Paste into the selected folder, from this project or another. |
| Delete | `file.delete` | `Delete` | File Explorer | Delete the selected file or folder — to the Recycle Bin or permanently, per [Delete files to](preferences.md#file-explorer). |

## Editor

| Command | Action id | Default | Scope | What it does |
|---|---|---|---|---|
| Save | `editor.save` | `Ctrl+S` | Editor · Terminal | Save the active editor document. Inert in a terminal. |
| Save all | `editor.saveAll` | `Ctrl+Shift+S` | Editor · Terminal | Save all open editor documents in scope — see [Save-All scope](preferences.md#editor). |
| Save as | `editor.saveAs` | `Ctrl+Alt+S` | Editor · Terminal | Save the active document to a new location. |
| Cut line | `editor.cutLine` | `Ctrl+X` | Editor | Cut the whole line the cursor sits on when nothing is selected, or just the selection when there is one. |
| Indent | `editor.indentLines` | `Tab` | Editor | Indent every line the selection touches, or insert one level of indentation at the cursor. |
| Outdent | `editor.outdentLines` | `Shift+Tab` | Editor | Remove one level of indentation from every line the selection touches. |
| Column select up | `editor.columnSelectUp` | `Shift+Alt+ArrowUp` | Editor | Extend a rectangular selection one line upwards. |
| Column select down | `editor.columnSelectDown` | `Shift+Alt+ArrowDown` | Editor | Extend a rectangular selection one line downwards. |
| Column select left | `editor.columnSelectLeft` | `Shift+Alt+ArrowLeft` | Editor | Extend a rectangular selection one column to the left. |
| Column select right | `editor.columnSelectRight` | `Shift+Alt+ArrowRight` | Editor | Extend a rectangular selection one column to the right. |
| Toggle word wrap | `editor.toggleWordWrap` | `Ctrl+E,W` | Editor | Wrap or unwrap long lines in the focused editor's document — hold Ctrl, press **E**, then **W**. |
| Synchronise Scrolling | `preview.toggleSyncScroll` | *(unbound)* | Editor · Preview | Turn synchronised scrolling between editors and their previews on or off, everywhere — the [same setting](preferences.md#previews) the menus and status-bar buttons switch. |

Cut, Copy, Paste, Select All, Undo and Redo inside an editor keep their native bindings
(`Ctrl+X`/`C`/`V`/`A`/`Z`/`Y`) and are not listed in the editor. A rectangular selection can also be
dragged with **Alt** held.

## Markdown

Folding a Markdown document's sections under their headings. Live in a Markdown editor and in a
Markdown preview; the editor and its preview share one fold state, so folding in either folds both.
In an editor *this section* is the one holding the caret; in a preview, the one at the top of the
view. Collapsing a section keeps the state of the sections inside it.

| Command | Action id | Default | Scope | What it does |
|---|---|---|---|---|
| Toggle this section | `markdown.toggleSection` | `Ctrl+M,M` | Editor · Preview | Collapse or expand the current section. |
| Toggle all sections | `markdown.toggleAll` | `Ctrl+M,L` | Editor · Preview | Collapse every section if any is expanded, otherwise expand every section. |
| Collapse this section | `markdown.collapseSection` | `Ctrl+M,S` | Editor · Preview | Collapse the current section. |
| Expand this section | `markdown.expandSection` | *(unbound)* | Editor · Preview | Expand the current section. |
| Collapse all sections | `markdown.collapseAll` | `Ctrl+M,A` | Editor · Preview | Collapse every section, at every level. |
| Expand all sections | `markdown.expandAll` | *(unbound)* | Editor · Preview | Expand every section, at every level. |
| Collapse all inside this section | `markdown.collapseAllInside` | *(unbound)* | Editor · Preview | Collapse the current section and every section nested under it; the rest of the document is unchanged. |
| Expand all inside this section | `markdown.expandAllInside` | *(unbound)* | Editor · Preview | Expand the current section and every section nested under it; the rest of the document is unchanged. |

In an editor of any other language `Ctrl+M` keeps the editor's own meaning. Whether a document opens
with its sections expanded or collapsed is [Markdown sections open](preferences.md#editor).

## Search

The find bar is one control routed to the active panel: in an editor it finds and replaces in the
file; in a Markdown preview it finds in the rendered text, read-only; in a terminal it searches the
scrollback, read-only, and never types at the shell. Find in Files searches the whole project from
any surface.

| Command | Action id | Default | Scope | What it does |
|---|---|---|---|---|
| Find | `search.find` | `Ctrl+F` | Editor · Terminal · Preview | Open find on the active panel. |
| Find next | `search.findNext` | `F3` | Editor · Terminal · Preview | Move to the next match, wrapping at the end. |
| Find previous | `search.findPrevious` | `Shift+F3` | Editor · Terminal · Preview | Move to the previous match, wrapping at the start. |
| Close find | `search.close` | `Escape` | Editor · Terminal · Preview | Close the find bar and clear its highlights. |
| Replace | `search.replace` | `Ctrl+H` | Editor · Terminal | Open find with replace on the active editor. |
| Replace match | `search.replaceCurrent` | `Alt+Enter` | Editor · Terminal | Replace the current match and move to the next one. |
| Replace all | `search.replaceAll` | `Ctrl+Alt+Enter` | Editor · Terminal | Replace every match in the file as a single undoable step. |
| Find in files | `search.findInFiles` | `Ctrl+Shift+F` | Everywhere | Search every file in the project and show the matches in a results panel. |
| Replace in files | `search.replaceInFiles` | `Ctrl+Shift+H` | Everywhere | The same search with the replacement row already open. |

The replace commands do nothing unless an editor is active.

## Terminal

View-only movement through a terminal's retained output. These keys are never delivered to the
running program.

| Command | Action id | Default | Scope | What it does |
|---|---|---|---|---|
| Scroll line up | `terminal.scrollLineUp` | `Ctrl+Shift+ArrowUp` | Terminal | Scroll the terminal view up by one line. |
| Scroll line down | `terminal.scrollLineDown` | `Ctrl+Shift+ArrowDown` | Terminal | Scroll the terminal view down by one line. |
| Scroll page up | `terminal.scrollPageUp` | `Shift+PageUp` | Terminal | Scroll the terminal view up by one screen. |
| Scroll page down | `terminal.scrollPageDown` | `Shift+PageDown` | Terminal | Scroll the terminal view down by one screen. |
| Scroll to top | `terminal.scrollToTop` | `Ctrl+Home` | Terminal | Jump to the oldest retained line of scrollback. |
| Scroll to bottom | `terminal.scrollToBottom` | `Ctrl+End` | Terminal | Jump to the newest output and resume following it. |
| Refresh / redraw terminal | `terminal.redraw` | `Ctrl+F5` | Terminal | Ask the running program to redraw its screen. Changes no content, scrollback, selection or layout. Bare `F5` is left to the program. |

## Multi-key chords

A chord can carry **up to three keys under held modifiers**, written with commas: `Ctrl+E,W` means
*hold Ctrl, press E, then W, then let go*. The modifiers pressed with the first key must stay held
until the last key; a later key may add a modifier of its own, which belongs to that key only —
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
  then a bare arrow completes a split exactly as it does with the modifiers still down.
- A multi-key chord **clashes with a shorter chord that is its own prefix**: with `Ctrl+E,W` bound,
  binding `Ctrl+E` to another command in an overlapping scope would make the longer one unreachable,
  and the capture box says so. Two multi-key chords that merely *share* a first key do not clash —
  the next key decides.
- A fourth key is refused. So is a later key struck after a first-key modifier was let go — that
  makes separate presses, not one chord.

## On a keyboard that isn't UK or US

**The Ctrl+Shift+Alt chords follow the key's position**, not the character it prints, so they fire
the same way on every layout. Three consequences:

- **Letters are the key in the US position.** On a French AZERTY keyboard, `Ctrl+Shift+Alt+M` (Focus
  File Explorer) is the key labelled **,**. B, N, J, K and V sit in the same place on AZERTY and
  QWERTZ as on a UK or US keyboard, so the three focus chords still run left to right.
- **The window zoom's + and - are the keys beside 0 on a US keyboard.** On German, Spanish and
  Italian layouts the keys labelled **+** and **-** sit elsewhere and don't fire it; on Nordic
  layouts the key labelled **+** is in the US **-** position, so Ctrl+Shift+Alt with it zooms
  **out**. The keypad **+** and **-** work on every layout. Resetting the window zoom needs the
  numeric keypad on every layout.
- **A few AltGr+Shift characters are taken.** Where AltGr+Shift types a character on a key a
  Ctrl+Shift+Alt chord uses, the chord wins and the character doesn't type: **Ń** (N) on Polish
  (programmer's); **Ñ** (N) and **Þ** (T) on US-International; and **Ț** (T) on Romanian
  (Programmers). UK, German, French, Spanish, Italian and Nordic layouts lose none. B, M, J, K and V
  carry no AltGr+Shift character on any of these layouts, and no default uses P or F, so
  US-International's **Ö** (P) types. If you type one of these, rebind the chord. Characters typed
  with AltGr *without* Shift — **€**, **@**, **{**, **µ** and the rest — are unaffected.

**The Ctrl+Alt panel chords follow the character**, so they never take an AltGr character — on a
layout where AltGr makes `Ctrl+Alt+-` type something, use **Ctrl+Wheel** over the panel instead. On a
UK or US keyboard `Ctrl+Alt++` also fires from the **=** key without Shift, so stepping the panel
zoom needs no keypad, and neither does resetting it: `Ctrl+Alt+0` on the main row, or
`Ctrl+MiddleClick`. Where AltGr+0 types a character (`}` on German, `@` on AZERTY), it keeps typing
it; use `Ctrl+MiddleClick` there.

**NumLock makes no difference.** Windows reports a keypad key pressed with Shift and NumLock on as a
different key with Shift released; throng restores the Shift, so `Ctrl+Shift+Alt+Numpad0` resets
the window zoom with NumLock on or off.

The **backtick** chords (`` Ctrl+` ``, `` Ctrl+Shift+` ``) are matched on the physical backtick key,
so they work on layouts where Shift+backtick prints something other than `~`.

## Rebinding and resetting

Open **Preferences → Key Bindings** from the title-bar cog. Each command is a row showing its label,
its scope and its chords as pills; typeahead search filters the list.

- **Add a chord**: double-click the row, then press the chord. The capture box shows the chord
  forming and records it **when every key is released** — so for `Ctrl+E,W`, hold Ctrl, press E and
  W, then let go. A command can hold several chords; each is a pill you can delete.
- **What the capture box refuses**: a bare key that cannot stand alone (Esc, Space, Enter, Tab and
  the like) or a lone modifier; a chord Windows reserves (`Ctrl+Alt+Delete`, `Ctrl+Shift+Escape`,
  `Alt+F4`, `Alt+Tab`, `Alt+Escape`, `Alt+Space`, and anything whose only modifier is the Windows
  key); and the multi-key cases [above](#multi-key-chords). **Esc** on its own closes the box.
- **A chord already in use** in an overlapping scope names the command that holds it and offers
  **Reassign** (move it to this command) or **Cancel**.
- **Reset**: a row's reset icon, shown only while that command differs from its shipped chords,
  restores it; resetting the tab restores every binding. The wider reset scopes are described in
  [Preferences](preferences.md#resetting).

Bindings are saved to `keybindings.json` in the config folder — see
[where the files live](preferences.md#where-the-files-live) — which you can also edit by hand or
through the preferences window's JSON view; it hot-reloads. Each entry maps an action id to a list of
chord strings, written exactly as this page shows them. An upgrade moves a binding to a new default
only where you still had the old default and the new one would not clash with a binding of your own;
a binding you changed is left as you saved it.

The **column-select mouse modifier** — the key held to drag a rectangular selection — is **Alt** on
Windows.
