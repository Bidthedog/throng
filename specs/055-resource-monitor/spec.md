# Feature Specification: Resource Monitor — throng's Own Task Manager

**Feature Branch**: `feature/S055-I5-I133-resource-monitor`

**Created**: 2026-10-14

**Status**: Draft

**Input**: User description: "Resource monitor, covering
[#5](https://github.com/Bidthedog/throng/issues/5) (keep an eye on throng's own resource usage — CPU,
memory, processes — across the UI, daemon and terminals) and
[#133](https://github.com/Bidthedog/throng/issues/133) (an in-app manager for daemon-managed processes
and throng-held folder locks, with the ability to kill a process). The maintainer's statements override
the issues where they differ:

- Show every project and the process tree from that project: panels, terminals, the apps running in
  those terminals, and every subprocess of those apps (child processes, Claude sessions, Claude
  subagents, monitors, scripts and so on).
- Written for Windows, with a seam that makes Linux and macOS straightforward later.
- Overall throng memory, CPU, GPU and disk I/O on the right-hand side of the status bar.
- Clicking that usage opens a modal to filter and drill down into processes, CPU and memory — an
  authentic subprocess monitor where everything spawned from throng, separated by throng's components
  (UI, daemon, …), is reachable in an easily navigable form.
- The monitor must not affect throng's performance; offload collection to another process or the
  daemon and cache the results if needed.
- The modal is exclusive; Esc or the X at the top right closes it; it can be maximised; minimising
  closes it with a neat animation into the status-bar element, which is always present.
- The modal loads its real-time data asynchronously when opened. No hangs, no performance cost. It
  reports, lets the user drill down, and lets them kill specific processes.
- Like Windows Task Manager, but throng-specific. Each process has its own CPU, RAM, disk I/O and
  network, rolled up to its parent, and that to its parent.
- Hierarchy: throng component → panel → process → subprocess (to any depth) → resource usage. Every
  level shows the demand rolled up from its deepest descendant.
- Graphs and visualisations are welcome. No boring trees or lists — keep it visual."

## Intent

The monitor shows two things, and every requirement below serves one of them:

1. **throng's overall usage, per component** — how much the UI, the daemon and throng's helpers cost,
   so the user can see what throng itself costs to run.
2. **The breakdown of what the user controls** — their projects, tabs, panels and the processes running
   in them — so the user knows which part of their own work is taking up resources and can make workflow
   decisions about it (close a tab, stop a dev server, end a runaway build).

throng's own processes are measured and shown in (1) but are not the user's to manage: they are never
killable from the monitor. Everything the user started is in (2), and can be acted on there.

## Relationship to existing specifications

This feature is additive. It changes no shipped requirement, and must satisfy these:

| Requirement | What it binds here |
|---|---|
| 003 FR-003, 026 FR-024 – FR-025 | The status bar keeps its single line, height, theming and root-path content; the new item is added to the right side and shows none of the content 026 FR-024 removed |
| 029 FR-008 | The daemon indicator stays the daemon's state and restart control; the resource item does not replace or duplicate it |
| 025 FR-019a – h | Process observation is shared, never blocks, has its interval as a setting, and suspends work nobody is looking at |
| 051 FR-010 – FR-015a, FR-020, FR-021 | Every operating-system process query runs off the event loop, with a time limit, and fails safe |
| 029 FR-012 – FR-014 | How throng names its own terminals as the holders of a locked folder is unchanged |

## Clarifications

### Session 2026-10-14

- Q: Which issues does this feature cover? → A: **#5 and #133 together**, with the maintainer's
  statements (Input, above) overriding the issues where they differ.
- Q: Windows gives an unelevated process no per-process network byte counters — how should network be
  shown? → A: **Not at all.** No network capture in this feature; the maintainer's "each process will
  have its own … network" is withdrawn. (FR-030)
- Q: Is chart history kept while the modal is closed? → A: **No, for now** — history exists only while
  the modal is open, and charts start empty on each open. (FR-033)
- Q: May throng's de-elevation agent be killed, given every terminal it hosts ends with it? → A: **No.**
  (First answered "yes" on a misreading of "agent" as a Claude agent; revised the same session.) A
  Kill All Below confirmation lists the subprocesses that will end — Claude Code sessions included.
  (FR-062, FR-063)
- Q: What is the monitor for? → A: **Two things**: throng's overall usage per component, and the
  breakdown of the projects, tabs, panels and processes the user controls, so they can make workflow
  decisions. **Tab** is therefore a level of the breakdown, and throng's own processes — UI, daemon,
  console hosts, lock helpers, the de-elevation agent — are measured but never killable. (Intent,
  FR-020, FR-062, FR-070)
- Q: How often is data captured? → A: **Every 2 seconds at the fastest.** The interval is a Preferences
  setting, defaulting to and floored at 2 seconds, and is also changeable from inside the modal.
  (FR-004, FR-004a)
- Q: Do the status-bar totals include the processes the user runs in throng's terminals, or only
  throng's own? → A: **Everything "within" throng** — the grand total of all four components, Projects
  included; the hover tooltip splits it into UI, Daemon, Helpers and Projects. (FR-040, FR-042)
- Q: Claude Code subagents mostly run inside the `claude` process — does the monitor show only real OS
  processes? → A: **Yes, OS processes only.** The `claude` process is labelled "Claude Code" and its
  subagents' cost counts within it; the tools, scripts and monitors they spawn appear as its children.
  No reading of Claude Code's internal state. (FR-023a)
- Q: When the monitor is reopened, does it come back where the user left it? → A: **Yes, everything
  until throng restarts** — size (maximised or not), chosen metric, filter and drill-down position; if
  the node it was on has gone, it opens at the nearest surviving ancestor. Nothing persists across a
  restart. (FR-057)
- Q: How much chart history is kept while the modal stays open? → A: **A rolling window, set in
  Preferences: default 5 minutes, minimum 1, maximum 30**, with a hard block on values outside that
  range. (FR-033a)
- Q: What is the slowest capture interval allowed? → A: **60 seconds**, hard-blocked like the window.
  The **minimum** interval scales with the history window so the number of points kept stays bounded —
  5 minutes → 2 s, 10 minutes → 5 s, 30 minutes → 30 s — scaled sensibly between those for performance.
  (FR-004, FR-004b)
- Q: When the main window is too narrow for all four status-bar figures, what gives way? → A: **The
  figures drop one at a time in the order GPU, disk I/O, memory, CPU.** (FR-045)
- Q: Do figures change colour when usage is high? → A: **Yes, for CPU and memory, with the thresholds
  as Preferences settings** (default amber at 50%, red at 80%; memory as a share of installed RAM), in
  the status bar and on modal nodes. No notifications. (FR-046)
- Q: Must the monitor be fully usable from the keyboard? → A: **Yes.** Up and Down move between nodes
  at the current level; Right or Enter drills in; Left or Backspace goes up a level; the focused node's
  values show as they would on hover. (FR-068)
- Q: What counts as "idle" when hiding idle processes? → A: **CPU under 0.1% and no disk I/O across the
  last 3 samples**; a process whose memory is at or above the memory warning threshold is never hidden.
  (FR-061a)
- Q: When a process ends while the monitor is open, does its history stay? → A: **Yes, and the process
  itself stays in place** — greyed and struck through, with its history viewable — for as long as the
  modal is open; ended entries disappear when it closes. (FR-065, FR-065a)
- Q: Where does the Resource Monitor command live, and what is its default shortcut? → A: **The title
  bar's cog menu, in its application section, as "Resource Monitor" with a themeable icon; default chord
  `Ctrl+Shift+Alt+R`.** (FR-056)
- Q: Does the breakdown list every project, or only those with a running terminal? → A: **Every
  project added to throng.** Active and loaded projects come first; unloaded projects follow, greyed and
  italic exactly as in the project list. (FR-020c)
