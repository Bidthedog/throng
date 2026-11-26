# Page plan: the throng user guide

**Feature**: [spec.md](spec.md) (FR-004, FR-004a)

**Source**: an index of every user-visible feature in the app, taken on 2026-11-24 across the shell and
layout, terminals, editing, previews and find, the File Explorer, projects, preferences, configuration
and installation (about 400 features).

The guide is **user directions**. Each page covers one area of work. Each section below is **one task**,
headed in the user's words, and its page gives numbered steps for doing it. Features are not listed for
their own sake: each is taught inside the task that uses it, and the notes after a task name the
features that task must cover. Platform differences go inline in the step they change.

The guide map (FR-004a) is generated from this plan and is then the source of truth. A task added to the
map must be added here only while this spec is open.

## 1. Intro

The guide's start page, an introduction to throng. What it is for, then its main features at a high
level, each in one line linking to the page that teaches it, and a prominent link to Quick start.

## 2. Quick start

Replaces `docs/quick-start.md` (FR-003a): the short tour a new user follows first.


| Task | Covers |
|---|---|
| Install throng | Points at the install guide for your system; finding your version in About |
| Find your way around the window | Projects pane, workspace, File Explorer and Notifications; title bar; status bar; the cog menu |
| Add your first project | **+**, folder picker, name, colour |
| Open a terminal in your project | Panel Type → Terminal, flavour, Confirm |
| Open and edit a file | Click in the tree, edit, Ctrl+S |
| Split the workspace and add a tab | Header **+**, Split Right; tab-strip **+** |
| Where to go next | Links into the pages below |

## 3. Projects

| Task | Covers |
|---|---|
| Add a project | **+**, folder picker, starting folder setting, overlap and nesting refused |
| Open a folder as a project from your file manager | Windows Explorer item, Nemo/Dolphin/GNOME, macOS Dock and Open With, File Manager toggle in Preferences |
| Open a folder as a project from the command line | `throng <path>`, a running copy takes it over, switch or only load |
| Switch between projects | Click, Enter, `project.next` / `project.previous`, spinner |
| Rename a project, change its colour or move its folder | Double-click, Edit, project popover |
| Group projects into categories | Move to Category, New Category, In Progress default |
| Fold, rename, reorder and delete categories | Category menu, drag a header, folded categories keep loaded projects |
| Reorder your projects | Drag by row or grip, across categories, Esc cancels |
| Unload a project you are not using | Unload Project, keep or end its terminals, the default setting |
| Remove a project | Remove, confirmations, nothing deleted on disk |
| Open a project's folder or copy its path | Open in OS Explorer, Copy Path ▸ |
| Hide files in one project, or keep them out of its searches | Project settings dialog from the File Explorer cog, Hide in this project, Exclude from Find in Files; un-hiding |
| Read a project's row at a glance | Active fill, unloaded dimming, unsaved dot, attention mark, count pills |

## 4. Tabs, panels and layout

| Task | Covers |
|---|---|
| Understand panes, tabs and panels | What each holds; layout saved per project |
| Choose what a panel shows | Blank panel, Panel Type, Confirm, Clear panel type |
| Add, rename, reorder and close tabs | **+** and its position setting, double-click, `tabs.rename`, drag, armed close button, Destroy other tabs |
| Find a tab when you have many | Overflow chevrons and their counts, tab picker (`tabs.openPicker`), tab popover |
| Split a panel | Header **+**, Split ▸, `panel.split*`, split mode chord |
| Resize panels and side panes | Dividers, side-pane width and its maximum, stacked side panels |
| Rearrange panels by dragging | Dock on an edge or the centre, outer-edge bands, hover a tab to drop inside it, Esc cancels |
| Move a panel to another tab | Send to Tab ▸, drop on a tab or on **+** |
| Concentrate on one panel | Focus Mode (`panel.toggleMaximise`), badge, what it locks, side panes during it |
| Zoom text in panels or the whole window | `panel.zoom*`, Ctrl+wheel, Ctrl+middle-click, zoom indicator, `zoom.*`, fullscreen |
| Show and hide the side panes | Pane buttons, rails and their summaries, `view.toggleProjects` / `view.toggleExplorer`, auto-collapse on a narrow window, remembered per project |
| Move around with the keyboard | `focus.*`, `focus.cycle`, `menu.open`, context-menu keys |
| Close a panel | Destroy Panel, Close for previews and mirrored panels, confirmations |
| Read a panel's header | Type icon, title, file pill, unsaved dot, mark, ADMIN, owner; controls that give way when narrow |
| When a panel fails | Failure banner: Try again, Copy details, Clear panel type |

