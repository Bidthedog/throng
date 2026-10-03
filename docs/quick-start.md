[throng](../README.md) › [Docs](README.md) › Quick start

# Quick start

A whistle-stop tour of throng, from first launch to a working project. Ten minutes, and you will
know your way around. Every chord mentioned is rebindable; the full list is in
[key bindings](key-bindings.md), and every setting in [preferences](preferences.md).

## Before you start

Install throng from a download, or run it from a clone — both are in
[installation](installation.md). It runs on Windows 11.

## First launch

throng opens as one window with three panes:

| Pane | What it holds |
|---|---|
| **Left** — Projects | Your projects, their categories, and any torn-off windows |
| **Centre** — Workspace | Tabs of panels: terminals, editors, previews, searches |
| **Right** — File Explorer | The active project's file tree |

Collapse either side pane to a rail with its chevron, or **Ctrl+Shift+Alt+J** (left) and
**Ctrl+Shift+Alt+K** (right). Jump focus between them, left to right, with **Ctrl+Shift+Alt+B**,
**N** and **M**. Whichever pane has focus wears the outline.

Everything is empty until you create a project.

## 1. Create a project

A project is **one root folder, one colour, one workspace**. Click **+** in the Projects header,
pick a folder, and accept or change the suggested name and colour. Projects cannot overlap or nest.

- **Switch** by clicking a project, or with **Ctrl+Shift+Alt+PageDown** / **PageUp** from anywhere.
  Choosing from the list keeps focus in the list, so the arrow keys and **Enter** carry on there.
- **Right-click a project** (or **Shift+F10**) for Edit, Rename, Remove, **Move to Category ▸** and
  **Unload**, which closes its tabs without forgetting them — its terminals keep running, or end,
  as the row says.
- **Categories** group projects; every project starts in **In Progress**. Create one from Move to
  Category ▸ **New Category…**, then rename, minimise, reorder or delete it from its header's menu.
  Drag a project by its row to move it.

Removing a project from throng never deletes anything on disk.

## 2. Lay out the workspace

The centre pane is a dock of **tabs**, each holding **panels**.

