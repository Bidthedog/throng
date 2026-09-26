# Changelog

What changed in each release of throng, written for someone deciding whether to take an update.

<!--
  HOW THIS FILE IS USED — it is not decoration.

  The release pipeline reads the section for the version being published and puts it at the top of
  the GitHub Release body, above the fixed footer (the unrecognised-app warning, the checksum table
  and the source commit). Publication is REFUSED, with no override, when the section for that
  version is missing, empty, or headed with a different version. See specs/042 FR-005.

  So: add to `## Unreleased` as work merges, and rename that heading to the version at release
  preparation time, BEFORE the tag is pushed. The review that matters happens on this file's diff.

  FORMAT — the parser is deliberately narrow so that it can refuse:
    - A release is an `## <exact version>` heading, optionally followed by an em-dash and a date.
    - Group entries under `### Added`, `### Fixed`, `### Changed`, `### Removed` or
      `### Known issues`. An unrecognised heading is passed through rather than dropped.
    - Entries are `-` list items, one line each, written in user terms rather than commit terms.
    - A release with genuinely nothing user-visible carries exactly one entry, the literal line
      `- No user-visible changes in this release.` Anything else that is empty is a refusal.
    - HTML comments (including this one) never reach a release body.

  The 1.0.0-alpha1, alpha2 and alpha3 sections below were RECONSTRUCTED after those releases
  shipped, from the work between their tags. They were not reviewed at the time, because this file
  did not exist yet.
-->

## Unreleased

