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
| **Right** — File Explorer | The active project's file tree |

Both side panes collapse to a narrow labelled rail — click the chevron in the pane's top-outer
corner, or press **Ctrl+Shift+Alt+J** (projects) and **Ctrl+Shift+Alt+K** (files). The middle pane
never collapses. If you make the window too narrow, throng collapses the Explorer for you, then the
sidebar, and restores them when you widen it again. **Ctrl+Shift+Alt+B**, **Ctrl+Shift+Alt+N** and
**Ctrl+Shift+Alt+M** — left to right, like the panes — jump keyboard focus straight into the Projects
pane's project list, back to the active panel in the middle pane, or into the File Explorer, from
anywhere in the window — reopening a collapsed pane first if it needs to — without changing what's
shown.
Whichever pane holds focus is outlined in the active colour, as thin as the pane's ordinary border.

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
to switch to it — focus stays in the project list, so **Up** / **Down** and **Enter** carry on from
there until you click into the workspace; **double-click its name to rename it**. Removing a project (**✕**) removes it
from throng, kills all terminals and editors for that project, but **deletes nothing on disk** — the
confirmation says so.

**Right-click a project** — or press **Shift+F10** / the context-menu key on a focused row — for a
menu with **Edit**, **Rename**, **Remove**, **Move to Category ▸** and two Unload rows:
**Unload Project**, and a second row naming the other terminal action — **Unload Project and End
Terminals** as shipped, or **Unload Project and Keep Terminals Running** if you have changed the
default. The first three do exactly what the inline **✎**, a double-click and the inline **✕**
already do; the Unload rows are disabled on a project that isn't loaded. Unload closes the project's
tabs and panels and returns its row to the unloaded style, but forgets nothing — its layout, tabs,
panels, colour and category are kept, and selecting the project again brings the same layout back.
Unsaved editors are offered for saving first, as they are when you remove a project; that is the only
thing Unload ever asks. Otherwise each row does what it says, with no confirmation: keeping terminals
running keeps every terminal, idle shells included, and each one reattaches when you select the
project again; ending them ends every terminal, running processes included. What **Unload Project**
does is the **Unload project: default terminal action** setting (**Keep terminals running** as
shipped), in **Settings → Confirmations**.

**Categories** group projects in the Projects pane. Each category's header is a highlighted strip
with its name in bold capitals (the strip's colour is the **Category Header Background** theme
token; the name you typed keeps its own casing). Every project starts in the default **In
Progress** category, which is always first, cannot be deleted or minimised, and can be renamed. A
project's right-click menu offers **Move to Category ▸**, listing every other category and **New
Category…**, which asks for a name, creates the category and moves the project into it. A category
name must be unique, ignoring case: a duplicate is refused the same way a duplicate project name
is, and the name field stays open to correct it. A category header's own right-click menu offers
**Rename Category**, **Delete Category** and a checkable **Minimise Category** (the default header
offers only **Rename Category**). Minimising
a category hides its projects — except the active one, whose row stays visible until you switch away
— and you can drag a project into another category's section, or onto a minimised header, to move it
there. A project drag starts from anywhere on its row — the grip, the name, the colour swatch or the
empty space — except the inline **✎** / **✕** buttons and an open rename field; a press that doesn't
move is still a click. Deleting a category moves its projects into the default one, keeping their
order.

**Reorder categories** by dragging a category's header to a new place, or with **Move Category Up**
/ **Move Category Down** on its right-click menu (each is greyed out at the end of the list it can't
pass). The default category stays pinned first: its header doesn't drag, nothing can be dropped
above it, and its menu has neither item. A category moves with its projects and its minimised state,
and the order is kept across restarts.

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
| **‹** | Step one tab left. Its pill counts the tabs entirely hidden off the left edge |
| **›** | Step one tab right. Its pill counts the tabs entirely hidden off the right |
| **▾** | Open the tab picker. Its pill counts *all* tabs |

A step is available whenever the strip can move that way, even if the only thing past the edge is
part of a tab. Only the left mouse button steps. Press and hold either chevron and the strip keeps
scrolling until you let go. A fade over each edge shows that there is more strip in that direction.
The **+** stays pinned on the right at every tab count. The active tab is always scrolled fully into
view, clear of the fades, however it became active.

**The tab picker** (**▾**, or **Ctrl+Shift+Alt+T** from anywhere — a focused terminal or an open
find bar included — at any tab count) lists every tab, hidden
or not. Type to narrow it: the terms match in **any order** and anywhere in the name, so `find file`
finds "file find.txt" as readily as "find any file.md". Choosing a tab scrolls the strip to it and
makes it active; **Escape** dismisses without moving anything.

**On each tab.** The number of panels shows as a pill. Resting the pointer on a tab brings up a
popover listing its panels one per line — resting, not merely crossing, so it stays out of your way
while you traverse the strip. Right-clicking hides the popover so it cannot sit on top of the menu it
just opened.

Each panel is listed by the name it actually wears — a terminal by the title the program running in
it announced, an editor by its file — and is marked with its type's icon. A panel you have not given
a type yet gets a plain bullet, because there is nothing to say about it until you choose one.

The tab's own name appears above that list **only when the strip could not show it in full**. When it
fits on the tab you are pointing at, repeating it here would just push the panels down a line.

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
- **Run as administrator** — only available if throng itself is running elevated. Off by default.