## 5. More windows: sub-workspaces

| Task | Covers |
|---|---|
| Tear a tab or panel off into its own window | Drag beyond the window edge, ghost window |
| Show a tab or panel in another window as well | Sync to ▸, "Belongs to <project>", Close vs Destroy |
| Create and name a sub-workspace | **+** in Sub-workspaces |
| Reopen, rename, recolour, reorder or destroy a sub-workspace | Row buttons, double-click, swatch, grip, double confirmation |
| Know how windows behave | Each window comes forward on its own; closing the main window closes the others; sizes and positions remembered; macOS close hides |

## 6. Terminals

| Task | Covers |
|---|---|
| Open a terminal | Panel Type → Terminal, from the tree (Open In ▸ Terminal), "no shells detected" |
| Choose your shell | Auto-detected flavours per system, login shell first on Linux and macOS, hide built-ins |
| Add a shell of your own, including WSL | Custom terminal flavours, default shell arguments |
| Run a command when the terminal starts | Startup Command, Shell Arguments, the shell stays open |
| Reuse what you typed before | Form history, Delete forgets one, ✕ forgets all, clearing it in Preferences |
| Change how a terminal is set up | Exit the shell, the form returns filled in, edit, Confirm |
| Reopen in the folder you were last in | Toggle on form, status bar and menu; shell integration for PowerShell; missing-folder fallback |
| Pick up where you left off, including Claude Code sessions | Remember the last running command, recovery after a crash, "Command not remembered" |
| Give terminals useful names | Title templates and placeholders, programs that set their own title |
| Copy, paste and drop paths | Right-click Copy (Ctrl+C stays interrupt), paste chords per system, no middle-click paste, drag from the tree, programs writing to the clipboard |
| Search what scrolled past | Find in scrollback, F3 / Shift+F3 |
| Scroll, and know which keys reach the shell | `terminal.scroll*`, PageUp/PageDown at a prompt, full-screen programs own their keys, wheel in full-screen programs, Shift+Enter, word editing, reserved keys, Option as Meta |
| Follow links in terminal output | Ctrl+click, the link menu, relative paths, status-bar readout, turning detection off, telling programs links work |
| Clear and redraw | `cls`/`clear` drop scrollback, Refresh / redraw |
| Keep terminals running after you close throng | Background service, reattach with scrollback, the close prompt and its details |
| Start terminals only when you ask | Manual reload mode, Reload button |
| Run a terminal as administrator (Windows) | Only when throng is elevated, unticked terminals run normally, [ADMIN] title; no elevation on Linux or macOS |
| Read the terminal status bar | Flavour, link target, the three toggles and how they look |
| When a terminal will not start | Still starting / Retry, failure banner, auto-retry when the folder returns, exit notices |

## 7. Knowing when something needs you

| Task | Covers |
|---|---|
| See which panels need you | Marks on panel, tab, project and category; counts; Failed marks; popovers; collapsed rails |
| Choose what raises a mark | Terminal › Attention signals: program exited, command finished, bell, program notification, progress, unseen output, quiet output |
| Jump to the next panel that needs you | `focus.nextMarkedPanel`, Go to Next Marked Panel on a project |
| Flag a panel as a reminder | Flag, how it clears |
| Silence one terminal | The per-panel notifications toggle |
| Read and act on notifications | Toasts, pausing on hover, sticky toasts, go to the panel, `focus.notice` |
| Keep, order and clear the Notifications panel | Order, Dismiss, Dismiss all, Copy, limit warning, minimise |
| Get notified outside throng | OS notifications, Windows taskbar badge |
| Choose what each kind of notice does | Notifications settings per type |

## 8. Files

| Task | Covers |
|---|---|
| Browse your project's files | Tree, expand and collapse, keyboard, sort order, follow the active editor, live updates, path popover |
| Select several files | Ctrl-click, Shift-click |
| Open a file | Single, double or never click, Enter, which panel it opens in, files throng cannot open |
| Create, rename and delete files and folders | New File, New Folder, F2, Delete and the delete mode |
| Move or copy files by dragging | Modifiers, the copy/move label, dropping onto panels and terminals |
| Cut, copy and paste, including between projects | Clipboard, Esc cancels, open editors follow moved files |
| Choose what happens when a name already exists | Clash prompt, Apply to all, replace mode |
| Follow and cancel a large paste | Progress toast, queue, Keep finished or Roll back, quitting during a paste |
| Undo and redo file changes | `file.undo` / `file.redo`, per project, across restarts, from the Recycle Bin / Trash, what cannot be undone |
| Work with your system's file manager | Copy and paste both ways, drag in and out, Wayland and XWayland, the elevated-drop notice |
| Look at a file's properties and folder sizes | Properties dialog, live sizes, copy rows, per-system rows and buttons |
| Hide files from the tree | Excluded globs for all projects, Hide in this project |
| Start a terminal, preview or search from a folder | Open In ▸, Search ▸, Copy Path ▸, Expand/Collapse All Children |
| When a file will not move, rename or delete | Locked and held-file notices, the project folder held open on Windows, macOS privacy prompts |
| Recognise files at a glance | File icons, special folders, link badges, unsaved dots |

