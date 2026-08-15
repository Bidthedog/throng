# Feature Specification: Open and navigate — Quick Open, Go To Line, and menus you can read

**Feature Branch**: `feature/S033-I219-open-and-navigate`

**Created**: 2026-08-15

**Status**: Draft

**Input**: User description: "Do set B, create a spec for this from the issues. Also include the 'Go to line' feature."

**Issues**: [#219](https://github.com/Bidthedog/throng/issues/219) (Quick Open), [#234](https://github.com/Bidthedog/throng/issues/234) (Go To Line), [#88](https://github.com/Bidthedog/throng/issues/88) (Open In → Terminal from the tree), [#185](https://github.com/Bidthedog/throng/issues/185) (Collapse/Expand All Children), [#160](https://github.com/Bidthedog/throng/issues/160) (context-menu section groups), [#244](https://github.com/Bidthedog/throng/issues/244) (adopted 2026-08-15 — the menu-keyboard guard that guards nothing)

## Why these six together

Every one of them answers the same question — **"how do I get to the thing I am looking at, or
thinking about, without walking there?"** Today the answer is always the same walk: expand folders
until the file appears, scroll until line 412 goes past, add a terminal panel and `cd` back to where
you already were, click every chevron in a branch you wanted opened, and read an undifferentiated
list of menu items to find the one you want.

Three of the six put **new items into context menus**, and #160 is the rule for where those items
go. Shipping #88 and #185 without #160 would add three more entries to menus that already grow
without a vocabulary — the panel header menu is eleven items with no divider anywhere in it. So
#160 is not a cosmetic tail on this feature; it is the constraint the other menu work is written
against, and it is stated here once (FR-047 – FR-050) rather than re-decided per menu.

**Quick Open is here because its blocker cleared.** #219 says in its own text that it depends on the
picker from #225, and deliberately so: the picker was built as a general list-and-choose control
precisely so this feature could seed it with files rather than fork it. #225 shipped in spec 031, so
`Picker` and the `matches` / `matchSpans` rules exist and are unit-tested. What is left for Quick
Open is **seeding and routing** — enumerate the project's files, bind a chord, and send the chosen
entry through the open route that already exists.

**Go To Line is here because it is Quick Open's twin.** Both are a modal over whatever the user was
doing, both take a short typed input, both must return focus exactly where they found it, and both
are reached by a chord that must not be eaten by a terminal. Specifying them apart would produce two
modal idioms in one release.

**#244 was adopted on 2026-08-15**, during a branch sync, because US5 lands squarely on top of it.
`menu-keyboard.e2e.ts` guards its keystrokes by polling for a clicked tree row to hold DOM focus —
but react-arborist keeps focus on the tree *container*, whose text content concatenates every row, so
the predicate is satisfied from the first sample whether or not focus moved, and stays satisfied if
the click is deleted outright. It cannot fail, while reading as protection: it was copied as
precedent into #239 and PR #242, where the spec it was meant to stabilise failed anyway. US5
restructures every context menu and requires keyboard navigation to skip dividers (FR-051), which is
asserted in exactly these tests — so this feature either fixes the guard or builds new assertions on
top of one known to be vacuous.

**Deliberately not here**: #153 (global find & replace over file *contents*) and #220 (the per-editor
find bar's UX pass). Those two are about *searching text*; this feature is about *reaching a target*.
#219's own comment thread proposes bundling all three, and that remains a reasonable next cycle —
but #220 settles a **visual language for search controls**, which is a different decision from the
one this feature makes, and folding it in would double the size of a cycle that is already six
issues.

---

## Clarifications

### Session 2026-08-15

- Q: With a 200-row cap and a picker that does not rank, seed order decides whether the wanted file is even on screen in a 50,000-file project. How should Quick Open's matches be ordered? → A: **Extend the shared control with a ranking hook.** Quick Open ranks by match quality — a hit in the file's name outranks one in the directory part, and an earlier hit outranks a later one. The tab picker passes no ranker and keeps its strip order, unchanged. Ranking MUST be stable for a given query so the list never reorders under the arrow keys.
- Q: How is Quick Open's "this editor / new editor" target choice presented, given the shared picker is a title, an input and a list? → A: **A two-option control at the TOP of the modal, above the typeahead input.** Its options are the **currently active editor** and **a new editor panel in this tab**, preselected from the "Open files in" preference. The typeahead input holds focus on open; **Shift+Tab** moves to the control, where **Space or Enter changes the value**. Opening is always **Enter with a file highlighted in the list** — Enter on the control never opens a file. *(Mechanism corrected 2026-08-15: this said the control is "last in the tab order". It renders above the input and is therefore **first**, which is why Shift+Tab reaches it. Same keystroke, same result, opposite mechanism — see FR-010a.)*
- Q: What happens when Go To Line is invoked while a find bar is open in the same editor? → A: **The find bar stays open and simply loses focus.** It keeps its query, match count and highlights; the Go To Line modal opens on top and takes focus, and dismissing or confirming it returns focus to the editor rather than to the find bar. **A find bar closes only when the user closes it or its editor closes** — nothing else, this feature included, may close it.
- Q: Quick Open is chord-only and discoverable nowhere but the Key Bindings editor. Should it have a visible route? → A: **A Files & Folders toolbar button**, beside the existing Expand / Collapse all controls, tooltipped with its current chord. It sits next to the tree it searches. The cost is accepted and recorded: the pane is hideable, so with Files & Folders closed the chord is again the only route.
- Q: Planning found three places where this spec contradicts itself or the shipped code. How are they resolved? → A: **All three in favour of FR-047 and the constitution, with the losing text marked superseded rather than deleted.** (1) FR-052's cog row demanded a divider inside a single section, which FR-050 forbids — the cog menu takes **no** divider. (2) FR-052 listed Destroy last for two menus while FR-047 fixes it third; its third column is an **inventory of sections, not an ordering**, and FR-047 remains the only statement of order. (3) SC-011 could not hold literally, because `context-menu-sections.e2e.ts:49` asserts a folder's Open In holds exactly one item and US3 adds a second by design — that one assertion is named as the sole permitted change, so any other edit to an existing menu spec is a defect rather than a licence.
- Q: The terminal's link items sit above Copy/Paste, which the Content-first vocabulary would forbid. Keep an exception, drop it, or reorder the vocabulary? → A: **Keep the "Contextual" section, leading the menu.** An item qualifies only if it would be **absent were the pointer elsewhere** — that is the test, not "it feels contextual". Demoting the link items was rejected as a behaviour regression shipped under a grouping pass, and reordering the vocabulary was rejected because it would re-order the one menu already grouped.
- Q: What does each modal's input contain when it opens for the second time? → A: **Empty, in both — plus two new preferences that make each one remember, off by default.** The shipped behaviour is an empty box every time. Two toggles under a new **Editor · Navigation** group, `editor.navigation.rememberQuickOpenQuery` and `editor.navigation.rememberGotoLineNumber`, both defaulting to **off**, let a user opt into the modal reopening with the last value it accepted, fully selected so typing replaces it.
- Q: Where does keyboard focus land after Open In → Terminal → flavour launches a terminal? → A: **In the new terminal.** The panel is created in the active tab by the same sequence "Open In → New Editor" already uses — added, typed immediately, not opened in rename mode, made the active panel — and it additionally takes DOM focus, so the user can type a command without a further click. The action's whole purpose is a shell here, and the next act is always typing.
- Q: Three requirements said an inapplicable control is "absent or disabled". Which is it? → A: **Two situations, two answers.** *Temporarily unavailable* — no project is open — means **shown and disabled**, keeping the explorer menu's shipped rule that an action which exists and is unavailable teaches what the menu can do while one that vanishes teaches nothing. *Structurally meaningless* — Expand/Collapse All Children on a **file**, which can never have children — means **not drawn at all**, so no file's menu carries two permanently dead rows.

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Open any file by typing its name (Priority: P1)

A user knows the file they want. Today the only routes are to expand the Files & Folders tree until
it appears, or to drag it onto a panel — both of which require knowing *where* it is, not just what
it is called.

After this story, pressing a chord from anywhere in the app — an editor, a terminal, the tree —
opens a centred modal with a focused text box. Typing narrows a list of the project's files, each
row showing its full path so two files with the same name are told apart. Up/Down moves, Enter or a
click opens, Escape closes and puts focus back where it was.

**Why this priority**: It is one of three headline v1.0.0 items still open, it is the single largest
saving in daily use, and it stands entirely on its own — no other story here is a prerequisite.

**Independent Test**: Open a project with nested folders, press the chord from a terminal panel,
type part of a path, and confirm the file opens in an editor. Nothing from US2–US5 is involved.

**Acceptance Scenarios**:

1. **Given** a project is open and a terminal panel has focus, **When** the user presses the Quick
   Open chord, **Then** a centred modal appears with a focused, empty text input, and the terminal
   receives no keystroke.
2. **Given** the Quick Open modal is open, **When** the user types characters that appear in several
   files' paths, **Then** every matching file is listed, each row showing the file's full path
   relative to the project root, and the matched runs are marked.
3. **Given** a list of matches, **When** the user presses Down twice and Enter, **Then** the third
   listed file opens in an editor and the modal closes.
4. **Given** a list of matches, **When** the user clicks a row, **Then** that file opens and the
   modal closes.
5. **Given** the modal is open with a query typed, **When** the user presses Escape, **Then** the
   modal closes, no file is opened, and focus returns to the panel the user came from.
6. **Given** a query that matches nothing, **When** the user looks at the modal, **Then** it stays
   open and says so, so a typo is corrected with a backspace rather than a re-open.
7. **Given** the "Open files in" preference is *Last Active Editor*, **When** a file is chosen,
   **Then** it lands in the active tab's last active editor, and a tab with no editor gets one
   created.
8. **Given** the "Open files in" preference is *New Editor*, **When** a file is chosen, **Then** it
   opens in a new editor panel.
9. **Given** the chosen file is already open in some editor, **When** it is chosen, **Then** that
   editor is focused rather than a second copy of the file being opened.
10. **Given** the target editor holds unsaved changes, **When** a file is chosen for it, **Then** the
    existing unsaved-changes prompt appears, and Cancel leaves the buffer untouched.
11. **Given** the modal is opened from inside an editor panel, **When** the user looks at it, **Then**
    a two-option target control sits above the input, offering the currently active editor and a new
    editor panel in this tab, preselected from the "Open files in" preference.
11a. **Given** that modal has just opened, **When** the user types, **Then** the characters go to the
    typeahead input — focus never starts on the target control.
11b. **Given** that modal is open, **When** the user presses Shift+Tab and then Space, **Then** the
    target control takes focus and its value changes, and no file is opened.
11c. **Given** the target control holds focus, **When** the user presses Enter, **Then** the control's
    value changes and no file is opened.
12. **Given** a project containing a folder the explorer excludes, **When** the user types a query
    matching a file inside it, **Then** no such file is listed.
13. **Given** a second project is also open, **When** the user types a query matching a file in that
    other project, **Then** no file outside the current project's root is listed.
14. **Given** a query that matches one file by its name and another only by a folder in its path,
    **When** the list is drawn, **Then** the name match is listed above the path-only match.
15. **Given** a drawn list of matches, **When** the user arrows up and down without typing, **Then**
    the rows keep the order they were drawn in.
16. **Given** the Files & Folders pane is showing, **When** the user looks at its toolbar, **Then** a
    Quick Open button is present, its tooltip names the command's current chord, and clicking it
    opens the same modal the chord opens.
17. **Given** the Quick Open chord has been rebound in Preferences, **When** the user hovers that
    toolbar button, **Then** the tooltip names the **new** chord.
18. **Given** a file has been opened via Quick Open and the remember setting is at its default,
    **When** the user opens Quick Open again, **Then** the input is empty and no results are listed.
19. **Given** `editor.navigation.rememberQuickOpenQuery` is on and a file was opened via Quick Open,
    **When** the user opens Quick Open again, **Then** the previous query is present and fully
    selected, its results are listed, and typing replaces the query outright.
20. **Given** that setting is on and a query was typed but abandoned with Escape, **When** the user
    opens Quick Open again, **Then** the input is empty — only an accepted query is remembered.
21. **Given** that setting is on and a query is remembered, **When** the user switches to another
    project and opens Quick Open, **Then** the input is empty.

---

### User Story 2 - Jump to a line number (Priority: P2)

A stack trace, a compiler error and a review comment all say "line 412". Today the only way to act
on that is to scroll and watch the gutter.

After this story, pressing a chord with an editor focused opens a small modal asking for a line
number. Entering one scrolls it into view and puts the caret at the start of it. The number typed is
the number the **gutter** shows.

**Why this priority**: It is small, self-contained, and arrives with the user's muscle memory from
every editor they have used. It is second only because Quick Open saves more time per day.

**Independent Test**: Open a file of more than a screen's length, press the chord, type a line
number, and confirm the gutter shows that number beside the caret's line.

**Acceptance Scenarios**:

1. **Given** an editor panel has focus, **When** the user presses the Go To Line chord, **Then** a
   modal opens with the caret already in its input.
2. **Given** the modal is open, **When** the user types a line number that exists and presses Enter,
   **Then** that line scrolls into view, the caret sits at its first column, the modal closes, and
   focus returns to the editor.
3. **Given** the line reached, **When** the gutter is read beside the caret, **Then** it shows the
   number the user typed.
4. **Given** a document of N lines, **When** the user enters a number greater than N, **Then** the
   caret lands at the start of the last line, with no error notice.
5. **Given** any document, **When** the user enters `0` or a negative number, **Then** the caret
   lands at the start of the first line, with no error notice.
6. **Given** the modal is open, **When** the user presses Escape, **Then** it closes with the caret,
   the selection and the scroll position exactly as they were.
7. **Given** the modal is open, **When** the user submits an empty or non-numeric value, **Then**
   nothing moves and nothing changes.
8. **Given** a terminal panel has focus, **When** the user presses the Go To Line chord, **Then** no
   modal opens and the terminal receives the keystroke as it would without this feature.
9. **Given** no panel is active, **When** the user presses the chord, **Then** nothing happens.
10. **Given** the Preferences → Key Bindings editor, **When** the user looks for the Go To Line
    action, **Then** it is listed, shows its chord, and can be rebound — after which the new chord
    works and the old one does not.
11. **Given** an editor's content menu, **When** the user opens it, **Then** Go To Line appears as an
    item showing its current chord.
12. **Given** a find bar is open in the editor with a query and a match count, **When** the user opens
    Go To Line, jumps to a line, and the modal closes, **Then** the find bar is still open with the
    same query, the same match count and the same highlights, and focus is in the editor.
13. **Given** the user has gone to a line and the remember setting is at its default, **When** they
    open Go To Line again, **Then** its input is empty.
14. **Given** `editor.navigation.rememberGotoLineNumber` is on and the user has gone to line 412,
    **When** they open Go To Line again, **Then** `412` is present and fully selected, and typing a
    new number replaces it outright.
15. **Given** either remember setting is on with a value held, **When** the user turns that setting
    off and opens the modal, **Then** the input is empty.

---

### User Story 3 - Open a terminal where you are looking (Priority: P3)

The tree can open a file in an editor and a folder in the OS file manager, but it cannot put a shell
where the user is pointing. The only route today is to add a terminal panel and `cd` by hand — the
exact manual navigation the explorer exists to remove.

After this story, right-clicking any folder or file offers, under the existing **Open In** submenu,
a **Terminal** submenu listing the same shell flavours the panel type-picker offers. Choosing one
opens a new terminal panel started in that folder — or, for a file, in its parent folder.

**Why this priority**: High value and reachable in one action, but it needs a running project and a
detected shell, so it is a larger surface than US2 and depends on the flavour catalogue.

**Independent Test**: Right-click a nested folder, choose Open In → Terminal → any flavour, and
confirm the new terminal's prompt is in that folder.

**Acceptance Scenarios**:

1. **Given** a project is open, **When** the user right-clicks a folder in Files & Folders, **Then**
   "Open In" contains a "Terminal" submenu listing every enabled flavour, matching the panel
   type-picker's list.
2. **Given** the Terminal submenu, **When** the user chooses a flavour, **Then** a new terminal panel
   opens in the active tab, becomes the active panel, and its shell's working directory is the
   right-clicked folder.
2a. **Given** that terminal has just opened, **When** the user types without clicking anything,
   **Then** the characters reach the shell — the new terminal holds keyboard focus, and the panel did
   not open in rename mode.
3. **Given** a **file** is right-clicked, **When** the user chooses a flavour, **Then** the terminal
   starts in that file's parent folder.
4. **Given** the user has added a custom flavour in settings, **When** the submenu is opened, **Then**
   the custom flavour appears without any further configuration; a disabled built-in does not appear.
5. **Given** any folder in the tree, **When** a terminal is launched for it, **Then** the start
   directory is confined to the active project's root, and a path that resolves outside the root is
   refused rather than launched.
6. **Given** no project is open, **When** a context menu is available at all, **Then** the Terminal
   submenu is present and disabled.
7. **Given** the three-level path Open In → Terminal → flavour, **When** the user traverses it with
   the mouse, **Then** no intermediate submenu collapses before the flavour can be clicked.
8. **Given** the same three-level path, **When** the user traverses it with the arrow keys, **Then**
   each level opens and Enter on a flavour launches the terminal.

---

### User Story 4 - Tidy one branch of the tree (Priority: P4)

Expand and Collapse act on the whole tree. A user who has drilled into a deep folder and wants to
close just that branch has to collapse everything and navigate back; one who wants a folder opened
out has to click every child chevron.

After this story, a folder's context menu offers **Collapse All Children** — which closes everything
inside it while leaving the folder itself open — and **Expand All Children**, which opens the
folder's immediate child folders, one level, loading them as an ordinary chevron click would.

**Why this priority**: A genuine irritation, but a smaller one than the three above, and it changes
no route the user does not already have.

**Independent Test**: Expand a folder three levels deep, right-click the top folder, choose Collapse
All Children, and confirm the folder is still open with everything beneath it closed.

**Acceptance Scenarios**:

1. **Given** a **folder** is right-clicked, **When** the menu opens, **Then** it offers "Collapse All
   Children" and "Expand All Children".
2. **Given** a **file** is right-clicked, **When** the menu opens, **Then** neither item appears in
   it at all — not as a disabled row.
3. **Given** a folder with expanded descendants at several depths, **When** the user chooses Collapse
   All Children, **Then** every descendant is collapsed at every depth.
4. **Given** the same action, **When** it completes, **Then** the right-clicked folder is still open.
5. **Given** a folder with nothing expanded beneath it, **When** the user chooses Collapse All
   Children, **Then** nothing changes and no error is raised.
6. **Given** a folder whose immediate children include folders and files, **When** the user chooses
   Expand All Children, **Then** every immediate child folder is open and no grandchild folder is.
7. **Given** a **closed** folder, **When** the user chooses Expand All Children, **Then** the folder
   itself opens first and then its immediate children.
8. **Given** any folder expanded by either action, **When** it is inspected, **Then** its children are
   loaded — no folder renders as spuriously empty.
9. **Given** an excluded folder among the children, **When** Expand All Children runs, **Then** that
   folder is not expanded into.
10. **Given** either action has run, **When** the user switches project and returns, or restarts the
    app, **Then** the resulting open state is restored exactly as a manual expand/collapse would be.
11. **Given** either action has run, **When** the toolbar's existing Expand and Collapse all are used,
    **Then** they behave exactly as they did before this feature.

---

### User Story 5 - Menus with sections you can read (Priority: P5)

A context menu is the surface a user browses to learn what a thing can do — and by the constitution
it is the **canonical index** of a panel's actions, not one route among several. The Files & Folders
menu is grouped; the rest are not. The panel header menu offers eleven items in one undivided run,
so "Save" sits between "Zoom" and "Revert" with nothing to say they are different kinds of thing.
This feature adds three more items to menus, which makes the gap worse before it makes it better.

After this story every context menu in the app draws its items in the same named sections, in the
same order, separated by dividers — so a user who has learned where Delete lives in one menu knows
where to look in the next.

**Why this priority**: It is the smallest visible change here and the only one that adds no new
capability — but it is the rule the other menu work is written against, so it is specified with the
feature rather than after it.

**Independent Test**: Open each of the app's context menus in turn and confirm its items fall into
the declared sections, in the declared order, with dividers between them.

**Acceptance Scenarios**:

1. **Given** any context menu with items from more than one section, **When** it is opened, **Then**
   a divider appears between each pair of adjacent sections and nowhere else.
2. **Given** the editor's content menu, **When** it is opened, **Then** its clipboard and history
   items, its navigation item and its state toggles are in three separated sections in the declared
   order.
3. **Given** a panel's header menu, **When** it is opened, **Then** its items are sectioned, and the
   destructive item is in a section of its own.
4. **Given** a tab's context menu, **When** it is opened, **Then** its destructive items are separated
   from the rest.
5. **Given** the cog menu, **When** it is opened, **Then** it draws as **one undivided Application
   section** — Settings, Key Bindings, Themes, Open Logs Folder and About, with no divider anywhere
   in it. *(Corrected 2026-08-15: this scenario previously required the preferences trio to be
   separated from the diagnostic and About items. All five are `Application` under FR-047 and the
   constitution, and FR-050 permits a divider only at a section boundary — so the separation it
   asked for was forbidden by both rules it sits between. Superseded when FR-052 was corrected; the
   scenario was missed in that pass, which left a test written from here contradicting a test
   written from FR-052.)*
6. **Given** a menu whose items happen to fall in a single section, **When** it is opened, **Then** it
   contains no divider — a section boundary is drawn only where a boundary exists.
7. **Given** a menu carrying contextual items — those present only because of what the pointer is
   over, such as the terminal's link actions — **When** it is opened, **Then** those items lead the
   menu, separated from the rest.
8. **Given** any menu, **When** a user navigates it with the arrow keys, **Then** dividers are skipped
   and never take focus.
9. **Given** the menu-keyboard test guard named by #244, **When** its precondition is removed — the
   triggering click deleted, or the awaited state never reached — **Then** the guard fails. It cannot
   pass regardless, as the shipped one does.

---

### Edge Cases

- **A very large project.** A tree of tens of thousands of files must not stall the input while the
  user types, and must not render tens of thousands of rows. The candidate set is prepared ahead of
  the keystroke, and the rendered list is capped (FR-014, FR-015).
- **Files appearing and disappearing while the app runs.** A file created, deleted or renamed by a
  terminal, an agent or another program must be reflected in Quick Open's candidates without a
  restart (FR-016).
- **Quick Open with no project open.** The chord does not open the modal at all, and the toolbar
  button is drawn disabled (FR-018, FR-018c). *(Corrected 2026-08-15: this was written as an
  either/or, which is the exact untestable shape clarification Q9 was raised to remove — and FR-018
  had already settled it.)*
- **Quick Open in a sub-workspace window.** The window has its own root; the candidate set is that
  window's root, never the main window's (FR-017).
- **Go To Line on an empty document.** Any number resolves to line 1, which is also the last line.
- **Go To Line and word wrap.** A wrapped logical line occupies several visual rows; the number the
  user types is the number the gutter draws, which counts logical lines (FR-021).
- **Go To Line while a find bar is open in the same editor.** The find bar stays open and intact and
  only loses focus; it closes when the user closes it or the editor closes, never as a side effect of
  this feature (FR-026, FR-026a).
- **A terminal launched at a folder that is deleted between the right-click and the launch.** The
  existing start-directory fallback applies — the terminal starts at the project root and says why,
  rather than failing to start (FR-034).
- **Expand All Children on a folder with many immediate children.** One level only, by design
  (FR-041) — which is the whole of the answer. *(Corrected 2026-08-15: this previously added "must
  complete without the tree appearing to hang", a performance claim with no requirement, no
  threshold and no task behind it. The one-level rule exists precisely so there is no unbounded work
  to bound; inventing an unmeasured second promise beside it is how an untestable clause survives to
  review.)*
- **Collapse All Children on the project root.** The root stays open — it is the tree.
- **A menu whose items are all in one section.** No divider is drawn (FR-050).

## Requirements *(mandatory)*

### Quick Open (US1)

- **FR-001**: The app MUST provide a **Quick Open** command that opens a modal, centred in the
  window, over whatever the user was doing, from any focus context — an editor, a terminal, the file
  tree, or no panel at all.
- **FR-002**: The command MUST be bound by default to `Ctrl+Shift+T`, MUST be listed in the Key
  Bindings editor, and MUST be rebindable there.
- **FR-003**: The command MUST be **window-scoped**: it reaches the application from a focused
  terminal panel, and it MUST NOT be implemented with a terminal-specific special case. `Ctrl+Shift+T`
  is not in the reserved terminal tier (`Ctrl+C/D/Z/A/E/W/U/K/R/L/Q`), is not in the shadowable list,
  and is claimed by no hosted flavour's line editor, so it is takeable without a recorded exception.
- **FR-004**: The modal MUST use the **shared picker control** delivered by spec 031, inheriting its
  filtering, highlight movement, choose, dismiss and no-match behaviour. A second list widget MUST
  NOT be introduced. Where the shared control needs extending to serve files, the shared control is
  extended.
- **FR-005**: The candidate set MUST be the **files** of the **current project only** — never a file
  outside the project root, and never another project's file.
- **FR-006**: The candidate set MUST honour the exclusion rules the explorer applies, so files the
  user has excluded from the project's view are not offered.
- **FR-007**: Each row MUST show the file's **full path** within the project, so two files with the
  same name are distinguishable, and matching MUST run against that full path so a query may name a
  directory the row does not lead with.
- **FR-007a**: Matches MUST be **ranked by match quality**, not returned in the order they were
  enumerated: a query hit in the file's **name** outranks a hit only in the directory part of its
  path, and an earlier hit outranks a later one. Ranking MUST be delivered by **extending the shared
  picker control with an optional ranking hook**, not by Quick Open sorting a list the control then
  re-orders. A caller that supplies no ranker — the tab picker — MUST keep the order it seeds, so
  spec 031's rule that the tab list follows strip order is unchanged. Entries the ranking cannot
  separate MUST fall back to the order they were seeded in, so the outcome is deterministic rather
  than dependent on a sort's stability.
- **FR-007b**: The ranking MUST be **stable for a given query**: the order of the visible rows may
  change only when the query changes, never while the user is arrowing through an unchanged result
  set. This is what spec 031's "the picker does not rank" rule exists to protect — a list that
  reorders under the highlight is unusable — and ranking is compatible with it only under this
  constraint.
- **FR-008**: Choosing a file MUST open it through the **existing open-file route** — the same route
  the tree's "Open In → Last Active Editor" uses — inheriting every check it makes: the one-buffer
  rule, the unsaved-changes prompt, and creating a tab's editor when it has none.
- **FR-009**: The default target MUST honour the existing **"Open files in"** preference, so Quick
  Open lands a file exactly where a tree click would.
- **FR-010**: When Quick Open is invoked **from inside an editor panel**, the modal MUST show a
  two-option target control **above the typeahead input**, at the top of the modal. Its options are
  the **currently active editor** and **a new editor panel in the current tab**, and it MUST be
  preselected from the "Open files in" preference. Choosing the currently active editor MUST perform
  the same action as the Last-Active-Editor route, not a parallel implementation of it.
- **FR-010a**: Focus MUST land in the **typeahead input** when the modal opens, so a user who wants
  the default target types immediately and never meets the control. **Shift+Tab** MUST move focus to
  the target control — it renders above the input and is therefore **first** in the modal's tab
  order, so a backwards step from the input reaches it — and **Space or Enter** MUST change its value
  while it holds focus. *(Corrected 2026-08-15: this said "last in the tab order". The observable
  behaviour is identical, but the mechanism is the opposite one, and an implementer following the
  old wording would add a `tabindex` that divorces reading order from tab order — which the contract
  forbids.)*
- **FR-010b**: A file MUST be opened only by **Enter with a row highlighted in the list**. Enter while
  the target control holds focus changes that control's value and MUST NOT open anything, so the two
  meanings of Enter are decided by where focus is and never by inference.
- **FR-011**: The target control MUST NOT be shown when Quick Open is invoked from anywhere other than
  an editor panel — there is no "currently active editor" to mean. With the control absent, the
  chosen file lands per the "Open files in" preference (FR-009).
- **FR-012**: Escape MUST close the modal, open nothing, and return focus to the surface the user came
  from — this feature's instance of the shared modal rule stated once in FR-065.
- **FR-013**: The candidate set MUST be prepared **before** the user types, so no keystroke triggers a
  filesystem walk. Typing MUST stay responsive on a project of at least **50,000** files.
- **FR-014**: The rendered result list MUST be capped at **200** rows. When matches exceed the cap,
  the modal MUST say that the list is truncated, so an absent file is never mistaken for a
  non-existent one.
- **FR-015**: Preparing the candidate set MUST NOT block the user interface — the app remains usable
  while a large project is being enumerated, and Quick Open opened before enumeration finishes says
  so rather than showing an incomplete list as if it were complete.
- **FR-016**: The candidate set MUST reflect files created, deleted, renamed or moved while the app is
  running — by any actor, including a terminal or an external program — without requiring a restart.
- **FR-017**: In a sub-workspace window, the candidate set MUST be that window's own root.
- **FR-018**: With no project open, the Quick Open command MUST NOT open the modal at all — matching
  its disabled toolbar button (FR-018c). It MUST never present a list of files from a previous
  project.
- **FR-018a**: The Files & Folders toolbar MUST carry a **Quick Open** button, beside its existing
  Expand and Collapse all controls, opening the same modal the chord opens. Its tooltip MUST name the
  command's **current** chord, so a rebound chord is reflected there.
- **FR-018b**: That button MUST draw its icon from a **theme icon token**, adding one to the icon
  registry if no existing token fits. A hard-coded glyph is prohibited by the themeable-icon-control
  rule.
- **FR-018c**: With no project open the button MUST be **shown and disabled**, not hidden — it is
  temporarily unavailable, not meaningless, and the explorer menu's shipped rule is that an action
  which exists and is unavailable teaches what the surface can do.

### Go To Line (US2)

- **FR-019**: The app MUST provide a **Go To Line** command that opens a modal asking for a line
  number, with focus in its input.
- **FR-020**: The command MUST be bound by default to `Ctrl+G`, MUST appear in the Key Bindings
  editor, and MUST be rebindable there. `Ctrl+G` is not in the reserved terminal tier and no shipped
  binding holds it.
- **FR-021**: Confirming a line number that exists MUST scroll that line into view and place the caret
  at its **first column**. The line reached MUST be the line whose number the **gutter** displays.
- **FR-022**: A number greater than the document's line count MUST resolve to the **last** line; `0`
  and negative numbers MUST resolve to the **first** line. Both MUST place the caret at the start of
  that line and MUST NOT raise an error notice.
- **FR-023**: An empty, non-numeric or cancelled input MUST leave the caret, the selection and the
  scroll position unchanged.
- **FR-024**: Escape MUST close the modal without moving anything, and focus MUST return to the editor
  whether the modal was confirmed or cancelled — FR-065's shared rule, with "the editor" naming the
  surface for this modal.
- **FR-025**: The command MUST be **editor-scoped**: with a terminal focused it MUST NOT open, and the
  terminal MUST receive the keystroke exactly as it would without this feature; with no active panel
  it MUST do nothing.
- **FR-026**: Opening Go To Line while a find bar is open in the same editor MUST leave that find bar
  **open and intact** — its query, match count and highlights unchanged — and merely take focus from
  it. Confirming or dismissing Go To Line MUST return focus to the **editor**, not to the find bar.
- **FR-026a**: A find bar MUST close only when the **user closes it** or its **editor closes**.
  Nothing in this feature may close one, and "one transient surface at a time" is explicitly NOT the
  rule: a find session is state the user built and jumping to a line is not a reason to discard it.
- **FR-027**: Go To Line MUST appear as an item on the **editor's content menu**, showing its current
  chord — it is a discrete command acting on a panel's content, which the constitution's "every panel
  action has a menu item" rule requires.
- **FR-028**: The visible affordance MUST be throng's own modal on throng's own binding; no second,
  competing go-to-line surface may be reachable.

### Open In → Terminal (US3)

- **FR-029**: The Files & Folders context menu MUST offer a **Terminal** submenu **nested inside the
  existing "Open In" submenu**, for both folders and files.
- **FR-030**: The Terminal submenu MUST list the terminal flavours from the **same catalogue** the
  panel type-picker uses, so a user-defined flavour appears with no extra wiring and a disabled
  built-in does not appear. A second copy of the flavour list MUST NOT exist.
- **FR-031**: Choosing a flavour MUST open a **new terminal panel** whose start directory is the
  right-clicked **folder**, or, for a file, that file's **parent folder**.
- **FR-032**: The start directory MUST be confined to the active project's root. A path resolving
  outside it MUST be **refused and the project root substituted** — the terminal still launches, at
  the root, exactly as the shipped `resolveStartDirectory` already does for a remembered directory
  that has escaped its project. *(Corrected 2026-08-15: this read "refused rather than launched",
  which asserts that no panel appears. That contradicts both the contract and the shipped fallback,
  and the two readings differ in what a test looks for — a panel that exists at the root, or no panel
  at all.)*
- **FR-033**: The new panel MUST be created by the **same sequence a programmatically opened editor
  already uses** ("Open In → New Editor"): a new panel in the **active tab**, typed immediately with
  its flavour and start directory, **not** opened in rename mode, and made the **active panel**. This
  feature does not redefine panel placement.
- **FR-033a**: The new terminal MUST additionally take **keyboard focus**, so the user can type a
  command without a further click. Focus does not remain in the file tree.
- **FR-034**: A start directory that no longer exists at launch MUST fall back to the project root by
  the existing rule, telling the user what was substituted rather than failing to start.
- **FR-035**: With no active project the Terminal submenu MUST be **shown and disabled**, not hidden
  (the same rule as FR-018c).
- **FR-036**: The three-level path Open In → Terminal → flavour MUST be traversable by mouse without
  an intermediate submenu collapsing, and by keyboard with the arrow keys and Enter.
- **FR-037**: This feature MUST NOT change the flavour catalogue or its configuration UI.

### Expand and collapse a subtree (US4)

- **FR-038**: A **folder's** context menu MUST offer **Collapse All Children** and **Expand All
  Children**. A **file's** context menu MUST NOT draw either item at all: a file can never have
  children, so a disabled row would be permanently dead rather than temporarily unavailable.
- **FR-039**: Collapse All Children MUST collapse every expanded descendant of the folder at every
  depth, and MUST leave the folder **itself open**.
- **FR-040**: Collapse All Children on a folder with no expanded descendants MUST change nothing and
  MUST NOT error.
- **FR-041**: Expand All Children MUST expand the folder's **immediate child folders only** — one
  level, not recursive.
- **FR-042**: Expand All Children on a **closed** folder MUST open that folder first, then its
  immediate children.
- **FR-043**: Every folder opened by either action MUST have its children **loaded**, by the same path
  an ordinary chevron click uses. No folder may be left marked open with unloaded children.
- **FR-044**: Neither action may expand into a folder the project's exclusion rules exclude.
- **FR-045**: The open state resulting from either action MUST persist per project and be restored on
  project switch and app restart, exactly as a manual expand or collapse is.
- **FR-046**: The toolbar's existing Expand and Collapse all MUST be unchanged.

### Menus with sections (US5)

- **FR-047**: The app MUST define **one section vocabulary** for context menus, used by every menu,
  in this fixed order:

  | # | Section | What belongs in it |
  |---|---|---|
  | 0 | **Contextual** | Items present only because of what the pointer is over (a link under the cursor). Lead the menu when present. The test is **"would this item be absent if the pointer were elsewhere?"** — nothing else qualifies. |
  | 1 | **Content** | Acts on the item's content or its name: Rename, Cut, Copy, Paste, Select All, Undo, Redo |
  | 2 | **Create** | Makes something new: New File, New Folder |
  | 3 | **Destroy** | Removes something: Delete, Destroy Tab, Destroy other tabs, Destroy Panel |
  | 4 | **Navigate** | Takes you somewhere, or names where something is: Open In (and its Terminal submenu), Copy Path, Reveal, Expand/Collapse All Children, Go To Line, Sync to |
  | 5 | **View & state** | Toggles and per-surface state: Zoom, Word Wrap, Set Language, Reset Name, Hide in this project |
  | 6 | **Application** | Whole-application destinations: Settings, Key Bindings, Themes, Open Logs Folder, About |

  This table is **additive to the constitution's** (Principle VI, v4.6.0), which is **canonical** for
  the sections and their order. The rows here name a few extra items the constitution's examples do
  not — "Destroy other tabs", "Expand/Collapse All Children", Open In's Terminal submenu — because
  this feature introduces them. Where the two ever disagree about a section or its position, the
  constitution wins and this table is the defect.

- **FR-048**: Every context menu MUST place its items in those sections, in that order, with a divider
  between adjacent sections.
- **FR-049**: A new menu item added by this or any later feature MUST declare which section it belongs
  to — a menu item with no section is a defect, not a default.
- **FR-050**: A divider MUST be drawn only at a real section boundary: a menu whose items fall in one
  section carries no divider, and no menu may begin or end with one.
- **FR-051**: Dividers MUST be skipped by keyboard navigation and MUST NOT take focus.
- **FR-052**: The menus that MUST conform, and their state before this feature, are:

  | Menu | Today | Sections it will contain |
  |---|---|---|
  | Files & Folders (file, folder, root) | Grouped | Unchanged, plus US3's and US4's items in **Navigate** |
  | Terminal content menu | Already sectioned — three separators shipped | Contextual, Content, **View & state** |
  | Editor content menu | 8 items, no dividers | Content, Navigate (Go To Line), View & state |
  | Panel header menu | 11+ items, no dividers | Content, Destroy, Navigate, View & state |
  | Tab context menu | 4 items, no dividers | Content, Destroy, Navigate |
  | Cog menu | 5 items, no dividers | **Application only — one section, therefore no divider** |
  | Key Bindings chord menu | 1 item | Exempt while it holds one item |

  The third column is an **inventory of the sections each menu will contain, not an ordering**. The
  order is always FR-047's, and FR-047 is the only place it is stated. *(Corrected 2026-08-15: two
  rows previously listed Destroy last, which contradicted both FR-047 and the constitution — and the
  Files & Folders menu, named in Assumption 7 as the vocabulary's source, has always drawn Delete
  before Open In.)*

  *(Corrected 2026-08-15, second pass: the terminal row understated the menu twice. Its "Today"
  cell read "rest ungrouped", but `terminal-panel.tsx` already pushes three separators; and its
  required column named two sections, omitting **View & state** — which is where the failure trio
  (Try again, Copy details, Clear panel type) belongs, as `contracts/menu-sections.md` §3.2 and
  T063 both have it. An implementer working from this table alone would have left those three
  items unsectioned, which is precisely the defect FR-049 exists to prevent.)*

  *(Corrected 2026-08-15: the cog row previously required the preferences trio to be "split from the
  diagnostic and About items". All five are **Application** under FR-047's own table and under the
  constitution, and FR-050 permits a divider only at a section boundary — so the split it asked for
  was forbidden by the two rules it sits between. Superseded: the cog menu takes no divider.)*

