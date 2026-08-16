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
corner, or press **Ctrl+Alt+B** (projects) and **Ctrl+Alt+N** (files). The middle pane never collapses.
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

**When there are more tabs than fit.** The strip never grows a scrollbar and the tabs never change
height or shift up — it scrolls instead, and three controls appear between the tabs and the **+**:

| Control | What it does |
|---|---|
| **‹** | Step one tab left. Its pill counts the tabs hidden off the left edge |
| **›** | Step one tab right. Its pill counts the tabs hidden off the right |
| **▾** | Open the tab picker. Its pill counts *all* tabs |

Press and hold either chevron and the strip starts scrolling continuously; releasing stops it. A
fade over the edge of the first and last visible tab marks that there is more in that direction. The
**+** stays pinned on the right at every tab count, and the active tab is always scrolled into view —
however it became active.

**The tab picker** (**▾**, or **Ctrl+Alt+T** from anywhere, at any tab count) lists every tab, hidden
or not. Type to narrow it: the terms match in **any order** and anywhere in the name, so `find file`
finds "file find.txt" as readily as "find any file.md". Choosing a tab scrolls the strip to it and
makes it active; **Escape** dismisses without moving anything.

**On each tab.** The number of panels shows as a pill. Resting the pointer on a tab brings up a
popover naming the tab and listing its panels one per line — resting, not merely crossing, so it
stays out of your way while you traverse the strip. Right-clicking hides the popover so it cannot sit
on top of the menu it just opened.

Each tab also carries a **×** that runs the ordinary **Destroy Tab** action, with the same
confirmations. It is inert for a moment after appearing, so a click cannot land on a tab the pointer
was only passing over, and it never arms at all while you are dragging something across the strip.

**Names have a limit** — long ones are shortened for display only, never in storage, and always on a
whole character, so an emoji or an accented letter is never cut in half. Lower the limit and raise it
again and your full names come back.

Every one of these — the scroll animation, the picker, the delays, the name limit, the widest a tab
may be drawn, and whether **+** opens beside the active tab or at the end — is under **Settings →
Tabs**.

A new panel starts **untyped** — its body shows a **Panel Type** dropdown. Pick **Terminal** or
**Editor Panel** and press **Confirm** (or **Clear** to start over). A freshly added panel opens
in rename mode, so you can name it immediately.

**What a panel is called.** A panel names itself after whatever is inside it: a terminal shows its
shell's window title (and, until the shell announces one, the flavour you chose), an editor shows
its file's name without the extension. "Panel 3" is what an **untyped** panel is called, and only an
untyped one. Type a name yourself — **F2**, double-click the header, or **Rename** in its right-click
menu — and your name wins from then on, through a change of file or shell and across a restart;
**Reset Name** in the same menu hands the panel back to naming itself, and is offered only on a panel
you actually renamed. Names are unique across the whole application, so if one is already taken by a
panel in another project or sub-workspace, throng adjusts it and tells you once.

Your whole layout — tabs, splits, sizes, panel names and per-panel zoom — is saved per project
and restored next time you open it.

## 3. Run a terminal

Choose **Terminal** as a panel's type and you get these fields:

- **Flavour** — the shell. throng detects what you actually have installed: **Windows PowerShell**,
  **PowerShell 7**, **Command Prompt** and **Git Bash** all appear if they resolve to a real
  executable. Your own custom flavours (defined in preferences) are listed first.
- **Shell Arguments** — arguments passed to the shell itself, pre-filled with that flavour's
  defaults (`-NoLogo`, `/K`, `-i -l`); edit them if you like.
- **Startup Command** — a command the shell *runs* when the terminal starts, e.g. `npm run dev`.
  The shell stays open at a live prompt afterwards, so you can carry on working in it.
- **Remember the last running command** — when ticked, whatever command is still running as the
  terminal goes away becomes this panel's Startup Command, so the panel comes back doing what it
  was doing. If nothing was running, the saved command is left exactly as it was. Off by default.
- **Reopen in the last directory** — when ticked, the panel reopens in the directory it was last
  working in rather than the project root. **On by default.** It is disabled for a shell that
  cannot report its directory — see *Shell integration* below.
- **Run as administrator** — only available if throng itself is running elevated.

Confirm, and you have a live shell **at the project root** — or back in the directory this panel
was last working in, if it has one.

### Shell integration

Only **Command Prompt** actually moves its process working directory when you `cd`. PowerShell's
`Set-Location` moves its own *provider* location, and pwsh and Git Bash behave the same way — so
from the outside those three appear never to leave the directory they started in. throng therefore
asks them to report where they are, by adding a prompt hook when the terminal starts.

This is the **Shell integration** setting (Settings → Terminal), **on by default**. It preserves any
prompt you already have — oh-my-posh, starship, a `$PROFILE` function, an existing
`PROMPT_COMMAND` — and runs it as normal.