All three of those checkboxes start from a **preference**, so if you always want the opposite you
can set it once instead of re-ticking it on every panel. They live under **Terminal** in
Preferences — *Remember the last running command by default*, *Reopen in the last directory by
default*, *Run as administrator by default*. A panel that has its own saved value keeps it: the
preference is what a **new** panel starts from, not an override.

"Run as administrator by default" only decides what the checkbox starts as. Whether a terminal can
be elevated at all still depends on throng itself running elevated, and turning the preference on
never elevates anything on its own.

Confirm, and you have a live shell **at the project root** — or back in the directory this panel
was last working in, if it has one.

### Paths in terminal output are clickable

throng recognises file paths in whatever a terminal prints — a compiler's diagnostics, a test
runner's failures, a `git status` — with no cooperation from the program. It recognises:

- relative paths (`src/foo.ts`, `./foo.ts`, `../docs/x.md`) and home-relative ones (`~/x.ts`);
- Windows absolute paths with either slash (`D:\git\x.ts`, `D:/git/x.ts`) and network paths with
  either slash (`\\server\share\x.ts`, `//server/share/x.ts`);
- POSIX-style absolute paths, including the Git Bash and WSL drive forms (`/d/git/x.ts`,
  `/mnt/d/git/x.ts`) and Git Bash's own folders — `/usr/bin/bash.exe`, `/etc/hosts` and `/tmp` mean
  what Git Bash means by them, in any terminal and in an editor;
- `file:` URLs written out as text, however the path inside is spelled (`file:///D:/x.ts`,
  `file:///d/x.ts`, `file:///mnt/d/x.ts`);
- PowerShell's own spelling of a location, `Microsoft.PowerShell.Core\FileSystem::\\server\share\dir`,
  which is how its prompt shows a network folder;
- any rooted path, however short — `/help` in a sentence is a link, exactly as `/usr/bin/bash.exe`
  is;
- web addresses (`http`/`https`, `localhost` included) and the protocols on the **allowed link
  protocols** list — `mailto:`, `tel:` and `slack:` as shipped;
- an **email address written on its own** — `someone@example.com` — which is a `mailto:` link and
  goes to your mail client. Take `mailto` off the allowed list and it is ordinary text; either way it
  is never treated as a file.

A position after the path comes with it: `foo.ts:42`, `foo.ts:42:7` and `foo.ts(42,7)` all name a
line — and a trailing comma, full stop or bracket is left out of the path rather than breaking it.

**A link is recognised by its text alone.** throng never checks that a path exists before it
underlines it — not while drawing, not on hover — so a streaming build is never slowed by checking,
and a link to something that is not there is underlined like any other. Whether it is broken is found
out when you follow it. What keeps a page of prose from filling with underlines is the shape rule:
`e.g.`, `a/b`, `1/2`, `1.2.3`, `2026/09/19` and `support.example.com` are not paths and are left
alone.

**Paths with spaces.** An unquoted path ends at its first space — `/file 1` links `/file` only —
unless one of these tells throng where it really ends:

- it is enclosed in **backticks**, **quotes**, or a pair of `()`, `<>`, `[]` or `{}` —
  `` `/file with spaces.md` ``, `"C:\my folder\my file.txt"`, `[/d/folder/a link to file.png]`;