### Added
- **Project cycling and side-pane focus chords**
  ([#332](https://github.com/Bidthedog/throng/issues/332)): **Next Project** / **Previous Project**
  (Ctrl+Shift+Alt+PageDown / Ctrl+Shift+Alt+PageUp) step through the projects you can reach from
  anywhere in the window, skipping a minimised category and stopping at either end; **Focus
  Projects** / **Focus Workspace** / **Focus File Explorer** (Ctrl+Shift+Alt+B / Ctrl+Shift+Alt+N /
  Ctrl+Shift+Alt+M, left to right) jump keyboard focus straight to the project list, back to the
  active panel in the centre workspace, or to the file tree. Focus Workspace is keyboard-only and
  changes no tab, panel or project. All five are listed, with their chords, in the Key Bindings
  editor.
- **A project right-click menu, with Unload**
  ([#411](https://github.com/Bidthedog/throng/issues/411)): right-click a project (or Shift+F10 / the
  context-menu key on a focused row) for Edit, Rename, Remove and two Unload rows — **Unload
  Project**, and one naming the other terminal action — which close a project's tabs and panels
  without forgetting its layout, category or settings. Neither row asks anything: keeping terminals
  running keeps every terminal, idle shells included, to reattach when you next load the project,
  and ending them ends every one. **Unload project: default terminal action** chooses what **Unload
  Project** does (keeps terminals running by default). Unsaved editors are still offered for saving
  first.
- **Project categories** ([#292](https://github.com/Bidthedog/throng/issues/292)): group projects in
  the Projects pane, with a default **In Progress** category that always exists, is always first,
  and cannot be deleted or minimised. **Move to Category ▸ New Category…** on a project's menu creates
  a category and moves that project into it; rename, delete, minimise or reorder one (**Move Category
  Up** / **Move Category Down**, or drag its header) from its header. A duplicate category name is
  refused, as a duplicate project name is. Drag a project between categories from anywhere on its
  row; deleting a category returns its projects to the default one.

### Changed
- "Files & Folders" is now called File Explorer
  ([#331](https://github.com/Bidthedog/throng/issues/331)). This line is exempt from the rename guard
  the rest of the docs are held to.
- **Default shortcuts follow one pattern now**: Ctrl+Shift+Alt for getting around and the whole
  window, Ctrl+Alt or Ctrl+Shift for the focused panel, one modifier for content. These moved from
  Ctrl+Alt to Ctrl+Shift+Alt: move focus (the Arrow keys) and the tab picker (T), on the same keys;
  focus the latest notice, from Ctrl+Alt+M to Ctrl+Shift+Alt+V; and show/hide the Projects and File
  Explorer panes, from Ctrl+Alt+B / N to Ctrl+Shift+Alt+J / K. An existing install is moved to
  the new defaults only where you still had the old default; a binding you changed is left alone.
- **The window zoom is Ctrl+Shift+Alt++ / Ctrl+Shift+Alt+- to step it, and Ctrl+Shift+Alt+Numpad0 —
  the numeric keypad's zero, not the main-row key — to reset it.** Plain Ctrl++, Ctrl+-, Ctrl+= and
  Ctrl+0 are no longer bound, and neither is the main-row zero on any modifier combination; there is
  no mouse route to the window reset. This is how
  [#390](https://github.com/Bidthedog/throng/issues/390)'s missing global zoom reset is answered: the
  Ctrl+Shift+0 it asked for is not shipped.
- **Ctrl+Wheel zooms the panel under the pointer**, not the whole window; **Ctrl+MiddleClick** over a
  panel resets that panel's zoom. Over the title bar or a side pane neither does anything.
- **The panel zoom resets with Ctrl+Alt+Numpad0** — the keypad zero — **Ctrl+Alt+0** on the main
  row, or Ctrl+MiddleClick. The window zoom resets only from the keypad zero.
- **Word wrap is Ctrl+E,W** — hold Ctrl, press E, then W — in place of Ctrl+Alt+W. The editor shows
  that it is waiting for the second key. A chord of up to three keys under its modifiers is written
  `Ctrl+E,W` or `Ctrl+E,W,Q` and recorded in the Key Bindings editor by pressing it the same way;
  the recording finishes when every key is up.
- **Moving into a panel moves the caret too.** Ctrl+Shift+Alt+Arrows onto an empty panel or Find in
  Files puts the caret in that panel (its type picker, its search box, or whichever control last had
  focus) instead of leaving it in the editor or terminal you left.
- **Choosing a project from the Projects list keeps focus on the list**, even when its editor or
  terminal was open earlier.
- **The focused-panel outline shows only while the centre workspace has focus.** While the Projects
  pane or the File Explorer has focus, only that pane is outlined; going back to the workspace
  outlines the same panel again.
- **Move focus (Ctrl+Shift+Alt+Arrows) works from the focused panel only**; while a side pane has
  focus it does nothing.
- **The keypad + and - are the same binding as the main-row keys**, and the Key Bindings editor
  records either as the same chord.

### Known issues
- The Ctrl+Shift+Alt chords follow the key's position, so on a few layouts they take a character
  typed with AltGr+Shift: Ń on Polish (programmer's), Ñ and Þ on US-International, Ț on Romanian
  (Programmers). Rebind the chord if you type one; the quick start's keyboard reference lists them.

## 1.0.0-beta7 — 2026-09-22

### Fixed
- **Running the portable build no longer breaks terminals in an installed throng**
  ([#429](https://github.com/Bidthedog/throng/issues/429)). The portable build deletes its
  temporary folder when it closes, but its background terminal service kept running from it, and
  the next throng to start adopted that service: every terminal then failed with "Failed to load
  native module: conpty.node". The portable build now keeps to its own service, and throng
  replaces any service whose files have been deleted instead of adopting it.

## 1.0.0-alpha6 — 2026-09-21

### Added
- **Terminal debug logging** ([#290](https://github.com/Bidthedog/throng/issues/290),
  [#162](https://github.com/Bidthedog/throng/issues/162)): with **Log level** set to `debug`
  (Settings → Logging), terminals write `[renderer-terminal]` lines to `main.log` — what each view
  was handed when it reattached, screen and mouse mode changes, where each wheel notch went,
  selections, menu copies and redraws. For diagnosing a terminal that misbehaves on one machine only;
  at the default level nothing is written and nothing is sent.

### Fixed
- **The mouse wheel works again in a full-screen terminal program after a tab or project switch**
  ([#290](https://github.com/Bidthedog/throng/issues/290)). Coming back to a terminal running a
  program that uses the mouse — Claude Code, `vim`, `less` — used to turn each wheel notch into
  arrow-key presses until the panel was resized. throng now remembers that the program owns the
  mouse while its panel is hidden.
- **Find in Files** ([#389](https://github.com/Bidthedog/throng/issues/389),
  [#391](https://github.com/Bidthedog/throng/issues/391),
  [#421](https://github.com/Bidthedog/throng/issues/421),
  [#422](https://github.com/Bidthedog/throng/issues/422)): pressing Enter straight after typing no
  longer runs the search twice; results are capped at 20,000 and locked while a search runs, with one
  notice bar for a missing scope, a scope outside the project and the cap; ✕ cancels at once, and a
  search that reaches the cap no longer freezes the window; the ✕ inside an input no longer draws a
  hover box over its border.
- **Editor gutter line numbers can no longer be selected as text**
  ([#384](https://github.com/Bidthedog/throng/issues/384)).
- **Icon controls follow the icon size setting** — the find bar buttons, the terminal retry button,
  pane collapse and the rail no longer clip or overlap their icons when `sizes.iconPx` is raised
  ([#381](https://github.com/Bidthedog/throng/issues/381)).
- **A press on a panel or tab title starts a drag**; only the interactive controls in a header or tab
  chip block one ([#406](https://github.com/Bidthedog/throng/issues/406)).
- **Clicking a fully visible row no longer scrolls the file explorer**, which also stops the first
  double-click near the bottom of a tree with two scrollbars being lost
  ([#419](https://github.com/Bidthedog/throng/issues/419)).

## 1.0.0-alpha5 — 2026-09-20

### Added
- **Clickable file links** ([#394](https://github.com/Bidthedog/throng/issues/394),
  [#198](https://github.com/Bidthedog/throng/issues/198)): a file path printed in a terminal — by a
  compiler, a test runner, `git status` — is now a link, with no cooperation from the program.
  Relative, Windows, UNC (either slash), `~`, `file://` and the Git Bash and WSL drive forms are all
  recognised, and so are paths with spaces in them (`C:\Program Files\…`), Git Bash's own `/usr`,
  `/etc` and `/tmp`, a `file:` URL however its path is spelled (`file:///c/…` included), PowerShell's
  `FileSystem::` form and relative names printed in a folder on a network share. A trailing
  `foo.ts:42`, `foo.ts:42:7` or `foo.ts(42,7)` opens the file at that line and column — from a
  terminal as from an editor, and in a tab that already holds the file — and a relative path is
  measured from the directory the shell is actually in, or the project root where the shell cannot
  report it. The same detection runs in editor documents, where a relative path is measured from the
  open file's own folder first. **A link is recognised by its text alone**: throng never checks that
  a path exists before underlining it, so drawing never waits on the disk or a network share, and a
  broken link is underlined like any other. Prose stays clear by shape — `e.g.`, `1/2`, `1.2.3` and
  host names are not paths — while any rooted path, `/help` included, is one.
- **Paths with spaces** are links when they are enclosed in backticks, quotes, `()`, `<>`, `[]` or
  `{}`, or when an unquoted path reaches a word ending in a slash or in a **known file extension**
  (`\\share\path to file.xlsx`); otherwise a path ends at its first space. The known extensions are a
  list you can edit — **File extensions that end a spaced path** under Settings → Editor → Links,
  which arrives holding the ones throng ships with — applying to terminals and editors with no
  restart. A shell **prompt** is the exception that needs no rule: `D:\git\my folder>` keeps its
  space, because throng recognises the directory the terminal is actually in.
- Hyperlinks a program emits are followable when they point at a **file or a folder**, not only at
  a web page — the report this work started from. One with an empty target or a scheme throng does
  not follow looks like plain text, and a Ctrl+click on it reaches the program.
- **A Ctrl+click does what the link names, and never runs anything or opens a file in its default
  program.** A web or `localhost` address opens in your browser. A file in the project, in any
  spelling (`file:///…` included), opens in throng — a preview or an editor by its type's default
  open action, and always an editor when the link names a line and column; if nothing is there, one
  notice says it was not found. A folder, a network path, a `file:` URL or anything else on disk
  opens in OS Explorer — a folder as itself, a file's folder with the file selected. A protocol on
  the new **Allowed link protocols** list (Settings → Editor → Links; `mailto`, `tel` and `slack` as
  shipped) goes to its OS handler, and schemes that can run code — `javascript`, `data`, `vbscript`,
  `ms-msdt`, `search-ms` and their kind — are always refused. An **email address written on its own**,
  with no `mailto:` in front of it, is a mail link too; with `mailto` off the list it is ordinary
  text, and either way it is never mistaken for a file. Handing a file to its own program is
  the Link menu's *Open in OS Default Program*, or *Open Program* for an executable, chosen on
  purpose; when throng runs as administrator, that program and OS Explorer start without
  administrator rights.
- **Ctrl+click** follows a link; **Ctrl+Enter** follows the one the caret is inside, in an editor as
  well as a preview (same command, same rebindable chord). In a terminal Ctrl+Enter still reaches the
  shell, so nothing was taken from a running program. A Ctrl+click on a link in a full-screen program
  that handles the mouse itself now opens the link **once** instead of twice.
- **Web addresses are links in editors too**, followed and offered on the menu exactly as in a
  terminal.
- **One link look everywhere**: a dashed underline at rest, so what is clickable shows without
  hovering, solid under the pointer, the text's own colour left alone, and the **hand pointer on
  every link hover**, Ctrl held or not. The underline is faint at rest and solid under the pointer.
  **Resting on a link shows its full address, and nothing else** — where a Ctrl+click would go is
  explained by the hint below instead. The same address shows at the left of the panel's status bar
  while the pointer is on it. Both name a location only when the link's text settles it: a rooted
  path such as `/tmp` or `/etc/hosts` is shown as written, because the project's own folder is tried
  before Git Bash's mount table and nothing is looked up until you follow it — so rather than name
  the wrong place, throng names none. A link the terminal wrapped across rows is marked on
  every row and followable from any of them. The two underline colours are theme tokens, **Link
  Underline** and **Link Hover Underline**, following the accent colour until set.
- **A plain click on a link** keeps its ordinary meaning and also shows a brief hint at the link's
  bottom-right saying that Ctrl+click follows it and where it will go — the same hint in terminals,
  editors and the Markdown preview, themed by **Link Hint Background**, **Link Hint Text** and **Link
  Hint Border**.
- **Terminal links are marked as the screen draws**, while output is still streaming and in
  full-screen programs such as Claude Code, and none from one screen survive a switch to the other.
- **One Link menu** on a right-click over a link, the same in terminals, editors and the Markdown
  preview: Open Link, Open In ▸ New Editor / Active Editor / each open editor by name, Open Preview,
  Open in OS Explorer, Open in OS Default Program (or Open Program for an executable) and Copy Link
  to Clipboard, with items that could never apply to that link simply absent. It opens at once;
  items that need the file light up when it is found, and stay greyed if it is not. Copy Link to
  Clipboard copies the resolved path with the position exactly as it was printed. Over a web,
  `localhost` or protocol address the menu offers Open Link and Copy Link to Clipboard.
- **Link resolution timeout** (Settings → Editor → Links; 2,000 ms as shipped, 250 – 25,000): how
  long, in total, a Ctrl+click on a network path — or opening its Link menu — waits for the location
  to answer. Nothing is looked up before a link is drawn, and a share that has failed to answer is
  left alone for a while rather than asked again on every click.
- **Detect links in editors** and **Detect links in terminals** (both on as shipped) turn links off
  entirely in that panel type — paths, web addresses, allowed protocols and the hyperlinks a program
  declares for itself alike.
- **Tell programs that links are supported** (Settings → Terminal, on as shipped) starts terminals
  with `FORCE_HYPERLINK=1`, so tools that can print clickable links do. A `FORCE_HYPERLINK` you set
  yourself is never overridden in either direction, and the setting applies to terminals started
  afterwards rather than to one already running.

### Fixed
- A folder a closed terminal started in — a git worktree, typically — can be deleted again while the
  project's other terminals stay open ([#385](https://github.com/Bidthedog/throng/issues/385)).
- A PowerShell, pwsh or Git Bash terminal that has `cd`-ed out of a folder no longer stops that folder
  being deleted ([#387](https://github.com/Bidthedog/throng/issues/387)).
- Deleting a folder you had collapsed in Files & Folders no longer raises "Couldn't list the contents
  of …" ([#386](https://github.com/Bidthedog/throng/issues/386)).
- A terminal hyperlink that wraps onto more than one row is underlined along its whole length, on
  every row, rather than only on the row under the pointer
  ([#326](https://github.com/Bidthedog/throng/issues/326)).

### Changed
- Updated the libraries throng is built on — among them Electron 43.7 and React 19 — clearing every
  known security advisory in them.
- A program's own **dashed** underline (the `4:5` underline style) is no longer drawn inside a throng
  terminal; the text shows without it. The terminal renderer gives that style and a link's underline
  the same look and offers no way to tell them apart, and throng turns it off so every link has the
  one look above.

## 1.0.0-alpha4 — 2026-09-17

### Added
- **Find in Files** ([#153](https://github.com/Bidthedog/throng/issues/153)): a search panel of its
  own, opened with `Ctrl+Shift+F` (or `Ctrl+Shift+H` with replace showing), from the explorer
  toolbar, or from any file or folder's **Open In → Search**. It searches the whole project, one
  folder or one file as you type, groups results by file or by folder, and opens a result at its
  match. Replace previews every match in place and commits one match, one file or everything; an
  open document changes as a single undoable edit, and a file with no open editor is written only
  after you confirm how many files will change.
- The find bar in an editor now belongs to that panel
  ([#220](https://github.com/Bidthedog/throng/issues/220)), so a term typed in one editor no longer
  appears in another's, and replace can be folded away without losing its text.
- Two new ways to get throng: a **portable** build that runs without installing, and a **zip
  archive** you extract to a folder of your choosing. The per-user installer is unchanged.
- **File previews** ([#10](https://github.com/Bidthedog/throng/issues/10)): an editor for a
  supported file type can open a read-only, rendered preview beside it — from its status bar, its
  right-click menu, or Files & Folders' **Open In → Preview**. It follows the editor's buffer live
  as you type, or the file on disk when opened on its own, and shares the editor's unsaved dot; a
  parented preview and its editor now scroll each other **both ways** — whichever side you scroll
  drives the other to keep pace with whatever block (heading, paragraph, list item, table row) sits
  at the top of its view, not headings alone — governed by **Synchronise preview and editor
  scrolling** (on by default), which can now also be switched from either panel's body or header
  right-click menu, a status-bar button beside each panel's Preview/Editor button, or the new
  bindable `preview.toggleSyncScroll` command (ships with no chord). Markdown ships as the first
  provider — headings, tables, task lists, fenced and syntax-highlighted code, YAML front matter
  as a table (hideable with the provider's own **Show front matter** setting), and Ctrl+click-able
  links, sanitised and themed throughout — with its own preferences under **Editor → Previews**,
  including a **default open action** that can make Preview open on a click. Preview body text is
  selectable and copyable, hovering or focusing a link shows its full target at the left of the
  preview's status bar, and hovering an image shows its source and title as written in the
  Markdown. **Copy Link Address** on a preview copies a heading or file link's full path rather
  than a bare fragment. Built as a provider seam, so the next file type
  ([#388](https://github.com/Bidthedog/throng/issues/388), PDF) is one provider to add, not a new
  feature.
- **Back and Forward for editor and preview panels**
  ([#136](https://github.com/Bidthedog/throng/issues/136)): every editor and preview panel now
  keeps its own history of the files it has shown, with Back/Forward buttons at the top left of
  its title bar, `Alt+Left` / `Alt+Right`, and mouse back/forward buttons. History persists across
  restarts, and how many entries each panel keeps is configurable under **Editor · Navigation**.
  In a preview, following a link to a heading in the same document is a step of that same history
  too — Back returns to where the reader was, then to the previous document, if there was one.

### Fixed
- Terminals could freeze, and on an elevated install all close, when Windows reused a process id
  inside a terminal's process tree ([#398](https://github.com/Bidthedog/throng/issues/398)).
- An edit typed into the Preferences JSON view while it was still opening was silently lost
  ([#399](https://github.com/Bidthedog/throng/issues/399)).
- Undoing a delete now restores the file when Windows hides known file extensions — the default —
  and restores the file you asked for rather than a same-named one with a different extension
  ([#373](https://github.com/Bidthedog/throng/issues/373)).
- A key pressed while a terminal was being rebuilt after a tab switch, and the typing after it, no
  longer vanishes ([#374](https://github.com/Bidthedog/throng/issues/374)).
- Windows PowerShell terminals keep PSReadLine's colouring, history search and completion when
  throng was started from PowerShell 7 ([#367](https://github.com/Bidthedog/throng/issues/367)).
- **Open in OS Explorer** on a panel now reveals that panel's own file, including in a
  sub-workspace window and for a file outside any project.
- Restoring a project whose folder had been renamed away now always raises its consolidated notice,
  however slowly the panels answer.
- The setting that confirms destroying a tab is now labelled as destroying, not closing, a tab.
- A preview's body text can now be selected with the mouse and copied, the same as an editor's;
  holding Ctrl to drag from a link selects text without following it.
- The **+** buttons that add a tab and add a panel are announced by a screen reader as "New tab" and
  "Add panel" rather than as "plus".
- A command that opens a window — `az login`'s sign-in prompt, a browser-based login, a GUI editor —
  now brings that window to the front, instead of leaving it behind throng where the terminal looks
  like it has stopped responding. The same handoff now applies to a web link Ctrl+clicked in a
  terminal or opened from the About window: the browser it opens is left in front rather than
  reclaimed by throng.
- When the tab strip overflows, the ‹ and › arrows now work whenever there is more strip in that
  direction, including when the first or last tab is only partly cut off. A tab you go to is shown
  whole rather than partly hidden under the edge fade, and the arrows no longer react to a
  right-click.

### Changed
- Release notes now say what actually changed in each release, above the download checksums and the
  installation guidance that were previously the whole of the release body.
- Every published download is listed with its own SHA-256, against its own filename.
- The **+** at the end of the tab strip is drawn as a tab: it meets the line beneath the tabs
  instead of floating above it as a rounded square, and its glyph sits centred within it.

## 1.0.0-alpha3 — 2026-08-30

### Added
- The editor status bar now reports cursor position, selection size and document length, and the
  gutter can be turned on or off from Settings.
- Terminals reconnect on their own when a working directory that had gone away comes back, and a
  terminal can be reloaded from its panel menu or automatically, controlled by four new settings.
- New Panel now takes its defaults from your preferences rather than from a fixed built-in.

### Fixed
- A single problem now raises a single notice, carrying one row per affected panel, instead of the
  same condition being reported in up to three different places with three different wordings.
- Clicking a notice no longer activated the control underneath it.
- A dormant terminal placeholder now shows the panel's own name and is styled like the rest of the
  panel, and its Reload item is where it can actually be used.
- A terminal preference could out-rank the elevation gate; it is a seed, and it no longer overrides
  the gate.
- Panel names in the popover now match what the panels call themselves, and the popover marks each
  panel's type.
- A cleared rename box now restores the automatic name rather than leaving the panel unnamed.
- Editing a file whose path disappeared is reported rather than failing silently, and a failed
  recovery snapshot now surfaces instead of being discarded.
- Preferences no longer accept an edit before the configuration has finished loading, and a
  configuration read can no longer be broadcast after a write has overtaken it.

## 1.0.0-alpha2 — 2026-08-20

### Added
- **Quick Open** and **Go To Line**, with a project-wide file index behind them and a toggle for
  whether hidden and excluded files are listed.
- A rebuilt notice system: notices say what they are about, group by cause rather than by the panel
  that hit them, carry the whole of an error rather than a summary, and you decide whether and for
  how long each appears.
- A reworked tab strip — per-tab actions, a shared picker, bounded names, and a strip that no longer
  takes its height out of its own tabs.

### Fixed
- Keystrokes now reach the terminal in the order they were typed.
- throng uses the ConPTY it ships with rather than whichever one the machine happens to have, which
  fixes terminal behaviour that differed between machines.
- A settings write could race the file watcher and lose the change.
- An upgrade could rewrite every user's settings file.
- Tabs were clipped even when inactive, and several dialog and overlay defects that could show two
  overlays at once or blank a list mid-interaction.

## 1.0.0-alpha1 — 2026-08-06

The first published build of throng: a project-first terminal and editor workspace for Windows.

### Added
- A per-user installer that needs no administrator rights and installs nothing machine-wide.
- Dockable panes, tabs and panels, with drag, tear-off and sub-workspace windows.
- Terminals with automatic shell detection, detached sessions that survive the window closing, and
  reattachment when it reopens.
- A code editor with syntax highlighting, find and replace, and recovery of unsaved work.
- A project file explorer with full file operations and an undo history.
- A visual preferences editor covering every setting, key binding and theme token, plus fourteen
  shipped themes.

### Known issues
- Downloads are not code-signed, so Windows shows an "unrecognised app" warning on every download.
  The release notes explain how to get past it and how to verify the download against its checksum.