Switch it off if it disagrees with your prompt. "Reopen in the last directory" then greys out for
those shells, because without it they genuinely cannot report where they are; Command Prompt is
unaffected either way. The panel header shows the terminal's
**live working directory**, so you can see where a shell is even when a full-screen program hides
the prompt.

Terminals belong to the project, but are managed by the daemon, not the window. **Close throng and
they keep running**; reopen it and they reattach with their scrollback intact. Closing the app
offers you a three-way choice about what to do with them, and throng leaves no orphaned processes
behind.

Scroll the scrollback from the keyboard without touching the shell: **Shift+PageUp** /
**Shift+PageDown** by page, **Ctrl+Shift+↑** / **Ctrl+Shift+↓** by line, **Ctrl+Home** /
**Ctrl+End** to the ends. The **mouse wheel** scrolls the scrollback too — and over a full-screen
program (a pager, a file manager, an agent session) it drives that program's own view instead,
because there is no scrollback to move there.

If a terminal ever looks wrong — smeared characters, lines wrapping in the wrong place — use
**Refresh / redraw terminal**, on both the terminal's right-click menu and its panel header menu,
or press **Ctrl+F5**. It asks the running program to redraw its screen: nothing is typed at the
shell, no scrollback, selection or cursor position is lost, and the layout does not move.

### When a terminal cannot start

If the shell cannot be launched — most often because the project's folder has been renamed, moved
or deleted while throng was closed — the panel **stays a terminal** and says what happened in
place, naming the folder rather than showing an error code. It offers two icons:

- **Try again**, once you have put the folder back. It retries *that* panel only.
- **Clear panel type**, if you would rather set the panel up as something else. The panel returns
  to the Panel Type form with your terminal's settings still filled in, so choosing Terminal again
  costs you nothing.

Both are also on the panel's right-click menu. **Your configuration is never discarded for you** —
flavour, shell arguments and startup command all survive a failed start, and clearing is something
you choose.

If the terminal's *remembered* directory is the part that has gone, it starts in the project root
instead and says so quietly in the panel. That is a note, not a failure.

### If the background service stops

throng's terminals are owned by a background daemon. If it stops — it crashed, or you killed it,
or another build retired it — you are told once, plainly, and a **↻ icon appears in the status
bar**. Click it to restart the daemon.

The icon is deliberately in the status bar rather than on the message: the message can be
dismissed, and the way back should not vanish with it. Nothing else is disabled meanwhile, and
anything that does not need the daemon — browsing and editing files — keeps working.

## 4. Edit files

Click any file in the **Files & Folders** tree to open it in the last active editor panel — or
**drag a file in from Windows Explorer** and drop it onto an editor, or onto an empty panel,
which becomes an editor showing that file.

- **The tree follows the editor.** Whichever file you move to — another panel, another tab, a file
  you just opened — is expanded to, selected and marked in **Files & Folders**, so a rename or a
  right-click always lands on the file you are actually in. It never takes the keyboard: your caret
  stays where it was. Turn it off under **Settings → File Explorer → Follow the active editor**; the
  file you are editing stays marked either way.
- **Save** with **Ctrl+S**; **Ctrl+Shift+S** saves all (scoped to the project); **Ctrl+Alt+S** is Save As.
- **Syntax highlighting** covers 31 languages, detected by extension. Wrong guess? Correct it from
  the **language picker** in the status strip — throng remembers your choice for that file.
- **Right-click** inside an editor for cut/copy/paste, Select All, Undo/Redo and "Set Language…".
- **Ctrl+X with nothing selected cuts the whole line**, and pastes it back *as a line*, above the caret.
- **Column select** by holding **Alt** and dragging, or **Shift+Alt+Arrow** — then type, delete,
  cut or paste across every row at once.
- **Indentation follows the file's own style** wherever it has one, so throng never quietly
  converts your tab-indented file to spaces.
- **If the file moves out from under an editor** — you renamed its folder outside throng, or a
  branch switch took it away — the panel says so and names the path it could not read, so what is
  on screen is never mistaken for the file. Put the path back and it **reloads by itself**; or use
  **Reload from disk** on the panel header's menu to re-read it now. That is a different thing from
  **Revert**, which discards your unsaved edits back to the last saved version and has nothing to
  restore when the file is gone.

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

### Open a file without walking to it

**Ctrl+Shift+T** opens **Quick Open** from anywhere. Type any part of a name or a path and press
**Enter**. Words are matched independently and anywhere in the path, so `menu tsx` finds
`renderer/workspace/context-menu.tsx` without you typing the folders in between. Matches are ranked,
and the full path is shown so two files with the same name stay distinguishable.

- **Where it opens** is stated on a button in the header, in words: *"Will open in a new editor"* or
  *"Will open in the active editor (*panel name*)"*. Click it, or press **Space** while it has
  focus, to switch. It appears only when you opened Quick Open from inside an editor; otherwise your
  `Editor · Open target` preference decides.