- it reaches a word ending in a **slash** — `Z:\folder with spaces\folder\` — or in a **known file
  extension** — `\\share\path to file.xlsx`, `see D:\my notes\a.md for details` (which stops at
  `a.md`).

The unquoted forms need a path separator somewhere in the path, stop at the first word that
qualifies, cross single spaces only (two spaces or a tab end them) and span at most six words.
The known extensions are a list you can edit — **Settings → Editor → Links → File extensions that end a spaced
path**, which arrives holding the extensions throng ships with. Add to it and remove from it
like any other list; an empty list means no extension ever carries a path across a space. It applies
to terminals and editors at once, with no restart.

A **relative** path is measured from the directory the terminal is in *now*, so `npm run build` in
`packages/ui` printing `src/foo.ts` means the file next to it — not the one at the project root.
That holds on a network share too: a PowerShell sitting in `\\server\share\dir` running `dir` prints
names that are links. throng falls back to the **project root** when it cannot tell where the shell
is — a PowerShell, pwsh or Git Bash terminal with shell integration switched off, and a WSL terminal
you have defined yourself — rather than guessing from the folder the shell started in; see *Shell
integration* below for which shells can report it.

**WSL.** In a WSL terminal, `/mnt/d/…` paths are links as everywhere else, but Git Bash's meaning of
`/usr`, `/etc` and `/tmp` is not applied, and the distro's own Linux paths (`/home/…`) are not links
yet — they name the distro's filesystem, which throng does not reach.

**Every link looks the same.** A link carries a **dashed underline** while at rest, so you can see
what is clickable without sweeping the pointer across the screen; under the pointer the underline
turns **solid**, the pointer is a **hand** — with or without Ctrl held — and a tooltip shows the
link's **full target**: the absolute path, or a hyperlink's real address rather than its visible
text. Nothing else; where a Ctrl+click would go is what the hint tells you when you click *without*
Ctrl. The text keeps its own colour. The same full target also shows at the left of the panel's
status bar while the pointer is on the link.

Both name a location only when the text settles it on its own — a drive path, a `file:` address, a
`/d/…` drive form, or anything relative, which is measured from the terminal's directory. **A rooted
path such as `/tmp`, `/etc/hosts` or `/help` is shown exactly as written**, because where it goes
depends on what is actually on disk: the project's own folder is tried first, and Git Bash's mount
table after it. Nothing is looked up until you follow the link, so rather than name the wrong place
throng names none, and the click is what tells you.

Terminal links are marked **as the screen draws**, from the rows in view, so they appear while output
is still streaming and in **full-screen programs such as Claude Code**, and nothing from one screen
lingers when a program switches to the other.

A link the terminal **wrapped** onto several rows is one link: marked on every row, and a hover or a
Ctrl+click on any of its rows acts on the whole of it.

**A plain click** on a link does what a click always does — places the cursor, starts a selection, or
reaches the program — and also shows a small **hint** at the link's bottom-right saying that
Ctrl+click follows it and where it will go. The hint takes no focus, lets clicks through, and is gone
after a couple of seconds, or at once when you press Ctrl or scroll.

**Ctrl+click** follows a link. The destinations are the same as for a link a program prints, below.

**Network shares.** Nothing is asked of a share until you follow a link on it, so a slow or offline
share never holds up drawing. A Ctrl+click on a network path, or opening its Link menu, waits at most
the **Link resolution timeout** (2,000 ms as shipped, 250 – 25,000; see *Make it yours*) to find
out whether it names a file or a folder. Once a share has failed to answer, throng leaves it alone
for a while rather than asking again on every click. Following a link in the project to a location
that does not answer ends with one notice saying the location did not answer in time.

### Links a program prints

Some programs mark up their output with real hyperlinks — the same mechanism Windows Terminal
supports — and a link whose target is a web address, a `file:` location or an allowed protocol is
followable in throng, whatever it points at.

It wears the same faint dashed underline as any other link, which turns solid under the pointer, and
resting on it shows the link's full address in a tooltip — nothing else. What a Ctrl+click will do is
explained by the small hint that appears if you click **without** Ctrl. **Ctrl+click** follows
it — and any other link — by what it names, and **never runs anything or opens a file in its default
program**:

- a **web** address, `localhost` and `127.0.0.1` included, opens in your system browser;
- a **file inside the project**, however it is spelled — `file:///…` included — opens in throng: in a
  preview if its file type's default open action is Preview, otherwise in an editor, and **always in
  an editor, at the line and column**, when the link names one (`test.md:3:5` puts the caret on line
  3, column 5, even if the file is already open). A script or program in the project opens as text.
  If nothing is there, **one notice** says it was not found and nothing opens;
- a **folder**, a **network path** (`\\server\share\…`), a **`file:` URL** and **anything else on
  disk** opens in OS Explorer — a folder as itself, a file as its folder with the file selected. The
  file is never run. If the folder cannot be reached, OS Explorer says so;
- an **allowed protocol** — `mailto:`, `tel:` and `slack:` as shipped — goes to the program your
  system has for it. The list is **Settings → Editor → Links → Allowed link protocols**; schemes that
  can run code (`javascript:`, `data:`, `vbscript:`, `ms-msdt:`, `search-ms:` and their kind) are
  refused even if you add them, and a scheme not on the list is plain text.

Opening a file in the program its type belongs to is still there, on the Link menu as *Open in OS
Default Program* (or *Open Program* for an executable), which you choose on purpose. If throng itself
is running as administrator, that program — and OS Explorer — is started **without** administrator
rights.

A hyperlink with an empty target, or a scheme throng does not follow, is not a link and looks like
plain text: no underline, no hand pointer, no tooltip, no Link menu, and no notice. A Ctrl+click on
it goes to the program, as any other click would.

One Ctrl+click follows a link **once**. Full-screen programs such as Claude Code often open links
they are Ctrl+clicked on themselves, so throng keeps the press to itself when it is over a link it
recognises, and lets it through everywhere else — so the program's own links keep working too.

### Choosing where a link opens

Ctrl+click picks one destination. **Right-click a link** — with nothing selected — and you get the
**Link menu**: one menu, the same in a terminal, an editor and a Markdown preview, holding only what
can be done with that link, in this order:

| Item | When you see it |
|---|---|
| **Open Link** | always — it does exactly what Ctrl+click does |
| **Open In ▸ New Editor**, **Active Editor**, and each open editor by name | a file inside the project |
| **Open Preview** | a file inside the project that a preview provider handles; drawn **greyed** when that provider is switched off, so you can see the destination exists |
| **Open in OS Explorer** | a path or `file:` location — the file is selected in its folder, or the folder is opened |
| **Open in OS Default Program** | a file that is not a program (never a folder) |
| **Open Program** | an executable file — it runs it, which is why it is never what a click does |
| **Copy Link to Clipboard** | always — the full path, plus the `:42:7` or `(42,7)` exactly as it was printed, or the address as written |

**Open Link** goes where Ctrl+click goes; each of the other items does its own thing, which is how
you reach the destinations a click does not choose. Over a **web** address, a `localhost` address or
an allowed protocol the menu offers **Open Link** and **Copy Link to Clipboard** only.

The menu opens at once. Whether the link is a file or a folder, and whether it is really there, is
found out as it opens, so an item that needs the file may appear greyed and light up a moment later —
and stays greyed if nothing is there. An item you do not see is one that could never apply to that
link — there is no editor for a folder, and nothing outside the project ever opens in a throng editor
or preview. Select some text first and you get the panel's ordinary menu instead, whatever the pointer
is over.

