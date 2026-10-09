[throng](../README.md) › [Docs](README.md) › Preferences

# Preferences

Every setting throng has, in the groups the **Settings** editor shows them in, with its key in
`settings.json`, its shipped default, what it accepts and what it does. Key bindings have a page of
their own — [Key bindings](key-bindings.md) — and themes, icon packs and the config files are at the
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
- A number slider moves in steps; the field beside it accepts any whole number within the range.

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
so.** Each setting's limits are the ones its control shows (two settings accept more by hand, noted
below), so a pane width of `99999` loads as the maximum the slider offers, and `settings.json` is
rewritten to the corrected value. This happens whenever the file is read, including a hot-reload. A
file already within its limits is **never** rewritten.

**A file that cannot be parsed is left alone.** throng re-reads it a few times in case it caught you
mid-save; if it still will not parse, throng runs on the shipped defaults, says so in the diagnostics
log, and leaves your file exactly as it is for you to repair. A key throng does not recognise is kept
when it writes the file; a retired key it once used is dropped.

## Appearance

| Setting | Key | Default | Values | What it does |
|---|---|---|---|---|
| Theme | `appearance.theme` | `throng` | Any theme on disk | The active theme, applied across the whole app. See [Themes and icon packs](#themes-and-icon-packs). |

## Confirmations

`none`, `single` or `double` is how many confirmations an action asks for before it happens.

| Setting | Key | Default | Values | What it does |
|---|---|---|---|---|
| Remove a project | `confirmations.destroyProject` | `double` | `none` · `single` · `double` | Confirmations before a project is removed. It is unregistered; no files are deleted. |
| Unload project: default terminal action | `projects.unloadTerminalAction` | `keepRunning` | `keepRunning` (Keep terminals running) · `endTerminals` (End terminals) | What the project menu's **Unload Project** row does to the project's terminals; the menu's second Unload row does the other — **Unload Project and End Terminals** under the shipped setting, **Unload Project and Keep Terminals Running** otherwise. Keep leaves every terminal alive, idle shells included, and reattaches each when the project is next loaded; End ends every terminal, running processes included; one that cannot be ended stays running, says so once, and reattaches when the project is next loaded. Neither row asks anything; the only prompt Unload can show is the usual one for unsaved editors. |
| Destroy a tab | `confirmations.destroyTab` | `double` | `none` · `single` · `double` | Confirmations before a tab and its panels are destroyed. |
| Destroy a panel | `confirmations.destroyPanel` | `double` | `none` · `single` · `double` | Confirmations before a panel is destroyed. |
| Destroy a sub-workspace | `confirmations.destroySubWorkspace` | `double` | `none` · `single` · `double` | Confirmations before a sub-workspace is destroyed. |

## Panes

| Setting | Key | Default | Values | What it does |
|---|---|---|---|---|
| Projects pane max width | `panes.projects.maxWidth` | 400 | 200 – 1,200 px, step 10 | The widest the Projects pane can be dragged. |
| File Explorer pane max width | `panes.fileExplorer.maxWidth` | 700 | 200 – 1,200 px, step 10 | The widest the File Explorer pane can be dragged. |

## Behaviour

| Setting | Key | Default | Values | What it does |
|---|---|---|---|---|
| Submenu hover delay | `behaviour.submenuHoverMs` | 100 | 0 – 2,000 ms, step 25 | How long the pointer rests on a context-menu item before its submenu opens. |

## Tabs

| Setting | Key | Default | Values | What it does |
|---|---|---|---|---|
| Tab scroll animation | `tabs.smoothScrollMs` | 300 | 0 – 1,500 ms, step 50 | How long the tab strip takes to ease to a new position. Zero scrolls instantly — as does the system "reduce motion" setting, which overrides this without changing it. |
| Tab close-button delay | `tabs.closeArmingDelayMs` | 300 | 0 – 1,500 ms, step 50 | How long the pointer must rest on a tab before its close button will act, so a click cannot land on a tab the pointer was only passing over. |
| Longest tab and panel name | `tabs.maxNameLength` | 64 | 10 – 128 characters, step 2 | The most characters a tab or panel name may use. Longer names are shortened for display, with the full name on hover. |
| Widest tab | `tabs.maxWidth` | 32 | 10 – 128 characters, step 2 | The widest a tab is drawn. A longer title is ellipsised in the strip and shown in full on hover; the name itself is not shortened. |
| New tabs open | `tabs.newTabPosition` | `afterActive` | `afterActive` · `end` | Where a tab created with **+** goes: right of the active tab, or at the end of the strip. |
| Chevron repeat delay | `tabs.chevronRepeatDelayMs` | 350 | 100 – 3,000 ms, step 50 | How long a press-and-hold on a scroll chevron waits before the strip scrolls continuously. |
| Tab popover delay | `tabs.popoverDelayMs` | 500 | 0 – 1,500 ms, step 25 | How long the pointer must rest on a tab before its information popover appears. |
| Tab hover-activate delay | `behaviour.tabHoverActivateMs` | 600 | 0 – 5,000 ms, step 50 | While **dragging** a panel or tab, how long it must dwell over another tab before that tab comes to the front so you can drop inside it. An ordinary mouse-over does nothing. |

## File Explorer

| Setting | Key | Default | Values | What it does |
|---|---|---|---|---|
| Open files with | `editor.openOnClick` | `single` | `single` · `double` · `none` | Which file-tree click opens a file into the last active editor. |
| Open files in | `editor.openTarget` | `lastActive` | `lastActive` · `new` | Where an opened file lands: the last active editor, reused, or a new editor panel. |
| Delete files to | `explorer.deleteMode` | `recycle` | `recycle` · `permanent` | Send deleted files to the Recycle Bin, or delete them permanently. |
| When Paste replaces an item | `explorer.replaceMode` | `recycle` | `recycle` · `permanent` | What happens to an item a paste or drag replaces after you choose **Replace**: the Recycle Bin, so undo can bring it back, or deleted for good. Independent of the delete setting. |
| Excluded globs | `explorer.excludeGlobs` | `**/.git`, `**/.svn`, `**/.hg`, `**/CVS`, `**/.DS_Store`, `**/Thumbs.db`, `**/node_modules` | A list of root-relative glob patterns; may be empty | Entries hidden from the file tree (and, by default, from Quick Open). An empty list hides nothing. |
| Follow the active editor | `explorer.autoRevealActiveFile` | on | on · off | Select the active editor's file in File Explorer, expanding its folders. |
| Copy-drag modifier | `explorer.dragCopyModifier` | `ctrl` | `ctrl` · `shift` · `alt` | The key that makes a file-tree drag copy instead of move. |
| Move-drag modifier | `explorer.dragMoveModifier` | `shift` | `ctrl` · `shift` · `alt` | The key that forces a file-tree drag to move. |

## Editor

| Setting | Key | Default | Values | What it does |
|---|---|---|---|---|
| Auto-save | `editor.autoSave` | off | on · off | Write edits automatically once typing settles, without `Ctrl+S`. |
| Save Document Scroll Position | `editor.saveDocumentScroll` | off | on · off | Reopening a file in the same editor restores where you were, instead of starting at the top. |
| Auto-save delay | `editor.autoSaveDebounceMs` | 300 | 0 – 10,000 ms, step 100 | How long after typing stops an auto-save writes. |
| Save-All scope | `editor.saveAllScope` | `project` | `tab` · `project` · `all` | What a `Ctrl+Shift+S` Save All covers. |
| New-file line ending | `editor.defaultLineEnding` | `lf` | `lf` · `crlf` · `cr` | The line ending for brand-new documents. An existing file keeps its own. |
| Max open file size | `editor.maxOpenFileBytes` | 10,485,760 (10 MB) | 5,242,880 – 262,144,000 bytes in 5 MB steps; down to 1,024 by hand | Files larger than this report "too large" instead of opening. |
| Project editor path display | `editor.projectPathDisplay` | `full` | `full` · `name` | Show a project-owned editor's pill as the full path or just the file name. |
| Sub-workspace editor path display | `editor.subWorkspacePathDisplay` | `full` | `full` · `name` | The same, for an editor owned by a sub-workspace. |
| Warn on missing file | `editor.warnOnMissingFile` | on | on · off | Report an editor whose file is missing or deleted. |
| Editor default word wrap | `editor.defaultWordWrap` | on | on · off | Wrap long lines by default in new editors. Each editor toggles its own from its status bar, its content menu or [`Ctrl+E,W`](key-bindings.md#editor). |
| Show the editor gutter | `editor.showGutter` | on | on · off | The strip of line numbers down each editor's left side. Hiding it gives that width back to the document. |
| Highlight other occurrences of the selection | `editor.highlightOccurrences` | on | on · off | Softly tints every other instance of the text selected in an editor or Markdown preview. A whole-word selection tints whole words only; matching is case-sensitive. |
| Markdown sections open | `editor.markdownSectionsOpen` | `expanded` | `expanded` · `collapsed` | Whether a Markdown document opens with its heading sections expanded or collapsed, in the editor and its preview alike. Sections are then folded from the gutter, the right-click menu or the [Markdown bindings](key-bindings.md#markdown). |
| Keep undo history after a crash | `editor.persistUndoHistory` | on | on · off | Restore the undo history along with unsaved changes when throng reopens after a crash. Removed text lives in the recovery file until then. |

### Status Bar

| Setting | Key | Default | Values | What it does |
|---|---|---|---|---|
| Show editor status bar | `editor.showStatusBar` | on | on · off | The bar along the bottom of each editor: the language control, the word-wrap toggle, the cursor position and the character and word counts. Hiding it hides all of them, whatever the two settings below say; wrap and language stay reachable from the content menu and the key binding. |
| Show cursor position | `editor.statusBar.showCursorPosition` | on | on · off | The caret's line and column. |
| Show character and word counts | `editor.statusBar.showCounts` | on | on · off | Characters selected, and the characters and words the document holds. |

### Previews

A preview is a read-only, rendered view of a file beside its editor. Markdown is the one provider
throng ships; each provider has an **Enabled** switch and, for a text format, a **Default open
action**, plus any settings of its own. Turning a provider off closes its open previews and greys its
other settings rather than hiding them.

| Setting | Key | Default | Values | What it does |
|---|---|---|---|---|
| Preview update delay | `editor.previews.updateDelayMs` | 300 | 0 – 5,000 ms, step 50 | How long a preview beside an editor waits after you stop typing before it shows your changes. Zero updates on every change. |
| Preview maximum wait | `editor.previews.maxWaitMs` | 1,000 | 0 – 10,000 ms, step 100 | The longest a preview goes without catching up while you keep typing. A value below the update delay behaves as the update delay. |
| Preview copy format | `editor.previews.copyFormat` | `rich` | `rich` (Rich text) · `plain` (Plain text) | What Copy from a preview puts on the clipboard: formatted text that keeps headings, lists and links, or plain text. |
| Synchronise preview and editor scrolling | `editor.previews.syncScroll` | on | on · off | Keep a preview and its editor at the same place, both ways: scrolling either scrolls the other, block by block. Also switched from either panel's right-click menu, the **Synchronise Scrolling** status-bar button, or the [`preview.toggleSyncScroll`](key-bindings.md#editor) command. |
| Open previews in | `editor.previews.openTarget` | `lastActive` | `lastActive` (Last Active) · `new` (New) | Last Active reuses the most recently used preview in the tab you are looking at, adding to its Back history; otherwise a new preview opens. New opens every preview in a panel of its own. File Explorer's **Open In → Last Preview Panel / New Preview Panel** choose explicitly. |
| Markdown: Enabled | `editor.previews.providers.markdown.enabled` | on | on · off | Offer previews of `.md` and `.markdown` files. Off, every such preview closes and the preview commands are shown disabled. |
| Markdown: Default open action | `editor.previews.providers.markdown.defaultOpenAction` | `editor` | `editor` · `preview` | What opening a Markdown file from File Explorer or Quick Open does. Find in Files results and **Open In** always open an editor. |
| Markdown: Load remote images | `editor.previews.providers.markdown.loadRemoteImages` | on | on · off | Show images a document links from the web over HTTPS, such as build badges. Off, each shows its alternative text and nothing is requested. |
| Markdown: Show front matter | `editor.previews.providers.markdown.showFrontMatter` | on | on · off | Show the metadata block at the top of a document as a table. Off, the block is not shown at all. |
| Markdown: Preview gutter | `editor.previews.providers.markdown.gutter` | on | on · off | A narrow strip down a Markdown preview's left edge holding a fold arrow beside each heading; the document moves right to make room. Off, the strip and its arrows are gone and folding stays available from the menus and bindings. |
| Markdown: Heading jump scroll duration (ms) | `editor.previews.providers.markdown.headingJumpMs` | 200 | 0 – 2,000 ms, step 50 | How long a jump from [Go to Heading](key-bindings.md#navigate) takes to scroll there. Zero jumps instantly. |

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
plain-click hint take their colours from the theme (see [Themes](#themes-and-icon-packs)).

| Setting | Key | Default | Values | What it does |
|---|---|---|---|---|
| Detect links in editors | `editor.links.detectInEditors` | on | on · off | Show every kind of link in editor documents. Off, none are shown, and Ctrl+click and `Ctrl+Enter` keep their ordinary editor meanings (add a cursor, insert a blank line). |
| Detect links in terminals | `editor.links.detectInTerminals` | on | on · off | Show every kind of link in terminal output. Off, none are shown and Ctrl+click follows nothing. A running terminal keeps its scrollback. |
| Link resolution timeout | `editor.links.existenceCheckTimeoutMs` | 2,000 | 250 – 25,000 ms, step 250 | How long throng waits, in total however many places it looks, for a link to resolve when you follow it or open its Link menu. Raise it for a slow network share. Applies to the next lookup. |
| Allowed link protocols | `editor.links.protocolAllowlist` | `mailto`, `tel`, `slack` | A list of scheme names, with or without the colon, any case; may be empty | Schemes, besides the web, that are drawn as links and go to their handler. An email address written on its own is a `mailto:` link while that scheme is listed. Schemes that run code — `javascript`, `data`, `vbscript`, `ms-msdt`, `search-ms` and the like — are refused whatever the list says. |
| File extensions that end a spaced path | `editor.links.knownFileExtensions` | The extensions throng ships with | A list, each with or without its leading dot, any case; may be empty | Extensions that let an unquoted path run across spaces, in terminals and editors. An empty list means none do. Once you have edited it, extensions added in a later release do not appear in it. |

## Editor · Navigation

| Setting | Key | Default | Values | What it does |
|---|---|---|---|---|
| Quick Open hides excluded files | `editor.navigation.quickOpenExcludeHidden` | on | on · off | Leave out of Quick Open what the project hides — the excluded globs and anything hidden in this project. The modal has its own control to show them for one search. |
| Remember the last Quick Open query | `editor.navigation.rememberQuickOpenQuery` | off | on · off | Reopen Quick Open with the last query that actually opened a file, selected so typing replaces it. For this session only; never written to disk. |
| Remember the last Go To Line number | `editor.navigation.rememberGotoLineNumber` | off | on · off | Reopen Go To Line with the last line you went to. For this session only. |
| Navigation history size | `editor.navigation.historySize` | 10 | 1 – 100, step 1 | How many files Back and Forward remember in each editor and preview panel. Lowering it trims every open panel at once — never the file it is showing. History persists across restarts. |

## Terminal

| Setting | Key | Default | Values | What it does |
|---|---|---|---|---|
| Show terminal status bar | `terminals.showStatusBar` | on | on · off | The status bar along the bottom of each terminal panel. |
| Shell integration | `terminals.shellIntegration` | on | on · off | Ask shells that cannot be observed from outside (PowerShell) to report their working directory, so terminals reopen where you left them. Installs a prompt function that defers to any prompt you already have — switch it off if it disagrees with a custom prompt. |
| Reload terminals when a project opens | `terminals.reloadMode` | `automatic` | `automatic` · `manual` | Automatic starts every terminal in every tab as a project opens. Manual starts none: each panel waits with a **Reload** action. |
| Remember the last running command by default | `terminals.defaultRememberCommand` | off | on · off | Ticks **Remember the last running command** on new terminal panels: a command running when the terminal closes runs again next time. A panel keeps its own choice. |
| Reopen in the last directory by default | `terminals.defaultRememberDirectory` | on | on · off | Ticks **Reopen in the last directory** on new terminal panels. A directory that has gone away falls back to the project root. |
| Run as administrator by default | `terminals.defaultRunAsAdmin` | off | on · off | Ticks **Run as administrator** on new terminal panels. Whether a terminal can be elevated still depends on throng itself running elevated; this never elevates anything on its own. |
| Command tracking interval | `terminals.commandPollMs` | 1,000 | 250 – 5,000 ms, step 250 | How often throng checks which command a terminal is running. Lower notices a new command sooner; higher does less work. |
| Tell programs that links are supported | `terminals.advertiseHyperlinks` | on | on · off | Start terminal programs with `FORCE_HYPERLINK=1`, so tools that can print clickable links — Claude Code among them — do. Applies to terminals started afterwards. A `FORCE_HYPERLINK` the launching environment already carries is never overridden, in either direction, and throng never sets `WT_SESSION` or a borrowed `TERM_PROGRAM`. Off does not stop throng recognising paths printed as plain text. |
| Terminal title template | `terminals.titleTemplate` | `({title} ? "{app}: {title} \| " : {command} ? "{command} \| " : ""){shell}({path} ? " ({path})" : "")` | a [title template](#terminal-title-templates) | What a terminal panel is named, everywhere it is named. The panel-type icon is always shown beside it. |
| Longest command in a terminal title | `terminals.titleCommandMaxLength` | 40 | 10 – 200, step 5 | `{command}` beyond this is shortened, with `…`. |
| Longest directory in a terminal title | `terminals.titlePathMaxLength` | 40 | 10 – 200, step 5 | `{path}` beyond this keeps its root and last folder and drops folders from the middle. |

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

## Editor · Indentation

A file that already indents one way keeps doing so; otherwise its language's entry applies, and
otherwise the defaults below. A setting never reformats an existing document — it decides what the
next indent inserts.

| Setting | Key | Default | Values | What it does |
|---|---|---|---|---|
| Indent with | `editor.indent.style` | `spaces` | `spaces` · `tabs` | What a new indent inserts. |
| Indent width | `editor.indent.indentWidth` | 2 | 1 – 16 | Spaces per indent level. |
| Tab width | `editor.indent.tabWidth` | 4 | 1 – 16 | Columns a literal tab occupies on screen. Display only. |
| Indentation by language | `editor.indentByLanguage` | Each language's convention | A table: language → style, width (1 – 16), tab width (1 – 16) | Per-language indentation. It cannot be emptied, because that would re-indent every language with the global default. |

## Editor · Languages

| Setting | Key | Default | Values | What it does |
|---|---|---|---|---|
| Language by file extension | `editor.languageByExtension` | empty | A table: extension → language | Map an extension to a language (for example `.foo` → Python), overriding the built-in detection. |

## New Project

| Setting | Key | Default | Values | What it does |
|---|---|---|---|---|
| New project folder starts at | `newProject.startingFolder` | `lastViewed` | `profile` · `lastViewed` · `override` | Where the new-project folder picker opens: your user profile, the last folder you chose, or the fixed folder below. |
| Override start folder | `newProject.overridePath` | empty | A folder path; may be empty | The folder the picker opens at when **Override** is chosen. Empty falls back to the last folder, then the profile. |

## Search · Find Bar

| Setting | Key | Default | Values | What it does |
|---|---|---|---|---|
| Find delay | `search.asYouTypeDebounceMs` | 120 | 0 – 1,000 ms, step 10 | How long the find bar waits after you stop typing before it re-runs the search and updates the highlights. |

## Search · Find in Files

| Setting | Key | Default | Values | What it does |
|---|---|---|---|---|
| Find in Files results open in | `search.inFiles.openTarget` | `lastActive` | `lastActive` (The last Find in Files panel) · `new` (A new panel) | Whether a new search reuses the panel that ran the last one, or opens a fresh one and leaves the earlier results. |
| Find in Files searches | `search.inFiles.trigger` | `asYouType` | `run` (When you press Run) · `asYouType` (As you type) | Whether a search waits for **Run** or starts on its own once you stop typing. |
| Find in Files delay | `search.inFiles.settleMs` | 500 | 0 – 2,000 ms, step 50 | How long an as-you-type search waits after you stop typing before it walks the project. |
| Find in Files groups results by | `search.inFiles.defaultGrouping` | `file` | `file` (File) · `fileAndFolder` (Folder, then file) | How a freshly opened results panel arranges its rows. |
| Keep the grouping you chose | `search.inFiles.rememberGrouping` | on | on · off | Whether a grouping you switch to survives the next search in that panel. |
| Ask before a replace that cannot be undone | `search.inFiles.warnIrreversibleCommit` | on | on · off | Confirm before writing replacements throng cannot take back, such as into files with no open editor. |
| Replace summary notices | `search.inFiles.summaryNoticeMode` | `dismiss` | `never` (Never display) · `timed` (Display for) · `dismiss` (Dismiss only) | Whether the notice reporting what a replace changed stays until dismissed, disappears on its own, or never shows. Choosing *Never display* asks you to confirm first. |
| Replace summary notice duration | `search.inFiles.summaryNoticeTimeoutMs` | 5,000 | 3,000 – 30,000 ms, step 500 | How long that notice stays when the mode is *Display for*; greyed out otherwise. |

**The replace-summary pair governs that notice whether the replace succeeded, partly succeeded or
failed**, and the [Notifications](#notifications) settings are not consulted for it at all — so a
global preference that errors stay until dismissed does not reach it. The control sits beside the
thing it overrides it for. *Never display* is confirmed first because this notice is also how a
failed write reports itself; whatever the mode, the outcome is still written to the log.

## Notifications

A mode and a duration for each severity. *Never display* for errors or warnings asks you to confirm
first, because it means a failure reports nothing on screen. Whatever the mode, the event is still
written to the log.

| Setting | Key | Default | Values | What it does |
|---|---|---|---|---|
| Error notices | `notifications.error.mode` | `dismiss` | `never` (Never display) · `timed` (Display for) · `dismiss` (Dismiss only) | Whether error notices stay until dismissed, disappear on their own, or never show. |
| Error notice duration | `notifications.error.timeoutMs` | 5,000 | 3,000 – 30,000 ms, step 500 | How long an error notice stays under *Display for*. |
| Warning notices | `notifications.warning.mode` | `dismiss` | as above | The same, for warnings — typically a partly-failed operation. |
| Warning notice duration | `notifications.warning.timeoutMs` | 5,000 | 3,000 – 30,000 ms, step 500 | |
| Information notices | `notifications.info.mode` | `timed` | as above | Ordinary progress and status messages. |
| Information notice duration | `notifications.info.timeoutMs` | 10,000 | 3,000 – 30,000 ms, step 500 | |
| Success notices | `notifications.success.mode` | `timed` | as above | Confirmations of an operation that worked — the safest to shorten or switch off. |
| Success notice duration | `notifications.success.timeoutMs` | 5,000 | 3,000 – 30,000 ms, step 500 | |

## Logging

Logs and crash reports are written to a `logs` folder under the user-data directory —
`%APPDATA%\throng\logs` when installed, `%APPDATA%\throng-dev\logs` for a dev run — so a crash that
closes the window leaves evidence behind. The daemon and its terminal agent write beside the app.
Logs never leave the machine.

| Setting | Key | Default | Values | What it does |
|---|---|---|---|---|
| Log detail | `diagnostics.logLevel` | `info` | `error` · `warn` · `info` · `debug` | How much throng records. Raise it to `debug` before reproducing a problem, then send the logs with your report. At `debug`, terminals also write `[renderer-terminal]` lines to `main.log` — what each view was handed when it attached, screen and mouse mode changes, wheel routing, selections, menu copies and redraws. |
| Log file size (KB) | `diagnostics.maxFileSizeKb` | 1,024 | 64 – 4,096 KB, step 64; up to 65,536 by hand | How large one log file grows before throng starts a new one. |
| Log files kept | `diagnostics.keepFiles` | 5 | 1 – 20 | How many files to keep for each part of throng, including the one being written. Older files are deleted. |

## Settings with no control

Three terminal-flavour settings take effect from a hand-edited `settings.json` but have no control in
the Settings editor yet: `terminals.flavours` (custom shells for the Flavour dropdown — id, label,
executable, arguments), `terminals.disabledBuiltins` (built-in flavour ids to hide) and
`terminals.defaultShellArguments` (arguments passed to a flavour every time it starts, keyed by
flavour id). `settings.json` also carries bookkeeping throng writes for itself — a `version` marker
and the last folder chosen for a new project — which is not a preference.

## Themes and icon packs

**Themes** — throng ships 14: **throng** (the default), Light, Snake, Gothic, Windows Terminal, Bash,
VSCode, VI-VIM, English Garden, Matrix, Cyberpunk, Claude, Debian and Ubuntu. The **Themes** tab
edits every token of a theme — colours, fonts and sizes, syntax colours, icons — each with a
plain-language label, using colour, size and icon pickers drawn from the theme itself. **Clone** is
how you make a theme of your own. Contrast is guarded automatically. The
link underline's colours are the **Link Underline** and **Link Hover Underline** tokens, and the
plain-click hint's are **Link Hint Background**, **Link Hint Text** and **Link Hint Border**, all in
the General area; unset, they follow the theme's accent colour. The tint on other occurrences of a
selection is **Selection Occurrence Highlight**, and its quieter form in a panel without focus is
**Inactive Selection Occurrence Highlight** (both in the Search area, derived from the same colours as
search matches); a selection kept in a panel without focus is **Editor Inactive Selection** (Editor
area). See [Highlight other occurrences of the selection](#editor).

**Restoring built-in themes.** An upgrade only *adds* newly shipped themes and fills in newly added
theme tokens; it never overwrites a value you already have. Adopting new shipped values on an existing
theme is your choice, from the theme editor's restore controls — **Restore All Themes to Default**, or
a per-theme restore or recreate on a single built-in. Every restore is all-or-nothing: if a theme file
cannot be written, nothing changes.

**Icon packs** — a theme chooses an icon pack, selected beside the theme's icon colour in the Themes
tab. A `throng` glyph pack and an SVG image pack ship built in, and a pack re-skins every icon in the
application live. Your own packs live in the `icon-packs` folder below.

## Where the files live

Every setting, binding and theme is a human-editable file that **hot-reloads** when you save it by
hand, and the preferences window writes those same files.

| What | Installed | Dev run (`npm start`) |
|---|---|---|
| Settings | `%USERPROFILE%\.throng\settings.json` | `%USERPROFILE%\.throng-dev\settings.json` |
| Key bindings | `%USERPROFILE%\.throng\keybindings.json` | `%USERPROFILE%\.throng-dev\keybindings.json` |
| Themes | `%USERPROFILE%\.throng\themes\<name>.json` | `%USERPROFILE%\.throng-dev\themes\<name>.json` |
| Icon packs | `%USERPROFILE%\.throng\icon-packs\<pack>\` | `%USERPROFILE%\.throng-dev\icon-packs\<pack>\` |
| Applied-defaults marker | `%USERPROFILE%\.throng\defaults-state.json` | `%USERPROFILE%\.throng-dev\defaults-state.json` |
| Font cache, shipped default-theme source | `%APPDATA%\throng\` | `%APPDATA%\throng-dev\` |

The config folder can be moved with [`THRONG_CONFIG_ROOT`](environment.md#running-the-app).

**Shipped defaults.** throng carries an immutable, versioned record of its default settings, key
bindings and built-in themes, generated from its own definitions. Every reset reads from it. A first
run seeds the config folder from it without overwriting any file already there, and
`defaults-state.json` records which version of the defaults has been applied.
