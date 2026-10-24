# Feature Specification: Panel Attention Marks and Terminal Attention Signals

**Feature Branch**: `feature/S057-I4-terminal-attention-marks`

**Created**: 2026-10-02 (drafted as 050, parked on [#4](https://github.com/Bidthedog/throng/issues/4)); renumbered and revised 2026-10-18

**Status**: Draft (clarified 2026-10-02)

**Revised 2026-10-18.** The parked draft was brought current with what landed after it: specs 050–056, and
the 046 amendment for #489, merged in PR #506. Four changes, each marked
*(2026-10-18)* where it lands: the Notification signal excludes the shell's own OSC 9 subcommands
(FR-060a); signals are recognised whether or not any window shows the terminal (FR-067a); a minimised
category's header mark accounts for the rows it hides (FR-013); and a mark stays legible on a selected
project row filled with its colour (FR-017).

**Input**: User description: "Add a new issue (or find an existing one) about alerting the user (via a
status indicator on the project list) when a terminal has finished processing, or a program is awaiting
the user. […] the use-case is generally when claude is awaiting user input [in] the currently
foregrounded session, but can also apply on long-running scripts returning, or attached processes
finalising / detaching. I'd like to explore the options — what can we accurately report back to the
user, and can we enable / disable different features that report these things to the user? […] when a
project — or a tab — has a panel that requires user input for any reason, we should be showing this to
the user, so they do not have to keep clicking between active projects to see what is finished."
Tracked as [#4](https://github.com/Bidthedog/throng/issues/4), whose body carries the signal analysis
this spec formalises.

The feature has two halves:

1. **A panel attention mechanism.** Any panel can be marked, in one of two kinds, and the mark shows on
   the panel, its tab, its project row and its category. It clears when the user focuses the panel. It
   can raise a toast and an OS notification that take the user to the panel. The mechanism belongs to
   panels in general and knows nothing about what raised a mark. Editors and search results are
   expected to raise marks later.
2. **Terminal attention signals.** The first, and in this feature the only, producer of marks: seven
   terminal signals, each switchable.

This feature builds on **002** (panes and panels), **005** (terminal panels and their exit path), **025**
(the shared command observation), **011** FR-020–FR-022 (the unsaved-changes dot, the precedent for a
mark that appears in the project list and on a tab), **030** (notices, toasts and their display modes),
and **046** (the project list, its categories, and unloaded projects whose terminals keep running).
It also relies on **041** (the notice model every toast goes through) and **051** (which hardened the
command observation and names this feature as depending on it). The Attention kind's colour is distinct
from 047 FR-083's attention flash, which 048 FR-021 reuses for split mode: that flash is a moment, a
mark is a state. Every requirement in those specs not named below as superseded or extended stands unchanged.

**Supersession.** 025 FR-019f suspends command tracking for a terminal no window is observing. FR-062
narrows that rule: while throng is running, a terminal whose project is unloaded stays in the shared
observation. That is the case this feature exists for — a project the user is not looking at — and 025
FR-019a already guarantees that observing one more terminal costs nothing extra.
*(2026-10-24, round 12)* FR-129 supersedes **046 FR-051a**'s "shown of total" count on a minimised
category header with a pill carrying the category's total project count, FR-132 narrows **031 FR-042** so
a one-panel tab shows no count pill, and FR-124 supersedes this
spec's own **FR-122** go-to control with a toast whose whole body is the link.

**Extension.** Notices gain a link (FR-034). Today a toast carries no action, and this repository's
working rule is that a message with an action attached is shown inline instead. An attention toast's
link is navigation to the panel, not a remedy. Every action that resolves the condition stays on the
panel itself. The link is the reason the toast exists.

## Definitions

- **Attention mark** (or **mark**): the state of a panel that something has flagged as needing the
  user. It is one state per panel, whatever raised it and however many times, and it has a kind.
- **Kind**: **Attention** (the panel needs the user) or **Failed** (something in the panel failed). When
  both apply, Failed wins until the mark clears.
- **Producer**: whatever raises marks on a panel. In this feature, only the terminal signals do.
- **Focused panel**: the panel holding keyboard focus in a throng window that is itself focused.
- **Active panel**: the panel a tab will focus when it is shown — the focused panel, or the one that
  would be if the window were focused.
- **Holder**: anything that shows the mark for a panel it contains: the panel's tab chip, the overflow
  control of a tab strip hiding that tab, the project's row in the project list, and the header of a
  minimised category containing that row.
- **Signal**: an event in a terminal that may mean the user is needed. It is **exact** when it reports a
  fact throng observes directly, or a request the program made explicitly. It is **heuristic** when it
  infers from indirect evidence, and can be wrong.

### Terminal signals

| Signal | Raised when | Kind of mark | Accuracy | Default |
|---|---|---|---|---|
| **Process exited** | The terminal's process ends, by a path the user did not cause (FR-064) | Attention for exit code 0, Failed otherwise | Exact | On |
| **Command finished** | The foreground command ends and nothing replaces it, as observed by 025's shared command observation (FR-019, FR-022) | Attention | Exact, up to one observation interval late | On |
| **Bell** | The program rings the terminal bell | Attention | Exact, as a request | On |
| **Notification** | The program sends a terminal desktop notification in any of the three widely used forms (the iTerm2, rxvt and kitty conventions). It carries a message | Attention | Exact, as a request | On |
| **Progress ended** | The program reports that progress it was showing completed, or failed (the ConEmu / Windows Terminal progress convention) | Attention when completed, Failed on error | Exact, as a request | On |
| **Unseen output** | The terminal prints output while it is not the focused panel | Attention | Heuristic: means "changed", not "needs you" | Off |
| **Output went quiet** | Output stops for a set interval, after the terminal printed while not focused | Attention | Heuristic: cannot tell "waiting" from "working silently" | Off |

**What cannot be observed.** "A program is waiting for input" has no generic exact signal. An
interactive program, Claude Code included, stays the shell's foreground command for its whole life, so
the process tree reads the same whether it is working or waiting at its prompt. The only accurate route
is for the program to say so, through a bell or a notification, and throng honours both. The title is
not a signal: programs use it inconsistently, and a title change says nothing about whether the user is
needed. Prompt marks (shell integration that reports "command done, exit code N") are excluded by 025
FR-022 and are not adopted here.

## Clarifications

### Session 2026-10-02

- Q: Should the issue be new, or an existing one? → A: Existing. #4 ("Live Notifications", a roadmap
  stub), rewritten and moved into v1.0.0.
- Q: When does a panel count as viewed, so that it does not mark and an existing mark clears? → A:
  **Focus, not visibility.** A panel the user can see but has not focused can still be marked. Any focus
  action clears the mark: a click, keyboard activation, or activation by any in-app action. A mark also
  clears once the panel has been active for **1000 ms**, configurable in Preferences. Build the
  mark/flag/clear mechanism on **panels**, independently of any producer's settings, and make every
  panel support it: "we will use it for editors and search results in the future, I have no doubt."
  (FR-001–FR-012)
- Q: Should throng alert the user outside its window when the window is not focused? → A: **Yes, with
  OS notifications, on by default, and switchable off entirely in Preferences.** Each kind of mark is
  configured as **In App Notification**, **OS Notification** or **Both**. If OS Notification applies to
  a kind and throng is focused, an in-app toast is shown instead. (FR-030–FR-038)
- Q: (follow-up) What is an "In App Notification"? → A: **The in-app toasts throng already has**,
  possibly with new types. Marks are always raised. Notifications carry a link that switches to the
  project, tab and panel that marked itself. (FR-030, FR-034)
- Q: One kind of mark, or kinds told apart? → A: **Two: Attention and Failed.** (FR-002)

### Session 2026-10-18

- Q: Should Go to Next Marked Panel and a notification's link take the user into a marked project whose
  row is hidden because its category is minimised? → A: **Yes, both.** The project becomes active and its
  row shows under the collapsed header (046 FR-052). This is not a supersession of 046 FR-012, which
  governs the project-cycling commands only. (FR-034, FR-080a)
- Q: When a panel is marked, should the taskbar button flash or carry a badge as well as the Windows
  notification? → A: **A badge, no flash, carrying a count of how many panels are marked**, in the
  Failed style if any is Failed, cleared when nothing is. Switchable in Preferences, on by default.
  (FR-039)
- Q: Should a terminal's startup commands (025) raise Command finished when they finish? → A: **Only
  if they finish unattended**, meaning the user is not focused on that panel at the moment it finishes.
  The same holds for every signal: nothing is raised while the user is attending the panel. A startup
  command is otherwise treated like any other command. (FR-004, FR-065a)
- Q: When several unattended terminals finish their startup commands at launch or restore, should each
  raise a toast and a Windows notification? → A: **No. Each one marks its panel and counts on the taskbar
  badge, but raises no notification.** Notifications resume for anything after a terminal's startup
  sequence. (FR-038a)
- Q: If a panel is marked while it is already the active panel on screen but keyboard focus is elsewhere,
  should the clear delay wipe that mark on its own? → A: **No.** The delay clears only a mark that was
  already there when the panel became active. A mark raised while the panel was already active but
  unfocused stays until the user focuses the panel. (FR-006)

### Session 2026-10-19

From hand-testing MT-01: on the highlighted, colour-filled project row the colour dot was washed out
by the fill, and the mark sat on its own disc beside the name. Also changed this session, with no spec
text affected: the Attention and Failed icons became ⚑ and ✖ (from 🔔 and ❗), text glyphs that take
their theme colours.

- Q: Where does a project row's mark go? → A: **In place of the colour dot, on every marked row**, so
  it sits in the same spot whether or not the row is highlighted. (FR-092; FR-017 annotated)
- Q: Should a mark move? → A: **It blinks slowly, on every holder**, and stays still under reduced
  motion. (FR-093)
- Q: The colour dot on the highlighted row is washed out even when nothing is marked (046's row, as
  amended for #489). What should happen? → A: **Give it a contrasting ring.** (FR-094, extending 046
  FR-072a)

### Session 2026-10-19 (round 2)

From hand-testing the first round. Also fixed this round, with no spec change: the project row's mark
took more room than the colour dot it replaces and pushed the row's text right, against FR-092's "in
place of".

- Q: When should a mark stop showing? → A: **Only once the user has moved into the workspace pane and
  focused the panel.** Selecting its project from the list made the panel active, and the mark cleared a
  moment later, before the user had looked at it. (FR-095, superseding FR-005 and FR-006)
- Q: (follow-up) Then what does the Clear delay do? → A: **It is how long the panel must hold focus**
  before its mark clears. (FR-095)
- Q: Should a panel header's mark have a tooltip? → A: **No** — the "Attention" tooltip over a panel's
  own flag says nothing the panel does not. (FR-096)
- Q: How should a project row's mark explain itself? → A: **Like the tab hover popover**, one marked
  terminal per line rather than one long tooltip. (FR-097)
- Q: And a category header's? → A: **The same popover, grouped by project.** (FR-098)
- Q: A program using focus reporting (Claude Code) is never told when the user leaves its panel by a tab
  or project switch, so it suppresses its own notifications. Fix here or separately? → A: **Here.**
  (FR-099)

### Session 2026-10-19 (round 3)

- Q: What does each line of a project row's popover name? → A: **The tab and the panel** — a panel's
  title alone does not say where it is. (FR-100)
- Q: And a category header's? → A: **The project, the tab and the panel.** The project heads its group;
  each line names the tab and the panel. (FR-100) *[derived: FR-098 already groups by project under its
  name, so the project is named once per group rather than on every line]*
- Q: What should a bell be called? → A: **"Wants your attention"**, read after the panel's name ("Claude
  · Wants your attention"), not "Bell", which names a mechanism the user never sees. (FR-101)
- Q: Can a notification say what the terminal was doing? → A: **Yes: the title the program set, if it
  set one, else the last command the terminal ran.** (FR-102) *[derived: the user offered both; a
  program's own title (Claude Code's task title) says more than its command line (`claude`), so it
  wins when present]*