- **FR-053**: No menu item's label, icon, action, order **within** its section, or test identifier may
  change as a result of this work. This is a grouping pass, not a menu redesign.
- **FR-053a**: A test guard that waits for a precondition before sending a menu keystroke MUST assert
  the state the keystroke actually depends on, and MUST **fail when that state is absent**. The
  guard identified by **#244** — polling the focused element's text for a row's name — MUST be
  replaced rather than retained: the file tree keeps focus on its container, whose text contains
  every row, so the predicate holds from the first sample regardless of focus and holds even with the
  triggering click removed. A guard that cannot fail is not a guard, and this one was copied as
  precedent precisely because it read like one.
- **FR-053b**: The replacement MUST be demonstrated to fail when its precondition is removed — the
  check that separates a real guard from a sleep wearing a condition's clothes. A guard whose failure
  mode is never exercised is a claim, not a test.

### Remembering what was typed (US1 and US2)

> **FR-054, FR-055 and FR-056 do not exist, and nothing is missing.** The cross-cutting block that
> held them was renumbered to FR-064 – FR-067 on 2026-08-15 when this section claimed FR-057 onward,
> because two requirements briefly shared the number FR-057. Every requirement survived the move;
> only the labels changed. Recorded here so the gap reads as a renumbering rather than as three
> requirements lost in an edit.

