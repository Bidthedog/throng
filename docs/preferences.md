[throng](../README.md) › [Docs](README.md) › Preferences

# Preferences

Every setting throng has, in the groups the **Settings** editor shows them in, with its key in
`settings.json`, its shipped default, what it accepts and what it does. Key bindings have a page of
their own, [Key bindings](key-bindings.md). Themes, icon sets and the config files are at the
end of this one.

## The preferences window

Click the **cog** in the title bar and choose **Settings**, **Key Bindings** or **Themes**. All three
are tabs of one window that floats above throng and minimises with it; it stays on top but **does not
block the app**, so you can keep working while you edit a theme and watch each change land.

- **The visual editors apply each change at once**, with no Save button and no restart. Toggles and
  dropdowns apply at once; a typed value applies when you press **Enter** or leave the box.
- **Settings**, **Key Bindings** and **Themes** each have typeahead search. Every word you type must
  appear in a row's name, description, current value or the headings above it, and the best match
  comes first: a hit in the name ranks above one in the value, the description or a heading, and an
  exact name above a partial one. Sections are ordered by their best match, and typing a section or
  subsection name returns everything under it.
- **The JSON view** (the **UI ⇄ JSON** toggle in the toolbar) edits the same files in throng's own
  editor. **throng applies your document when you leave it**: when you switch back to the visual editor,
  switch tab, or close the window. It waits because a half-typed number is
  often still valid JSON and applying it would correct and rewrite the value you were halfway through
  entering. While the document is invalid you cannot leave it: one notice names each offending value
  with its allowed options or range, and **Discard changes and close** abandons the edit, leaving the
  last valid document in effect.
- **Every number is a slider, its value, and a box.** The slider moves in steps suited to its range and
  shows the value in the unit that reads best: sizes in MB (1 MB is 1,048,576 bytes), durations in ms,
  seconds or minutes. The box beside it holds the stored value (bytes for a size,
  milliseconds for a duration) and takes any whole number within the setting's limits, which can go
  beyond the slider's ends. A value that is not one of the slider's steps greys the slider; it still
  moves, and moving it sets that step. Type past a limit and the box turns red while a notification names
  the setting and its limits; **Enter** or leaving the box stores that limit. Text that is no number stays,
  red, until you correct it or press **Esc**, which puts the stored value back. In the tables below, *Range*
  gives the slider's ends and step in the shown unit, then the box's limits in the stored unit where they
  reach further.
- **A box that refuses an entry** says why in a notification, never under the box, so nothing on the page
  moves. Confirming the same entry again flashes that notification and adds no second one.

### Folding sections

Every section and subsection heading on the **Settings**, **Key Bindings** and **Themes** tabs folds.
**Sections start folded**, so each tab opens as a list of section headings; open a section and its
subsections are already open. Click anywhere on a heading, or Tab to it and press Enter or Space, to
fold or unfold it. Folding a section leaves its subsections as you left them, so unfolding it brings
back the same layout.

- **The count** beside each heading is how many rows it holds, its subsections included. While you
  search it reads as matches out of total, for example `3 of 34`.
- **A warning marker** on a folded heading means a row inside it holds an invalid entry. Your entry is
  still there when you unfold it.
- **Expand All** and **Collapse All** beside the search box unfold or fold every heading on that tab.
  They are disabled while the search box has text.
- **Searching** unfolds every section that holds a match. Clearing the search folds them back the way
  they were, and any folding you did while searching is not kept.
- **Your choices are remembered** per tab, across closing the window and restarting throng. A section
  you opened stays open, and a subsection you folded stays folded. They are not a setting, so they do
  not appear in `settings.json`.

### Lists and tables

A setting that holds a list or a table (excluded globs, link protocols, the extensions that end a spaced
path, safe preview sources, language by extension, indentation by language) shows one line in its row:
how many entries it holds and the first few. Its edit button opens the list in a window of its own over
Preferences, where you add, change and remove entries as before. **Save** (or **Ctrl+Enter**) stores the
list; **Cancel** (or **Esc**) leaves it as it was.

### Resetting

Four scopes, all reading the same shipped-defaults record:

| Control | Scope |
|---|---|
| **Revert**, **Reset** and **Clear** on a row | That one setting or binding: Revert undoes your change this session, Reset returns the shipped value, Clear empties it. All three are always on the row, so it never moves; one that does not apply yet is greyed, and its hover title says why. |
| Reset the *tab* | The whole Settings or Key Bindings editor. |
| **Reset All Preferences** | Settings, key bindings and built-in themes, atomically. **Your projects, layout, workspace state and custom themes are untouched**, and the confirmation names them. |
| **Revert All Preferences** | A session undo: everything goes back to how it was when you opened the window. Defaults stay out of it. |

### Values out of range, and files that will not parse

**A hand-edited value that is out of range is brought back inside it, and the file is updated to say
so.** Each setting's limits are the ones its box accepts (the slider's range unless the table below
gives wider ones), so a pane width of `99999` loads as the maximum, and `settings.json` is rewritten
to the corrected value. This happens whenever the file is read, including a hot-reload. A
file already within its limits is **never** rewritten.

**A file that cannot be parsed is left alone.** throng re-reads it a few times in case it caught you
mid-save; if it still will not parse, throng runs on the shipped defaults, records that in the diagnostics
log, and leaves your file as it is for you to repair. A key throng does not recognise is kept
when it writes the file; a retired key it once used is dropped.

## General

The window, the app-wide behaviour and the attention marks, each under a heading of its own.

### Window

Each project remembers for itself which side panes are expanded.

#### Use native Wayland (Linux only)

**Cog › Settings › General › Window**

`window.nativeWayland`

Run the window on Wayland itself instead of through XWayland. Applies at the next start.

**Default:** `false` · **Values:** on · off

