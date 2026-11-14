# Feature Specification: Vault links, a notifications panel and agent session restore

**Feature Branch**: `feature/S068-vault-links-notifications-agent-restore`

**Created**: 2026-11-12

**Status**: Draft

**Input**: Maintainer direction, 2026-11-12: one specification covering #616, #615, #618 and #189, all in v1.0.0. Extended 2026-11-12 with #623 (anonymised diagnostic log), raised during clarification.

## Background

Three gaps remain in v1.0.0, each in a surface the user works in all day. A Markdown preview of an Obsidian vault loses its root-relative links and its embedded images. Notifications appear as toasts that cover the work and stack over each other. And a terminal panel that was running Claude Code comes back after a restart in a new conversation, not the one the user left.

| Story | Issue | Delivers |
|---|---|---|
| US1 | #616 | Wikilinks written from the vault root resolve, and their hover reads as a path |
| US2 | #615 | `![[image.png]]` draws the image in a Markdown preview |
| US3 | #618 | Toasts leave after a few seconds unless hovered, and a Notifications panel below the File Explorer keeps the notices set to persist |
| US4 | #618 | The Notifications and Sub-workspaces panels minimise to their headers |
| US5 | #189 | A terminal panel that was running Claude Code resumes that same session |
| — | #623 | Every diagnostic log line is anonymised; the project list shows each project's internal ID (FR-034a to FR-034f) |

### Requirements this feature changes