- **FR-057**: Both modals MUST open with an **empty** input by default. The second invocation looks
  exactly like the first, and the first keystroke always means what it appears to mean.
- **FR-058**: Two new settings MUST be offered, both **off** by default, each making one modal reopen
  with the last value it accepted:

  | Setting | Effect when on |
  |---|---|
  | `editor.navigation.rememberQuickOpenQuery` | Quick Open reopens with the last query the user searched with |
  | `editor.navigation.rememberGotoLineNumber` | Go To Line reopens with the last line number the user went to |

- **FR-059**: Both settings MUST live in a new **`Editor · Navigation`** group in the Settings editor,
  following the existing sub-group naming, and MUST each carry a metadata descriptor so the
  configuration-editor completeness gate passes.
- **FR-060**: When a setting is on, the restored value MUST be **fully selected** when the modal
  opens, so typing replaces it with no keystroke spent clearing it, and Quick Open MUST show the
  results for the restored query rather than an empty list.
- **FR-061**: A remembered value MUST be the last value the modal **accepted** — a query that opened a
  file, a number that was gone to — never a partially typed one abandoned with Escape.
- **FR-062**: A remembered value MUST live for the running application only, per window, and MUST NOT
  be written to disk. Quick Open's remembered query MUST additionally be discarded when the active
  project changes, because its candidate set is project-scoped and a query from another project
  describes nothing.