- Q: Can the toasts have their own Never display / Display for / Dismiss only choice, rather than the
  Info and Error notice settings? → A: **Yes, per kind.** (FR-103) *[derived: defaults are what the
  borrowed Info and Error settings ship, so nothing changes on upgrade]*
- Q: Should the tab strip's overflow mark explain itself too? → A: **Yes, the same popover, one line per
  marked panel naming its tab and panel.** (FR-104)
- Q: What does clicking a project row's or category header's mark do? → A: **It cycles through the
  marked panels it stands for** — the project's, or the category's projects' in list order. (FR-105)
- Q: Where does Go to Next Marked Panel belong? → A: **Not in the cog menu**, where it is out of place;
  in a project's right-click menu while that project has a marked panel. (FR-106, superseding FR-082)
  Also fixed this round, with no spec change: the project-row mark still drew over the colour dot's
  square rather than taking it, against FR-092.

### Session 2026-10-19 (round 4)

Also fixed this round, with no spec change: the project-row mark was still drawn inside the dot's rounded
box and clipped by it, against FR-092 — the glyph takes the dot's place and box, not the dot's shape.

- Q: Claude Code sends two signals for one wait — its progress ends, then its own notification half a
  minute later — and each was announced. Should a mark announce once? → A: **Once per mark.** Later
  signals on a panel still marked update the mark, its popover and any toast still showing, and raise
  nothing new. (FR-112, narrowing FR-035)
- Q: Where do the notification preferences live? → A: **All under Notifications, one row per type** —
  Error, Warning, Info, Success and Attention — each row holding the display mode, its duration and
  whether it is also announced in the OS, with one global switch for the OS. Taskbar badge and clear
  delay stay under Attention. (FR-108, FR-109)
- Q: Should ordinary notices reach the OS too? → A: **Yes, per type, in this branch.** (FR-110,
  superseding 030's "Out of Scope: operating-system-level or background notifications")
- Q: When? → A: **Only while no throng window is focused**, the rule attention already used. (FR-110)
- Q: Attention and Failed — two settings or one? → A: **One Attention row**; Failed marks follow it.
  (FR-111, superseding FR-030, FR-031, FR-037 and FR-103)
- Q: With no backing, how does the mark stay legible on the selected row? → A: **In the row's contrast
  colour**, as its text is; ⚑ and ✖ still tell the kinds apart. (FR-107)
- *[derived]* The OS switch is independent of the display mode: Never display with "also in the OS" on
  gives a Windows notification only, while throng is in the background. A row's Reset and Revert act on
  all of its settings. Ordinary types default to OS off and Attention to on, so nothing changes on
  upgrade.

### Session 2026-10-20 (round 5)

- Q: "Also in the OS" reads as though it adds to the toast, but it raises a Windows notification even
  under Never display. What should it say? → A: **OS Notify**, described as working whatever the display
  mode, and only while throng is not focused — while it is, the in-app notice decides. (FR-113)
- Q: What do the OS Notify switches do while Operating system notifications is off? → A: **They grey out
  and keep their last setting.** (FR-113)

### Session 2026-10-20 (round 6)

- Q: The project-row flag is too small at the dot's size. → A: **Draw it at 16 × 16, over a reserved space
  no bigger than the dot's**, which stays the same size; the box itself shows nothing. (FR-114)
- Q: Must notifications say "(Attention)", "(Bell)" and so on? → A: **No: "<window title>" over "Wants your
  attention".** (FR-115) *[derived: a Failed mark says what failed instead, so a failure is not reported as
  a request for attention; the popovers keep the reason and the activity]*

### Session 2026-10-20 (round 7)

