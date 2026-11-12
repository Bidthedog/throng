# Feature Specification: Workspace polish and OS integration for v1.0.0

**Feature Branch**: `feature/S067-workspace-and-os-integration`

**Created**: 2026-11-08

**Status**: Draft

**Input**: Maintainer direction, 2026-11-08: one specification covering #606, #609, #534, #607, #578, #516, #521, #545, #500, #485, #330, #93 and #8, all in v1.0.0.

## Background

throng's File Explorer, panels and shutdown stop short of the operating system and of the keyboard and mouse routes users expect. Files cannot cross between throng and the OS file manager, a folder cannot be opened as a project from outside throng, and a stuck shutdown leaves no way out. Around those sit smaller gaps in the same workspace surfaces. This feature closes them together for v1.0.0.

| Story | Issue | Delivers |
|---|---|---|
| US1 | #8 | Cut, copy, paste and drag between throng and the OS file manager |
| US2 | #606 | Open a file in its registered OS program from throng's menus |
| US3 | #607 | Open a folder as a project from the OS file manager or a shell |
| US4 | #521 | A closing overlay with Cancel, progress and a time estimate |
| US5 | #485 | File and folder Properties |
| US6 | #330 | Side-pane expanded state per project |
| US7 | #516 | Typeahead history in the terminal panel form |
| US8 | #534 | Save and Save As icons on editor panels |
| US9 | #609 | A keyboard route to Rename Tab |
| US10 | #93 | Create a sub-workspace directly |
| US11 | #500 | Clickable links in the Markdown front matter table |
| US12 | #545 | Total line count in the editor status bar |
| US13 | #578 | The Linux old-version removal rule, recorded and tested |
| US14 | #606 follow-up | Dismiss the resource popup by clicking it |

### Requirements this feature changes