- **FR-063**: Turning either setting off MUST take effect at the next invocation and MUST discard the
  value already held, so the modal cannot reopen carrying something the user has just switched off.

### Cross-cutting

- **FR-064**: Both new commands MUST carry a descriptor in the key-bindings metadata so they appear in
  the Preferences → Key Bindings editor with a name and description, and the existing completeness
  gate MUST pass.
- **FR-065**: Both new modals MUST match the app's existing modal presentation and focus behaviour:
  focus lands in the input on open, Escape cancels, Enter confirms, and focus returns to the invoking
  surface either way.
- **FR-066**: Neither new modal may be opened twice, nor both at once; opening one while the other is
  open MUST leave exactly one modal on screen.
- **FR-067**: The user documentation MUST describe both new commands and their default chords, the two
  new explorer actions, and the two new preferences.

### Key Entities

- **Project file index**: the set of a project's files offered to Quick Open. Rooted at exactly one
  project root, filtered by the project's exclusion rules, kept current as the filesystem changes,
  and never containing a path outside its root. Files only — folders are not open targets.
- **Picker entry**: one row of the shared picker — a stable id, the text matched against (a file's
  full path), the text drawn, and optional trailing detail. Already defined by spec 031; this feature
  seeds it, and extends it only if files genuinely need more than it offers.