## 9. Editing

| Task | Covers |
|---|---|
| Save your work | Save, Save As, Save All and its scope, auto-save, unsaved dots |
| Close or switch files with unsaved changes | Close prompt, open-into-dirty prompt, Revert |
| Set the language of a file | Detection by name and extension, Set Language, Reset Language, extension mapping |
| Indent, and control tabs and spaces | Tab / Shift+Tab, detection, per-language rules |
| Edit several places at once | Ctrl+click cursors, column selection by Alt+drag or chord |
| Cut and copy whole lines | No selection takes the line, `editor.cutLine` |
| Wrap lines and show invisible characters | Word wrap, View Whitespace, hover names |
| Change encoding or line endings | Status bar and menus, Reopen with Encoding, misread notice, save refusal |
| Fold Markdown sections | Gutter arrows, Outlining menu, `markdown.*` chords, shared with the preview |
| Jump to a line | Go To Line |
| Follow links in your files | Ctrl+click, link menu, hint, refused schemes |
| Go back to where you were | Back / Forward, mouse buttons, history across restarts, scroll position |
| Read the editor status bar | Position, selection, counts, link target, Open Preview |
| When a file changes on disk or goes missing | Changed-on-disk notice, Reload from disk, missing file banner, moved and replaced notices |
| Get your work back after a crash | Unsaved edits and undo history kept |
| Open the same file in two panels | One document, one undo history |
| Print a file | Print Preview from the editor |

## 10. Finding things

| Task | Covers |
|---|---|
| Open any file by name | Quick Open, this editor or a new one, including excluded files, last query |
| Find and replace in a file | Find bar, match case, whole word, next and previous, Replace, Replace All, matches in folded sections |
| Find in a preview or a terminal | Read-only find, which previews support it |
| Search the whole project | Find in Files, as you type or on Run, grouping, collapse and expand, opening results, status line |
| Replace across files | Replace in Files, per file and per match, the warning before an irreversible replace |
| Narrow a search | Folder scope, match options, global exclusions, Also exclude, per-project exclusions |

## 11. Previews

| Task | Covers |
|---|---|
| Open a preview of a file | Status bar, menus, `preview.open`, drop a file |
| Choose what opens when you open a file | Editor, preview or system program per file type; which preview panel it uses |
| Keep a file and its preview in step | Live updates, synchronised scrolling, Go to Editor |
| Move around a preview | Go to Heading, Page or Row; heading links; Back / Forward; middle-drag scrolling; zoom |
| Copy from a preview | Copy format, Rich and Plain text, Copy Path, Copy Image |
| Print a preview or save it as a PDF | Print Preview window and its options, paging, Save as PDF |
| When a preview cannot show a file | Notice banner, Refresh, size limits, turning a preview type off |

## 12. Markdown

| Task | Covers |
|---|---|
| Write Markdown and see it rendered | Tables, links, raw HTML, details, code colouring, occurrence highlighting |
| Tick off task lists | Checkbox toggles edit the file |
| Add callouts | Obsidian `[!type]`, folding |
| Write maths | Inline, display and fences; errors on hover |
| Draw diagrams with Mermaid | Fences, `height=`, `.mmd` files, embeds, frame controls, copy as image |
| Link notes together | Wikilinks, aliases, headings, block references, vault-root paths |
| Add and size images | Embeds, sizes, remote images, framed pictures |
| Show front matter | Front matter table |

## 13. CSV files and spreadsheets

| Task | Covers |
|---|---|
| Edit a CSV file as a grid | Shared document, save, undo, auto-save |
| Move around and edit cells | Keys, Enter / F2 / double-click, Delete, select all |
| Insert rows and columns | Above, below, left, right, copied rows and columns |
| Copy and paste cells | Tab-separated, Rich and Plain, Clear Cells, fill-paste |
| Set column widths and edit long cells | Column Width, fit by double-click, cell dialog and its settings |
| Keep headers in view and wrap text | Lock first row and column, Wrap |
| Fix a CSV that will not parse | Unbalanced-quotes notice, Open in Editor |
| Read a spreadsheet | Read-only workbooks, sheets, formula values |