The menu is also reachable from the keyboard with **Shift+F10**, which offers the items for whatever
the pointer is resting on. Ctrl+Enter in a terminal is **not** an Open Link shortcut — it reaches
the shell, as it always has — which is why the terminal's Open Link item shows no shortcut.

### Reloading terminals

By default, opening a project brings its terminals back: the tab you land on starts its terminals
immediately, and every other tab starts its own the moment you first click it.

**Reload terminals when a project opens** (Preferences → Terminal) lets you change that:

- **Automatic** — the default, and exactly the behaviour above.
- **Manual** — nothing starts on its own. Each terminal panel keeps its name, its type and its place
  in the layout, and shows a **Reload** button. Reload the ones you want and leave the rest alone;
  a dormant panel holds no shell at all, so it costs nothing.

A panel left dormant stays dormant across a project switch and across a restart — throng will not
quietly start something you deliberately left closed. Reload is also on the panel's menu, not only
on the panel. Switching back to Automatic takes effect the next time you open a project.

A dormant terminal is not an error, and throng does not report it as one.

### When a folder goes missing and comes back

If a project's folder is renamed, moved, or sits on a share that blinks, its terminals cannot start
and say so on the panel. **Put the folder back and they start themselves** — in the directory they
were configured for, with the panel's own settings intact, and without a notice per panel.

Only terminals that failed *because of the path* do this. A terminal that failed for another reason —
a shell that is not installed, a permission refusal — does not retry in a loop, because nothing about
the folder returning would fix it. **↻ Retry** is still there for those, and works exactly as before.

Terminals in a tab you have not opened were never started, so there is nothing for them to recover
from: they start normally the first time you open that tab.

This is not session resurrection. It is a fresh shell in a directory that came back — scrollback and
whatever was running are gone.

### Shell integration

Only **Command Prompt** actually moves its process working directory when you `cd`. PowerShell's
`Set-Location` moves its own *provider* location, and pwsh and Git Bash behave the same way — so
from the outside those three appear never to leave the directory they started in. throng therefore
asks them to report where they are, by adding a prompt hook when the terminal starts.

The same hook lets go of a folder once you `cd` out of it. Windows will not delete a folder a
running process is sitting in, so with shell integration off, the folder a PowerShell, pwsh or Git
Bash terminal started in cannot be deleted until that terminal closes.

This is the **Shell integration** setting (Settings → Terminal), **on by default**. It preserves any
prompt you already have — oh-my-posh, starship, a `$PROFILE` function, an existing
`PROMPT_COMMAND` — and runs it as normal.

Switch it off if it disagrees with your prompt. "Reopen in the last directory" then greys out for
those shells, because without it they genuinely cannot report where they are; Command Prompt is
unaffected either way. The panel header shows the terminal's
**live working directory**, so you can see where a shell is even when a full-screen program hides
the prompt.

**Tell programs that links are supported** (Settings → Terminal), also **on by default**, is how programs know
they can print real hyperlinks in a throng terminal: a terminal throng starts carries
`FORCE_HYPERLINK=1`, which is the variable the common Rust and Node link libraries read. Two things
it deliberately does not do. **It never overrides a `FORCE_HYPERLINK` you set yourself** — neither a
`0` you set to switch links off nor a `1` you set to force them on; if the variable is already there
when throng launches, throng leaves it exactly as it is. And **it applies to terminals started
afterwards, never to one already running**, because a program's environment is fixed when it starts —
so switch it and open a new terminal. throng also never pretends to be some other terminal: it sets
that one variable and nothing else.

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

Click any file in the **File Explorer** tree to open it in the last active editor panel — or
**drag a file in from Windows Explorer** and drop it onto an editor, or onto an empty panel,
which becomes an editor showing that file.

- **The tree follows the editor.** Whichever file you move to — another panel, another tab, a file
  you just opened — is expanded to, selected and marked in **File Explorer**, so a rename or a
  right-click always lands on the file you are actually in. It never takes the keyboard: your caret
  stays where it was. Turn it off under **Settings → File Explorer → Follow the active editor**; the
  file you are editing stays marked either way.
- **Save** with **Ctrl+S**; **Ctrl+Shift+S** saves all (scoped to the project); **Ctrl+Alt+S** is Save As.
- **Word wrap** toggles with **Ctrl+E,W** — a two-key chord: hold **Ctrl**, press **E**, then
  press **W** with **Ctrl** still held. Letting go of **Ctrl** between the two ends the chord, and
  the **W** then types a *w*. Between the two, the editor shows *(Ctrl+E) was pressed. Waiting for
  the next key of the chord…*. **Escape** cancels, as do moving focus out of the editor and four seconds'
  wait; a second key that completes no chord types nothing and the editor says the combination is
  not bound. It is an editor-only chord, so a terminal never has Ctrl+E taken from it. To record a
  chord of your own with up to three keys (`Ctrl+E,W,Q`), press it the same way in the Key Bindings
  capture box: hold the modifiers, press the keys, then let go. Nothing is recorded until every key
  is up. A fourth key is refused and ignored; letting go still records the first three.
- **Syntax highlighting** covers 31 languages, detected by extension. Wrong guess? Correct it from
  the **language picker** in the status bar — throng remembers your choice for that file.