- **Menu section**: a named, ordered group of context-menu items. Sections are the vocabulary of
  FR-047; a divider is the rendering of a boundary between two of them, never a decoration placed by
  hand.
- **Remembered modal input**: the last value a navigation modal accepted — a Quick Open query that
  opened a file, a Go To Line number that was gone to. Held per window for the running application
  only, never written to disk, discarded when its setting is turned off, and, for Quick Open,
  discarded when the active project changes. Surfaced only when its setting is on.
- **Terminal start directory**: the folder a new terminal's shell begins in. Already modelled, with
  its own containment and fallback rules; this feature adds a new *source* for it (a tree node),
  not a new mechanism.

## Success Criteria *(mandatory)*

- **SC-001**: A user who knows a file's name can open it from a cold start of the modal in **three
  actions or fewer** — chord, type, Enter — from any focus context in the app.
- **SC-002**: In a project of **50,000 files**, each keystroke in the Quick Open input updates the
  list in **under 100 ms**, measured, with no keystroke triggering a filesystem walk.
- **SC-003**: Quick Open never lists a file outside the current project's root, and never lists a file
  the project's exclusion rules exclude — asserted against a fixture containing both.
- **SC-004**: Every route by which a file can be opened from Quick Open produces the same outcome as
  the equivalent route from the tree — same target, same one-buffer behaviour, same unsaved-changes
  prompt — asserted rather than assumed.
