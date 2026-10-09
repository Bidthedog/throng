# Feature Specification: Follow Moves Into Unheld Layouts

**Feature Branch**: `feature/S052-I397-I111-follow-moves-into-unheld-layouts`

**Created**: 2026-10-06

**Status**: Draft

**Input**: User description: "Spec 052 — Follow file moves into layouts no window holds (#397, #111). When a file
or folder is renamed or moved in-app (File Explorer rename, drag-move, cut/paste, undo/redo of a move), every
saved layout that references the old path is rewritten at the time of the move — not reconciled on load —
including closed sub-workspaces and unloaded projects: editor panel filePath, preview panel binding, and
navigation history entries. #111: define the behaviour when a move lands on a path that is itself open in a
panel. Extends 019 FR-008, 044 FR-013c and FR-109; must not contradict them."

**Issues**: #397 (enhancement), #111 (defect).

**Decision already taken** (#397, maintainer, 2026-09-30): rewrite at the time of the move, not reconcile on
load; keep no rename log; reuse the walk over layouts no window holds.

**Governing requirements this spec builds on, and does not supersede**:

- 006 FR-011a — a real file path has at most one editor buffer open across the whole application.
- 019 FR-001 – FR-009 — an in-app move re-points open editors by path, without dirtying them or raising a notice;
  a folder move re-points by prefix; a rename is a move; FR-008: no persisted artefact strands a document at its
  old path; FR-009: a move by another program keeps today's behaviour (reads as a delete).
- 024 FR-006 – FR-010a — undo and redo of move, rename and delete; validated before applying; never an
  overwrite; an undone operation re-points open editors.
- 044 FR-012 — a file has at most one preview; a move onto a path another preview already shows does not rebind
  (the moved preview keeps its old path and history).
- 044 FR-013c — a preview follows its file's in-app rename or move.
- 044 FR-106d — a history entry that cannot be read shows the could-not-read state.
- 044 FR-109 — a panel's history persists with the layout and follows a renamed or moved file.
- 050 FR-016 / FR-035 — cut-paste follows like an in-app move; a panel whose file leaves its project stays,
  read-only, with one inline notice; a return clears it.
- 050 FR-017 – FR-018b — nothing is overwritten without the user's choice; Replace disposes of the existing item
  and undo restores it.

**Superseded, narrowly**:

- 044 `plan.md` Complexity Tracking, "History path-following in layouts no window holds" — the deferral named
  this spec as its owner. FR-001 – FR-006 are the end state it recorded.
- 019 Edge Cases, "A move onto a path that is itself open. Undefined today." — defined by FR-010 – FR-013.

## Clarifications

### Session 2026-10-07

- Q: When a move with Replace lands on `b.md` while `b.md` is open, what does the panel that showed the old
  `b.md` do — show the moved file (sharing one buffer), become a read-only "file was replaced" panel, or close?
  → A: **Show the moved file.** Both panels share the one buffer at `b.md`; the old content is reachable through
  undo. Unsaved edits in the replaced file are still governed by FR-012. (FR-011)

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A rename reaches every saved layout (Priority: P1)

A user renames or moves a file in the File Explorer. Somewhere they are not looking — a sub-workspace they
closed last week, a project they have not loaded today — a panel still points at that file. When they later
reopen that sub-workspace or load that project, the panel opens the file at its new path, its history leads to
the new path, and nothing reports the file as missing.

**Why this priority**: Today only cut-paste and drag-move reach those layouts; a plain rename strands them,
and the user meets a "could not be read" panel for a file that still exists. It is the defect #397 names.

**Independent Test**: Open a file in a sub-workspace, close the sub-workspace, rename the file in the main
window, reopen the sub-workspace — the editor shows the renamed file, clean, with no notice.

**Acceptance Scenarios**:

1. **Given** a closed sub-workspace with an editor on `a.md`, **When** the user renames `a.md` to `b.md` in the
   File Explorer, **Then** reopening the sub-workspace shows an editor on `b.md`, clean, with no notice.
2. **Given** an unloaded project whose layout has a preview of `docs/a.md`, **When** the user moves the `docs`
   folder to `notes` from a project that contains both, **Then** loading that project shows the preview bound to
   `notes/a.md`.
3. **Given** a closed sub-workspace whose panel history contains `a.md`, **When** `a.md` is renamed to `b.md` and
   then `b.md` to `c.md`, **Then** reopening it and navigating back lands on `c.md`.
4. **Given** a rename was made, **When** the user undoes it and then redoes it, **Then** every saved layout ends
   at the path the file actually has after each step.
5. **Given** a move that no saved layout references, **When** it lands, **Then** no saved layout is rewritten.

---

### User Story 2 - Open windows follow every kind of move (Priority: P1)

Every in-app move — rename, drag-move, cut-paste, and the undo or redo of each — re-points every panel in
every open window, including panels in tabs that have not been shown since launch, so a later restart restores
the new path.

**Why this priority**: A panel in a never-shown background tab is held by a window but has never been loaded,
so nothing re-points it; it is the same stranding as Story 1, reached from the other side.

**Independent Test**: Restart with an editor on `a.md` in a background tab, rename `a.md` without visiting that
tab, restart again — the tab's editor opens `b.md`.

**Acceptance Scenarios**:

1. **Given** an editor on `a.md` in a tab not shown since launch, **When** `a.md` is renamed to `b.md` and the app
   is restarted, **Then** the editor opens `b.md`.
2. **Given** the active project and a loaded-but-inactive project both show `a.md`, **When** `a.md` is renamed,
   **Then** both follow, and switching to the inactive project shows `b.md`.

---

### User Story 3 - Replacing a file that is open (Priority: P2)

A user cut-pastes or drag-moves `a.md` onto `b.md` and chooses Replace, while `b.md` — and perhaps `a.md` too —
is open in an editor. The outcome is defined: at most one editor buffer per path, no unsaved work silently lost,
and undo returns both files and both panels to where they were.

**Why this priority**: Reachable only through Replace, and it requires both files open; but today it leaves
two buffers on one path, which breaks 006 FR-011a and can lose an edit on the next save.

**Independent Test**: Open `a.md` and `b.md` in editors, cut `a.md`, paste onto `b.md`, choose Replace — exactly
one editor buffer names `b.md`, and the other panel shows the outcome FR-011 defines.

**Acceptance Scenarios**:

1. **Given** clean editors on `a.md` and `b.md`, **When** `a.md` is moved onto `b.md` with Replace, **Then** one
   buffer names `b.md`, holding the moved content, and the replaced file's panel behaves as FR-011 defines.
2. **Given** the editor on `b.md` has unsaved changes, **When** the user chooses Replace onto it, **Then** those
   changes are kept and never written over the moved file without the user's choice (FR-012); the panel says once,
   inline, that its file was replaced, and offers Save As and Discard — Discard leaves it showing the moved file.
3. **Given** a Replace onto an open `b.md` has landed, **When** the user undoes it, **Then** `a.md` and the
   original `b.md` are back at their paths, and each panel shows the file it showed before the paste.

---

### Edge Cases

- **A chain of moves before a layout is reopened** (A→B, then B→C) ends at C; no intermediate path survives.
- **A folder move** re-points every saved path under it, by path segment, never by string prefix (`docs` does
  not match `docs-old`).
- **A case-only rename** re-points saved layouts like any other rename.
- **A move out of a panel's own project** (cut-paste across projects) keeps 050 FR-035: the saved panel takes the
  new path and is marked moved-out; a move back clears the mark.
- **A layout that cannot be read** (corrupt, or a project whose record is gone) is skipped and left exactly as
  it was; the move itself still succeeds.
- **A window opens or saves its layout while the rewrite is running** — neither the window's save nor the
  rewrite is lost (FR-005).
- **A preview collision in a saved layout** — a moved preview whose new path another preview already shows
  keeps its old path and history, exactly as 044 FR-012 does in an open window.
- **A move made by another program** is not followed into saved layouts; it reads as a delete (019 FR-009).
- **The move fails or is rolled back** — saved layouts end at the path the file actually has.

## Requirements *(mandatory)*

### Functional Requirements

**Saved layouts no window holds (#397)**

- **FR-001**: Every in-app move — File Explorer rename, drag-move, cut-paste, Replace, and the undo, redo and
  roll-back of each — MUST rewrite every saved layout no window currently holds that references a moved path:
  every unloaded project's layout and every closed sub-workspace.
- **FR-002**: The rewrite MUST apply to an editor panel's file, a preview panel's file, and every navigation
  history entry of every panel in that layout, by the same rule an open window uses (019 FR-002, FR-005 –
  FR-007), including the moved-out mark of 050 FR-035.
- **FR-003**: The rewrite MUST happen when the move lands, not when the layout is next opened, and MUST NOT
  depend on any record of past moves.
- **FR-004**: A layout no moved path appears in MUST NOT be rewritten.
- **FR-005**: The rewrite MUST NOT lose a concurrent change: if a window opens, closes or saves a layout while
  the rewrite runs, both that window's state and the rewrite MUST survive. A layout a window starts holding
  during the rewrite is followed by that window, not overwritten by the rewrite.
- **FR-006**: A preview collision in a saved layout MUST resolve as 044 FR-012 resolves it in an open window.

**Held layouts**

- **FR-007**: Every panel in every open window MUST follow an in-app move, whether or not its tab has been shown
  since launch, so that a restart restores the new path (019 FR-008).
- **FR-008**: A loaded-but-inactive project MUST follow a move exactly as the active project does. No window
  holds its layout (only the active project's is held), so it follows through FR-001's rewrite.

**Failure**

- **FR-009**: A saved layout that cannot be read or written MUST be left unchanged, MUST NOT fail or roll back the
  move, and MUST NOT raise a notice; the failure is logged.

**Replace onto an open file (#111)**

- **FR-010**: After any in-app move, a real file path MUST have at most one editor buffer (006 FR-011a),
  including when the move replaced a file that was open.
- **FR-011**: When a move with Replace lands on a path open in an editor with no unsaved changes, the replaced
  file's editor panel MUST show the moved file: it shares the one buffer at that path with the moved file's own
  panel, if that is open (Clarifications, 2026-10-07). A replaced editor WITH unsaved changes is governed by
  FR-012, and reaches this outcome when the user discards those changes.
- **FR-012**: If the replaced file's editor has unsaved changes, it MUST keep them and they MUST NOT be written over
  the moved file without the user's choice (050 Edge Cases, "Replacing an item that is open"); the user MUST still
  be able to save them elsewhere. The panel keeps showing those changes, says once, inline, that its file was
  replaced, and offers Save As and Discard.
- **FR-013**: Undoing a Replace onto an open file MUST return each file to its path and each panel to the file it
  showed before the move, with no extra buffer and no lost edit.

### Key Entities

- **Saved layout**: the persisted arrangement of one project's tabs, or of one sub-workspace — its panels, each
  panel's file, and each panel's navigation history.
- **Held layout**: a saved layout a window currently has loaded and is the writer of.
- **Move pair**: a source and destination path an in-app move produced; a folder pair covers every path under it.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: After any in-app move, zero saved layouts reference a moved file's old path — checked across every
  project and sub-workspace.
- **SC-002**: Reopening any closed sub-workspace or loading any project after a rename raises zero "could not be
  read" notices for files that were renamed in-app.
- **SC-003**: Across 50 alternating rename-and-reopen cycles racing a sub-workspace save, no layout loses either
  the window's change or the rewrite.
- **SC-004**: After any Replace onto an open file, and after its undo, exactly one editor buffer exists per open
  path.
- **SC-005**: A rename in a project with 50 saved layouts completes with no delay the user can perceive; the
  explorer is responsive again within the same budget as a rename today, and the rewrite holds the daemon for less
  than 051 FR-021's 100 ms bound.

## Assumptions

- Per-file language overrides live outside the layout and already follow in-app renames (016); they are out of
  scope.
- The find-in-files scope deliberately does not follow a rename (043); it is out of scope.
- A plain rename and a within-project move still refuse a taken destination; only Replace (050) can land a move
  on an existing file, so #111 is scoped to Replace.
- Undo never overwrites (024 FR-008), so undo cannot itself create the #111 collision.