- **The status bar says where you are** — the caret's line and column, how many characters are
  selected while something is, and how many characters and words the document holds. Narrow the panel
  and the readouts give ground in a fixed order — the word count first, the line number last — rather
  than showing you half a figure; widen it and they come back. **Settings → Editor → Status Bar** has
  a switch for the position, one for the counts, and one for the whole bar.
- **Line numbers** run down the left of every editor. Turn them off under **Settings → Editor → Show
  the editor gutter** and the document starts at the panel's left edge instead.
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

### Paths in a document are clickable too

An editor recognises the same links a terminal does — the path forms listed up in *Paths in
terminal output are clickable*, and **web addresses** (`http`/`https`) — anywhere in the text of any
file it opens, along with the allowed protocols, and treats each exactly as a terminal would: the
same look, the hand pointer, the same tooltip, the plain-click hint, the target in the status bar, the
same destinations and the same Link menu. Anything shaped like a path carries the dashed link
underline whether or not it exists, and the same rule for spaces applies. Syntax colours are left
alone — the underline is the only mark.

A relative path is measured from **the open file's own folder** first, then from the project root.
So in `docs/a.md`, `./b.md` is the file beside it and `packages/core/x.ts` is the one at the root.
An untitled buffer has no folder of its own, so only the project root is tried.

- **Ctrl+click** a link to follow it. Ctrl+click anywhere else still **adds a cursor**, as it always
  has, and a Ctrl+click that drags still selects.
- **Ctrl+Enter** follows the link the caret is sitting inside. With a selection, with more than one
  cursor, or anywhere else, it inserts a blank line exactly as before.
- **Right-click** a link for the same Link menu a terminal gives you. Here **Open Link** shows its
  `Ctrl+Enter` shortcut, because in an editor that key really does follow the link.

A path that carries a position — `src/foo.ts:42`, `src/foo.ts:42:7`, `src/foo.ts(42,7)` — opens the
file **at that line and column**. If the file has since got shorter, the caret lands as close as it
can rather than refusing.

A web address opens in your system browser, and its Link menu offers **Open Link** and **Copy Link
to Clipboard**. `mailto:`, `tel:` and `slack:` text is a link as long as that scheme is on the
allowed list; `javascript:` text never is.

Link detection can be turned off: **Preferences → Editor → Links → Detect links in editors**. Nothing
in an editor is a link then — not paths, not web addresses, not allowed protocols — and the gestures
go back to their ordinary editor meanings everywhere.

### Preview a file

An editor for a file type with a preview provider — Markdown, to start — shows a **preview** button
in its status bar, and its right-click menu offers **Open Preview**. Either opens a read-only,
rendered preview beside the editor: it follows your typing a moment after you pause, without
saving, and shares the editor's unsaved dot. Click the status-bar button again and the open preview
is focused, rather than opening a second one.

You don't need the file open in an editor first. Right-click it in **File Explorer** and choose
**Open In → Preview** to read it without opening it for editing — the preview follows the file on
disk instead, and File Explorer does not show it as open. Open the same file from File Explorer
afterwards and the preview, where it stands, adopts that editor and starts following its buffer.

Scrolling either side of a parented pair moves the other to match — whatever block (heading,
paragraph, list item, table row) sits at the top of one's view lands at the top of the other's, not
headings alone — governed by **Editor · Previews · Synchronise preview and
editor scrolling** (on by default). Stepping Back to a document you'd left scrolled to the very top
lands the preview on the editor's own top line instead, rather than at the top a second time.
Switch the sync off from either panel's right-click menu (body or header), the status-bar button
just to the left of the Preview/Editor button, or the **Synchronise Scrolling** command, which
ships with no chord. Preview text is ordinary, selectable text: drag across it with the mouse and
Ctrl+C copies it, the same as an editor.

A preview's own status bar carries a button back to the source: **Open in Editor** on a preview
that stands alone, opening one beside it, or **Go to Editor** on one that already has a parent,
focusing it. Hovering a link, or reaching it with **Tab**, shows its full target at the left of the
status bar, and hovering an image shows its source and any title, exactly as written in the
Markdown. Ctrl+click a link inside a preview to follow it — a link to another file in the project
opens **in the same preview, in place**; a link to a heading in the same document scrolls to it and
is a Back/Forward step of its own; a web or `mailto:` link opens in your default browser, which is
left in front of throng rather than throng reclaiming focus. Tab reaches a link from the keyboard
and **Ctrl+Enter** follows it. A plain click on a link shows the same brief hint an editor or a
terminal does, and its tooltip is worded the same way. Right-click a link for the same **Link menu**
as everywhere else; its **Copy Link to Clipboard** copies a web link's URL, a project file's absolute
path, or — for a link that names a heading — that path followed by `#heading`; a link to a heading in
the same document copies the preview's own path, and offers only Open Link and Copy Link to
Clipboard. Away from a link, the preview's own right-click menu has **Close Panel**, **Reveal**,
**Open in OS Explorer**, **Refresh** and **Zoom**, but no Rename — a preview's title always follows
its source.

### Step back and forward through a panel's history

Every editor and every preview panel remembers the files it has shown, with **Back** and
**Forward** buttons at the top left of its title bar — disabled at either end — `Alt+Left` /
`Alt+Right`, and your mouse's own back/forward buttons if it has them. Opening a file into a panel
by any other route — File Explorer, Quick Open, a Find in Files result, or a preview link — drops
anything ahead of where you are and adds the new file as the newest entry; Back and Forward step
through that list without changing it. History survives a restart and is dropped when the panel is.
How many entries each panel remembers is **`Editor · Navigation · Navigation history size`**
(10 by default, 1–100).