- **SC-005**: A file changed on disk while the app runs is offered by Quick Open, or withdrawn from
  it, within **two seconds** of the change.
- **SC-006**: Go To Line lands on the line the **gutter** shows, asserted against the gutter's
  rendered number rather than an internal document offset, for a line in a wrapped document and one
  in an unwrapped one.
- **SC-007**: Go To Line's chord opens nothing while a terminal is focused, and the terminal receives
  the corresponding control character — asserted, since this is the property that keeps a shell
  usable.
- **SC-008**: A terminal opened from the tree starts in the right-clicked folder in **100%** of
  attempts across every enabled flavour on the machine.
- **SC-009**: After either subtree action, **zero** folders are marked open with unloaded children —
  the desync condition that produced #120.
- **SC-010**: Every context menu in the app draws its items in the declared sections in the declared
  order, verified by one check that enumerates the menus rather than by a per-menu eyeball.
- **SC-011**: No menu item's label, order within its section or test identifier changes. Every
  existing menu-driving end-to-end spec passes unmodified **except for two named changes**, and any
  *other* edit to an existing menu spec is a defect in this feature rather than a test that needed
  updating:

  | Spec | Change | Why it is required, not incidental |
  |---|---|---|
  | `context-menu-sections.e2e.ts:49` | The assertion that a folder's Open In submenu holds *exactly one* item | US3 adds Terminal to that submenu by design (FR-029) |
  | `menu-keyboard.e2e.ts` | The vacuous focus guard is replaced, and the FR-051 divider-skip assertion is added | FR-053a requires exactly this, and it is the spec that drives menu keyboard navigation |

  *(Corrected 2026-08-15 — twice. As first written the criterion admitted no exceptions and could not
  hold; the first correction named one and missed that FR-053a mandates the second. An unachievable
  success criterion is worse than none, because it gets quietly reinterpreted at the moment it fails
  rather than challenged.)*