| Requirement | Change | Why |
|---|---|---|
| 047 FR-052, FR-052a | **Superseded in part by FR-001.** A target with no leading `/` still tries the document's folder first; when nothing matches there, it tries the project root. FR-052's ban on a project-wide *name* search stands: both tries are path resolution. | Obsidian writes vault-root paths without a leading `/` (#616). |
| 047 FR-051, 045 FR-169a | **Unchanged; now met for wikilinks (FR-004, FR-005).** The hover and status bar show the readable target, not the internal address. | #616 found the hover showed `throng-wiki:` with `%2F`. |
| 047 FR-056 | **Narrowed by FR-010.** An embed of an image renders as an image. Every other embed except a Mermaid file still renders literally. | #615. |
| 054 FR-049b | **Extended by FR-010 and FR-001.** Images join Mermaid files as the embeds a preview draws, and a Mermaid embed gains the project-root fallback. | #615. |
| 030 FR-001, FR-002, FR-012 | **Superseded in part by FR-021a.** Each severity still has one of three modes, now named **Never display**, **Toast only** and **Toast and keep in panel**. The per-severity timeout is removed; one global **Toast duration** replaces it. | Maintainer, 2026-11-12 (#618 redesign). |
| 030 FR-003 | **Superseded by FR-021 and FR-024.** A persistent notice's toast leaves after the toast duration like every other toast; the notice itself stays, as an entry in the Notifications panel, until the user dismisses it there. | Maintainer, 2026-11-12. |
| 030 FR-004, FR-011 | **Superseded by FR-021.** No severity has its own timeout, so the timeout control and its disabled state go. | Maintainer, 2026-11-12. |
| 030 FR-010 | **Now governs the toast duration (FR-021b).** Same 3000–30000 ms range and the same unrounded typed value. | |
| 030 FR-013, FR-014 | **Superseded by FR-021c and FR-021d.** New defaults, and the upgrade from a configuration written before this feature. | |
| 030 FR-006, FR-007 | **Extended by FR-034a; FR-007 superseded in part.** Every notice is still logged, now anonymised, with the count of pending panel entries at that moment. | Maintainer, 2026-11-12: to aid error reports. |
| 067 FR-037, 058 FR-018, 063 FR-010 | **Unchanged.** Their toasts are sticky (FR-021e) and stay until acted on, as today. | Analyze finding I1. |
| 030 FR-005 | **Unchanged.** A **Never display** notice shows no toast and adds no panel entry; it is still logged. | |
| 030 FR-002 and the notification preference descriptions | **Amended by FR-032.** The descriptions state the toast duration, the hover pause and the panel. | Maintainer, 2026-11-12. |
| 057 FR-031, FR-035, FR-037, FR-120, FR-122 | **Unchanged in substance.** An attention mark's in-app toast is a toast like any other: it leaves after the toast duration (FR-021) and has a close control (FR-022). | #618. |
| 057 FR-036 | **Extended by FR-025.** Clearing a mark also removes its entry from the Notifications panel. | #618. |
| 025 FR-033 to FR-035, FR-037 | **Superseded in part by FR-040 to FR-055, for Claude Code only.** In a panel whose command memory is on, throng may recognise Claude Code, read the session identity Claude Code records, and save a resume command in place of the verbatim one. Every other command, agent or not, is still captured verbatim and treated as ordinary. | #189; 025 removed session resumption to be designed here. |
| 025 FR-036 | **Unchanged.** No "AI Agents" section or agent preference is added (FR-050). | Maintainer, 2026-11-12: resume is the default for Claude Code and is not a choice presented to the user. This drops #189's "AI Agents → Claude" preference. |
| 039's "Remember the last running command" description | **Amended by FR-051.** The description states the Claude Code case. | Maintainer, 2026-11-12. |
| 044 FR-120 | **Extended by FR-057 (Session 2026-11-13).** An image's hover also shows its alt text, above the source. | Maintainer, MT-02. |
| 044 FR-090b | **Unchanged.** A `#heading` lands on the heading even when content above it changes height after the first draw; MT-01 found a defect against it, not a change. | Maintainer, MT-01. |

## Clarifications

### Session 2026-11-12

- Q: Where does a notice raised in a window with no Notifications panel (Preferences, the Resource Monitor, a sub-workspace window) appear? → A: *(Superseded by the redesign and the FR-030 answer below.)* It toasts in its own window; a persistent one is also added to the main window's panel.
- Q: What happens when a notice arrives while the Notifications panel is minimised or the right pane is hidden? → A: Nothing opens by itself. The collapsed panel header is highlighted in the colour of the most severe pending notification and shows a count of pending notifications. (FR-039)
- Q: Does Claude Code session resume need the panel's "Remember the last running command" tick, or does it apply to every panel running Claude Code? → A: Only ticked panels; the tick stays the user's explicit action. In a ticked panel, when Claude Code is running as the terminal ends, whatever `claude` command was last run there (`claude`, `claude agents`, `claude --resume`, any other) is overwritten with the resume command for the session actually running. This is the fixed default, not presented to the user as a choice; the "Remember the last running command" description states the special case. (FR-040, FR-041, FR-050, FR-051)
- Q: Should the Notifications and Sub-workspaces panels' size and minimised state be global or per project? → A: Global for both: one size and one minimised state, the same in every project. (FR-038)
- Maintainer redesign of #618: toasts stay, in every window. Every toast leaves after 3 seconds unless the pointer is over it, and carries an X that closes it at once. The Notifications panel in the right pane keeps only the notices whose severity is set to persist, so the user can work through them at leisure: each entry can be dismissed with an X and copied, and the list scrolls. Closing a toast does not remove the notice's panel entry. The list is oldest first by default and can be switched to newest first, priority then oldest first, or priority then newest first. The notification preference descriptions state the change. (FR-020 to FR-033)
- Q: What does a severity's "Display for N ms" mean now that every toast leaves after 3 seconds? → A: One global Toast duration preference (default 3 s) replaces the four per-severity timeouts, and the modes become Never display, Toast only, and Toast and keep in panel. (FR-021a to FR-021d)
- Q: When a notice set to stay in the panel is raised in Preferences, the Resource Monitor or a sub-workspace window, is it also added to the main window's panel? → A: Yes. It toasts in its own window and is added to the main window's panel, which flashes. (FR-030)
- Q: Do the Notifications panel's entries survive a restart of throng, or does the panel start empty each session? → A: They survive until dismissed. (FR-031 to FR-031c)
- Q: Should the Notifications panel have a "Dismiss all" control as well as each entry's X? → A: Yes, with a confirmation prompt that one Preferences toggle can turn off. Dismissing all entries does not clear any attention mark or flag. (FR-026a to FR-026c)
- Q: Does a toast also stay while keyboard focus is inside it, as it does under the pointer? → A: Yes. It stays while the pointer is over it or focus is inside it, and the full duration restarts once both have left. (FR-021)
- Q: Should the Notifications panel limit how many entries it keeps? → A: Yes. Keep the newest 100 by default, adjustable in Preferences from 20 to 500; the oldest is dropped quietly, with a log line. The first time the limit is reached, a warning that cannot time out suggests changing the notification preferences, links to them, and warns that unattended notifications can affect performance; once dismissed it never shows again. Every notice is logged anonymised, with the count of pending panel entries. (FR-031d to FR-031g, FR-034a)
- Q: What does anonymising a notice's log record remove? → A: Everything about the user's machine — username, home folder, machine name, paths, file and project names, commands — each replaced by a stable token; internal project IDs are kept. The project list's path hover shows the project's internal ID, and a project without one is given a unique one. (FR-034b to FR-034e)
- Q: Does "nothing about the user's machine in the logs" apply to the whole diagnostic log or only to notice records? → A: The whole log, through one shared anonymiser where lines are written, in this feature, tracked by its own Tweak issue, #623. (FR-034f)
- Q: In an Obsidian vault nested inside the project, does a path with no leading `/` fall back to the vault's root or the project's root? → A: The project root only; throng does not look for a vault root. (FR-001)
- Q: When throng overwrites a typed `claude` command with a resume, are the user's other launch flags kept? → A: Yes. Every argument is kept except those that choose a session (`--resume`, `--continue`, `--session-id`, `--fork-session`, `agents`); launch flags such as the model and permission mode belong to the process, not the session, and would otherwise be lost. (FR-041a)
- Q: After a restart, do entries still pending on a minimised panel keep counting as pending? → A: Yes. Pending state is saved with the entry, and the header's count and highlight survive a restart until the panel is restored. (FR-039b)

### Session 2026-11-13

Maintainer manual testing of the built feature (MT-01 to MT-08). MT-03 and MT-08 signed off; MT-01's reflow failure is a defect against 044 FR-090b and changes nothing here.

- Q: Does `![[image.png|200]]` set the image's size? → A: Yes. `|200` sets the width and `|200x100` the width and height, as Obsidian does. This reverses FR-015, which kept size forms out of scope. (FR-056)
- Q: Where does a standard image's alt text show? → A: In the image's hover, with its path. (FR-057)
- Q: Which arrow do the panels' minimise and restore controls use? → A: The side panes' chevron, pointing up and down, centred in its button. (FR-058)
- Q: When does the notification count go away? → A: Only as entries are dismissed. Minimising or restoring a panel, or hiding or showing a pane, never clears it; at zero the badge goes from every place. This reverses the Session 2026-11-12 answer that restoring the panel clears the count and highlight. (FR-059)
- Q: Where does the count badge show? → A: In two places: next to the Notifications title, minimised or not, and below the File Explorer title on the collapsed right pane; vertically centred with the text, with at least one character's gap. (FR-060)
- Q: What does a notification say about where it came from? → A: Every toast and panel entry that relates to a panel names its project, tab and panel; one that concerns the whole app states only what is wrong. (FR-061)
- Q: What are the shipped display modes? → A: Every type defaults to **Toast and keep in panel**. This reverses FR-021c's **Toast only** for attention, info and success. (FR-062)
- Q: What does clicking a notification do? → A: A toast or entry that relates to a panel takes the user to that panel, as an attention toast does. The whole notice is the link apart from its buttons, and the separate go-to-panel control is removed. (FR-063)
- Q: How does the project path hover show the internal ID? → A: The path, then `(id: <id>)` on the next line. (FR-064)
- Q: How does user-visible text name the operating system? → A: As "the OS", never "Windows" (constitution v6.5.0, Principle VI). (FR-065)
- Q: A terminal runs the `claude agents` dashboard and the user opens one of its sessions there; does the panel restore into that session? → A: No. FR-041c stands, confirmed: the panel relaunches `claude agents`. Claude Code 2.1.323 records no link between a dashboard and the session it has open (measured 2026-11-13: the dashboard has no session record and no session child process, its only sockets go to the agents daemon's control socket, and neither `claude agents --json`, the session records nor the job state name an attached client). The background session keeps running and is one step away in the dashboard; `claude attach <id>` typed in the terminal is restored as typed.

- Q: Does a standard Markdown image take a size too? → A: Yes. The maintainer wrote `![embedded image](sample-documents/sample.png|200)`, which today fails to draw; it draws 200 pixels wide. Obsidian's own form for a Markdown image, `![embedded image|200](sample-documents/sample.png)`, does the same *(derived from Obsidian's syntax; not stated by the maintainer)*. (FR-066)

- Q: Does a minimised panel's header restore the panel when clicked? → A: Yes, for the Notifications and Sub-workspaces panels: clicking anywhere on a minimised header restores it, and the whole header shows a hover style. An open panel's header does nothing when clicked, so it never competes with the resize handle; only its button minimises it. The hover style shows only while minimised *(derived: an open header that highlighted would invite a click that does nothing)*. (FR-067)

- Q: What does the collapsed right pane's strip say, now that it also carries the notification count? → A: "File Explorer & Notifications", as the left pane's strip reads "Projects & Sub-workspaces". (FR-068)

- Q: Do the collapsed side-pane strips restore their pane when clicked? → A: Yes. Clicking anywhere on the collapsed left strip (Projects & Sub-workspaces) or right strip (File Explorer & Notifications) shows that pane, with the same hover style as a minimised panel header. (FR-069)
- Q: Which colour does that hover use, and when does it show? → A: throng's own application highlight colour, not the active project's, with text in the colour paired with it so it stays readable. It shows when the pointer enters the header or strip; a panel minimised by its own button, under a pointer that has not moved, does not flash it. (FR-070)

- Q: How does a Notifications panel entry show its type, its project and that it is a link? → A: Its background is an understated, pastel tint of its type's colour (error, warning, attention, information, success), replacing the coloured strip on its left; its border is the colour of the project it relates to, changing to that project's highlight colour while the pointer is over an entry that links to a panel; each type has its own icon at the top left, before the title; and hovering the entry shows its full `Project › Tab › Panel` path in a popover, since a long one is cut off. An entry about no project keeps the theme's ordinary border *(derived)*. These apply to the panel's entries; toasts are unchanged *(derived: the maintainer named "the notifications in the notifications panel")*. (FR-071 to FR-075)

- Q: How wide and how tall is a toast, and where is the rest of its text? → A: A **Toast width** preference under Notifications, 100 to 500 pixels, sets it; it ships at 500, the nearest allowed value to today's 520 *(derived: the maintainer asked for today's width as the default and 500 as the maximum)*, and a toast is still never wider than half the window *(derived from today's rule)*. A toast shows at most three lines of text; hovering one whose text is cut off shows all of it in a popover. Notifications panel entries always show all their text. (FR-076 to FR-079)
- Q: Do notices show when they were raised? → A: Every Notifications panel entry shows the date and time it was raised; toasts show none. (FR-080)

- Q: With today's toast at 520 pixels, which gives — the default or the maximum? → A: The maximum: **Toast width** accepts 100 to 800 pixels and ships at 520, today's width. This reverses the derived default of 500 in the answer above. (FR-081)

- Q: Does a collapsed strip's show control share the strip's hover? → A: Yes. Pointing at the strip or at its show control highlights both as one, and the control's icon takes the same contrasting colour as the highlighted text. (FR-082)
- Q: How is a Notifications panel entry laid out? → A: Line 1: type icon, date and time, repeat count, actions. Then the title when there is one, the place path when there is one, and the message. At rest each of those later lines is one line, cut with an ellipsis when it does not fit, so an entry is at most four lines; line 1 sheds the repeat count first, then the date and time, then the icon, and its actions always stay. Pointing at an entry, or focusing it, expands it in place to its whole text, wrapped, pushing the entries below down; this replaces the place popover in the panel. Moving between entries must not make them jump. This reverses FR-078 and the answer above that entries always show all their text *(the at-rest one-line cut is derived from "up to 4 lines" and "expand all missing data that is truncated")*. Toasts are unchanged. (FR-083 to FR-085)
- Q: When does text end with an ellipsis? → A: Only when it has actually been cut. A whole path or text, wherever it is shown in full, carries none. (FR-086)

- Q: Does an expanded entry stay expanded while its context menu is open? → A: Yes. Opening an entry's context menu keeps it expanded until the menu closes, however the pointer and focus move while the menu is open; it then collapses unless the pointer or focus is back on it. (FR-087)

- Q: Should an entry with nothing cut change when expanded? → A: No. Expanding adds only what was hidden: the line spacing is the same at rest and expanded, so an entry whose text all fits, with no lists (an attention entry, typically), does not move or change height when pointed at. (FR-088)

- Q: Does an entry's border look the same thickness at rest and highlighted? → A: Yes. The border keeps one width in every state, and reads at full strength in both: at rest it is the project's colour itself, and the highlight is that colour shifted toward the text colour, so the change is one of colour, never of apparent weight. This replaces the softened rest border of FR-072, which read as thinner *(derived: a project carries one colour, so its "highlight" is derived from it)*. (FR-089)

- Q: What are the smallest toast width and toast duration a user can set? → A: **Toast width** accepts 300 to 800 pixels, still shipping at 520; **Toast duration** accepts 1000 to 30000 ms, still shipping at 3000. (FR-090, FR-091)

- Q: How does a user choose where a notification type is shown? → A: Each type's row in Preferences › Notifications has three checkboxes, **Toast**, **Panel** and **OS Notify**, in place of the display-mode drop-down. Any combination is allowed, none or all included: **Panel** without **Toast** keeps the notice in the panel without a toast, and none of them shows it nowhere (the log still records it). The shipped defaults are unchanged: **Toast** and **Panel** on for every type, **OS Notify** as before. A saved mode carries over: *Never display* becomes neither, *Toast only* becomes **Toast**, *Toast and keep in panel* becomes **Toast** and **Panel** *(derived)*. For errors and warnings, clearing the last of **Toast** and **Panel** asks first, as *Never display* did (030 FR-008) *(derived)*. The Find in Files replace summary keeps its own drop-down: it governs one notice, not a type *(derived)*. (FR-092)

- Q: What colour is the count badge? → A: throng's highlight colour, with the text colour paired with it, whatever the types of the entries it counts; it no longer takes the colour of the most severe entry. (FR-093)
## User Scenarios & Testing *(mandatory)*

### User Story 1 - Follow a wikilink written from the vault root (Priority: P1)

A user previews an Obsidian note in a subfolder. Its links name other notes by their path from the vault root, without a leading `/`, as Obsidian writes them. Hovering a link shows where it goes; Ctrl+click opens it at the heading.

**Why this priority**: Navigation between notes fails on every such link today, in any vault that writes root-relative paths. It is a defect against 047 FR-051 and 045 FR-169a.

**Independent Test**: Create `folder/sub/Target.md` with a heading and `folder/sub/Note.md` linking `[[folder/sub/Target#Some Heading|Alias]]`; preview the note, hover and follow the link.

**Acceptance Scenarios**:

1. **Given** `folder/sub/Note.md` contains `[[folder/sub/Target#Some Heading|Alias]]` and `folder/sub/Target.md` exists, **When** the user Ctrl+clicks `Alias` in the preview, **Then** `folder/sub/Target.md` opens at `Some Heading`.
2. **Given** the same link, **When** the user hovers it, **Then** the hover and the status bar both read `folder/sub/Target#Some Heading`, with no internal scheme and no percent-escapes.
3. **Given** `folder/sub/Target.md` and `folder/sub/folder/sub/Target.md` both exist, **When** the user follows `[[folder/sub/Target]]` from `folder/sub/Note.md`, **Then** the file next to the note wins: `folder/sub/folder/sub/Target.md` opens.
4. **Given** neither candidate exists, **When** the user follows the link, **Then** the link is drawn as unresolved and the missing-target notice names the path relative to the document's folder, as 047 FR-055 already requires.
5. **Given** the link resolves from the project root, **When** the user copies the link, **Then** the clipboard holds the path that was actually resolved, not the doubled one.

---

### User Story 2 - See embedded images in a Markdown preview (Priority: P1)

A user previews a note that embeds images the Obsidian way, `![[image.png]]` or `![[folder/image.png|Alt text]]`. The images draw in place, exactly as `![Alt text](folder/image.png)` would.

**Why this priority**: A vault written in Obsidian loses every image in throng's preview today.

**Independent Test**: Preview a note with `![[image.png]]`, `![[folder/image.png|Alt text]]` and `![[/folder/image.png]]`; each image draws.

**Acceptance Scenarios**:

1. **Given** `image.png` sits in the note's folder, **When** the preview renders `![[image.png]]`, **Then** the image draws in place.
2. **Given** `![[folder/image.png|Alt text]]`, **When** the preview renders, **Then** the image draws with `Alt text` as its alt text.
3. **Given** `![[/folder/image.png]]`, **When** the preview renders, **Then** the image resolves from the project root.
4. **Given** `![[folder/image.png]]` in a note in a subfolder, and `folder/image.png` exists only at the project root, **When** the preview renders, **Then** the image from the project root draws.
5. **Given** the image is missing, or resolves outside the project, **When** the preview renders, **Then** it behaves exactly as the same `![alt](path)` image does.
6. **Given** `![[note.md]]`, **When** the preview renders, **Then** it stays literal. **Given** `![[flow.mmd]]`, **Then** the diagram still draws.
7. **Given** `[[image.png]]` with no `!`, **When** the preview renders, **Then** it is a link, not an image.
8. **Given** `![[images/diagram.png|200]]`, **When** the preview renders, **Then** the image is 200 pixels wide with its proportions kept. **Given** `![[images/diagram.png|200x100]]`, **Then** it is 200 by 100 pixels. *(FR-056)*
9. **Given** `![Alt text](folder/image.png)`, **When** the user hovers the image, **Then** the hover shows `Alt text` and, below it, `folder/image.png`. *(FR-057)*
10. **Given** `![embedded image](sample-documents/sample.png|200)` or `![embedded image|200](sample-documents/sample.png)`, **When** the preview renders, **Then** the image draws 200 pixels wide, its alt text is `embedded image`, and its hover shows `sample-documents/sample.png` without the size. **Given** `|200x100` in either place, **Then** it is 200 by 100 pixels. *(FR-066)*

---

### User Story 3 - Toasts that get out of the way, and a panel for what persists (Priority: P1)

Toasts stay, but none of them sits over the work for long: every toast leaves after 3 seconds unless the pointer is over it, and its X closes it at once. A notice whose severity is set to persist is also kept as an entry in a Notifications panel in the right pane, below the File Explorer, where the user can work through it later and dismiss it.

**Why this priority**: Toasts cover the editor and terminals today, and a persistent one stays there until dismissed. This is the largest daily-use change in the feature.

**Independent Test**: With the shipped defaults, raise an error and an info notice; both toasts leave after 3 seconds, and only the error is in the panel.

**Acceptance Scenarios**:

1. **Given** any notice is displayed with the toast duration at its default, **When** 3 seconds pass with the pointer away from its toast, **Then** the toast leaves on its own, whatever the severity's display mode.
2. **Given** a toast is showing, **When** the pointer rests on it or keyboard focus moves into it, **Then** it stays; **When** both have left, **Then** it leaves after the toast duration.
3. **Given** a toast, **When** the user clicks its X, **Then** it closes at once.
4. **Given** a toast, **When** the user clicks it, copies it or uses one of its actions, **Then** it behaves as it does today.
   *Superseded in part by scenario 15 (Session 2026-11-13): clicking a toast that relates to a panel now goes to that panel.*
5. **Given** a severity set to **Toast and keep in panel**, **When** a notice of that severity is raised, **Then** it is also added to the Notifications panel, and it stays there after its toast leaves or is closed, until the user dismisses the entry with its X.
6. **Given** a severity set to **Toast only** or **Never display**, **When** a notice of that severity is raised, **Then** no panel entry is added.
7. **Given** more entries than fit the panel, **When** it renders, **Then** it scrolls.
8. **Given** entries of mixed severity raised at different times, **When** the user picks each of the four orders, **Then** the list reorders: oldest first (the default), newest first, priority then oldest first, priority then newest first.
9. **Given** an entry, **When** the user copies it, **Then** the clipboard holds the notice's text, as copying the toast does.
10. **Given** an entry for a condition is in the panel, **When** the same condition is reported again, **Then** no second entry is added, and the existing entry flashes.
11. **Given** an attention mark's notice has a panel entry, **When** the mark is cleared by any route, **Then** the entry leaves the panel.
12. **Given** a configuration from before this feature with error on **Dismiss only** and info on **Display for** 10000 ms, **When** throng starts, **Then** error reads **Toast and keep in panel**, info reads **Toast only**, and no per-severity timeout is shown.
13. **Given** several entries and an attention mark on a panel, **When** the user chooses **Dismiss all** and confirms, **Then** every entry leaves the panel and the mark stays. **Given** the confirmation preference is off, **Then** no prompt appears.
14. **Given** a notice raised by the terminal panel **Build** in tab **Main** of project **Alpha**, **When** its toast shows and its entry is added, **Then** both name **Alpha › Main › Build**. **Given** a notice about the whole app, **Then** it names no project, tab or panel and states only what is wrong. *(FR-061)*
15. **Given** a toast or panel entry for a panel in another project and tab, **When** the user clicks anywhere on it except its buttons, **Then** throng shows that project and tab and focuses the panel. No go-to-panel button is shown. Clicking its X, copy or action buttons does only what that button does. *(FR-063)*
16. **Given** the shipped defaults, **When** an info, success or attention notice is raised, **Then** it toasts and is also kept in the panel. *(FR-062)*
17. **Given** a project in the project list, **When** the user hovers its path, **Then** the hover shows the path and, on the next line, `(id: <id>)`. *(FR-064)*
18. **Given** Preferences, **When** the user reads the notification settings' descriptions, **Then** they refer to "the OS", never to "Windows". *(FR-065)*
19. **Given** an error entry and an information entry in the panel, **When** the user looks at them, **Then** each has a pale background tint of its type's colour and its type's icon before its title, and no coloured strip on its left. *(FR-071, FR-074)*
20. **Given** entries from two projects of different colours, **When** the user looks at them, **Then** each entry's border is its own project's colour; **When** the pointer rests on an entry that links to a panel, **Then** its border turns that project's highlight colour. *(FR-072, FR-073)*
21. **Given** an entry whose `Project › Tab › Panel` path is cut off, **When** the user hovers the entry, **Then** a popover shows the whole path. *(FR-075)*
22. **Given** **Toast width** set to 300 in Preferences › Notifications, **When** a toast shows, **Then** it is 300 pixels wide; the setting accepts 100 to 500 and ships at 500. *(FR-076)*
   *Superseded in part by FR-081 (Session 2026-11-13): the setting accepts 100 to 800 and ships at 520.*
23. **Given** a notice whose text needs more than three lines, **When** its toast shows, **Then** the toast shows three lines and cuts the rest; **When** the user hovers it, **Then** a popover shows the whole text; its panel entry shows the whole text without hovering. *(FR-077 to FR-079)*
24. **Given** entries in the panel, **When** the user looks at them, **Then** each shows the date and time it was raised; no toast shows a date or time. *(FR-080)*
25. **Given** an entry with a title, a place and a long message, **When** the user looks at it at rest, **Then** line 1 shows its icon, date and time, repeat count and actions, and the title, place and message follow on one line each, cut with an ellipsis where they do not fit. **When** the panel is narrowed, **Then** line 1 drops the repeat count, then the date and time, then the icon, and its actions stay. *(FR-083, FR-084)*
26. **Given** a cut-off entry, **When** the user points at it or tabs to it, **Then** it expands in place to its whole text and the entries below move down; **When** the pointer moves from it to the next entry, **Then** the first collapses and the second expands without either flickering or jumping back and forth. No popover shows. *(FR-085)*
27. **Given** a path or text shown whole — in an expanded entry, a toast popover, anywhere — **When** the user reads it, **Then** it carries no trailing ellipsis. *(FR-086)*
28. **Given** an expanded entry, **When** the user right-clicks it and moves the pointer into the context menu, **Then** the entry stays expanded; **When** the menu closes with the pointer elsewhere, **Then** the entry collapses. *(FR-087)*
29. **Given** an entry whose every line fits and that has no lists, **When** the user points at it, **Then** nothing in it moves and its height does not change; **Given** a cut-off entry, **When** it expands, **Then** its lines keep the spacing they had at rest. *(FR-088)*
30. **Given** a link entry of a coloured project, **When** the user points at it, **Then** its border changes colour but not thickness, at rest and highlighted alike. *(FR-089)*
31. **Given** Preferences › Notifications, **When** the user sets **Toast width** and **Toast duration** to their lowest, **Then** they stop at 300 pixels and 1000 ms, and a toast shows at that width for about a second. *(FR-090, FR-091)*
32. **Given** Preferences › Notifications with a fresh configuration, **When** the user looks at a type's row, **Then** it has **Toast**, **Panel** and **OS Notify** checkboxes and no drop-down, with **Toast** and **Panel** ticked. **Given** info set to **Panel** alone, **When** an info notice is raised, **Then** it is added to the panel and no toast shows; **Given** info set to **Toast** alone, **Then** it toasts and is not added; **Given** neither, **Then** it shows nowhere. **Given** errors set to **Panel** alone, **When** the user clears **Panel**, **Then** throng asks before error notices stop showing. *(FR-092)*

---

### User Story 4 - Minimise the Notifications and Sub-workspaces panels (Priority: P2)

The user collapses the Notifications panel to its header inside the right pane, or the Sub-workspaces panel to its header inside the left pane, to give the space above to the File Explorer or the project list. Either panel restores from its header.

**Why this priority**: Without it, the new panel takes space the File Explorer had. The Sub-workspaces panel gets the same control so the two side panes behave alike.

**Independent Test**: Minimise each panel, restart throng, confirm it is still minimised, and restore it.

**Acceptance Scenarios**:

1. **Given** the Notifications panel is open, **When** the user minimises it, **Then** it collapses to its header at the bottom of the right pane and the File Explorer takes the space.
2. **Given** a minimised panel, **When** the user restores it, **Then** it returns at the size it had.
3. **Given** the Sub-workspaces panel, **When** the user minimises and restores it, **Then** it behaves the same way inside the left pane.
4. **Given** either panel is minimised, **When** throng restarts, **Then** it is still minimised.
5. **Given** the Notifications panel is minimised, **When** a notice set to **Toast and keep in panel** arrives, **Then** the panel stays minimised, and its header shows the count of pending notifications, highlighted in the colour of the most severe.
   *Superseded in part by scenario 6 (Session 2026-11-13): the count no longer clears when the panel is restored.*
6. **Given** three entries in the panel, **When** the user minimises and restores the Notifications panel, and hides and shows the right pane, **Then** the count still reads 3. **When** the user dismisses one, **Then** it reads 2. **When** the user dismisses the rest, **Then** the badge goes from every place. *(FR-059)*
7. **Given** entries in the panel, **When** the Notifications panel is open or minimised, **Then** the badge sits next to its title. **When** the right pane is collapsed, **Then** the badge sits below the **File Explorer** title on the rail. In both places it is vertically centred with the title, with at least one character's gap. *(FR-060)*
8. **Given** the Notifications panel is open, **When** the user looks at its minimise control, **Then** it is the side panes' chevron pointing down, centred in its button; minimised, it points up. *(FR-058)*
9. **Given** the Notifications or Sub-workspaces panel is minimised, **When** the user points at its header, **Then** the whole header highlights; **When** they click anywhere on it, **Then** the panel restores. **Given** the panel is open, **When** they click its header or drag the resize handle beside it, **Then** it does not minimise; only its minimise button does. *(FR-067)*
10. **Given** the right pane is collapsed, **When** the user looks at its strip, **Then** it reads **File Explorer & Notifications**, with the count badge below it while entries wait. *(FR-068)*
11. **Given** either side pane is collapsed, **When** the user points at its strip, **Then** the whole strip highlights; **When** they click anywhere on it, **Then** the pane shows again. *(FR-069)*
12. **Given** a project whose colour differs from throng's highlight colour, **When** the user points at a minimised panel header or a collapsed strip, **Then** it highlights in throng's highlight colour and its text stays readable. **Given** the user minimises a panel with its button and leaves the pointer still, **Then** the header does not flash the hover style. *(FR-070)*
13. **Given** an error entry and an info entry in the panel, **When** the user looks at the count badge in any of its places, **Then** it is throng's highlight colour with readable text, the same as with info entries alone. *(FR-093)*

---

### User Story 5 - Come back to the same Claude Code conversation (Priority: P1)

A user has Claude Code running in several terminal panels that have "Remember the last running command" ticked, in several projects, mid-task. The machine reboots, throng updates, or throng crashes. When the user reopens throng, each of those panels starts Claude Code again in the session it was in, without `claude --resume` or `claude agents` by hand. Ticking the box stays the user's explicit choice; what is remembered for Claude Code is the resume of its actual session, whatever form of `claude` was typed.

**Why this priority**: Re-establishing context in every agent panel after every restart is the most expensive recovery the user does today. The maintainer moved #189 into v1.0.0 for it.

**Independent Test**: In two panels with "Remember the last running command" ticked, in the same folder, start `claude` by hand, exchange a message in each, kill throng, reopen it; each panel shows its own conversation.

**Acceptance Scenarios**:

1. **Given** a panel with "Remember the last running command" ticked, where the user typed `claude` and exchanged messages, **When** its terminal ends by any route (the machine restarts, the daemon ends, an update replaces it, the terminal is killed) and the panel starts again, **Then** the panel starts Claude Code in that same session.
2. **Given** two panels running Claude Code in the same folder, **When** throng is reopened, **Then** each panel resumes its own session; neither resumes the other's, and neither conversation is lost.
3. **Given** Claude Code moved into a different folder or git worktree during the session while the terminal's folder did not change, **When** throng is reopened, **Then** the panel still resumes that session.
4. **Given** the user started a new session inside Claude Code, or resumed a different one, **When** throng is reopened, **Then** the panel resumes the session it was in when the terminal ended.
5. **Given** the panel's session can no longer be found, **When** throng is reopened, **Then** the terminal is usable, Claude Code's own message shows as ordinary terminal output, and the panel is neither blank nor stuck.
6. **Given** no session can be identified for a panel running Claude Code, **When** the command is captured, **Then** it is saved as the plain command that was typed, and capture does not fail.
7. **Given** a ticked panel where the user started Claude Code with `claude agents`, `claude --resume <name>` or any other `claude` command, **When** throng is reopened, **Then** the panel resumes the session that was running when the terminal ended, not the command as typed.
   *Superseded in part by FR-041c and scenario 10 (Session 2026-11-13): `claude agents` is kept as typed.*
8. **Given** a panel with "Remember the last running command" not ticked, **When** a panel that was running Claude Code is reopened, **Then** it starts with its own startup command, as today, and no session is resumed.
9. **Given** a ticked panel where the user typed `claude --model opus --permission-mode plan --resume old-name`, **When** the terminal ends and the panel starts again, **Then** Claude Code resumes the running session with `--model opus --permission-mode plan` still applied, and `--resume old-name` is gone.
10. **Given** a ticked panel running `claude agents` in which the user opened one of its sessions, **When** throng is reopened, **Then** the panel runs `claude agents` again, and the session is still listed in the dashboard. *(FR-041c, confirmed 2026-11-13)*

---

### Edge Cases

- A wikilink target exists both next to the note and at the project root: the note's folder wins (FR-001).
- An Obsidian vault nested inside the project (the vault is the project's `docs/` folder): a path with no leading `/` falls back to the **project** root, not the vault's, so a vault-root path that only resolves from the vault folder stays unresolved. Open the vault folder itself as the project for Obsidian's resolution. throng does not look for `.obsidian` (FR-001).
- A wikilink with a leading `/` in a sub-workspace panel with no owning project stays unresolved (047 FR-052b, unchanged), and so does an embed.
- An image embed carries Obsidian's size forms (`|300`, `|300x200`): the text after `|` is the alt text, as for any other embed; size forms are out of scope.
  *Superseded by FR-056 (Session 2026-11-13): `|300` and `|300x200` size the image.*
- An image embed inside inline code or a code block stays literal (047 FR-050's rule for wikilinks).
- A burst of notices (a project with many failed terminals at startup): their toasts leave after the toast duration, and the persistent ones fill the panel, which scrolls; grouped notices still group as 030 FR-037 describes.
- A persistent notice is raised in a window with no Notifications panel — Preferences, the Resource Monitor, a sub-workspace window: FR-030.
- The right pane is hidden by its toggle, or auto-collapsed on a narrow window: a persistent notice arriving then follows FR-039a. (Focus Mode maximises a tab and does not hide the side panes.)
- The user closes a persistent notice's toast with its X: the panel entry stays (FR-022).
- The panel reaches its limit while the user is away: the oldest entries are dropped as new ones arrive, and the FR-031f warning waits on screen.
- The user lowers the limit from 300 to 50 with 120 entries: the oldest 70 are dropped and logged.
- The user dismisses the limit warning, then raises the limit and fills it again: no warning appears.
- The warning severity is set to **Never display** when the limit is reached: the FR-031f warning still shows.
- A notice names a file inside a project: its record carries the project's internal ID and a token for the file, never the path.
- The user hovers a toast or tabs into it, then moves away: the full toast duration starts again.
- After a restart, an entry reports a condition that the restart already fixed (a terminal that failed to start, say): it stays until dismissed, and its now-meaningless actions are not shown (FR-031a).
- An entry's go-to-panel control points at a panel deleted since it was raised: the control is not shown (FR-031a).
  *Superseded in part by FR-063 (Session 2026-11-13): there is no go-to-panel control; an entry whose panel is gone is not a link.*
- throng closed or crashed but the daemon kept the terminal running: the panel reattaches to the live Claude Code process; nothing is resumed because nothing ended.
- A panel ran Claude Code but the user exited it and then ran another command: the panel's last running command is the other command; nothing is resumed.
- Claude Code is not installed when throng reopens: the saved command fails as any missing command does, as terminal output.
- A panel ran a different agent CLI: it is captured verbatim, as 025 FR-033 to FR-037 still require.
- The user typed `claude --resume <name>` or `claude --continue`: the panel resumes the session that was current when the terminal ended, which may differ from the one named at launch.
- Claude Code ran inside a nested shell, `ssh`, WSL or a container: throng cannot see that session's identity, so the plain command is saved (FR-047).

## Requirements *(mandatory)*

### Functional Requirements

#### Vault-root wikilinks (#616)

- **FR-001**: A wikilink or wikilink embed target with no leading `/` MUST first resolve relative to the current document's folder, by 047 FR-052c's matching order. When no candidate exists there, it MUST then resolve from the root of the preview's throng project, by the same matching order. The fallback is the project root only: throng MUST NOT search for an Obsidian vault root (a folder holding `.obsidian`). *(Supersedes 047 FR-052a in part.)*
- **FR-002**: The resolution in FR-001 MUST be one rule, shared by the link's styling as resolved or unresolved, by following it, by copying it, and by its hover and status bar readout. No two of these may choose different candidates.
- **FR-003**: When neither try in FR-001 finds a target, the link MUST be unresolved under 047 FR-055, and the notice MUST name the path relative to the document's folder.
- **FR-004**: A wikilink's hover MUST show its readable target — the path as written, plus `#Heading` when present — in the same form an ordinary link's hover takes under 045 FR-169a. It MUST NOT show an internal scheme or percent-escapes.
- **FR-005**: The status bar readout for a hovered wikilink MUST be the same text as its hover (045 FR-169a(ii)).
- **FR-006**: Copying a wikilink MUST put the resolved target on the clipboard.

#### Image embeds (#615)

- **FR-010**: A Markdown preview MUST draw `![[target]]` and `![[target|Alt text]]` as an image when the target has an image extension that the preview already draws for a standard Markdown image. The text after `|` MUST be the image's alt text; with no `|`, the alt text is the target's file name. *(Narrows 047 FR-056; extends 054 FR-049b.)*
- **FR-011**: An image embed's target MUST resolve by FR-001's rule, and by 047 FR-052b's rule with a leading `/`.
- **FR-012**: Once resolved, an image embed MUST be drawn exactly as `![alt](resolved path)` is: the same confinement to the project by real path (Principle I), the same sanitisation (044 FR-081), and the same handling of a missing, outside, refused or too-large image.
- **FR-013**: A Mermaid embed (054 FR-049b) MUST also gain FR-001's project-root fallback.
- **FR-014**: Every other embed — a note, a PDF, any other file type — MUST still render literally. `[[image.png]]` with no `!` MUST stay a link.
- **FR-015**: Obsidian's image size forms are out of scope: `![[image.png|300]]` draws the image with `300` as its alt text.
  *Superseded by FR-056 (Session 2026-11-13): the size forms now size the image.*
- **FR-056**: An image embed MUST honour Obsidian's size forms. A last `|` segment of the form `W` MUST draw the image `W` CSS pixels wide with its proportions kept; `WxH` MUST draw it `W` wide and `H` high. With a size, the alt text is the segment before it when there is one (`![[image.png|Alt text|200]]`), else the file name (FR-010). A last segment of any other form stays the alt text. *(Supersedes FR-015. The `|Alt text|W` form is derived from Obsidian's syntax, not stated by the maintainer.)*
- **FR-057**: An image's hover in a preview MUST show its alt text, when it has any, followed on the next line by its source as written (044 FR-120). An image embed whose alt text is only its file name (FR-010) MUST show the source alone. *(Extends 044 FR-120. The line order and the file-name rule are derived.)*
- **FR-066**: A standard Markdown image MUST honour the same size forms as an image embed (FR-056): a last `|W` or `|WxH` segment of its destination (`![alt](path.png|200)`) or of its alt text (`![alt|200](path.png)`) sizes the image and is removed from the path or the alt text before either is used. A destination whose last segment is not a size form is used as written. The size applies whatever the image's source (a project file or an allowed remote image), and never reaches any element other than the image. *(The alt-text form is derived from Obsidian's syntax; the destination form is the maintainer's.)*

#### Toasts and the Notifications panel (#618; logging #623)

- **FR-020**: Every displayed notice MUST still appear as a toast, in every window that shows toasts today. Toasts keep their current behaviour except as FR-021 and FR-022 change it: clicking a toast, copy, flash, action buttons, grouping and de-duplication are unchanged.
  *Superseded in part by FR-063 (Session 2026-11-13): clicking a toast that relates to a panel goes to that panel.*
- **FR-021**: Every toast MUST leave on its own once the **Toast duration** has elapsed after it appears, whatever its severity's display mode. While the pointer is over a toast, or keyboard focus is inside it, it MUST NOT leave; once both have left, the full duration MUST start again. *(Supersedes 030 FR-003 and FR-004 as toast behaviour.)*
  - **FR-021a**: Each severity's display mode MUST be one of **Never display**, **Toast only** or **Toast and keep in panel**, shown by those names. The per-severity timeout setting MUST be removed.
    *Superseded by FR-092 (Session 2026-11-13): three checkboxes, **Toast**, **Panel** and **OS Notify**, replace the display mode.*
  - **FR-021b**: Preferences MUST hold one global **Toast duration**, in the Notifications category, default 3000 ms, within 030 FR-010's range and rules.
    *Superseded in part by FR-091 (Session 2026-11-13): the toast duration accepts 1000 to 30000 ms.*
  - **FR-021c**: The shipped defaults MUST be: error and warning **Toast and keep in panel**; info, success and attention marks (057's fifth notification type) **Toast only**; toast duration 3000 ms. Attention marks follow the same three modes; FR-025 applies when the user sets attention to **Toast and keep in panel**.
    *Superseded in part by FR-062 (Session 2026-11-13): attention, info and success now default to **Toast and keep in panel**.*
  - **FR-021e** *(derived, autopilot 2026-11-12 — analyze finding I1; for the maintainer to confirm)*: Four toasts are **sticky** and never leave on their own, because each carries the only control for something live: the paste-progress card (its Cancel, 067 FR-037), the different-copy notice (058 FR-018), the installed-version notice (063 FR-010) and FR-031f's limit warning. Every other toast follows FR-021. A sticky toast still has its close control where it has one today.
  - **FR-021d**: A configuration written before this feature MUST load without error: **Dismiss only** becomes **Toast and keep in panel**, **Display for** becomes **Toast only**, **Never display** is unchanged, and the old per-severity timeouts are dropped without a notice. Upgrading MUST be idempotent: loading the upgraded configuration again changes nothing.
- **FR-022**: Every toast MUST carry a close (X) control that removes it at once. Closing a toast MUST NOT remove the notice's entry from the Notifications panel.
- **FR-023**: The main window's right pane MUST hold a **Notifications panel** below the File Explorer.
- **FR-024**: A notice whose severity is set to **Toast and keep in panel** MUST be added to the Notifications panel as an entry when it is raised, and MUST stay there until the user dismisses the entry. A notice of any other display mode MUST NOT be added.
  *Amended by FR-092 (Session 2026-11-13): a notice whose type has **Panel** ticked is added, with or without a toast.*
- **FR-025**: A notice whose toast is dismissed today by its condition clearing — an attention mark cleared by any route (057 FR-036) — MUST also leave the panel.
- **FR-026**: Each entry MUST carry a dismiss (X) control and a copy control, and the action buttons and go-to-panel control its notice carries. Copying an entry MUST put the same text on the clipboard as copying its toast.
  *Superseded in part by FR-063 (Session 2026-11-13): the go-to-panel control is removed; the entry itself goes to the panel.*
  - **FR-026a**: The panel MUST offer **Dismiss all**, on its header and in its menu, which removes every entry. While **Confirm before dismissing all notifications** is on, it MUST first ask the user to confirm; while it is off, it MUST dismiss at once.
  - **FR-026b**: Dismissing an entry, one at a time or all at once, MUST NOT clear any attention mark or flag (057). A mark clears only by its own routes; FR-025 is one-way.
  - **FR-026c**: Preferences MUST hold one toggle, **Confirm before dismissing all notifications**, in the Notifications category, on by default. It governs only FR-026a's confirmation.
- **FR-027**: When entries exceed the panel's height, the panel MUST scroll.
- **FR-028**: The panel MUST offer four orders: **Oldest first** (the default), **Newest first**, **Priority, oldest first** and **Priority, newest first**. Priority is severity: error, then warning, then attention, then info, then success. The order MUST be chosen from the panel's header and from its menu, and MUST persist, the same in every project.
- **FR-029**: A notice reporting a condition that already has an entry MUST NOT add a second entry; the existing entry MUST flash (*One condition, one notice*). A notice that grows (030 FR-037) MUST update its entry in place.
- **FR-030**: A notice set to **Toast and keep in panel** that is raised in a window with no Notifications panel — Preferences, the Resource Monitor, a sub-workspace window — MUST toast in its own window and MUST also be added to the main window's Notifications panel, whose new entry flashes. When the panel is minimised or the right pane hidden, FR-039 applies instead of the flash.
  *Amended by FR-092 (Session 2026-11-13): "set to Toast and keep in panel" reads "whose type has **Panel** ticked"; it toasts in its own window only when **Toast** is ticked too.*
- **FR-031**: Panel entries MUST survive a restart of throng, an update and a crash, and stay until the user dismisses them. They are global, not per project.
  - **FR-031a**: A restored entry MUST keep its severity, subject, message and the time it was raised, and MUST still offer dismiss and copy. An action or go-to-panel control whose target no longer exists after the restart MUST NOT be shown.
  - **FR-031b**: A condition reported again after a restart, for which a restored entry exists, MUST flash that entry and MUST NOT add a second one (FR-029).
  - **FR-031c**: A failure to save or restore entries MUST be written to the diagnostic log (Principle XIII) and MUST NOT stop throng starting or leave the panel unusable; the panel then starts empty.
  - **FR-031d**: Preferences MUST hold a **Notifications panel limit**: the most entries the panel keeps, default 100, accepted range 20 to 500.
  - **FR-031e**: When a new entry would take the panel past its limit, the oldest entry by the time it was raised MUST be dropped without a notice, and the drop MUST be written to the diagnostic log. Lowering the limit below the current count MUST drop the oldest entries the same way.
  - **FR-031f**: The first time the panel reaches its limit, throng MUST raise a **warning** suggesting the user change their notification preferences, with a link that opens Preferences at the Notifications section, and saying that leaving notifications unattended can affect throng's performance. The warning MUST be a toast that does not leave on its own, whatever the toast duration and whatever the warning severity's display mode, including **Never display**. It MUST stay until the user dismisses it or follows its link. It is not added to the Notifications panel.
  - **FR-031g**: Once the user dismisses the FR-031f warning with its X, it MUST never be shown again, across restarts. Following its link MUST close it without that effect: it may show again the next time the limit is reached.
- **FR-032**: The descriptions in Preferences MUST state the new behaviour: each severity's mode description says that every toast leaves after the toast duration unless the pointer is over it or keyboard focus is inside it, and that **Toast and keep in panel** also keeps the notice in the Notifications panel until it is dismissed there; the toast duration's description says it applies to every toast and pauses while the pointer is over one or keyboard focus is inside it; the panel limit's description says that the oldest entries are dropped past it and that one warning is shown the first time it is reached.
- **FR-033**: An empty Notifications panel MUST say that there are no notifications, not show a blank area. Every action on the panel and its entries MUST have a menu item, every control MUST be a themeable icon control (constitution, Development Workflow), and every entry MUST be reachable and operable from the keyboard.
- **FR-034a**: Every notice MUST still be written to the diagnostic log (030 FR-006, FR-006a, FR-006b), and each record MUST be anonymised and MUST carry the count of pending entries in the Notifications panel at that moment. *(Supersedes 030 FR-007's "the notice's message and its subject" where anonymising removes them.)*
  - **FR-034b**: An anonymised record MUST expose nothing about the user's machine: no username, home folder, machine name, path, file or folder name, project name or command text. Each such value MUST be replaced by a stable token — the same value always gets the same token within one log file — so repeats stay visible. Severity, the kind of notice, its group key, internal identifiers and counts MUST be kept.
  - **FR-034c**: A project MUST be named in a record by its internal project ID, never by its name or folder.
  - **FR-034d**: Hovering a project's path in the project list MUST show the path and, on a second line, the project's internal ID, so a user can match a log record to a project.
    *Superseded in part by FR-064 (Session 2026-11-13): the format of the ID line.*
  - **FR-034e**: A project with no internal ID MUST be given a new unique one when it is loaded, saved so it never changes afterwards.
  - **FR-034f**: FR-034b's rule MUST apply to every line written to the diagnostic log, from every process and package, not only to notice records. It MUST be applied by one shared anonymiser where lines are written, so no caller can bypass it, and a line that cannot be anonymised MUST be written with the offending value replaced, never raw.
- **FR-034**: Inline notices that already live on their owning surface — a panel's failure banner, the Find in Files bar, the preferences JSON notices — MUST stay where they are.

- **FR-061**: Every toast and every Notifications panel entry whose notice relates to a panel MUST name the project, tab and panel it relates to, by the names the UI shows for them, as `Project › Tab › Panel`. A notice that relates to a project but to no single panel MUST name the project. A notice about the whole app MUST name none of them and state only what is wrong. Copying the notice MUST include the same names. The diagnostic log record stays anonymised (FR-034b). *(The `›` separator is derived from the breadcrumb form the docs use; not stated by the maintainer.)*
- **FR-062**: The shipped display mode of every notification type — error, warning, attention, info and success — MUST be **Toast and keep in panel**. The toast duration stays 3000 ms. A configuration that already holds a mode for a type keeps it, and FR-021d's upgrade is unchanged. *(Supersedes FR-021c's **Toast only** for attention, info and success.)*
- **FR-063**: Clicking a toast, or a Notifications panel entry, whose notice relates to a panel MUST take the user to that panel — its project and tab shown, and the panel focused — as clicking an attention toast does (057). The whole toast or entry MUST be the target except its own buttons (close, copy, dismiss and its actions), which keep their own behaviour. Pressing Enter on a focused toast or entry MUST do the same. No separate go-to-panel control MUST be shown. A notice that relates to no panel, or whose panel no longer exists (FR-031a), MUST NOT act as a link. *(Supersedes FR-020's unchanged click for these notices, and FR-026's go-to-panel control.)*
- **FR-064**: Hovering a project's path in the project list MUST show the path, then on the next line the project's internal ID as `(id: <id>)`. *(Supersedes FR-034d's format.)*
- **FR-065**: User-visible text MUST name the operating system as "the OS", never "Windows" (constitution v6.5.0, Principle VI). In this feature's reach that is: the per-type OS notification descriptions and the switch that allows OS notifications, in Preferences; the notice shown when a drop is blocked while throng runs as administrator; the reasons shown when the OS's Properties dialog cannot open and when a copy that was not installed registers no file manager; and the console host's description in the Resource Monitor. Product and format names that contain the word stay as they are.
- **FR-071**: A Notifications panel entry's background MUST be a pastel, understated tint of its type's colour — error, warning, attention, information, success — from theme tokens, readable with the entry's text in every shipped theme. It replaces the entry's coloured type strip. *(Toasts are unchanged — derived.)*
- **FR-072**: A Notifications panel entry's border MUST be the colour of the project it relates to (FR-061's origin). An entry about no project MUST keep the theme's ordinary entry border. *(The no-project case is derived.)*
  *Superseded in part by FR-089 (Session 2026-11-13): the rest border is the project colour at full strength.*
- **FR-073**: While the pointer is over a Notifications panel entry that links to a panel (FR-063), its border MUST change to that project's highlight colour; an entry that is not a link MUST NOT change. Keyboard focus on a link entry MUST show the same border.
  *Superseded in part by FR-089 (Session 2026-11-13): the highlight is the project colour mixed toward the text colour, at the same width.*
- **FR-074**: Each notification type MUST have its own themeable icon, drawn at the top left of a Notifications panel entry, before its title.
  *Superseded in part by FR-083 (Session 2026-11-13): the icon leads line 1, before the date and time.*
- **FR-075**: Hovering a Notifications panel entry that names a place (FR-061) MUST show the full `Project › Tab › Panel` path in a popover, so a path cut off in the entry can be read whole.
  *Superseded by FR-085 (Session 2026-11-13): in the panel, the entry expands in place instead.*
- **FR-076**: Preferences MUST hold a **Toast width**, in the Notifications category, in pixels: default 500, accepted range 100 to 500, governed by the same rules as the other numeric preferences (030 FR-010). Every toast MUST be that wide, and never wider than half the window. *(The default of 500 is derived: today's toast is 520 pixels, above the maximum the maintainer set.)*
  *Superseded in part by FR-081 (Session 2026-11-13): the range is 100 to 800 and the default 520.*
- **FR-081**: **Toast width** MUST accept 100 to 800 pixels and ship at 520. Everything else in FR-076 stands. *(Supersedes FR-076's range and default.)*
  *Superseded in part by FR-090 (Session 2026-11-13): the minimum is 300 pixels.*
- **FR-083**: A Notifications panel entry MUST be laid out as: line 1 — its type icon (FR-074), the date and time (FR-080), its repeat count, and its actions (dismiss, copy, and any action buttons); then its title when it has one, its place path (FR-061) when it has one, and its message, in that order. *(Supersedes FR-074's "before its title" placement of the icon.)*
- **FR-084**: At rest, each line after line 1 MUST show one line, cut with an ellipsis when it does not fit, so an entry is at most four lines tall. When line 1 lacks room it MUST shed, in order, the repeat count, then the date and time, then the icon; its actions MUST always show. *(Supersedes FR-078.)*
- **FR-085**: Pointing at a Notifications panel entry, or focusing it, MUST expand it in place to its whole text, wrapped, pushing the entries below it down; it collapses when the pointer and focus have left. This replaces FR-075's popover in the panel. An entry expanded or collapsed by the layout moving under a still pointer MUST NOT count as pointed at, so moving between entries never makes them oscillate. *(Supersedes FR-075 and FR-078.)*
  *Amended by FR-087 (an open context menu holds the entry expanded) and FR-088 (expanding never changes the spacing).*
- **FR-086**: Text MUST end with an ellipsis only where it has been cut to fit. A path or text shown whole — an expanded entry, a toast's popover, a tooltip — MUST NOT carry one.
- **FR-087**: A Notifications panel entry whose context menu is open MUST stay expanded (FR-085) until that menu closes, whatever the pointer and focus do meanwhile. Once it closes, the entry follows FR-085 again. *(Amends FR-085's collapse on pointer and focus leaving.)*
- **FR-088**: Expanding a Notifications panel entry (FR-085) MUST NOT change the spacing between its lines, or the height of line 1 while line 1's parts all fit on one row: an entry with nothing cut and no lists MUST look the same expanded as at rest.
- **FR-089**: A Notifications panel entry's border MUST have the same width at rest, highlighted (FR-073), expanded and focused. At rest it MUST be the project's colour at full strength; the highlight MUST be that colour mixed toward the theme's text colour, so both read at the same weight. *(Supersedes FR-072's softened rest border and FR-073's "project colour at full strength" highlight.)*
- **FR-090**: **Toast width** MUST accept 300 to 800 pixels and ship at 520. Everything else in FR-076 and FR-081 stands. *(Supersedes FR-081's minimum of 100.)*
- **FR-091**: **Toast duration** MUST accept 1000 to 30000 ms and ship at 3000. Everything else in FR-021b stands. *(Supersedes FR-021b's lower bound, which 030 FR-010 set at 3000 ms; 030 FR-010 still governs the Find in Files summary's own settings.)*
- **FR-092**: Each notification type's row in Preferences › Notifications MUST offer three independent checkboxes, **Toast**, **Panel** and **OS Notify**, and no display-mode drop-down. **Toast** MUST show the notice as a toast (FR-021); **Panel** MUST add it to the Notifications panel (FR-024); **OS Notify** keeps 057 FR-110's meaning. Any combination MUST be allowed, none and all included; with **Toast** and **Panel** both clear the notice MUST show nowhere in throng and MUST still be logged. The shipped defaults MUST be **Toast** and **Panel** on for every type and **OS Notify** as FR-062 and 057 left it. A saved display mode MUST load without error: **Never display** becomes neither, **Toast only** becomes **Toast**, **Toast and keep in panel** becomes **Toast** and **Panel**, and FR-021d's older modes map through those; the upgrade MUST be idempotent. For error and warning, clearing whichever of **Toast** and **Panel** is the last one ticked MUST first ask the user to confirm, as 030 FR-008 requires. The Find in Files replace summary's own display mode (043 FR-082) is unchanged. *(Supersedes FR-021a, and FR-062's and FR-021c's defaults as modes. The mapping, the confirmation and the Find in Files exception are derived.)*
- **FR-077**: A toast MUST show at most three lines of text — heading, place and message together — and cut the rest with an ellipsis. Its controls stay visible.
- **FR-078**: A Notifications panel entry MUST show all of its text, however long.
  *Superseded by FR-084 and FR-085 (Session 2026-11-13): at rest an entry is at most four lines; pointing or focus expands it.*
- **FR-079**: Hovering a toast whose text is cut off (FR-077) MUST show its whole text in a popover. A toast whose text fits MUST NOT show one. The hover holds the toast as FR-021 says.
- **FR-080**: Every Notifications panel entry MUST show the date and time it was first raised, in the user's locale. Toasts MUST NOT show a date or time.

#### Minimise and restore (#618)

- **FR-035**: The Notifications panel MUST minimise to its header inside the right pane, and restore from it. Minimised, the File Explorer MUST take the freed space.
- **FR-036**: The Sub-workspaces panel MUST minimise to its header inside the left pane, and restore from it, in the same way.
- **FR-037**: A restored panel MUST return to the size it had before it was minimised.
- **FR-038**: Each panel's size and minimised state MUST persist and survive a restart. Both are global: the same in every project, unlike side-pane visibility (067 FR-056).
  - **FR-038a**: The Notifications panel MUST open small by default, comparable in height to the Sub-workspaces panel, and MUST be resizable against the File Explorer.
- **FR-039**: A panel entry added while the Notifications panel is minimised MUST NOT restore the panel. Its collapsed header MUST show the count of pending notifications and MUST be highlighted in the theme colour of the most severe one pending. Restoring the panel MUST clear the highlight and the count.
  *Superseded in part by FR-059 (Session 2026-11-13): restoring the panel no longer clears the count or the highlight.*
  - **FR-039a**: While the right pane is hidden, the control that shows the right pane MUST carry the same count and highlight.
    *Superseded by FR-060 (Session 2026-11-13): the badge shows in two places, and the control that shows the right pane carries none.*
  - **FR-039b**: A pending notification is a panel entry added while the panel was minimised or the right pane hidden, and not yet dismissed. A dismissed or cleared entry MUST leave the count, and the highlight MUST follow the most severe entry still pending. Pending state MUST be saved with the entry (FR-031): the count and highlight survive a restart until the panel is restored.
    *Superseded by FR-059 (Session 2026-11-13): every entry not yet dismissed counts; an entry's pending state is no longer kept.*
  - **FR-058**: The Notifications and Sub-workspaces panels' minimise and restore controls MUST use the chevron icon of the side panes' hide and show controls, pointing down to minimise and up to restore, centred horizontally and vertically in its button. *(The direction is derived: both panels sit at the bottom of their pane.)*
  - **FR-059**: The count MUST be the number of Notifications panel entries not yet dismissed, and the highlight the colour of the most severe of them. Minimising or restoring either panel, and hiding, showing or auto-collapsing either pane, MUST NOT change either. Dismissing an entry, one at a time or all at once, or its condition clearing (FR-025), MUST remove it from the count. While the count is zero the badge MUST NOT show anywhere. *(Supersedes FR-039's last sentence and FR-039b.)*
  - **FR-060**: The count badge MUST show in two places: next to the Notifications panel's title, whether the panel is minimised or not, and below the **File Explorer** title on the right pane's collapsed rail while the right pane is hidden or auto-collapsed. In each place it MUST be vertically centred with the title text and separated from it by at least the width of one character. *(Supersedes FR-039a. Removing the badge from the control that shows the right pane is derived from "two places".)*
  - **FR-067**: Clicking anywhere on a minimised Notifications or Sub-workspaces panel's header MUST restore the panel, and the whole minimised header MUST show a hover style. A click on an open panel's header MUST NOT minimise it; only its minimise control does, so the header never competes with the resize handle. Controls inside the header (sort, Dismiss all, the minimise control) keep their own behaviour. *(The hover style only while minimised is derived.)*
  - **FR-068**: The collapsed right pane's strip MUST read **File Explorer & Notifications**. FR-060's badge sits below that title. *(Amends FR-060's "below the **File Explorer** title".)*
  - **FR-069**: Clicking anywhere on a collapsed side pane's strip — the left pane's and the right pane's — MUST show that pane, as its show control does, and the whole strip MUST show the same hover style as a minimised panel header (FR-067). Controls the strip carries keep their own behaviour.
  - **FR-070**: The hover style of a minimised panel header (FR-067) and of a collapsed strip (FR-069) MUST use throng's application highlight colour, never the active project's colour, with the text and icons drawn in the colour paired with it so they stay readable. It MUST show only when the pointer enters the header or strip: a panel or pane collapsed under a pointer that has not moved since MUST NOT show it until the pointer leaves and returns. *(Amends FR-067's hover style.)*
  - **FR-082**: A collapsed side pane's strip and its show control MUST share one hover: pointing at either highlights both (FR-070's style), and the control's icon MUST take the same contrasting colour as the highlighted text.
  - **FR-093**: The count badge (FR-059, FR-060) MUST be drawn in throng's application highlight colour with the text colour paired with it, whatever the types of the entries it counts, in every place it shows. *(Supersedes FR-039's and FR-059's highlight in the colour of the most severe entry.)*

#### Claude Code session restore (#189)

- **FR-040**: In a terminal panel whose command memory is on (025 FR-015), when Claude Code is running as its terminal ends, the saved startup command MUST resume the Claude Code session that was running, not start a new one. *(Supersedes 025 FR-037 for Claude Code only.)* In a panel whose command memory is off, nothing changes: no command is captured and no session is resumed. A terminal that is still running when throng reopens is reattached as today (Principle III); nothing is restarted or resumed.
- **FR-041**: FR-040 MUST hold whatever `claude` command started the session — `claude`, `claude agents`, `claude --resume <name>`, `claude --continue`, or `claude` with any other arguments. The resume command for the actual session MUST overwrite the command as typed.
  - **FR-041a**: The saved command MUST keep every argument the user typed except those that choose a session — `--resume` and its value, `--continue`, `--session-id` and its value, `--fork-session`, and the `agents` subcommand — and MUST add the argument that resumes the running session. A launch flag such as `--model`, `--permission-mode`, `--dangerously-skip-permissions`, `--effort`, `--add-dir` or `--agent` MUST be carried into the saved command unchanged.
  - **FR-041b** *(derived, autopilot 2026-11-13 — code review; for the maintainer to confirm)*: A positional argument — an initial prompt such as `claude "commit and push"` — MUST NOT be carried into the saved command: it belongs to the first turn, and resuming with it would send it again as a new turn on every restore. Each kept argument MUST be quoted for the shell the panel runs (POSIX shells, PowerShell, Command Prompt), so a flag value with spaces, quotes, `$`, backticks or brackets reaches Claude Code exactly as typed and is never interpreted by the shell. Where a kept argument cannot be quoted safely for that shell (a `"` under PowerShell; `"`, `%`, `^`, `&`, `|`, `<`, `>` or `!` under Command Prompt), the plain command MUST be kept instead (FR-047).
  - **FR-041c** *(derived, autopilot 2026-11-13 — measured on Claude Code 2.1.323; for the maintainer to confirm)*: A terminal running the `claude agents` dashboard MUST be remembered as `claude agents`, not as one session. The dashboard has no session record of its own; it manages any number of background sessions, which run under a separate `claude daemon` process tree, so no single session is the terminal's and resuming one would drop the others. Relaunching `claude agents` restores the dashboard.
    *Confirmed by the maintainer, Session 2026-11-13, with the measurement recorded there.*
- **FR-042**: Each panel MUST resume its own session. Two panels running Claude Code in the same folder MUST NOT resume each other's session, and neither session may be lost.
- **FR-043**: The panel's session identity MUST NOT depend on the terminal's working directory or Claude Code's. A session that moved folders or git worktrees MUST still be found.
- **FR-044**: When the user switches sessions inside Claude Code — a new session, or a different one resumed — the identity saved MUST be the session that was current when the terminal ended.
- **FR-045**: The session identity MUST be captured under the same conditions as the running command (025 FR-019): it MUST survive a killed process, an application crash, a daemon crash and a machine restart, within 025 FR-019d's staleness window.
- **FR-046**: Capturing the session identity MUST NOT block or slow terminal input or output, startup or teardown, and MUST NOT cost more per terminal as terminals are added (025 FR-019a, FR-019b).
- **FR-047**: When no session identity can be determined, the saved command MUST be the verbatim command, as 025 FR-037 states. Capture MUST NOT fail and MUST NOT save a broken command.
- **FR-048**: A saved resume command whose session no longer exists MUST leave a usable terminal. Claude Code's own failure shows as ordinary terminal output; the panel MUST NOT be blank or stuck.
- **FR-049**: throng MAY read the session records Claude Code keeps on the local machine, only to determine the session identity of a Claude Code process running in a throng terminal. It MUST NOT read conversation content, and MUST NOT write to any Claude Code file. *(Supersedes 025 FR-035 for this purpose only.)*
- **FR-050**: Session resume MUST be the fixed behaviour for Claude Code in a panel whose command memory is on. No preference, section or per-panel control MUST be added for it, and no notice or other UI MUST announce it. *(025 FR-036 stands.)*
- **FR-051**: Wherever "Remember the last running command" carries a description — the new-panel form and the terminal defaults in Preferences — the description MUST state that a running Claude Code session is remembered as a resume of that session.
- **FR-052**: Nothing in throng's UI, settings copy or documentation MUST claim that the view inside a session is restored. The session is resumed; what Claude Code shows within it is Claude Code's.
- **FR-053**: Every command other than Claude Code, including other agent CLIs, MUST still be captured verbatim and treated as an ordinary command (025 FR-033, FR-034, FR-037).
- **FR-054**: Session restore MUST work on Windows and Linux alike (Principle II).
- **FR-055**: A failure to determine a session identity MUST leave a trace in the diagnostic log naming the panel (Principle XIII), and MUST NOT raise a notice.

### Key Entities

- **Wikilink target**: the path a wikilink or embed names, its optional heading, and its optional alias. Resolves to at most one file in the project, by FR-001.
- **Notification entry**: one persistent notice kept in the Notifications panel. Carries the notice's severity, subject, message, group key, actions, the time it was raised (the key for the time orders), and whether it is still pending (FR-039b).
  *Amended by FR-059 and FR-061 (Session 2026-11-13): the pending flag is no longer kept; an entry carries what it relates to and the names of its project, tab and panel.*
- **Notification order**: one of the four orders in FR-028; global.
- **Limit warning dismissed**: whether the user has dismissed the FR-031f warning; persists across restarts.
- **Side-panel layout state**: for each of the Notifications and Sub-workspaces panels, its size and whether it is minimised. Global, not per project.
- **Internal project ID**: the unique identifier a project already carries, now shown in the project list's path hover and used to name the project in anonymised log records.
- **Agent session identity**: the identifier of the Claude Code session a terminal panel was in. Captured alongside the panel's running command and saved with it.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Every wikilink in an Obsidian vault that writes paths from the vault root opens its target in one Ctrl+click, measured on a fixture of at least 20 such links across three folder depths.
- **SC-002**: Every hover on a wikilink reads as a path a person can type, with no scheme and no percent-escapes.
- **SC-003**: Every image embed in that fixture whose image exists in the project draws; none renders as literal text.
- **SC-004**: No toast other than the four sticky ones (FR-021e) stays on screen longer than the toast duration unless the pointer is over it or keyboard focus is inside it.
- **SC-005**: Every notice set to **Toast and keep in panel** can be found in the Notifications panel until the user dismisses it, whether or not its toast was seen, and across restarts of throng.
- **SC-005a**: However long throng runs without the panel being looked at, it never holds more entries than its limit, and the limit warning appears at most once per reaching of the limit until dismissed.
- **SC-005b**: A diagnostic log produced by a session that opens projects, runs terminals, moves files and raises notices contains none of the user's username, home folder, machine name, paths, file or project names, or command text.
- **SC-006**: After an unclean exit of throng with Claude Code running in five ticked panels across two projects, including two panels in the same folder and one started with `claude agents`, all five panels resume their own conversation on reopen, with no command typed by hand.
- **SC-007**: Repeating SC-006 with the five panels unticked resumes no session: each panel opens with its own startup command.

## Assumptions

- Claude Code keeps a record of its sessions on the local machine from which a running process's current session can be determined, and accepts a command-line argument that resumes a session by its identifier without creating a new one. Research for the plan confirms both against the installed CLI on Windows and Linux, as #189's research did for `--session-id` and `--resume`.
- The project-root fallback (FR-001) is the resolution #616 and #615 both propose, and the maintainer agreed both issues as written.
- Notifications keep their existing severities, grouping and logging; what changes is how long a toast stays and where a persistent notice is kept.
- The Notifications panel is a fixed part of the right pane, like the Sub-workspaces panel in the left. It is not a dockable panel type, and cannot be moved to another pane.
- The minimise control's icon is a new themeable icon key with defaults in every shipped theme.
- Session restore depends on 025's command memory to capture the running command (the issue's "Blocked by #12"); 025 has shipped.
- The OS notification path (057) is unchanged by this feature.