- **New tab** with **+** on the tab strip.
- **Split a panel** with the **+** in its header: choose **Split Down**, **Up**, **Right** or
  **Left** and a new empty panel appears on that side. The same four are under **Split** in the
  panel's right-click menus, and from the keyboard press
  [Ctrl+Shift+Alt+End](key-bindings.md#focus--zoom), then an arrow.
- **Rearrange** by dragging a panel's header onto another panel's edge; drop on its centre to stack
  it. Drag it to the very edge of the panel area instead and it runs the **whole** length of that
  side — a full-height column or a full-width row, a third of the area. Where two edges meet, the
  left or right edge wins. **Esc** during a drag cancels it.
- **Crowded strip?** It scrolls, with arrows either side, and **▾** or **Ctrl+Shift+Alt+T** opens a
  picker that finds any tab by name.
- A new panel starts **untyped**: choose what it is from its **Panel Type** drop-down and press
  **Confirm**.
- Panels name themselves after what they show; an empty one is a **Blank Panel** until you give it something.

Move between panels with **Ctrl+Shift+Alt+Arrows** — the caret goes with you, into whatever you land
on. Your whole layout, splits, sizes and zoom included, is saved per project and restored next time.

## 3. Run a terminal

Make a panel a **Terminal** and choose its **flavour** — Windows PowerShell, PowerShell 7, Command
Prompt, Git Bash, or one of your own — with optional shell arguments and a startup command such as
`npm run dev`. Confirm, and you have a live shell at the project root.

- **Terminals outlive the window.** A background service owns them, so closing throng leaves them
  running; reopen it and they reattach with their scrollback. Closing asks what to do with any still
  busy.
- **Paths and links are clickable.** A compiler's `src/foo.ts:42:7`, a URL, a hyperlink a program
  prints — **Ctrl+click** follows it (a project file opens in throng at that line; a web address in
  your browser), and **right-click** offers every other place it could open. Nothing is ever run by
  a click.
- **Find in the scrollback** with **Ctrl+F**; it searches read-only and never types at the shell.
- **Something wrong?** A terminal that cannot start says why on the panel and offers **Try again**;
  if the background service stops, a **↻** in the status bar restarts it.

## 4. Edit files

Click a file in the **File Explorer** to open it in the last active editor, or drag one in from
Windows Explorer. The panel it opens in flashes briefly, and the keyboard stays in the tree, so you
can keep browsing or press **F2** to rename the file.

- **Move and copy files between projects** with [Cut, Copy and Paste](key-bindings.md#file-explorer)
  in the tree: cut or copy in one project, switch, and paste in another. The Paste menu item names
  what will land and which project it came from. Items picked from different folders keep their
  folder structure where they land.
- **A name that is already taken** asks first — **Replace**, **Skip** or **Keep both** — and a
  replaced item goes to the Recycle Bin unless [When Paste replaces an item](preferences.md#file-explorer)
  says otherwise.
- **A large paste** (over 5 MB) that takes more than a moment shows its progress with a Cancel button; cancelling asks whether to keep what has
  landed or roll the whole paste back. **Ctrl+Z** undoes a move between projects from either one.

- **Save** with **Ctrl+S**, **Save All** with **Ctrl+Shift+S**, **Save As** with **Ctrl+Alt+S**.
- **31 languages** are highlighted; the language picker in the status bar corrects a wrong guess.
- The status bar shows the caret's position, the selection and the document's size.
- **Column select** with **Alt+drag** or **Shift+Alt+Arrow**; **Ctrl+X** with nothing selected cuts
  the whole line.
- **Word wrap** is the held chord **Ctrl+E,W** — hold Ctrl, press E, then W.
- The same file open in two places is **one document**, with one undo history, and unsaved edits
  survive a crash.
- **Preview** a Markdown file beside its editor from the status bar's preview button; it follows your
  typing and scrolls with the editor. With **Default open action** set to Preview, clicking notes in
  the tree reuses the preview you already have ([Open previews in](preferences.md#previews)), and you
  can drop a `.md` file onto a preview to show it there — or onto an empty panel, which opens it the
  way **Default open action** says. Right-click a note and choose **Open In › Last Preview Panel** to
  show it in the preview named beside the item, or **New Preview Panel** for a fresh one.
- **Fold** a Markdown document's sections from the gutter beside each heading, the right-click menu,
  or **Ctrl+M** chords ([Markdown bindings](key-bindings.md#markdown)); an editor and its preview fold
  together.
- In a preview, **Ctrl+G** opens **Go to Heading** — type to filter, Enter to jump — and
  `[[wikilinks]]` follow like any other link.
- **Back** and **Forward** (**Alt+Left** / **Alt+Right**) step through the files a panel has shown.

## 5. Find things

- **Ctrl+F** finds (and in an editor, **Ctrl+H** replaces) inside the active panel — an editor, a
  terminal's scrollback, or a Markdown preview's rendered text. Every match is outlined, and the one
  you are on is filled more strongly.
- **Ctrl+Shift+F** searches every file in the project as you type; **Ctrl+Shift+H** adds replace,
  one match, one file or everything at once. Right-click a folder in the tree to search just there.
- **Ctrl+Shift+T** is **Quick Open**: type any part of a name or path to jump to a file.
- **Ctrl+G** goes to a line in the active editor.
- Right-click a folder in the tree to open a terminal there, or to expand or collapse its children.

## 6. Tear off a sub-workspace

Drag a tab or panel out of the window, or right-click it and choose **Sync to ▸ New
Sub-workspace**. It opens in its own window, kept in sync with the project, and every throng window
comes to the front together. Sub-workspaces are listed under Projects, where you reopen or delete
them.

## 7. Make it yours

The **cog** in the title bar opens **Settings**, **Key Bindings** and **Themes** — tabs of one
preferences window that applies changes as you make them and can reset anything to its default.

- [Preferences](preferences.md) lists every setting and what it does, with themes and icon packs.
- [Key bindings](key-bindings.md) lists every chord, how they are laid out, and how to record your
  own — including multi-key chords such as `Ctrl+E,W`.
- Everything is also a human-editable file that reloads live; where each lives is in
  [preferences](preferences.md#where-the-files-live).

## Getting help

- Something broken, missing or unclear? [Open an issue](https://github.com/Bidthedog/throng/issues);
  the templates say what to include.
- How throng is built: [architecture](architecture.md). How to contribute:
  [CONTRIBUTING.md](../CONTRIBUTING.md).