In a preview, following a link to a heading in the same document is a step too: Back returns first
to where you were reading, then — once you've stepped back through every in-document jump — to the
previous document, if there was one. Editors are unaffected: their history stays file-level, one
entry per file shown.

## 5. Find things

**Ctrl+F** opens one find bar that adapts to whatever panel is active.

- In an **editor** it finds *and replaces* — **Ctrl+H**, then **Alt+Enter** for the current match
  or **Ctrl+Alt+Enter** for all. Replace-all is a **single undoable step** and leaves the file's
  encoding and line endings alone. Both replace keys act only while the replace row is showing; with
  the bar open on find alone they do nothing and the key passes through to the editor.
- In a **terminal** it searches the retained scrollback **read-only** — it never types at your
  shell. Park on a match and the view stays there while output keeps streaming.

**F3** / **Shift+F3** jump between matches; **Escape** closes the bar.

### Find and replace across the whole project

**Ctrl+Shift+F** opens a **Find in Files** panel in the current tab, or reuses the one already there,
and searches every file in the project. **Ctrl+Shift+H** opens the same panel with the replace row
showing. If you have a single-line selection in an editor or a terminal, it becomes the search term.

- **It searches as you type.** A moment after you stop typing, results stream in as they are found,
  grouped by file, or by folder and file (the toolbar switches). The list stops at 20,000 matches and
  a notice above it says so; narrow the scope or the term to see the rest. Results are locked until
  the search finishes, and **✕** stops it at once. If you would rather press **Enter**, switch to
  explicit run under **Settings → Search · Find in Files**.
- **The scope box** says where it looks. It is empty for the whole project, or it holds a folder or a
  single file. Type a path relative to the project, or paste a full one, or use the folder button
  beside it. A path outside the project is refused on the box and nothing runs.
- **Double-click a result**, or press **Enter** on it, to open the file with the match selected. It
  follows your *Open files in* preference. A result's own right-click menu has **Open In** for the
  last active editor, a new one, or another tab.
- **Replace** previews each match in place. Commit one match, one file, or everything with
  **Replace All**. A committed row reads as the file now does. Each file changes as a single undo in
  its editor. A file with no open editor is written to disk after you confirm the count, and that
  cannot be undone from throng. An open editor with no unsaved changes is saved for you; one you had
  already edited keeps the replacement unsaved, beside your own work.
- **Files that change** after the search are marked on their heading. The list is not rerun under
  you: search again when you want fresh results.

You can also start here from the tree. Right-click a file or folder and choose **Open In → Search →
Find** or **Find & Replace**, or use the toolbar's **Find in Files** button for the whole project. The
panel can't be renamed, and it zooms with **Ctrl+Alt++** or **Ctrl+Wheel** like any other.

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
> `explorer.excludeGlobs` list, so a fresh install no longer shows it in **File Explorer** and
> Quick Open does not offer files inside it. That is a change to what the file tree draws, not only
> to this modal.
>
> **To get it back**, remove `**/node_modules` from `explorer.excludeGlobs` in Preferences →
> *File Explorer*. To see inside it for one search only, press the toggle described above rather
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

### Three things the file tree's menu can do for you

Right-click a **folder** and you get, alongside Copy Path:

- **Open In → Terminal**, listing every terminal flavour you have configured. It opens a new terminal
  panel in the current tab, starting in that folder — or, for a right-clicked *file*, in its parent
  folder — with the keyboard already in it, so you can type immediately.
- **Open In → Search → Find** and **Find & Replace**, on a folder or a single *file*. Either opens the
  current tab's Find in Files panel — or reuses it — cleared and scoped to what you right-clicked,
  with the caret in the search box. *Find & Replace* shows the replacement row as well. Nothing is
  searched until you type.
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

Click the **cog** in the title bar and choose **Settings**, **Key Bindings** or **Themes** — that is
the whole menu. All three are tabs of one preferences window that floats above throng and minimises
with it. It stays on top but **does not block the app** — keep using throng while you edit a theme
and watch each change land live.

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
- **Previews** — **Editor → Previews** turns each provider on or off (turning one off closes its
  open previews and greys its other settings, rather than hiding them) and sets its **default open
  action**: **Editor**, the shipped default, or **Preview**, which makes a click or Enter open the
  rendered view directly. The same page holds the update delay, maximum wait, copy format and
  **Synchronise preview and editor scrolling** (on by default, and works both ways: either side
  drives the other) that previews use, and any settings a provider adds of its own, such as
  Markdown's **Load remote images** and **Show front matter**
  (on by default; off hides the front-matter table entirely rather than rendering it as Markdown).
