# Quick start

A tour of throng from first launch to a working project — creating a project, laying out its
workspace, running shells, editing files, and making it yours. Fifteen minutes end to end.

If you want to know *what throng is* first, read the [README](../README.md). If you want to
*contribute* to it, read [CONTRIBUTING.md](../CONTRIBUTING.md).

## Before you start

- **Windows 11.** throng is Windows-only today; macOS ([#22](https://github.com/Bidthedog/throng/issues/22))
  and Linux ([#23](https://github.com/Bidthedog/throng/issues/23)) are planned.
- **Node.js 20 LTS**, to build and run from source. There is no installer yet — packaging is
  tracked in [#21](https://github.com/Bidthedog/throng/issues/21).

```bash
npm install && npm run build && npm start
```

`npm start` runs the background daemon and the UI together. The daemon owns your terminals, so
they keep running when the window closes — stop it with `Ctrl+C` when you're done.

## First launch

throng opens centred on your main display, with an application-drawn title bar reading
**"No project — throng"** (every window's title takes the ` — throng` suffix). The window is three panes:

| Pane | What it holds |
|---|---|
| **Left** — Projects & Sub-workspaces | Your projects, and any torn-off windows |
| **Middle** — Workspace | Tabs and panels: your terminals and editors |
| **Right** — Files & Folders | The active project's file tree |

Both side panes collapse to a narrow labelled rail — click the chevron in the pane's top-outer
corner, or press **Ctrl+B** (projects) and **Ctrl+N** (files). The middle pane never collapses.
If you make the window too narrow, throng collapses the Explorer for you, then the sidebar, and
restores them when you widen it again.

There is no onboarding tour. Everything is empty until you create a project, which is the next
step.

## 1. Create a project

A project is throng's unit of isolation: **one root folder, one colour, one workspace layout**.
Everything you do happens inside a project.

Click **+** in the Projects panel header. throng opens your OS folder picker straight away —
choose the folder you want to work in. Then:

- **Name** — auto-filled from the folder name, selected so you can type over it. Up to 120 characters.
- **Colour** — pre-seeded with one no other project is using. It's how you tell projects apart at a glance.

Projects **cannot overlap or nest**: throng refuses a folder that sits inside another project's
root, because that's the project isolation guarantee doing its job.

Once created, the project opens with a single tab ("Tab 1") holding a single empty panel
("Panel 1"), ready to be configured. If more than one project exists, you can click a project
to switch to it; **double-click its name to rename it**. Removing a project (**✕**) removes it
from throng, kills all terminals and editors for that project, but **deletes nothing on disk** — the
confirmation says so.

## 2. Lay out the workspace

The middle pane is a dock of **tabs**, each holding **panels**.

- **New tab** — the **+** on the tab strip.
- **New panel** — the **+** in any panel's header.
- **Split** — drag a panel by its header and drop it against another panel's edge; drop onto a
  panel's centre to stack it as a tab.

A new panel starts **untyped** — its body shows a **Panel Type** dropdown. Pick **Terminal** or
**Editor Panel** and press **Confirm** (or **Clear** to start over). A freshly added panel opens
in rename mode, so you can name it immediately.

Your whole layout — tabs, splits, sizes, panel names and per-panel zoom — is saved per project
and restored next time you open it.

## 3. Run a terminal

Choose **Terminal** as a panel's type and you get three fields:

- **Flavour** — the shell. throng detects what you actually have installed: **Windows PowerShell**,
  **PowerShell 7**, **Command Prompt** and **Git Bash** all appear if they resolve to a real
  executable. Your own custom flavours (defined in preferences) are listed first.
- **Startup Params** — pre-filled with that flavour's defaults; edit them if you like.
- **Run as administrator** — only available if throng itself is running elevated.

Confirm, and you have a live shell **at the project root**. The panel header shows the terminal's
**live working directory**, so you can see where a shell is even when a full-screen program hides
the prompt.

Terminals belong to the project, but are managed by the daemon, not the window. **Close throng and
they keep running**; reopen it and they reattach with their scrollback intact. Closing the app
offers you a three-way choice about what to do with them, and throng leaves no orphaned processes
behind.

Scroll the scrollback from the keyboard without touching the shell: **Shift+PageUp** /
**Shift+PageDown** by page, **Ctrl+Shift+↑** / **Ctrl+Shift+↓** by line, **Ctrl+Home** /
**Ctrl+End** to the ends.

## 4. Edit files

Click any file in the **Files & Folders** tree to open it in the last active editor panel — or
**drag a file in from Windows Explorer** and drop it onto an editor, or onto an empty panel,
which becomes an editor showing that file.

- **Save** with **Ctrl+S**; **Ctrl+Shift+S** saves all (scoped to the project); **Ctrl+Alt+S** is Save As.
- **Syntax highlighting** covers 31 languages, detected by extension. Wrong guess? Correct it from
  the **language picker** in the status strip — throng remembers your choice for that file.
- **Right-click** inside an editor for cut/copy/paste, Select All, Undo/Redo and "Set Language…".
- **Ctrl+X with nothing selected cuts the whole line**, and pastes it back *as a line*, above the caret.
- **Column select** by holding **Alt** and dragging, or **Shift+Alt+Arrow** — then type, delete,
  cut or paste across every row at once.
- **Indentation follows the file's own style** wherever it has one, so throng never quietly
  converts your tab-indented file to spaces.

Saves are confined to the project root. Unsaved changes show a pulsing dot; open the same file in
two windows and they share **one buffer and one undo stack**, so Ctrl+Z in either reverts the
other's edit. In-progress edits and their undo history survive a crash.

## 5. Find things

**Ctrl+F** opens one find bar that adapts to whatever panel is active.

- In an **editor** it finds *and replaces* — **Ctrl+H**, then **Alt+Enter** for the current match
  or **Ctrl+Alt+Enter** for all. Replace-all is a **single undoable step** and leaves the file's
  encoding and line endings alone.
- In a **terminal** it searches the retained scrollback **read-only** — it never types at your
  shell. Park on a match and the view stays there while output keeps streaming.

**F3** / **Shift+F3** jump between matches; **Escape** closes the bar.

## 6. Tear off a sub-workspace

A **sub-workspace** is a separate OS window showing panels that stay **in sync** with the project —
the tab or panel stays where it was; the sub-workspace mirrors it.

Two ways, both from the main window:

- **Right-click** a panel header or a tab → **Sync to** → **New Sub-workspace** (or an existing one).
- **Drag** a tab or panel and **drop it outside the window**. Drop it on an existing sub-workspace
  window to sync into that one; drop anywhere else to create a new one.

Sub-workspace windows carry the same title bar (without the cog) and travel as one focus group.
They're listed under Projects in the sidebar, where **⧉** opens and **✕** destroys them.

## 7. Make it yours

Click the **cog** in the title bar and choose **Settings**, **Key Bindings** or **Themes**. All
three are tabs of one preferences window that floats above throng and minimises with it. It stays
on top but **does not block the app** — keep using throng while you edit a theme and watch each
change land live.

**Changes apply immediately — there is no Save button and no restart.** Toggles and dropdowns
apply at once; typed values apply a moment after you stop typing.

- **Settings** — typeahead search matches any word you type against a setting's name, description
  or current value.
- **Key Bindings** — press-to-capture. An action can have **several** chords; each is a deletable pill.
- **Themes** — **14 bundled themes** plus your own. **Clone** is how you make one; every token has
  a plain-language label. Colour, size and icon pickers are all drawn from the theme itself.
- **Icon packs** — a `throng` glyph pack and an SVG image pack ship built in, and re-skin the whole
  application live.

Every setting, binding and theme is a **human-editable file** under `%USERPROFILE%\.throng\`
(`settings.json`, `keybindings.json`, `themes\<name>.json`, `icon-packs\<pack>\`) that **hot-reloads**
when you edit it by hand. The **UI ⇄ JSON toggle** in the preferences toolbar edits those same
files in throng's own editor.

Changed too much? Four separate scopes undo it, all reading the same shipped-defaults record:

| Control | Scope |
|---|---|
| The reset icon on a row | That one setting or binding. It appears **only while the item differs from its shipped value**, so it doubles as the "modified" cue. |
| Reset the *tab* | The whole Settings or Key Bindings editor. |
| **Reset All Preferences** | Settings + key bindings + built-in themes, atomically. **Your projects, layout, workspace state and custom themes are untouched** — the confirmation says so. |
| **Revert All Preferences** | A session undo — back to how the window looked when you opened it. Not a reset to defaults. |

## Keyboard reference

The defaults worth knowing. Every one is rebindable in **Preferences → Key Bindings**, which is
also the full list.

| | |
|---|---|
| **Ctrl+B** / **Ctrl+N** | Show/hide the Projects pane / the Files & Folders pane |
| **F11** | Full screen |
| **Ctrl+`** / **Ctrl+Shift+`** | Cycle the active panel forward / back |
| **Ctrl+Alt+Arrow** | Move focus to the panel left / right / up / down |
| **Ctrl+=** / **Ctrl+-** / **Ctrl+0** | Zoom the whole app in / out / reset (also Ctrl+Wheel) |
| **Ctrl+Alt+=** / **Ctrl+Alt+-** / **Ctrl+Alt+0** | Zoom **this panel** independently |
| **Ctrl+F** / **Ctrl+H** | Find / replace in the active panel |
| **F3** / **Shift+F3** / **Escape** | Next match / previous match / close find |
| **Ctrl+S** / **Ctrl+Shift+S** / **Ctrl+Alt+S** | Save / Save All / Save As |
| **F2**, **Delete**, **Ctrl+X/C/V** | Rename, delete, cut/copy/paste — **in the file tree** |
| **Shift+PageUp/PageDown**, **Ctrl+Home/End** | Scroll a terminal's scrollback |

Focus and zoom are **per panel**: each terminal and editor zooms on its own, on top of the app-wide
zoom, and the setting persists with your layout. Keyboard focus moves *into and out of* terminals
and editors correctly — throng intercepts its own chords ahead of the shell.

Two entries look like a clash but aren't: **Ctrl+X** is *cut file* in the tree and *cut line* in an
editor. The scopes are disjoint, so only one ever fires.

## Where throng keeps things

| What | Where |
|---|---|
| Settings, key bindings, themes, icon packs | `%USERPROFILE%\.throng\` — human-editable, hot-reloading |
| Projects, layouts, sub-workspaces | `%APPDATA%\throng\throng.db` |
| Font cache, shipped default themes | `%APPDATA%\throng\` |

Point throng at a different config directory with `THRONG_CONFIG_ROOT`. The other environment
overrides are in the [README](../README.md#configuration).

## Getting help

- Something broken, missing or unclear? [Open an issue](https://github.com/Bidthedog/throng/issues) —
  the templates tell you what to include.
- Planned work lives in the [issue tracker](https://github.com/Bidthedog/throng/issues), grouped by
  [milestone](https://github.com/Bidthedog/throng/milestones).