## 14. Images, PDFs, SVG and HTML

| Task | Covers |
|---|---|
| View an image | Fit or 100%, transparency hatch, zoom and pan |
| Read a PDF | Page layouts, zoom, text selection, links, Go to Page |
| View an SVG | Static drawing, follows edits |
| Preview an HTML page | Sandbox, live update, links, Find, Copy |
| Allow remote content in an HTML preview | Blocked-sources notice, Allow this source, per-project safe sources |

## 15. Preferences

| Task | Covers |
|---|---|
| Open Preferences | Cog menu, `app.settings`, opening at a section from a notice |
| Find a setting | Search, folding, Expand / Collapse All |
| Change a setting | Applies at once, number controls and units, refusal notices |
| Undo a change, or go back to the default | Revert, Reset, Clear; toolbar Revert All and Reset All |
| Edit lists and tables | List editor window |
| Edit the settings as JSON | JSON view, invalid values, Discard, external-change conflict |
| Edit config files by hand | Where they live on each system, hot reload, out-of-range values, unreadable files |
| What happens to your settings on upgrade | Shipped defaults never overwrite yours |

## 16. Themes and icons

| Task | Covers |
|---|---|
| Choose a theme | Picker, the bundled themes |
| Make your own theme | Clone, edit tokens, Rename, Delete, Revert, Restore |
| Check a theme is readable | WCAG AA mark |
| Choose and customise icons | Icon sets, new set, override one icon, reset, reload, backup notice |

## 17. Key bindings

| Task | Covers |
|---|---|
| Find the shortcut for something | Key Bindings tab and search; hover titles show chords |
| Change a shortcut | Chord capture, clashes and Reassign, removing a chord |
| Use two-key chords | The waiting indicator, prefixes |
| Know which keys always reach your shell | Reserved keys, macOS differences |

## 18. Watching resources

| Task | Covers |
|---|---|
| See what throng is using | Status-bar figures, colours, popover |
| Find what is using the most | Resource Monitor, filter, order, drill-down, breadcrumb, detail pane |
| Stop something that is running away | Kill Process, Kill All Below, Unload, Destroy, confirmations |
| See which folders throng is holding | Held folders |
| Read the figures | Liveness line, "-" and "~", help helpers, capture interval |

## 19. Troubleshooting

| Task | Covers |
|---|---|
| The background service has stopped | Status-bar indicator and restart, notices |
| A terminal will not start | Links to § Terminals › When a terminal will not start |
| A file will not move, rename or delete | Links to § Files |
| Live updates stopped (Linux) | inotify limit advice |
| throng says another copy is running | Single instance, different-copy notice |
| throng says a newer version is installed | Restart notice, what it does to terminals |
| throng will not start as root | Refusal on Linux and macOS |
| Find the logs | Open Logs Folder, log detail setting |
| Report a problem | Logs, version from About, the issue tracker |

## 20. FAQ

Short answers that link to the task that settles each one: is there auto-update (no; how upgrades
arrive), are my files deleted when I remove a project (no), do terminals keep running when I close
throng (yes, unless you choose), where are my settings, can I run several copies, what is a sub-workspace,
why does Ctrl+C not copy in a terminal.

## Excluded from the guide

Recorded in the guide map with these reasons:

| Item | Reason |
|---|---|
| DevTools toggle | Development builds only |
| Another checkout's daemon warning | Development scenario |
| Orphan-process and conhost cleanup | No user action; nothing to direct |
| Running from source, dev instance, test-only environment variables | Contributor material in `docs/installation.md` and `docs/environment.md` |
| Installation detail (installers, MSI properties, unattended installs, repositories) | Stays in the install guides; § Quick start links to them |

## Docs that contradict the code

Found by the index; corrected in stage 1 (FR-022a). The two `docs/quick-start.md` rows are corrected in
the guide's Quick start page, which replaces that file (FR-003a).

| Doc | Says | The app does |
|---|---|---|
| `docs/quick-start.md` § 6 | Every throng window comes to the front together | Focusing a window raises only that window |
| `docs/quick-start.md` § 4 | CSV row and column menus insert and delete | There is no Delete Row or Delete Column item |
| `docs/preferences.md` § Resetting | The reset icon appears only while the item differs | Revert, Reset and Clear always show, disabled with a reason |
| `docs/key-bindings.md` § Rebinding | Same claim | Same |
| `docs/preferences.md` § Where the files live, § Logging | Windows paths only | Linux and macOS paths exist and are given only in the install guides |