| Requirement | Change | Why |
|---|---|---|
| 003 FR-008 | **Partly superseded by FR-056.** Pane *visibility* becomes per project when a project is active. Pane *width* stays global, as 003 FR-008 states. A project with no stored state starts expanded (FR-057), so a pane collapsed globally before upgrade reopens once per project. | Projects differ in which pane they need (#330). |
| 040 FR-022a, FR-023 and the *Readout* key entity | **Amended by FR-096 and FR-097**: a total-lines segment joins the form table and the hide order. | #545. |
| 044 FR-085 | **Refined by FR-088.** Scalar values still render as text, with recognised links inside them made real links. Sequence values containing links render per item. | #500. |
| 058 FR-018 | **Extended by FR-024.** A second launch still brings the running throng to the front and starts no second instance, and a launch carrying a path now also opens it. | #607. |
| 063 | **Gains a numbered requirement (FR-101).** 063 FR-009 stands as written. | The rule existed only in research note D2 (#578). |
| 016 FR-015c | **Extended by FR-006** to file lists on the OS clipboard. | An internal cut replaced by another application must not paste (#8). |
| 005 FR-015 | **Extended by FR-037.** The busy overlay stays a blocking overlay, and it gains Cancel and progress. | #521. |
| 062 scope note on #8 | **Overtaken.** Spec 062 left OS file transfer out of its scope; this feature delivers it on both platforms. | Principle II. |
| #8's "Windows and the seam only" | **Overridden by FR-001.** | Constitution Principle II (v6.1.0): a feature needing distinct code per OS ships both implementations in that feature. |
| Constitution Principle IV | **Gains a recorded function-key exception (FR-080)** in the same form as `Ctrl+Shift+Alt+F4` (048 FR-131, v5.8.0). | #609. |
| 040 FR-025, FR-026 | **Reworded by FR-125 and FR-126.** The status strip segments are punctuated. | Hand-test feedback, MT-15. |
| 055 FR-115 | **Amended by FR-127.** A click on the popup closes it. | Hand-test feedback. |
| Explorer click-to-open (FR-026 to FR-028 of 006) | **Extended by FR-116** for a double-click on a file throng cannot open. | Hand-test feedback. |
| 007 FR-013 | **Unchanged.** Reported as a Linux defect, tracked by MT-19. | Hand-test feedback. |
| 007 FR-013, on native Wayland | **Still unchanged; not met there.** MT-19 (2026-11-10) found the windows fall behind on native Wayland and behave under XWayland. Research D25: Electron 44 cannot express the parent relationship on Wayland. The remedy is the maintainer's choice, recorded under T140. | Hand-test feedback, MT-19. |
| FR-045 | **Refined by FR-128.** Properties moves to the end of the File Explorer context menu. | Hand-test feedback, MT-08. |
| FR-062 | **Refined by FR-129.** Down arrow shows the remembered list, whether or not anything is typed. | Hand-test feedback, MT-10. |
| FR-064b, FR-066 | **Refined by FR-130.** The clear control sits in the Terminal section. | Hand-test feedback, MT-10. |
| FR-116 | **Extended by FR-131** to Ctrl+click on a link. | Hand-test feedback, MT-14. |
| FR-123 | **Scope superseded by FR-132.** Every link form the editor recognises, not only relative ones. | Hand-test feedback, MT-14. |
| FR-090 | **Amended by FR-132, in the front matter table only.** A form the body preview refuses follows as the editor would. The body is unchanged. | Hand-test feedback, MT-14. |
| FR-067 | **Refined by FR-133.** Delete on a highlighted remembered value removes that one value. | Hand-test feedback, MT-10. |
| FR-125, FR-126 | **Refined by FR-134.** The column and selected readouts end in a full stop. | Hand-test feedback, MT-15. |
| FR-062, FR-129 | **Superseded in part by FR-135.** The list opens when the field is focused or clicked, whole; typing narrows it. Down still opens it. | Hand-test feedback, MT-10. |
| FR-126 | **Extended by FR-136.** A selection across lines reads `Ln 3-5`, with the selection's first column. | Hand-test feedback, MT-15. |
| 007 FR-013, on native Wayland | **Accepted as a documented limit (2026-11-12).** The maintainer chose research D25 option 1: separate windows stay; `docs/linux.md` and the `window.nativeWayland` description say so. MT-19 is signed off under XWayland only. | T140. |

## Clarifications

### Session 2026-11-08

- Q: Which Windows 11 placement ships for v1.0.0, the classic verb under "Show more options" or the top-level menu, which needs a signed package? → A: The classic verb. (FR-030)
- Q: On Linux, is the file-manager item on or off after install? → A: On after install, switched off in Preferences. (FR-033)
- Q: What does Cancel do to the shutdown task in progress? → A: Waits up to 5 seconds for it to finish, then aborts it. (FR-038)
- Q: What should the command for opening a folder as a project look like? → A: `throng <path>`, replacing #607's working name `--new`. (FR-022)
- Q: On Linux, who does switching off the file-manager item in Preferences affect? → A: Only the current user, with no password prompt. (FR-034)
- Q: On Linux, which desktops must file transfer be proven to work on? → A: GNOME Files, Dolphin and Nemo, on both X11 and Wayland. (FR-001)
- Q: What is the menu item that opens a file in its OS-registered application called? → A: "Open in OS Default Program" on all menus, the Link menu's existing label (045 FR-030). (FR-015)
- Q: When files are dragged out of the throng tree to the OS, are they copied or moved? → A: Copied by default, and throng's own drag modifiers apply (copy modifier copies, move modifier moves). (FR-005)
- Q: When files are dragged from the OS into the throng tree, whose modifier rules apply? → A: throng's, the same as outbound, and the mouse pointer must show the action a drop would perform. (FR-004, FR-005a)
- Q: Are the file-manager item and `PATH` options ticked by default in the Windows installers? → A: Both ticked by default. (FR-029, FR-031)
- Q: What happens when the opened folder is inside an existing project, or contains one? → A: Inside a project selects that project; containing a project is refused with one notice. (FR-026)
- Q: Does the Properties view block the rest of throng until closed? → A: Yes: a modal dialog, one at a time, in the window it was opened from. (FR-045)
- Q: How are file transfer and the file-manager item proven on real file managers? → A: Automated tests of what throng writes and reads, plus a hand-test plan the maintainer signs off before merge. (FR-109)
- Q: Can the terminal form's history be switched off entirely? → A: Yes: a separate on/off setting, with a control that clears all stored values. (FR-064a, FR-064b)
- Q: What side-pane state does a project with none stored start with? → A: Both panes expanded, always. This replaces #330's fallback to the global state. (FR-057)
- Q: What happens to the Save and Save As icons on a narrow editor panel? → A: Save As hides first, then Save, restoring when wider. (FR-069a)

### Session 2026-11-09

- Q: Should the File Explorer's drags stay web drags? → A: No. Reverses the Session 2026-11-08 answer on outbound drag and today's withdrawal of FR-005. Tree drags become mouse-driven, everything inside throng keeps working, a key pressed before or during a drag counts, the real pointer shows copy or move on every desktop, and a normal row drag leaving the window hands over to a real OS file drag, copy-only. (FR-110 to FR-114)
- Q: Does anything change for files dragged in from the OS? → A: No. They stay web drags with the limits MT-02 recorded, and the Copy/Move label stays for them because the pointer cannot be set. *(derived from the maintainer's feedback and the code; not confirmed by the maintainer)* (FR-115)
- Q: What should a double-click on a file throng cannot open do? → A: A new preference, on by default, opens it in the OS default program, or the OS's own message if the type has no program. Only on a double-click, whatever the activation setting. Off shows today's "cannot open" message. "Cannot open" means the editor's refusal of a binary type, not a too-large file, and with the setting on a single click on such a file raises no notice because a second click may follow. The last two points are *(derived from the maintainer's feedback and the code; not confirmed by the maintainer)* (FR-116, FR-117)
- Q: What should the Save icons look like? → A: Disks, not arrows, and the two stay distinguishable. (FR-118)
- Q: What should change in the Properties dialog? → A: No Linux notice and no Close button; an X at the top right; a copy button beside every value; owner, group and permissions shown; the scrim closes it. Reverses the Session 2026-11-08 scope in FR-053's disabled-with-reason and FR-055's exclusion of owners; editing stays out of scope. Windows shows the flags it has, and an owner only if obtainable without elevation: *(derived from the maintainer's feedback and the code; not confirmed by the maintainer)* (FR-119 to FR-122)
- Q: Which relative links count in front matter? → A: Those relative to the document, behaving like the same link in the body. Both a Markdown link with a relative target and a bare scalar that is a relative path to a file: *(derived from the maintainer's feedback and the code; not confirmed by the maintainer)* (FR-123)
- Q: What happens straight after creating a sub-workspace directly? → A: The caret goes to renaming it with the default name selected. Enter commits and opens it. Esc keeps the default and does not open it, and clicking away commits without opening: *(derived from the maintainer's feedback and the code; not confirmed by the maintainer)* (FR-124)
- Q: How should the status line read? → A: Punctuated: `Ln 10, Col 45` or `Cols 45-56`, then `440 Lines.` `8,000 Chars.` `43 Words.`. Digit grouping stays, per the constitution: *(derived from the maintainer's feedback and the code; not confirmed by the maintainer)* (FR-125, FR-126)
- Q: What does clicking the resource popup do? → A: It closes the popup. Only clicking the status bar item opens the Resource Monitor. (FR-127)

### Session 2026-11-10

- Q: Where does Properties sit in the File Explorer context menu? → A: Last, on files and folders. (FR-128)
- Q: What does Down arrow do in a terminal form field with history? → A: It shows that field's remembered list for the terminal type: all of it when the field is empty, the matches otherwise. Down then moves through the list and Esc closes it, as today. *(Esc and movement derived)* (FR-129)
- Q: Where does the control that clears the terminal form history go? → A: In Preferences' Terminal section, beside the two form-history settings. (FR-130)
- Q: What does Ctrl+click on a link to a file throng cannot open do? → A: With FR-116's preference on, the same as a double-click in the File Explorer: the OS default program, or the OS's own message. Off, the existing "cannot open" message. Wherever a file link is followed; a file outside every project, or one whose default open action is its preview, keeps today's behaviour. *(scope derived)* (FR-131)
- Q: Which link forms does the front matter table recognise? → A: Every form the editor recognises in a whole value, followed as the editor follows it: relative paths (spaces included), project-rooted, home-relative and absolute paths, `file:` URIs, line, line:column, line range and (line,col) positions, same-document `#anchor` headings, and the protocols on the protocol allowlist. The body preview is unchanged. *(the whitespace rule and the body staying unchanged are derived)* (FR-132)

### Session 2026-11-12

- Q: How does a user remove one remembered value from a terminal form field's list? → A: Highlight it in the open list and press Delete. That value goes from that field's list for the selected terminal type, for good, and no open form offers it any more. The list stays open with the highlight on the next value, or the previous one when the last was removed, and closes when it empties. Delete with nothing highlighted edits the text as usual, and the field's text never changes. *(everything after "for the selected terminal type" derived)* (FR-133)
- Q: How are the column and selected readouts punctuated? → A: Each ends in a full stop: `Ln 10, Col 45.`, `Cols 9-15. 2 selected. 25 Lines.`. The short form reads `2 sel.`; with the column hidden by the fit, the line ends in a full stop (`Ln 10.`). *(short form and hidden-column case derived)* (FR-134)
- Q: When does a terminal form field show its remembered values? → A: When it is focused or clicked: the whole list, whatever the field holds. Typing narrows it to the matches. Picking a value replaces the field's text. Down still opens it, and Esc closes it until the field is clicked or focused again. *(Down, Esc and "whatever the field holds" derived)* (FR-135)
- Q: How does the status bar read a selection across lines? → A: `Ln 3-5, Col 4.`: the first and last lines of the selection, and the column where it starts. A selection ending at the very start of a line does not count that line. *(the end-of-line rule and the short and spoken forms derived)* (FR-136)

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Move files between throng and the OS file manager (Priority: P1)

A user copies files in their OS file manager and pastes them into a project folder in throng, or copies files in throng and pastes them into the OS file manager, the desktop, an email or a chat window. Dragging works in both directions too.

**Why this priority**: It is the most frequent reason to leave throng and open the OS file manager beside it.

**Independent Test**: Copy a file and a folder in the OS file manager, paste them on a folder in the tree, then drag a file from the tree to the desktop. Real files arrive each time.

**Acceptance Scenarios**:

1. **Given** a file and a folder copied in the OS file manager, **When** the user pastes on a folder in the tree, **Then** both are copied there and the tree shows them.
2. **Given** items cut in the OS file manager, **When** the user pastes in throng, **Then** they are gone from the source and present in the target.
3. **Given** items copied in throng, **When** the user pastes in the OS file manager, **Then** it copies them. **Given** items cut in throng, **When** the user pastes in the OS file manager, **Then** it moves them and the tree shows their removal.
4. **Given** items dragged from the OS file manager, **When** they are dropped on a folder in the tree, **Then** they are copied, or moved with throng's move modifier, into that folder, and the pointer shows which throughout the drag.
5. **Given** one or several items in the tree, **When** they are dragged to the OS file manager or the desktop with no modifier or the copy modifier, **Then** real files arrive and the originals stay. **When** dragged with the move modifier, **Then** they are moved and the tree shows their removal.
  *Session 2026-11-09: FR-114 makes every drag to the OS a copy, so the move-modifier case in this story and its Independent Test no longer applies to drags.*
6. **Given** an inbound paste or drop, **When** the user undoes and redoes it, **Then** it reverses and reapplies like an internal file operation.
7. **Given** a drop or paste outside any project root, **When** it is attempted, **Then** it is refused with one notice.
8. **Given** an internal cut, copy, paste or drag, or a drop on an editor panel or terminal, **When** it runs, **Then** it behaves as before.

---

**Acceptance Scenarios added in Session 2026-11-09**:

1. **Given** a row dragged by its name inside the tree, **When** Ctrl is pressed before the drag or during it, **Then** the pointer shows a copy and the drop copies; releasing Ctrl returns it to a move.
2. **Given** a row dragged inside the tree, **When** Shift is pressed before or during the drag, **Then** the pointer shows a move and the drop moves.
3. **Given** a row dragged over something that cannot take it, **When** the pointer is there, **Then** it shows not-allowed.
4. **Given** a row drag, **When** Esc is pressed, **Then** the drag ends and nothing changes.
5. **Given** a long tree, **When** a drag is held near its top or bottom edge, **Then** the tree scrolls.
6. **Given** a selected group of rows, **When** dragged out of the window to a file manager, **Then** real copies arrive and the originals stay.
7. **Given** a file dragged in from the OS over the tree, **When** it is over a folder, **Then** a label beside the pointer names the copy or move.

### User Story 2 - Open a file in its registered OS program (Priority: P1)

A user viewing a PDF, image, spreadsheet or HTML page right-clicks it in the File Explorer or on a panel title and opens it in the application the OS has registered for it.

**Why this priority**: throng has no preview for many of these types in v1.0.0, so the OS program is the only way to see them.

**Independent Test**: Right-click a PDF in the File Explorer, choose the item, and see it open in the registered program with throng undisturbed.

**Acceptance Scenarios**:

1. **Given** a file in the File Explorer, **When** the user opens the context menu, **Then** the item appears in the Open In submenu's OS section.
2. **Given** an editor or preview panel showing a file, **When** the user opens its title menu, **Then** the item appears in the Navigate section.
3. **Given** the item is chosen, **When** the OS has a registered program, **Then** the file opens there and throng keeps running undisturbed.
4. **Given** an elevated throng on Windows, **When** the item is chosen, **Then** the program starts de-elevated.
5. **Given** a file with no registered program, or one deleted since the menu opened, **When** the item is chosen, **Then** one notice names the path and the OS's reason.
6. **Given** a folder or a multi-selection, **When** the menu opens, **Then** the item is absent.
7. **Given** the preference hides the item, **When** either menu opens, **Then** the item is absent from both.

---

**Acceptance Scenarios added in Session 2026-11-09**:

1. **Given** the preference on, **When** a binary file is double-clicked, **Then** it opens in the OS default program, or the OS shows its own message.
2. **Given** the preference on and single-click opening, **When** a binary file is clicked once, **Then** no notice appears.
3. **Given** the preference off, **When** a binary file is double-clicked, **Then** the existing "cannot open" message appears.

**Acceptance Scenarios added in Session 2026-11-10**:

1. **Given** the preference on, **When** a link to a binary file in the project is Ctrl+clicked in an editor, a preview or a terminal, **Then** it opens in the OS default program, or the OS shows its own message.
2. **Given** the preference off, **When** the same link is Ctrl+clicked, **Then** the existing "cannot open" message appears.

### User Story 3 - Open a folder as a throng project from outside throng (Priority: P1)

A user looking at a folder in the OS file manager, or sitting in a shell, opens that folder as a throng project without first opening throng.

**Why this priority**: It removes the steps between "I am looking at this folder" and "I am working on it".

**Independent Test**: Run the command with a relative folder path, with throng closed and again with throng running. The folder appears as a project each time and only one throng runs.

**Acceptance Scenarios**:

1. **Given** throng is closed, **When** the command runs with a folder, **Then** throng starts and shows the folder as a project.
2. **Given** throng is running, **When** the command runs, **Then** no second instance starts, the window comes forward and the project shows.
3. **Given** a relative path, **When** the command runs, **Then** it resolves against the shell it was typed in.
4. **Given** a folder that already is a project or lies inside one, **When** it is opened, **Then** that project is selected and no second one is added. **Given** a folder containing a project, **When** it is opened, **Then** one notice names the overlapping project and nothing is added.
5. **Given** a missing path or a file, **When** the command runs, **Then** one notice names it and nothing is added.
6. **Given** an elevated running throng that a normal launch cannot reach, **When** the command runs, **Then** the user is told the path could not be opened.
7. **Given** the installer option is chosen, **When** the user right-clicks a folder or a folder's background in Windows Explorer, **Then** **Open as throng project** is offered and opens that folder.
8. **Given** the option is not chosen, **When** the install finishes, **Then** nothing is registered.
9. **Given** an installed Linux package, **When** the user opens a folder's context menu in a supported file manager, **Then** the action is offered according to FR-033.
10. **Given** an uninstall, **When** it finishes, **Then** every registration is gone, at the scope it was made.
11. **Given** a path with spaces and non-ASCII characters, **When** it is used from any entry point, **Then** it opens correctly.

---

### User Story 4 - Cancel a shutdown and see its progress (Priority: P1)

A user closing throng sees what shutdown is doing and how long it will take, and can cancel it. A shutdown task that cannot finish no longer locks the window.

**Why this priority**: A stuck shutdown today leaves the user unable to tell whether throng is working, and unable to get out.

**Independent Test**: Close throng with Terminate all and several terminals open. Blocks fill in order, and Cancel returns to a usable throng.

**Acceptance Scenarios**:

1. **Given** the closing overlay, **When** the user activates Cancel, **Then** the overlay closes and throng is usable with no half-closed panel shown as open.
2. **Given** shutdown tasks, **When** they run, **Then** one block per task fills in order and the current task is highlighted.
3. **Given** a block, **When** the user hovers or focuses it, **Then** a summary of that task shows.
4. **Given** shutdown is running, **When** tasks complete, **Then** a remaining-time estimate updates without jumping wildly.
5. **Given** a task that never completes, **When** the user activates Cancel, **Then** Cancel still works.

---

### User Story 5 - See a file's or folder's properties (Priority: P2)

A user checks a file's full path, a folder's total size, its attributes or whether it is a link, without leaving throng.

**Why this priority**: Useful and frequent, but the OS file manager is a working fallback.

**Independent Test**: Open Properties on a large folder. The view appears at once, the size fills in, and the app stays responsive. Closing the view stops the calculation.

**Acceptance Scenarios**:

1. **Given** a file or folder in the tree, **When** the user chooses Properties, **Then** the view opens showing name, copyable full path, type, size, attributes and timestamps.
2. **Given** a symlink or junction, **When** Properties opens, **Then** it is identified as a link, with its target.
3. **Given** a folder, **When** Properties opens, **Then** total size and file and sub-folder counts fill in progressively while the app stays responsive.
4. **Given** a calculation in progress, **When** the view closes, **Then** the calculation stops.
5. **Given** a folder containing links and unreadable sub-folders, **When** the size is calculated, **Then** links are not followed and unreadable folders are reported as skipped.
6. **Given** the view, **When** the user chooses the OS-folder action, **Then** the containing folder opens with the item selected.
7. **Given** Windows, **When** the user chooses the OS Properties action, **Then** the OS dialog opens for the item. **Given** a platform with no equivalent, **Then** the action is disabled and says why.

---

**Acceptance Scenarios added in Session 2026-11-09**:

1. **Given** the dialog is open, **When** its X or its scrim is clicked, **Then** it closes; there is no Close button.
2. **Given** any value, **When** its copy button is pressed, **Then** that value is on the clipboard.
3. **Given** one item on Linux, **When** the dialog opens, **Then** owner, group and permissions show.
4. **Given** Linux, **When** the dialog opens, **Then** no message about OS properties appears.

**Acceptance Scenarios added in Session 2026-11-10**:

1. **Given** a file or a folder, **When** its File Explorer context menu opens, **Then** Properties is the last item.

### User Story 6 - Each project remembers its side panes (Priority: P2)

A user who keeps Files & Folders open in one project and closed in another switches between them without touching either toggle.

**Why this priority**: A small daily friction for anyone working across several projects.

**Independent Test**: Collapse Files & Folders in project A, switch to B and back. A is collapsed and B is as B had it.

**Acceptance Scenarios**:

1. **Given** Files & Folders collapsed in A, **When** the user switches to B and back, **Then** A is restored collapsed and B is as B had it.
2. **Given** the same for the Projects pane, **Then** the same holds.
3. **Given** per-project states, **When** throng restarts, **Then** both survive.
4. **Given** a project with no stored state, **When** it activates, **Then** both panes are expanded, unless the window is too narrow for them.
5. **Given** a pane auto-collapsed by a narrow window, **When** the window widens, **Then** the project's stored preference is restored, having never been overwritten.
6. **Given** no project is active, **When** panes render, **Then** behaviour is unchanged.

---

### User Story 7 - The terminal form remembers what was typed (Priority: P2)

A user creating terminals with the same few commands or arguments picks them from a typeahead instead of retyping them. Each shell keeps its own history.

**Why this priority**: Saves repeated typing, with retyping as the fallback.

**Independent Test**: Create a Bash terminal with startup command `X`. Reopen the form with Bash and type a prefix of `X`: it is offered. With PowerShell it is not.

**Acceptance Scenarios**:

1. **Given** a Bash terminal created with startup command `X`, **When** the form reopens with Bash selected and a prefix of `X` is typed, **Then** `X` is offered. **Given** PowerShell selected, **Then** it is not.
2. **Given** Shell Arguments, **Then** it behaves the same, with its own list.
3. **Given** more than N values entered, **Then** at most N remain per type and field, newest first, with no duplicates.
4. **Given** N lowered in Preferences, **Then** every existing list is trimmed to the newest N.
5. **Given** Preferences' clear control for one terminal type, **When** used, **Then** only that type's values are removed.
6. **Given** the clear button beside a field, **When** used, **Then** only that field's list for the selected type is removed.
7. **Given** remembered values, **When** throng restarts, **Then** they survive.

**Acceptance Scenarios added in Session 2026-11-10**:

1. **Given** an empty field with remembered values, **When** Down is pressed, **Then** the whole list for that field and terminal type shows.
2. **Given** text in the field, **When** Down is pressed, **Then** the matching values show.
3. **Given** Preferences open, **When** the Terminal section is shown, **Then** the clear control sits there beside the form-history settings.

**Acceptance Scenarios added in Session 2026-11-12**:

1. **Given** the remembered list open with a value highlighted, **When** Delete is pressed, **Then** that value leaves the list, the highlight moves to the next value, and the field's text is unchanged.
2. **Given** a value removed that way, **When** another open form or a new one shows that field's list for the same terminal type, or throng restarts, **Then** the value is not offered.
3. **Given** the last value removed, **Then** the list closes. **Given** the list open with nothing highlighted, **When** Delete is pressed, **Then** the field's text is edited as usual.
4. **Given** remembered values, **When** the field is focused or clicked, **Then** the whole list shows, even when the field already holds text.
5. **Given** the list shown, **When** the user types, **Then** only the matches show. **When** a value is picked, **Then** it replaces the field's text.

---

### User Story 8 - Save an editor with one click (Priority: P2)

A mouse user saves from the editor panel's title bar instead of opening a menu.

**Why this priority**: The most common editor action currently takes two clicks by mouse.

**Independent Test**: Click the Save icon on an edited file: it saves as `Ctrl+S` does.

**Acceptance Scenarios**:

1. **Given** an editor panel, **Then** its title bar shows Save and Save As icons, right-aligned, left of the common panel icons, with a separator between the groups.
2. **Given** a non-editor panel, **Then** it shows no save icons and no extra separator.
3. **Given** the icons, **When** clicked, **Then** Save and Save As behave exactly as their chords do.
4. **Given** a key binding rebound, **Then** the icon's tooltip names the action and the current binding.
5. **Given** a state where the menu's Save or Save As item is disabled, **Then** the icon is disabled with a reason in its tooltip.

---

**Acceptance Scenarios added in Session 2026-11-09**:

1. **Given** an editor panel, **When** its title bar shows, **Then** Save and Save As are two distinct disk icons.

### User Story 9 - Rename a tab from the keyboard (Priority: P2)

A user working in any panel renames the active tab without reaching for the mouse.

**Why this priority**: Rename Tab is the one common tab action with no keyboard route.

**Independent Test**: With focus in a running terminal, press the chord, type a name and press Enter. The tab is renamed, the terminal received no bytes, and focus returns to it.

**Acceptance Scenarios**:

1. **Given** focus in a terminal, editor, preview or Find in Files panel, **When** `Ctrl+Shift+Alt+F2` is pressed, **Then** inline rename opens on the active tab.
2. **Given** a running terminal program, **When** the chord is pressed, **Then** it receives no bytes.
3. **Given** a rename in progress, **When** it is committed or cancelled, **Then** focus returns to the panel that had it.
4. **Given** the Key Bindings editor, **Then** `tabs.rename` is listed and can be rebound, and the tab menu's Rename item shows the chord.
5. **Given** `F2`, **Then** it still renames the selected file in the File Explorer and still reaches the program in a terminal.

---

### User Story 10 - Create a sub-workspace directly (Priority: P2)

A user who wants a scratch sub-workspace creates one from the Sub-workspaces panel, without detaching a tab or panel first.

**Why this priority**: The only route today requires sacrificing a panel.

**Independent Test**: Click the create button. An unloaded sub-workspace with one untyped panel appears in the list and no window opens.

**Acceptance Scenarios**:

1. **Given** the Sub-workspaces panel header, **Then** it shows a create button using the themed `add` icon, in the slot the Projects panel's New project button occupies.
2. **Given** the button is clicked, **Then** a new sub-workspace appears in the list, unloaded, containing exactly one sub-workspace-owned untyped panel, and no window opens.
3. **Given** the new sub-workspace, **When** opened with the existing control, **Then** its panel can be given a type.
4. **Given** the new sub-workspace, **Then** it can be renamed, recoloured, reordered and deleted like a detach-created one.
5. **Given** a restart, **Then** the sub-workspace and its panel survive.

---

**Acceptance Scenarios added in Session 2026-11-09**:

1. **Given** New sub-workspace was pressed, **When** the row appears, **Then** its name is selected for typing.
2. **Given** that state, **When** a name is typed and Enter pressed, **Then** the sub-workspace takes the name and opens.
3. **Given** that state, **When** Esc is pressed, **Then** the default name stays and it does not open.

### User Story 11 - Follow links in Markdown front matter (Priority: P3)

A reader of a note that keeps its links in front matter clicks them in the preview's table as they would in the body.

**Why this priority**: Matters for Obsidian-style vaults and documentation sites, and is narrow elsewhere.

**Independent Test**: Preview a document with `source: https://…` and `related: ["[[A]]", "[[B]]"]`, with Show front matter on. Each link follows like a body link.

**Acceptance Scenarios**:

1. **Given** a bare web URL value, **Then** it renders as a link that opens like the same URL in the body.
2. **Given** a `[text](target)` value, **Then** it renders labelled `text`, and a relative file target opens like a body link.
3. **Given** a `[[Note]]` or `[[Note|alias]]` value, **Then** it renders and resolves like the same wikilink in the body, including unresolved styling.
4. **Given** a sequence value, **Then** each link is individually clickable.
5. **Given** a value with no link, **Then** it renders exactly as today.
6. **Given** invalid YAML or non-mapping front matter, **Then** it still renders as an unlinked code block.

---

**Acceptance Scenarios added in Session 2026-11-09**:

1. **Given** a front matter value with a link relative to the document, or a bare relative path to a file, **When** previewed, **Then** it is a link that behaves like one in the body.

**Acceptance Scenarios added in Session 2026-11-10**:

1. **Given** front matter values that are a relative path with a space, a project-rooted path, a home-relative path, an absolute path or a `file:` URI, **When** previewed and Ctrl+clicked, **Then** each opens that file, as the same text does in the editor.
2. **Given** values `./test.ts:3`, `./test.ts:3:5`, `./research.md:10-20` and `./test.ts(3,5)`, **When** Ctrl+clicked, **Then** the file opens at that line, line and column, or range.
3. **Given** a value `#local-links`, **When** Ctrl+clicked, **Then** the preview goes to that heading.
4. **Given** values `tel:+441234567890` and `slack://open` with both schemes on the protocol allowlist, **When** Ctrl+clicked, **Then** each goes to the OS handler, as in the editor.
5. **Given** a value that is a sentence with a path inside it, **When** previewed, **Then** it stays text.

### User Story 12 - See a document's total lines (Priority: P3)

A user sees how many lines a document has without jumping to its end.

**Why this priority**: A convenience beside two counts that already exist.

**Independent Test**: Open a 9,000-line file: the status bar reads `9,000 lines`. Narrow the panel: it shortens, then hides in its declared place. *Wording per FR-125: `9,000 Lines.`*

**Acceptance Scenarios**:

1. **Given** an editor, **Then** the counts group shows a digit-grouped total-lines readout beside characters and words.
2. **Given** lines added or removed, **Then** the readout updates. **Given** an empty document, **Then** it reports `1 line`.
3. **Given** a narrowing panel, **Then** the readout shortens, then hides in its declared place, and widening restores it.
4. **Given** counts switched off in settings, **Then** it hides with the other counts.
5. **Given** a screen reader, **Then** it is announced as `N lines` or `1 line`.

---

**Acceptance Scenarios added in Session 2026-11-09**:

1. **Given** a caret at line 10 column 45, **When** the status bar shows, **Then** it reads `Ln 10, Col 45` followed by punctuated totals.
2. **Given** a selection on one line, **When** the status bar shows, **Then** it reads `Ln 10, Cols 45-56`.

**Acceptance Scenarios added in Session 2026-11-12**:

1. **Given** a caret at line 10 column 45, **Then** the status bar reads `Ln 10, Col 45.` followed by the totals.
2. **Given** 2 characters selected across columns 9 to 15 of a 25-line document, **Then** it reads `Cols 9-15. 2 selected. 25 Lines.`
3. **Given** a selection from line 3 column 4 to line 5, **Then** the position reads `Ln 3-5, Col 4.`, whichever way the selection was made.

### User Story 13 - Know when Linux removes an old version (Priority: P3)

A Linux user who upgraded while throng ran can find out why a previous version remains on disk and when it goes. The maintainer has a requirement and a test for the rule.

**Why this priority**: The behaviour already works; only its record and coverage are missing.

**Independent Test**: The automated test installs over a running version, ends it, installs again, and shows the old version removed.

**Acceptance Scenarios**:

1. **Given** a version with a running process during an upgrade, **Then** it stays.
2. **Given** that process has ended, **When** a later install runs, **Then** the version is removed.
3. **Given** the Linux install documentation, **Then** it describes the left-behind version and when it goes.

---

### User Story 14 - Dismiss the resource popup (Priority: P3)

A click on the resource popup dismisses it, so it is never in the way.

**Acceptance Scenarios**:

1. **Given** the resource popup is open, **When** it is clicked, **Then** it closes and the Resource Monitor does not open.
2. **Given** the status bar item, **When** it is clicked, **Then** the Resource Monitor opens.

### Edge Cases

- **Inbound transfer into its own source**: pasting a folder into itself or a descendant is refused with one notice, as an internal paste is.
- **Partial inbound copy**: when some items fail, the ones that arrived stay, one notice lists what failed, and undo reverses only what arrived.
- **OS clipboard holding text and files**: Paste on the tree acts on the file list. Text-only content leaves the tree's Paste unavailable.
- **Elevated throng on Windows**: the OS blocks inbound drags from a non-elevated process with no event throng can observe, so the session says so once, when the tree first shows. Clipboard paste still works.
- **Outbound drag dropped on a throng panel**: behaves as the existing internal drag does.
- **Several folders opened at once from the OS**: each launch is handled in arrival order, and each resolves to its own project.
- **Folder arriving while a modal is open**: the project is added or selected once the modal closes, and the launch is not lost.
- **Opening a folder while throng is closing**: the launch is not silently dropped. If shutdown completes first, a new throng starts and opens it.
- **Cancel pressed as the last task completes**: if the application has already passed the point of no return, the quit finishes and Cancel has no effect.
- **Second close request after Cancel**: starts a fresh shutdown.
- **Very large folder in Properties**: partial figures are labelled as still calculating until the walk finishes.
- **Item deleted or renamed while Properties is open**: the view states the item is gone and stops updating.
- **Project deleted**: its stored side-pane state goes with it.
- **History values with newlines or very long text**: stored and offered as entered, displayed on one truncated line.
- **Rename chord with no active tab or a tab already renaming**: does nothing.
- **Front matter link using a disallowed scheme**: rendered as plain text, like the same link in the body.
- **Empty sub-workspace deleted before ever being opened**: removed with no confirmation beyond what deletion already asks.

## Requirements *(mandatory)*

### Functional Requirements

#### OS file transfer (#8)

- **FR-001**: Cut, copy, paste and drag between the File Explorer tree and the OS file manager MUST work on **Windows and Linux**, each passing one shared contract suite (Constitution Principle II). On Linux, every gesture MUST work with GNOME Files, KDE Dolphin and Nemo, on both X11 and Wayland sessions. The abstraction MUST admit a future macOS implementation without changing core logic.
  *Amended by FR-114 (Session 2026-11-09): for a drag to the OS, the gesture delivered is a copy. Cut, copy and paste are unchanged.*
- **FR-002**: Pasting files from the OS clipboard onto a tree folder MUST copy them, or move them when the OS clipboard marks a cut.
- **FR-003**: Copy or Cut in the tree MUST place a real file list on the OS clipboard, so the OS file manager and other applications paste real files, and a cut is performed as a move by the receiving application.
- **FR-004**: Dropping files from the OS onto a tree folder MUST follow throng's drag modifiers: no modifier or the copy modifier MUST copy, and the move modifier MUST move.
- **FR-005**: Dragging one or more items from the tree to any OS target MUST deliver real files. A drag with no modifier, or with throng's copy modifier (`explorer.dragCopyModifier`, default Ctrl), MUST copy. A drag with throng's move modifier (`explorer.dragMoveModifier`, default Shift) MUST move. A plain drag within throng stays a move. *Open: Electron's file drag offers copy and link only, and cannot share a gesture with the HTML5 drag every internal target uses, so this ships as a copy from a grip on the row, pending the maintainer's decision (plan, Complexity Tracking; T033).*
  *Withdrawn by the maintainer earlier on 2026-11-09, with this note:* *Withdrawn by the maintainer (2026-11-09).* Dragging from the tree to the OS is not delivered: Electron's file drag offers copy and link only and cannot share a gesture with the row's own drag, and the row grip that stood in for it was judged confusing and removed. Copy or Cut in the tree with Paste in the OS file manager (FR-003) is the outbound route. A plain drag within throng stays a move.
  *Superseded by FR-114 (Session 2026-11-09): a normal row drag now reaches the OS, as a copy.*
- **FR-005a**: During a drag in either direction, the mouse pointer MUST show the action a drop would perform (copy or move), updating as a modifier is pressed or released (extending 006 FR-081). A drop that would be refused MUST show the not-allowed pointer.
- **FR-006**: The check that the clipboard still holds what throng placed there (016 FR-015c) MUST extend to file lists, so an internal cut replaced by another application is not pasted.
- **FR-007**: Items pasted or dropped into throng MUST land inside the target project's root. A drop or paste outside any project root MUST be refused with one notice. Outbound transfers MAY go anywhere.
- **FR-008**: Name collisions on an inbound transfer MUST follow the rule internal paste already uses.
- **FR-009**: An inbound paste or drop MUST be undoable and redoable like an internal file operation (#85). Outbound operations are not throng's to undo.
- **FR-010**: After another application completes a move of an item cut or move-dragged from throng, the tree MUST reflect the removal through normal file watching. throng MUST NOT delete the item itself.
  *Session 2026-11-09: a move-drag out no longer occurs (FR-114). The rule still governs an item cut from throng.*
- **FR-011**: A locked file, permission failure, full disk or partial copy MUST each raise one notice carrying its resolving action.
- **FR-012**: Windows blocks inbound drags into an elevated throng before throng receives any event, so an elevated session MUST say so once, when its tree first shows, rather than leave the drag to fail silently. Clipboard paste MUST be unaffected.
- **FR-013**: No OS clipboard or drag format name MUST appear outside the platform layer, enforced by an automated guard.
- **FR-014**: Internal cut, copy, paste and drag, drops on editor panels and preview panels, and drops on terminals MUST be unchanged, including in sub-workspace windows. The existing editor-only inbound path resolution MUST be absorbed by this feature's inbound seam.
  *Amended by FR-110 (Session 2026-11-09): the same outcomes, delivered by mouse events.*

#### Open in the registered program (#606)

- **FR-015**: The File Explorer context menu MUST offer **Open in OS Default Program** in the Open In submenu's OS section, on every single selected file, whether or not throng can preview it.
- **FR-016**: The panel title context menu MUST offer the same item in its Navigate section on any editor or preview panel backed by a file on disk.
- **FR-017**: The item MUST live in the shared preview title menu, so a new preview provider inherits it with no code of its own.
- **FR-018**: The item MUST reuse the existing open-with-default-program path, including de-elevation on Windows (045 FR-038) and its notice (045 FR-037). A file with no registered program or one since deleted MUST raise one notice naming the path and the OS's reason.
- **FR-019**: The item MUST be absent on a folder and on a multi-selection.
- **FR-020**: Menu placement MUST follow 033 FR-048.
- **FR-021**: A preference MUST control whether the item shows, on both menus, defaulting to shown.

#### Open a folder from outside throng (#607)

- **FR-022**: throng MUST accept a folder path as a positional command-line argument, in the form `throng <path>` (for example `throng .`). The file-manager item MUST only invoke this form.
- **FR-023**: A relative path MUST resolve against the launching shell's directory, before reaching any running instance.
- **FR-024**: With throng running, the launch MUST start no second instance, MUST bring the window forward (058 FR-018), and MUST pass the path to the running instance.
- **FR-025**: With throng closed, the launch MUST start it and show the folder as a project.
- **FR-026**: A folder that already is a project, or that lies inside one, MUST select that project. A folder containing an existing project MUST add nothing and MUST raise one notice naming the overlapping project. Any other folder MUST be added through the existing add-project path and its validation, named after the folder.
- **FR-027**: A missing path or a file MUST raise one notice naming it, and MUST add nothing.
- **FR-028**: A launch that cannot reach an elevated running instance MUST tell the user the path could not be opened.
- **FR-029**: Both Windows installer formats MUST offer an option to add the file-manager item for a folder and a folder's background, at the install's scope (per-user or machine-wide), ticked by default, with a documented MSI property for unattended installs that defaults to on.
- **FR-030**: On Windows 11 the file-manager item MUST appear as a classic verb under "Show more options". A top-level menu entry is out of scope for v1.0.0 because it needs a signed package (#118).
- **FR-031**: Both Windows installers MUST offer adding `throng` to `PATH`, at the install's scope, ticked by default.
- **FR-032**: Uninstalling MUST remove every registration, at the scope it was made.
- **FR-033**: Linux packages MUST provide the action in GNOME Files (through its Open With list, the route open to a package without a file-manager extension), KDE Dolphin and Nemo (as context-menu items). Because those packages have no option screen, the item MUST be on after install, and the preference in FR-034 MUST switch it off.
- **FR-034**: A preference MUST turn the file-manager item on or off without re-running an installer. For a machine-wide Windows registration, which needs elevation to change, the control MUST state that and MUST NOT report a change it could not make. On Linux the preference MUST apply to the current user only, with no administrator prompt, and the package's system-wide files MUST stay installed.
- **FR-035**: A preference MUST decide whether a folder arriving from outside throng switches to its project or only loads it, defaulting to switching.
- **FR-036**: Paths with spaces and non-ASCII characters MUST work from every entry point. Portable and archive builds MUST register nothing, and `throng <path>` MUST still work by running their executable.

#### Cancellable closing (#521)

- **FR-037**: The closing overlay MUST gain a **Cancel** control, usable throughout shutdown, including while a task is not completing.
- **FR-038**: Cancel MUST wait up to 5 seconds for the task in progress to finish, then abort it, and MUST run no further shutdown task.
- **FR-039**: After Cancel, anything already closed MUST stay closed and be shown as closed, anything not yet closed MUST keep running, and no half-closed panel MUST be shown as open.
- **FR-040**: The overlay MUST show one progress block per shutdown task, filled in order as tasks complete, with the current task highlighted.
- **FR-041**: Hovering or focusing a block MUST show a short summary of that task, such as "Closing 4 terminals in project X".
- **FR-042**: The overlay MUST show an estimated time remaining, updated as tasks complete, which MUST NOT rise by more than 25% between consecutive updates unless a task has overrun its expected duration.
- **FR-043**: This feature MUST NOT change which tasks run on shutdown.
- **FR-044**: A task that does not complete MUST be identifiable from the overlay as the current task.

#### Properties (#485)

- **FR-045**: The File Explorer context menu MUST offer **Properties** on files and folders, opening a modal dialog in the window it was requested from, one at a time.
- **FR-046**: The view MUST show name, copyable full path, type (file, folder, symlink or junction), the link target when it is a link, size, attributes (read-only, hidden, system, archive and platform equivalents) and created, modified and accessed timestamps.
- **FR-047**: For a folder, the view MUST show total contents size with file and sub-folder counts.
- **FR-048**: The view MUST open immediately with what is already known, and folder figures MUST fill in progressively without blocking the UI.
- **FR-049**: Closing the view MUST stop its calculation.
- **FR-050**: A result MUST be reused for 60 seconds rather than re-walking the tree.
- **FR-051**: The size walk MUST NOT follow symlinks or junctions, and MUST report unreadable sub-folders as a skipped count, not an error.
- **FR-052**: The view MUST offer opening the containing folder in the OS with the item selected, through the existing seam.
- **FR-053**: The view MUST offer opening the OS's own properties dialog on Windows. On Linux, where the capability has no equivalent, the platform layer MUST report it absent and the action MUST be disabled with the reason (Constitution Principle II).
  *Superseded in part by FR-122 (Session 2026-11-09): absent, not disabled with a reason.*
- **FR-054**: On a multi-selection, Properties MUST show combined size and counts.
- **FR-055**: Editing attributes or permissions, and showing ACLs or owners, are out of scope.
  *Superseded in part by FR-121 (Session 2026-11-09): owners and permissions are shown; editing stays out of scope.*

#### Per-project side panes (#330)

- **FR-056**: When a project is active, each project MUST persist its own expanded or collapsed state for both side panes, and activating a project MUST restore it. Pane width stays global (003 FR-008).
- **FR-057**: A project with nothing stored MUST start with both panes expanded, including existing projects on upgrade, subject to FR-058.
- **FR-058**: A collapse caused by window width MUST remain derived and MUST NOT be written as a project's preference.
- **FR-059**: The no-project state MUST keep its current behaviour.
- **FR-060**: The per-project state MUST live with per-project workspace state, not in global settings.

#### Terminal form history (#516)

- **FR-061**: Startup Command and Shell Arguments MUST each remember the last N distinct values per terminal type, with separate lists per field.
- **FR-062**: Typing in either field MUST offer matching remembered values for the selected terminal type, and picking one MUST fill the field.
- **FR-063**: A value MUST be recorded when the form is confirmed, not per keystroke. Re-entering a value MUST move it to the top. Empty values MUST NOT be recorded.
- **FR-064**: N MUST be one global setting in Preferences, default 10, range 1 to 50, applying to every terminal type and both fields.
- **FR-064a**: A separate on/off setting MUST control the history, default on. When off, no value MUST be recorded or offered, and values already stored MUST stay until cleared.
- **FR-064b**: Preferences MUST offer a control that clears the remembered values of every terminal type at once, usable whether the history is on or off.
- **FR-065**: Lowering N MUST trim each list to its newest N.
- **FR-066**: Preferences MUST be able to clear the remembered values of one terminal type without touching others.
- **FR-067**: A clear button beside each field MUST clear only that field's list for the selected terminal type, using a themeable icon control.
- **FR-068**: Remembered values MUST survive a restart.

#### Save icons (#534)

- **FR-069**: Every editor panel's title bar MUST show Save and Save As icon buttons, right-aligned, left of the common panel icons, with a visual separator between the two groups.
- **FR-069a**: When a title bar is too narrow, Save As MUST hide first and then Save, along with the separator once both are hidden, and widening MUST restore them. Both actions MUST remain reachable through the panel menu and their chords.
- **FR-070**: Non-editor panels MUST show no save icons and no extra separator.
- **FR-071**: The buttons MUST invoke the same actions as the header-menu items and chords, with no second save path.
- **FR-072**: Each button MUST have an accessible name and a tooltip naming the action and its live key binding.
- **FR-073**: Each button's enabled state MUST match its menu item, with the reason in the tooltip when disabled.
- **FR-074**: Both icons MUST be themeable tokens rendering correctly in every shipped theme.

#### Rename Tab chord (#609)

- **FR-075**: A rebindable `tabs.rename` command at window scope, default `Ctrl+Shift+Alt+F2`, MUST start the existing inline rename on the active tab from any focused panel.
- **FR-076**: A running terminal program MUST receive no bytes for the chord.
- **FR-077**: Committing or cancelling the rename MUST return focus to the panel that had it.
- **FR-078**: The command MUST appear in the Key Bindings editor, and the tab menu's Rename item MUST show its chord.
- **FR-079**: `F2`, double-click rename and context-menu rename MUST be unchanged.
- **FR-080**: Constitution Principle IV MUST record the function-key exception, in the form used for `Ctrl+Shift+Alt+F4`.
- **FR-081**: The command MUST do nothing when there is no active tab or a rename is already open.

#### Create a sub-workspace (#93)

- **FR-082**: The Sub-workspaces panel header MUST offer a create button using the themed `add` icon, in the slot the Projects panel's New project button occupies.
- **FR-083**: Creating MUST add a sub-workspace containing exactly one sub-workspace-owned untyped panel, in the unloaded state, without opening a window.
- **FR-084**: The new sub-workspace MUST be seeded with a default name and a colour from the existing sub-workspace palette, consistent with new-project seeding.
- **FR-085**: It MUST be renamable, recolourable, reorderable and deletable like any other.
- **FR-086**: It and its panel MUST persist across restart.
- **FR-087**: The empty-state text MUST no longer say detaching is the way to create one, and the detach flow MUST be unchanged.

#### Front matter links (#500)

- **FR-088**: In the Markdown preview's front matter table, web URLs, Markdown links, wikilinks and GitHub URLs in a scalar value MUST render as real links. This refines 044 FR-085.
- **FR-089**: Each item of a sequence value MUST be individually linked.
- **FR-090**: Each link MUST behave exactly like the same link in the body: styling, hover title wording (045 FR-168), Ctrl and click handling, and destination resolution. Shorthand `#123` references MUST be linked only where the body resolves them.
- **FR-091**: Sanitisation (044 FR-081) MUST apply to every link, with no scheme allowed beyond those body links allow.
- **FR-092**: A value with no link MUST render exactly as today, and keys MUST stay plain text.
- **FR-093**: Invalid YAML and non-mapping front matter MUST still render as an unlinked code block.
- **FR-094**: With Show front matter off, nothing MUST change.

#### Total lines readout (#545)

- **FR-095**: The editor status bar's counts group MUST show a total-lines readout beside characters and words, reading `9,000 lines`, digit-grouped through the existing formatter (040 FR-027).
  *Wording superseded by FR-125 (Session 2026-11-09).*
- **FR-096**: 040 FR-022a's form table MUST gain the segment: full `lines`, short `lns`.
  *Wording per FR-125: full `440 Lines.`, short `440 Lns.`.* *(derived from the maintainer's feedback and the code; not confirmed by the maintainer)*
- **FR-097**: 040 FR-023's hide order MUST become: total words → total characters → total lines → selected characters → column → line.
- **FR-098**: The readout MUST be governed by the existing counts setting (040 FR-031), with no new setting.
- **FR-099**: The readout MUST be omitted, not shown as zero, until document metrics settle (040 FR-008b), and MUST report `1 line` for an empty document.
  *Wording per FR-125: `1 Line.`*
- **FR-100**: It MUST be announced as `N lines` or `1 line`, and nothing else on the bar MUST change.
  *The spoken form stays `N lines`; FR-125's punctuation is visual.* *(derived from the maintainer's feedback and the code; not confirmed by the maintainer)*

#### Linux old-version removal (#578)

- **FR-101**: Spec 063 MUST gain a numbered requirement: an install removes every older version no process runs from, and a version still running stays until a later package operation finds it unused. Research note D2 MUST cite it.
- **FR-102**: The Linux install documentation MUST say an upgrade while throng runs leaves the previous version until the next throng install, that nothing runs from it once throng has restarted, and that it can be deleted by hand.
- **FR-103**: An automated test MUST show a version running at one install is removed by a later install once nothing runs from it.
- **FR-104**: What the package scripts delete, and when, MUST NOT change.

#### Cross-cutting

- **FR-105**: Every new setting MUST be typed, editable in Preferences and documented in the preferences documentation, and MUST have a reader outside the configuration layer.
- **FR-106**: Every new key binding MUST be listed in the key bindings documentation.
- **FR-107**: One failure condition MUST raise one notice, carrying the actions that resolve it.
- **FR-108**: Every new user-visible control MUST be reachable by keyboard and carry an accessible name.
- **FR-109**: What throng writes to and reads from the OS for file transfer and file-manager registration MUST be proven by automated tests. Behaviour in Windows Explorer, GNOME Files, KDE Dolphin and Nemo, on X11 and Wayland, MUST be proven by a hand-test plan the maintainer signs off before merge.

- **FR-110**: Drags started from a File Explorer row MUST be driven by mouse events rather than web drags, with every outcome of FR-014 kept: a row onto a tree folder, multi-selection, the drop highlight, the drag preview, and a tree drag onto an editor, preview, terminal, empty panel, tab or new-tab area.
- **FR-111**: During such a drag, throng's copy and move modifiers MUST take effect whether pressed before the drag starts or during it, and releasing one MUST take effect at once. With no modifier the drag MUST stay a move.
- **FR-112**: During such a drag inside throng, the real mouse pointer MUST show copy, move or not-allowed to match what a drop would do, on every desktop, updating as a modifier changes. This narrows FR-005a for drags inside throng.
- **FR-113**: Such a drag near the top or bottom edge of the tree MUST scroll the tree, and Esc MUST cancel the drag with nothing changed.
- **FR-114**: A row drag whose pointer leaves the window MUST hand over to a real OS file drag carrying the dragged items, as a copy. The OS decides the pointer from then on. Supersedes FR-005's withdrawal of 2026-11-09.
- **FR-115**: Files dragged in from the OS MUST stay as FR-004 and FR-005a deliver them, and a label beside the pointer MUST name the drop's copy or move for those drags, because throng cannot set the pointer during them. *(derived from the maintainer's feedback and the code; not confirmed by the maintainer)*
- **FR-116**: A preference, on by default, MUST make a double-click on a file throng cannot open open it in the OS default program, or show the OS's own message when the type has no program. It MUST act only on a double-click, whatever the tree's click-to-open setting. Off, throng MUST show its existing "cannot open" message.
  *The OS's own message reaches the user through FR-018's notice, which names the path and carries the OS's reason. throng adds no other.* *(derived from the maintainer's feedback and the code; not confirmed by the maintainer)*
- **FR-117**: "Cannot open" in FR-116 MUST mean the editor's refusal of a binary type, not a too-large file. With the preference on, a single click on such a file MUST raise no notice. *(derived from the maintainer's feedback and the code; not confirmed by the maintainer)*
- **FR-118**: The Save and Save As icons of FR-069 MUST be disk icons, distinguishable from each other, in every shipped theme.
- **FR-119**: The Properties dialog MUST close from an X at its top right and from a click on its scrim, and MUST NOT show a Close button.
- **FR-120**: Every value in the Properties dialog MUST have a copy button beside it that places that value on the clipboard, without digit grouping's separators where the value is a raw count. *(derived from the maintainer's feedback and the code; not confirmed by the maintainer)*
- **FR-121**: The Properties dialog MUST show a single item's access and security details: on Linux its owner, group and permissions in both symbolic and octal form; on Windows its read-only, hidden and system flags, and its owner where obtainable without elevation. A multi-selection MUST omit them. Editing them is out of scope.
- **FR-122**: Where the OS has no properties dialog, the action MUST be absent, with no message.
- **FR-123**: In the front matter table, a Markdown link with a relative target and a bare scalar that is a relative path to a file MUST render as links relative to the document and behave as FR-090 requires.
  *A bare scalar counts as a path when the whole value has no whitespace, is not a URL, and either contains `/` or ends in a dotted extension starting with a letter. The disk is not consulted, as for a link in the body.* *(derived from the maintainer's feedback and the code; not confirmed by the maintainer)*
  *Scope superseded by FR-132 (Session 2026-11-10): the table recognises every link form the editor does, not only relative paths.*
- **FR-124**: Creating a sub-workspace directly MUST put the caret in its name with the default name selected. Typing MUST replace it, Enter MUST commit the name and open the sub-workspace, Esc MUST keep the default and not open it, and clicking away MUST commit without opening. *(derived from the maintainer's feedback and the code; not confirmed by the maintainer)*
- **FR-125**: The editor status bar's sections MUST be punctuated, reading `Ln 10, Col 45`, `440 Lines.`, `8,000 Chars.`, `43 Words.`, digit-grouped. Hide order stays as FR-097.
- **FR-126**: With a selection on one line, the position MUST read `Ln 10, Cols 45-56`.
- **FR-127**: Clicking the resource popup MUST close it, and MUST NOT open the Resource Monitor. Only clicking the status bar item opens it. Amends 055 FR-115.

- **FR-128**: Properties MUST be the last item of the File Explorer context menu, for files and folders alike. Refines FR-045.
- **FR-129**: In the Startup Command and Shell Arguments fields, Down arrow MUST show the field's remembered values for the selected terminal type: all of them when the field is empty, the matches otherwise. Down MUST then move through the list and Esc MUST close it. Refines FR-062. *(derived from the maintainer's feedback and the code; not confirmed by the maintainer)*
- **FR-130**: The control that clears the terminal form history MUST sit in Preferences' Terminal section, beside the two form-history settings. Refines FR-064b and FR-066.
- **FR-131**: With FR-116's preference on, Ctrl+click on a link to a file throng cannot open (FR-117's meaning) MUST open it as a File Explorer double-click does: in the OS default program, or with the OS's own message. Off, throng MUST show its existing "cannot open" message. It MUST apply wherever a file link is followed (editor, preview body and front matter, terminal). A file outside every project, and one whose default open action is its preview, MUST keep today's behaviour. Extends FR-116. *(derived from the maintainer's feedback and the code; not confirmed by the maintainer)*
- **FR-132**: In the front matter table, a scalar value that is wholly a link the editor recognises MUST render as a link and follow as the editor follows it: relative paths (including ones with spaces), project-rooted, home-relative and absolute paths, `file:` URIs, `:line`, `:line:column`, `:line-range` and `(line,col)` positions, same-document `#anchor` headings, and the protocols on the protocol allowlist (045 FR-159). Supersedes the scope of FR-123, and amends FR-090 for the front matter table only. The body preview MUST be unchanged.
  *A value with whitespace counts as a path only when it starts with `./`, `../`, `/`, `~/` or a drive letter and ends in a dotted extension, optionally followed by a position. A sentence with a path inside it stays text.* *(derived from the maintainer's feedback and the code; not confirmed by the maintainer)*
- **FR-133**: In the Startup Command and Shell Arguments remembered-values list, Delete on the highlighted value MUST remove that one value from that field's list for the selected terminal type, durably (FR-068), and every open form MUST stop offering it. The list MUST stay open with the highlight on the next value, or the previous when the last was removed, and close when it empties. Delete with nothing highlighted MUST edit the field as usual, and the field's text MUST NOT change. Refines FR-067.
  *Everything after "for the selected terminal type" is derived from the maintainer's feedback and the code; not confirmed by the maintainer.*
- **FR-134**: The editor status bar's column readout and selected readout MUST each end in a full stop: `Ln 10, Col 45.`, `Cols 9-15. 2 selected. 25 Lines.`. The short form of selected MUST read `2 sel.`, and when the fit hides the column the line MUST end in a full stop (`Ln 10.`). Digit grouping is unchanged. Refines FR-125 and FR-126.
  *The short form and the hidden-column case are derived; not confirmed by the maintainer.*
- **FR-135**: A Startup Command or Shell Arguments field with remembered values MUST show its whole list for the selected terminal type when the field is focused or clicked, whatever it holds, and typing MUST narrow the list to the matches. Picking a value MUST replace the field's text. Down MUST still open the list, and Esc MUST close it until the field is next focused or clicked. Supersedes FR-129's "only on Down" and FR-062's "on typing".
  *Down, Esc and "whatever it holds" are derived from the maintainer's feedback and the code; not confirmed by the maintainer.*
- **FR-136**: With a selection spanning lines, the editor status bar MUST read the line as the range of the selection's first and last lines and the column as the column where the selection starts: `Ln 3-5, Col 4.`, whichever end holds the caret. A selection ending at column 1 of a line MUST NOT count that line. Spoken as `lines 3 to 5`. Extends FR-126.
  *The column-1 rule and the spoken form are derived; not confirmed by the maintainer.*

### Key Entities

- **File transfer intent**: a list of absolute paths with a copy or cut intent, read from or written to the OS.
- **Open-folder request**: an absolute folder path resolved at launch, carried to a new or running instance.
- **File-manager registration**: the record that the Open as throng project item exists on this machine, with its scope.
- **Shutdown task**: one step of closing, with a summary, expected duration and state (pending, current, done, cancelled).
- **Item properties**: name, path, type, link target, size, counts, attributes, timestamps and skipped count for a file, folder or selection.
- **Side-pane state**: expanded or collapsed for each of the two panes, held per project.
- **Form history list**: ordered distinct values, keyed by terminal type and field.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user can transfer files in both directions, by paste and by drag, on Windows and on Linux.
- **SC-002**: Every inbound paste or drop is undoable in one action.
- **SC-003**: From a right-click in the File Explorer, a file opens in its registered program in two selections.
- **SC-004**: A folder opens as a project from a shell in one command, in under 5 seconds with throng already running.
- **SC-005**: A user can leave a shutdown at any moment, and Cancel returns control within 6 seconds in 100% of runs, including with a task that never completes.
- **SC-006**: The Properties view appears within 200 ms of being requested.
- **SC-007**: On a folder of 100,000 entries, total size completes within 15 seconds on a solid-state disk, and no input waits more than 100 ms while it runs.
- **SC-008**: Switching projects restores both panes with no user action in 100% of switches.
- **SC-009**: A repeated startup command is entered in at most 3 keystrokes plus a selection.
- **SC-010**: An editor can be saved in one click, and a tab renamed with no mouse use.
- **SC-011**: A sub-workspace can be created in one click, with no existing panel consumed.
- **SC-012**: Every link form usable in a Markdown body is followable from the front matter table, identically.
- **SC-013**: Typing latency in an editor is unchanged by the total-lines readout, measured on a 100,000-line document.
- **SC-014**: On each desktop run, every drag inside throng shows the pointer matching what its drop does, with the modifier pressed before or during the drag.
- **SC-015**: Every front matter value in the maintainer's link-types document (`link-types.md`, MT-14) that the editor links is a link in the preview's table, and goes to the same destination.

## Assumptions

- The maintainer's 2026-11-08 direction to specify all thirteen issues constitutes agreement for those whose agreement box is unticked.
- Open in OS Default Program is offered for every file rather than a fixed type list, since #606 requires it to work for files with no preview.
- GNOME Files, KDE Dolphin and Nemo are the common Linux file managers for FR-033.
- Properties on a multi-selection shows combined figures rather than being disabled.
- A "recent" size result is one under 60 seconds old.
- The OS Properties dialog has no cross-desktop Linux equivalent, so it is reported absent there.
- macOS, WSL paths, opening files (rather than folders) from the OS, file-type associations, an Open With chooser and pane widths per project are out of scope.
- Progress UI for very large file transfers beyond the notice model is out of scope (#8).
- Code signing (#118) is unresolved, and nothing in this feature waits for it (FR-030).