- **SC-012**: Both new commands appear in Preferences → Key Bindings, can be rebound, and the rebound
  chord works while the old one stops — asserted for each.
- **SC-013**: For a query matching a file both by name and, elsewhere, by directory only, the
  name match is listed first — and the tab picker's order is byte-identical to before this feature,
  proving the ranking hook is opt-in rather than a change to every caller.
- **SC-014**: Both new settings ship **off**, and each is asserted in both states — off, the modal
  opens empty; on, it opens with the last accepted value selected. A setting that is rendered but
  never read is the defect #108 exists to prevent, so "the toggle appears in Preferences" is not
  sufficient evidence for either.
- **SC-015**: A terminal launched from the tree accepts typed input with no intervening click, in
  100% of attempts across every enabled flavour.
- **SC-016**: **The guard #244 names**, and every other guard sharing its vacuous shape that the
  static check finds, is demonstrated to **fail** when its precondition is removed — the property
  #244 showed to be absent, and the only evidence that separates a guard from a delay. *(Narrowed
  2026-08-15 from "every keyboard precondition guard in the menu tests": nothing enumerated "every",
  so the criterion asserted a sweep no task performed. It is now exactly what the static check
  discovers plus the one guard the issue names.)*

## Assumptions

Recorded because the issues did not settle them and a reasonable default exists. Each is a decision
this spec makes, not a gap it leaves.

