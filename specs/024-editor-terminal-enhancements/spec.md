# Feature Specification: Editor & Terminal Enhancements

**Feature Branch**: `feature/S024-editor-terminal-enhancements`

**Created**: 2026-07-22

**Status**: Draft

**Input**: Split from spec 023 (v1 tweaks). Three enhancements were descoped from PR #151 so the other ten stories could ship; four further v1.0.0 stories that 023 never implemented were folded in here on 2026-07-23 (see Provenance).

**Source issues**: #152, #155, #85, #114, #97 (v1.0.0 `enhancement`s); #157, #159 (v1.0.0 `bug`s).

## Overview

This feature carries the v1.0.0 backlog that spec 023 did not ship: the three enhancements split out of it into this spec (US1–US3), two further enhancements it never started (US4–US5), and two live defects (US6–US7). Each user story is **independently shippable**; the single spec exists to plan and track them together, not to force them into one PR.

| Story | Issue | Type | Area | One-liner |
|-------|-------|------|------|-----------|
| US1 | #152 | enhancement | editor/terminal/prefs | Word-wrap toggle per instance + a terminal status bar + editor/terminal default-wrap preferences |
| US2 | #155 | enhancement | terminal | Drag & drop a file/folder onto a **terminal** to paste its path (editors out of scope) |
| US3 | #85 | enhancement | file explorer | Undo/redo a tree file **move / rename / delete** (delete via recycle-bin restore) |
| US4 | #114 | enhancement | editor/explorer | Drag a file from Files & Folders onto an empty panel to open it as an editor |
| US5 | #97 | enhancement | editor | Editor panels name themselves from the open file; a rename wins; "Reset Name" restores auto-naming |
| US6 | #157 | bug | context menus | Clicking a parent item with a sub-menu keeps the sub-menu open (does not dismiss the menu) |
| US7 | #159 | bug | terminal | URLs clicked in a terminal open the **system** browser, not an integrated one |

The Enhancements add capability and each obeys the constitution's cross-cutting rules — the platform seam for OS reveals/moves/open-external (Principle II), one-document-one-state (#68), and the scope-based keybinding dispatch — called out per story below. The two Bugs each require a regression test that fails before the fix.

### Provenance

US1–US3 were descoped from spec 023 by commit `a3b016a` and specified here. US4–US7 were drafted into spec 023 (as its US14–US17) but never committed or implemented; that draft — which also proposed abandoning this spec and pulling US1–US3 back into 023 — was discarded on 2026-07-23 and its unimplemented content carried here instead. Spec 023 is complete and merged at US1–US10; nothing in it is re-opened by this feature.

## Clarifications

### Session 2026-07-22