Also fixed this round, with no spec change: a notification was headed by the flavour label ("Command
Prompt") rather than the title the panel's header shows, against FR-115's "the terminal's window title".
The daemon named the panel from its saved layout alone, and the hosting window's live title reached the
mark only after the notification had gone.

- Q: With the kind gone, the notification lost what Claude Code's own said. Can it say more? → A: **Yes:
  after "Wants your attention", the message a program sent, then what the terminal was doing** — unless the
  title already says it. (FR-116, narrowing FR-115)

### Session 2026-10-20 (round 8)

- Q: FR-116's run-on line repeats what the title already shows. What should a notification say? → A:
  **The panel title over one line: the program's own message ("Claude is waiting for your input"),
  "<command> has finished", or "Wants your attention".** (FR-117, superseding FR-116's text)

### Session 2026-10-21 (round 9)

- Q: How does a user see, on loading a project or tab, which panels need attention? → A: **A marked
  panel's header is filled with its mark's colour.** (FR-118) *[derived: the header rather than the whole
  panel, since a terminal's background is its own theme's; mixed from the mark colours, so every theme has
  it without a token of its own]*
- Q: How should a mark's popover read? → A: **Per project (bold, left out of a project's own popover):
  each entry its icon and "Tab - Title", its notification line beneath it, indented; a rule between entries,
  indented within a project, and a full rule between projects.** (FR-119)
- Q: What do notifications name? → A: **The project and the tab as well as the panel.** (FR-120,
  narrowing FR-115)

### Session 2026-10-21 (round 10)

- Q: Where does a popover entry's icon sit when its name wraps? → A: **Beside the name's first line, at
  the top of the entry.** (FR-121)
- Q: Where is a toast's go-to control? → A: **With the card's Copy and Dismiss controls, drawn as they
  are.** (FR-122, narrowing FR-033's placement of the link)

### Session 2026-10-21 (round 11)

- Q: Should a tab's mark keep its native tooltip beside the tab's popover? → A: **No — no mark on any
  holder has a native tooltip; the popover is enough.** (FR-123, narrowing FR-015)
- Q: How does a Claude Code user get a notification as Claude finishes rather than a minute later? → A:
  **Documented: lower Claude Code's `messageIdleNotifThresholdMs`.** (docs only; no requirement)

### Session 2026-10-24 (round 12)

From issues [#525](https://github.com/Bidthedog/throng/issues/525), [#522](https://github.com/Bidthedog/throng/issues/522),
[#523](https://github.com/Bidthedog/throng/issues/523) and [#524](https://github.com/Bidthedog/throng/issues/524).
#524 (duplicate notifications from a panel already marked) is a defect against FR-112, except for the clause
the last answer below removes.

- Q: What on an attention toast takes the user to the panel? → A: **Clicking anywhere on the card** except
  Copy and Dismiss, which keep their own behaviour. The go-to control goes, and the other controls stay where
  they are. Clicking a Windows notification brings throng forward with the panel focused. (FR-124,
  superseding FR-122 and narrowing FR-034)
- Q: Can the user flag a panel by hand? → A: **Yes: Flag in every panel's right-click menu.** It marks the
  panel as Attention, reason "Flagged", and raises no toast and no Windows notification. It does not clear
  while the panel keeps the focus it had when flagged; once focus has left and come back, the clear delay
  runs as usual. (FR-125–FR-127) *[derived: it counts on every holder and the taskbar badge like any mark;
  Flag on a panel already marked changes nothing; the terminal master switch does not withdraw it]*
- Q: Does a manual flag survive closing and reopening throng? → A: **Yes, for every panel type**, as a
  terminal's mark does. (FR-128)
- Q: How should the project list show categories and counts? → A: **A minimised category's header is paler
  than an expanded one's, and every category header shows a pill with its total project count** in place of
  "N of M". (FR-129, FR-130; superseding 046 FR-051a's count text)
- Q: How does a holder say how many panels are marked? → A: **Its blinking flag carries the number, on project
  rows, tab chips and minimised category headers**, the glyph large enough to read it. (FR-131)
- Q: Does a tab chip show how many panels it holds? → A: **A pill with its panel count, only when it has two or
  more.** (FR-132)
- Q: May a flag or pill appearing move anything? → A: **No.** Row heights, text positions and chip widths stay
  put. (FR-133)
- Q: Should a mark restored at reopen, or raised by a startup command, announce on its next signal (FR-112)?
  → A: **No. A panel that is already marked never announces again until the mark clears**, whatever raised it.
  (FR-134, superseding FR-112's last sentence and FR-038a's last sentence)

## User Scenarios & Testing *(mandatory)*

### User Story 1 - See which project needs me from the project list (Priority: P1)

A user runs a long task in each of three projects, for example a Claude Code session in each, and works
in a fourth. When one of those terminals needs them, that project's row in the project list shows an
attention mark. They switch straight to that project instead of visiting each in turn.

**Why this priority**: This is the reason for the feature. Without it, the only way to learn that a
background project needs the user is to visit it.

**Independent Test**: With two projects open, run a command that waits five seconds and then rings the
bell in a terminal of project A. Switch to project B, and check that project A's row shows the mark
within a second of the bell. Switch to A, click into the terminal, and check that the mark has gone.

**Acceptance Scenarios**:

1. **Given** a terminal in project A rings the bell while the user is in project B, **When** the bell
   arrives, **Then** project A's row in the project list shows the Attention mark.
2. **Given** project A is marked, **When** the user switches to A and focuses the marked panel, **Then**
   the panel's mark clears, and A's row clears once no other panel in A is marked.
3. **Given** project A has two marked panels, **When** the user focuses only one, **Then** A's row stays
   marked until the second is focused, or has been active for the clear delay, too.
   *Superseded by FR-095 (Session 2026-10-19, round 2): the second must be focused too; being active no
   longer clears it.*
4. **Given** project A's terminals are kept running while A is unloaded (046), **When** one of them
   signals, **Then** A's row, drawn in the unloaded style, shows the mark.
5. **Given** project A is in a minimised category, **When** a panel in A is marked, **Then** the
   category's header row shows the mark as well.
6. **Given** the user is typing in a terminal, **When** it rings the bell (for example, a failed tab
   completion), **Then** no mark appears, because the focused panel never marks itself (FR-004).
7. **Given** one panel in A is Failed and another is Attention, **When** the user looks at A's row,
   **Then** it shows the Failed kind.
8. *(2026-10-19)* **Given** project A is marked, **When** the user looks at A's row, highlighted or
   not, **Then** the mark is where A's colour dot was, and the dot is back once the mark clears.
   (FR-092)
9. *(2026-10-19)* **Given** project A is the highlighted project and nothing in it is marked, **When**
   the user looks at its row, **Then** the colour dot is clearly visible against the fill, ringed in the
   row's text colour. (FR-094)
10. *(2026-10-19, round 2)* **Given** project A is marked, **When** the user switches to A from the
    project list and does not move focus into the marked panel, **Then** A's row and the panel stay
    marked. **When** they click into the panel and stay there for the clear delay, **Then** both clear.
    (FR-095)
11. *(2026-10-19, round 2)* **Given** two panels in A are marked, **When** the user hovers A's row mark,
    **Then** a popover lists both, one per line, each with its kind's icon, name and reason. (FR-097)
12. *(2026-10-19, round 2)* **Given** projects A and B in a minimised category are marked, **When** the
    user hovers the category header's mark, **Then** the popover lists A and then B, each with its marked
    panels beneath it. (FR-098)
13. *(2026-10-19, round 3)* **Given** panel "Claude" on tab "Agents" in project A is marked, **When** the
    user hovers A's row mark, **Then** its line reads "Agents › Claude" and its reason; hovering the
    minimised category's mark shows the same line under A's name. (FR-100)
14. *(2026-10-19, round 3)* **Given** a terminal rings the bell, **When** its mark is described anywhere — a
    popover, a toast, a Windows notification — **Then** the reason reads "Wants your attention", never
    "Bell". (FR-101)
15. *(2026-10-19, round 3)* **Given** Claude Code has set its terminal's title to "Fix the login bug",
    **When** it rings the bell, **Then** the toast, the Windows notification and the popover line read
    "Wants your attention — Fix the login bug". **Given** a shell with no title of its own ran
    `npm run build`, which exited, **Then** the description names `npm run build`. (FR-102)
16. *(2026-10-19, round 3)* **Given** project A has two marked panels, **When** the user clicks A's row
    mark, **Then** throng goes to the first; **when** they click it again, the second; **again**, the
    first. Clicking a minimised category's mark does the same across its projects' marked panels, in list
    order. (FR-105)
17. *(2026-10-19, round 3)* **Given** a marked tab is scrolled out of the tab strip, **When** the user
    hovers the overflow control's mark, **Then** a popover lists the hidden marked panels, one per line,
    as "Tab › Panel" and the reason. (FR-104)
18. *(2026-10-19, round 3)* **Given** project A has a marked panel, **When** the user right-clicks A,
    **Then** the menu offers Go to Next Marked Panel with its chord; the cog menu does not. (FR-106)
19. *(2026-10-19, round 4)* **Given** Claude Code ends its progress and, 30 s later, sends its own
    notification while the user is away, **Then** one toast (or one Windows notification) appears for
    the first, and the second changes that toast's text, if it is still showing, without a new one.
    (FR-112)
20. *(2026-10-19, round 4)* **Given** Preferences → Notifications, **Then** it shows one row each for
    Error, Warning, Info, Success and Attention, each with its display mode, its duration (usable only
    under Display for) and an "Also in the OS" switch, and above them one switch for OS notifications.
    Preferences → Attention keeps the clear delay and the taskbar badge only. (FR-108, FR-109)
21. *(2026-10-19, round 4)* **Given** Error's "Also in the OS" is on and throng is in the background,
    **When** a file fails to save, **Then** a Windows notification names the failure; clicking it brings
    throng forward. With throng focused, only the toast shows. With the global switch off, nothing
    reaches the OS. (FR-109, FR-110)
22. *(2026-10-19, round 4)* **Given** the selected project row holds a mark, **Then** the ⚑ or ✖ sits
    where the colour dot was, the same size, square-edged and uncut, in the row's text colour. (FR-107,
    FR-092)
23. *(2026-10-20, round 5)* **Given** Operating system notifications is switched off, **Then** every row's
    OS Notify is greyed out and shows the setting it had; switching it back on makes them usable again,
    unchanged. (FR-113)
24. *(2026-10-20, round 6)* **Given** a project row holds a mark, **Then** the ⚑ is drawn at 16 × 16, centred
    on where the dot was, and the project name sits exactly where it does with the dot. (FR-114)
25. *(2026-10-20, round 6)* **Given** a terminal titled "Fix the login bug" rings the bell while the user is
    away, **Then** the notification reads "Fix the login bug" over "Wants your attention", with no kind in
    brackets. (FR-115)
26. *(2026-10-20, round 7)* **Given** Claude Code, titled "✳ Fix the login bug", sends "Claude is waiting for
    your input" while the user is away, **Then** the notification reads "✳ Fix the login bug" over "Wants your
    attention — Claude is waiting for your input". (FR-116; *superseded by scenario 27*)
27. *(2026-10-20, round 8)* **Given** Claude Code sends "Claude is waiting for your input" while the user is
    away, **Then** the notification reads the panel's title over "Claude is waiting for your input" alone; a
    finished `npm test` reads "npm test has finished"; a bell reads "Wants your attention". (FR-117)
28. *(2026-10-21, round 9)* **Given** a tab holding a marked panel is opened, **Then** that panel's header is
    filled with the Attention (or Failed) colour and the others' are not; going to it clears both. (FR-118)
29. *(2026-10-21, round 9)* **Given** a minimised category with two marked projects, **When** its mark is
    hovered, **Then** each project's bold name heads its entries — "⚑ Tab - Title" over the indented line
    "Wants your attention" — with rules between entries and between projects. (FR-119)
30. *(2026-10-21, round 9)* **Given** a mark is announced, **Then** its toast and Windows notification are
    headed "Project — Tab — Title". (FR-120)
31. *(2026-10-21, round 10)* **Given** a marked panel whose "Tab - Title" wraps in its popover, **Then** its
    icon sits beside the first line. (FR-121)
32. *(2026-10-21, round 10)* **Given** an attention toast, **Then** its go-to control sits at the card's
    top-right with Copy and Dismiss, in the same style. (FR-122; *superseded by US3 scenario 9, round 12 —
    the card has no go-to control*)
33. *(2026-10-21, round 11)* **Given** a marked tab, **When** its mark is hovered, **Then** no native tooltip
    appears over it; the tab's popover alone shows. (FR-123)
34. *(2026-10-24, round 12)* **Given** project A has three marked panels, **When** the user looks at A's row,
    **Then** its blinking flag reads 3. **When** two are cleared, it reads 1; **when** the last clears, the colour
    dot is back. (FR-131)
35. *(2026-10-24, round 12)* **Given** a minimised category holding projects A (two marked panels) and B (one),
    and an expanded category beside it, **Then** the minimised header is visibly paler than the expanded one, in a
    light and a dark theme; each header shows a pill with its total number of projects and no "N of M"; the
    minimised header's flag reads 3. (FR-129, FR-130, FR-131)
36. *(2026-10-24, round 12)* **Given** a project row and a category header, **When** a flag appears on them,
    its number changes, or it goes, **Then** neither row changes height and the project and category names do not
    move. (FR-133)
37. *(2026-10-24, round 12)* **Given** the user is in a panel, **When** they right-click it and choose Flag,
    **Then** the panel, its tab and its project row are marked "Flagged", the taskbar badge counts it, and no toast
    or Windows notification appears. **When** they stay in the panel, **Then** it stays flagged however long they
    stay; **when** they click into another panel and back, **Then** it clears after the clear delay. (FR-125,
    FR-126, FR-127)
38. *(2026-10-24, round 12)* **Given** an editor panel and a terminal panel are flagged by hand, **When** throng
    is closed and reopened, **Then** both are still flagged; **when** terminal attention is switched off, **Then**
    both stay flagged. (FR-128)

---

### User Story 2 - See which tab and which panel needs me (Priority: P1)

Within a project the user has several tabs, and some tabs are split into several panels. A terminal in a
tab that is not shown signals, and that tab's chip shows the mark. When the tab is scrolled out of the
strip, the overflow control shows that something hidden is marked. A terminal next to the one the user
is typing in signals, and its header shows the mark although it is on screen.

**Why this priority**: The project mark gets the user to the right project. Without the tab and panel
marks, they are back to clicking through that project's tabs and panels.

**Independent Test**: In a tab split into two terminals, run a delayed bell in the right-hand one and
click into the left-hand one. Check that the right-hand panel's header and the tab chip both show the
mark. Click into the right-hand panel, and check that both clear.

**Acceptance Scenarios**:

1. **Given** a terminal in tab 1 signals while tab 2 is shown, **When** the signal arrives, **Then** tab
   1's chip shows the mark.
2. **Given** the marked tab is scrolled out of the tab strip, **When** the mark appears, **Then** the
   overflow control on that side shows that a hidden tab is marked.
3. **Given** two terminals side by side and the user focused in the left one, **When** the right one
   signals, **Then** the right one's header shows the mark, and so do the tab chip and the project row.
4. **Given** a marked panel inside a tab, **When** the user focuses it, **Then** the panel's mark clears,
   and the tab's clears once no other panel in that tab is marked.
5. **Given** a marked panel, **When** the user hovers over or keyboard-focuses a mark on any holder,
   **Then** the tooltip and accessible name say which panel is marked and why, for example "Terminal —
   build: notification 'Tests passed'". A holder with several marked panels lists them.
6. *(2026-10-19)* **Given** a marked panel, **When** the user looks at its mark on any holder, **Then**
   the mark blinks slowly. **When** Windows is set to show fewer animations, **Then** it is still.
   (FR-093)
7. *(2026-10-19, round 2)* **Given** a marked panel, **When** the user hovers the mark on its header,
   **Then** no tooltip appears. (FR-096)
8. *(2026-10-24, round 12)* **Given** a tab holding three panels, two of them marked, and a tab holding one
   panel, **Then** the first tab's chip shows a pill reading 3 and a blinking flag reading 2, and the second
   shows no pill. **When** the marks clear, **Then** the first chip keeps its width. (FR-131, FR-132, FR-133)

---

### User Story 3 - Be told when I am looking elsewhere (Priority: P1)

The user is in another application, or in another project of throng. A terminal needs them. A
notification appears — a Windows notification when throng is not focused, a toast inside throng when it
is — naming the project, the panel and the reason. Clicking its link brings throng forward and lands on
the panel.

**Why this priority**: A mark in the project list only helps a user who is looking at throng. The
primary use case is often a user who has switched away while an agent works.

**Independent Test**: With default settings, run a delayed bell in a terminal and switch to another
application. Check that a Windows notification appears. Click it, and check that throng comes forward
with that panel focused and its mark cleared. Repeat with throng focused on another project, and check
that a toast appears instead, and that its link does the same.

**Acceptance Scenarios**:

1. **Given** default settings and throng not focused, **When** a panel is marked, **Then** a Windows
   notification appears naming the project, the panel and the reason.
2. **Given** default settings and throng focused, **When** a panel that is not focused is marked,
   **Then** an in-app toast appears instead of a Windows notification, naming the same things.
3. **Given** either notification, **When** the user activates its link, **Then** throng switches to the
   project and tab holding the panel, focuses the panel, and so clears its mark (FR-005; superseded by
   FR-095 — the mark clears once the panel has held focus for the clear delay).
4. **Given** a panel already has a toast or notification showing for its mark, **When** it signals
   again, **Then** that notification is updated with the new reason, and no second one appears for the
   same panel.
5. **Given** a mark clears by any route, **When** it clears, **Then** its in-app toast is dismissed.
6. **Given** OS notifications are switched off in Preferences, **When** a panel is marked while throng is
   not focused, **Then** no Windows notification appears, and an in-app toast does if the kind's delivery
   includes one.
7. **Given** three panels are marked, one of them Failed, **When** the user looks at the taskbar,
   **Then** throng's button carries a badge reading 3 in the Failed style. **When** they focus two of the
   panels, **Then** it reads 1, and it disappears once the last is focused.
8. *(2026-10-19, round 2)* **Given** Claude Code is running in a terminal with its notifications set to
   `iterm2`, **When** the user asks it to notify them in 30 seconds and switches to another tab, **Then**
   its notification reaches throng: the panel is marked and the toast carries Claude's message. (FR-099)
9. *(2026-10-24, round 12)* **Given** an attention toast for a panel in another project, **When** the user
   clicks anywhere on the card other than Copy or Dismiss, **Then** throng switches to that project and tab and
   focuses the panel. **When** they click Copy or Dismiss, **Then** nothing navigates. The card has no go-to
   control, and Copy and Dismiss sit where they did. **Given** a Windows notification, **When** the user clicks
   it, **Then** throng comes forward with that panel focused. (FR-124)
10. *(2026-10-24, round 12)* **Given** a marked panel restored when throng reopened, or marked by its startup
    command, **When** its terminal rings the bell while the mark still shows, **Then** no toast and no Windows
    notification appear. **When** the mark has cleared and it rings again, **Then** it is announced. (FR-134)

---

### User Story 4 - Choose what raises a mark, and how I am told (Priority: P1)

A user finds a signal noisy in their workflow — a tool that rings the bell constantly — and switches it
off. Another wants every change of output flagged, and switches **Unseen output** on. A user who wants no
Windows notifications switches them off, and keeps the marks and toasts. A user who wants
none of it switches terminal attention off.

**Why this priority**: The user asked for every reporting route to be switchable, and a mark that cries
wolf is ignored. The defaults must be accurate, and anything that is not must be the user's choice.

**Independent Test**: In Preferences, switch Bell off, repeat User Story 1's test, and check that no mark
appears. Switch it back on, and check that one does. Switch terminal attention off, and check that no
signal raises a mark.

**Acceptance Scenarios**:

1. **Given** Preferences, **When** the user opens the attention settings, **Then** they find: a setting
   per terminal signal, each saying whether it is exact or heuristic; a master switch for terminal
   attention; the delivery for each kind; a switch for OS notifications; a switch for the taskbar
   badge; the clear delay; and the went-quiet interval.
2. **Given** a signal is switched off, **When** that signal occurs, **Then** no mark is raised for it.
3. **Given** terminal attention is switched off, **When** any terminal signal occurs, **Then** no mark is
   raised, and existing marks raised by terminal signals are cleared.
4. **Given** one signal is switched off while panels are marked only by it, **When** the setting is
   saved, **Then** the existing marks stay until cleared. Switching one signal off stops new marks; it
   does not erase what the user has not yet seen.
5. **Given** default settings, **When** the user works in an ordinary interactive shell — typing,
   tab-completing, running short commands in the panel they are focused on — **Then** no mark is raised.

---

### User Story 5 - Know when a long-running command finishes (Priority: P2)

A user starts a build or a test run, then moves to another tab or project. When the command finishes,
or the program it started detaches and leaves the shell at its prompt, the panel is marked, without the
program having to ring a bell.

**Why this priority**: Most scripts never ring a bell. Command finished is the one exact signal that
covers them, and it works in every shell flavour because it needs no cooperation from the shell (025
FR-022).

**Independent Test**: Run a ten-second sleep in a terminal, switch tabs, and check that the tab is marked
within two seconds of the command ending.

**Acceptance Scenarios**:

1. **Given** a command is running in a terminal that is not focused, **When** it ends and the shell is
   left with nothing running, **Then** the panel is marked with the reason "command finished", naming
   the command.
2. **Given** a command that starts and ends within one observation interval, **When** it runs, **Then**
   it may not be observed at all. This is 025 FR-019d's accepted staleness window, and the setting's
   description says so.
3. **Given** a command that starts a background process and exits, **When** the command ends, **Then**
   the panel is marked. Under 025 FR-022a an orphaned grandchild does not count as running.

---

### User Story 6 - Know when a terminal ends (Priority: P2)

A terminal's process exits while the user is elsewhere: a program crashed, a remote session dropped, a
script called `exit`. The panel reverts to its type form with its exit notice (005 FR-020), and the
panel and its holders are marked, Failed if the exit code was not zero.

**Why this priority**: An ended terminal is the most definite thing that needs the user, and it is
already observed exactly.

**Independent Test**: Run a command that waits five seconds and exits with code 1, switch projects, and
check that the project is marked Failed when the shell exits.

**Acceptance Scenarios**:

1. **Given** a terminal that is not focused, **When** its process exits by a path the user did not
   cause, **Then** the panel and its holders are marked "exited" with the exit code. The kind is Failed
   for a non-zero code and Attention for zero.
2. **Given** the user ends a terminal themselves (FR-064), **When** it exits, **Then** no mark is raised.
3. **Given** an exited terminal is marked, **When** the user focuses the panel, **Then** the mark clears,
   and the exit notice on the panel stays as 005 defines it.

---

### User Story 7 - Jump to what needs me (Priority: P3)

A user sees that something is marked and presses a key binding, **Go to Next Marked Panel**. It takes
them to the next marked panel, switching project and tab as needed, and focuses it. Pressing it again
goes to the next one.

**Why this priority**: The marks remove the guessing. This removes the clicking, and gives a
keyboard-only route to the same result (Principle VI).

**Independent Test**: Mark panels in two projects, press the binding twice, and check that each press
lands on a marked panel and clears it.

**Acceptance Scenarios**:

1. **Given** at least one panel is marked, **When** the user invokes Go to Next Marked Panel, **Then**
   throng switches to the project and tab holding the next marked panel after the current position, and
   focuses it.
2. **Given** nothing is marked, **When** the user invokes it, **Then** nothing changes and no notice is
   raised.
3. **Given** the Key Bindings editor, **When** the user looks for the command, **Then** it is listed and
   can be rebound like any other.

---

### Edge Cases

- **Repeated signals.** A marked panel that signals again stays marked once. Its reason becomes the most
  recent one, and its kind becomes Failed if the new signal is a failure. Repeats never stack, flash or
  multiply (one condition, one notice).
- **A bell storm.** A program ringing the bell continuously raises one mark and one notification, and
  costs the terminal nothing measurable.
- **Focus moves away inside the clear delay.** The delay restarts the next time the panel becomes active.
  A panel that is active for 600 ms, loses it, and is active again for 600 ms is still marked.
- **The window loses focus with a marked panel active.** The clear delay counts only while the window is
  focused.
- **A signal from the panel that is active in an unfocused window.** The panel is marked, and the OS
  notification fires. When the user returns and focus lands back in that panel, the mark clears at
  once (FR-005). If focus lands elsewhere, the mark stays until the panel is focused, because it was
  raised while the panel was already active (FR-006).
- **A signal from the active panel while focus is elsewhere in the same window** (for example, the
  File Explorer). The panel is marked and stays marked until focused. The clear delay does not erase it
  (FR-006).
- **A panel moved between tabs, or a tab moved between projects.** The mark travels with the panel, and
  every holder is recomputed.
- **A panel destroyed, or a project deleted, while marked.** The mark goes with it, and its notifications
  are dismissed.
- **throng's window closed while terminals keep running (Principle III).** Exits, and the signals carried
  in a terminal's output, are remembered. When throng reopens, the panels are marked, without a
  notification for each, which would be a burst of stale popups. Command finished is not observed while
  no window is open (025 FR-019f, unchanged for that case).
- **A project restored with many terminals.** Each unattended terminal whose startup command finishes is
  marked, and the badge counts them, but no toast or Windows notification appears for any of them
  (FR-038a). A terminal the user has already focused by then raises nothing (FR-004).
- **A notification with no message, or with control characters.** It still raises the mark. The message
  shown is single-line, bounded in length and free of control characters; anything else is dropped,
  leaving the reason as "notification".
- **Progress that only updates.** A progress report that does not end — set, update, indeterminate —
  raises nothing. Only "completed" and "error" do.
- **Output went quiet, then resumed.** A mark already raised stays until cleared. Quiet is measured
  afresh after each burst of output.
- **A link to a panel that has gone.** Activating a notification whose panel no longer exists does
  nothing beyond dismissing the notification.
- **Windows notifications disabled for throng in the OS.** throng cannot override that. The marks and
  in-app toasts still work.

## Requirements *(mandatory)*

### Functional Requirements

#### A. Panel attention marks (every panel type)

- **FR-001**: Every panel, of every type, MUST support an attention mark through one mechanism. The
  mechanism MUST NOT know what raised a mark, and MUST NOT read any producer's settings. Producers
  decide whether to raise; the mechanism decides how a mark is shown, notified and cleared.
- **FR-002**: A mark MUST have a kind, Attention or Failed, and a reason: a short label naming what
  raised it, with any detail (exit code, command, message). A raise on a marked panel MUST replace the
  reason, and MUST set the kind to Failed if either the existing kind or the new one is Failed.
- **FR-003**: A mark MUST be shown in the panel's header.
- **FR-004**: A raise on the focused panel MUST be ignored. The user is **attending** a panel exactly
  when it is the focused panel (Definitions), and the test is made at the moment the raise happens. This
  applies to every signal and every producer, with no exceptions. A panel that is visible but not
  focused, or active in a window that is not focused, is unattended.
- **FR-005**: A mark MUST clear immediately when the user focuses its panel by any route: clicking into
  it, moving keyboard focus to it, or any in-app action that activates it (a notification link, Go to
  Next Marked Panel, a split or drop that focuses it, opening a link into it).
- **FR-006**: A mark that already existed when its panel **became** the active panel of the shown tab
  (by switching tab, switching project, or moving between panels) MUST also clear once the panel has
  stayed active, in a focused window, continuously for the **clear delay**. The delay is a setting:
  default 1000 ms, range 0–10,000 ms. Losing active status restarts it. A mark raised while its panel
  was already active but not focused MUST NOT be cleared by the delay. It stays until the user focuses
  the panel (FR-005), or until the panel next becomes active after losing active status. A window
  regaining focus does not by itself make its panel become active.
  *FR-005 and FR-006 are superseded by FR-095 (Session 2026-10-19, round 2) — a mark clears only after
  its panel has held keyboard focus in the workspace pane for the clear delay; becoming active no longer
  clears it.*
- **FR-007**: A mark MUST otherwise persist until its panel is destroyed, its project is deleted, or its
  producer withdraws it (FR-063).
- **FR-008**: A producer MUST be able to withdraw the marks it raised. No other route exists to clear a
  mark without the user focusing the panel.
- **FR-009**: Only terminal panels have a producer in this feature. Editors, previews and search results
  MUST be able to gain one later without changing the mechanism.
  *Extended by FR-125 (2026-10-24, round 12): the user is a second producer, on every panel type.*

#### B. Holders

- **FR-010**: A tab chip MUST show the mark while any panel in the tab is marked.
- **FR-011**: When a marked tab chip is scrolled out of the tab strip, the overflow control on its side
  MUST show that a hidden tab is marked, alongside the hidden-tab count it already shows.
- **FR-012**: A project's row in the project list MUST show the mark while any panel in any of its tabs
  is marked. That includes the active project, and an unloaded project whose terminals are kept running.
- **FR-013**: A minimised category's header row MUST show the mark while any project in it is marked.
  *(2026-10-18)* A minimised category shows its loaded projects' rows and hides its unloaded ones (046
  FR-052a, added for #489 in PR #506). A visible row carries its own mark as FR-012 requires. The header is the only holder for a
  hidden row, which is typically an unloaded project whose terminals keep running, so it MUST mark for
  those rows as well as for visible ones.
- **FR-014**: A holder MUST show the Failed kind if any panel beneath it is Failed, and Attention
  otherwise.
- **FR-015**: The tooltip and accessible name of a mark, on the panel or on any holder, MUST name each
  marked panel it stands for, with its project, its reason and its kind.
  *Narrowed by FR-096, FR-097 and FR-098 (Session 2026-10-19, round 2) — no tooltip on a panel header's
  mark; a popover instead of a tooltip on a project row and a category header. Every accessible name is
  unchanged.*
- **FR-016**: A mark MUST NOT be conveyed by colour alone. Each kind is an icon with an accessible name.
  Each kind's colour is a theme token with a value in every shipped theme. Each icon comes from the icon
  registry, so icon packs can replace it.
- **FR-017**: A mark MUST be visibly distinct from the unsaved-changes dot (011 FR-020), which appears in
  the same places. A holder may show both. *(2026-10-18)* Both kinds MUST stay legible on a selected
  project row filled with the project's colour (046, as amended for #489), whatever that colour is.
  *(2026-10-19)* On a project row, FR-092 now meets this by placement rather than by a backing disc
  beside the name.
- **FR-092** *(2026-10-19)*: On a project row, the mark MUST be shown in place of the project's colour
  dot while the project is marked, on every row, highlighted or not, so it sits in the same spot on
  each. The dot returns when the mark clears. A row with unsaved changes still shows the unsaved dot
  beside its name, as FR-017 requires. Other holders are unchanged.
- **FR-093** *(2026-10-19)*: Every mark, on the panel and on every holder, MUST blink slowly: a steady
  cycle between full and reduced opacity, slower than the unsaved-changes dot's pulse (011 FR-023), and
  well under three cycles a second. When the operating system asks for reduced motion, a mark MUST be
  shown still at full opacity. *(The period, 2 s, and the reduced-motion rule are derived from 011
  FR-023's unsaved-dot pulse; not confirmed by the user.)*
- **FR-094** *(2026-10-19; extends 046 FR-072a)*: On the selected project's row, filled with the
  project's colour, an unmarked colour dot MUST carry a ring in the row's contrast colour (black or
  white, as 046 FR-072a picks for the row's text), thick enough to read against the fill whatever the
  colour. This is a change to 046's row, recorded here because the attention work exposed it; 046
  FR-072a is otherwise unchanged.
- **FR-095** *(2026-10-19, round 2; supersedes FR-005 and FR-006)*: A mark MUST clear only once the
  user has **focused** its panel — keyboard focus inside that panel, in the workspace pane, in a focused
  window — continuously for the **clear delay** (the same setting: default 1000 ms, range 0–10,000 ms;
  0 clears on focus). Losing focus restarts the delay. Being the active or visible panel is not focus:
  switching to its project or tab from the project list, the tab strip or anywhere outside the
  workspace pane leaves the mark in place until the user moves focus into the panel. A notification
  link or Go to Next Marked Panel moves focus into the panel, so the delay then runs. FR-004's attended
  panel is the same focused panel. *(The delay-after-focus answer is the user's; the rest follows from
  it.)*
- **FR-096** *(2026-10-19, round 2; narrows FR-015)*: A mark on a panel's own header MUST NOT carry a
  tooltip; its accessible name stays as FR-015 requires. The panel it marks is the one it sits on, so the
  tooltip only repeated the kind.
- **FR-097** *(2026-10-19, round 2; supersedes FR-015's tooltip on a project row)*: Hovering or
  keyboard-focusing a project row's mark MUST open a popover like the tab hover popover (031 FR-051):
  one line per marked panel in that project, each with its kind's icon, the panel's name and the reason,
  in layout order. It replaces the row mark's native tooltip; the accessible name still names each marked
  panel (FR-015).
- **FR-098** *(2026-10-19, round 2; supersedes FR-015's tooltip on a category header)*: Hovering or
  keyboard-focusing a category header's mark MUST open the same popover, grouped by project: each marked
  project's name, then its marked panels' lines beneath it, projects in list order.
- **FR-099** *(2026-10-19, round 2)*: A terminal program that has turned on focus reporting (DEC private
  mode 1004) MUST be told when its panel stops and starts being **attended** (FR-004: the focused panel,
  keyboard focus in the workspace pane, in a focused window) — `CSI O` on losing it and `CSI I` on
  regaining it — whatever the route: a tab or project switch, focus moving out of the workspace pane,
  throng's window losing focus. This holds while the panel has no view (a background tab, an unloaded
  project), so the daemon, which sees the program's output either way, MUST track the mode and write the
  reports, and MUST NOT repeat a state the program was last told. A program that turns the mode on while
  its panel is unattended MUST be told `CSI O` at once. The view MUST NOT send reports of its own, so the
  program hears exactly one. *(Found by a peer session: Claude Code suppresses its own notifications
  while it believes its terminal has focus, and switching tab or project unmounted the view without
  telling it — so the Notification signal never fired. The user chose to fix it in this branch.)*
- **FR-100** *(2026-10-19, round 3; extends FR-097 and FR-098)*: Each line of a mark's popover MUST name
  the panel's tab and the panel ("Tab › Panel"), then the reason. On a category header the project's name
  heads its group (FR-098), so the three are all shown. A mark keeps the tab's name it was raised with,
  and a window hosting the panel refreshes it, as it does the panel's title.
- **FR-101** *(2026-10-19, round 3)*: A bell MUST be described as "Wants your attention" wherever a mark's
  reason is shown, read after the panel's name.
- **FR-102** *(2026-10-19, round 3; extends FR-033)*: A mark MUST carry what its terminal was doing when
  it was raised — the window title the program set (OSC 0 / 2), if it set one, else the last command the
  terminal ran — and its toast, Windows notification and popover line MUST show it after the reason
  ("Wants your attention — Fix the login bug"). It is left out when neither is known, or when the reason
  already names it (a finished command's own command line). *For toasts and Windows notifications, superseded by FR-115 (round 6); the popover keeps it.*
- **FR-103** *(2026-10-19, round 3; narrows FR-037; superseded by FR-111, round 4)*: A mark's in-app toast MUST answer to a display
  setting of its own per kind — Never display, Display for (with a duration) or Dismiss only — instead of
  the Info / Error notice settings. Defaults: Attention, Display for 10 s; Failed, Dismiss only. The
  severity still sets the toast's colour, icon and log level (FR-037).
- **FR-104** *(2026-10-19, round 3; extends FR-011)*: Hovering or keyboard-focusing a tab-strip overflow
  control's mark MUST open the FR-097 popover listing the marked panels on that side's hidden tabs, one
  per line, as "Tab › Panel" and the reason (FR-100).
- **FR-105** *(2026-10-19, round 3)*: Clicking a project row's mark MUST go to the next of that project's
  marked panels (layout order where known, else the order they were raised), wrapping, as Go to Next
  Marked Panel goes to one (FR-080). Clicking a category header's mark MUST do the same across the marked
  panels of its projects, project by project in list order.
- **FR-106** *(2026-10-19, round 3; supersedes FR-082)*: Go to Next Marked Panel MUST NOT appear in the
  cog menu. A project's context menu MUST offer it while that project has a marked panel, showing its
  chord, and it then goes to that project's next marked panel. *Narrowed (2026-10-19, round 3 review):
  the row shows no chord — it walks this project's cycle (FR-105), while the chord ranges over every
  project, so showing it would teach a key that does something else.* The chord is unchanged (FR-081); a
  command that is not a panel action may stand without a menu item (constitution VI, v5.6.0).
- **FR-107** *(2026-10-19, round 4; narrows FR-017)*: On the selected project row a mark MUST be drawn
  in the row's contrast colour (046 FR-072a), with nothing behind it; elsewhere it keeps its kind's
  colour. The glyph tells Attention from Failed.
- **FR-108** *(2026-10-19, round 4; extends 030 FR-001 and FR-002)*: Preferences → Notifications MUST show
  one row per notification type — Error, Warning, Info, Success, Attention — holding on one line its
  display mode (Never display / Display for / Dismiss only), its duration (usable only under Display
  for, 030 FR-011) and **Also in the OS**. Each is still its own setting with its own descriptor
  (constitution, 007 FR-025a); the row only groups them, and its Reset and Revert act on all of them.
  030 FR-008's consent for Never display on Error and Warning still applies.
- **FR-109** *(2026-10-19, round 4; supersedes FR-032)*: One switch, **Operating system notifications**
  (`notifications.os`, default on), MUST stop every notification reaching the OS while it is off, whatever
  each type says.
- **FR-110** *(2026-10-19, round 4; supersedes 030 "Out of Scope: operating-system-level or background
  notifications")*: A notice of a type with **Also in the OS** on MUST also raise a Windows notification
  while no throng window is focused, naming what the toast names; activating it MUST bring throng
  forward. Independent of the display mode: Never display with the OS on gives the Windows notification
  alone. Defaults: off for Error, Warning, Info and Success; on for Attention. 030 FR-008's consent text
  MUST say a silenced severity still reaches the OS when its switch is on.
- **FR-111** *(2026-10-19, round 4; supersedes FR-030, FR-031, FR-037 and FR-103)*: Attention MUST be one
  notification type covering both kinds of mark (`notifications.attention`: mode, duration, OS); Failed
  marks follow it, keeping the Error colour and icon (FR-037's severity mapping survives for appearance
  only). Defaults: Display for 10 s, OS on. Preferences → Attention keeps the clear delay and the taskbar
  badge.
- **FR-112** *(2026-10-19, round 4; narrows FR-035)*: A mark MUST be announced once. A later raise on a
  panel still marked updates the mark, its popover and the text of any toast still showing — without
  flashing it or restarting its timer (an exemption from 041 FR-008) — and raises no new toast or Windows
  notification. Once the mark has cleared, the next raise announces again. A mark raised without an
  announcement — restored (FR-038) or by a startup command (FR-038a) — is announced by its next raise.
  *Its last sentence is superseded by FR-134 (2026-10-24, round 12): such a mark is not announced by a later
  raise either.*
- **FR-113** *(2026-10-20, round 5; renames FR-108's and FR-110's "Also in the OS")*: Each row's OS switch
  MUST be labelled **OS Notify**, and its description MUST say it raises a Windows notification whatever
  the display mode, only while throng is not focused, the in-app notice deciding while it is. While
  **Operating system notifications** (FR-109) is off, every OS Notify MUST be inert — greyed, with its
  label — and keep its value.
- **FR-114** *(2026-10-20, round 6; narrows FR-092)*: On a project row the mark MUST reserve no more space
  than the colour dot, whose size does not change, and draw nothing of its own there; its glyph MUST be drawn
  at 16 × 16, centred over that space, overlapping its edges.
- **FR-115** *(2026-10-20, round 6; supersedes FR-033, and FR-102 for notifications)*: A toast and a Windows
  notification MUST be headed by the panel's title — the terminal's window title unless the user named the
  panel — and read **Wants your attention** for an Attention mark, whatever raised it, or what failed for a
  Failed mark. Neither names the project or shows the kind in words. The popovers keep the reason and what
  the terminal was doing (FR-100, FR-102).
- **FR-116** *(2026-10-20, round 7; narrows FR-115)*: After "Wants your attention" — or what failed — a
  notification MUST add the message the program sent, if any, then what the terminal was doing (FR-102)
  unless the title or the message already says it, joined by " — ". Its title MUST be the one the panel's
  header shows at the moment it is raised. *Its text is superseded by FR-117 (round 8); its title rule stands.*
- **FR-117** *(2026-10-20, round 8; supersedes FR-116's text)*: Under the panel's title a notification MUST
  say one line and nothing appended: what failed, for a Failed mark; else the message the program sent, if
  it sent one; else "<command> has finished" for a finished command; else **Wants your attention**.
- **FR-118** *(2026-10-21, round 9)*: While a panel is marked, its header MUST be filled with its mark's
  colour (Attention or Failed), mixed into the header surface so its title stays readable, and over the
  active panel's header fill. It goes when the mark clears.
- **FR-119** *(2026-10-21, round 9; narrows FR-097, FR-098, FR-100 and FR-104)*: A mark's popover MUST list
  each marked panel as its kind's icon and "Tab - Title" (the title alone when the tab is not known), with
  its notification line (FR-117) on the line beneath, indented. Entries MUST be separated by a rule — within
  a project, indented with them. A category's popover heads each project's entries with the project's name
  in bold and separates projects by a full-width rule; a project's own popover has no project name.
- **FR-120** *(2026-10-21, round 9; narrows FR-115)*: A toast and a Windows notification MUST be headed by
  the project, the tab and the panel's title, as the notice subject formats them ("Project — Tab — Title"),
  leaving out a name that is not known.
- **FR-121** *(2026-10-21, round 10; narrows FR-119)*: A popover entry's icon MUST sit at the top of the
  entry, beside the first line of its "Tab - Title", however many lines the name wraps to.
- **FR-122** *(2026-10-21, round 10; narrows FR-033)*: A toast's go-to-panel control MUST be one of the
  card's own controls, before Copy and Dismiss at its top-right and styled as they are — not in the card's
  body. It is not part of the copied text. *Superseded by FR-124 (2026-10-24, round 12): the card has no
  go-to control; its body is the link.*
- **FR-123** *(2026-10-21, round 11; narrows FR-015)*: No attention mark, on any holder, MUST carry a native
  tooltip; every holder that explains itself does so by its popover. Every accessible name is unchanged.
- **FR-124** *(2026-10-24, round 12; supersedes FR-122, narrows FR-034)*: Clicking anywhere on an attention
  toast other than its Copy and Dismiss controls MUST do what FR-034's link does: switch to the project and tab
  holding the panel and focus it. Copy and Dismiss MUST NOT navigate. The toast MUST NOT carry a go-to control of
  its own, and Copy and Dismiss MUST keep the position they have today. Activating a Windows notification
  anywhere MUST bring throng forward and focus the panel (FR-034, restated).
- **FR-125** *(2026-10-24, round 12; extends FR-001 and FR-009)*: Every panel's context menu MUST offer
  **Flag**. Choosing it raises a mark from a second producer, the **user**: kind Attention, reason "Flagged",
  with nothing for the user to enter. On a panel already marked it MUST change nothing *[derived]*. A key
  binding is optional; the menu item is not (constitution VI). Out of scope: custom reasons, colours, Unflag.
- **FR-126** *(2026-10-24, round 12)*: A manual flag MUST NOT be announced: no toast and no Windows
  notification. It MUST otherwise be a mark like any other — on the panel header (FR-003, FR-118) and every
  holder, counted by FR-131 and by the taskbar badge (FR-039) *[derived]*.
- **FR-127** *(2026-10-24, round 12; narrows FR-095 for a manual flag)*: The clear delay MUST NOT run on a
  manual flag while its panel still holds the focus it had when the flag was raised. Once focus has left the
  panel and returned, FR-095 applies unchanged.
- **FR-128** *(2026-10-24, round 12; extends FR-091)*: A manual flag MUST survive switching projects, unloading
  a project, and closing and reopening throng, for every panel type. Restoring it MUST NOT announce it (FR-038).
  It MUST NOT be withdrawn by the terminal attention master switch (FR-063), which withdraws only what the
  terminal producer raised *[derived]*. It goes when it clears, its panel is destroyed or its project is
  deleted (FR-007).
- **FR-129** *(2026-10-24, round 12; supersedes 046 FR-051a's "shown of total" text)*: Every category header
  MUST show a pill holding the total number of projects in the category, minimised or not. No "N of M" text
  MUST remain.
- **FR-130** *(2026-10-24, round 12)*: A minimised category's header MUST be visibly paler than an expanded
  one's, in every bundled theme, light and dark. *[derived: mixed from the existing header surface, as FR-118
  mixes the mark colours, so every theme has it without a token of its own]*
- **FR-131** *(2026-10-24, round 12; extends FR-014, FR-093 and FR-114)*: The mark on a project row, a tab chip
  and a minimised category header MUST show, inside its flag, the number of marked panels beneath it, and keep
  blinking (FR-093) and the Failed style when any is Failed (FR-014). The glyph MUST be large enough, or changed,
  for the number to be legible at the default UI scale. Counts above 9 show as "9+" *[derived: FR-039's rule]*.
  A panel header's mark carries no number *[derived: it stands for one panel]*.
- **FR-132** *(2026-10-24, round 12; narrows 031 FR-042)*: A tab chip whose tab holds two or more panels MUST
  show a pill with its panel count; a tab holding one panel shows none. 031 FR-042's pill form is unchanged;
  only the one-panel pill goes. The tab's hover popover still names its panel count (031 FR-043).
- **FR-133** *(2026-10-24, round 12)*: A flag or pill appearing, changing its number or going MUST NOT change
  a row's height, the position of any text, or a tab chip's width.

#### C. Notifications

- **FR-030**: Each kind MUST have a **delivery** setting with the values **In App Notification**, **OS
  Notification** and **Both**. The default for both kinds is **Both**. Marks are raised whatever the
  delivery; delivery governs only notifications. A user who wants no in-app toasts silences the
  severity in 030 (FR-037), and one who wants no Windows notifications switches them off (FR-032).
  *Superseded by FR-111 (round 4): one Attention notification type, under Notifications.*
- **FR-031**: **In App Notification** MUST raise an in-app toast. **OS Notification** MUST raise a
  Windows notification when no throng window is focused, and an in-app toast in its place when one is.
  **Both** MUST raise an in-app toast and, when no throng window is focused, a Windows notification too.
  *Superseded by FR-110 / FR-111 (round 4): a display mode and an "Also in the OS" switch.*
- **FR-032**: A switch MUST turn OS notifications off entirely. Default: on. With it off, OS Notification
  behaves as In App Notification. *Superseded by FR-109 (round 4): one global switch for every type.*
- **FR-033**: A notification MUST name the project, the panel and the reason, and show the kind. *Superseded by FR-115 (round 6).*
- **FR-034**: A notification MUST carry a link that switches to the project and tab holding the panel
  and focuses it, which clears the mark (FR-005; superseded by FR-095 — after the clear delay). Activating a Windows notification MUST bring throng's
  window forward and do the same. This is a new capability for toasts (see Extension, above).
- **FR-035**: A panel MUST have at most one in-app toast and one Windows notification at a time. A raise
  on a panel that already has one MUST update it rather than add another. *Narrowed by FR-112 (round 4):
  the update is silent, and no new announcement is made while the mark stands.*
- **FR-036**: Clearing a mark by any route MUST dismiss its in-app toast.
- **FR-037**: An attention toast MUST be subject to 030's display mode for its severity, like any other
  notice: Attention as Info, Failed as Error. A user who silenced a severity has silenced these toasts
  too. The marks are unaffected. *Superseded by FR-111 (round 4), except the severity's colour and icon.*
- **FR-038**: Marks restored when throng reopens (FR-066) MUST NOT raise notifications.
- **FR-038a**: A mark raised by Command finished for one of a terminal's startup commands (FR-065a)
  MUST NOT raise an in-app toast or a Windows notification. It is shown on the panel and its holders,
  and counted by the taskbar badge (FR-039), like any other mark. A later signal on the same panel,
  after its startup sequence, notifies as usual. *Its last sentence is superseded by FR-134 (2026-10-24,
  round 12): a later signal notifies only once the startup command's mark has cleared.*
- **FR-134** *(2026-10-24, round 12; supersedes FR-112's last sentence and FR-038a's last sentence)*: While a
  panel is marked, no raise on it MUST raise a toast or a Windows notification, whatever raised the mark — a
  signal, a restore (FR-038), a startup command (FR-038a) or a manual flag (FR-126). The first raise after the
  mark has cleared announces as FR-112 says.
- **FR-039**: While any panel is marked, throng's taskbar button MUST carry an overlay badge showing the
  number of marked panels, across every project. Counts above 9 show as "9+". The badge MUST use the
  Failed style while any marked panel is Failed, and the Attention style otherwise. It MUST update as
  marks are raised and cleared, and disappear when nothing is marked. It MUST NOT flash the taskbar
  button. It is shown whether or not throng is focused, and is unaffected by delivery (FR-030) and the
  OS notification switch (FR-032). A switch turns it off. Default: on. Marks restored at reopen
  (FR-066) are counted. Its accessible description states the count and the kind. Every sub-workspace
  window that has its own taskbar button shows the same count.

#### D. Terminal signals (the terminal producer)

- **FR-060**: throng MUST recognise the seven terminal signals in the Terminal signals table, with the
  trigger, kind, accuracy and default stated there.
- **FR-060a** *(2026-10-18)*: The Notification signal MUST NOT be raised by an OSC 9 sequence that
  carries a ConEmu-style numeric subcommand (`9;<n>;…`). Those are not notifications. `9;9` is the
  working directory that throng's own shell integration emits at every prompt (025 follow-up), `9;4` is
  progress, which Progress ended handles, and the rest are ignored. Without this, every prompt in a shell
  with integration on would raise a mark.
- **FR-061**: Each signal MUST have its own on/off setting. Its description MUST state whether it is
  exact or heuristic and, for Command finished, the staleness window of 025 FR-019d. Output went quiet
  MUST take its interval from a setting: default 10 seconds, range 10–600 seconds in steps of 10
  *(range raised from 2 s in planning, research R10: the preferences slider rules need an even step,
  and under ten seconds "quiet" is a pause between lines)*.
- **FR-062**: While throng is running, every running terminal MUST be in 025's shared command
  observation, whether or not its project is loaded. This **supersedes 025 FR-019f for a terminal whose
  project is unloaded while a window is open**. FR-019f suspended tracking because nothing needed the
  value until the terminal ended; Command finished now needs it. 025 FR-019a already guarantees that one
  more terminal costs nothing extra. FR-019f still applies when no window is open. The value 025's
  command memory captures for such a terminal is now current rather than frozen, which narrows 025
  FR-019h's accepted limitation and widens nothing.
- **FR-063**: A master switch MUST turn terminal attention off. Switching it off MUST withdraw every mark
  the terminal producer raised (FR-008), and MUST raise no new ones.
- **FR-064**: Process exited MUST NOT be raised for an end the user caused: closing the panel or its tab,
  destroying or deleting the project, Unload with End Terminals, or terminating all terminals at app
  close.
- **FR-065**: Command finished MUST be raised when the observed foreground command changes from a command
  to nothing. A change from one command to another MUST NOT raise it.
- **FR-065a**: A command throng ran as one of the terminal's startup commands (025) MUST be treated like
  any other command. Its finish raises Command finished if the panel is unattended at that moment
  (FR-004), and nothing otherwise.
- **FR-066**: Signals carried in a terminal's output, and process exits, that occur while no window is
  open MUST be remembered for terminals that keep running, and raised when a window opens.
- **FR-067**: Recognising a signal MUST NOT alter what the terminal displays, MUST NOT delay terminal
  output or input (Principle XII), and MUST NOT play a sound.
- **FR-067a** *(2026-10-18)*: Every signal MUST be recognised for a running terminal whether or not any
  window is currently displaying it or receiving its output: a background tab, an unloaded project, or
  (for the signals FR-066 names) no window at all. Recognition MUST NOT depend on a panel being rendered.
  [#481](https://github.com/Bidthedog/throng/issues/481) stops streaming output to panels nobody is
  looking at, so this requirement holds after it lands, not only before.
- **FR-068**: A notification's message MUST be reduced to one line, bounded in length and free of
  control characters before it is shown or stored. An empty or invalid message leaves the reason as
  "notification".
- **FR-069**: This feature MUST NOT identify Claude Code or any other program. A program gets the
  user's attention by ringing the bell or sending a notification.

#### E. Navigation

- **FR-080**: There MUST be a command, Go to Next Marked Panel. It switches to the project and tab of the
  next marked panel and focuses it. Order: project-list order, then tab order, then panel order, starting
  after the current position and wrapping round.
- **FR-080a**: Go to Next Marked Panel and a notification's link (FR-034) MUST reach a marked panel whose
  project is in a minimised category, including one whose row the category hides. The category stays
  minimised. The project becomes active, so its row shows under the collapsed header (046 FR-052). 046
  FR-012's rule that the cycle commands skip such projects is unchanged and does not apply here: those
  commands step through projects, and this one goes to where the user is needed.
- **FR-081**: The command MUST have a key binding, listed in the Key Bindings editor and documented. The
  default is chosen in planning and collides with no existing binding.
- **FR-082**: The command MUST appear in the application menu, disabled while nothing is marked.
  *Superseded by FR-106 (Session 2026-10-19, round 3): not in the cog menu; in a marked project's
  context menu.*

#### F. Configuration and persistence

- **FR-090**: Every setting in this feature MUST be stored and edited like every other setting
  (Principle X). Each has a shipped default, appears in the Preferences editor with a description, and
  is documented with the rest of the preferences.
- **FR-091**: Marks MUST survive switching projects, unloading a project with Keep Terminals Running, and
  reopening throng while terminals keep running (FR-066). A mark MUST NOT outlive its panel.

### Key Entities

- **Attention mark**: one per panel at most. Its kind (Attention or Failed), its reason (a label and a
  detail), which producer raised it, and when. It belongs to the panel and moves with it.
- **Producer**: something that raises and withdraws marks on panels. This feature has one: the terminal
  signals. *(2026-10-24, round 12)* And a second: the user's manual Flag (FR-125), on every panel type.
- **Holder state**: derived, never stored. Each tab chip, tab-strip overflow control, project row and
  minimised category header is marked when anything beneath it is, with the strongest kind beneath it.
- **Attention notification**: at most one in-app toast and one Windows notification per marked panel,
  linked to the panel and dismissed with the mark.
- **Settings**: the clear delay, each kind's delivery, the OS notification switch and the taskbar badge
  switch (mechanism-wide);
  terminal attention on/off, one switch per terminal signal, and the went-quiet interval (terminal
  producer).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user can tell which of their open projects needs them from the project list alone,
  without switching project, for every exact signal that is enabled.
- **SC-002**: A mark, and its notification, appear within 1 second of a bell, notification, progress end
  or process exit. They appear within 1 second plus one command-observation interval of a command
  finishing.
- **SC-003**: With default settings, an hour of ordinary interactive use of a shell the user is focused
  on raises zero marks.
- **SC-004**: A program ringing the bell 1,000 times a second for 10 seconds produces the same terminal
  output timing, within measurement noise, as it does with terminal attention switched off. It raises one
  mark and one notification.
- **SC-005**: Every terminal signal can be switched off individually, and all at once, from Preferences.
  With all switched off, no terminal signal marks anything.
- **SC-006**: From a notification, the user reaches the marked panel in one click. From a state with
  marks in two projects, they reach each marked panel with one key press each.

## Assumptions

- The Claude Code use case needs no Claude-specific work. Claude Code can be set to ring the bell or send
  a terminal notification when it waits for input, through its own notification channel setting and
  hooks. throng's documentation points to how, rather than copying Claude Code's.
- Defaults: every exact signal on, both heuristics off, terminal attention on, delivery Both for both
  kinds, OS notifications on, taskbar badge on, clear delay 1000 ms. Because the focused panel never marks itself, the bell
  is safe to leave on: completion bells only ring while the user is typing in that panel.
- New notice types, or a new presentation of the existing types, may be needed for the attention toasts.
  Their persistence and timeout follow 030's per-severity settings, as FR-037 maps them.
- No sound is played for any signal.
- Only the terminal producer ships in this feature. Editor and search-result producers are future work
  for their own issues. *(2026-10-24, round 12)* The user's manual Flag (FR-125) ships too; it is not a
  per-panel-type producer.
- Windows 11 is the v1.0.0 platform, so "OS notification" means a Windows notification. Behind the OS
  abstraction (Principle II), another platform supplies its own.
- *(2026-10-18)* Sequencing: [#481](https://github.com/Bidthedog/throng/issues/481) (per-panel output
  subscription) changes how background terminal output reaches the UI, and is still open. FR-067a is
  written to hold whether it lands before or after this feature. PR #506 (the project list's rows) has
  merged.

