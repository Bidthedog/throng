[throng](../README.md) › [Docs](README.md) › Preferences

# Preferences

Every setting throng has, in the groups the **Settings** editor shows them in, with its key in
`settings.json`, its shipped default, what it accepts and what it does. Key bindings have a page of
their own — [Key bindings](key-bindings.md) — and themes, icon sets and the config files are at the
end of this one.

## The preferences window

Click the **cog** in the title bar and choose **Settings**, **Key Bindings** or **Themes**. All three
are tabs of one window that floats above throng and minimises with it; it stays on top but **does not
block the app**, so you can keep working while you edit a theme and watch each change land.

- **The visual editors apply immediately** — there is no Save button and no restart. Toggles and
  dropdowns apply at once; typed values apply a moment after you stop typing.
- **Settings** has typeahead search that matches any word against a setting's name, description or
  current value, and each section's name.
- **The JSON view** (the **UI ⇄ JSON** toggle in the toolbar) edits the same files in throng's own
  editor. **Your document is applied when you leave it** — switching back to the visual editor,
  switching tab, or closing the window — rather than as you type, because a half-typed number is
  often still valid JSON and applying it would correct and rewrite the value you were halfway through
  entering. While the document is invalid you cannot leave it: one notice names each offending value
  with its allowed options or range, and **Discard changes and close** abandons the edit, leaving the
  last valid document in effect.
- **Every number is a slider, its value, and a box.** The slider moves in steps suited to its range and
  shows the value in the unit that reads best: sizes in MB (1 MB is 1,048,576 bytes), durations in ms,
  seconds or minutes. The box beside it holds the exact value as it is stored — bytes for a size,
  milliseconds for a duration — and takes any whole number within the setting's limits, which can go
  beyond the slider's ends. A value that is not one of the slider's steps greys the slider; it still
  moves, and moving it sets that step. The box names a limit as you type past it, and **Enter** or
  leaving the box stores that limit; text that is no number stays, saying so, until you correct it or
  press **Esc**, which puts the stored value back. In the tables below, *Range* gives the slider's ends and
  step in the shown unit, then the box's limits in the stored unit where they reach further.

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
- **Your choices are remembered** per tab, across closing the window and restarting throng — a section
  you opened stays open, and a subsection you folded stays folded. They are not a setting, so they do
  not appear in `settings.json`.

### Resetting

Four scopes, all reading the same shipped-defaults record:

| Control | Scope |
|---|---|
| The reset icon on a row | That one setting or binding. It appears **only while the item differs from its shipped value**, so it doubles as the "modified" cue. |
| Reset the *tab* | The whole Settings or Key Bindings editor. |
| **Reset All Preferences** | Settings, key bindings and built-in themes, atomically. **Your projects, layout, workspace state and custom themes are untouched** — the confirmation says so. |
| **Revert All Preferences** | A session undo — back to how the window looked when you opened it. Not a reset to defaults. |

### Values out of range, and files that will not parse

**A hand-edited value that is out of range is brought back inside it, and the file is updated to say
so.** Each setting's limits are the ones its box accepts (the slider's range unless the table below
gives wider ones), so a pane width of `99999` loads as the maximum, and `settings.json` is rewritten
to the corrected value. This happens whenever the file is read, including a hot-reload. A
file already within its limits is **never** rewritten.

**A file that cannot be parsed is left alone.** throng re-reads it a few times in case it caught you
mid-save; if it still will not parse, throng runs on the shipped defaults, says so in the diagnostics
log, and leaves your file exactly as it is for you to repair. A key throng does not recognise is kept
when it writes the file; a retired key it once used is dropped.

## General

The window, the app-wide behaviour and the attention marks, each under a heading of its own.

### Appearance