1. **Quick Open lists files, not folders.** The issue says "open any project file"; a folder has no
   editor to open in. Offering folders would need a second meaning for Enter.
2. **The rendered cap is 200 rows and the scale target is 50,000 files.** The issue requires "cap the
   rendered result list" and "no synchronous full scan per keystroke" without naming either number. A
   requirement with no number is untestable, so both are stated here and are the numbers the success
   criteria measure.
3. **The editor-target choice is a two-option control at the top of the modal** (clarified
   2026-08-15, FR-010 – FR-010b). Its second option is a new editor panel **in the current tab**, not
   a new tab. Focus starts in the input so the common case costs no keystrokes; the control is
   reached backwards with Shift+Tab. The alternatives — a hidden modifier on Enter, or foot buttons —
   were rejected for hiding the state and for adding a second way to commit respectively.
4. **Quick Open's visible route is a Files & Folders toolbar button** (clarified 2026-08-15,
   FR-018a – FR-018c), not a menu item: it is a window-level command, so the constitution's "every
   panel action has a menu item" rule does not reach it, and the toolbar puts it beside the tree it
   searches. **Known cost, accepted**: the pane is hideable, so with Files & Folders closed the chord
   is the only route. Go To Line **does** get a menu item (FR-027) because it acts on a panel's
   content.
5. **The candidate set follows the explorer's existing exclusion rules** rather than introducing a
   second ignore mechanism for Quick Open alone.
6. **Sub-workspace windows get Quick Open too**, scoped to their own root — the alternative, a chord
   that silently does nothing in one window, is worse than either supporting it or refusing it
   visibly.
7. **The section vocabulary is derived from what the Files & Folders menu already ships**, so the one
   menu that is grouped today does not have to be re-grouped and its end-to-end specs keep passing.
8. **The "Contextual" section exists because the terminal's link menu already needs it** (confirmed
   2026-08-15) — items present only because of what the pointer is over lead the menu, and an item
   qualifies only if it would be absent were the pointer elsewhere. Both alternatives were rejected
   explicitly: demoting the link actions below Copy/Paste is a behaviour regression dressed as a
   grouping pass, and reordering the vocabulary to put Navigate first would re-order the one menu
   that is already grouped.
9. **Go To Line takes a line number only.** `line:column`, `+N` / `-N` and symbol navigation are
   named out of scope by the issue and stay out.
10. **Ranking is added to the shared control, not to Quick Open alone** (clarified 2026-08-15,
    FR-007a/FR-007b). The alternative — a fixed enumeration order — was rejected because with a
    200-row cap it puts the wanted file off screen in a deep repository, which is the case Quick Open
    exists to serve. The tab picker supplies no ranker and is unaffected.

## Dependencies

- **Spec 031 / #225 — satisfied.** The shared list-and-choose control shipped, together with its
  matching rule: a query splits on whitespace and every term must appear as a case-insensitive
  substring, in any order, matched across path separators — so "find file" already reaches
  `src/find/file.ts` with no path-specific behaviour. This feature seeds that control; it does not
  fork it.
- **#157 — satisfied.** Clicking a parent menu item no longer dismisses its submenu, which is what
  made the three-level Open In → Terminal → flavour path viable.
- **#120 — satisfied.** The open-state reconciliation US4 must not violate is in place, and FR-043 is
  the requirement that keeps it that way.
- **#164 — open, and not a blocker.** Window-scoped chords already reach the application from a
  focused terminal, which is what Quick Open needs. When #164 narrows what a terminal swallows,
  Quick Open's chord belongs in the set that stays reachable — this feature must not add a
  terminal-only special case that would have to be unpicked (FR-003).
- **"Open files in" (`editor.openTarget`, #141) — shipped.** Quick Open reuses it rather than adding a
  second notion of where a file lands.

## Out of scope

- Searching file **contents** (#153) and the find bar's UX pass (#220) — a separate cycle.
- Symbol search, recently-opened ordering or MRU history in Quick Open, opening files from outside the
  project, and command-palette-style non-file commands. The remember setting (FR-058) is **one** last
  accepted query, not a history: nothing lists past queries, and nothing reorders results by them.
- `line:column` syntax, relative jumps, and go-to-line for terminals or the file tree.
- A keybinding for the two new explorer actions, and toolbar buttons for them.
- Opening a terminal at an arbitrary typed path, and any change to the flavour catalogue or its
  configuration UI.
- Any change to a menu item's label, icon, action or order within its section (FR-053).