- Q: Do the monitor's kill confirmations get their own Preferences setting? → A: **Share throng's
  existing settings and names.** Each level offers throng's standard action, with its existing
  confirmation — **Unload Project** (046's unload behaviour), **Destroy Tab**, **Destroy Panel** — plus
  **Kill All Below** at every level, a force kill of every process beneath that node, a terminal's shell
  and all its descendants included (ending a terminal normally does not, for example, end a Claude Code
  session it started). The one new setting is the confirmation for killing processes. (FR-062 – FR-063b)
- Q: On a process, does Kill All Below end that process too? → A: **Yes.** On a project, tab or panel —
  which are UI elements, not processes — it ends only the processes inside: a project with 15 tabs of 4
  panels each keeps every tab and panel, and each terminal is left blank where its processes were.
  (FR-063a)
- Q: Are editors measured too? → A: **Yes — every panel is measured, not only terminals.** A large
  editor can cost real memory and CPU, and the user wants to see it. The user's component is therefore
  **Projects** (formerly "Terminals"), and its panels include editors and previews. (FR-020, FR-024)
- Q: If an editor's CPU cannot be estimated reliably, do editors show memory only? → A: **Memory is
  required; CPU is shown only where an estimate is proven sound, otherwise "not measured", with a
  follow-up issue.** Every figure shown must be as accurate as possible — an inaccurate measurement is
  useless. SC-009's 10% bound for editor memory estimates is confirmed by the maintainer.
  (FR-012, FR-024, SC-009)
- Q: Is a terminal panel also charged for the memory throng holds for it — its scrollback in the window
  and its screen buffer in the daemon? → A: **Yes**, as a separate "Terminal buffers" entry under the
  panel, moved out of the UI and Daemon figures and held to the same 10% bar as editors. (FR-024b,
  SC-009)

### Session 2026-10-15

Feedback after hand-testing the built feature, verbatim: *"Make the modal the same as the preferences
window - it should be moveable, I should be able to interact with throng in the background, and I should
be able to see changes reflected there as I make changes in throng. It should stay on top. The modal
should look the same as the preferences one, except minimise should be available."*

- Q: Is the monitor still an exclusive modal inside the main window? → A: **No — this reverses the
  2026-10-14 answer behind FR-050.** The monitor is its own window, built like the Preferences window:
  movable, looking the same as Preferences, with throng fully usable behind it, and every change made in
  throng reflected in it as it happens. It stays on top. In this spec, "the modal" in text written before
  this session means this window — the **monitor window**. (FR-081 – FR-086; supersedes FR-050, FR-053,
  FR-054; amends FR-056, FR-057)
- Q: "Stays on top" of what? → A: **As Preferences does: above throng's own windows while throng has
  focus, never above other applications**, and it minimises and restores with the main window. *(derived from the Preferences window, `packages/ui/src/main/preferences-window.ts`; not confirmed by the user)* (FR-083)
- Q: What do the window controls do? → A: **Preferences' controls — X closes, Maximise fills the screen,
  Restore returns — plus Minimise**, which keeps the meaning given when the feature was specified: the
  window closes with an animation that shrinks it into the status-bar figures, and under reduced motion
  closes without it. Esc still closes it. *(Minimise derived from the original request — "Minimising
  closes it with a neat animation to the bottom right status bar element that is always present" — not
  re-confirmed.)* (FR-084, FR-085)
- Q: Where do the monitor's actions run now that it is not inside a workspace window? → A: **Where they
  belong**: Unload Project in the main window, Destroy Tab and Destroy Panel in the window holding that
  tab or panel, each with its own confirmation, that window brought forward to show it; Kill asks in the
  monitor window. *(derived from FR-063 and the existing cross-window routing; not confirmed by the user)*
  (FR-086)

Second feedback the same day, verbatim: *"The UI in the monitor seems really slow, and the feedback is
really lacking. I don't know what I can click on, what is active, and what is refreshing. We need to do
better. … I am not sure how to use it."* The slowness and two display faults are defects against
SC-003 and Principle XII and change nothing here; what the spec never said is answered below.

- Q: How does a click on a tile or row behave? → A: **"Use buttons to drill down, use clicks to select
  items."** A click selects — the detail pane and charts follow it, and its tile and row show it — and a
  drill-down button on each tile and row with children opens it. The keyboard keeps Enter and Right to
  drill (2026-10-14). Double-clicking a row also opens it *(derived from the explorer tree and the existing rows; not confirmed by the user)*.
  (FR-088; amends FR-060's "click into to drill down")
- Q: How do tiles and rows behave as their figures change on every capture? → A: **Ranked by the chosen
  metric, but the order holds while the pointer is over the breakdown or a node is selected, and moves
  animate when it re-sorts** — nothing jumps under the mouse. (FR-090)
- Q: How much on-screen guidance does the monitor carry? → A: **Labels and a help button**: a header with
  the breadcrumb, Back and what sizes the tiles; column headers; a chart legend; "Updated <time> · every
  <n> s" with a pulse on each capture; and a "?" button explaining the keys, the colours and what
  Components and Projects are. (FR-091 – FR-093)
- Q: What does "responsive" mean, measurably? → A: **Typing in the filter, a click, a drill and a capture
  each finish their work within 100 ms with ~450 processes** *(derived from SC-003 and Principle XII, which the slowness breached; not confirmed by the user)*.
  (SC-010)
- Q: How are the breakdown's tiles coloured? → A: **"It should be colour coded by amount of resources it
  is taking - relative to the total system resources available to throng. So, something that takes 1% CPU
  would be a 'low' colour, something that takes 80% would be a 'high' colour."** Each tile's fill runs on
  a continuous scale from a low colour to a high colour by its share of the whole machine, for the metric
  sizing the tiles. The scale runs from the theme's `success` colour through `warning` at the warning
  threshold to `danger` at the critical threshold, so the tiles agree with FR-046's bands; GPU uses the CPU
  thresholds; I/O, which has no machine total, is scaled against the highest rate throng has reached since
  the window opened *(the scale's stops and the I/O basis are derived from FR-046 and the theme's existing
  colours; not confirmed by the user)*. (FR-094)

Third feedback the same day, verbatim: *"I get a lot of titles poping up as I move around the UI - they
flash up then dissapear because it keeps reloading. I thought we were pausing areas as we mouse over
them? I'm also not sure I like the large area chart things - they take up a lot of room and aren't that
intuitive. Make this into a two column modal - first column are the lists of things - components and
projects. Right column is the breakdown of the process and stats for the selected. Double clicking a row
on the left will drill-down in to it. Single clicking will show that row's stats on the right. Any
selection detail must me on the right."*

- Q: What pauses while the pointer is over part of the monitor? → A: **The whole list under the pointer —
  its order, its figures and its hover titles — not only its order**; it catches up when the pointer
  leaves. Hover titles name a thing and never carry a live figure, so a title cannot change under the
  pointer *(the second half derived from the complaint; not confirmed by the user)*. (FR-095; amends FR-090)
- Q: How is the monitor laid out? → A: **Two columns.** The left column holds the lists — Components and
  Projects at the top, the children of whatever the user has drilled into below that — with the
  breadcrumb and Back. The right column holds everything about the selected item. A single click on a row
  shows that row's detail on the right; a double-click drills into it. No selection detail appears
  anywhere but the right column. (FR-096, FR-097; supersede the treemap of FR-060 and amend FR-088)
- Q: What replaces the large stacked area charts? → A: **No stacked charts.** The right column shows the
  selected item's children as ranked, heat-coloured share bars, then its stats, then a small line graph
  per metric of the item's own usage over time — *"children as bars AND line graphs"*. (FR-097; supersedes
  the time-series charts of FR-060 and FR-092's chart legends)
- Q: Do rows keep the ▸ drill-down button? → A: **No — double-click only** (with Enter and Right from the
  keyboard). (FR-096; supersedes FR-088's drill-down button)

### Session 2026-10-23

Fourth feedback, after hand-testing the two-column monitor, verbatim:

> **Left pane:** Selecting a component or a a project should highlight that line - hover when selected
> does not need its own style. Either an entry is selected, or nothing is selected. Headers (CPU, memory,
> GPU, I/O) can be clicked on and will change the selected "Size by" option. "Size by" should be "Order
> By". The drop-down does not make sense as a UX component (Everything, components, all the projects) -
> remove it. The selected component information in the top panel is superflous, remove it. Mousing over
> each component should show a brief explaination of why that component exists and what is is
> responsible for. I *think* projects entry in the component list is essentially a top-level version of
> the second list (Projects). If this is the case, then the project list is superflous - the user can
> drill-down into the list as they need to. The component list should show a "total" at the bottom of the
> list for each column. We need a filter option that lets us "Hide ended processes". It should be on by
> default. The left-hand table should never create a horizontal scrollbar. If all columns cannot be
> comfortably displayed, columns should start dropping off the right side, with a visual indicator
> showing that there is missing info available. The user can move the middle divider or resize the
> window to see the details. When something is "Not Measured" it should just use a dash "-" instead of
> "Not measured". When a value is estimated, it should use the "~" prefix.
>
> **Right pane:** When a drilled-down element is selected, the user should be able to click an action
> button (next to the X) to activate the panel it belongs to in throng (if applicable). The drill-down
> elements should show all 4 stats at all times - they should not be limited by the size by option. CPU,
> RAM, GPU, I/O. When clicking on something in the right pane, the left pane should not change - the
> right pane is drill-down information for what is selected in the left pane.
>
> **General:** The divider between the two panes should be moveable. The filter, order by toolbar and
> breadcrumb should span the width of the full window and be separated by a horizontal rule / bottom
> border / divider. Panel titles should update as they change in the application - they seem to stay
> static, or refer to the terminal that is loaded. Use the panel title instead of the terminal title. Can
> we also add a network stat for each element?

Two items are **defects** and change nothing here: a hovered selected row losing its selected fill breaks
FR-089, and panel names that stay static or read as the terminal's shell break FR-020 and FR-082 (the
monitor builds panel names without the panel's title sources, so it never shows the title the panel's
own header shows).

- Q: What does selecting a row look like? → A: **Exactly one row is selected, or none.** The selected row
  keeps its selected look under the pointer; only unselected rows take a hover style. Up and Down move
  the selection itself *(derived — with the readout gone, the keyboard's row must be the selected one;
  not confirmed by the user)*. (FR-098; amends FR-089)
- Q: How does the user choose the ordering? → A: The metric control reads **"Order by"**, not "Size by",
  and **clicking a column header** — CPU, Memory, GPU, I/O, Network — orders by that metric; the header
  line reads "Ordered by <metric>" *(the header wording derived; not confirmed by the user)*. (FR-099;
  amends FR-092)
- Q: Does the monitor keep the "narrow to a component or project" drop-down? → A: **No — it is
  removed.** The filter, drill-down and ordering remain. (FR-100; supersedes FR-061's narrowing and the
  narrowing in FR-057)
- Q: Which "selected component information" goes? → A: **The left readout block** — the multi-line
  figures at the end of the left list, which repeat the right column. (FR-101; supersedes FR-068's
  readout clause)
- Q: What does hovering a component show? → A: A **one- or two-sentence explanation** of why it exists
  and what it is responsible for — for UI, Daemon, Helpers and Projects, and for each of throng's own
  process roles beneath them *(the roles derived from "each component"; not confirmed by the user)*.
  (FR-102)
- Q: Is the Projects list the same as the Projects component's drill-down? → A: **Yes** — the second list
  is exactly that row's children, pre-expanded. **The top level now lists the four components only**;
  the user drills into Projects for their projects. This reverses the 2026-10-15 answer placing
  "Components and Projects at the top". (FR-103; supersedes FR-020b and part of FR-096)
- Q: Does a list show a total? → A: **Yes — a Total row at the bottom of every list**, per column: the
  rolled-up figure of the node whose children are listed. It still counts rows the filter or hiding
  removes, and says how many *(that rule derived from SC-006; not confirmed by the user)*. (FR-104)
- Q: Are ended processes shown? → A: A **"Hide ended processes"** option, **on by default**; off, they
  show greyed and struck through as before. This reverses the 2026-10-14 answer that an ended process
  "stays in place … for as long as the modal is open". (FR-105; amends FR-065a and FR-061)
- Q: What happens when the left list is too narrow for its columns? → A: **It never scrolls
  sideways.** Figure columns drop off the right edge, one at a time, and a marker in the header says
  columns are hidden; widening the list or window brings them back. The name never drops, and the
  Order-by column drops last *(derived; not confirmed by the user)*. (FR-106; amends FR-096)
- Q: How are "not measured" and estimated figures written? → A: **"-"** for a figure that is not
  measured, and **"~"** before an estimated one ("~12.4 MB"), each explained in its hover title. An
  unavailable figure also shows "-" *(derived — so every column stays narrow; not confirmed by the
  user)*. (FR-107; supersedes the wording of FR-012 and FR-024, and amends FR-011's rendering)
- Q: What does a click in the right column do? → A: *"The right pane should show the stats for the left
  pane's selection. This should include all its children. The right pane cannot drill-down further - it
  offers options on the selected option only, including kill, unload, terminate terminal(s), destroy tab
  / panel, and activate (go to the project / tab / panel in throng). When something is activated, the
  resource monitor stays open and on top."* The right column's children are read-only, and the left
  column never changes from it. "Terminate terminal(s)" is the existing **Kill All Below** *(derived;
  not confirmed by the user)*. This reverses the 2026-10-15 answer that clicking a child selects it on
  the left. (FR-108, FR-110; supersedes part of FR-097)
- Q: Which figures does each child in the right column show? → A: **All of them, always** — CPU, Memory,
  GPU, I/O and Network — with the bar's length and colour following Order by. (FR-109; amends FR-097)
- Q: Can the user resize the two columns? → A: **Yes — the divider between them can be dragged**, and
  moved from the keyboard when focused; each column keeps a minimum width, and the position is restored
  with the window's view *(the keyboard and restore derived; not confirmed by the user)*. (FR-111)
- Q: Where do the filter, toolbar and breadcrumb sit? → A: **Across the full width of the window**, above
  both columns, separated from them by a rule, and they never scroll with the list. (FR-112; supersedes
  FR-096's placement and amends FR-068's Tab order)
- Q: Is network measured? → A: **Yes, exactly, when throng runs elevated**; unelevated, the figure shows
  "-" and its hover title says **"Elevate to show"**. Windows gives an unelevated process no per-process
  network counter, so exact figures need the kernel's network tracing, which needs elevation. Network
  is a column, an Order-by choice and a line graph like the others; the status bar is unchanged
  *(the status bar and the Order-by details derived — the request was "for each element"; not
  confirmed by the user)*. This reverses the 2026-10-14 answer "Not at all". (FR-113, SC-011;
  supersede FR-030's exclusion and the Out of scope entry)
- Q: What does a graph show before it has enough history? → A: *"I'd also like to change the graph
  loading to a loading spinner, because it looks awful as the resource monitor graphs load in. It says
  "Building history", and all the text overlaps."* **A loading spinner** in the graph's place, with no
  text; the graph appears when it has two points. Sparklines in the rows do the same *(the sparklines
  derived; not confirmed by the user)*. (FR-114; supersedes FR-091's "say they are building their
  history")

## User Scenarios & Testing *(mandatory)*

### User Story 1 - See throng's total load at a glance (Priority: P1)

While working, the user glances at the right-hand side of the status bar and sees how much CPU,
memory, GPU and I/O throng is using in total — the app itself, the daemon, every terminal and
everything running inside those terminals. The figures stay current without the user doing anything,
and watching them costs throng nothing the user can feel.

**Why this priority**: It answers the most common question ("is throng — or something I started in
it — why my machine is slow?") with zero interaction, and it is the entry point to everything else.

**Independent Test**: Start a CPU-heavy command in a terminal; the status-bar CPU figure rises within
a few seconds and falls again after the command ends, with no added typing latency in any panel.

**Acceptance Scenarios**:

1. **Given** throng is open with terminals running, **When** the user looks at the status bar, **Then**
   its right side shows throng's total CPU, memory, GPU and I/O, each with a recognisable icon and
   a hover title.
2. **Given** a terminal starts a process that uses heavy CPU, **When** a refresh interval passes,
   **Then** the CPU figure includes that process's usage.
3. **Given** the item is showing, **When** the user hovers over it, **Then** a tooltip breaks the totals
   down by throng component.
4. **Given** the daemon has stopped, **When** the status bar renders, **Then** the item still shows what
   it can measure and marks the daemon-side totals as unavailable, and the daemon indicator still owns
   the restart.

---

### User Story 2 - Drill into where the load comes from (Priority: P1)

The user clicks the status-bar item. An exclusive modal opens immediately and fills in with live data
as it arrives. It answers two questions. **What does throng cost?** — usage per component: the UI, the
daemon, and throng's helpers. **What is my work costing?** — every project, each project's tabs, each
tab's panels — editors and previews as well as terminals — and, in each terminal, the program running
in it and that program's descendants at any depth: a Claude Code session and its tools, a dev server
and its workers, a script and what it spawned. Every
level shows its own usage plus everything beneath it, and the presentation is visual: charts of usage
over time and proportional breakdowns, not a bare table. The user filters by name or command, narrows
to a project, and drills down level by level until they find the tab, panel or process responsible —
and decides what to do about it.

**Why this priority**: This is the feature. A total without a breakdown tells the user something is
wrong but not what.

**Independent Test**: With two projects open, each with two tabs holding terminals running nested
process trees, open the monitor and drill from one project, to one tab, to one panel, to the deepest
process; at every level the figure shown equals the sum of its children plus its own usage.

**Acceptance Scenarios**:

1. **Given** the status-bar item, **When** the user clicks it, **Then** the modal opens without delay,
   shows a loading state where data is still arriving, and never blocks input to the modal or the
   window.
2. **Given** the modal is open, **When** it has loaded, **Then** it shows throng's usage per component
   and the user's usage per project, each with rolled-up CPU, memory, GPU and I/O, and a chart of
   each since the modal opened.
3. **Given** a project, **When** the user drills in, **Then** they see its tabs by name, each tab's
   panels by name, and under each terminal panel its shell and the shell's descendants to any depth.
4. **Given** a tab holding a large file open in an editor, **When** the user drills into the tab,
   **Then** the editor panel shows its own memory, marked as estimated, and its CPU where FR-024
   allows it, otherwise "not measured".
5. **Given** a component, **When** the user drills in, **Then** they see the processes that make it up,
   each by role (e.g. "Main window", "GPU", "Console host", "Folder lock — <project>"), with no kill
   action.
6. **Given** any level, **When** the user inspects a node, **Then** its figures are its own usage plus
   all its descendants', and a proportional visual shows how that total divides among its children.
7. **Given** the modal, **When** the user types in the filter, **Then** only processes whose name,
   command line or process id match remain visible, each still shown under its ancestors so its place
   in the hierarchy is clear.
8. **Given** a process is selected, **When** the user views its detail, **Then** they see its name,
   process id, full command line, executable path, start time, running time, owning project, tab and
   panel (or owning component, for throng's own processes), and a chart of its usage over the time the modal has been open.
9. **Given** a Claude Code session is running in a terminal, **When** the user drills into that panel,
   **Then** the session and every process it started (tools, scripts, monitors — including those its subagents launch)
   appear beneath it.
10. **Given** the monitor, **When** the user points at a tile or row, **Then** the cursor and the tile or
   row show it can be clicked, amber and red ones included; **When** they click it, **Then** it is selected —
   marked with an accent edge on both its tile and its row — and the detail pane and charts describe it;
   nothing else is marked. (FR-088, FR-089)
11. **Given** a tile or row with children, **When** the user clicks its drill-down button (or presses Enter
   or Right on it, or double-clicks the row), **Then** the breakdown opens at it; a process with no
   children has no drill-down button. Right-clicking a tile opens the same menu as its row. (FR-088)
12. **Given** the monitor is open, **When** a capture arrives, **Then** "Updated <time> · every <n> s"
   changes and pulses once; **While** the pointer is over the breakdown, **Then** no tile or row changes
   place; **When** the pointer leaves with nothing selected, **Then** they move to their new ranks with a
   short animation (none under reduced motion); **When** a node is selected, **Then** the order holds until
   the selection is cleared. (FR-088, FR-090, FR-091)
   *Amended (Session 2026-10-15, third feedback): "tile" now reads "row or bar"; scenario 18 states the hold (FR-095).*
13. **Given** the monitor, **When** the user looks at it for the first time, **Then** a header names where
   they are, with a Back button and "Tile size: <metric>"; the rows have column headers with the chosen
   metric's column marked; each chart has a legend naming its bands and names the node it plots; and the
   "?" button explains the mouse, the keys, the colours and what Components and Projects are.
   (FR-092, FR-093)
   *Amended (Session 2026-10-15, third feedback): "Tile size" reads "Sorted by", and the chart legends are gone with the charts (FR-097).*
14. **Given** about 450 processes, **When** the user types in the filter, **Then** each keystroke shows
   in the field at once and the matches follow within 100 ms, each process listed once. (SC-010)
15. **Given** tiles sized by CPU, **When** one process takes about 1% of the machine and another about 80%,
   **Then** the first tile is drawn in the low colour and the second in the high colour, with a key beside
   the tiles showing the scale; **When** the user sizes by memory, **Then** the colours follow each node's
   share of installed RAM. (FR-094)
   *Amended (Session 2026-10-15, third feedback): the tiles are gone; the same colours fill the share bars on the right (FR-097).*
16. **Given** the monitor, **When** it opens, **Then** it has two columns: the lists on the left
   (Components, then Projects) and, on the right, the detail of the selected item — or of the level shown
   on the left when nothing is selected. (FR-096)
   *Amended (Session 2026-10-23): the top level lists the four components only (scenario 23, FR-103).*
17. **Given** a row on the left, **When** the user single-clicks it, **Then** the right column shows its
   children as ranked, coloured share bars, its stats and a small line graph per metric, and the row is
   marked; **When** they double-click it, **Then** the left column drills into it and the breadcrumb
   updates. No row carries a drill-down button. (FR-096, FR-097)
   *Amended (Session 2026-10-23): each child in the right column shows all its figures, and clicking one changes nothing (FR-108, FR-109).*
18. **Given** the pointer resting on a row on the left, **When** captures arrive, **Then** the left list's
   order and figures stay still and a hover title stays up until the pointer moves; **When** the pointer
   leaves the list, **Then** it catches up to the latest figures. The right column keeps updating
   throughout. (FR-095)
19. **Given** a row is selected, **When** the user moves the pointer over it, **Then** it keeps its
   selected look; **When** they click another row, **Then** only that row is selected; **When** they click
   the selected row again, **Then** nothing is selected. (FR-098)
20. **Given** the list is ordered by CPU, **When** the user clicks the Memory column header, **Then** the
   list re-orders by memory, the Memory header is marked, and the toolbar's control, labelled "Order by",
   shows Memory. (FR-099)
21. **Given** the monitor, **When** the user looks for a way to narrow it to one component or project,
   **Then** there is none, and no block of the selected row's figures appears in the left column.
   (FR-100, FR-101)
22. **Given** the top level, **When** the user rests the pointer on Daemon, **Then** its title explains
   that the daemon keeps terminals running when throng's windows close and what else it is responsible
   for; each of UI, Helpers and Projects explains itself the same way. (FR-102)
23. **Given** the monitor opens, **When** the user looks at the left column, **Then** it lists UI,
   Daemon, Helpers and Projects only; **When** they double-click Projects, **Then** their projects are
   listed. (FR-103)
24. **Given** any list, **When** the user looks at its bottom, **Then** a Total row shows each column's
   figure for the level, equal to the node the list belongs to; **When** the filter hides some rows,
   **Then** the Total is unchanged and says how many rows are hidden. (FR-104)
25. **Given** a process ends while the monitor is open, **When** the next capture arrives, **Then** it
   leaves the list, because Hide ended processes is on; **When** the user turns it off, **Then** the ended
   process shows greyed and struck through, counted in no total. (FR-105)
26. **Given** the left list is wide enough for every column, **When** the user narrows the window or drags
   the divider left, **Then** figure columns drop off the right one at a time, a marker shows columns are
   hidden and names them on hover, and no horizontal scrollbar appears; **When** the user widens it
   again, **Then** they return. (FR-106, FR-111)
27. **Given** an editor panel's row, **When** the user reads its figures, **Then** its memory reads like
   "~12.4 MB" and its CPU, GPU and I/O read "-", each explained by its hover title. (FR-107)
28. **Given** a project selected on the left, **When** the user clicks one of its tabs in the right
   column, **Then** nothing changes in either column: the right column still describes the project.
   (FR-108)
29. **Given** a project selected and the list ordered by CPU, **When** the user reads its tabs in the
   right column, **Then** each tab shows its CPU, Memory, GPU, I/O and Network figures, and only the bars
   follow CPU. (FR-109)
30. **Given** a terminal panel selected on the left, **When** the user clicks Activate in the right
   column's header, **Then** the window holding the panel comes forward with that panel's project and tab
   showing and the panel focused, and the monitor window stays open above it; **When** a process is
   selected instead, **Then** Activate goes to its panel. UI, Daemon and Helpers rows offer no Activate.
   (FR-110)
31. **Given** a project selected, **When** the user opens the right column's actions, **Then** they find
   Unload Project, Kill All Below and Activate, and the row's menu offers the same. (FR-110)
32. **Given** the monitor window, **When** the user drags the divider, **Then** the columns resize, each
   stopping at its minimum width; **When** the monitor is closed and reopened, **Then** the divider is
   where it was left. (FR-111)
33. **Given** a long list scrolled down, **When** the user looks at the top of the window, **Then** the
   filter, toolbar and breadcrumb still span the full width above both columns, separated from them by a
   rule. (FR-112)
34. **Given** throng runs elevated and a terminal is downloading a file, **When** the user reads that
   terminal's row, **Then** its Network figure shows the transfer rate and matches Windows Resource
   Monitor within 10%; **Given** throng is not elevated, **Then** every Network figure reads "-" and its
   hover title says "Elevate to show". (FR-113, SC-011)
35. **Given** the monitor has just opened, **When** the user selects a row before two captures have
   arrived, **Then** each line graph on the right shows a loading spinner in its place, with no text and
   nothing overlapping, and becomes the graph at the second capture. (FR-114)

---

### User Story 3 - Act on what is costing too much (Priority: P2)

Having found the part of their work that is eating CPU or memory, the user acts on it from the monitor,
at whatever level they found it. They can do what they would do anywhere else in throng — unload the
project, destroy the tab, destroy the panel — with the same confirmations they already have. Or they
can force-kill everything running beneath that node with **Kill All Below**, which also reaches processes
an ordinary terminal end leaves behind — one that was re-parented and detached from the terminal's
console, such as a server or tool a Claude Code session started in the background. On a
single process they can also kill just that process. The monitor reflects the result straight away.
Only the user's own work can be acted on; throng's own processes cannot.

**Why this priority**: Without it, finding the culprit sends the user to Task Manager anyway. #133's
core ask.

**Independent Test**: Start a long-running child process under a shell, kill it from the monitor; it
stays in place marked as ended, its usage leaves its ancestors' live totals, and the shell above it
keeps running.

**Acceptance Scenarios**:

1. **Given** a selected descendant process, **When** the user chooses Kill Process and confirms,
   **Then** that process ends and is shown in place as ended (FR-065a), and its parent keeps running.
   *Amended (Session 2026-10-23): with Hide ended processes on, the default, it leaves the list at the next capture instead (FR-105).*
2. **Given** a selected process with descendants, **When** the user chooses Kill All Below and
   confirms, **Then** it and every descendant end.
3. **Given** a panel whose terminal is running Claude Code, **When** the user chooses Kill All Below on
   the panel and confirms, **Then** the shell, the Claude Code session and everything it started end,
   and the panel stays, in the state any shell exit leaves it in.
4. **Given** a tab, **When** the user chooses Destroy Tab, **Then** it behaves exactly as Destroy Tab
   does from the tab strip, with the same confirmations (`confirmations.destroyTab`).
5. **Given** a project, **When** the user chooses Unload Project, **Then** it behaves exactly as Unload
   Project does from the project list, including what happens to its terminals.
6. **Given** a Kill All Below confirmation, **When** it is shown, **Then** it names the node and lists the
   processes that will end; Esc cancels.
7. **Given** one of throng's own processes is selected, **When** the user looks for an action, **Then**
   there is none.
8. **Given** a terminal's own shell is killed, **When** it ends, **Then** the panel behaves exactly as
   it does when its shell exits for any other reason.
9. **Given** a kill fails (access denied, the process already gone), **When** it is reported, **Then**
   one inline notice in the modal says what failed and why, in plain terms.

---

### User Story 4 - See which folders throng is holding, and why (Priority: P3)

The user cannot move or delete a project folder because throng holds it. In the monitor they see each
folder throng is holding and which project's terminals it is held for — and therefore what to close to
release it. The lock itself is throng's, so the monitor does not end it directly.

**Why this priority**: #133's second ask, narrowed by the Intent: the user's decision is which of their
terminals to close, and the monitor tells them which ones matter.

**Independent Test**: Open two terminals in a project; the monitor lists that project's root as held,
naming both terminals. Close both; the folder disappears from the list and can be renamed in the OS file
manager.

**Acceptance Scenarios**:

1. **Given** a project has a terminal open, **When** the user opens the monitor, **Then** the project's
   root folder appears as held, naming the project and every terminal panel (by tab and panel name) that
   keeps it held.
2. **Given** a held folder, **When** the user selects one of the terminals named against it, **Then** the
   monitor drills to that panel in the breakdown, where its shell can be killed.
3. **Given** the last terminal holding a folder ends, **When** the next sample arrives, **Then** the folder
   is no longer listed.

---

### User Story 5 - Keep the monitor in view while working (Priority: P3)

The user maximises the modal to see more of the hierarchy and its charts, restores it, or minimises it
— which closes it with an animation that shrinks it into the status-bar item, so the user can see where
it went and how to get back. Reopening shows current data.

**Why this priority**: Comfort and discoverability; the monitor is useful without it.

**Independent Test**: Open, maximise, restore, minimise; the modal animates into the status-bar item and
reopens from it.

**Acceptance Scenarios**:

1. **Given** the modal is open, **When** the user presses Esc or clicks the X at its top right, **Then**
   it closes.
2. **Given** the modal is open, **When** the user clicks Maximise, **Then** it fills the window; **When**
   they click Restore, **Then** it returns to its previous size.
   *Superseded by scenario 6 (Session 2026-10-15) — the monitor is its own window.*
3. **Given** the modal is open, **When** the user clicks Minimise, **Then** it animates down into the
   status-bar item and closes; under reduced motion it closes without the animation.
   *Superseded by scenario 7 (Session 2026-10-15) — the same behaviour, from the monitor window.*
4. **Given** the modal is open, **When** the user tries to interact with the workspace behind it,
   **Then** nothing behind it responds until it closes.
   *Superseded by scenario 5 (Session 2026-10-15) — throng stays usable behind the monitor window.*
5. **Given** the monitor window is open, **When** the user clicks into a terminal behind it and types,
   opens a tab, or unloads a project, **Then** throng responds normally, the monitor window stays above
   it, and the change appears in the monitor at its next capture — a new process, a new tab, a project
   greyed. (FR-082, FR-083)
6. **Given** the monitor window is open, **When** the user drags its title bar, **Then** it moves;
   **When** they click Maximise, **Then** it fills the screen; **When** they click Restore, **Then** it
   returns to its previous size and place. It looks like the Preferences window, with a Minimise control
   besides. (FR-081, FR-084)
7. **Given** the monitor window is open, **When** the user clicks Minimise, **Then** it animates down into
   the main window's status-bar figures and closes; under reduced motion it closes without the
   animation. (FR-085)
8. **Given** the monitor window is open, **When** the user switches to another application, **Then** the
   monitor goes behind that application with the rest of throng; **When** they return to throng, **Then**
   it is above throng's windows again. (FR-083)
9. **Given** the monitor window was moved and closed, **When** the user opens it again — from the status
   bar, the cog or `Ctrl+Shift+Alt+R`, in any window — **Then** the one monitor window opens where it was
   left, at the same size, on the same view; opened while already open, it comes forward instead.
   (FR-086, FR-087)

---

### Edge Cases

- **A process outlives its parent.** A detached or re-parented process (a server started in the
  background, a GUI app launched from a shell, Git Bash's re-parented children) stays under the panel
  it came from for as long as it lives, rather than vanishing or floating loose.
- **Process id reuse.** A new, unrelated process that takes a dead process's id is never shown as that
  process's child, nor attributed to its panel.
- **Short-lived processes.** A process that starts and ends between two samples may be missed; the
  monitor never claims a complete history of every process.
- **A process throng cannot read.** An elevated or protected process whose figures throng is not allowed
  to read is still shown in its place, with its figures marked "unavailable" rather than zero, and with
  the reason in its hover title.
- **The elevation agent.** When throng runs elevated, terminals are hosted by a de-elevated agent; its
  terminals and their descendants appear under their panels exactly as directly-hosted ones do, and
  the agent itself appears under the Helpers component, measured but not killable.
  Anything that genuinely cannot be enumerated is shown as a named limitation in the modal, never
  silently omitted.
- **The daemon stops while the modal is open.** Daemon-side data is marked stale with its age, and the
  modal recovers when the daemon returns, without being reopened.
- **Very large trees.** A build that spawns hundreds of processes stays navigable: the visual groups
  small contributors rather than drawing hundreds of slivers, and the modal stays responsive.
- **Sub-workspace windows.** A panel in a sub-workspace appears under its origin project, in a tab node
  named for the sub-workspace and its tab (e.g. "Scratch › Tab 2"), so it is never confused with a tab
  of the project's own workspace.
- **Rootless terminals.** A terminal with no project appears in an explicit "No project" group, under
  its tab.
- **Tabs without terminals.** A tab holding only editors and previews is listed like any other; its
  panels carry the estimated figures of FR-024.
- **Sampling fails.** A failed or timed-out sample keeps the previous figures, marks them stale, and
  never raises a notice per failure (one condition, one notice).
- **Killing throng itself.** None of throng's own processes — UI, daemon, console hosts, lock helpers,
  the de-elevation agent — can be killed from the monitor; see FR-062.

## Requirements *(mandatory)*

### Functional Requirements

#### Collection and performance

- **FR-001**: Resource figures MUST be collected outside every process that renders UI or handles
  terminal input, and every operating-system query it makes MUST run off the event loop with a time
  limit (051 FR-010).
- **FR-002**: The status-bar item and the modal MUST read from collected, cached figures; neither may
  wait on a fresh operating-system query to draw.
- **FR-003**: Collection MUST run in two modes: a **summary** mode — totals per throng component — that
  runs while throng is open, and a **detailed** mode — the full per-process hierarchy — that runs only
  while the modal is open and stops when it closes.
- **FR-004**: One **capture interval** governs both modes. It MUST be a setting in Preferences, in whole
  seconds, defaulting to **2 seconds**, with a **maximum of 60 seconds** and a minimum set by the
  history window (FR-004b); 2 seconds is the fastest capture ever offered. The range is a hard block,
  enforced exactly as FR-033a enforces the window's.
- **FR-004a**: The modal MUST offer a control to change the capture interval. That control writes the
  same setting as Preferences (one value, two editors), offers only values the current history window
  allows (FR-004b), and the new interval takes effect from the next sample.
- **FR-004b**: The capture interval's minimum MUST depend on the history window (FR-033a), so that no
  more than 150 points per node are ever kept:

  | History window | Minimum capture interval | Most points kept |
  |---|---|---|
  | 1 – 5 minutes | 2 seconds | 150 |
  | 6 – 10 minutes | 5 seconds | 120 |
  | 11 – 20 minutes | 15 seconds | 80 |
  | 21 – 30 minutes | 30 seconds | 60 |

  When the window is lengthened past the current interval's band, the interval MUST be raised to the
  new minimum, and Preferences MUST say so beside the interval. A hand-edited pair that breaks the
  table MUST resolve the same way: the window stands and the interval is raised to its minimum.
- **FR-005**: Collection MUST add no read to throng's existing process observation (025 FR-019a/b):
  it takes one process-table reading of its own per tick, through a call cheap enough to meet SC-004,
  rather than a second copy of the observation's reads.
- **FR-006**: Collection MUST NOT measurably affect throng's responsiveness: typing latency and frame
  timing with the monitor open MUST stay within the bounds of SC-003.
- **FR-007**: The monitor's own collection MUST be counted in throng's totals, under the component that
  does it, so its cost is visible rather than hidden.

#### Platform seam

- **FR-010**: Everything that enumerates processes, reads per-process figures, reads machine-level GPU
  and I/O figures, or ends a process MUST sit behind platform-neutral interfaces. Windows is the only
  implementation in this feature; the rest of throng MUST hold no Windows-specific knowledge about it.
- **FR-011**: A platform that cannot supply a metric MUST report it as unavailable, and the UI MUST
  render "unavailable" for it — so a future platform can ship with a partial set of metrics.
  *Amended by FR-107 (Session 2026-10-23): an unavailable figure is shown as "-", the reason in its hover title.*
- **FR-012**: **Accuracy over coverage.** A figure MUST be shown only when the method producing it has
  been validated against the operating system's own measurement of the same thing; otherwise it MUST
  show "not measured". A plausible-looking but unvalidated number MUST NOT be shown.
  *Amended by FR-107 (Session 2026-10-23): "not measured" is shown as "-", the reason in its hover title; the rule itself stands.*

#### Hierarchy and roll-up

- **FR-020**: The monitor MUST show a single hierarchy rooted at throng, whose first level is
  **component**. There are four components, and every process throng measures belongs to exactly one:
  - **UI** — the application process and its renderer, GPU and utility processes, each by role
    (e.g. "Main window", "Preferences", "GPU").
  - **Daemon** — the daemon process itself.
  - **Helpers** — throng-owned processes that serve terminals but are not the user's: each terminal's
    console host (labelled with its panel), each folder-lock helper (labelled with its project), the
    monitor's own collector (FR-007) and, when throng is elevated, the de-elevation agent.
  - **Projects** (formerly referred to as "Terminals") — the user's work: **project → tab → panel**,
    and under each terminal panel **process → subprocess (to any depth)**. Each tab and panel is shown
    by its name, and every panel kind appears: terminals, editors and previews (FR-024).
- **FR-020a**: UI, Daemon and Helpers are **throng's own** processes: measured, shown, never killable.
  The only processes in Projects are those the user started — each terminal's shell and its
  descendants — and only these are killable (FR-062).
- **FR-020b**: The modal MUST present both halves of the Intent from its first view: throng's usage per
  component, and the user's usage per project.
  *Superseded by FR-103 (Session 2026-10-23) — the top level lists the components; the user drills into Projects for their projects.*
- **FR-020c**: Projects MUST list **every project added to throng**, whether or not it has open panels, in this order: the active project, then the other loaded projects, then unloaded projects
  (046's definitions). Unloaded projects MUST use the project list's greyed, italic style (006 FR-051).
  Within each of those groups, projects follow the chosen ordering metric (FR-061), ties in project-list
  order. A project with nothing measured — no running terminal and no open editor or preview — shows
  zero figures and takes no share of the proportional breakdown. An unloaded project whose terminals were kept running (046) shows them
  like any other.
- **FR-021**: Each process MUST be attributed to the panel whose shell it descends from. A process whose
  parent has ended MUST remain under that panel for as long as it lives (Edge Cases), and a reused
  process id MUST never be attributed to a dead process's place in the tree.
- **FR-022**: Every node MUST carry its own figures and its **rolled-up** figures — its own plus every
  descendant's — for each metric. Every level above it MUST roll up the same way, to throng's total.
- **FR-023**: Processes MUST be labelled by a friendly name where one is recognised — at minimum shells,
  Node, Claude Code, Git, Python, PowerShell and the console host — with the executable name and full
  command line always available on the node.
- **FR-023a**: Every node below a panel MUST be an operating-system process. Work that runs inside a
  process without a process of its own — such as a Claude Code subagent — is counted within that
  process and is not shown as a node; the processes such work spawns appear as that process's
  descendants like any other.
- **FR-024**: Editor and preview panels MUST be measured too. They run inside a window's renderer
  process rather than as processes of their own, so each such panel MUST show an **estimate** of the
  memory attributable to it, visibly marked as estimated and meeting SC-009. Its **CPU** MUST be shown
  only if the plan establishes an attribution method that meets FR-012; otherwise it shows "not
  measured", and a follow-up issue tracks it. I/O and GPU are not attributed to them and show as
  "not measured". Each estimate is **moved, not copied**, out of the renderer process
  it came from: that renderer's node in the UI component shows what remains unattributed, so no usage is
  counted twice and every total still sums to what the operating system reports (SC-006).
  *Amended by FR-107 (Session 2026-10-23): an estimate is marked with "~" before the figure, and "not measured" is shown as "-".*
- **FR-024a**: Editor and preview panels have no processes, so no kill action; their standard action is
  Destroy Panel (FR-063).
- **FR-024b**: A terminal panel MUST also carry a **"Terminal buffers"** entry beside its shell: an
  estimate of the memory throng holds for that terminal — its scrollback in the window's renderer and
  its screen buffer in the daemon — visibly marked as estimated and meeting SC-009. Like FR-024, it is
  **moved, not copied**, out of the renderer and daemon nodes it came from, so no usage is counted twice.
  It carries memory only; it is not a process, has no kill action, and is unaffected by Kill All Below
  except as the ended processes' output stops growing it.

#### Metrics

- **FR-030**: Each process MUST report: CPU (as a share of the whole machine), memory (private working
  set), **I/O** read and write rates (all file and device I/O the process performs — Windows does not
  separate disk from other I/O for an unelevated reader, so the figure is labelled I/O, not disk), and
  GPU usage. **Network is not captured** in this feature
  (Clarifications, 2026-10-14).
  *Its network exclusion is superseded by FR-113 (Session 2026-10-23) — network is measured when throng runs elevated.*
- **FR-031**: Rates MUST be averages over the interval since the previous sample, not instantaneous
  readings.
- **FR-032**: Every quantity MUST be shown with digit grouping and a unit that keeps it readable (KB,
  MB, GB; KB/s, MB/s) through the shared quantity formatter (constitution, *Digit-grouped quantities*).
- **FR-033**: Chart history MUST be kept **only while the modal is open**: charts start empty on each
  open, accumulate one point per sample, and are discarded on close. Summary mode keeps no history —
  only its latest totals.
- **FR-033a**: While the modal is open, history MUST be a **rolling window**: points older than the
  window are dropped. The window length MUST be a Preferences setting in whole minutes, **default 5,
  minimum 1, maximum 30**. The range is a hard block: the Preferences editor MUST NOT accept a value
  outside it, and an out-of-range value written to the settings file by hand MUST be clamped to the
  nearest bound, as every bounded setting already is (`docs/preferences.md`).

#### Status-bar item

- **FR-040**: The main window's status bar MUST show, on its right side and always present, throng's
  total CPU, memory, GPU and I/O, each as an icon plus a value, with a hover title naming the
  metric (constitution, *Themeable icon controls*). "Total" means **everything within throng**: the sum
  of all four components, Projects included.
- **FR-041**: The item MUST NOT replace, move or duplicate the daemon indicator (029 FR-008), and MUST
  add none of the content 026 FR-024 removed.
- **FR-042**: Hovering the item MUST show a breakdown of each total by component — UI, Daemon, Helpers
  and Projects.
- **FR-043**: Clicking the item MUST open the monitor modal (FR-050).
  *Amended by FR-086 (Session 2026-10-15) — it opens the monitor window, or brings it forward.*
- **FR-044**: A total whose source is unavailable or stale MUST be shown as such, never as zero.
- **FR-045**: When the status bar is too narrow to show every figure, figures MUST be dropped one at a
  time in this order: **GPU, then I/O, then memory, then CPU**, and restored in reverse as width
  returns. With every figure dropped, the item MUST remain as its icon alone, still opening the modal.
  The hover breakdown (FR-042) MUST always show all four, whatever is visible.
- **FR-046**: CPU and memory figures MUST be coloured by usage band — **normal**, **warning** and
  **critical** — in the status bar and on every node in the modal, using theme colours (no literal
  colours). CPU is measured as a share of the whole machine and memory as a share of installed RAM;
  a node is banded by its rolled-up figure. Four Preferences settings hold the thresholds: CPU warning
  (default 50%), CPU critical (default 80%), memory warning (default 50%), memory critical (default
  80%). Each is a whole percentage from 1 to 100 and each warning MUST be below its critical. The range
  is enforced as FR-033a enforces the history window; a hand-edited warning at or above its critical is
  lowered to one below it. Crossing a threshold raises no
  notification. Colour MUST NOT be the only signal: a banded figure also carries its band in its hover
  title.

#### The modal

- **FR-050**: The monitor MUST open as an **exclusive** modal in the main window: nothing behind it
  responds while it is open.
  *Superseded by FR-081 and FR-082 (Session 2026-10-15) — the monitor is its own non-blocking window.*
- **FR-051**: It MUST open immediately, showing a loading state for any data not yet collected, and
  fill in asynchronously. Opening it MUST never block input.
- **FR-052**: It MUST close on Esc and on an X control at its top right.
- **FR-053**: It MUST offer Maximise (fill the window) and Restore (return to its previous size).
  *Superseded by FR-084 (Session 2026-10-15) — Maximise now fills the screen, as Preferences' does.*
- **FR-054**: It MUST offer Minimise, which closes it with an animation that shrinks it into the
  status-bar item; with reduced motion requested, it closes without animation.
  *Superseded by FR-085 (Session 2026-10-15) — the same behaviour, from the monitor window.*
- **FR-055**: The modal's own controls (close, maximise, restore, minimise, kill, filter clear) MUST be
  themeable icon controls with hover titles; confirmation buttons keep text labels.
- **FR-056**: A command **Resource Monitor** MUST open the modal from any window. It MUST appear as an
  item in the title bar's cog menu, in its **application** section alongside Settings, Key Bindings,
  Themes, Open Logs Folder and About, with a themeable icon (constitution, *Every panel action has a menu
  item*: the status bar is an accelerator, never the only route). It MUST appear in the Key Bindings
  editor with the default Tier 1 chord **`Ctrl+Shift+Alt+R`**, matched on the physical key. Opened from a sub-workspace window, the modal opens in the main window and brings
  it forward.
  *Its last sentence is superseded by FR-086 (Session 2026-10-15) — from any window, the command opens
  the one monitor window; the rest stands.*
- **FR-057**: Reopening the modal MUST restore the view the user left: its size (maximised or not), the
  chosen metric, the filter text and narrowing, and the drill-down position. If the node it was on no
  longer exists, it MUST open at that node's nearest surviving ancestor. This state lasts until throng
  restarts and is not persisted; chart history is still discarded on close (FR-033).
  *Amended by FR-087 (Session 2026-10-15) — the size it restores is the monitor window's place and size.*
  *Amended by FR-100 (Session 2026-10-23) — there is no narrowing to restore; Hide ended (FR-105) and the divider (FR-111) are restored too.*

#### The monitor window (Session 2026-10-15)

- **FR-081**: The monitor MUST be its own window, like the Preferences window: frameless, movable by its
  title bar, and looking the same — the same title bar, chrome, controls and theme — with one addition,
  a Minimise control (FR-085). There is only ever one; opening it again brings it forward.
- **FR-082**: Every throng window MUST stay fully usable while the monitor window is open, and the
  monitor MUST reflect what the user does in throng as they do it: processes, tabs, panels and projects
  appear, change and leave at the next capture, without reopening.
- **FR-083**: The monitor window MUST stay above throng's own windows while throng has focus, and never
  above other applications' windows — the Preferences rule. It minimises and restores with the main
  window, and closes when the main window closes.
- **FR-084**: Maximise MUST fill the screen and Restore MUST return the window to its previous size and
  place. FR-052's Esc and X still close it.
- **FR-085**: Minimise MUST close the monitor window with an animation that shrinks it into the main
  window's status-bar figures, so the user sees where it went; with reduced motion requested, or when the
  figures are not on screen (the main window minimised), it closes without animation.
- **FR-086**: The Resource Monitor command, the status-bar figures and the cog item MUST open the
  monitor window from any throng window, or bring it forward if it is open. Its actions run where they
  belong: Unload Project in the main window, Destroy Tab and Destroy Panel in the window holding that tab
  or panel — each with its own confirmation, that window brought forward — and Kill's confirmation in
  the monitor window. A tab or panel no window holds offers Destroy disabled, with its reason — those of a
  project that is not the active one ("Switch to <project> to destroy this tab"); a route that still
  finds no window reports "It is not open in any window" in the monitor's notice. The Resource Monitor
  command, used while the monitor window is open, brings it forward rather than closing it.
- **FR-087**: Reopening MUST place the monitor window where the user left it, at the same size and
  maximised state, kept on a visible screen, along with FR-057's view. This lasts until throng restarts.

#### Feedback, orientation and responsiveness (Session 2026-10-15)

- **FR-088**: A click on a tile or a row MUST select that node, and only select it. Each tile and row whose
  node has children MUST carry a drill-down icon button that opens it;
  *(Session 2026-10-15, third feedback: the drill-down button is superseded by FR-096 — double-click, Enter and Right open; tiles are gone.)* Enter and Right on a selected node,
  and a double-click on a row, MUST also open it. A node with no children MUST have no drill-down button
  and MUST NOT open to an empty view. Right-clicking a tile MUST open the same menu as its row. A click on
  the selected tile or row again, or on empty space in the breakdown, MUST clear the selection, as MUST
  drilling in or going Back with the pointer; going Back from the keyboard (Left, Backspace) selects the
  node the user came from, so the keyboard keeps its place *(derived — the spec had no way back to
  "nothing selected"; not confirmed by the user)*.
- **FR-089** *(Session 2026-10-15, third feedback: tiles and charts are gone — the mark is on the row, and the right column describes the
  node, FR-096/FR-097)*: Exactly the selected node MUST be marked — on its tile and on its row, with an accent edge
  as throng marks its active tab and active file — and the detail pane and charts MUST describe that node;
  with nothing selected, nothing is marked and they describe the node in focus. Every interactive element
  MUST show a pointer cursor and a hover state on hover (tiles in the warning and critical bands
  included), and a visible focus ring in throng's convention when focused from the keyboard. A tile's
  resting fill MUST NOT be the selected fill.
  *Amended by FR-098 (Session 2026-10-23): the selected row has no hover style of its own — it keeps its selected look under the pointer.*
- **FR-090**: Tiles and rows MUST be ranked by the chosen metric, and that order MUST hold while the pointer
  is over the breakdown or a node is selected; the selected node's figures keep updating in place. When
  the order changes, tiles and rows MUST move to their new place with a short animation, and without one
  under reduced motion.
  *Amended by FR-095 (Session 2026-10-15, third feedback): while the pointer is over a list, its figures hold too, not only its order;
  a selection on its own holds the order only, and the figures keep updating.*
- **FR-091**: The monitor MUST show when its figures were captured and how often — "Updated <time> ·
  every <n> s" — with a brief pulse each time a capture arrives; "Collecting the first reading…" before
  the first, and FR-044's stale wording when the collector is failing. Charts and sparklines with fewer
  than two points MUST say they are building their history rather than show nothing.
  *(Session 2026-10-15, third feedback: this now applies to FR-097's line graphs and the sparklines.)*
  *Its last sentence is superseded by FR-114 (Session 2026-10-23) — a graph with fewer than two points shows a loading spinner, not text.*
- **FR-092**: The monitor MUST explain itself in place: a header naming where the user is (the breadcrumb),
  with a Back button (disabled at the top) and "Tile size: <metric>"; column headers over the rows
  (Trend, CPU, Memory, GPU, I/O) with the chosen metric's column marked; a legend on each chart naming
  every band's colour and child; each chart naming the node it plots;
  *(Session 2026-10-15, third feedback: the chart legends and "Tile size" are superseded with the charts and tiles — FR-097's bars are
  labelled by their own rows, and the header reads "Sorted by <metric>".)* visible labels on the metric choice
  ("Size by") and the capture interval ("Capture every"); a count of what the filter matched and of the
  idle processes hidden, and "No process matches '<text>'" when the filter matches nothing.
  *Amended by FR-099 (Session 2026-10-23): the metric choice reads "Order by", the header "Ordered by <metric>", and each metric's column header orders by it.*
- **FR-093**: A help button ("?", a themeable icon control) MUST open a panel explaining what Components and
  Projects are, what a tile's size means, the mouse (click selects, the drill-down button opens,
  right-click or Shift+F10 for actions), the keys, and what amber and red mean with the thresholds
  currently set in Preferences. Esc or the button closes it.
- **FR-094**: Each tile's fill MUST show how much of the machine its node takes, for the metric sizing the
  tiles, on a continuous scale from a low colour to a high colour: CPU as a share of every logical
  processor, memory as a share of installed RAM, GPU as a share of the GPU; I/O, which has no machine
  total, against the highest rate throng has reached since the window opened. The scale MUST pass
  through the theme's `success`, `warning` and `danger` colours, reaching `warning` at the warning
  threshold and `danger` at the critical threshold (FR-046; GPU takes the CPU thresholds), and use theme
  colours only. A key to the scale MUST sit beside the tiles, and the help panel (FR-093) MUST explain it.
  A node whose figure is not measured is drawn neutral. The selected tile keeps FR-089's accent edge on
  top of its fill.
  *Amended (Session 2026-10-15, third feedback): the tiles are gone; the scale now fills FR-097's share bars, with its key beside them.*

#### Two columns (Session 2026-10-15, third feedback)

- **FR-095**: While the pointer is over the left column's list, that list MUST hold still — its order, its
  figures and its sparklines — and catch up to the latest capture when the pointer leaves it. The right
  column's share bars hold the same way while the pointer is over them, so a bar never moves under a click
  *(derived from "I thought we were pausing areas as we mouse over them"; not confirmed by the user)*. A
  selection with the pointer elsewhere holds only the order (FR-090). A Kill, Unload or Destroy chosen from
  the monitor catches a held list's figures up over the next two captures, in place, so the result shows
  under the pointer *(derived — a held list would otherwise hide what the user just did; not confirmed by
  the user)*. Hover titles
  anywhere in the monitor MUST NOT contain a live figure, so no title changes, flickers or closes under a
  resting pointer. The right column keeps updating while the pointer is over the left.
- **FR-096**: The monitor MUST be laid out in two columns. The **left** column holds the lists: Components
  and Projects at the top level, and the children of the node drilled into below it, with the breadcrumb,
  Back, the filter and the list controls; each row keeps its name, sparkline and figures. A single click on
  a row MUST select it and show its detail in the right column; a double-click, Enter or Right MUST drill
  into it; a row with no children does not drill. Rows carry no drill-down button. Right-click and
  Shift+F10 keep the row's menu.
  *Amended (Session 2026-10-23): the top level lists the components only (FR-103); the breadcrumb, Back, filter and list controls move above both columns (FR-112); columns may drop off the right rather than every row keeping all its figures (FR-106).*
- **FR-097**: The **right** column MUST hold all detail about the selected item — or, with nothing selected,
  about the level the left column shows — and no selection detail may appear anywhere else. Top to
  bottom: the item's name and kind; its children as a ranked list of share bars (each bar's length its
  share of the item for the chosen metric, its colour FR-094's heat scale, with the figure beside it;
  clicking a child selects it on the left); the item's stats (FR-012's process facts, its figures with
  their bands); a small line graph per metric (CPU, Memory, GPU, I/O) of the item's own usage over the
  time the window has been open, with its current value; and its actions. There are no stacked area
  charts and no treemap.
  *Amended (Session 2026-10-23): "clicking a child selects it on the left" is superseded by FR-108 — the children are read-only; each shows every figure (FR-109); the actions, with Activate, sit in the header (FR-110); Network joins the line graphs (FR-113).*

#### Selection, columns, actions and network (Session 2026-10-23)

- **FR-098**: Exactly one row MUST be selected, or none. The selected row MUST keep its selected fill and
  accent edge while the pointer is over it — it has no separate hover style — and only unselected rows
  take FR-089's hover state. Up and Down MUST move the selection itself, so the right column follows the
  keyboard *(derived; not confirmed by the user)*.
- **FR-099**: The metric control MUST be labelled **"Order by"**. Each column header for a metric — CPU,
  Memory, GPU, I/O, Network — MUST be a button that sets Order by to that metric, operable from the
  keyboard, with the chosen header marked; the list header reads "Ordered by <metric>" *(the wording
  derived; not confirmed by the user)*. The toolbar's Order by control stays.
- **FR-100**: The monitor MUST NOT offer a control to narrow the view to one component or one project. The
  filter, the drill-down and the ordering remain the ways to find something.
- **FR-101**: The left column MUST NOT show a readout of the selected or focused row's figures; a row's
  figures are on the row, and its detail is in the right column (FR-097).
- **FR-102**: Each component row — UI, Daemon, Helpers, Projects — and each row for one of throng's own
  process roles beneath them — a window's renderer, the GPU and utility processes, the daemon, a console
  host, a folder-lock helper, the monitor's collector and the de-elevation agent — MUST carry a hover
  title of one or two sentences saying why it exists and what it is responsible for. These titles carry
  no live figure (FR-095), and the help panel (FR-093) describes the components in the same terms.
- **FR-103**: The left column's top level MUST list the four components only. The user's projects are
  reached by drilling into Projects, where FR-020c's ordering applies.
- **FR-104**: Every list in the left column MUST end with a **Total** row giving, for each column, the
  rolled-up figure of the node whose children are listed — so it equals that node's own figure (FR-022)
  and never counts an ended process. When the filter, Hide idle or Hide ended removes rows, the Total
  still counts them and says how many of the rows it counts are hidden *(derived from SC-006; not
  confirmed by the user)*. The Total row is not selectable and carries no actions or sparkline.
- **FR-105**: The toolbar MUST offer **"Hide ended processes"** beside Hide idle, **on by default**. On,
  a process that ends leaves the list at the next capture; off, it shows greyed and struck through as
  FR-065a describes. Either way it never counts toward a live figure or total. Its state is part of the
  view FR-057 restores *(derived; not confirmed by the user)*.
- **FR-106**: The left list MUST NOT scroll horizontally. When its width cannot fit every column, figure
  columns MUST drop off the right edge one at a time, and a marker at the right end of the header MUST
  show that columns are hidden, its hover title naming them and saying to widen the list or the window.
  The name column never drops, and the Order-by column drops last *(derived; not confirmed by the user)*.
  Widening the list — by the divider (FR-111) or the window — brings dropped columns back.
- **FR-107**: A figure that is not measured MUST be shown as **"-"**, its reason in the cell's hover
  title; an unavailable figure is shown the same way *(derived; not confirmed by the user)*. An
  estimated figure MUST be shown with **"~"** before it ("~12.4 MB"), with "Estimated" in its hover
  title, and no separate "estimated" tag. FR-012's rule on which figures may be shown at all is
  unchanged.
- **FR-108**: The right column MUST describe the left column's selection — or, with nothing selected,
  the level the left column shows — and MUST NOT change the left column. Its list of children is
  read-only: a click on a child selects nothing, drills nowhere and re-targets nothing, and the right
  column has no drill-down of its own. Its bars still hold still under the pointer (FR-095).
- **FR-109**: Each child in the right column MUST show all its figures — CPU, Memory, GPU, I/O and
  Network — at all times. Only the bar's length and heat colour (FR-094) follow Order by.
- **FR-110**: The right column's header MUST carry the selected item's actions beside its name: its
  standard action (FR-063), Kill Process or Kill All Below (FR-063a — the user's "terminate terminal(s)"
  *(derived; not confirmed by the user)*), and a new **Activate** for nodes in Projects. Activate on a
  project switches to that project; on a tab, to its project and that tab, in the window that holds it;
  on a panel, also focuses that panel; on a process, goes to its panel *(the process case derived; not
  confirmed by the user)*. The window it lands in comes forward, and the monitor window stays open and
  above throng's windows (FR-083). Activate is absent on UI, Daemon and Helpers (FR-062), and disabled
  with its reason where no window holds the target (FR-086's wording). It is a themeable icon control
  with a hover title, and an item in the row's menu as well (constitution, *Every panel action has a menu
  item*).
- **FR-111**: The divider between the two columns MUST be movable by dragging, and from the keyboard
  when focused *(derived; not confirmed by the user)*, with each column keeping a minimum width. Its
  position is part of the view FR-087 restores *(derived; not confirmed by the user)*.
- **FR-112**: The filter, the toolbar (Order by, Hide idle, Hide ended, the capture interval, the
  Updated line and the help button) and the breadcrumb with Back MUST span the full width of the window
  above both columns, separated from them by a horizontal rule, and MUST NOT scroll with either column.
  Tab moves filter → toolbar → breadcrumb → left list → divider → right column *(derived; not confirmed
  by the user)*.
- **FR-113**: Every node MUST show a **Network** figure — bytes sent plus received per second, over TCP
  and UDP, rolled up like the other figures (FR-022) *(the protocols derived; not confirmed by the
  user)* — measured, when throng runs elevated, by the operating system's kernel network tracing behind
  the FR-010 seam and validated per FR-012 (SC-011). Unelevated, it MUST show "-" with the hover title
  **"Elevate to show"**. Network is a column (FR-106), an Order-by choice (FR-099; disabled with that
  reason when unelevated *(derived; not confirmed by the user)*), a line graph (FR-097), and on FR-094's
  heat scale against the highest rate throng has reached since the window opened, as I/O is
  *(derived; not confirmed by the user)*. The status bar is unchanged *(derived — the request was "for
  each element"; not confirmed by the user)*.
- **FR-114**: A line graph or sparkline with fewer than two points MUST show a small loading spinner
  centred in its own box, with no text, and MUST NOT overlap anything around it; it becomes the graph
  once a second point arrives. The spinner is still under reduced motion *(derived — a pulse or static
  ring is the convention; not confirmed by the user)*, and its accessible name is "Loading".


#### Visualisation and navigation

- **FR-060**: The modal MUST be predominantly visual:
  - a time-series chart of each metric for the node in focus, stacked by its children;
  - a proportional breakdown (for example a treemap or sunburst) of the node in focus by the metric the
    user chooses, which the user can click into to drill down;
    *Amended by FR-088 (Session 2026-10-15): a click selects; a drill-down button opens.*
  - a breadcrumb of the path from throng to the node in focus, any segment of which returns to that
    level;
  - per-row sparklines wherever processes are listed.
  *The stacked time-series charts and the treemap are superseded by FR-096 and FR-097 (Session 2026-10-15,
  third feedback): the breakdown is a ranked list of heat-coloured share bars and each item has small
  line graphs of its own usage; the breadcrumb and sparklines stand.*
- **FR-061**: The user MUST be able to:
  - filter by text matching name, command line or process id, with matches shown under their
    ancestors;
  - narrow to one component or one project;
    *Superseded by FR-100 (Session 2026-10-23) — there is no narrowing control.*
  - choose the metric the breakdown and ordering use;
  - hide idle processes (FR-061a).
  *Amended (Session 2026-10-23): the metric choice is "Order by", also set from the column headers (FR-099), and Hide ended processes joins Hide idle (FR-105).*
- **FR-061a**: A process is **idle** when its own CPU is under 0.1% and its own I/O is zero in each
  of the last 3 samples (fewer while the modal has collected fewer). A process whose memory is at or
  above the memory warning threshold (FR-046) is never treated as idle. Hiding idle processes MUST keep
  any idle process that has a non-idle descendant, so every visible process stays under its ancestors.
- **FR-062**: Actions MUST be offered only on nodes in the **Projects** component. Nodes in UI, Daemon
  and Helpers MUST have **no actions**: absent, not disabled (constitution, *Disabled when unavailable,
  absent when meaningless*). The daemon indicator remains the daemon's restart control (029 FR-008).
- **FR-063**: Each level of Projects MUST offer throng's **standard action** for that level, using the
  same command, name, behaviour and confirmation setting as everywhere else in throng — the monitor
  adds no variant of them:

  | Level | Standard action | Confirmation / behaviour setting |
  |---|---|---|
  | Project | **Unload Project** (both of 046's Unload items) | `projects.unloadTerminalAction` |
  | Tab | **Destroy Tab** | `confirmations.destroyTab` |
  | Panel | **Destroy Panel** | `confirmations.destroyPanel` |
  | Process | **Kill Process** — that process only | `confirmations.killProcesses` (FR-063b) |

  A tab node for a sub-workspace tab offers Destroy Tab on that sub-workspace's tab.
- **FR-063a**: Every level of Projects — project, tab, terminal panel and process — MUST also offer
  **Kill All Below**: a force kill of every process in that node's subtree. On a **process** it ends that
  process **and** all its descendants. A project, tab or panel is a UI element, not a process, so on one
  of those it ends every process inside — each terminal's shell and all its descendants — and nothing
  else: a project with 15 tabs of 4 panels each keeps every tab and every panel, each terminal left blank
  in the state any shell exit leaves it in (FR-066), and editors and previews untouched. It MUST reach
  processes an ordinary terminal end does not: an ordinary end kills the shell's tree and the processes
  attached to its console, so what survives it is a process that was re-parented and detached — which
  lineage (FR-021) still attributes to the panel.
  It is offered only where the subtree holds at least one live process.
- **FR-063b**: Kill Process and Kill All Below MUST share **one new confirmation setting**,
  `confirmations.killProcesses` ("Kill processes"), in Preferences' Confirmations group with the same
  values as the other confirmation settings (none, single, double) and default **double**. Its
  confirmation MUST name the node (process, panel, tab or project, with its owning project, tab and
  panel as applicable) and **list the processes that will end**, by friendly name and id, collapsing
  beyond a readable length to "and N more".
- **FR-064**: Kill failures MUST raise one inline notice in the modal stating the cause in plain terms,
  via throng's failure-cause model; never a raw error string.
- **FR-065**: A killed process MUST be shown as ended at the next sample, and its usage MUST leave
  every ancestor's live roll-up (FR-065a).
- **FR-065a**: Any process that ends while the modal is open — killed from the monitor or ending for any
  other reason — MUST **stay in its place** in the breakdown, greyed and struck through, with no kill
  action, its live figures shown as ended rather than zero, and its history still viewable in its detail
  and its ancestors' charts. It MUST NOT count toward any live roll-up or status-bar total. Ended entries
  remain for as long as the modal stays open, and are discarded when it closes; they are not restored by
  FR-057. A process that ended while the modal was closed is never shown.
  *Amended by FR-105 (Session 2026-10-23): with Hide ended processes on, the default, an ended process leaves the list at the next capture; this greyed, struck-through form shows only with it off.*
- **FR-066**: Killing a terminal's shell MUST leave its panel in the same state as any other shell exit.
- **FR-067**: Every visual element MUST draw its colours from the theme, with metrics distinguishable in
  both light and dark themes.
- **FR-068**: The modal MUST be fully usable from the keyboard. Within the breakdown, **Up** and
  **Down** move focus between nodes at the current level; **Right** or **Enter** drills into the focused
  node; **Left** or **Backspace** goes up one level; Tab moves between the modal's regions (filter,
  breakdown, chart, detail, controls). A focused node shows its values exactly as hovering it would,
  and every action reachable by mouse — including Kill — is reachable by keyboard. These keys apply
  only while focus is in the breakdown; in the filter field they edit text as usual.
  *Amended (Session 2026-10-23): "a focused node shows its values" is superseded by FR-101 — there is no readout, and Up and Down move the selection (FR-098); the Tab order is FR-112's.*

#### Folder locks (#133)

- **FR-070**: The monitor MUST list every folder throng currently holds, with the project it serves and
  every terminal panel (by tab and panel name) that keeps it held. Its lock helper appears under
  Helpers and is not killable (FR-062).
- **FR-071**: Each terminal named against a held folder MUST link to that panel in the Projects
  breakdown, where the user can act on it.
- **FR-072**: A folder MUST leave the list at the first sample after the last terminal holding it ends.

#### Limitations

- **FR-080**: Anything the monitor knows exists but cannot enumerate or read MUST be shown in place as a
  named limitation, with the reason, rather than silently omitted.

### Key Entities

- **Component**: UI, Daemon, Helpers or Projects; carries rolled-up figures. The first three are
  throng's own; Projects is the user's.
- **Project group**: any project added to throng, under Projects, with its state (active, loaded or
  unloaded); carries rolled-up figures. A "No project" group holds rootless terminals.
- **Tab node**: any tab with at least one panel, by its name (prefixed with the sub-workspace's name
  when it lives in one); carries rolled-up figures.
- **Panel node**: one panel, by its name and kind. A terminal panel owns one shell process tree and a
  Terminal buffers estimate (FR-024b); an editor or preview panel carries estimated figures moved out of
  its renderer (FR-024).
- **Process node**: one operating-system process — id, parent, name, friendly label, command line,
  executable path, start time, owning panel — with own and rolled-up figures for each metric.
- **Sample**: one reading of every metric for every node at one moment; samples form the history the
  charts draw.
- **Held folder**: a folder throng holds, the project it serves, and the terminal panels keeping it held.
- **Limitation**: something known to exist that cannot be read, and why.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: The status-bar totals reflect a change in throng's load within two capture intervals.
- **SC-002**: The modal appears within 100 ms of the click, and its first complete hierarchy is shown
  within 2 seconds, with 10 terminals each running a process tree of 20 processes.
  *Amended (Session 2026-10-15): for the monitor window, "appears" is the window shown with its loading state, within
  1 second of the click on a window not yet open (a new window must paint before it is revealed), and
  within 100 ms when it is already open and only comes forward; the 2-second bound is unchanged.
  (derived from Preferences' reveal-when-painted window; not confirmed by the user)*
- **SC-003**: With the modal open on that load, keystroke-to-echo latency in a terminal and frame timing
  in the editor are no more than 5% worse than with the monitor closed, and no input is delayed by more
  than 50 ms.
- **SC-004**: With the modal closed, summary collection costs throng less than 1% of one CPU core on
  average.
- **SC-005**: A user can find the process responsible for a CPU spike, starting from the status bar, in
  under 20 seconds and in no more than four clicks.
  *Amended by FR-103 (Session 2026-10-23): with projects reached by drilling into Projects, the bound is five clicks (status bar, Projects, project, tab, panel) (derived — the user chose the drill-down over the separate list; not confirmed by the user).*
- **SC-006**: At every level of the hierarchy, a node's rolled-up figure equals its own figure plus the
  sum of its children's, to within rounding.
- **SC-007**: A process killed from the monitor is shown as ended, and out of every live total, within
  one capture interval.
  *Amended by FR-105 (Session 2026-10-23): with Hide ended processes on, the default, it leaves the list within that interval instead of showing as ended.*
- **SC-008**: No process descending from a throng terminal is missing from the hierarchy for longer than
  one capture interval, apart from those shown as limitations.
- **SC-009**: An editor or preview panel's memory estimate is within 10% of the change in the
  measured memory of the processes it is moved out of (UI main and its renderer) when that panel is
  opened and then closed, for files from 1 MB to 50 MB. A terminal's Terminal buffers estimate is within
  10% of the change in its renderer's and the daemon's measured memory when its scrollback is filled from
  empty to its retained limit and then cleared.
- **SC-010** *(Session 2026-10-15)*: With about 450 processes under throng, a keystroke in the filter, a
  click that selects, a drill-down and the arrival of a capture each complete their rendering work within
  100 ms, and a filtered breakdown lists each process once.
- **SC-011** *(Session 2026-10-23)*: With throng elevated, each process's Network figure is within 10% of
  Windows Resource Monitor's Network figure for the same process over a 60-second steady transfer *(the
  tolerance derived from SC-009's; not confirmed by the user)*, and collection still meets SC-004.

## Assumptions

- **Windows only in this feature.** Linux and macOS get the seam (FR-010), not implementations.
- **Main window only for the status-bar item.** Sub-workspace windows have no status bar today, so the
  item and the minimise animation target live in the main window; the command still works from any
  window (FR-056).
- **Project and tab sit between component and panel.** The maintainer listed "component → panel →
  process", and also asked for every project's tree; the Projects component therefore groups panels by
  project and tab. The UI, Daemon and Helpers components have no project level.
- **CPU is a share of the whole machine**, as Task Manager shows it by default — so throng's total is
  never above 100%.
- **Memory is private working set**, the figure Task Manager shows by default.
- **GPU** is the busiest GPU engine's utilisation attributed to each process, matching Task Manager's
  GPU column.
- **Recognised friendly names** are a fixed list in this feature; making it configurable is out of
  scope.
- **Where collection runs** — the daemon, or a dedicated collector process — is a planning decision
  bound by FR-001 – FR-007; the maintainer has approved either.
- **A charting capability is a new dependency.** throng ships none today; choosing one is a planning
  decision bound by FR-060 and FR-067.
- **Third-party lock holders stay out of scope** (#210); this feature lists only throng's own locks.
- *Network capture is no longer out of scope: superseded by FR-113 (Session 2026-10-23), measured when throng runs elevated.*
- **Out of scope**: network capture of any kind (FR-030), chart history while the modal is closed
  (FR-033), setting
  process priority or affinity, suspending processes, exporting or persisting history across restarts,
  and notifications when a threshold is crossed (FR-046 colours only).