| Setting | Key | Default | Values | What it does |
|---|---|---|---|---|
| Theme | `appearance.theme` | `throng` | Any theme on disk | The active theme, applied across the whole app. See [Themes and icon sets](#themes-and-icon-sets). |

### Window

Each project remembers for itself which side panes are expanded.

| Setting | Key | Default | Values | What it does |
|---|---|---|---|---|
| Use native Wayland (Linux only) | `window.nativeWayland` | `false` | on · off | Run the window directly on Wayland instead of through XWayland. XWayland suits dragging a tab out, placing windows, and keeping Preferences and About above the main window; dragging files out to GNOME Files needs native Wayland ([Linux](linux.md#display)). Takes effect at the next start. |
| Projects pane max width | `panes.projects.maxWidth` | 400 px | 200 – 1,200 px, step 10 px | The widest the Projects pane can be dragged. |
| File Explorer pane max width | `panes.fileExplorer.maxWidth` | 700 px | 200 – 1,200 px, step 10 px | The widest the File Explorer pane can be dragged. |

### Projects


| Setting | Key | Default | Values | What it does |
|---|---|---|---|---|
| Folder opened from outside throng | `projects.openFromOutside` | `switch` | `switch` · `load` | What happens when a folder arrives from the file manager or the command line: switch to its project, or only load it. |

### Behaviour


| Setting | Key | Default | Values | What it does |
|---|---|---|---|---|
| Submenu hover delay | `behaviour.submenuHoverMs` | 100 ms | 0 – 1,500 ms, step 25 ms; 0 – 10,000 ms in the box | How long the pointer rests on a context-menu item before its submenu opens. |

### Attention


An attention mark flags a panel that needs you; this setting decides whether the taskbar counts it,
whatever raised it. How a mark is announced, and how it clears, are under [Notifications](#notifications);
which terminal events raise one is under [Terminal](#terminal).

| Setting | Key | Default | Values | What it does |
|---|---|---|---|---|
| Taskbar badge (Windows only) | `attention.taskbarBadge` | on | on · off | Show the number of marked panels, across every project, on throng's taskbar button, whether or not throng is focused. It is not affected by the notification settings. |

### File Manager

The **Open as throng project** control, under General › **File Manager**, which folds like every other heading, turns the file manager's menu item on or off for your account. It shows what is
really registered, so it has no entry in `settings.json`. It is disabled, with the reason, for an install made for everyone
on Windows and for a portable or archive copy.

## Confirmations

`none`, `single` or `double` is how many confirmations an action asks for before it happens.

| Setting | Key | Default | Values | What it does |
|---|---|---|---|---|
| Remove a project | `confirmations.destroyProject` | `double` | `none` · `single` · `double` | Confirmations before a project is removed. It is unregistered; no files are deleted. |
| Unload project: default terminal action | `projects.unloadTerminalAction` | `keepRunning` | `keepRunning` (Keep terminals running) · `endTerminals` (End terminals) | What the project menu's **Unload Project** row does to the project's terminals; the menu's second Unload row does the other — **Unload Project and End Terminals** under the shipped setting, **Unload Project and Keep Terminals Running** otherwise. Keep leaves every terminal alive, idle shells included, and reattaches each when the project is next loaded; End ends every terminal, running processes included; one that cannot be ended stays running, says so once, and reattaches when the project is next loaded. Neither row asks anything; the only prompt Unload can show is the usual one for unsaved editors. |
| Destroy a tab | `confirmations.destroyTab` | `double` | `none` · `single` · `double` | Confirmations before a tab and its panels are destroyed. |
| Destroy a panel | `confirmations.destroyPanel` | `double` | `none` · `single` · `double` | Confirmations before a panel is destroyed. |
| Destroy a sub-workspace | `confirmations.destroySubWorkspace` | `double` | `none` · `single` · `double` | Confirmations before a sub-workspace is destroyed. |

## Tabs

| Setting | Key | Default | Values | What it does |
|---|---|---|---|---|
| Tab scroll animation | `tabs.smoothScrollMs` | 300 ms | 0 – 1,500 ms, step 50 ms | How long the tab strip takes to ease to a new position. Zero scrolls instantly — as does the system "reduce motion" setting, which overrides this without changing it. |
| Tab close-button delay | `tabs.closeArmingDelayMs` | 300 ms | 0 – 1,500 ms, step 50 ms | How long the pointer must rest on a tab before its close button will act, so a click cannot land on a tab the pointer was only passing over. |
| Longest tab and panel name | `tabs.maxNameLength` | 64 characters | 10 – 128 characters, step 2 characters | The most characters a tab or panel name may use. Longer names are shortened for display, with the full name on hover. |
| Widest tab | `tabs.maxWidth` | 32 characters | 10 – 128 characters, step 2 characters | The widest a tab is drawn. A longer title is ellipsised in the strip and shown in full on hover; the name itself is not shortened. |
| New tabs open | `tabs.newTabPosition` | `afterActive` | `afterActive` · `end` | Where a tab created with **+** goes: right of the active tab, or at the end of the strip. |
| Chevron repeat delay | `tabs.chevronRepeatDelayMs` | 350 ms | 100 – 1,500 ms, step 50 ms; 100 – 10,000 ms in the box | How long a press-and-hold on a scroll chevron waits before the strip scrolls continuously. |
| Tab popover delay | `tabs.popoverDelayMs` | 500 ms | 0 – 1,500 ms, step 25 ms | How long the pointer must rest on a tab before its information popover appears. |
| Tab hover-activate delay | `behaviour.tabHoverActivateMs` | 600 ms | 0 – 1,500 ms, step 25 ms; 0 – 10,000 ms in the box | While **dragging** a panel or tab, how long it must dwell over another tab before that tab comes to the front so you can drop inside it. An ordinary mouse-over does nothing. |

## File Explorer

| Setting | Key | Default | Values | What it does |
|---|---|---|---|---|
| Show Open in OS Default Program | `explorer.showOpenInOsDefaultProgram` | on | on · off | Offer Open in OS Default Program on the File Explorer menu and on the panel title menu. |
| File Explorer popover delay | `explorer.popoverDelayMs` | 500 ms | 0 – 1,500 ms, step 25 ms | How long the pointer must rest on a file or folder before a popover shows its icon, larger, beside its path. |
| Open files with | `editor.openOnClick` | `single` | `single` · `double` · `none` | Which file-tree click opens a file into the last active editor. |
| Open files in | `editor.openTarget` | `lastActive` | `lastActive` · `new` | Where an opened file lands: the last active editor, reused, or a new editor panel. A preview's **Open in Editor** follows it too. |
| Delete files to | `explorer.deleteMode` | `recycle` | `recycle` · `permanent` | Send deleted files to the Recycle Bin, or delete them permanently. |
| When Paste replaces an item | `explorer.replaceMode` | `recycle` | `recycle` · `permanent` | What happens to an item a paste or drag replaces after you choose **Replace**: the Recycle Bin, so undo can bring it back, or deleted for good. Independent of the delete setting. |
| Excluded globs | `explorer.excludeGlobs` | `**/.git`, `**/.svn`, `**/.hg`, `**/CVS`, `**/.DS_Store`, `**/Thumbs.db`, `**/node_modules` | A list of root-relative glob patterns; may be empty | Entries hidden from the file tree (and, by default, from Quick Open). An empty list hides nothing. Find in Files does not use it — see *Excluded from search*. |
| Sort names | `explorer.sortOrder` | `natural` | `natural` · `characters` | How names are ordered within folders and within files. `natural` compares numbers by their value (`file 2` before `file 10`); `characters` compares character by character (`file 10` before `file 2`). Folders always come first. Takes effect straight away. |
| Follow the active editor | `explorer.autoRevealActiveFile` | on | on · off | Select the active editor's file in File Explorer, expanding its folders. |
| Copy-drag modifier | `explorer.dragCopyModifier` | `ctrl` | `ctrl` · `shift` · `alt` | The key that makes a file-tree drag copy instead of move. |
| Open unsupported files in the OS | `explorer.openUnsupportedInOs` | on | on · off | Double-clicking a file throng cannot open, or Ctrl+clicking a link to one, opens it in your OS default program. Off, throng says it cannot open the file. |
| Move-drag modifier | `explorer.dragMoveModifier` | `shift` | `ctrl` · `shift` · `alt` | The key that forces a file-tree drag to move. |

## Editor

| Setting | Key | Default | Values | What it does |
|---|---|---|---|---|
| Auto-save | `editor.autoSave` | off | on · off | Write edits automatically once typing settles, without `Ctrl+S`. |
| Save Document Scroll Position | `editor.saveDocumentScroll` | off | on · off | Reopening a file in the same editor restores where you were, instead of starting at the top. |
| Auto-save delay | `editor.autoSaveDebounceMs` | 0.3 s (300 ms) | 0 – 10 s, step 0.1 s | How long after typing stops an auto-save writes. |
| Save-All scope | `editor.saveAllScope` | `project` | `tab` · `project` · `all` | What a `Ctrl+Shift+S` Save All covers. |
| New-file line ending | `editor.defaultLineEnding` | `lf` | `lf` · `crlf` · `cr` | The line ending for brand-new documents. An existing file keeps its own. |
| Fallback encoding | `editor.fallbackEncoding` | `windows1252` | `windows1250` … `windows1258` | The code page a file is read in when it has no BOM and is not valid UTF-8 or UTF-16 (what other editors call ANSI). Set it to your own code page and legacy files in it open without a notice. |
| Max open file size | `editor.maxOpenFileBytes` | 10 MB (10,485,760 bytes) | 5 – 250 MB, step 5 MB; 1,024 – 2,147,483,648 bytes in the box | Files larger than this report "too large" instead of opening. |
| Project editor path display | `editor.projectPathDisplay` | `full` | `full` · `name` | Show a project-owned editor's pill as the full path or just the file name. |
| Sub-workspace editor path display | `editor.subWorkspacePathDisplay` | `full` | `full` · `name` | The same, for an editor owned by a sub-workspace. |
| Warn on missing file | `editor.warnOnMissingFile` | on | on · off | Report an editor whose file is missing or deleted. |
| Editor default word wrap | `editor.defaultWordWrap` | on | on · off | Wrap long lines by default in new editors. Each editor toggles its own from its status bar, its content menu or [`Ctrl+E,W`](key-bindings.md#editor). |
| Editor default view whitespace | `editor.defaultShowWhitespace` | off | on · off | Show a symbol for every space, tab, line break and invisible character by default in new editors. Each editor keeps its own toggle, from its status bar, its content menu or [View Whitespace](key-bindings.md#editor). |
| Editor whitespace hover names | `editor.whitespaceHoverNames` | on | on · off | With View Whitespace on, resting the pointer on a marker for half a second names its character in a popover above the pointer, and the pointer becomes the help cursor. Off, neither. |
| Show the editor gutter | `editor.showGutter` | on | on · off | The strip of line numbers down each editor's left side. Hiding it gives that width back to the document. |
| Highlight other occurrences of the selection | `editor.highlightOccurrences` | on | on · off | Softly tints every other instance of the text selected in an editor or Markdown preview. A whole-word selection tints whole words only; matching is case-sensitive. |
| Keep undo history after a crash | `editor.persistUndoHistory` | on | on · off | Restore the undo history along with unsaved changes when throng reopens after a crash. Removed text lives in the recovery file until then. |

### Status Bar

| Setting | Key | Default | Values | What it does |
|---|---|---|---|---|
| Show panel status bar | `editor.showStatusBar` | on | on · off | The bar along the bottom of editor and preview panels. Off hides all of it, whatever the two settings below say. Terminals have their own: [Show terminal status bar](#terminal). |
| Show cursor position | `editor.statusBar.showCursorPosition` | on | on · off | The caret's line and column, or the source lines a preview selection spans. |
| Show character and word counts | `editor.statusBar.showCounts` | on | on · off | The document's lines, characters and words, and how many characters are selected. |

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
Preview**, **Mermaid Preview**, the **CSV Preview Editor** — the one preview that edits, an editable grid
over the file — the read-only **Spreadsheet Preview** for workbooks, and **Image Preview**, **SVG Preview**,
**PDF Preview** and **HTML Preview**. Each has its own subsection below with an **Enabled** switch, an
**Open <files> in** choice and an **Open previews in** choice, plus any settings of its own.
**Open <files> in** picks what opening one of its files from File Explorer, Quick Open or a link does:
**Throng Editor** (`editor`), **Throng Preview** (`preview`) or **Default OS Program** (`os`), which hands
the file to the program your operating system opens it with and opens no panel. A Find in Files result set
to Default OS Program opens an editor at the match, and **Open In**'s targets always do what they name.
Turning a type off closes its open previews and greys its other settings rather than hiding them.
The settings in this table apply to every preview type.

| Setting | Key | Default | Values | What it does |
|---|---|---|---|---|
| Preview update delay | `editor.previews.updateDelayMs` | 300 ms | 0 – 2,000 ms, step 25 ms; 0 – 10,000 ms in the box | How long a preview beside an editor waits after you stop typing before it shows your changes. Zero updates on every change. |
| Preview maximum wait | `editor.previews.maxWaitMs` | 1 s (1,000 ms) | 0 – 10 s, step 0.1 s | The longest a preview goes without catching up while you keep typing. A value below the update delay behaves as the update delay. |
| Preview copy format | `editor.previews.copyFormat` | `rich` | `rich` (Rich text) · `plain` (Plain text) | What Copy from a preview puts on the clipboard: formatted text that keeps headings, lists and links, or plain text. |
| Synchronise preview and editor scrolling | `editor.previews.syncScroll` | on | on · off | Keep a preview and its editor at the same place, both ways: scrolling either scrolls the other, block by block. Also switched from either panel's right-click menu, the **Synchronise Scrolling** status-bar button, or the [`preview.toggleSyncScroll`](key-bindings.md#editor) command. |
| Scroll-sync highlight duration | `editor.previews.syncHighlightMs` | 1.5 s (1,500 ms) | 0 – 10 s, step 0.5 s; 0 – 60,000 ms in the box | How long the soft highlight stays on the place a preview and its editor are in step at after Synchronise Scrolling moves one with the other, in both views, before it fades out. `0` shows no highlight at all. A visual guide only: scrolling is kept in step either way. |

#### Markdown

| Setting | Key | Default | Values | What it does |
|---|---|---|---|---|
| Markdown: Enabled | `editor.previews.providers.markdown.enabled` | on | on · off | Offer previews of `.md` and `.markdown` files. Off, every such preview closes and the preview commands are shown disabled. |
| Open Markdown files in | `editor.previews.providers.markdown.defaultOpenAction` | `editor` | `editor` (Throng Editor) · `preview` (Throng Preview) · `os` (Default OS Program) | What opening a Markdown file from File Explorer, Quick Open, a link or a Find in Files result does. **Open In**'s targets always do what they name. |
| Markdown: Open previews in | `editor.previews.providers.markdown.openTarget` | `lastActive` | `lastActive` (Last Active) · `new` (New Preview Panel) | Last Active reuses the most recently used Markdown preview in the tab you are looking at — from an editor's preview button too — adding to its Back history; otherwise a new preview opens. New opens every preview in a panel of its own. **Open In → Last Preview Panel / New Preview Panel**, in the File Explorer and on Find in Files results, choose explicitly. A value saved under the former single `editor.previews.openTarget` key is carried over to each preview type. |
| Markdown: Render Mermaid diagrams | `editor.previews.providers.markdown.renderMermaid` | on | on · off | Draw a `mermaid` code block in a Markdown preview as its diagram. Off, the block shows as code. |
| Markdown: Typeset math | `editor.previews.providers.markdown.typesetMath` | on | on · off | Draw TeX maths — `$…$`, `$$…$$` and `math` code blocks — as typeset equations. Off, each expression shows as the text it was written in. |
| Markdown: Load remote images | `editor.previews.providers.markdown.loadRemoteImages` | on | on · off | Show images a document links from the web over HTTPS, such as build badges. Off, each shows its alternative text and nothing is requested. |
| Markdown: Show front matter | `editor.previews.providers.markdown.showFrontMatter` | on | on · off | Show the metadata block at the top of a document as a table. Off, the block is not shown at all. |
| Markdown: Preview gutter | `editor.previews.providers.markdown.gutter` | on | on · off | A narrow strip down a Markdown preview's left edge holding a fold arrow beside each heading; the document moves right to make room. Off, the strip and its arrows are gone and folding stays available from the menus and bindings. |
| Markdown: Heading jump scroll duration (ms) | `editor.previews.providers.markdown.headingJumpMs` | 200 ms | 0 – 1,500 ms, step 50 ms; 0 – 5,000 ms in the box | How long a jump from [Go to Heading](key-bindings.md#navigate) takes to scroll there. Zero jumps instantly. |
| Markdown sections open | `editor.markdownSectionsOpen` | `expanded` | `expanded` · `collapsed` | Whether a Markdown document opens with its heading sections expanded or collapsed, in the editor and its preview alike. Sections are then folded from the gutter, the right-click menu or the [Markdown bindings](key-bindings.md#markdown). |

#### Mermaid

| Setting | Key | Default | Values | What it does |
|---|---|---|---|---|
| Mermaid: Preview .mmd files | `editor.previews.providers.mermaid.enabled` | on | on · off | Offer previews of standalone `.mmd` and `.mermaid` files, drawn as their diagram. Off, every such preview closes. Diagrams inside a Markdown preview are not affected — **Markdown: Render Mermaid diagrams** controls those. |
| Open Mermaid files in | `editor.previews.providers.mermaid.defaultOpenAction` | `preview` | `editor` (Throng Editor) · `preview` (Throng Preview) · `os` (Default OS Program) | As **Open Markdown files in**, for Mermaid files. Ships as `preview`, so a diagram file opens as its diagram. |
| Mermaid: Open previews in | `editor.previews.providers.mermaid.openTarget` | `lastActive` | `lastActive` (Last Active) · `new` (New Preview Panel) | As **Markdown: Open previews in**, for Mermaid previews; a Markdown preview is never reused for a Mermaid file, or the reverse. |

#### CSV

The CSV Preview Editor shows a `.csv` as a grid you edit like a document: the same unsaved marker,
Save, Undo, Redo, **Editor: Auto save** and close-with-unsaved-changes prompt as the text editor, on the
one document both share. A save changes only the fields you edited; every other byte of the file is kept.

| Setting | Key | Default | Values | What it does |
|---|---|---|---|---|
| CSV: Enabled | `editor.previews.providers.csv.enabled` | on | on · off | Offer the CSV Preview Editor for `.csv` files. Off, every CSV Preview Editor closes (asking first about unsaved changes) and its preview commands are shown disabled; a CSV still opens in the text editor. |
| Open CSVs in | `editor.previews.providers.csv.defaultOpenAction` | `preview` | `editor` (Throng Editor) · `preview` (Throng Preview Editor) · `os` (Default OS Program) | As **Open Markdown files in**, for CSVs. Ships as `preview`, so a CSV opens in the CSV Preview Editor. |
| CSV: Open previews in | `editor.previews.providers.csv.openTarget` | `lastActive` | `lastActive` (Last Active) · `new` (New Preview Panel) | As **Markdown: Open previews in**, for CSV Preview Editors. |
| CSV: Edit long cells in a dialog | `editor.previews.providers.csv.editLongCellsInDialog` | on | on · off | Double-click, **F2** and **Enter** on a cell longer than **Long cell threshold** open a dialog holding an editor, in place of the in-cell editor; typing a character still edits in place. Every cell's menu offers **Edit in Dialog…**. A value that is a JSON object or array opens pretty-printed and highlighted; saving turns each line break (with the indentation after it, for JSON) into one space. Off, there is no dialog at all. Each CSV Preview Editor can switch it on or off for itself from the toggle at the right of its status bar, or its **Edit Long Cells in Dialog** menu item; a panel that has not follows this setting. |
| CSV: Long cell threshold | `editor.previews.providers.csv.longCellThreshold` | 50 characters | 10 – 1,000 characters, step 10 characters; 1 – 100,000 characters in the box | A cell with more characters than this opens in the dialog on double-click, **F2** or **Enter**. |
| CSV: Edit multi-line cells in a dialog | `editor.previews.providers.csv.multiLineCellsInDialog` | on | on · off | A cell holding a line break opens in the cell dialog on double-click, **F2** or **Enter**, however short. Off, it opens there only when it is longer than **Long cell threshold**. |
| CSV: Wrap cells | `editor.previews.providers.csv.wrapCells` | off | on · off | Show every cell in full: line breaks kept, each value wrapped to its column, and every row as tall as its tallest cell, with no line cap. Off, a cell is one truncated line. Each CSV Preview Editor can switch wrapping on or off for itself from the **Wrap** toggle on its status bar, or its **Wrap** menu item; a panel that has not follows this setting. Wrapping changes only how the grid draws and never edits the file. |
| CSV: Lock first row | `editor.previews.providers.csv.lockFirstRow` | off | on · off | Keep the first row directly under the column letters however far the table is scrolled down, set apart by a line. It is still an ordinary row: select it, edit it, use its menu. Each CSV Preview Editor can switch it on or off for itself from the **Lock first row** toggle on its status bar, or its **Lock First Row** menu item; a panel that has not follows this setting. Locking changes only how the grid draws and never edits the file. |
| CSV: Lock first column | `editor.previews.providers.csv.lockFirstColumn` | off | on · off | Keep the first column beside the row numbers however far the table is scrolled across, set apart by a line. Each CSV Preview Editor can switch it on or off for itself from the **Lock first column** toggle on its status bar, or its **Lock First Column** menu item; a panel that has not follows this setting. |

#### Spreadsheet

A read-only preview of a workbook — `.xlsx`, `.xlsm`, `.xlsb`, `.xls`, `.ods`, `.fods` and `.numbers` —
with a sheet switcher and each sheet as a grid. Formula cells show the value stored in the file; nothing is
recalculated and no macro runs. Neither Office nor LibreOffice is needed.

| Setting | Key | Default | Values | What it does |
|---|---|---|---|---|
| Spreadsheet: Enabled | `editor.previews.providers.spreadsheet.enabled` | on | on · off | Offer previews of workbooks. Off, every spreadsheet preview closes and their preview commands are shown disabled. |
| Open spreadsheets in | `editor.previews.providers.spreadsheet.defaultOpenAction` | `preview` | `preview` (Throng Preview) · `os` (Default OS Program) | As **Open Markdown files in**, for workbooks. There is no editor option: a workbook is not text. |
| Spreadsheet: Open previews in | `editor.previews.providers.spreadsheet.openTarget` | `lastActive` | `lastActive` (Last Active) · `new` (New Preview Panel) | As **Markdown: Open previews in**, for spreadsheet previews. |
| Spreadsheet: First row is a header | `editor.previews.providers.spreadsheet.firstRowHeader` | off | on · off | Show each sheet's first row in the column header strip instead of the column letters, with the data starting at the second row. |
| Spreadsheet: Preview size limit | `editor.previews.providers.spreadsheet.maxPreviewBytes` | 25 MB (26,214,400 bytes) | 5 – 500 MB, step 5 MB; 1,024 – 2,147,483,648 bytes in the box | The largest workbook a spreadsheet preview loads. A larger one shows a notice naming its size and this limit; raise the limit and choose **Refresh** to load it. |
#### Image

An image opens in the centre of its panel, on a canvas filling the panel, with its transparent parts
hatched so its edges show (the colours are the theme's [Picture Preview Background and Picture
Transparency Marker](#themes-and-icon-sets)). It carries the view controls a Mermaid diagram has, top
left: Fit, Zoom In, Zoom 100%, Zoom Out, middle-button drag, Ctrl+wheel to zoom about the pointer, and
**Copy Image** on the right-click menu. It opens at 100%, or fitted when it is larger than the panel; Fit fills
the panel, enlarging a small image. An image larger
than the panel, or zoomed in past it, scrolls both ways; a middle-button drag scrolls it, or moves the
image itself across a panel it does not fill.

| Setting | Key | Default | Values | What it does |
|---|---|---|---|---|
| Image: Enabled | `editor.previews.providers.image.enabled` | on | on · off | Offer previews of `.png`, `.apng`, `.jpg`, `.jpeg`, `.jfif`, `.pjpeg`, `.pjp`, `.gif`, `.webp`, `.avif`, `.bmp`, `.dib`, `.ico` and `.cur` files. Off, every such preview closes and the preview commands are shown disabled. |
| Open images in | `editor.previews.providers.image.defaultOpenAction` | `preview` | `preview` (Throng Preview) · `os` (Default OS Program) | What opening one of these files from File Explorer, Quick Open or a link does. |
| Image: Open previews in | `editor.previews.providers.image.openTarget` | `lastActive` | `lastActive` (Last Active) · `new` (New Preview Panel) | As **Markdown: Open previews in**, for Image previews. |
| Image: Maximum file size | `editor.previews.providers.image.maxFileBytes` | 50 MB (52,428,800 bytes) | 5 – 250 MB, step 5 MB; 1,024 – 2,147,483,648 bytes in the box | A file larger than this is not read: the preview names its size and this limit instead. Raise it and press **Refresh** to show the file. |
| Image: Hatch transparent areas | `editor.previews.providers.image.transparencyHatch` | on | on · off | Draw diagonal hatching behind an image's transparent parts, in the theme's Picture Transparency Marker. Off, the canvas shows through plainly. |

#### SVG

An SVG is drawn as a picture, never as part of throng's own page: an SVG file can carry scripts and
links to remote content, and none of it runs or loads. Beside its editor the drawing follows your
unsaved changes. It sits on the same canvas, with the same hatching, controls and scrolling, as an
image. A `svg` code block in a Markdown note is drawn the same way.

| Setting | Key | Default | Values | What it does |
|---|---|---|---|---|
| SVG: Enabled | `editor.previews.providers.svg.enabled` | on | on · off | Offer previews of `.svg` files. Off, every such preview closes and the preview commands are shown disabled. |
| Open SVG files in | `editor.previews.providers.svg.defaultOpenAction` | `preview` | `editor` (Throng Editor) · `preview` (Throng Preview) · `os` (Default OS Program) | What opening one of these files from File Explorer, Quick Open or a link does. |
| SVG: Open previews in | `editor.previews.providers.svg.openTarget` | `lastActive` | `lastActive` (Last Active) · `new` (New Preview Panel) | As **Markdown: Open previews in**, for SVG previews. |
| SVG: Maximum file size | `editor.previews.providers.svg.maxFileBytes` | 10 MB (10,485,760 bytes) | 5 – 250 MB, step 5 MB; 1,024 – 2,147,483,648 bytes in the box | A file larger than this is not read: the preview names its size and this limit instead. Raise it and press **Refresh** to show the file. A preview beside its editor applies the same limit to the unsaved text. |
| SVG: Hatch transparent areas | `editor.previews.providers.svg.transparencyHatch` | on | on · off | Draw diagonal hatching behind an SVG's transparent parts, in the theme's Picture Transparency Marker. Off, the canvas shows through plainly. |

#### PDF

A PDF shows its pages one after another, at 100% — or fitted to the panel's width when a page is wider; pages are drawn as they come into
view. Its view controls, top left — Fit page width, Zoom In, Zoom 100%, Zoom Out — and the panel's zoom
chords and Ctrl+wheel redraw them sharp at the new size. Beside them, and on the right-click menu, the page
layouts: **Single Page**, **Two Pages** (two to a row, which Fit fills the width with) and **Pages Side by
Side** (as many to a row as fit, re-flowed as the panel is resized); a middle-button drag moves around the pages, and
[`Ctrl+G`](key-bindings.md#navigate) goes to a page. Its text can be selected and copied. Nothing in a
PDF runs, and a link follows only on Ctrl+click.

| Setting | Key | Default | Values | What it does |
|---|---|---|---|---|
| PDF: Enabled | `editor.previews.providers.pdf.enabled` | on | on · off | Offer previews of `.pdf` files. Off, every such preview closes and the preview commands are shown disabled. |
| Open PDFs in | `editor.previews.providers.pdf.defaultOpenAction` | `preview` | `preview` (Throng Preview) · `os` (Default OS Program) | What opening one of these files from File Explorer, Quick Open or a link does. |
| PDF: Open previews in | `editor.previews.providers.pdf.openTarget` | `lastActive` | `lastActive` (Last Active) · `new` (New Preview Panel) | As **Markdown: Open previews in**, for PDF previews. |
| PDF: Maximum file size | `editor.previews.providers.pdf.maxFileBytes` | 100 MB (104,857,600 bytes) | 5 – 250 MB, step 5 MB; 1,024 – 2,147,483,648 bytes in the box | A file larger than this is not read: the preview names its size and this limit instead. Raise it and press **Refresh** to show the file. |

#### HTML

An HTML page is shown as its static markup in a sandboxed frame, with the stylesheets, fonts and images
beside it in the project: no script runs and the page cannot navigate. A link follows only on Ctrl+click. The
page fills its panel at every zoom; a click in it makes the panel active, and the zoom chords, Ctrl+wheel and
the app's other shortcuts work while it has the keyboard. An edit updates the page in place, keeping where you
were scrolled. Find searches the page, and a right-click offers Copy, Copy as Rich Text, Select All and Split.

Nothing is fetched from the network except stylesheets, fonts and images from a **safe source**: one listed in
**HTML: Safe preview sources** below, which applies to every project, or in the project's own list in
**Project Settings**. When a page names a remote resource that is not loaded, one notice in the panel lists
each one under its source, with **Allow this source** to add that source to the project's list.

| Setting | Key | Default | Values | What it does |
|---|---|---|---|---|
| HTML: Enabled | `editor.previews.providers.html.enabled` | on | on · off | Offer previews of `.html` and `.htm` files. Off, every such preview closes and the preview commands are shown disabled. |
| Open HTML files in | `editor.previews.providers.html.defaultOpenAction` | `preview` | `editor` (Throng Editor) · `preview` (Throng Preview) · `os` (Default OS Program) | What opening one of these files from File Explorer, Quick Open or a link does. |
| HTML: Open previews in | `editor.previews.providers.html.openTarget` | `lastActive` | `lastActive` (Last Active) · `new` (New Preview Panel) | As **Markdown: Open previews in**, for HTML previews. |
| HTML: Maximum file size | `editor.previews.providers.html.maxFileBytes` | 10 MB (10,485,760 bytes) | 5 – 250 MB, step 5 MB; 1,024 – 2,147,483,648 bytes in the box | A file larger than this is not read: the preview names its size and this limit instead. Raise it and press **Refresh** to show the file. A preview beside its editor applies the same limit to the unsaved text. |
| HTML: Safe preview sources | `editor.previews.providers.html.safeSources` | `https://fonts.googleapis.com`, `https://fonts.gstatic.com` | A list of `https:` addresses, each a host (`https://cdn.example.com`, with a port if it needs one) or every subdomain of one (`https://*.example.com`); may be empty | Where an HTML preview may load stylesheets, fonts and images from, in every project. Scripts never run, whatever is listed. A project adds sources of its own in **Project Settings**. |

### Links

Paths a program prints, web addresses, allowed protocols and the hyperlinks a program declares are
followable in terminals, editors and previews with Ctrl+click, the Link menu, or
[`Ctrl+Enter`](key-bindings.md#navigate) in an editor or preview. A link is recognised by its text
alone; nothing checks that it exists before it is drawn.

**Where a followed link goes is fixed, not a setting**, and depends on what it names: a web or
loopback address opens in the system browser; a file in the project opens in throng — a preview or
an editor, by that file type's default open action under [Previews](#previews), and always an editor
when the link names a line and column; a folder, a network path, a `file:` URL and anything else on
disk is shown in OS Explorer; and an allowed protocol goes to its own handler. **A click never runs a
file and never opens one in its default program** — that is reached only by choosing *Open in OS
Default Program* or, for an executable, *Open Program* from the Link menu. The link underline and the
plain-click hint take their colours from the theme (see [Themes](#themes-and-icon-sets)).

| Setting | Key | Default | Values | What it does |
|---|---|---|---|---|
| Detect links in editors | `editor.links.detectInEditors` | on | on · off | Show every kind of link in editor documents. Off, none are shown, and Ctrl+click and `Ctrl+Enter` keep their ordinary editor meanings (add a cursor, insert a blank line). |
| Detect links in terminals | `editor.links.detectInTerminals` | on | on · off | Show every kind of link in terminal output. Off, none are shown and Ctrl+click follows nothing. A running terminal keeps its scrollback. |
| Link resolution timeout | `editor.links.existenceCheckTimeoutMs` | 2 s (2,000 ms) | 0.25 – 25 s, step 0.25 s | How long throng waits, in total however many places it looks, for a link to resolve when you follow it or open its Link menu. Raise it for a slow network share. Applies to the next lookup. |
| Allowed link protocols | `editor.links.protocolAllowlist` | `mailto`, `tel`, `slack` | A list of scheme names, with or without the colon, any case; may be empty | Schemes, besides the web, that are drawn as links and go to their handler. An email address written on its own is a `mailto:` link while that scheme is listed. Schemes that run code — `javascript`, `data`, `vbscript`, `ms-msdt`, `search-ms` and the like — are refused whatever the list says. |
| File extensions that end a spaced path | `editor.links.knownFileExtensions` | The extensions throng ships with | A list, each with or without its leading dot, any case; may be empty | Extensions that let an unquoted path run across spaces, in terminals and editors. An empty list means none do. Once you have edited it, extensions added in a later release do not appear in it. |

### Navigation


| Setting | Key | Default | Values | What it does |
|---|---|---|---|---|
| Quick Open hides excluded files | `editor.navigation.quickOpenExcludeHidden` | on | on · off | Leave out of Quick Open what the project hides — the excluded globs and anything hidden in this project. The modal has its own control to show them for one search. |
| Remember the last Quick Open query | `editor.navigation.rememberQuickOpenQuery` | off | on · off | Reopen Quick Open with the last query that actually opened a file, selected so typing replaces it. For this session only; never written to disk. |
| Remember the last Go To Line number | `editor.navigation.rememberGotoLineNumber` | off | on · off | Reopen Go To Line with the last line you went to. For this session only. |
| Navigation history size | `editor.navigation.historySize` | 10 entries | 1 – 100 entries | How many files Back and Forward remember in each editor and preview panel. Lowering it trims every open panel at once — never the file it is showing. History persists across restarts. |

### Indentation


A file that already indents one way keeps doing so; otherwise its language's entry applies, and
otherwise the defaults below. A setting never reformats an existing document — it decides what the
next indent inserts.

| Setting | Key | Default | Values | What it does |
|---|---|---|---|---|
| Indent with | `editor.indent.style` | `spaces` | `spaces` · `tabs` | What a new indent inserts. |
| Indent width | `editor.indent.indentWidth` | 2 columns | 1 – 16 columns | Spaces per indent level. |
| Tab width | `editor.indent.tabWidth` | 4 columns | 1 – 16 columns | Columns a literal tab occupies on screen. Display only. |
| Indentation by language | `editor.indentByLanguage` | Each language's convention | A table: language → style, width (1 – 16), tab width (1 – 16) | Per-language indentation. It cannot be emptied, because that would re-indent every language with the global default. |

### Languages


| Setting | Key | Default | Values | What it does |
|---|---|---|---|---|
| Language by file extension | `editor.languageByExtension` | empty | A table: extension → language | Map an extension to a language (for example `.foo` → Python), overriding detection by extension. A file throng recognises by name, such as `tsconfig.json`, keeps that language; only the picker changes it ([how the language is chosen](quick-start.md#4-edit-files)). |

## Terminal

| Setting | Key | Default | Values | What it does |
|---|---|---|---|---|
| Use Option as Meta (macOS only) | `terminals.macOptionIsMeta` | off | on · off | Make Option act as the Meta key in terminals, so shortcuts such as Option+B and Option+F reach programs that use Meta. Off, Option types the characters your keyboard layout puts on it, such as # or @. |
| Remember terminal form values | `terminals.formHistory.enabled` | on | on · off | Offer Startup Command and Shell Arguments values used before, per terminal type. Off stops recording and offering them, and keeps what is stored until cleared. |
| Terminal form values remembered | `terminals.formHistory.maxEntries` | 10 entries | 1 – 50 entries | How many values each field keeps per terminal type. Lowering this trims every list to its newest entries. |
| Show terminal status bar | `terminals.showStatusBar` | on | on · off | The status bar along the bottom of each terminal panel. |
| Shell integration | `terminals.shellIntegration` | on | on · off | Ask shells that cannot be observed from outside (PowerShell) to report their working directory, so terminals reopen where you left them. Installs a prompt function that defers to any prompt you already have — switch it off if it disagrees with a custom prompt. |
| Reload terminals when a project opens | `terminals.reloadMode` | `automatic` | `automatic` · `manual` | Automatic starts every terminal in every tab as a project opens. Manual starts none: each panel waits with a **Reload** action. |
| Remember the last running command by default | `terminals.defaultRememberCommand` | off | on · off | Ticks **Remember the last running command** on new terminal panels: a command running when the terminal closes runs again next time. A running Claude Code session is remembered as a resume of that session, not a fresh start. A panel keeps its own choice. |
| Reopen in the last directory by default | `terminals.defaultRememberDirectory` | on | on · off | Ticks **Reopen in the last directory** on new terminal panels. A directory that has gone away falls back to the project root. |
| Terminal notifications by default | `terminals.defaultNotifications` | on | on · off | Ticks **Terminal notifications** on new terminal panels, so a terminal can raise attention marks, pop-ups and desktop notifications. Off, every terminal that has not chosen for itself stays silent, terminals you already have included. A terminal's own toggle, on its status bar or in its menu, overrides this for that terminal. |
| Run as administrator by default (Windows only) | `terminals.defaultRunAsAdmin` | off | on · off | Ticks **Run as administrator** on new terminal panels. Whether a terminal can be elevated still depends on throng itself running elevated; this never elevates anything on its own. |
| Command tracking interval | `terminals.commandPollMs` | 1 s (1,000 ms) | 0.25 – 5 s, step 0.25 s | How often throng checks which command a terminal is running, while it has input or output. A quiet terminal is checked ten times less often. Lower notices a new command sooner; higher does less work. |
| Tell programs that links are supported | `terminals.advertiseHyperlinks` | on | on · off | Start terminal programs with `FORCE_HYPERLINK=1`, so tools that can print clickable links — Claude Code among them — do. Applies to terminals started afterwards. A `FORCE_HYPERLINK` the launching environment already carries is never overridden, in either direction, and throng never sets `WT_SESSION` or a borrowed `TERM_PROGRAM`. Off does not stop throng recognising paths printed as plain text. |
| Terminal title template | `terminals.titleTemplate` | `({title} ? "{app}: {title} \| " : {command} ? "{command} \| " : ""){shell}({path} ? " ({path})" : "")` | a [title template](#terminal-title-templates) | What a terminal panel is named, everywhere it is named. The panel-type icon is always shown beside it. |
| Longest command in a terminal title | `terminals.titleCommandMaxLength` | 40 characters | 10 – 200 characters, step 5 characters | `{command}` beyond this is shortened, with `…`. |
| Longest directory in a terminal title | `terminals.titlePathMaxLength` | 40 characters | 10 – 200 characters, step 5 characters | `{path}` beyond this keeps its root and last folder and drops folders from the middle. |
| Mark terminals that need you | `terminals.attention.enabled` | on | on · off | Raise an [attention mark](#attention) on a terminal panel when something happens in it that you may want to look at. Off, no terminal raises a mark and every existing terminal mark is withdrawn. The signals below are switched off with it. |
| Program exited | `terminals.attention.signals.processExited` | on | on · off | Mark a terminal whose program ended without you ending it. A zero exit code raises the Attention mark, anything else the Failed mark. Exact: throng is told when the process exits. |
| Command finished | `terminals.attention.signals.commandFinished` | on | on · off | Mark a terminal when its foreground command ends and nothing replaces it. Always the Attention mark: the exit code is not known. Exact, but up to two Command tracking intervals late, because throng notices by watching the foreground command and waits for a second check that still finds nothing running, so the pause between two commands of a loop is not a finish; a command that starts and ends between two checks can be missed. |
| Bell | `terminals.attention.signals.bell` | on | on · off | Mark a terminal when a program rings the terminal bell. Exact: the program asked for it. |
| Program notification | `terminals.attention.signals.notification` | on | on · off | Mark a terminal when a program sends a desktop notification request through the terminal. Exact: the program asked for it. |
| Progress ended | `terminals.attention.signals.progressEnded` | on | on · off | Mark a terminal when a program reports that the progress it was showing completed (Attention mark) or failed (Failed mark). Exact: the program reported it. |
| Unseen output | `terminals.attention.signals.unseenOutput` | off | on · off | Mark a terminal that prints output while it is not the focused panel. A heuristic: it means the terminal changed, not that it needs you. |
| Output went quiet | `terminals.attention.signals.outputQuiet` | off | on · off | Mark a terminal whose output stops for the quiet time below, after it printed while not focused. A heuristic: throng cannot tell a program that is waiting from one that is working silently. |
| Quiet time | `terminals.attention.quietMs` | 10 s (10,000 ms) | 10 – 600 s, step 10 s; 1,000 – 3,600,000 ms in the box | How long a terminal must stay silent after activity before Output went quiet marks it. |

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

| Setting | Key | Default | Values | What it does |
|---|---|---|---|---|
| New project folder starts at | `newProject.startingFolder` | `lastViewed` | `profile` · `lastViewed` · `override` | Where the new-project folder picker opens: your user profile, the last folder you chose, or the fixed folder below. |
| Override start folder | `newProject.overridePath` | empty | A folder path; may be empty | The folder the picker opens at when **Override** is chosen. Empty falls back to the last folder, then the profile. |

## Search

### Find Bar


| Setting | Key | Default | Values | What it does |
|---|---|---|---|---|
| Find delay | `search.asYouTypeDebounceMs` | 125 ms | 0 – 2,000 ms, step 25 ms; 0 – 10,000 ms in the box | How long the find bar waits after you stop typing before it re-runs the search and updates the highlights. |

### Find in Files


| Setting | Key | Default | Values | What it does |
|---|---|---|---|---|
| Find in Files results open in | `search.inFiles.openTarget` | `lastActive` | `lastActive` (The last Find in Files panel) · `new` (A new panel) | Whether a new search reuses the panel that ran the last one, or opens a fresh one and leaves the earlier results. |
| Find in Files searches | `search.inFiles.trigger` | `asYouType` | `run` (When you press Run) · `asYouType` (As you type) | Whether a search waits for **Run** or starts on its own once you stop typing. |
| Find in Files delay | `search.inFiles.settleMs` | 500 ms | 0 – 2,000 ms, step 25 ms; 0 – 10,000 ms in the box | How long an as-you-type search waits after you stop typing before it walks the project. |
| Find in Files groups results by | `search.inFiles.defaultGrouping` | `file` | `file` (File) · `fileAndFolder` (Folder, then file) · `folderTree` (Folder structure — the File Explorer's tree) | How results panels arrange their rows. Choosing a grouping in a panel changes it, and open panels follow. |
| Show results | `search.inFiles.showResults` | `expanded` | `collapsed` (Collapsed) · `expanded` (Expanded) | Whether result headings show collapsed or expanded, in every Find in Files panel. The panel's collapse toggle changes this setting too. |
| Excluded from search | `search.inFiles.excludeGlobs` | the File Explorer's defaults, then `**/dist`, `**/build`, `**/out`, `**/coverage`, `**/.claude`, `**/.vscode`, `**/.idea`, `**/log`, `**/logs`, `**/*.log`, `**/.remember`, `**/.cache`, `**/.turbo`, `**/.next`, `**/.nuxt`, `**/target`, `**/bin`, `**/obj`, `**/.venv`, `**/__pycache__`, `**/*.min.js`, `**/*.map`, `**/package-lock.json`, `**/pnpm-lock.yaml`, `**/yarn.lock` | A list of root-relative glob patterns; may be empty | What Find in Files skips. Separate from the File Explorer's excluded globs. A panel's exclusions toggle switches it off for that panel; a project's own *Hidden to Find & Replace* list always applies. |
| New panels use the exclusions | `search.inFiles.useExcludeGlobs` | on | on · off | Whether a new Find in Files panel starts with its exclusions toggle on. |
| Ask before a replace that cannot be undone | `search.inFiles.warnIrreversibleCommit` | on | on · off | Confirm before writing replacements throng cannot take back, such as into files with no open editor. |
| Replace summary notices | `search.inFiles.summaryNoticeMode` | `panel` | `never` (Never display) · `toast` (Toast only) · `panel` (Toast and keep in panel) | Whether the notice reporting what a replace changed is never shown, shown as a toast, or shown as a toast and kept in the [Notifications panel](#notifications). Choosing *Never display* asks you to confirm first. The toast leaves after the [toast duration](#notifications). |

**The replace-summary mode governs that notice whether the replace succeeded, partly succeeded or
failed**, and the [Notifications](#notifications) settings are not consulted for it at all — so a
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
neither **Toast** nor **Panel** ticked, the notice is shown nowhere in throng. A notice kept from another
window — Preferences, the Resource Monitor, a sub-workspace — joins the main window's panel, which
flashes. The panel's entries survive a restart; each can be copied or dismissed, and the panel lists
them oldest first, newest first, or by priority (error, warning, attention, information, success)
either way. **Dismiss all** clears the panel but never an attention mark. A count beside the panel's
title, and below **File Explorer & Notifications** while the right pane is collapsed, shows how many entries are waiting,
in throng's highlight colour; only dismissing entries lowers it. The panel can be minimised like the
Projects panel. Every toast and entry names the project, tab and panel it is about, and clicking it goes
there.

*OS Notify* raises an OS notification whatever **Toast** and **Panel** say — but only while throng is
not focused; while it is, **Toast** and **Panel** decide. One switch above the rows stops anything
reaching the OS, and greys out every OS Notify while it is off, keeping their settings. For errors or
warnings, clearing the last of **Toast** and **Panel** asks you to confirm first, because it means a
failure reports nothing on screen. Whatever they say, the event is still written to the log. A row's
Reset and Revert act on all three of its settings.

The Attention row announces [attention marks](#attention), Attention and Failed alike; a Failed mark keeps
the error colour and icon. A mark is announced once: a later signal on a panel still marked updates its
toast, if one is showing, and raises nothing new. Under the rows, **Attention › Clear delay** sets how long you
must stay in a marked panel before its mark clears.

| Setting | Key | Default | Values | What it does |
|---|---|---|---|---|
| Operating system notifications | `notifications.os` | on | on · off | Allow throng to send OS notifications at all. Off, nothing reaches the OS and every OS Notify is unavailable, though each keeps its setting. |
| Toast duration | `notifications.toastDurationMs` | 3 s (3,000 ms) | 1 – 30 s, step 0.5 s | How long every toast stays on screen. A toast stays while the pointer is over it or focus is inside it. |
| Toast width | `notifications.toastWidthPx` | 520 px | 300 – 800 px, step 10 px | How wide every toast is, and never wider than half the window. A toast shows at most three lines of text and cuts the rest with an ellipsis; hovering a cut-off toast shows all of it in a popover. The Notifications panel always shows a notification whole, with the date and time it was first raised. |
| Notification hover delay | `notifications.hoverDelayMs` | 250 ms | 0 – 1,500 ms, step 25 ms | How long the pointer must rest on a notification before it shows more: a Notifications panel entry expands to its whole text, and a cut-off toast shows its whole text in a popover. At 0 it shows at once. Keyboard focus never waits. |
| Confirm before dismissing all notifications | `notifications.confirmDismissAll` | on | on · off | Ask before **Dismiss all** clears the Notifications panel. |
| Notifications panel limit | `notifications.panelLimit` | 100 notifications | 20 – 500 notifications, step 10 notifications | The most entries the panel keeps. Past it the oldest are dropped, and a warning — once, until you dismiss it — suggests turning notifications down, with a link to this section. |
| Error: Toast | `notifications.error.toast` | on | on · off | Show error notices as a toast. |
| Error: Panel | `notifications.error.panel` | on | on · off | Keep error notices in the Notifications panel until dismissed, with or without a toast. |
| Error: OS Notify | `notifications.error.os` | off | on · off | Raise an OS notification for an error notice, whatever Toast and Panel say, while throng is not focused. |
| Warning: Toast | `notifications.warning.toast` | on | on · off | The same, for warnings — typically a partly-failed operation. |
| Warning: Panel | `notifications.warning.panel` | on | on · off | |
| Warning: OS Notify | `notifications.warning.os` | off | on · off | |
| Information: Toast | `notifications.info.toast` | on | on · off | Ordinary progress and status messages. |
| Information: Panel | `notifications.info.panel` | on | on · off | |
| Information: OS Notify | `notifications.info.os` | off | on · off | |
| Success: Toast | `notifications.success.toast` | on | on · off | Confirmations of an operation that worked — the safest to switch off. |
| Success: Panel | `notifications.success.panel` | on | on · off | |
| Success: OS Notify | `notifications.success.os` | off | on · off | |
| Attention: Toast | `notifications.attention.toast` | on | on · off | Whether a mark is announced by a toast. The mark itself is raised whatever you choose. |
| Attention: Panel | `notifications.attention.panel` | on | on · off | Whether a mark is kept in the Notifications panel until it clears or you dismiss it. |
| Attention: OS Notify | `notifications.attention.os` | on | on · off | Raise an OS notification for a mark, whatever Toast and Panel say, while throng is not focused; clicking it goes to the panel. |
| Attention: Clear delay | `attention.clearDelayMs` | 1 s (1,000 ms) | 0 – 10 s, step 0.1 s | How long you must stay in a marked panel — keyboard focus inside it — before its mark clears. Switching to its tab or project without moving into the panel leaves the mark. 0 clears it as soon as you focus the panel. |

## Logging

Logs and crash reports are written to a `logs` folder under the user-data directory —
`%APPDATA%\throng\logs` when installed, `%APPDATA%\throng-dev\logs` for a dev run — so a crash that
closes the window leaves evidence behind. The daemon and its terminal agent write beside the app.
Logs never leave the machine, and they are anonymised before they are written: paths, user and machine
names become short tokens — the same value gives the same token in every log — and a project is named
by its internal id, shown when you hover a project's path in the Projects panel. Every notice is
logged, with the number of entries pending in the Notifications panel at the time.

| Setting | Key | Default | Values | What it does |
|---|---|---|---|---|
| Log detail | `diagnostics.logLevel` | `info` | `fatal` · `error` · `warn` · `info` · `debug` | How much throng records. A crash of a process, window or panel is recorded at `fatal` whatever this is set to. Raise it to `debug` before reproducing a problem, then send the logs with your report. At `debug`, terminals also write `[renderer-terminal]` lines to `main.log` — what each view was handed when it attached, screen and mouse mode changes, wheel routing, selections, menu copies and redraws. |
| Log file size | `diagnostics.maxFileBytes` | 1 MB (1,048,576 bytes) | 0.25 – 4 MB, step 0.25 MB; 1,024 – 67,108,864 bytes in the box | How large one log file grows before throng starts a new one. |
| Days of logs kept | `diagnostics.keepDays` | 3 days | 1 – 30 days | How many days of logs to keep, counting only days throng was running. Older logs are deleted. |
| Log folder limit | `diagnostics.maxTotalBytes` | 100 MB (104,857,600 bytes) | 50 – 2,000 MB, step 50 MB; 1,048,576 – 68,719,476,736 bytes in the box | The most space all of throng's logs and crash reports may take. Past it, the oldest files are deleted first, and the log records that it did. A log still being written is never deleted. |

## Resource Monitor

What the status bar's usage figures and the [Resource Monitor](quick-start.md#8-see-what-throng-is-using)
measure, how often, and when a figure turns to the warning or critical colour. CPU is a share of the
whole machine; memory is a share of installed RAM.

| Setting | Key | Default | Values | What it does |
|---|---|---|---|---|
| Capture interval | `resourceMonitor.captureIntervalMs` | 2 s (2,000 ms) | 2 – 60 s, step 1 s | How often throng measures itself. A longer history needs a slower capture: up to 5 minutes allows 2 s, up to 10 minutes 5 s, up to 20 minutes 15 s, up to 30 minutes 30 s. A faster value than the history allows is raised, and Preferences says so beside the field. Also changeable from the monitor's toolbar. |
| History window | `resourceMonitor.historyMs` | 5 min (300,000 ms) | 1 – 30 min, step 1 min | How much history the monitor keeps per process while it is open. Nothing is kept once it closes. |
| CPU warning (%) | `resourceMonitor.cpuWarningPercent` | 50% | 1 – 100% | The CPU share at which a figure shows the warning colour. Kept below the critical level. |
| CPU critical (%) | `resourceMonitor.cpuCriticalPercent` | 80% | 1 – 100% | The CPU share at which a figure shows the critical colour. |
| Memory warning (%) | `resourceMonitor.memoryWarningPercent` | 50% | 1 – 100% | The share of installed memory at which a figure shows the warning colour. A process at or above it is never hidden as idle. |
| Memory critical (%) | `resourceMonitor.memoryCriticalPercent` | 80% | 1 – 100% | The share of installed memory at which a figure shows the critical colour. |
| Popup delay (ms) | `resourceMonitor.popoverDelayMs` | 500 ms | 0 – 1,500 ms, step 25 ms; 0 – 10,000 ms in the box | How long the pointer rests on the status bar usage figures before their popup opens. At 0 it opens at once. Keyboard focus never waits. |
| Kill processes | `confirmations.killProcesses` | `double` | `none` · `single` · `double` | Confirmations (none, one or two) before the Resource Monitor force-ends a process (**Kill Process**) or everything running beneath a project, tab, panel or process (**Kill All Below**). The dialog names what will end. |

## Settings with no control

Three terminal-flavour settings take effect from a hand-edited `settings.json` but have no control in
the Settings editor yet: `terminals.flavours` (custom shells for the Flavour dropdown — id, label,
executable, arguments), `terminals.disabledBuiltins` (built-in flavour ids to hide) and
`terminals.defaultShellArguments` (arguments passed to a flavour every time it starts, keyed by
flavour id). `settings.json` also carries bookkeeping throng writes for itself — a `version` marker
and the last folder chosen for a new project — which is not a preference.

## Themes and icon sets

**Themes** — throng ships 14: **throng** (the default), Light, Snake, Gothic, Windows Terminal, Bash,
VSCode, VI-VIM, English Garden, Matrix, Cyberpunk, Claude, Debian and Ubuntu. The **Themes** tab
edits every token of a theme — colours, fonts and sizes, syntax colours, the icon colour and icon
set — each with a plain-language label, using colour and size pickers drawn from the theme itself. Every one of
those is stored in the theme's own file, so an edit belongs to the theme you made it in, and switching theme
brings back everything that theme holds. A colour deleted from a theme's JSON takes that theme's own shipped
value again (a theme of your own takes the default theme's), never the one from the theme you switched from.
**Clone** is how you make a theme of your own. Contrast is guarded automatically. The seven **Markdown preview › Callouts** colours give a preview's callouts their accent, each callout type taking one of the seven; the box is a light tint of it over the editor background. Printing never uses the theme: a printed preview takes fixed print colours. The seven **File Icons** colours, under File Explorer, colour file icons by kind — code, markup,
data, documents, media, archives and scripts — in the File Explorer and Find in Files, and **Other File
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
theme is your choice, from the theme editor's restore controls — **Restore All Themes to Default**, or
a per-theme restore or recreate on a single built-in. Every restore is all-or-nothing: if a theme file
cannot be written, nothing changes.

**Icon sets** — every icon in throng comes from one icon set. The default set, **throng**, is simple
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
   any `<key>.svg` with your own SVG, or copy a file with the right name straight in — a file being
   there is all an override needs.
4. **Reload the icon sets from disk** loads your changes. throng does not watch the folders: it reads
   every set again when it starts and on every icon set control here — picking a set, the buttons
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

The config folder can be moved with [`THRONG_CONFIG_ROOT`](environment.md#running-the-app).

**Shipped defaults.** throng carries an immutable, versioned record of its default settings, key
bindings and built-in themes, generated from its own definitions. Every reset reads from it. A first
run seeds the config folder from it without overwriting any file already there, and
`defaults-state.json` records which version of the defaults has been applied.