Run the window directly on Wayland instead of through XWayland. XWayland suits dragging a tab out, placing windows, and keeping Preferences and About above the main window; dragging files out to GNOME Files needs native Wayland ([Linux](linux.md#display)). Takes effect at the next start.

#### Projects pane max width

**Cog › Settings › General › Window**

`panes.projects.maxWidth`

The widest you can drag the Projects pane.

**Default:** 400 px · **Values:** 200 – 1,200 px, step 10 px

Drag the pane's edge to resize it, between 250 px and this width. throng remembers the width you leave it
at. Lower the limit below the pane's current width and the pane narrows to it at once.

#### File Explorer pane max width

**Cog › Settings › General › Window**

`panes.fileExplorer.maxWidth`

The widest you can drag the File Explorer pane.

**Default:** 700 px · **Values:** 200 – 1,200 px, step 10 px

As **Projects pane max width**, for the File Explorer pane on the right: it resizes between 250 px and this
width, keeps the width you leave it at, and narrows at once when you lower the limit below it.

### Projects

#### Folder opened from outside throng

**Cog › Settings › General › Projects**

`projects.openFromOutside`

What a folder from the OS file manager or command line does: switch to its project, or load it.

**Default:** `switch` · **Values:** `switch` · `load`

A folder reaches throng from outside when you run `throng <folder>` or choose **Open as throng project** in
the file manager. A project's folder, or any folder inside it, switches to that project (`switch`), or
loads it in the background while the project you are in stays in front (`load`). A folder that belongs to
no project is added as a new one, named after the folder. A folder that holds another project's folder,
a file, or a path that does not exist raises one notice and adds nothing. A request that arrives while a
dialog is open waits until you close it.

#### Project popover

**Cog › Settings › General › Projects**

`projects.popoverEnabled`

Show a popover with a project's name, ID, path and counts when the pointer rests on it.

**Default:** on · **Values:** on · off

Show a popover when the pointer rests on a project in the Projects pane: its full name, its ID, its full path, its tab and panel counts, and how to rename it.

#### Project popover delay

**Cog › Settings › General › Projects**

`projects.popoverDelayMs`

How long the pointer must rest on a project before its popover appears. Zero shows it at once.

**Default:** 300 ms · **Values:** 0 – 1,500 ms, step 25 ms; 0 – 10,000 ms in the box

Applies only while **Project popover** is on. A longer delay keeps the popover from opening as you move the
pointer down the Projects pane to a project further on.

### Behaviour

#### Submenu hover delay

**Cog › Settings › General › Behaviour**

`behaviour.submenuHoverMs`

How long the pointer rests on a context-menu item before its submenu opens.

**Default:** 100 ms · **Values:** 0 – 1,500 ms, step 25 ms; 0 – 10,000 ms in the box

Applies to every menu throng draws, the right-click menus and the cog menu among them. Moving the pointer away before the delay ends opens
nothing, so a longer delay stops submenus flicking open as you cross a menu. Clicking the item opens its
submenu at once, and so does the keyboard.

### Attention

An attention mark flags a panel that needs you; this setting decides whether the taskbar counts it,
whatever raised it. How a mark is announced, and how it clears, are under [Notifications](#notifications);
which terminal events raise one is under [Terminal](#terminal).

#### Taskbar badge (Windows only)

**Cog › Settings › General › Attention**

`attention.taskbarBadge`

Show the number of marked panels, across every project, on throng's taskbar button.

**Default:** on · **Values:** on · off

The count shows whether or not throng is focused, so you can see from another app that something wants you. The badge uses the Failed style while any marked panel is Failed, and is not affected by the notification settings.

### File Manager

The **Open as throng project** control, under General › **File Manager**, which folds like every other heading, turns the file manager's menu item on or off for your account. It shows what the OS has
registered, so it has no entry in `settings.json`. It is disabled, with the reason, for an install made for everyone
on Windows and for a portable or archive copy.

### Theme

**Cog › Themes**

`appearance.theme`

The colour theme throng draws every window in, chosen in the Themes tab.

**Default:** `throng` · **Values:** any theme on disk, chosen in the **Themes** tab

**Themes.** throng ships 14: **throng** (the default), Light, Snake, Gothic, Windows Terminal, Bash,
VSCode, VI-VIM, English Garden, Matrix, Cyberpunk, Claude, Debian and Ubuntu. The theme chosen in the
**Themes** tab is the active one, applied across the whole app, and is stored as `appearance.theme`
(default `throng`, any theme on disk); the Settings tab has no row for it. The **Themes** tab
edits every token of a theme (colours, fonts and sizes, syntax colours, the icon colour and icon
set), each with a plain-language label, using colour and size pickers drawn from the theme itself. Every one of
those is stored in the theme's own file, so an edit belongs to the theme you made it in, and switching theme
brings back everything that theme holds. A colour deleted from a theme's JSON takes that theme's own shipped
value again (a theme of your own takes the default theme's), never the one from the theme you switched from.
**Clone** is how you make a theme of your own. Every bundled theme meets WCAG AA contrast on every colour pair throng measures: text on its backgrounds, code on the editor and on a selection, text on buttons and on the accent colour. The build keeps it there. When the selected theme meets WCAG AA, a shield mark sits beside the picker. A theme of your own is judged the same way, and the mark follows your edits. The seven **Markdown preview › Callouts** colours give a preview's callouts their accent, each callout type taking one of the seven; the box is a light tint of it over the editor background. Printing never uses the theme: a printed preview takes fixed print colours. The seven **File Icons** colours, under File Explorer, colour file icons by kind (code, markup,
data, documents, media, archives and scripts) in the File Explorer and Find in Files, and **Other File
Icons** colours a file of a kind throng does not recognise, in a neutral grey apart from the folders; every
bundled theme sets all eight, and clearing one gives those icons the Icon Colour. **Title Bar Background**, under General, is
the bar across the top of every window; left empty, it is a shade apart from the window background.
**Picture Preview Background** and **Picture Transparency Marker**, under Main panel / workspace, are the
canvas an Image or SVG preview draws on and the hatching behind a picture's transparent parts; left
empty, both are mixed from the editor background and text colour.
**Icon Button Background**, under
General › Buttons, is what every icon button sits on in every window; left empty, an icon button shows only its
icon until you point at it. The
link underline's colours are the **Link Underline** and **Link Hover Underline** tokens, in the
General area; unset, they follow the theme's accent colour. Every tooltip, hover popover, hint and
indicator shares one look, coloured by **Popup Background**, **Popup Text** and **Popup Border**
(General area; unset, they follow the raised surface, text and border colours). The tint on other occurrences of a
selection is **Selection Occurrence Highlight**, and its quieter form in a panel without focus is
**Inactive Selection Occurrence Highlight** (both in the Search area, derived from the same colours as
search matches); a selection kept in a panel without focus is **Editor Inactive Selection** (Editor
area). See [Highlight other occurrences of the selection](#editor).

**Restoring built-in themes.** An upgrade only *adds* newly shipped themes and fills in newly added
theme tokens; it never overwrites a value you already have. Adopting new shipped values on an existing
theme is your choice, from the theme editor's restore controls: **Restore All Themes to Default**, or
a per-theme restore or recreate on a single built-in. Every restore is all-or-nothing: if a theme file
cannot be written, nothing changes.

**Icon sets.** Every icon in throng comes from one icon set. The default set, **throng**, is simple
line art from [Lucide](https://lucide.dev), built into the app; it cannot be changed, and every theme
uses it unless the theme picks one of your own. The **Icons** area of the Themes tab picks the theme's
set and lists every icon as a read-only row: the icon, its key, its file name (`<key>.svg`) and what it
stands for, with each one your set replaces marked **Overridden**. Your own sets are marked with an
asterisk in the picker.

To change icons, make a set of your own and replace files in its folder:

1. **New set from this set** (beside the picker) asks for a name. A set made from **throng** starts
   empty; one made from your own set starts with a copy of its files.
2. **Override this icon** on a row copies the default art into your set's folder as `<key>.svg`. If
   the file is already there, throng asks before replacing it.
3. **Open folder** opens the set's folder (or the icon sets folder while **throng** is picked). Replace
   any `<key>.svg` with your own SVG, or copy a file with the right name straight in. A file being
   there is all an override needs.
4. **Reload the icon sets from disk** loads your changes. throng does not watch the folders: it reads
   every set again when it starts and on every icon set control here: picking a set, the buttons
   beside the picker, and **Override** and **Reset** on a row.
5. **Reset this icon to the default** on an overridden row moves its file to the trash, and the
   default art comes back.

Every control here is always shown; one that cannot be used now, such as **Reset** on an icon your set
does not override or **Rename** while **throng** is picked, is greyed out and its hover title says why.

While one of your sets is picked, **Rename this icon set** renames its folder, and every theme using it
follows. **Delete this icon set** asks first, then moves the folder to the trash; every theme that used
it draws the default set again.

An icon your set does not override uses the default art, including icons a later version of throng
adds or redraws. A file throng cannot use falls back to the default art and says why on its row; a set
throng cannot read falls back to the default set, with a notice saying why. Sets live in the `icon-packs` folder below, and `README.txt` there lists
every key and the steps above.

**Backups of older icon packs.** throng converted nothing from the old icon packs, glyph maps
or per-theme icon overrides. Folders in `icon-packs` that held anything you made or changed were
renamed with a `.bak` suffix and are hidden from throng; a notice with an **Open folder** action
appears at every start until they are gone. Move what you want to keep into a new set as above, then
delete the `.bak` folders or move them out of `icon-packs`.

## Confirmations

`none`, `single` or `double` is how many confirmations an action asks for before it happens.

### Remove a project

**Cog › Settings › Confirmations**

`confirmations.destroyProject`

How many times throng asks before it removes a project. It unregisters it and deletes no files.

**Default:** `double` · **Values:** `none` · `single` · `double`

Removing a project takes it off the Projects pane and discards its tabs, panels and saved layout; its folder
and every file in it stay on disk. Adding the folder again starts a project with a fresh layout. `single`
shows one confirmation naming what goes; `double` follows it with a second, **Yes, I'm absolutely sure**.
Unsaved editors in the project ask to be saved or discarded first, whatever this says.

### Unload project: default terminal action

**Cog › Settings › Confirmations**

`projects.unloadTerminalAction`

What Unload Project does to the project's terminals: keep them running, or end them all.

**Default:** `keepRunning` · **Values:** `keepRunning` (Keep terminals running) · `endTerminals` (End terminals)

What the project menu's **Unload Project** row does to the project's terminals; the menu's second Unload row does the other: **Unload Project and End Terminals** under the shipped setting, **Unload Project and Keep Terminals Running** otherwise. Keep leaves every terminal alive, idle shells included, and reattaches each when the project is next loaded; End ends every terminal, running processes included; one that cannot be ended stays running, tells you once, and reattaches when the project is next loaded. Neither row asks anything; the only prompt Unload can show is the usual one for unsaved editors.

### Destroy a tab

**Cog › Settings › Confirmations**

`confirmations.destroyTab`

How many times throng asks before it destroys a tab and its panels.

**Default:** `double` · **Values:** `none` · `single` · `double`

Covers the tab's **✕**, **Destroy Tab** and **Destroy other tabs** on its menu, and the Resource Monitor's
**Destroy Tab**. The first confirmation counts the panels and how many are running a program; `double`
adds **Yes, I'm absolutely sure**. The last tab of a sub-workspace always asks once whatever this says,
because destroying it destroys the sub-workspace.

### Destroy a panel

**Cog › Settings › Confirmations**

`confirmations.destroyPanel`

How many times throng asks before it destroys a panel.

**Default:** `double` · **Values:** `none` · `single` · `double`

throng asks only when the panel's terminal is running a program; an idle shell, an editor or a preview
closes without a confirmation. An editor with unsaved changes asks to save or discard them first, whatever
this says, unless another panel still shows the same document.

### Destroy a sub-workspace

**Cog › Settings › Confirmations**

`confirmations.destroySubWorkspace`

How many times throng asks before it destroys a sub-workspace.

**Default:** `double` · **Values:** `none` · `single` · `double`

Destroying a sub-workspace destroys its tabs and the panels it owns, which cannot be recovered. A project
panel it only mirrored closes there and stays in its project. `double` adds **Yes, I'm absolutely sure**
after the first confirmation.

### Ask before opening external links

**Cog › Settings › Confirmations**

`confirmations.openExternalLink`

Show a link and ask before throng opens it in your browser or another app.

**Default:** on · **Values:** on · off

Every link that leaves throng asks first: a web address in a terminal or an editor, a link in a preview, About's
links, and the Help window's external links and **Open in browser**. The prompt shows the whole address, with
**Open** and **Cancel**; **Cancel** has the focus, and **Esc** or closing the prompt cancels too. Its **Change in
Preferences** button opens Preferences with this setting unfolded and in view, so you can turn the prompt off. Off, a link opens as soon as you follow
it. A file you open from a link is not an external link and never asks.

## Tabs

### Tab scroll animation

**Cog › Settings › Tabs**

`tabs.smoothScrollMs`

How long the tab strip takes to ease to a new position. Zero jumps there at once.

**Default:** 300 ms · **Values:** 0 – 1,500 ms, step 50 ms

The strip scrolls when it has more tabs than fit, to bring a tab into view or follow the scroll chevrons. Your system's "reduce motion" setting also makes it jump, overriding this without changing it.

### Tab close-button delay

**Cog › Settings › Tabs**

`tabs.closeArmingDelayMs`

How long the pointer must rest on a tab before its close button will act.

**Default:** 300 ms · **Values:** 0 – 1,500 ms, step 50 ms

The delay stops a click from closing a tab whose **✕** appeared under the pointer as it passed over the strip. A click before it has passed does nothing.

### Longest tab and panel name

**Cog › Settings › Tabs**

`tabs.maxNameLength`

The most characters a tab or panel name may have. throng shortens longer names on screen.

**Default:** 64 characters · **Values:** 10 – 128 characters, step 2 characters

A longer name is shortened on screen, and its full text still shows on hover. One limit covers tab names and panel names alike.

### Widest tab

**Cog › Settings › Tabs**

`tabs.maxWidth`

The widest a tab grows, in characters. A longer title ends in … and shows in full on hover.

**Default:** 32 characters · **Values:** 10 – 128 characters, step 2 characters

The widest a tab may be drawn, in characters. A longer title ends in … in the strip and shows in full on hover. The name keeps every character; the name limit above is what shortens names.

### New tabs open

**Cog › Settings › Tabs**

`tabs.newTabPosition`

Where a tab created with + goes: right of the active tab, or at the end of the strip.

**Default:** `afterActive` · **Values:** `afterActive` · `end`

`afterActive` keeps a new tab beside the one you were working in; `end` lines tabs up in the order you create them. A tab you drag goes where you drop it, whatever this says.

### Chevron repeat delay

**Cog › Settings › Tabs**

`tabs.chevronRepeatDelayMs`

How long you hold a scroll chevron before the strip keeps scrolling.

**Default:** 350 ms · **Values:** 100 – 1,500 ms, step 50 ms; 100 – 10,000 ms in the box

How long a press-and-hold on a scroll chevron waits before the strip starts scrolling continuously. Releasing the pointer stops it immediately.

### Tab popover delay

**Cog › Settings › Tabs**

`tabs.popoverDelayMs`

How long the pointer must rest on a tab before its popover appears. Zero shows it at once.

**Default:** 500 ms · **Values:** 0 – 1,500 ms, step 25 ms; 0 – 10,000 ms in the box

The popover shows the tab's full name and what it holds. A longer delay keeps it out of the way while you cross the strip.

### Tab hover-activate delay

**Cog › Settings › Tabs**

`behaviour.tabHoverActivateMs`

How long a dragged panel or tab must dwell over another tab before that tab comes to the front.

**Default:** 600 ms · **Values:** 0 – 1,500 ms, step 25 ms; 0 – 10,000 ms in the box

While **dragging** a panel or tab, how long it must dwell over another tab before that tab comes to the front so you can drop inside it. An ordinary mouse-over does nothing.

## File Explorer

### Show Open in OS Default Program

**Cog › Settings › File Explorer**

`explorer.showOpenInOsDefaultProgram`

Offer Open in OS Default Program on the File Explorer menu and on the panel title menu.

**Default:** on · **Values:** on · off

**Open in OS Default Program** hands a file to the program your operating system opens it with, such as an
image viewer or a spreadsheet application, and opens no panel in throng. Off, the item leaves the File
Explorer's right-click menu, an editor or preview panel's title menu and the icon in its header. Setting
a file type's **Open <files> in** to **Default OS Program** under [Previews](#previews) still works.

### File Explorer popover delay

**Cog › Settings › File Explorer**

`explorer.popoverDelayMs`

How long the pointer rests on a file or folder before its popover appears. Zero shows it at once.

**Default:** 500 ms · **Values:** 0 – 1,500 ms, step 25 ms; 0 – 10,000 ms in the box

How long the pointer must rest on a file or folder before a popover shows its icon, larger, beside its path. Zero shows it as soon as the pointer arrives.

### Open files with

**Cog › Settings › File Explorer**

`editor.openOnClick`

Whether one click or a double click on a file in File Explorer opens it, or neither does.

**Default:** `single` · **Values:** `single` · `double` · `none`

The file opens where **Open files in** below says, and as its type's **Open <files> in** says under
[Previews](#previews). With `none`, a click only selects; **Enter** or **Open In** on the right-click menu
opens the file. Whatever this says, a click on a folder selects it and a double click opens or closes it,
and Ctrl- or Shift-clicking selects several items without opening any.

### Open files in

**Cog › Settings › File Explorer**

`editor.openTarget`

Where an opened file lands: the last active editor (reused), or a new editor panel.

**Default:** `lastActive` · **Values:** `lastActive` · `new`

`lastActive` loads the file into the editor you used last in the tab, adding it to that editor's Back history, and opens a new editor only when the tab has none; if that editor has unsaved changes, it asks what to do with them first. `new` gives every file a panel of its own. Either way, a file already open in an editor is brought forward there instead of opening twice. A preview's **Open in Editor** follows this too.

### Delete files to

**Cog › Settings › File Explorer**

`explorer.deleteMode`

Send deleted files to the OS Recycle Bin, or delete them for good.

**Default:** `recycle` · **Values:** `recycle` · `permanent`

Applies to **Delete** in File Explorer. With `recycle`, a deleted item goes to the Recycle Bin (the Trash
on Linux and macOS), and throng's undo can bring it back. With `permanent`, the item is gone at once and
undo cannot restore it. What a paste or drag does to an item it replaces is the next setting's job.

### When Paste replaces an item

**Cog › Settings › File Explorer**

`explorer.replaceMode`

What happens to an item a paste or drag replaces: moved to the Recycle Bin for undo, or deleted.

**Default:** `recycle` · **Values:** `recycle` · `permanent`

When a paste or drag meets an item of the same name, throng asks; this decides what happens to the old item once you choose **Replace**. With `recycle`, undoing the paste brings it back; with `permanent`, it is gone. Independent of **Delete files to**.

### Excluded globs

**Cog › Settings › File Explorer**

`explorer.excludeGlobs`

Files and folders File Explorer hides, as glob patterns relative to the project folder.

**Default:** `**/.git`, `**/.svn`, `**/.hg`, `**/CVS`, `**/.DS_Store`, `**/Thumbs.db`, `**/node_modules` · **Values:** A list of root-relative glob patterns; may be empty

A pattern such as `**/node_modules` hides every folder of that name, at any depth. Hidden entries also stay out of Quick Open while **Quick Open hides excluded files** is on. An empty list hides nothing. Find in Files keeps a list of its own: see *Excluded from search*.

### Sort names

**Cog › Settings › File Explorer**

`explorer.sortOrder`

How File Explorer orders names: numbers by value (file 2 before file 10), or character by character.

**Default:** `natural` · **Values:** `natural` · `characters`

How names are ordered within folders and within files. `natural` compares numbers by their value (`file 2` before `file 10`); `characters` compares character by character (`file 10` before `file 2`). Folders always come first. Takes effect straight away.

### Follow the active editor

**Cog › Settings › File Explorer**

`explorer.autoRevealActiveFile`

Select the active editor's file in File Explorer, opening its folders to show it.

**Default:** on · **Values:** on · off

Each time you move to another editor, File Explorer scrolls to its file and selects it, while keyboard focus
stays in the editor. Off, the tree stays where you left it, and the open file still carries a quieter
mark in the tree wherever focus is. A file outside the project leaves the tree as it is. The preview
version is **Follow the active preview**, below.

### Follow the active preview

**Cog › Settings › File Explorer**

`explorer.autoRevealActivePreview`

Select the active preview's source file in File Explorer, opening its folders to show it.

Focus stays in the preview, and a preview of a file outside the project leaves the tree as it is. It works
independently of Follow the active editor.

**Default:** on · **Values:** on · off

### Copy-drag modifier

**Cog › Settings › File Explorer**

`explorer.dragCopyModifier`

The key you hold while dragging in File Explorer to copy instead of move.

**Default:** `ctrl` · **Values:** `ctrl` · `shift` · `alt`

A plain drag inside the tree moves what you drag; hold this key as you drop and it copies instead. A drag
from your file manager into the tree copies unless you hold **Move-drag modifier**. The label beside the
pointer says which will happen. Give the two settings different keys: when both are the same key, holding
it copies.

### Open unsupported files in the OS

**Cog › Settings › File Explorer**

`explorer.openUnsupportedInOs`

Open a file throng cannot show in your OS default program, instead of reporting it.

**Default:** on · **Values:** on · off

A file throng cannot show is one the editor refuses as binary, such as an executable, an archive or a
document format with no throng preview, when that file type does not open as a preview. On, opening one
from File Explorer, Quick Open or a link hands it to the program your operating system uses for it. Off,
throng raises one notice saying why it cannot open the file and naming the setting that would open it. A file
whose preview type is switched off under [Previews](#previews) counts as one throng cannot show.

### Move-drag modifier

**Cog › Settings › File Explorer**

`explorer.dragMoveModifier`

The key you hold while dragging in File Explorer to move instead of copy.

**Default:** `shift` · **Values:** `ctrl` · `shift` · `alt`

A drag from your file manager into the tree copies by default; hold this key and it moves the files
instead. Inside the tree a plain drag already moves, so the key there only makes sure a drag moves.

## Editor

### Auto-save

**Cog › Settings › Editor**

`editor.autoSave`

Save edits once you stop typing, without Ctrl+S.

**Default:** off · **Values:** on · off

On, each editor writes its file to disk once you have paused for **Auto-save delay**, so its unsaved marker
clears without `Ctrl+S`. The CSV Preview Editor saves the same way after each edit. A new document that has
never been saved has no file to write to, so it waits for **Save As**.

### Save Document Scroll Position

**Cog › Settings › Editor**

`editor.saveDocumentScroll`

Remember each document's scroll position, so reopening a file returns to where you were.

**Default:** off · **Values:** on · off

Reopening a file in the same editor then restores where you were, instead of starting at the top. Off, a file opens at its first line.

### Auto-save delay

**Cog › Settings › Editor**

`editor.autoSaveDebounceMs`

How long after you stop typing auto-save writes the file.

**Default:** 0.3 s (300 ms) · **Values:** 0 – 3 s, step 0.1 s

Applies only while **Auto-save** is on. Every keystroke restarts the wait, so a file is written once per
pause, not once per key. Zero writes after every change.

### Save-All scope

**Cog › Settings › Editor**

`editor.saveAllScope`

Which editors Save All saves: those in this tab, in this project, or in the whole window.

**Default:** `project` · **Values:** `tab` · `project` · `all`

**Save All** (`Ctrl+Shift+S`) saves every editor with unsaved changes in its scope: `tab`, the tab you are
in; `project`, every tab of the active project; `all`, every editor in the window. A new document that has
never been saved is passed by, since it has no file yet; save it with **Save As**.

### New-file line ending

**Cog › Settings › Editor**

`editor.defaultLineEnding`

The line ending applied to brand-new documents.

**Default:** `lf` · **Values:** `lf` · `crlf` · `cr`

`lf` is the Linux and macOS convention and what most tools expect; `crlf` is the Windows one; `cr` is the old Mac one. It applies to a document you create in throng. An existing file keeps its own, and the line-ending menu on the status bar converts a document's endings.

### Fallback encoding

**Cog › Settings › Editor**

`editor.fallbackEncoding`

The code page throng reads a file in when it is not UTF-8 or UTF-16, often called ANSI.

**Default:** `windows1252` · **Values:** `windows1250` … `windows1258`

throng recognises UTF-8 and UTF-16, with or without a byte order mark. A text file in neither is read in
this code page, the one older Windows programs saved in for your language, and saves back in it. Set it to
your own code page (Windows-1250 for Central European, Windows-1251 for Cyrillic, and so on) and those
files open with their accented letters intact. Find in Files and its replace read files the same way. A
document's encoding shows on the status bar, where you can reopen it in another.

### Max open file size

**Cog › Settings › Editor**

`editor.maxOpenFileBytes`

The largest file an editor opens. A larger file shows a notice instead.

**Default:** 10 MB (10,485,760 bytes) · **Values:** 5 – 250 MB, step 5 MB; 1,024 – 2,147,483,648 bytes in the box

The notice names the file's size and this limit. Raise the limit to open a large log or data file; a very
large document makes the editor slower to load and scroll. Find in Files skips files over the same limit,
and each preview type has a limit of its own under [Previews](#previews).

### Project editor path display

**Cog › Settings › Editor**

`editor.projectPathDisplay`

Show a project editor's header as the file's path in the project, or its name alone.

**Default:** `full` · **Values:** `full` · `name`

The file pill in an editor's header names the file it shows. With `full`, a file in a project's editor
reads as its path from the project folder, such as `\src\app.ts`; with `name`, as `app.ts`. When the
header is too narrow, the folders shorten first and the file name stays whole.

### Sub-workspace editor path display

**Cog › Settings › Editor**

`editor.subWorkspacePathDisplay`

Show a sub-workspace editor's header as the file's full path, or its name alone.

**Default:** `full` · **Values:** `full` · `name`

An editor a sub-workspace owns has no project folder to start from, so `full` shows the whole path from the
drive or root, such as `D:\notes\todo.md`. A project editor mirrored into a sub-workspace follows **Project
editor path display** instead.

### Warn on missing file

**Cog › Settings › Editor**

`editor.warnOnMissingFile`

Raise a notice for an editor whose file is missing or has been deleted.

**Default:** on · **Values:** on · off

throng checks when you switch to a tab: each editor in it whose file has gone, been moved or renamed
outside throng gets a line in one notice, which grows as you visit more tabs. A file that cannot be opened
for another reason, such as being too large, is reported whatever this says. Off, those editors stay in
their panels and raise no notice.

### Editor default word wrap

**Cog › Settings › Editor**

`editor.defaultWordWrap`

Wrap long lines by default in new editors. Each editor can toggle it for itself.

**Default:** on · **Values:** on · off

A wrapped line continues on the next row of the screen instead of running off to the right; the file itself gains no line breaks. Each editor toggles its own from its status bar, its content menu or [`Ctrl+E,W`](key-bindings.md#editor), and keeps that choice.

### Editor default view whitespace

**Cog › Settings › Editor**

`editor.defaultShowWhitespace`

Show a symbol for every space, tab, line break and invisible character by default in new editors.

**Default:** off · **Values:** on · off

The symbols show what the file holds where the screen shows blank space, such as trailing spaces, a tab among spaces, or an invisible character pasted in from elsewhere. Each editor keeps its own toggle, from its status bar, its content menu or [View Whitespace](key-bindings.md#editor).

### Editor whitespace hover names

**Cog › Settings › Editor**

`editor.whitespaceHoverNames`

Name a whitespace marker's character in a popover when the pointer rests on it.

**Default:** on · **Values:** on · off

Works while View Whitespace shows the markers. Rest the pointer on a marker for half a second and a popover above the pointer names its character, such as a tab or a no-break space, and the pointer becomes the help cursor. Off, neither happens.

### Show the editor gutter

**Cog › Settings › Editor**

`editor.showGutter`

Show line numbers down the left of every editor. Hiding them gives the width back to the document.

**Default:** on · **Values:** on · off

Show the strip of line numbers down the left-hand side of every editor. Hiding it gives that width back to the document, which then starts at the panel’s left edge.

### Highlight other occurrences of the selection

**Cog › Settings › Editor**

`editor.highlightOccurrences`

Tint the other places the text you selected appears, in an editor or a preview.

**Default:** on · **Values:** on · off

Softly tints every other instance of the text selected in an editor or Markdown preview. A whole-word selection tints whole words only; matching is case-sensitive.

### Keep undo history after a crash

**Cog › Settings › Editor**

`editor.persistUndoHistory`

Restore the undo history along with unsaved changes when throng reopens after a crash.

**Default:** on · **Values:** on · off

throng always recovers unsaved text after a crash; this also brings back each editor's undo history, so you can step back through edits made before it. Text you removed is kept in the recovery file until then. Off, a recovered editor starts with an empty undo history.

### Status Bar

#### Show panel status bar

**Cog › Settings › Editor › Status Bar**

`editor.showStatusBar`

Show the status bar along the bottom of editor and preview panels.

**Default:** on · **Values:** on · off

An editor's status bar carries the cursor position and counts, the encoding and line-ending menus, and the
word wrap and View Whitespace toggles; a preview's carries the toggles its type offers. Off hides the whole
bar in every editor and preview panel, whatever the two settings below say, and every toggle on it stays on
the panel's right-click menu. Terminals have a bar of their own: **Show terminal status bar**, under [Terminal](#terminal).

#### Show cursor position

**Cog › Settings › Editor › Status Bar**

`editor.statusBar.showCursorPosition`

Show the caret's line and column, or the lines a preview selection spans, in the status bar.

**Default:** on · **Values:** on · off

In an editor the readout is the caret's line and column, counting a tab as **Tab width** columns. In a
Markdown preview, selecting text shows which lines of the source file it came from. Off, the readout is
gone and the rest of the bar takes its room.

#### Show character and word counts

**Cog › Settings › Editor › Status Bar**

`editor.statusBar.showCounts`

Show the document's line, character and word counts in the status bar.

**Default:** on · **Values:** on · off

The counts cover the whole document, and while text is selected the bar also shows how many characters
the selection holds. Off, the counts are gone and the rest of the bar takes their room.

The encoding indicator (`UTF-8`, `UTF-8 with BOM`, `UTF-16 LE`, `UTF-16 BE`, `Windows-1250 (Central European)` … `Windows-1258 (Vietnamese)`) and the
line-ending indicator (`LF`, `CRLF`, `CR`, or `Mixed (…)` naming the dominant one) have no setting of
their own: they show whenever the status bar does. The encoding menu lists the Unicode encodings, then a **Windows Code Pages** submenu (ticked when
the document is in one of them) holding the nine code pages: choosing one changes the document's encoding, marked as an unsaved change you can undo, and its last item
reopens the file in another encoding. The line-ending menu lists LF, CR, CRLF and Mixed: choosing one
converts every line, and Mixed is marked when the document mixes them but cannot be chosen. When the
bar is too narrow they hide after the line number, line ending first; the wrap and View Whitespace
toggles never hide.

### Previews

A preview is a rendered view of a file beside its editor. throng ships eight preview types: **Markdown
Preview**, **Mermaid Preview**, the **CSV Preview Editor** (the one preview that edits, an editable grid
over the file), the read-only **Spreadsheet Preview** for workbooks, and **Image Preview**, **SVG Preview**,
**PDF Preview** and **HTML Preview**. Each has its own subsection below with an **Enabled** switch, an
**Open <files> in** choice and an **Open previews in** choice, plus any settings of its own.
**Open <files> in** picks what opening one of its files from File Explorer, Quick Open or a link does:
**Throng Editor** (`editor`), **Throng Preview** (`preview`) or **Default OS Program** (`os`), which hands
the file to the program your operating system opens it with and opens no panel. A Find in Files result set
to Default OS Program opens an editor at the match, and **Open In**'s targets always do what they name.
Turning a type off closes its open previews and greys its other settings, which stay in view.
The settings in this table apply to every preview type.

#### Preview update delay

**Cog › Settings › Editor › Previews**

`editor.previews.updateDelayMs`

How long a preview waits after you stop typing before it shows your changes. Zero updates at once.

**Default:** 300 ms · **Values:** 0 – 2,000 ms, step 25 ms; 0 – 10,000 ms in the box

A preview beside its editor draws your unsaved text, so it follows as you type without a save. Each
keystroke restarts the wait, which keeps a large document or diagram from redrawing on every key;
**Preview maximum wait** below caps how long steady typing can hold it off.

#### Preview maximum wait

**Cog › Settings › Editor › Previews**

`editor.previews.maxWaitMs`

The longest a preview goes without showing your changes while you keep typing.

**Default:** 1 s (1,000 ms) · **Values:** 0 – 10 s, step 0.5 s

The longest a preview beside an editor goes without showing your changes while you keep typing. A value below the update delay behaves as the update delay.

#### Preview copy format

**Cog › Settings › Editor › Previews**

`editor.previews.copyFormat`

What Copy takes from a preview: formatted text that keeps headings, lists and links, or plain text.

**Default:** `rich` · **Values:** `rich` (Rich text) · `plain` (Plain text)

What Copy puts on the clipboard from a preview: formatted text that keeps headings, lists and links when pasted into a document, or plain text alone.

#### Synchronise preview and editor scrolling

**Cog › Settings › Editor › Previews**

`editor.previews.syncScroll`

Keep a preview and its editor scrolled to the same place, in both directions.

**Default:** on · **Values:** on · off

Scrolling either panel scrolls the other, block by block, so the paragraph you are editing stays in view in the preview. Also switched from either panel's header menu, the **Synchronise Scrolling** status-bar button, or the [`preview.toggleSyncScroll`](key-bindings.md#editor) command.

#### Scroll-sync highlight duration

**Cog › Settings › Editor › Previews**

`editor.previews.syncHighlightMs`

How long the highlight shows after Synchronise Scrolling moves a preview or editor. 0 shows none.

**Default:** 1.5 s (1,500 ms) · **Values:** 0 – 10 s, step 0.5 s; 0 – 60,000 ms in the box

How long the soft highlight stays on the place a preview and its editor are in step at after Synchronise Scrolling moves one with the other, in both views, before it fades out. `0` shows no highlight at all. A visual guide only: scrolling is kept in step either way.

#### Markdown

##### Markdown: Enabled

**Cog › Settings › Editor › Previews**

`editor.previews.providers.markdown.enabled`

Offer previews of Markdown files. Off closes them and disables their preview commands.

**Default:** on · **Values:** on · off

Offer previews of `.md` and `.markdown` files. Off, every such preview closes and the preview commands are shown disabled.

##### Open Markdown files in

**Cog › Settings › Editor › Previews**

`editor.previews.providers.markdown.defaultOpenAction`

Where Markdown files open from File Explorer, Quick Open, links and Find in Files.

**Default:** `preview` · **Values:** `editor` (Throng Editor) · `preview` (Throng Preview) · `os` (Default OS Program)

What opening a Markdown file from File Explorer, Quick Open, a link or a Find in Files result does. **Open In**'s targets always do what they name.

##### Markdown: Open previews in

**Cog › Settings › Editor › Previews**

`editor.previews.providers.markdown.openTarget`

Where Markdown previews open: reuse the last one used in this tab, or a new panel.

**Default:** `lastActive` · **Values:** `lastActive` (Last Active) · `new` (New Preview Panel)

Last Active reuses the most recently used Markdown preview in the tab you are looking at (from an editor's preview button too), adding to its Back history; otherwise a new preview opens. New opens every preview in a panel of its own. **Open In → Last Preview Panel / New Preview Panel**, in the File Explorer and on Find in Files results, let you choose. A value saved under the former single `editor.previews.openTarget` key is carried over to each preview type.

##### Markdown: Render Mermaid diagrams

**Cog › Settings › Editor › Previews**

`editor.previews.providers.markdown.renderMermaid`

Draw a mermaid code block in a Markdown preview as its diagram. When off, the block shows as code.

**Default:** on · **Values:** on · off

A code block fenced as `mermaid` holds a diagram written in Mermaid's text syntax: flowcharts, sequence diagrams and the like. On, the preview draws the diagram in place of the code. Off, the block shows as code.

##### Markdown: Typeset math

**Cog › Settings › Editor › Previews**

`editor.previews.providers.markdown.typesetMath`

Draw mathematics written between dollar signs, or in a math code block, as typeset equations.

**Default:** on · **Values:** on · off

Draw TeX maths (`$…$`, `$$…$$` and `math` code blocks) as typeset equations. Off, each expression shows as the text it was written in.

##### Markdown: Load remote images

**Cog › Settings › Editor › Previews**

`editor.previews.providers.markdown.loadRemoteImages`

Show images a Markdown document links from the web over https. Off shows their alternative text.

**Default:** on · **Values:** on · off

Such images include build badges and screenshots hosted online, and only secure `https:` addresses load. Off, each shows its alternative text and throng requests nothing from the web for them.

##### Markdown: Show front matter

**Cog › Settings › Editor › Previews**

`editor.previews.providers.markdown.showFrontMatter`

Show the metadata block at the top of a Markdown document as a table. Off hides it.

**Default:** on · **Values:** on · off

Show the block of metadata at the top of a Markdown document, such as its title and tags, as a table. When off, the block is not shown at all and the document begins after it.

##### Markdown: Preview gutter

**Cog › Settings › Editor › Previews**

`editor.previews.providers.markdown.gutter`

Show a gutter with a fold arrow beside each heading in a Markdown preview.

**Default:** on · **Values:** on · off

A narrow strip down a Markdown preview's left edge holding a fold arrow beside each heading; the document moves right to make room. Off, the strip and its arrows are gone and folding stays available from the menus and bindings.

##### Markdown: Heading jump scroll duration

**Cog › Settings › Editor › Previews**

`editor.previews.providers.markdown.headingJumpMs`

How long a Markdown preview takes to scroll to a heading you jump to. 0 jumps at once.

**Default:** 200 ms · **Values:** 0 – 1,500 ms, step 50 ms; 0 – 5,000 ms in the box

How long a jump from [Go to Heading](key-bindings.md#navigate) takes to scroll there. Zero jumps there at once.

##### Markdown sections open

**Cog › Settings › Editor › Previews**

`editor.markdownSectionsOpen`

How a Markdown document's heading sections start out, in the editor and a fresh preview.

**Default:** `expanded` · **Values:** `expanded` · `collapsed`

Whether a Markdown document opens with its heading sections expanded or collapsed, in the editor and in a fresh preview alike. Either way, you then fold and unfold sections from the gutter, the right-click menu, **Collapse All** / **Expand All** or the [Markdown bindings](key-bindings.md#markdown).

#### Mermaid

##### Mermaid: Preview .mmd files

**Cog › Settings › Editor › Previews**

`editor.previews.providers.mermaid.enabled`

Offer previews of .mmd and .mermaid files. Markdown's Render Mermaid diagrams covers the rest.

**Default:** on · **Values:** on · off

Offer previews of standalone `.mmd` and `.mermaid` files, drawn as their diagram. Off, every such preview closes. **Markdown: Render Mermaid diagrams** controls the diagrams inside a Markdown preview.

##### Open Mermaid files in

**Cog › Settings › Editor › Previews**

`editor.previews.providers.mermaid.defaultOpenAction`

Where Mermaid files open from File Explorer, Quick Open, links and Find in Files.

**Default:** `preview` · **Values:** `editor` (Throng Editor) · `preview` (Throng Preview) · `os` (Default OS Program)

As **Open Markdown files in**, for Mermaid files. Ships as `preview`, so a diagram file opens as its diagram.

##### Mermaid: Open previews in

**Cog › Settings › Editor › Previews**

`editor.previews.providers.mermaid.openTarget`

Where Mermaid previews open: reuse the last one used in this tab, or a new panel.

**Default:** `lastActive` · **Values:** `lastActive` (Last Active) · `new` (New Preview Panel)

As **Markdown: Open previews in**, for Mermaid previews; a Markdown preview is never reused for a Mermaid file, or the reverse.

#### CSV

The CSV Preview Editor shows a `.csv` as a grid you edit like a document: the same unsaved marker,
Save, Undo, Redo, **Editor: Auto save** and close-with-unsaved-changes prompt as the text editor, on the
one document both share. A save changes only the fields you edited; every other byte of the file is kept.

##### CSV: Enabled

**Cog › Settings › Editor › Previews**

`editor.previews.providers.csv.enabled`

Offer the CSV Preview Editor, the editable grid for .csv files. Off closes it.

**Default:** on · **Values:** on · off

Off, every CSV Preview Editor closes (asking first about unsaved changes) and its preview commands are shown disabled; a CSV still opens in the text editor.

##### Open CSVs in

**Cog › Settings › Editor › Previews**

`editor.previews.providers.csv.defaultOpenAction`

Where CSVs open from File Explorer, Quick Open, links and Find in Files.

**Default:** `preview` · **Values:** `editor` (Throng Editor) · `preview` (Throng Preview Editor) · `os` (Default OS Program)

As **Open Markdown files in**, for CSVs. Ships as `preview`, so a CSV opens in the CSV Preview Editor.

##### CSV: Open previews in

**Cog › Settings › Editor › Previews**

`editor.previews.providers.csv.openTarget`

Where CSV previews open: reuse the last one used in this tab, or a new panel.

**Default:** `lastActive` · **Values:** `lastActive` (Last Active) · `new` (New Preview Panel)

As **Markdown: Open previews in**, for CSV Preview Editors.

##### CSV: Edit long cells in a dialog

**Cog › Settings › Editor › Previews**

`editor.previews.providers.csv.editLongCellsInDialog`

Edit a cell longer than the threshold in a dialog instead of in place.

**Default:** on · **Values:** on · off

Double-click, **F2** and **Enter** on a cell longer than **Long cell threshold** open a dialog holding an editor, in place of the in-cell editor; typing a character still edits in place. Every cell's menu offers **Edit in Dialog…**. A value that is a JSON object or array opens pretty-printed and highlighted; saving turns each line break (with the indentation after it, for JSON) into one space. Off, there is no dialog at all. Each CSV Preview Editor can switch it on or off for itself from the toggle at the right of its status bar, or its **Edit Long Cells in Dialog** menu item; a panel that has not follows this setting.

##### CSV: Long cell threshold

**Cog › Settings › Editor › Previews**

`editor.previews.providers.csv.longCellThreshold`

A cell with more characters than this opens in the cell dialog when you edit it.

**Default:** 50 characters · **Values:** 10 – 1,000 characters, step 10 characters; 1 – 100,000 characters in the box

Counts the cell's characters when you start editing it with a double-click, **F2** or **Enter**. Used only while **CSV: Edit long cells in a dialog** is on; lower it to edit more cells in the roomier dialog.

##### CSV: Edit multi-line cells in a dialog

**Cog › Settings › Editor › Previews**

`editor.previews.providers.csv.multiLineCellsInDialog`

Open a cell holding a line break in the cell dialog, however short it is.

**Default:** on · **Values:** on · off

A cell holding a line break opens in the cell dialog on double-click, **F2** or **Enter**, however short. Off, it opens there only when it is longer than **Long cell threshold**.

##### CSV: Wrap cells

**Cog › Settings › Editor › Previews**

`editor.previews.providers.csv.wrapCells`

Show every cell in full: line breaks kept, values wrapped, rows as tall as their tallest cell.

**Default:** off · **Values:** on · off

There is no cap on how tall a row grows. Off, a cell is one truncated line. Each CSV Preview Editor can switch wrapping on or off for itself from the **Wrap** toggle on its status bar, or its **Wrap** menu item; a panel that has not follows this setting. Wrapping changes only how the grid draws and never edits the file.

##### CSV: Lock first row

**Cog › Settings › Editor › Previews**

`editor.previews.providers.csv.lockFirstRow`

Keep the first row in view however far you scroll down.

**Default:** off · **Values:** on · off

Keep the first row directly under the column letters however far the table is scrolled down, set apart by a line. It is still an ordinary row: select it, edit it, use its menu. Each CSV Preview Editor can switch it on or off for itself from the **Lock first row** toggle on its status bar, or its **Lock First Row** menu item; a panel that has not follows this setting. Locking changes only how the grid draws and never edits the file.

##### CSV: Lock first column

**Cog › Settings › Editor › Previews**

`editor.previews.providers.csv.lockFirstColumn`

Keep the first column in view however far you scroll across.

**Default:** off · **Values:** on · off

Keep the first column beside the row numbers however far the table is scrolled across, set apart by a line. Each CSV Preview Editor can switch it on or off for itself from the **Lock first column** toggle on its status bar, or its **Lock First Column** menu item; a panel that has not follows this setting.

#### Spreadsheet

A read-only preview of a workbook (`.xlsx`, `.xlsm`, `.xlsb`, `.xls`, `.ods`, `.fods` and `.numbers`),
with a sheet switcher and each sheet as a grid. Formula cells show the value stored in the file; nothing is
recalculated and no macro runs. Neither Office nor LibreOffice is needed.

##### Spreadsheet: Enabled

**Cog › Settings › Editor › Previews**

`editor.previews.providers.spreadsheet.enabled`

Offer previews of spreadsheet workbooks, such as .xlsx, .ods and .numbers. Off closes them.

**Default:** on · **Values:** on · off

Covers `.xlsx`, `.xlsm`, `.xlsb`, `.xls`, `.ods`, `.fods` and `.numbers` files. Off, every spreadsheet preview closes and the preview commands are shown disabled.

##### Open spreadsheets in

**Cog › Settings › Editor › Previews**

`editor.previews.providers.spreadsheet.defaultOpenAction`

Where spreadsheets open from File Explorer, Quick Open, links and Find in Files.

**Default:** `preview` · **Values:** `preview` (Throng Preview) · `os` (Default OS Program)

As **Open Markdown files in**, for workbooks. There is no editor option: a workbook is not text.

##### Spreadsheet: Open previews in

**Cog › Settings › Editor › Previews**

`editor.previews.providers.spreadsheet.openTarget`

Where Spreadsheet previews open: reuse the last one used in this tab, or a new panel.

**Default:** `lastActive` · **Values:** `lastActive` (Last Active) · `new` (New Preview Panel)

As **Markdown: Open previews in**, for spreadsheet previews.

##### Spreadsheet: First row is a header

**Cog › Settings › Editor › Previews**

`editor.previews.providers.spreadsheet.firstRowHeader`

Show each sheet's first row in the column header strip instead of the column letters.

**Default:** off · **Values:** on · off

For a workbook whose first row names its columns. On, that row moves into the strip above the grid, in place
of the letters A, B, C; a column whose first cell is empty keeps its letter.
Printing repeats the header row on every page. The workbook itself is never changed.

##### Spreadsheet: Preview size limit

**Cog › Settings › Editor › Previews**

`editor.previews.providers.spreadsheet.maxPreviewBytes`

The largest workbook a spreadsheet preview loads.

**Default:** 25 MB (26,214,400 bytes) · **Values:** 5 – 500 MB, step 5 MB; 1,024 – 2,147,483,648 bytes in the box

A larger workbook shows a notice naming its size and this limit; raise the limit and choose **Refresh** to load it.

#### Image

An image opens in the centre of its panel, on a canvas filling the panel, with its transparent parts
hatched so its edges show (the colours are the theme's [Picture Preview Background and Picture
Transparency Marker](#themes-and-icon-sets)). It carries the view controls a Mermaid diagram has, top
left: Fit, Zoom In, Zoom 100%, Zoom Out, middle-button drag, Ctrl+wheel to zoom about the pointer, and
**Copy Image** on the right-click menu. It opens at 100%, or fitted when it is larger than the panel; Fit fills
the panel, enlarging a small image. An image larger
than the panel, or zoomed in past it, scrolls both ways; a middle-button drag scrolls it, or moves the
image itself across a panel it does not fill.

##### Image: Enabled

**Cog › Settings › Editor › Previews**

`editor.previews.providers.image.enabled`

Offer previews of Image files. Off closes them and disables their preview commands.

**Default:** on · **Values:** on · off

Offer previews of `.png`, `.apng`, `.jpg`, `.jpeg`, `.jfif`, `.pjpeg`, `.pjp`, `.gif`, `.webp`, `.avif`, `.bmp`, `.dib`, `.ico` and `.cur` files. Off, every such preview closes and the preview commands are shown disabled.

##### Open images in

**Cog › Settings › Editor › Previews**

`editor.previews.providers.image.defaultOpenAction`

Where images open from File Explorer, Quick Open, links and Find in Files.

**Default:** `preview` · **Values:** `preview` (Throng Preview) · `os` (Default OS Program)

As **Open Markdown files in**, for images. There is no editor option: an image is not text. Choose
`os` to have your image viewer or editor open them instead of a throng panel.

##### Image: Open previews in

**Cog › Settings › Editor › Previews**

`editor.previews.providers.image.openTarget`

Where Image previews open: reuse the last one used in this tab, or a new panel.

**Default:** `lastActive` · **Values:** `lastActive` (Last Active) · `new` (New Preview Panel)

As **Markdown: Open previews in**, for Image previews.

##### Image: Maximum file size

**Cog › Settings › Editor › Previews**

`editor.previews.providers.image.maxFileBytes`

Images larger than this are not read; the preview says how large the file is instead.

**Default:** 50 MB (52,428,800 bytes) · **Values:** 5 – 250 MB, step 5 MB; 1,024 – 2,147,483,648 bytes in the box

A file larger than this is not read: the preview names its size and this limit instead. Raise it and press **Refresh** to show the file.

##### Image: Hatch transparent areas

**Cog › Settings › Editor › Previews**

`editor.previews.providers.image.transparencyHatch`

Hatch the transparent parts of images, so their edges show against the background.

**Default:** on · **Values:** on · off

Draw diagonal hatching behind an image's transparent parts, in the theme's Picture Transparency Marker. Off, the canvas shows through plainly.

#### SVG

An SVG is drawn as a picture, never as part of throng's own page: an SVG file can carry scripts and
links to remote content, and none of it runs or loads. Beside its editor the drawing follows your
unsaved changes. It sits on the same canvas, with the same hatching, controls and scrolling, as an
image. A `svg` code block in a Markdown note is drawn the same way.

##### SVG: Enabled

**Cog › Settings › Editor › Previews**

`editor.previews.providers.svg.enabled`

Offer previews of SVG files. Off closes them and disables their preview commands.

**Default:** on · **Values:** on · off

Offer previews of `.svg` files. Off, every such preview closes and the preview commands are shown disabled.

##### Open SVG files in

**Cog › Settings › Editor › Previews**

`editor.previews.providers.svg.defaultOpenAction`

Where SVG files open from File Explorer, Quick Open, links and Find in Files.

**Default:** `preview` · **Values:** `editor` (Throng Editor) · `preview` (Throng Preview) · `os` (Default OS Program)

As **Open Markdown files in**, for SVG files. An SVG is text, so `editor` opens its markup; the preview's
**Open in Editor** gets you there from a drawing too.

##### SVG: Open previews in

**Cog › Settings › Editor › Previews**

`editor.previews.providers.svg.openTarget`

Where SVG previews open: reuse the last one used in this tab, or a new panel.

**Default:** `lastActive` · **Values:** `lastActive` (Last Active) · `new` (New Preview Panel)

As **Markdown: Open previews in**, for SVG previews.

##### SVG: Maximum file size

**Cog › Settings › Editor › Previews**

`editor.previews.providers.svg.maxFileBytes`

SVG files larger than this are not read; the preview says how large the file is instead.

**Default:** 10 MB (10,485,760 bytes) · **Values:** 5 – 250 MB, step 5 MB; 1,024 – 2,147,483,648 bytes in the box

A file larger than this is not read: the preview names its size and this limit instead. Raise it and press **Refresh** to show the file. A preview beside its editor applies the same limit to the unsaved text.

##### SVG: Hatch transparent areas

**Cog › Settings › Editor › Previews**

`editor.previews.providers.svg.transparencyHatch`

Hatch the transparent parts of SVGs, so their edges show against the background.

**Default:** on · **Values:** on · off

Draw diagonal hatching behind an SVG's transparent parts, in the theme's Picture Transparency Marker. Off, the canvas shows through plainly.

#### PDF

A PDF shows its pages one after another, at 100%, or fitted to the panel's width when a page is wider; throng draws pages as they come into
view. Its view controls, top left (Fit page width, Zoom In, Zoom 100%, Zoom Out), and the panel's zoom
chords and Ctrl+wheel redraw them sharp at the new size. Beside them, and on the right-click menu, the page
layouts: **Single Page**, **Two Pages** (two to a row, which Fit fills the width with) and **Pages Side by
Side** (as many to a row as fit, re-flowed as the panel is resized); a middle-button drag moves around the pages, and
[`Ctrl+G`](key-bindings.md#navigate) goes to a page. Its text can be selected and copied. Nothing in a
PDF runs, and a link follows only on Ctrl+click.

##### PDF: Enabled

**Cog › Settings › Editor › Previews**

`editor.previews.providers.pdf.enabled`

Offer previews of PDF files. Off closes them and disables their preview commands.

**Default:** on · **Values:** on · off

Offer previews of `.pdf` files. Off, every such preview closes and the preview commands are shown disabled.

##### Open PDFs in

**Cog › Settings › Editor › Previews**

`editor.previews.providers.pdf.defaultOpenAction`

Where PDFs open from File Explorer, Quick Open, links and Find in Files.

**Default:** `preview` · **Values:** `preview` (Throng Preview) · `os` (Default OS Program)

As **Open Markdown files in**, for PDFs. There is no editor option: a PDF is not text. Choose `os` to
read them in your own PDF reader instead.

##### PDF: Open previews in

**Cog › Settings › Editor › Previews**

`editor.previews.providers.pdf.openTarget`

Where PDF previews open: reuse the last one used in this tab, or a new panel.

**Default:** `lastActive` · **Values:** `lastActive` (Last Active) · `new` (New Preview Panel)

As **Markdown: Open previews in**, for PDF previews.

##### PDF: Maximum file size

**Cog › Settings › Editor › Previews**

`editor.previews.providers.pdf.maxFileBytes`

PDFs larger than this are not read; the preview says how large the file is instead.

**Default:** 100 MB (104,857,600 bytes) · **Values:** 5 – 250 MB, step 5 MB; 1,024 – 2,147,483,648 bytes in the box

A file larger than this is not read: the preview names its size and this limit instead. Raise it and press **Refresh** to show the file.

#### HTML

An HTML page is shown as its static markup in a sandboxed frame, with the stylesheets, fonts and images
beside it in the project: no script runs and the page cannot navigate. A link follows only on Ctrl+click. The
page fills its panel at every zoom; a click in it makes the panel active, and the zoom chords, Ctrl+wheel and
the app's other shortcuts work while it has the keyboard. An edit updates the page in place, keeping where you
were scrolled. Find searches the page, and a right-click offers Copy, Copy as (rich or plain text) and Select All.

Nothing is fetched from the network except stylesheets, fonts and images from a **safe source**: one listed in
**HTML: Safe preview sources** below, which applies to every project, or in the project's own list in
**Project Settings**. When a page names a remote resource that is not loaded, one notice in the panel lists
each one under its source, with **Allow this source** to add that source to the project's list.

##### HTML: Enabled

**Cog › Settings › Editor › Previews**

`editor.previews.providers.html.enabled`

Offer previews of HTML files. Off closes them and disables their preview commands.

**Default:** on · **Values:** on · off

Offer previews of `.html` and `.htm` files. Off, every such preview closes and the preview commands are shown disabled.

##### Open HTML files in

**Cog › Settings › Editor › Previews**

`editor.previews.providers.html.defaultOpenAction`

Where HTML files open from File Explorer, Quick Open, links and Find in Files.

**Default:** `preview` · **Values:** `editor` (Throng Editor) · `preview` (Throng Preview) · `os` (Default OS Program)

As **Open Markdown files in**, for HTML files. Choose `editor` if you mostly edit pages, or `os` to have
the program your system opens web pages with, usually a browser, show them with their scripts running.

##### HTML: Open previews in

**Cog › Settings › Editor › Previews**

`editor.previews.providers.html.openTarget`

Where HTML previews open: reuse the last one used in this tab, or a new panel.

**Default:** `lastActive` · **Values:** `lastActive` (Last Active) · `new` (New Preview Panel)

As **Markdown: Open previews in**, for HTML previews.

##### HTML: Maximum file size

**Cog › Settings › Editor › Previews**

`editor.previews.providers.html.maxFileBytes`

HTML files larger than this are not read; the preview says how large the file is instead.

**Default:** 10 MB (10,485,760 bytes) · **Values:** 5 – 250 MB, step 5 MB; 1,024 – 2,147,483,648 bytes in the box

A file larger than this is not read: the preview names its size and this limit instead. Raise it and press **Refresh** to show the file. A preview beside its editor applies the same limit to the unsaved text.

##### HTML: Safe preview sources

**Cog › Settings › Editor › Previews**

`editor.previews.providers.html.safeSources`

Sites an HTML preview may load stylesheets, fonts and images from. Project Settings can add more.

**Default:** `https://fonts.googleapis.com`, `https://fonts.gstatic.com` · **Values:** A list of `https:` addresses, each a host (`https://cdn.example.com`, with a port if it needs one) or every subdomain of one (`https://*.example.com`); may be empty

Each entry is an `https:` address an HTML preview may load stylesheets, fonts and images from, in every project. Scripts never run, whatever is listed. A project adds sources of its own in **Project Settings**, and a page's notice about blocked resources offers **Allow this source** to add one there.

### Links

Paths a program prints, web addresses, allowed protocols and the hyperlinks a program declares are
followable in terminals, editors and previews with Ctrl+click, the Link menu, or
[`Ctrl+Enter`](key-bindings.md#navigate) in an editor or preview. A link is recognised by its text
alone; nothing checks that it exists before it is drawn.

**Where a followed link goes is fixed, not a setting**, and depends on what it names: a web or
loopback address opens in the system browser; a file in the project opens in throng, in a preview or
an editor by that file type's default open action under [Previews](#previews), and always an editor
when the link names a line and column; a folder, a network path, a `file:` URL and anything else on
disk is shown in OS Explorer; and an allowed protocol goes to its own handler. **A click never runs a
file and never opens one in its default program.** For that, choose *Open in OS
Default Program* or, for an executable, *Open Program* from the Link menu. *Find in File Explorer* on
the Link menu selects a linked file or folder in throng's own File Explorer; it is offered once the link
is found inside the project. The link underline and the
plain-click hint take their colours from the theme (see [Themes](#themes-and-icon-sets)).

#### Detect links in editors

**Cog › Settings › Editor › Links**

`editor.links.detectInEditors`

Show links in editor documents: detected paths, web links, protocol links and declared hyperlinks.

**Default:** on · **Values:** on · off

Show every kind of link in editor documents. Off, none are shown, and Ctrl+click and `Ctrl+Enter` keep their ordinary editor meanings (add a cursor, insert a blank line).

#### Detect links in terminals

**Cog › Settings › Editor › Links**

`editor.links.detectInTerminals`

Show links in terminal output: detected paths, web links, protocol links and declared hyperlinks.

**Default:** on · **Values:** on · off

Show every kind of link in terminal output. Off, none are shown and Ctrl+click follows nothing. A running terminal keeps its scrollback.

#### Link resolution timeout

**Cog › Settings › Editor › Links**

`editor.links.existenceCheckTimeoutMs`

How long throng looks for a link's target when you follow it or open its Link menu.

**Default:** 2 s (2,000 ms) · **Values:** 0.25 – 25 s, step 0.25 s

A path link can name a file relative to several folders, so throng looks in each place it could be before it opens the file or fills the Link menu. This is how long that search may take in total. A link on a slow network share may need longer; raise it and the next link you follow uses it, with no restart. throng draws links without this check: it runs only when you act on one.

#### Allowed link protocols

**Cog › Settings › Editor › Links**

`editor.links.protocolAllowlist`

Link types besides web addresses that terminals and editors make clickable, such as mailto.

**Default:** `mailto`, `tel`, `slack` · **Values:** A list of scheme names, with or without the colon, any case; may be empty

Each entry is a URI scheme, the part before the colon in `mailto:` or `slack://`. A link with a listed scheme is drawn as a link in terminals and editors, and following it hands it to the app your system registers for that scheme. Enter a name with or without its colon; case does not matter. An email address written on its own is a `mailto:` link while that scheme is listed. throng refuses schemes that run code (`javascript`, `data`, `vbscript`, `ms-msdt`, `search-ms` and the like) whatever the list says.

#### File extensions that end a spaced path

**Cog › Settings › Editor › Links**

`editor.links.knownFileExtensions`

Extensions that mark where an unquoted path with spaces ends, in terminals and editors.

**Default:** The extensions throng ships with · **Values:** A list, each with or without its leading dot, any case; may be empty

A program often prints a path with spaces without quoting it, such as `D:\My Files\report final.pdf`. throng reads such a path as one link up to an extension in this list, so the whole path is clickable rather than only `D:\My`. Each entry is taken with or without its leading dot, and in any case. An empty list means an unquoted path ends at its first space. Once you have edited it, extensions added in a later release do not appear in it.

### Navigation

#### Quick Open hides excluded files

**Cog › Settings › Editor › Navigation**

`editor.navigation.quickOpenExcludeHidden`

Leave the files this project hides out of Quick Open.

**Default:** on · **Values:** on · off

A project hides files through File Explorer's **Excluded globs** and through anything you chose **Hide in this project** for. A control in the modal shows them for that one search, without changing this.

#### Remember the last Quick Open query

**Cog › Settings › Editor › Navigation**

`editor.navigation.rememberQuickOpenQuery`

Reopen Quick Open with the last query that opened a file, until throng closes.

**Default:** off · **Values:** on · off

The query comes back with its results, selected so typing replaces it. throng forgets a query you abandoned with Escape, and one from another project. It lasts until throng closes and never reaches the disk.

#### Remember the last Go To Line number

**Cog › Settings › Editor › Navigation**

`editor.navigation.rememberGotoLineNumber`

Reopen Go To Line with the last line number you went to, until throng closes.

**Default:** off · **Values:** on · off

The number comes back selected, so typing replaces it. It lasts until throng closes and never reaches the disk.

#### Navigation history size

**Cog › Settings › Editor › Navigation**

`editor.navigation.historySize`

How many files Back and Forward remember in each editor and preview panel.

**Default:** 10 entries · **Values:** 1 – 100 entries, step 1

Each panel keeps its own list: opening another file in it adds one, and Back and Forward move along it. Lowering this trims every open panel at once, keeping the file each one shows. History persists across restarts.

### Indentation

A file that already indents one way keeps doing so; otherwise its language's entry applies, and
otherwise the defaults below. A setting never reformats an existing document. It decides what the
next indent inserts.

#### Indent with

**Cog › Settings › Editor › Indentation**

`editor.indent.style`

What a new indent inserts, unless the file or its language says otherwise.

**Default:** `spaces` · **Values:** `spaces` · `tabs`

What **Tab** and a new line's automatic indent insert: `spaces` puts in **Indent width** spaces per level,
`tabs` one tab character. A file whose lines already indent one way keeps that way, and a language listed
in **Indentation by language** uses its own entry.

#### Indent width

**Cog › Settings › Editor › Indentation**

`editor.indent.indentWidth`

How many spaces one indent level inserts.

**Default:** 2 columns · **Values:** 1 – 16 columns, step 1

Used when indenting with spaces. A file already indented with spaces keeps the width its lines use, so a
four-space file stays four-space whatever this says.

#### Tab width

**Cog › Settings › Editor › Indentation**

`editor.indent.tabWidth`

How many columns a tab character takes on screen. The file stays as it is.

**Default:** 4 columns · **Values:** 1 – 16 columns, step 1

A tab is one character in the file; this decides only how wide it is drawn, and so where text after it lines
up. The column number on the status bar counts a tab as this many columns. A language's entry in
**Indentation by language** can set its own.

#### Indentation by language

**Cog › Settings › Editor › Indentation**

`editor.indentByLanguage`

Indentation for new indents, by language. A file that already indents its own way keeps it.

**Default:** Each language's convention · **Values:** A table: language → style, width (1 – 16 columns, step 1), tab width (1 – 16 columns, step 1); a value past a limit is stored as that limit, and a fraction is refused

Each language's entry sets its indent style, width and tab width, so Go can indent with tabs and Python with four spaces while the defaults above cover the rest. It cannot be emptied, because that would re-indent every language with the global default.

### Languages

#### Language by file extension

**Cog › Settings › Editor › Languages**

`editor.languageByExtension`

Map a file extension to a language, e.g. “.foo” → Python. Overrides the built-in detection.

**Default:** empty · **Values:** A table: extension → language

Map an extension to a language (for example `.foo` → Python), overriding detection by extension. A file throng recognises by name, such as `tsconfig.json`, keeps that language; only the picker changes it ([how the language is chosen](../site/guide/editing.md#set-the-language-of-a-file)).

## Terminal

### Use Option as Meta (macOS only)

**Cog › Settings › Terminal**

`terminals.macOptionIsMeta`

Make Option act as the Meta key in terminals, so programs that use Meta receive it.

**Default:** off · **Values:** on · off

Shells and editors such as bash, zsh and Emacs use Meta for shortcuts like Meta+B and Meta+F, a word back and forward. On, Option+B and Option+F reach them as those shortcuts. Off, Option types the characters your keyboard layout puts on it, such as # or @.

### Custom terminal flavours

**Cog › Settings › Terminal**

`terminals.flavours`

Shells you add to the Flavour dropdown, each with its own program and arguments.

**Default:** none · **Values:** A table of flavours, in order: an id (required, unique), a label, the executable (required), its arguments and default shell arguments

Shells of your own, offered in the Flavour dropdown after the built-ins, in this order. Edited in a [list window](#lists-and-tables); a row needs an id and an executable before it is saved.

### Default shell arguments

**Cog › Settings › Terminal**

`terminals.defaultShellArguments`

Arguments a shell gets every time it starts, by flavour, such as -NoLogo for pwsh.

**Default:** none · **Values:** A table of flavour id → arguments

Shell arguments passed to a flavour every time it starts, for example `pwsh` → `-NoLogo`. Edited in a [list window](#lists-and-tables).

### Hidden built-in flavours

**Cog › Settings › Terminal**

`terminals.disabledBuiltins`

Built-in shells to leave out of the Flavour dropdown.

**Default:** none · **Values:** Any of the built-in flavours this machine has

Built-in flavours to leave out of the Flavour dropdown. Every built-in this machine has is listed, hidden ones ticked, so unticking one shows it again.

### Remember terminal form values

**Cog › Settings › Terminal**

`terminals.formHistory.enabled`

Offer Startup Command and Shell Arguments values used before, per terminal type.

**Default:** on · **Values:** on · off

The new-terminal form's Startup Command and Shell Arguments fields then suggest what you typed there before, kept separately for each terminal type. Off stops recording and offering them, and keeps what is already stored until cleared.

### Terminal form values remembered

**Cog › Settings › Terminal**

`terminals.formHistory.maxEntries`

How many past values each terminal form field remembers, per terminal type.

**Default:** 10 entries · **Values:** 1 – 50 entries, step 1

Used while **Remember terminal form values** is on. Each field keeps its newest values up to this many, for each terminal type, and drops the oldest past it. Lowering this trims every list to its newest entries.

### Show terminal status bar

**Cog › Settings › Terminal**

`terminals.showStatusBar`

Show the status bar along the bottom of each terminal panel.

**Default:** on · **Values:** on · off

The bar names the terminal's shell, shows where a link under the pointer leads, and holds the panel's
toggles: **Remember the last running command**, **Reopen in the last directory** and **Terminal
notifications**. Off hides it in every terminal, and the same toggles stay on the terminal's header
menu. Editors and previews have a bar of their own: **Show panel status bar**, under [Editor](#editor).

### Shell integration

**Cog › Settings › Terminal**

`terminals.shellIntegration`

Let PowerShell and Git Bash report their working directory, so throng follows your cd.

**Default:** on · **Values:** on · off

throng reads most shells' working directory from outside, but `cd` in PowerShell and Git Bash never moves the directory another program can see. For those two, throng adds a small prompt hook that reports the directory after each command, so the panel title's `{path}` and **Reopen in the last directory** know where you are. The PowerShell hook also moves the real working directory along, so a folder you have left can be deleted. Each hook runs your own prompt afterwards, so a themed prompt still draws. Off, those two shells are not tracked, and **Reopen in the last directory** is unavailable for them. Switch it off if it clashes with a custom prompt.

### Reload terminals when a project opens

**Cog › Settings › Terminal**

`terminals.reloadMode`

Whether a project's terminals start when it opens, or each waits for you to reload it.

**Default:** `automatic` · **Values:** `automatic` · `manual`

Automatic starts every terminal in every tab as a project opens. Manual starts none: each panel waits with a **Reload** action.

### Remember the last running command by default

**Cog › Settings › Terminal**

`terminals.defaultRememberCommand`

Tick “Remember the last running command” on new terminal panels.

**Default:** off · **Values:** on · off

Ticks **Remember the last running command** on new terminal panels: a command running when the terminal closes runs again when it next starts. A running Claude Code session is remembered as a resume of that session, not a fresh start. A panel keeps its own choice.

### Reopen in the last directory by default

**Cog › Settings › Terminal**

`terminals.defaultRememberDirectory`

Tick “Reopen in the last directory” on new terminal panels.

**Default:** on · **Values:** on · off

Ticks **Reopen in the last directory** on new terminal panels. A directory that has gone away falls back to the project root.

### Terminal notifications by default

**Cog › Settings › Terminal**

`terminals.defaultNotifications`

Tick “Terminal notifications” on new terminal panels.

**Default:** on · **Values:** on · off

Ticks **Terminal notifications** on new terminal panels, so a terminal can raise attention marks, pop-ups and desktop notifications. Off, every terminal that has not chosen for itself stays silent, terminals you already have included. A terminal's own toggle, on its status bar or in its menu, overrides this for that terminal.

### Run as administrator by default (Windows only)

**Cog › Settings › Terminal**

`terminals.defaultRunAsAdmin`

Tick “Run as administrator” on new terminal panels. The tick alone elevates nothing.

**Default:** off · **Values:** on · off

Ticks **Run as administrator** on new terminal panels. Whether a terminal can be elevated still depends on throng itself running elevated; this never elevates anything on its own.

### Command tracking interval

**Cog › Settings › Terminal**

`terminals.commandPollMs`

How often throng checks which command a busy terminal is running.

**Default:** 1 s (1,000 ms) · **Values:** 0.25 – 5 s, step 0.25 s

throng checks while a terminal has input or output, to name the command in the panel title, remember it for **Remember the last running command**, and notice when it finishes for the **Command finished** mark. A quiet terminal is checked ten times less often. Lower notices a new command sooner; higher does less work. A command you start and leave running for longer than one interval is always remembered.

### Tell programs that links are supported

**Cog › Settings › Terminal**

`terminals.advertiseHyperlinks`

Tell programs in new terminals that they can print clickable links.

**Default:** on · **Values:** on · off

Start terminal programs with `FORCE_HYPERLINK=1`, so tools that can print clickable links, Claude Code among them, do. Applies to terminals started afterwards; a terminal already running keeps the environment it started with. A `FORCE_HYPERLINK` the launching environment already carries is never overridden, in either direction, and throng never sets `WT_SESSION` or a borrowed `TERM_PROGRAM`. Off does not stop throng recognising paths printed as plain text.

### Terminal title template

**Cog › Settings › Terminal**

`terminals.titleTemplate`

The name of a terminal panel, built from placeholders such as {command}, {shell} and {path}.

**Default:** `({title} ? "{app}: {title} | " : {command} ? "{command} | " : ""){shell}({path} ? " ({path})" : "")` · **Values:** a [title template](#terminal-title-templates)

The name shows in the panel header and wherever throng names the panel, such as its notices and menus, in
every window that shows it. It updates as the command, directory or program title changes. Preferences refuses a template
it cannot read; one hand-edited into `settings.json` that throng cannot read is replaced by the default.
A template that renders to nothing names the panel after its shell. The placeholders and expressions are
under [Terminal title templates](#terminal-title-templates).

### Longest command in a terminal title

**Cog › Settings › Terminal**

`terminals.titleCommandMaxLength`

How many characters of the running command a terminal panel's name shows.

**Default:** 40 characters · **Values:** 10 – 200 characters, step 5 characters

`{command}` beyond this is shortened, with `…`.

### Longest directory in a terminal title

**Cog › Settings › Terminal**

`terminals.titlePathMaxLength`

How many characters of the working directory a terminal panel's name shows.

**Default:** 40 characters · **Values:** 10 – 200 characters, step 5 characters

`{path}` beyond this keeps its root and last folder and drops folders from the middle.

### Mark terminals that need you

**Cog › Settings › Terminal › Attention**

`terminals.attention.enabled`

Raise an attention mark on a terminal panel when something happens in it that you may want to see.

**Default:** on · **Values:** on · off

An [attention mark](#attention) flags the panel, its tab and its project, so you can leave a long job running and see when it wants you. The signals below choose what raises one. None of them marks the panel you are working in: while a terminal has keyboard focus in the focused window, its signals are ignored. A terminal whose own **Terminal notifications** toggle is off raises none either. Off, no terminal raises a mark and every existing terminal mark is withdrawn. The signals below are switched off with it.

### Program exited

**Cog › Settings › Terminal › Attention**

`terminals.attention.signals.processExited`

Mark a terminal for attention when its program ends without you ending it.

**Default:** on · **Values:** on · off

The terminal's program is the shell, or the command it was started with. When it ends on its own, such as a build started as the panel's command finishing or a shell crashing, the panel is marked: an exit code of zero raises the Attention mark, any other the Failed mark. An end you asked throng for, such as destroying the panel or unloading its project, raises nothing. throng hears of the exit the moment it happens, so this mark is never late.

### Command finished

**Cog › Settings › Terminal › Attention**

`terminals.attention.signals.commandFinished`

Mark a terminal for attention when the command running in it finishes.

**Default:** on · **Values:** on · off

A command is whatever you run at the shell's prompt, such as `npm test` or `git pull`. When it ends and the shell is back at its prompt, the panel takes the Attention mark; throng cannot see a command's exit code, so it never raises the Failed mark. throng finds out by checking which command the terminal is running every **Command tracking interval** (under [Terminal](#terminal)), and waits for a second check that still finds nothing, so the pause between two commands of a script does not count as a finish. The mark can therefore arrive up to two intervals after the command ends, and a command that starts and ends between two checks can be missed.

### Bell

**Cog › Settings › Terminal › Attention**

`terminals.attention.signals.bell`

Mark a terminal for attention when a program in it rings the bell.

**Default:** on · **Values:** on · off

The bell is a control character (BEL) a program prints to ask for your attention, the terminal's
equivalent of a beep. Some tools ring it when a long job ends, and you can ring it yourself at the end of a
command, as in `make; printf '\a'`. Each ring raises the Attention mark. The mark is never a guess: it
appears only when a program asked for it. A shell that beeps at a failed tab completion is the panel you are
typing in, so it marks nothing.

### Program notification

**Cog › Settings › Terminal › Attention**

`terminals.attention.signals.notification`

Mark a terminal for attention when a program in it sends a desktop notification.

**Default:** on · **Values:** on · off

Some programs ask the terminal to show a desktop notification, with escape sequences other terminals
support too (OSC 9, OSC 777 and OSC 99). throng turns each request into an Attention mark on the panel and
carries the program's message, up to 200 characters, into the notice that announces it. Whether that notice
reaches the OS is up to the [Notifications](#notifications) settings.

### Progress ended

**Cog › Settings › Terminal › Attention**

`terminals.attention.signals.progressEnded`

Mark a terminal for attention when a program in it reports its progress done or failed.

**Default:** on · **Values:** on · off

Some programs report a progress bar to the terminal (the OSC 9;4 sequence Windows Terminal reads), such as
package installers and long builds. When a program clears its progress, the panel takes the Attention
mark; when it reports an error, the Failed mark. A program that never reports progress raises neither.

### Unseen output

**Cog › Settings › Terminal › Attention**

`terminals.attention.signals.unseenOutput`

Mark a terminal for attention when it prints output while you are working elsewhere.

**Default:** off · **Values:** on · off

The mark comes from the first output after at least a second of silence, so a steady stream marks the panel
once rather than on every line, and a new shell printing its first prompt marks nothing. It is a guess:
throng cannot tell output you care about from a progress counter or a log line, which is why it ships
off.

### Output went quiet

**Cog › Settings › Terminal › Attention**

`terminals.attention.signals.outputQuiet`

Mark a terminal for attention when it prints and then stays silent for the quiet time below.

**Default:** off · **Values:** on · off

Meant for a program that prints while it works and then waits for you, such as a prompt asking a question. Once a terminal has printed, throng starts timing; when the output has stayed silent for **Quiet time**, the panel takes the Attention mark, unless you are working in it. It is a guess: throng cannot tell a program waiting for you from one working without printing, so a long silent step can mark a panel too.

### Quiet time

**Cog › Settings › Terminal › Attention**

`terminals.attention.quietMs`

How long a terminal must stay silent after activity before Output went quiet marks it.

**Default:** 10 s (10,000 ms) · **Values:** 10 – 600 s, step 10 s; 1,000 – 3,600,000 ms in the box

Used only while **Output went quiet** is on. Any new output restarts the count. A short time catches a
waiting prompt sooner but marks more programs that are only pausing; raise it if a slow build keeps
marking its panel mid-run.

### Terminal title templates

`{command}` the running command · `{app}` its program · `{arch}` its architecture · `{title}` the title the running
program set · `{shell}` the terminal type · `{path}` the working directory · `{folder}` its last folder ·
`{project}` the owning project · `{admin}` `Admin` when elevated. Each is empty when there is nothing to show.

- **Text shows as typed**, quotes included; `{name}` shows its value. `((` `))` `{{` `}}` show a bracket or brace.
- **An expression** is `( … )`, or a placeholder followed by an operator. It is C#: text is a `"string"` (placeholders
  work inside; `""` is a quote), and the operators are `c ? a : b`, `a ?? b`, `a || b`, `a && b` and `!a`, with C#'s
  precedence. A value is true when it is not empty; `||`, `&&` and `!` may only be a condition before `?`.
- The default, `({title} ? "{app}: {title} | " : {command} ? "{command} | " : ""){shell}({path} ? " ({path})" : "")`,
  reads `claude: work on links | Git Bash (D:\git\throng)` while a program that titled itself runs,
  `ping localhost -t | Git Bash (D:\git\throng)` while a command runs, and `Git Bash (D:\git\throng)` at a prompt.
- In text, `((` is a bracket, so an expression that opens on a bracket needs a space: `( ({title} ?? {app}) ? … )`.

## New Project

### New project folder starts at

**Cog › Settings › New Project**

`newProject.startingFolder`

Where the new-project folder picker opens: your user profile, the last folder, or an override.

**Default:** `lastViewed` · **Values:** `profile` · `lastViewed` · `override`

The picker opens when you add a project. `profile` starts in your home folder; `lastViewed` in the folder
you last chose for a project; `override` in **Override start folder** below. A folder that no longer
exists, or sits on a drive that is not connected, is passed over for the next choice: the last folder,
then your home folder.

### Override start folder

**Cog › Settings › New Project**

`newProject.overridePath`

The folder the new-project picker opens at when you choose Override.

**Default:** empty · **Values:** A folder path; may be empty

Type a path or browse to pick one. Used only while **New project folder starts at** is `override`. Empty, or a folder that has gone, falls back to the last folder, then your home folder.

## Search

### Find Bar

#### Find delay

**Cog › Settings › Search › Find Bar**

`search.asYouTypeDebounceMs`

How long find waits after you stop typing before it re-runs the search and updates the highlights.

**Default:** 125 ms · **Values:** 0 – 2,000 ms, step 25 ms; 0 – 10,000 ms in the box

The find bar opens in an editor, a terminal or a preview and searches as you type. Each keystroke restarts
the wait, so a large document is searched once per pause rather than once per key. Zero searches on
every key. Find in Files has its own delay, below.

### Find in Files

#### Find in Files results open in

**Cog › Settings › Search › Find in Files**

`search.inFiles.openTarget`

Whether a new search reuses the last Find in Files panel, or opens a fresh panel each time.

**Default:** `lastActive` · **Values:** `lastActive` (The last Find in Files panel) · `new` (A new panel)

Applies to a search you start from its key binding or a menu. `lastActive` runs it in the Find in Files
panel you used last in the current tab, replacing its results, and opens one when the tab has none; `new`
opens a panel for every search, so earlier results stay. A panel always searches its own project.

#### Find in Files searches

**Cog › Settings › Search › Find in Files**

`search.inFiles.trigger`

Whether a Find in Files search waits for Run, or starts on its own once you stop typing.

**Default:** `asYouType` · **Values:** `run` (When you press Run) · `asYouType` (As you type)

`asYouType` starts a search once you pause for **Find in Files delay**, and searches again as you change the term, its options or its folder. `run` searches only when you press **Run** or **Enter**, which suits a large project where each search takes a while.

#### Find in Files delay

**Cog › Settings › Search › Find in Files**

`search.inFiles.settleMs`

How long Find in Files waits after you stop typing before it searches, when searching as you type.

**Default:** 500 ms · **Values:** 0 – 2,000 ms, step 25 ms; 0 – 10,000 ms in the box

Used only while **Find in Files searches** is `asYouType`. Each keystroke restarts the wait, so a search of
a large project starts once you pause. Typing without a pause still searches once four times this delay
has passed.

#### Find in Files groups results by

**Cog › Settings › Search › Find in Files**

`search.inFiles.defaultGrouping`

How Find in Files panels arrange their rows. Every open panel follows it.

**Default:** `file` · **Values:** `file` (File) · `fileAndFolder` (Folder, then file) · `folderTree` (Folder structure: the File Explorer's tree)

`file` lists each file with its matches beneath; `fileAndFolder` gathers those files under their folders; `folderTree` nests them as File Explorer does. Choosing a grouping in a panel changes this setting, and every open panel follows it.

#### Show results

**Cog › Settings › Search › Find in Files**

`search.inFiles.showResults`

Whether Find in Files shows its result headings collapsed or expanded.

**Default:** `expanded` · **Values:** `collapsed` (Collapsed) · `expanded` (Expanded)

`expanded` shows every match under its file; `collapsed` shows only the file and folder headings, for you to open one at a time. The panel’s collapse toggle changes this setting too.

#### Excluded from search

**Cog › Settings › Search › Find in Files**

`search.inFiles.excludeGlobs`

Glob patterns Find in Files skips, separate from the File Explorer's excluded globs.

**Default:** the File Explorer's defaults, then `**/dist`, `**/build`, `**/out`, `**/coverage`, `**/.claude`, `**/.vscode`, `**/.idea`, `**/log`, `**/logs`, `**/*.log`, `**/.remember`, `**/.cache`, `**/.turbo`, `**/.next`, `**/.nuxt`, `**/target`, `**/bin`, `**/obj`, `**/.venv`, `**/__pycache__`, `**/*.min.js`, `**/*.map`, `**/package-lock.json`, `**/pnpm-lock.yaml`, `**/yarn.lock` · **Values:** A list of root-relative glob patterns; may be empty

What Find in Files skips. Separate from the File Explorer's excluded globs. A panel's exclusions toggle switches it off for that panel; a project's own *Hidden to Find & Replace* list always applies.

#### New panels use the exclusions

**Cog › Settings › Search › Find in Files**

`search.inFiles.useExcludeGlobs`

Start each new Find in Files panel with its exclusions toggle on.

**Default:** on · **Values:** on · off

With the toggle on, a panel skips everything in **Excluded from search** above. Each panel can switch it for itself, for example to search a build folder once, without changing this setting.

#### Ask before a replace that cannot be undone

**Cog › Settings › Search › Find in Files**

`search.inFiles.warnIrreversibleCommit`

Confirm before Find in Files writes replacements it cannot take back.

**Default:** on · **Values:** on · off

Whether Find in Files confirms before writing replacements it has no way to take back, such as into files that are not open in an editor.

#### Replace summary notices

**Cog › Settings › Search › Find in Files**

`search.inFiles.summaryNoticeMode`

Where throng reports a Find in Files replace: nowhere, as a toast, or in the panel.

**Default:** `panel` · **Values:** `never` (Never display) · `toast` (Toast only) · `panel` (Toast and keep in panel)

Whether the notice reporting what a replace changed is never shown, shown as a toast, or shown as a toast and kept in the [Notifications panel](#notifications). Choosing *Never display* asks you to confirm first. The toast leaves after the [toast duration](#notifications).

**The replace-summary mode governs that notice whether the replace succeeded, partly succeeded or
failed**, and the [Notifications](#notifications) settings play no part in it, so a
global preference that errors are kept in the panel does not reach it. The control sits beside the
thing it overrides it for. *Never display* is confirmed first because this notice is also how a
failed write reports itself; whatever the mode, the outcome is still written to the log.

## Notifications

Every notice appears as a toast in the corner of the window that raised it, with a close control, a
copy control and a link to what it is about. A notice's own controls, such as a paste's **Cancel** or
the backups notice's **Open folder**, sit beside Copy and Dismiss at the toast's top-right. **Every toast leaves after one toast duration** unless
the pointer is over it or keyboard focus is inside it; it leaves the full duration after both have
gone. Four toasts stay until you act on them: a paste in progress (its Cancel), a different copy of
throng, a newly installed version, and the warning that the Notifications panel is full.

Each notification type has three checkboxes, in any combination: **Toast**, **Panel** and *OS Notify*.
**Panel** keeps the notice in the **Notifications panel** at the bottom of the right pane until you
dismiss it there, with or without a toast; closing the toast does not remove it from the panel. With
neither **Toast** nor **Panel** ticked, the notice appears nowhere in throng. A notice kept from another
window (Preferences, the Resource Monitor, a sub-workspace) joins the main window's panel, which
flashes. The panel's entries survive a restart; each can be copied or dismissed, and the panel lists
them oldest first, newest first, or by priority (error, warning, attention, information, success)
either way. **Dismiss all** clears the panel but never an attention mark. A count beside the panel's
title, and below **File Explorer & Notifications** while the right pane is collapsed, shows how many entries are waiting,
in throng's highlight colour; only dismissing entries lowers it. The panel can be minimised like the
Projects panel. Every toast and entry names the project, tab and panel it is about, and clicking it goes
there.

*OS Notify* raises an OS notification whatever **Toast** and **Panel** say, while throng is
not focused; while it is, **Toast** and **Panel** decide. One switch above the rows stops anything
reaching the OS, and greys out every OS Notify while it is off, keeping their settings. For errors or
warnings, clearing the last of **Toast** and **Panel** asks you to confirm first, because it means a
failure reports nothing on screen. Whatever they say, the event is still written to the log. A row's
Reset and Revert act on all three of its settings.

The Attention row announces [attention marks](#attention), Attention and Failed alike; a Failed mark keeps
the error colour and icon. A mark is announced once: a later signal on a panel still marked updates its
toast, if one is showing, and raises nothing new. Under the rows, **Attention › Clear delay** sets how long you
must stay in a marked panel before its mark clears.

### Operating system notifications

**Cog › Settings › Notifications**

`notifications.os`

Let throng send OS notifications. Off sends none, whatever each type's OS Notify says.

**Default:** on · **Values:** on · off

The master switch for the **OS Notify** box of each notification type below. On, each type's box decides; off, nothing reaches the OS, and every OS Notify box is greyed out but keeps its setting for when you turn this back on. Notices inside throng are not affected.

### Toast duration

**Cog › Settings › Notifications**

`notifications.toastDurationMs`

How long a toast stays, paused while the pointer is over it or keyboard focus is inside it.

**Default:** 3 s (3,000 ms) · **Values:** 1 – 30 s, step 0.5 s

How long every toast stays on screen. A toast stays while the pointer is over it or keyboard focus is inside it, and leaves the full duration after both have gone. A notice kept in the Notifications panel stays there until you dismiss it.

### Toast width

**Cog › Settings › Notifications**

`notifications.toastWidthPx`

How wide every toast is, never more than half the window.

**Default:** 520 px · **Values:** 300 – 800 px, step 10 px

How wide every toast is. A toast is never wider than half the window, and shows at most three lines of text: a longer one is cut off with an ellipsis, and hovering it shows all of its text. The Notifications panel always shows a notification whole.

### Notification hover delay

**Cog › Settings › Notifications**

`notifications.hoverDelayMs`

How long the pointer must rest on a notification before it shows its whole text.

**Default:** 250 ms · **Values:** 0 – 1,500 ms, step 25 ms; 0 – 10,000 ms in the box

What it shows: a Notifications panel entry expands to its whole text, and a cut-off toast shows its whole text in a popover. Zero shows it as soon as the pointer arrives; a longer delay keeps the notifications still while you move the pointer across them. Keyboard focus never waits.

### Confirm before dismissing all notifications

**Cog › Settings › Notifications**

`notifications.confirmDismissAll`

Ask for confirmation before Dismiss all clears every notification in the Notifications panel.

**Default:** on · **Values:** on · off

**Dismiss all** empties the Notifications panel in one go, and a dismissed notice cannot be brought back, so throng asks first. Off, it clears at once. Attention marks stay either way: dismissing their notices does not clear the marks.

### Notifications panel limit

**Cog › Settings › Notifications**

`notifications.panelLimit`

The most notifications the panel keeps. Past it, throng drops the oldest and warns once.

**Default:** 100 notifications · **Values:** 20 – 500 notifications, step 10 notifications

The most entries the panel keeps. Past it, throng drops the oldest and warns you once, until you dismiss it, suggesting you turn notifications down, with a link to this section.

### Error: Toast

**Cog › Settings › Notifications**

`notifications.error.toast`

Show error notices as a toast. Turn off both Toast and Panel and they appear nowhere.

**Default:** on · **Values:** on · off

A toast appears in the corner of the window that raised the notice. It leaves after the toast duration, unless the pointer is over it or focus is inside it. With Panel ticked as well, the notice is also kept in the Notifications panel; with neither, it appears nowhere in throng. Turning errors off means a failed operation reports nothing on screen. Whatever these say, the event is still written to the log.

### Error: Panel

**Cog › Settings › Notifications**

`notifications.error.panel`

Keep error notices in the Notifications panel until you dismiss them, with or without a toast.

**Default:** on · **Values:** on · off

The Notifications panel sits at the bottom of the right pane. A kept error notice stays there after its toast has gone, survives a restart, and leaves only when you dismiss it there or choose **Dismiss all**. With neither Toast nor Panel ticked, error notices appear nowhere in throng. Clearing the last of Toast and Panel asks you to confirm first, because a failure would then show nothing on screen. Whatever these say, the event is still written to the log.

### Error: OS Notify

**Cog › Settings › Notifications**

`notifications.error.os`

Send error notices to the OS while throng is not focused, whatever Toast and Panel say.

**Default:** off · **Values:** on · off

Raise an OS notification for error notices, whatever Toast and Panel say, while throng is not focused. While it is focused, Toast and Panel decide. Unavailable while "Operating system notifications" is off, keeping its setting.

### Warning: Toast

**Cog › Settings › Notifications**

`notifications.warning.toast`

Show warning notices as a toast. Turn off both Toast and Panel and they appear nowhere.

**Default:** on · **Values:** on · off

A toast appears in the corner of the window that raised the notice. It leaves after the toast duration, unless the pointer is over it or focus is inside it. With Panel ticked as well, the notice is also kept in the Notifications panel; with neither, it appears nowhere in throng. Turning warnings off means a partly-failed operation reports nothing on screen. Whatever these say, the event is still written to the log.

### Warning: Panel

**Cog › Settings › Notifications**

`notifications.warning.panel`

Keep warning notices in the Notifications panel until you dismiss them, with or without a toast.

**Default:** on · **Values:** on · off

The Notifications panel sits at the bottom of the right pane. A kept warning notice stays there after its toast has gone, survives a restart, and leaves only when you dismiss it there or choose **Dismiss all**. With neither Toast nor Panel ticked, warning notices appear nowhere in throng. Clearing the last of Toast and Panel asks you to confirm first, because a partial failure would then show nothing on screen. Whatever these say, the event is still written to the log.

### Warning: OS Notify

**Cog › Settings › Notifications**

`notifications.warning.os`

Send warning notices to the OS while throng is not focused, whatever Toast and Panel say.

**Default:** off · **Values:** on · off

Raise an OS notification for warning notices, whatever Toast and Panel say, while throng is not focused. While it is focused, Toast and Panel decide. Unavailable while "Operating system notifications" is off, keeping its setting.

### Information: Toast

**Cog › Settings › Notifications**

`notifications.info.toast`

Show information notices as a toast. Turn off both Toast and Panel and they appear nowhere.

**Default:** on · **Values:** on · off

A toast appears in the corner of the window that raised the notice. It leaves after the toast duration, unless the pointer is over it or focus is inside it. With Panel ticked as well, the notice is also kept in the Notifications panel; with neither, it appears nowhere in throng. These are ordinary progress and status messages. Whatever these say, the event is still written to the log.

### Information: Panel

**Cog › Settings › Notifications**

`notifications.info.panel`

Keep information notices in the Notifications panel until you dismiss them, with or without a toast.

**Default:** on · **Values:** on · off

The Notifications panel sits at the bottom of the right pane. A kept information notice stays there after its toast has gone, survives a restart, and leaves only when you dismiss it there or choose **Dismiss all**. With neither Toast nor Panel ticked, information notices appear nowhere in throng. Whatever these say, the event is still written to the log.

### Information: OS Notify

**Cog › Settings › Notifications**

`notifications.info.os`

Send information notices to the OS while throng is not focused, whatever Toast and Panel say.

**Default:** off · **Values:** on · off

Raise an OS notification for information notices, whatever Toast and Panel say, while throng is not focused. While it is focused, Toast and Panel decide. Unavailable while "Operating system notifications" is off, keeping its setting.

### Success: Toast

**Cog › Settings › Notifications**

`notifications.success.toast`

Show success notices as a toast. Turn off both Toast and Panel and they appear nowhere.

**Default:** on · **Values:** on · off

A toast appears in the corner of the window that raised the notice. It leaves after the toast duration, unless the pointer is over it or focus is inside it. With Panel ticked as well, the notice is also kept in the Notifications panel; with neither, it appears nowhere in throng. These confirm an operation that worked, so they are the ones most worth switching off. Whatever these say, the event is still written to the log.

### Success: Panel

**Cog › Settings › Notifications**

`notifications.success.panel`

Keep success notices in the Notifications panel until you dismiss them, with or without a toast.

**Default:** on · **Values:** on · off

The Notifications panel sits at the bottom of the right pane. A kept success notice stays there after its toast has gone, survives a restart, and leaves only when you dismiss it there or choose **Dismiss all**. With neither Toast nor Panel ticked, success notices appear nowhere in throng. Whatever these say, the event is still written to the log.

### Success: OS Notify

**Cog › Settings › Notifications**

`notifications.success.os`

Send success notices to the OS while throng is not focused, whatever Toast and Panel say.

**Default:** off · **Values:** on · off

Raise an OS notification for success notices, whatever Toast and Panel say, while throng is not focused. While it is focused, Toast and Panel decide. Unavailable while "Operating system notifications" is off, keeping its setting.

### Attention: Toast

**Cog › Settings › Notifications**

`notifications.attention.toast`

Show attention notices as a toast. Turn off both Toast and Panel and they appear nowhere.

**Default:** on · **Values:** on · off

A toast appears in the corner of the window that raised the notice. It leaves after the toast duration, unless the pointer is over it or focus is inside it. With Panel ticked as well, the notice is also kept in the Notifications panel; with neither, it appears nowhere in throng. These announce a terminal that needs you, Attention and Failed marks alike. The mark itself is raised whatever you choose. Whatever these say, the event is still written to the log.

### Attention: Panel

**Cog › Settings › Notifications**

`notifications.attention.panel`

Keep attention notices in the Notifications panel until you dismiss them, with or without a toast.

**Default:** on · **Values:** on · off

The Notifications panel sits at the bottom of the right pane. A kept attention notice stays there after its toast has gone, survives a restart, and leaves only when you dismiss it there or choose **Dismiss all**. With neither Toast nor Panel ticked, attention notices appear nowhere in throng. The attention mark on the panel stays whatever this says; Dismiss all never clears one. Whatever these say, the event is still written to the log.

### Attention: OS Notify

**Cog › Settings › Notifications**

`notifications.attention.os`

Send attention notices to the OS while throng is not focused, whatever Toast and Panel say.

**Default:** on · **Values:** on · off

Raise an OS notification for a mark, whatever Toast and Panel say, while throng is not focused; clicking it goes to the panel.

### Attention: Clear delay

**Cog › Settings › Notifications › Attention**

`attention.clearDelayMs`

How long keyboard focus must stay in a marked panel before its mark clears.

**Default:** 1 s (1,000 ms) · **Values:** 0 – 10 s, step 0.5 s

How long you must stay in a marked panel, with keyboard focus inside it, before its mark clears. Switching to its tab or project without moving into the panel leaves the mark. 0 clears it as soon as you focus the panel.

## Logging

throng writes logs and crash reports to a `logs` folder under the user-data directory:
`%APPDATA%\throng\logs` when installed, `%APPDATA%\throng-dev\logs` for a dev run; `~/.local/share/throng/logs` on
Linux and `~/Library/Logs/throng` on macOS ([where the files live](#where-the-files-live)). A crash that
closes the window leaves evidence behind. The daemon and its terminal agent write beside the app.
Logs never leave the machine, and they are anonymised before they are written: paths, user and machine
names become short tokens (the same value gives the same token in every log), and a project is named
by its internal id, shown when you hover a project's path in the Projects panel. Every notice is
logged, with the number of entries pending in the Notifications panel at the time.

### Log detail

**Cog › Settings › Logging**

`diagnostics.logLevel`

How much throng records in its log files. Logs never leave this machine.

**Default:** `info` · **Values:** `fatal` · `error` · `warn` · `info` · `debug`

How much throng records. A crash of a process, window or panel is recorded at `fatal` whatever this is set to. Raise it to `debug` before reproducing a problem, then send the logs with your report. At `debug`, terminals also write `[renderer-terminal]` lines to `main.log`: what each view was handed when it attached, screen and mouse mode changes, wheel routing, selections, menu copies and redraws.

### Log file size

**Cog › Settings › Logging**

`diagnostics.maxFileBytes`

How large a single log file may grow before throng starts a new one.

**Default:** 1 MB (1,048,576 bytes) · **Values:** 0.25 – 4 MB, step 0.25 MB; 1,024 – 67,108,864 bytes in the box

A full file is renamed and kept, and logging carries on in a fresh one; nothing is deleted when a file rolls over. The older files then stay for the days set below, up to the folder limit.

### Days of logs kept

**Cog › Settings › Logging**

`diagnostics.keepDays`

How many days of logs to keep, counting days throng ran. throng deletes older logs.

**Default:** 3 days · **Values:** 1 – 30 days, step 1

Only days on which throng wrote a log count, so a fortnight away does not empty the folder: with the default,
you keep the logs of the last three days you used throng. **Log folder limit** still applies on top, so a
busy day at `debug` can push older days out sooner.

### Log folder limit

**Cog › Settings › Logging**

`diagnostics.maxTotalBytes`

The most space throng's logs may take. throng deletes the oldest first.

**Default:** 100 MB (104,857,600 bytes) · **Values:** 50 – 2,000 MB, step 50 MB; 1,048,576 – 68,719,476,736 bytes in the box

The most space all of throng's logs and crash reports may take. Past it, the oldest files are deleted first, and the log records that it did. A log still being written is never deleted.

## Resource Monitor

What the status bar's usage figures and the [Resource Monitor](../site/guide/resources.md#find-what-is-using-the-most)
measure, how often, and when a figure turns to the warning or critical colour. CPU is a share of the
whole machine; memory is a share of installed RAM.

### Capture interval

**Cog › Settings › Resource Monitor**

`resourceMonitor.captureIntervalMs`

How often throng measures its own CPU, memory, GPU and I/O.

**Default:** 2 s (2,000 ms) · **Values:** 2 – 60 s, step 1 s

Each capture feeds the status bar's usage figures and the Resource Monitor alike. A longer history needs a slower capture, so the monitor never keeps more than about 150 points for a process: the longer the history window, the slower the fastest capture it allows. A faster value than the history allows is raised, and Preferences says beside the field what it was raised to and why. Also changeable from the monitor's toolbar, which offers only the intervals the history allows.

### History window

**Cog › Settings › Resource Monitor**

`resourceMonitor.historyMs`

How much history the Resource Monitor keeps for each process while it is open.

**Default:** 5 min (300,000 ms) · **Values:** 1 – 30 min, step 1 min

The monitor's charts span this window, and collecting starts when you open the monitor, not before. A
longer window needs a slower **Capture interval**: up to 5 minutes allows every 2 seconds, up to 10
minutes every 5, up to 20 minutes every 15, and up to 30 minutes every 30. Choosing a longer window raises
the capture interval to match when it is faster than that.

### CPU warning

**Cog › Settings › Resource Monitor**

`resourceMonitor.cpuWarningPercent`

The share of the machine's CPU at which a figure turns the warning colour.

**Default:** 50% · **Values:** 1 – 100%, step 1%

The share of the whole machine's CPU at which a figure is shown in the warning colour. Kept below the critical level.

### CPU critical

**Cog › Settings › Resource Monitor**

`resourceMonitor.cpuCriticalPercent`

The share of the machine's CPU at which a figure turns the critical colour.

**Default:** 80% · **Values:** 1 – 100%, step 1%

Applies to the CPU figures on the status bar and in the Resource Monitor. A **CPU warning** at or above
this is treated as one below it, so the warning colour always comes first.

### Memory warning

**Cog › Settings › Resource Monitor**

`resourceMonitor.memoryWarningPercent`

The share of installed memory at which a figure turns the warning colour.

**Default:** 50% · **Values:** 1 – 100%, step 1%

Applies to the memory figures on the status bar and in the Resource Monitor, and is kept below **Memory critical**. A process using this much or more is never hidden as idle.

### Memory critical

**Cog › Settings › Resource Monitor**

`resourceMonitor.memoryCriticalPercent`

The share of installed memory at which a figure turns the critical colour.

**Default:** 80% · **Values:** 1 – 100%, step 1%

Applies to the memory figures on the status bar and in the Resource Monitor. A **Memory warning** at or
above this is treated as one below it, so the warning colour always comes first.

### Popup delay

**Cog › Settings › Resource Monitor**

`resourceMonitor.popoverDelayMs`

How long the pointer rests on the status bar usage figures before their popup opens.

**Default:** 500 ms · **Values:** 0 – 1,500 ms, step 25 ms; 0 – 10,000 ms in the box

The popup shows CPU, memory, GPU and I/O for each part of throng, with small graphs, whichever figures the bar has room for. At 0 it opens as soon as the pointer arrives; moving keyboard focus onto the figures opens it without waiting, and **Esc** closes it.

### Kill processes

**Cog › Settings › Resource Monitor**

`confirmations.killProcesses`

How many confirmations before the Resource Monitor force-ends a process or everything below it.

**Default:** `double` · **Values:** `none` · `single` · `double`

Confirmations (none, one or two) before the Resource Monitor force-ends a process (**Kill Process**) or everything running beneath a project, tab, panel or process (**Kill All Below**). The dialog names what will end.

## Settings with no control

`terminals.commandRecipes` (how a flavour receives a startup command, keyed by flavour id) takes effect
from a hand-edited `settings.json` but has no control in the Settings editor. `settings.json` also carries
bookkeeping throng writes for itself, a `version` marker and the last folder chosen for a new project,
which is not a preference.

## Themes and icon sets

Every colour, font and size a theme carries is described in the [theme settings reference](theme-settings.md).

## Where the files live

Every setting, binding and theme is a human-editable file that **hot-reloads** when you save it by
hand, and the preferences window writes those same files.

| What | Installed | Dev run (`npm start`) |
|---|---|---|
| Settings | `%USERPROFILE%\.throng\settings.json` | `%USERPROFILE%\.throng-dev\settings.json` |
| Key bindings | `%USERPROFILE%\.throng\keybindings.json` | `%USERPROFILE%\.throng-dev\keybindings.json` |
| Themes | `%USERPROFILE%\.throng\themes\<name>.json` | `%USERPROFILE%\.throng-dev\themes\<name>.json` |
| Icon sets | `%USERPROFILE%\.throng\icon-packs\<set>\` | `%USERPROFILE%\.throng-dev\icon-packs\<set>\` |
| Applied-defaults marker | `%USERPROFILE%\.throng\defaults-state.json` | `%USERPROFILE%\.throng-dev\defaults-state.json` |
| Font cache, shipped default-theme source | `%APPDATA%\throng\` | `%APPDATA%\throng-dev\` |

That table is Windows. On Linux and macOS the same files sit in these folders, with `throng-dev` in place of
`throng` for a dev run:

| What | Linux | macOS |
|---|---|---|
| Settings, key bindings, themes, icon sets, applied-defaults marker | `~/.config/throng/` (or `$XDG_CONFIG_HOME/throng/`) | `~/Library/Application Support/throng/settings/` |
| Database, font cache, shipped default-theme source | `~/.local/share/throng/` (or `$XDG_DATA_HOME/throng/`) | `~/Library/Application Support/throng/` |
| Logs | `~/.local/share/throng/logs/` | `~/Library/Logs/throng/` |

The config folder can be moved with [`THRONG_CONFIG_ROOT`](environment.md#running-the-app).

**Shipped defaults.** throng carries an immutable, versioned record of its default settings, key
bindings and built-in themes, generated from its own definitions. Every reset reads from it. A first
run seeds the config folder from it without overwriting any file already there, and
`defaults-state.json` records which version of the defaults has been applied.