- **Hidden and excluded files are left out** by default — the same `explorer.excludeGlobs` list the
  file tree uses, *and* anything you marked **Hide in this project**. The button at the top of the
  list toggles them in for this one search — it shows the tree's own *hide* icon while it is leaving
  them out, and an eye while it is showing them, and its tooltip says both what is true now and what
  pressing it will do. To change where **every** search starts, use
  `Editor · Navigation · Quick open excludes hidden` in Preferences.

> **`node_modules` is now hidden by default, in the tree as well as here.** It joined the shipped
> `explorer.excludeGlobs` list, so a fresh install no longer shows it in **Files & Folders** and
> Quick Open does not offer files inside it. That is a change to what the file tree draws, not only
> to this modal.
>
> **To get it back**, remove `**/node_modules` from `explorer.excludeGlobs` in Preferences →
> *Files & Folders*. To see inside it for one search only, press the toggle described above rather
> than editing the setting.
>
> If you already had throng installed, the entry is added for you on upgrade — but **only if you had
> not edited that list yourself**. A list you have customised is left exactly as you left it, on the
> principle that a shipped default may not overwrite a decision you made.
- **A file already open stays where it is.** Choosing "new editor" for a file that is open elsewhere
  in the project moves you to it rather than opening a second copy — one file, one editor.

**Ctrl+G** opens **Go To Line** in an editor. Type a line number and press **Enter**; a number past
the end of the file goes to the last line rather than refusing. A focused terminal still receives its
own **^G** — throng only claims the chord where an editor is active.

Both remember nothing between uses unless you ask them to: **`Editor · Navigation`** in Preferences
has a toggle for each, and when on, the modal reopens with the last value you actually *used* — a
query that opened a file, a line you actually went to — fully selected so typing replaces it. The
values live in memory for the running app only; they are never written to disk, and Quick Open's is
discarded when you switch project.

### Two things the file tree's menu can do for you

Right-click a **folder** and you get, alongside Copy Path:

- **Open In → Terminal**, listing every terminal flavour you have configured. It opens a new terminal
  panel in the current tab, starting in that folder — or, for a right-clicked *file*, in its parent
  folder — with the keyboard already in it, so you can type immediately.
- **Collapse All Children** closes everything beneath the folder at every depth while leaving the
  folder itself open, and **Expand All Children** opens its immediate child folders, one level. A
  file's menu shows neither, because a file can never acquire children.

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

**In the visual editors, changes apply immediately — there is no Save button and no restart.**
Toggles and dropdowns apply at once; typed values apply a moment after you stop typing.

**The JSON editor is deliberately different**, and it says so on screen: your document is applied
when you *leave* it — switching back to the visual editor, switching tab, or closing the window.
There is a reason, and it is a few paragraphs below.

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

**A hand-edited value that is out of range is brought back inside it, and the file is updated to
say so.** Each setting's limits are the ones its control shows, so a pane width of `99999` loads as
the maximum the slider offers rather than as a pane wider than your screen — and `settings.json` is
rewritten to the corrected value, so the file never disagrees with the app it is configuring. This
happens whenever the file is read, including a hot-reload while throng is running. A file that is
already within its limits is **never** rewritten, so nothing is touched without a reason. If a
setting comes back different from what you typed, that is why — and the limit is visible on the
control in Settings.

**A file that cannot be *parsed* is a different situation, and it is treated differently.** An
out-of-range value is corrected; a file with a stray brace cannot be read at all, so there is nothing
to correct. throng re-reads it a few times in case it caught you mid-save, and if it still will not
parse it runs on the shipped defaults and says so in the diagnostics log — your file is left exactly
as it is, for you to repair. It is not overwritten, and nothing is silently discarded. The
difference is worth knowing before you edit by hand: *"your settings were corrected"* and *"your
settings could not be read"* look similar from the outside and mean very different things.

**In the JSON editor, your document is applied when you leave it** — closing the JSON view,
switching tab, or closing the Preferences window — rather than as you type. That is deliberate: a
half-typed number is often still valid JSON, so applying as you type meant throng could correct and
rewrite the value you were halfway through entering. While the document is invalid you cannot leave
the editor, and a notice names each offending value with its allowed options or its permitted range.
If you would rather abandon the edit, *Discard changes and close* does exactly that, leaving the last
valid document in effect.

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
| **Ctrl+Alt+B** / **Ctrl+Alt+N** | Show/hide the Projects pane / the Files & Folders pane |
| **Ctrl+Alt+T** | Open the tab picker — type to filter, **Up/Down** to move, **Enter** to choose |
| **Ctrl+Shift+T** | **Quick Open** — type part of a file's name or path, **Enter** to open it |
| **Ctrl+G** | **Go To Line** — in an editor. A terminal still gets its own `^G` |
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
| **Ctrl+F5** | Refresh / redraw the focused terminal |

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