- **Links** — where a Ctrl+click, the **Ctrl+Enter** chord and the Link menu's **Open Link** go is
  not a setting: web addresses open in the browser, a file in the project opens in throng (a preview
  or an editor, by that file type's **default open action** under **Editor → Previews**), allowed
  protocols go to their handler, and everything else on disk is shown in OS Explorer — see *Links a
  program prints*. **Editor → Links** holds **Link resolution timeout** (2,000 ms as shipped,
  250 – 25,000): how long throng waits, in total, for a file or network location to answer when you
  Ctrl+click a link or open its Link menu. Nothing is looked up before a link is drawn. Raise it for
  a slow network share; it applies to the next lookup, with no restart.
  **Allowed link protocols** (`mailto`, `tel`, `slack` as shipped) lists the schemes, besides the web,
  that are links and go to their handler; a scheme that can run code is refused even if listed.
  **File extensions that end a spaced path** is that list. It
  arrives holding the extensions throng ships with, and you add to it and remove from it like any
  other list; an empty list means none of them do. It applies in terminals and editors alike. One
  consequence of holding the list yourself: once you have edited it, extensions added in a later
  release no longer appear in it.
  The same page holds two switches, both on as shipped: **Detect links in editors** and
  **Detect links in terminals**. Each turns off links entirely in that panel type — paths throng
  guesses at, web addresses, allowed protocols, and the hyperlinks a program declares for itself,
  all of them. Nothing is underlined, nothing shows a hand or a tooltip, no hint appears, Ctrl+click
  follows nothing and there is no Link menu; in an editor the gestures go back to adding a cursor and
  inserting a blank line. Both apply at once — nothing reopens, and a running terminal keeps its
  scrollback.
  The link underline's colours are two theme tokens in the theme editor's **General** area, **Link
  Underline** (the dashed underline at rest) and **Link Hover Underline** (the solid one under the
  pointer); unset, they follow the theme's accent colour. The plain-click hint has three of its own
  there too — **Link Hint Background**, **Link Hint Text** and **Link Hint Border**.

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

**How the defaults are laid out.** The modifiers say how far a chord reaches:

- **Ctrl+Shift+Alt+key** — getting around and the whole window: moving between panes, panels, tabs,
  projects and notices, showing or hiding a side pane, and the window's zoom.
- **Ctrl+Alt+key** or **Ctrl+Shift+key** — the panel or pane that has focus, rather than what it
  shows (its zoom, for instance).
- **One modifier, or none** — the content: editing, finding, saving, file operations.

A handful of long-standing chords sit outside that pattern on purpose, because they are the ones
every other editor uses or because a terminal needs them: **Ctrl+Shift+T** Quick Open,
**Ctrl+Shift+F** / **Ctrl+Shift+H** Find / Replace in Files, **Ctrl+Shift+S** Save All,
**Ctrl+Alt+S** Save As, **Ctrl+Alt+Enter** Replace All, **Ctrl+`** / **Ctrl+Shift+`** panel
cycling, **Ctrl+E,W** word wrap, **Shift+Alt+Arrow** column selection, the function keys (**F2**,
**F3**, **F11**, **Shift+F10**) and the Menu key. Where a chord names **+**, it means the **+** key:
**Ctrl+Shift+Alt++** is Ctrl, Shift and Alt held with the **+** key — the one that shares **=** on a
UK or US keyboard — and the keypad **+** and **-** are the same binding as their main-row keys, so
either fires it. **Resetting the zoom is different — it takes the keypad's 0 specifically**: the
main-row **0** does not reset either zoom, on any layout.

| | |
|---|---|
| **Ctrl+Shift+Alt+J** / **Ctrl+Shift+Alt+K** | Show/hide the Projects pane / the File Explorer pane |
| **Ctrl+Shift+Alt+B** / **Ctrl+Shift+Alt+M** | Focus the project list / the File Explorer pane, from anywhere |
| **Ctrl+Shift+Alt+N** | **Focus Workspace** — put keyboard focus back in the active panel in the middle pane, from a side pane or anywhere else, without changing tab, panel or project |
| **Ctrl+Shift+Alt+PageUp** / **Ctrl+Shift+Alt+PageDown** | Previous / Next project, skipping a minimised category, stopping at either end |
| **Ctrl+Shift+Alt+T** | Open the tab picker — type to filter, **Up/Down** to move, **Enter** to choose. Works from a focused terminal too |
| **Ctrl+Shift+T** | **Quick Open** — type part of a file's name or path, **Enter** to open it |
| **Ctrl+G** | **Go To Line** — in an editor. A terminal still gets its own `^G` |
| **F11** | Full screen |
| **Ctrl+`** / **Ctrl+Shift+`** | Cycle the active panel forward / back |
| **Ctrl+Shift+Alt+Arrow** | Move focus to the panel left / right / up / down, from the focused panel (does nothing while a side pane has focus). The caret moves with it, into whichever control in that panel last had focus, or its first |
| **Ctrl+Shift+Alt+V** | Focus the most recent notice, so its list can be read and scrolled by keyboard. **Esc** returns you to where you were |
| **Ctrl+Shift+Alt++** / **Ctrl+Shift+Alt+-** | Zoom the whole window in / out |
| **Ctrl+Shift+Alt+Numpad0** | Reset the whole window's zoom — the **keypad** zero; there is no other keyboard or mouse route |
| **Ctrl+Alt++** / **Ctrl+Alt+-** | Zoom **the focused panel** in / out |
| **Ctrl+Alt+Numpad0** / **Ctrl+Alt+0** / **Ctrl+MiddleClick** | Reset **the focused panel's** zoom — the keypad zero, the main-row zero, or middle-click over the panel |
| **Ctrl+Wheel** | Zoom **the panel under the pointer** in or out. Over the title bar or a side pane it does nothing, and it never scrolls the panel |
| **Ctrl+E,W** | Toggle word wrap in the focused editor — hold Ctrl, press **E**, then **W** |
| **Ctrl+F** / **Ctrl+H** | Find / replace in the active panel |
| **Ctrl+Shift+F** / **Ctrl+Shift+H** | Find / replace **across every file in the project** |
| **F3** / **Shift+F3** / **Escape** | Next match / previous match / close find |
| **Ctrl+S** / **Ctrl+Shift+S** / **Ctrl+Alt+S** | Save / Save All / Save As |
| **F2**, **Delete**, **Ctrl+X/C/V** | Rename, delete, cut/copy/paste — **in the file tree** |
| **Alt+Left** / **Alt+Right** | Back / Forward — in the focused editor or preview panel |
| Mouse back / forward buttons | Same as Alt+Left / Alt+Right, over an editor or preview panel |
| **Ctrl+Enter** | Follow a link — the focused one in a **preview**, or the one the caret sits inside in an **editor**. A terminal still gets Ctrl+Enter for the shell |
| **Shift+PageUp/PageDown**, **Ctrl+Home/End** | Scroll a terminal's scrollback |
| **Ctrl+F5** | Refresh / redraw the focused terminal |

**Synchronise Scrolling** (`preview.toggleSyncScroll`) — toggles two-way preview/editor scroll sync
from the focused editor or preview panel — ships with **no chord**; bind one in
**Preferences → Key Bindings** if you want it.

Focus and zoom are **per panel**: each terminal, editor and Find in Files panel zooms on its own, on
top of the app-wide zoom, and the setting persists with your layout. Keyboard focus moves *into and out of* terminals
and editors correctly — throng intercepts its own chords ahead of the shell.

Two entries look like a clash but aren't: **Ctrl+X** is *cut file* in the tree and *cut line* in an
editor. The scopes are disjoint, so only one ever fires.

**If you are upgrading.** These defaults moved: the window zoom from **Ctrl+=** / **Ctrl+-** /
**Ctrl+0** to **Ctrl+Shift+Alt++** / **-** / **Numpad0** — the *keypad* zero, not the main row; the
side-pane, focus, project, notice and tab-picker chords from **Ctrl+Alt+…** to **Ctrl+Shift+Alt+…**;
the panel zoom's own reset from **Ctrl+Alt+0** to **Ctrl+Alt+Numpad0**; **Ctrl+Wheel** and
**Ctrl+MiddleClick** from the window zoom to the panel under the pointer; and word wrap from
**Ctrl+Alt+W** to **Ctrl+E,W**. Plain **Ctrl++**, **Ctrl+-**, **Ctrl+0** and **Ctrl+Shift+0** are no
longer bound, and neither is the main-row **Ctrl+Shift+Alt+0** — only the keypad zero resets the
window zoom. The panel zoom resets from either zero (**Ctrl+Alt+Numpad0** or **Ctrl+Alt+0**). An existing install is moved to the new defaults on upgrade only where
you still had the old default for that command; a binding you changed is left exactly as you saved
it, and a new default is not applied where it would clash with one of your own bindings.

**On a keyboard that isn't UK or US.** The **Ctrl+Shift+Alt** chords follow the **key's position**,
not the character it prints, so they fire the same way on every layout — which has three
consequences:

- **Letters are the key in the US position.** On a French AZERTY keyboard, **Ctrl+Shift+Alt+M**
  (Focus File Explorer) is the key labelled **,**. B, N, J, K and V sit in the same place on AZERTY
  and QWERTZ as on a UK or US keyboard, so the three focus chords still run left to right.
- **The window zoom's + and - are the keys beside 0 on a US keyboard.** On German, Spanish and
  Italian layouts the keys labelled **+** and **-** sit elsewhere and don't fire it; on Nordic
  layouts the key labelled **+** is in the US **-** position, so Ctrl+Shift+Alt with it zooms
  **out**. The keypad **+** and **-** work on every layout regardless. **Resetting the window zoom
  needs the numeric keypad** — Ctrl+Shift+Alt+Numpad0 — on every layout; a laptop keyboard with no
  keypad has no keyboard route to reset the window zoom at all.
- **A few AltGr+Shift characters are taken.** Where AltGr+Shift types a character on a key a
  **Ctrl+Shift+Alt** chord uses, the chord wins and the character doesn't type: **Ń** (on N, Focus
  Workspace) on Polish (programmer's); **Ñ** (N) and **Þ** (T) on US-International; and **Ț** (T) on
  Romanian (Programmers). UK, German, French, Spanish, Italian and Nordic layouts lose none. B, M,
  J, K and V carry no AltGr+Shift character on any of these layouts, and no default uses P or F, so
  US-International's **Ö** (P) types. If you
  type one of these, rebind the chord in **Preferences → Key Bindings**. Characters typed with AltGr
  *without* Shift — **€**, **@**, **{**, **µ** and the rest — are unaffected.

The **Ctrl+Alt** panel chords, by contrast, follow the character, so they never take an AltGr
character — on a layout where AltGr makes **Ctrl+Alt+-** type something, use **Ctrl+Wheel** over the
panel instead. On a UK or US keyboard, **Ctrl+Alt++** also fires from the **=** key without Shift,
so stepping the panel zoom needs no keypad, and neither does resetting it: **Ctrl+Alt+0** on the
main row, or **Ctrl+MiddleClick** over the panel. Where AltGr+0 types a character (`}` on German,
`@` on AZERTY), it keeps typing it; use Ctrl+MiddleClick there.

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