- Q: US3 (#85) — is **rename** (and **delete**) undo/redo in scope alongside **move**? → A: **Yes to both.** US3's undo/redo covers **move, rename, and delete**. Delete-undo **restores** the removed item — from the **OS recycle bin**, through the file-system seam — under the same validate-before-apply rule; if the content can no longer be recovered, the undo is **refused with an explanation** and changes nothing. Issue #85 updated to match.
- Q: US3 (#85) — where does a deleted item come back from on undo — OS recycle bin or an app-managed staging area? → A: The **OS recycle bin**, via the platform seam. Tree deletes route to the system trash; undo restores from it by original path (the seam keeps macOS/Linux trash open later). If the item is no longer in the recycle bin, the undo is refused with an explanation.

### Session 2026-07-22 (second pass)

- Q: US1 (#152) — default word-wrap state for a new editor/terminal instance? → A: Default **On**, via **two separate persisted preferences** — an **"Editor default word wrap"** and a **"Terminal default word wrap"**, each defaulting to **On**. A new instance starts at its type's preference; the per-instance status-bar toggle overrides it for **that instance only** (in-memory, not persisted). This **supersedes** #152's original "per-instance only, no preference" note.

### Session 2026-07-22 (third pass — carried over from the discarded 023 draft)

- Q: US2 (#155) — does drop-to-paste-path apply to **editors** as well as terminals? → A: **Terminals only.** Dropping a file/folder onto an **editor** does **not** paste its path; the editor drop surface is left to the open/convert behaviour (US4/#115) and the "Open In"/"Copy Path" menu actions. Issue #155 updated to be explicit (title, scope, acceptance criteria) and the `area:editor` label removed. This **narrows** US2 from its earlier "terminal *or* editor" wording in this spec.
- Q: US5 (#97) — how does an editor panel's auto-name reset, given the "Reset Name" gesture shipped with #89? → A: **Reuse the existing "Reset Name" model.** #89's work added a per-panel `titleIsCustom` flag (a deliberate rename beats the auto-name) and a **"Reset Name"** context-menu action (`ws.resetPanelName`, disabled when nothing to reset) that clears the flag and returns the panel to its **default** name — the live OSC title for a terminal, and now the **open file's basename** for an editor. US5 defines only what "default" resolves to for an editor and re-derives it as the open file changes. **No empty-string reset path** — the override's presence/absence is the stored `titleIsCustom` flag, never an empty-string sentinel. Issue #97 reframed onto this model and moved to v1.0.0.
- Q: US4 (#114) — the sub-workspace→project ownership conversion on a tree-drop touches `Panel.originProjectId`, which today is set once and never reassigned (cuts against INV-4/5/6). Is that conversion in scope here? → A: **Yes, in scope but flagged as the riskiest part.** A tree-drop onto an untyped **sub-workspace-owned** panel converts it to **project-owned** (the dragged file comes out of a project), and the resulting ownership survives a restart. This is the one part that adds a new workspace-model capability and will need a focused clarification/validation pass during planning; the rest of US4 is the transport + open, which the OS-drop destination (#60) already built.

### Session 2026-07-22 (fourth pass — automated clarify, no interactive input; carried over from the discarded 023 draft)

These five decisions were resolved automatically (informed defaults) at the maintainer's instruction to clarify unattended; each is open to revision.

- Q: US5 (#97) — for the auto-name, how much of a multi-part filename is stripped (e.g. `foo.test.ts`, `Makefile`, `.gitignore`)? → A: Strip **only the final extension**: `foo.test.ts` → `foo.test`, `archive.tar.gz` → `archive.tar`. A file with **no** extension keeps its whole name (`Makefile` → `Makefile`). A **dotfile** with no further extension keeps its full name including the leading dot (`.gitignore` → `.gitignore`, not empty). Never produce a blank title.
- Q: US3 (#85) — "bounded" undo stack: what bound? → A: The **most recent 50** tree operations **per project**; when full, the oldest entry drops off. (Round number chosen for a low-risk default; tune in planning if needed.)
- Q: US7 (#159) — which URL schemes are routed to the system browser? → A: **`http` and `https` only.** Other or unknown schemes (`file:`, `javascript:`, `mailto:`, etc.) are **not** opened — neither externally nor in an in-app browser — avoiding an open-external footgun. (Widening to other safe schemes can be a follow-up.)
- Q: US2 (#155) — exact quoting rule for a dropped path? → A: Wrap the path in **double quotes only when it contains whitespace**; otherwise insert it unquoted. No further escaping of other shell-significant characters (consistent with the Copy Path default). One insert, never partial/garbled.
- Q: US1 (#152) — when a terminal's word wrap is toggled, does it reflow existing scrollback or only new output? → A: **Reflow the entire buffer, existing scrollback included**, via the terminal's own reflow — the toggle is not limited to subsequent output. Editors behave the same (the editor rewraps current content).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Per-instance word-wrap toggle (+ terminal status bar) (#152, Priority: P1)

Word wrap can be toggled **per editor instance and per terminal instance** from that panel's **status bar**. Editors gain a wrap toggle on their existing status bar; **terminals gain a new status bar** (they have none today) hosting the same toggle. Two **persisted preferences** set the starting state — an **"Editor default word wrap"** and a **"Terminal default word wrap"**, each defaulting to **On** — so a new instance begins wrapped (or not, if its type's preference is off). The **per-instance toggle overrides** its instance's state **in-memory only** — a killed-and-reopened instance returns to its type's default preference, not the last toggled value. Toggling reflows the **entire buffer, existing scrollback included** (editors likewise rewrap current content). Editors use the editor's own wrapping; terminals use the terminal's reflow. The new terminal status bar is a prerequisite and MAY be split into its own linked issue during planning if too large for one PR.

**Why this priority**: Useful readability control, and the largest of the three carried-over enhancements (needs a new terminal status-bar surface + two settings).

**Independent Test**: A fresh editor and terminal start at their type's default-wrap preference (On by default); toggling one editor/terminal wraps only that instance and reflows its existing content; kill and reopen → back to the type's default preference (the toggle is not persisted); changing a default preference affects newly-opened instances of that type.

**Acceptance Scenarios**:

1. **Given** the default preferences (each defaulting to **On**), **When** a new editor or terminal opens, **Then** it starts at its type's default-wrap preference.
2. **Given** an editor panel, **When** its status-bar wrap toggle is used, **Then** wrapping turns on/off for that editor only and its current content rewraps.
3. **Given** a terminal panel, **When** it renders, **Then** it shows a **status bar** (new) carrying a wrap toggle that turns wrapping on/off for **that terminal only**, reflowing the whole buffer including existing scrollback.
4. **Given** multiple editors/terminals, **When** one instance is toggled, **Then** no other instance is affected.
5. **Given** any instance, **When** it is killed and reopened, **Then** it returns to its type's default-wrap **preference** (the per-instance toggle is not persisted).
6. **Given** a change to the "Editor default word wrap" or "Terminal default word wrap" preference, **When** a new instance of that type opens, **Then** it starts at the new default.

---

### User Story 2 - Drag a file/folder onto a terminal to paste its path (#155, Priority: P2)

A user drags a file or folder from Files & Folders onto a **terminal**'s content area and its **path is inserted as text** into the terminal input, as if pasted — no more copying the path from elsewhere. The path defaults to the OS-native **absolute** path and is wrapped in **double quotes only when it contains whitespace** so it is usable on a command line. This is **terminal-only**: dropping onto an **editor** does **not** paste a path (editors are out of scope), and dropping onto an **empty** panel still follows the open/convert behaviour (US4/#115), not path-paste.

**Why this priority**: Removes a routine friction (getting a project path onto a command line), scoped tightly to the terminal to keep it small.

**Independent Test**: Drag a file onto a terminal → its absolute path appears in the input; drag a folder → same; a path with spaces arrives quoted; drop the same item onto an editor → nothing is pasted; drop onto an empty panel → the open/convert behaviour still runs.

**Acceptance Scenarios**:

1. **Given** a terminal panel, **When** a file is dropped onto its content area, **Then** the file's path is inserted into the terminal input as text.
2. **Given** a terminal panel, **When** a folder is dropped onto its content area, **Then** the folder's path is inserted into the terminal input as text.
3. **Given** a path that contains whitespace, **When** it is inserted, **Then** it is wrapped in double quotes so it is usable on a command line; a path without whitespace is inserted unquoted.
4. **Given** an **editor** panel, **When** a file/folder is dropped onto its content area, **Then** no path is pasted (editors are out of scope).
5. **Given** an **empty** (untyped) panel, **When** a file/folder is dropped, **Then** the open/convert behaviour (US4/#115) runs, not path-paste.

---

### User Story 3 - Undo/redo file operations in the File Explorer (#85, Priority: P3)

With the **Files & Folders** tree focused, `Ctrl+Z` undoes the last file-system operation performed **from the tree** — a **move** (cut+paste or drag-move), a **rename**, or a **delete** — and `Ctrl+Y` / `Ctrl+Shift+Z` redoes it. A move/rename returns the item to its previous path; a **delete is undone by restoring** the item from the **OS recycle bin** (so tree deletes must route to the system trash, not a hard delete). Every entry is **validated before it is applied** and **refused with an explanation** — changing nothing — when the world no longer matches what the entry describes (the destination was taken, renamed, or the deleted content is no longer recoverable); it never silently clobbers. `Ctrl+Z` resolves by **scope**: with an **editor** focused it still undoes text, never a file operation. An open editor on the affected file **follows the change** (one-document-one-state, #68). The stack is **bounded** (the most recent 50 operations) and **per-project**. All operations go through the file-system seam (Principle II).

**Why this priority**: The most complex enhancement — a destructive-operation undo (including delete-restore) that must never clobber; deliberately late, and the most likely to split into linked issues (move/rename first, delete-restore second).

**Independent Test**: Cut+paste a file then `Ctrl+Z` with the tree focused → it returns; drag-move then `Ctrl+Z` → same; rename then `Ctrl+Z`/`Ctrl+Y` → reverts/re-applies; delete then `Ctrl+Z` → restored from the recycle bin, `Ctrl+Y` deletes again; `Ctrl+Z` with an editor focused → undoes text, not a file op; an undo whose world changed → refused with an explanation, nothing altered; an open editor on the affected file follows the reversal without going dirty.

**Acceptance Scenarios**:

1. **Given** a file cut and pasted into another folder, **When** `Ctrl+Z` is pressed with the tree focused, **Then** the file is back where it started, on disk and in the tree.
2. **Given** a drag-moved file, **When** `Ctrl+Z` is pressed, **Then** it returns to its previous path; **and** `Ctrl+Y` re-applies the move.
3. **Given** a renamed file/folder, **When** `Ctrl+Z` then `Ctrl+Y` is pressed, **Then** the previous name is restored, then the rename re-applied.
4. **Given** a file/folder deleted from the tree, **When** `Ctrl+Z` is pressed, **Then** the item is restored from the OS recycle bin to its original path; `Ctrl+Y` deletes it again.
5. **Given** an **editor** has focus, **When** `Ctrl+Z` is pressed, **Then** it undoes text, not a file operation (the two never cross — scope table).
6. **Given** an undo whose world has changed underneath it (path taken, or deleted content unrecoverable), **When** it is attempted, **Then** it is **refused with an explanation** and **changes nothing** — never an overwrite.
7. **Given** an open editor on an affected file, **When** the operation is reversed, **Then** the editor follows the change and does not go dirty or warn (one-document-one-state, #68).
8. **Given** operations in two projects, **When** undo is invoked, **Then** the stack is bounded (50 most-recent operations) and per-project — an operation in one project is not undoable from another.

---

### User Story 4 - Drag a file from Files & Folders onto an empty panel (#114, Priority: P4)

A user drags a file from throng's own **Files & Folders** pane onto an **empty (untyped) panel**; the panel becomes an **editor** showing that file — the same end state as dragging the file from the OS file manager (#60), from the source that is already on screen. A drop onto an untyped **sub-workspace-owned** panel **converts it to project-owned** (the file comes out of a project, so the panel belongs where its content does), and that ownership survives a restart. The tree drop is subject to the **same project-confinement** rule as an OS drop, and the tree's own internal move/copy drag is unchanged.

**Why this priority**: Closes a "same gesture, different outcome" gap — the OS drag works but the more obvious in-app tree drag does nothing. The ownership conversion is new workspace-model work with a constitutional edge (INV-4/5/6) and is the riskiest part.

**Independent Test**: Drag a file from the tree onto an untyped **project-owned** panel → it becomes an editor showing the file; drag onto an untyped **sub-workspace-owned** panel → it converts to project-owned then opens, and the ownership survives a restart; the drop obeys project confinement; the tree's internal move/copy drag (incl. the Ctrl-copy cursor, FR-081) is unchanged; E2E covers both ownership cases.

**Acceptance Scenarios**:

1. **Given** an untyped **project-owned** panel, **When** a file is dragged from Files & Folders onto it, **Then** the panel is typed as an editor and opens that file.
2. **Given** an untyped **sub-workspace-owned** panel, **When** the same drag lands on it, **Then** the panel is converted to project-owned, the file opens, and the ownership survives a restart.
3. **Given** the tree drop path, **When** a file is dropped, **Then** it is subject to the same project-confinement rule as an OS drop; nothing it opens is unsaveable.
4. **Given** the tree's existing internal move/copy drag, **When** US4 lands, **Then** it is unchanged, including the Ctrl-copy cursor (FR-081).
5. **Given** the withdrawal record, **When** this ships, **Then** `specs/006-editor-panel-type/spec.md` FR-079 (recorded "Not planned") is updated to reflect the shipped behaviour.

---

### User Story 5 - Editor panels name themselves from the open file (#97, Priority: P5)

An editor panel with no manual name shows the **open file's basename** (final extension stripped) and re-derives it as the open file changes — a row of editors becomes distinguishable at a glance. A user who **renames** the panel keeps that name: the rename (`titleIsCustom`) wins over the auto-name, including when a different file is opened in it. The existing **"Reset Name"** action (shipped with #89) clears the override and restores the panel type's default naming — the open file's basename for an editor, "Panel N" for a panel with no better default. The override's presence/absence is the stored `titleIsCustom` flag, distinct from an empty string, and persists across restart.

**Why this priority**: High day-to-day value (the header finally says what's open) and low risk — it reuses the shipped rename-precedence/"Reset Name" model, only defining what "default" means for an editor.

**Independent Test**: Open `foo.ts` → panel titled `foo`; open `bar.md` in it → `bar`; rename to `Scratch`, open `baz.ts` → stays `Scratch`; "Reset Name" → back to `baz`; "Reset Name" on a non-editor panel → its default (`Panel 2`); an editor with no file → its default, not blank; "Reset Name" disabled when never renamed; a manual override survives a restart.

**Acceptance Scenarios**:

1. **Given** an editor with `foo.ts` open, **When** it renders, **Then** it is titled `foo`.
2. **Given** that same panel, **When** `bar.md` is opened in it, **Then** it re-titles to `bar`.
3. **Given** the user renames the panel to `Scratch`, **When** `baz.ts` is opened in it, **Then** it stays `Scratch` (the rename wins).
4. **Given** the renamed panel, **When** "Reset Name" is invoked, **Then** automatic naming is restored and it shows the open file's basename (`baz`).
5. **Given** a non-editor panel, **When** "Reset Name" is invoked, **Then** its default name is restored (e.g. `Panel 2`), not a blank header; and "Reset Name" is disabled when the panel has never been renamed.
6. **Given** a manual override, **When** the app restarts, **Then** the override persists (stored as `titleIsCustom`, not an empty-string sentinel).

---

### User Story 6 - Parent menu item keeps its sub-menu open (#157, Priority: P6, Bug)

A user clicks a context-menu item that itself carries a **sub-menu** (e.g. an "Open In" or "Copy Path" parent). The sub-menu **stays open** so the user can move into it and pick a child — it no longer collapses the whole menu. A parent item with a sub-menu never dismisses the menu on click.

**Why this priority**: A live defect that makes sub-menus (including the ones spec 023 shipped for "Open In" and "Copy Path") unreachable by click; small and self-contained.

**Independent Test**: Open a context menu with a sub-menu-bearing parent, click that parent → the sub-menu stays open and its children are reachable; a leaf item still closes the menu and runs its action as before.

**Acceptance Scenarios**:

1. **Given** a context-menu parent item that carries a sub-menu, **When** the user clicks it, **Then** the sub-menu stays open and the menu does not collapse.
2. **Given** the open sub-menu, **When** the user moves into it, **Then** its child items are reachable and invokable.
3. **Given** an ordinary leaf item (no sub-menu), **When** it is clicked, **Then** it runs its action and closes the menu exactly as today (no regression).

---

### User Story 7 - Terminal URLs open the system browser (#159, Priority: P7, Bug)

A user clicks a URL printed inside a **terminal** panel (for example a link in a program's output). It opens in the **default system browser** via the OS open-external mechanism — never an embedded/in-app browser window inside throng.

**Why this priority**: A live defect with a clear correct behaviour; the OS open-external seam already exists, so the fix is contained.

**Independent Test**: In a terminal, print and click a URL → it opens in the default system browser; no integrated browser window appears inside throng.

**Acceptance Scenarios**:

1. **Given** a URL rendered in a terminal panel, **When** the user clicks it, **Then** it opens in the default system browser via the OS open-external seam.
2. **Given** the click, **When** it is handled, **Then** no embedded/in-app browser window is opened inside throng.
3. **Given** the OS open-external path, **When** the URL is opened, **Then** it goes through the platform-abstraction seam, not a hard-coded call in shared code (Principle II).

---

### Edge Cases

- **US1**: A terminal that never had a status bar gains one — the new surface must not disturb the terminal's existing layout, sizing, or reflow when wrap is toggled; a pathological toggle spam must not desync the instance's in-memory state from the visible glyph. A default-preference change while instances are already open leaves those instances at their current (possibly toggled) state; only newly-created instances pick up the new default. A terminal opened from a layout saved before the status bar existed still gains one without breaking the saved layout.
- **US2**: A drop that lands on the boundary between a terminal's content and its chrome (header/status bar) must resolve to exactly one behaviour, never a double insert. A path is wrapped in double quotes only when it contains whitespace; other shell-significant characters are inserted as-is (not further escaped), so the insert is always one atomic, un-garbled path.
- **US3**: On a platform whose file-system/recycle-bin seam is not implemented, the undo path degrades cleanly (the action is unavailable or reports it), never a hard-coded Windows call in shared code.
- **US3**: Concurrent/rapid ops, a move/rename/delete whose source project is closed before undo, and a **delete whose content can no longer be recovered** (the item was purged from the recycle bin) — the per-project bounded stack refuses cleanly with an explanation rather than acting across projects, on a vanished context, or restoring content it no longer has. An operation performed outside throng is never on the stack. Redo after an intervening new operation follows the stack's normal truncation. A 51st operation in a project drops the oldest entry.
- **US4**: A tree drag onto an **already-typed** editor panel is not part of this story (the "Open In" menu serves it); it must not silently do the wrong thing. The sub-workspace→project conversion must not violate INV-4/5/6 for panels that are *not* dropped on. Confinement must reject a file outside the panel's project exactly as an OS drop does.
- **US5**: Two editors open the same-basename file from different directories — both may show the same title; de-duplication is explicitly out of scope. An editor with no file open shows its default name, never a blank header. A rename to a whitespace-only string is a manual name, not a reset (reset is only via "Reset Name").
- **US6**: A parent item that is *also* directly actionable (rare) must still expose its sub-menu on click without losing the ability to reach children; the fix must not make ordinary leaf items stop closing the menu.
- **US7**: A terminal "URL" that is actually a malformed or non-`http(s)` scheme (`file:`, `javascript:`, `mailto:`, …) must not be handed to the OS opener; only `http`/`https` URLs are routed out, and nothing opens an in-app browser.

## Requirements *(mandatory)*

### Functional Requirements

**US1 — per-instance word-wrap toggle (#152)**

- **FR-001**: Each **editor** panel's status bar and each **terminal** panel (via a **new** terminal status bar) MUST carry a word-wrap toggle that turns wrapping on/off for **that instance only** (editor: the editor's own wrapping; terminal: the terminal's reflow). The terminal status bar MUST be built to host future per-terminal status affordances.
- **FR-002**: Two **persisted preferences** MUST set the starting word-wrap state — **"Editor default word wrap"** and **"Terminal default word wrap"**, each defaulting to **On**. A new editor/terminal instance MUST start at its **type's** preference.
- **FR-003**: The per-instance toggle MUST override in-memory only — toggling one instance MUST NOT affect any other, and a killed-and-reopened instance MUST return to its type's default-wrap **preference** (not the last toggled value).
- **FR-003a**: Toggling wrap MUST reflow the **entire buffer, existing scrollback included** — not only subsequent output; editors likewise MUST rewrap their current content.

**US2 — drag a file/folder onto a terminal to paste its path (#155)**

- **FR-004**: Dropping a file or folder from Files & Folders onto a **terminal's content area** MUST insert that item's path as text into the terminal input (as if pasted), atomically — one path, never partial or garbled.
- **FR-005**: The inserted path MUST default to the OS-native **absolute** path and MUST be wrapped in **double quotes only when it contains whitespace** (otherwise inserted unquoted); no further escaping of other shell-significant characters is applied (consistent with the "Copy Path" default).
- **FR-005a**: Path-paste on drop is **terminal-only**: dropping onto an **editor's content area** MUST NOT paste a path (editors are out of scope), and dropping onto an **empty (untyped)** panel MUST follow the open/convert behaviour (US4/#115), not path-paste.

**US3 — undo a file move / rename / delete (#85)**

- **FR-006**: With the File Explorer focused, `Ctrl+Z` MUST undo the last tree operation — a **move** (cut+paste or drag-move), a **rename**, or a **delete** — and `Ctrl+Y` / `Ctrl+Shift+Z` MUST redo it; the chord MUST resolve by **scope** (`{explorer}` vs `{editor}`) so `Ctrl+Z` in an editor still undoes text.
- **FR-007**: Tree deletes MUST route to the **OS recycle bin** (not an unrecoverable hard delete), and a **delete** MUST be undone by **restoring** the removed item from the recycle bin to its original path **through the file-system seam**; a move/rename is undone by returning the item to its previous path.
- **FR-008**: Every undo entry MUST be **validated before it is applied** and **refused with an explanation, changing nothing**, when the world no longer matches what it describes (path renamed/deleted/replaced, or a deleted item's content no longer recoverable) — it MUST never overwrite.
- **FR-009**: An undone operation MUST **re-point any open editor** on the affected file so it follows the change without going dirty or warning (one-document-one-state, #68); all operations MUST go through the file-system seam (Principle II).
- **FR-010**: The undo stack MUST be **bounded to the most recent 50 tree operations per project** (the oldest entry drops off when full) and MUST NOT cross projects. Rename and delete are **in scope** (delete via restore); no other file-system operation is undoable by this story.

**US4 — drag a file from the tree onto an empty panel (#114)**

- **FR-011**: Dragging a file from Files & Folders onto an untyped **project-owned** panel MUST type the panel as an **editor** and open that file (the same end state as an OS-file-manager drop, #60).
- **FR-012**: The same drag onto an untyped **sub-workspace-owned** panel MUST convert the panel to **project-owned** and then open the file, and the resulting ownership MUST survive a restart. This conversion is new workspace-model work with a constitutional edge (INV-4/5/6) and MUST get a focused clarification/validation pass in planning.
- **FR-013**: The tree drop path MUST be subject to the same **project-confinement** rule as an OS drop (nothing it opens is unsaveable), and the tree's existing internal move/copy drag MUST be unchanged, including the Ctrl-copy cursor (FR-081).
- **FR-014**: When this ships, `specs/006-editor-panel-type/spec.md` FR-079 (currently recorded "Not planned") MUST be updated to reflect the shipped behaviour.

**US5 — editor panels name themselves from the open file (#97)**

- **FR-015**: An editor panel with no manual name MUST show the **open file's basename** with **only its final extension stripped** (`foo.test.ts` → `foo.test`), MUST re-derive it as the open file changes, and MUST never render a blank title: a file with no extension keeps its whole name (`Makefile`), and a dotfile with no further extension keeps its full name including the leading dot (`.gitignore`).
- **FR-016**: A manual **rename** MUST set the panel's override (`titleIsCustom`) and MUST win over the automatic name, including when a different file is opened in that panel; the override MUST persist across restart and be stored **distinctly from an empty string** (absence-of-override ≠ override of `""`).
- **FR-017**: The existing **"Reset Name"** action (from #89) MUST clear the override and restore the panel type's default naming — the open file's basename for an editor, "Panel N" for a panel with no better default — and MUST be **disabled** when the panel has never been renamed. There MUST be **no** empty-string reset path.

**US6 — parent menu item keeps its sub-menu open (#157, bug)**

- **FR-018**: Clicking (or hovering) a context-menu **parent item that carries a sub-menu** MUST keep the sub-menu open and MUST NOT dismiss/collapse the menu; the sub-menu's children MUST remain reachable and invokable. Ordinary leaf items MUST continue to run their action and close the menu as before.

**US7 — terminal URLs open the system browser (#159, bug)**

- **FR-019**: Clicking a URL in a terminal panel MUST open it in the **default system browser** through the OS open-external platform seam (Principle II), and MUST NOT open an embedded/in-app browser window inside throng. Only **`http` and `https`** URLs are routed out; other or unknown schemes (`file:`, `javascript:`, `mailto:`, etc.) MUST NOT be opened at all — neither externally nor in an in-app browser.

**Cross-cutting**

- **FR-020**: No change in this feature may regress existing behaviour; each user story MUST be independently verifiable, and surfaces it does not touch MUST behave identically to today. Every user-facing story MUST ship passing E2E coverage (constitution Principle V) — the two bugs (US6, US7) MUST land a regression test that fails before the fix — and OS-specific behaviour (US3 recycle-bin restore, US4 project-confined open, US7 open-external) MUST go through the platform seam with contract tests (Principle II).

### Key Entities

- **Panel status bar**: a per-panel status strip; editors already have one, terminals gain a **new** one (US1) built to host the word-wrap toggle and future per-terminal affordances.
- **Word-wrap state**: a per-instance, in-memory on/off flag for an editor or terminal (US1) that overrides — and on reopen resets to — its type's **default-wrap preference** ("Editor default word wrap" / "Terminal default word wrap", each defaulting On, persisted).
- **Terminal path drop**: a Files & Folders drag dropped onto a terminal's content area (US2) that inserts the item's absolute path as text (whitespace-quoted); terminal-only, distinct from the empty-panel open (US4/#115) and from editor drops.
- **File-op-undo entry**: a per-project, bounded (50) record of a tree **move, rename, or delete** that US3 can reverse — a move/rename by returning the item to its previous path, a delete by restoring it from the **OS recycle bin** — but only after validating the world still matches (and the content is still recoverable); otherwise refused.
- **Panel drop target / ownership conversion**: an untyped panel that accepts a tree file drop to become an editor (US4); a sub-workspace-owned target is converted to project-owned (touching `Panel.originProjectId` / INV-4/5/6), persisted across restart.
- **Panel name override**: the per-panel `titleIsCustom` flag (US5) marking a deliberate rename that beats the auto-name; its default resolves to the editor's open-file basename or "Panel N", and "Reset Name" clears it — stored distinctly from an empty string.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001** (US1): Toggling word wrap on one editor or terminal changes only that instance 100% of the time and reflows the whole existing buffer (scrollback included); a new instance starts at its type's default preference (both default On); a killed-and-reopened instance returns to the type default, never the last toggled value; every terminal panel shows a status bar.
- **SC-002** (US2): Dropping a file or folder onto a terminal inserts its correct absolute path 100% of the time, whitespace-containing paths arrive quoted, an editor drop pastes nothing, and an empty-panel drop still runs the open/convert path.
- **SC-003** (US3): From the tree, `Ctrl+Z` reverses the last move/rename/delete (delete restored from the recycle bin) and `Ctrl+Y` re-applies it; an editor-focused `Ctrl+Z` never touches files; a stale-world undo is refused with an explanation and changes nothing (0% silent clobber); an open editor on the file follows the reversal without going dirty; the stack is bounded to 50 operations per project.
- **SC-004** (US4): A tree file dropped on an untyped project-owned panel opens it as an editor 100% of the time; on a sub-workspace-owned panel it converts to project-owned and the ownership survives a restart; the drop honours project confinement; the tree's internal move/copy drag (incl. Ctrl-copy cursor) is unchanged; both ownership cases have E2E.
- **SC-005** (US5): An editor with a file open shows the file's basename; opening a different file re-titles it; a manual rename survives opening another file and an app restart; "Reset Name" restores the basename for an editor and "Panel N" for other panels, and is disabled when nothing to reset; no editor shows a blank header.
- **SC-006** (US6): Clicking a sub-menu-bearing parent keeps the sub-menu open and its children reachable 100% of the time; leaf items still close the menu and run their action (no regression); a regression test covers the bug.
- **SC-007** (US7): Clicking a URL in a terminal opens the default system browser via the open-external seam 100% of the time and never opens an in-app browser; a regression test covers the bug.

## Assumptions

- Scope is the seven `v1.0.0` issues this spec carries: five `enhancement`s (#152, #155, #85, #114, #97 — US1–US5) and two `bug`s (#157, #159 — US6–US7). All are treated as agreed by virtue of the maintainer's instruction; all are assigned and in the **v1.0.0** milestone (#114 and #97 were moved from `vNext`; #155 was narrowed to terminals only and its `area:editor` label dropped; #97 was reframed onto the shipped "Reset Name" model).
- Spec 023 shipped its US1–US10 and is merged; nothing here re-opens it. US1–US3 came out of 023 by the descope in `a3b016a`; US4–US7 were drafted into 023 but never committed or implemented, and were carried here on 2026-07-23 when that draft was discarded.
- These are **independently shippable** — the bundle exists to plan and track together, not to merge as one PR. The three largest (**US1** #152 new terminal status bar, **US3** #85 undo-with-validation, **US4** #114 ownership conversion) MAY each split into linked issues/branches during planning; the spec notes this rather than forcing one implementation shape.
- Two dependencies/risks are flagged for planning, not blockers here: US3's delete-restore (recycle-bin seam) and US4's sub-workspace→project ownership conversion (touches INV-4/5/6) each need a focused validation pass.
- Cross-cutting constitutional rules apply and are called out per story: the platform seam for OS file operations and open-external (Principle II — US3, US4, US7), one-document-one-state (#68 — US3, US5), and scope-based keybinding dispatch (US3).
- US5 reuses the per-panel `titleIsCustom` / "Reset Name" model already shipped with #89; no new naming framework is introduced.
