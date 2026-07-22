# Feature Specification: Editor & Terminal Enhancements

**Feature Branch**: `feature/S024-editor-terminal-enhancements`

**Created**: 2026-07-22

**Status**: Draft

**Input**: Split from spec 023 (v1 tweaks); these three enhancements were descoped from PR #151 to ship the other ten stories first.

**Source issues**: #152, #155, #85 (v1.0.0 `enhancement`s).

## Overview

This feature carries the three v1.0.0 enhancements that were split out of spec 023 (v1 tweaks) so the other ten stories could ship in PR #151. Each user story is **independently shippable**; the single spec exists to plan and track them together, not to force them into one PR.

| Story | Issue | Type | Area | One-liner |
|-------|-------|------|------|-----------|
| US1 | #152 | enhancement | editor/terminal/prefs | Word-wrap toggle per instance + a terminal status bar + editor/terminal default-wrap preferences |
| US2 | #155 | enhancement | editor/terminal | Drag & drop a file/folder into a terminal or editor to paste its path |
| US3 | #85 | enhancement | file explorer | Undo/redo a tree file **move / rename / delete** (delete via restore) |

The Enhancements add capability and each obeys the constitution's cross-cutting rules — the platform seam for OS reveals/moves (Principle II), one-document-one-state (#68), and the scope-based keybinding dispatch — called out per story below.

## Clarifications

### Session 2026-07-22

- Q: US3 (#85) — is **rename** (and **delete**) undo/redo in scope alongside **move**? → A: **Yes to both.** US3's undo/redo covers **move, rename, and delete**. Delete-undo **restores** the removed item — from the **OS recycle bin**, through the file-system seam — under the same validate-before-apply rule; if the content can no longer be recovered, the undo is **refused with an explanation** and changes nothing. Issue #85 updated to match.
- Q: US3 (#85) — where does a deleted item come back from on undo — OS recycle bin or an app-managed staging area? → A: The **OS recycle bin**, via the platform seam. Tree deletes route to the system trash; undo restores from it by original path (the seam keeps macOS/Linux trash open later). If the item is no longer in the recycle bin, the undo is refused with an explanation.

### Session 2026-07-22 (second pass)

- Q: US1 (#152) — default word-wrap state for a new editor/terminal instance? → A: Default **On**, via **two separate persisted preferences** — an **"Editor default word wrap"** and a **"Terminal default word wrap"**, each defaulting to **On**. A new instance starts at its type's preference; the per-instance status-bar toggle overrides it for **that instance only** (in-memory, not persisted). This **supersedes** #152's original "per-instance only, no preference" note.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Per-instance word-wrap toggle (+ terminal status bar) (#152, Priority: P1)

Word wrap can be toggled **per editor instance and per terminal instance** from that panel's **status bar**. Editors gain a wrap toggle on their existing status bar; **terminals gain a new status bar** (they have none today) hosting the same toggle. Two **persisted preferences** set the starting state — an **"Editor default word wrap"** and a **"Terminal default word wrap"**, each defaulting to **On** — so a new instance begins wrapped (or not, if its type's preference is off). The **per-instance toggle overrides** its instance's state **in-memory only** — a killed-and-reopened instance returns to its type's default preference, not the last toggled value. Editors use Monaco wrapping; terminals use xterm reflow. The new terminal status bar is a prerequisite and MAY be split into its own linked issue during planning if too large for one PR.

**Why this priority**: Useful readability control, and the largest of the three enhancements (needs a new terminal status-bar surface + two settings).

**Independent Test**: A fresh editor and terminal start at their type's default-wrap preference (On by default); toggling one editor/terminal wraps only that instance; kill and reopen → back to the type's default preference (the toggle is not persisted); changing a default preference affects newly-opened instances of that type.

**Acceptance Scenarios**:

1. **Given** the default preferences (each defaulting to **On**), **When** a new editor or terminal opens, **Then** it starts at its type's default-wrap preference.
2. **Given** an editor panel, **When** its status-bar wrap toggle is used, **Then** wrapping turns on/off for that editor only.
3. **Given** a terminal panel, **When** its (new) status-bar wrap toggle is used, **Then** wrapping turns on/off for that terminal only.
4. **Given** multiple editors/terminals, **When** one instance is toggled, **Then** no other instance is affected.
5. **Given** any instance, **When** it is killed and reopened, **Then** it returns to its type's default-wrap **preference** (the per-instance toggle is not persisted).
6. **Given** a change to the "Editor default word wrap" or "Terminal default word wrap" preference, **When** a new instance of that type opens, **Then** it starts at the new default.

---

### User Story 2 - Drag & drop a file/folder to paste its path (#155, Priority: P2)

Dragging a file or folder onto a **terminal** inserts its path into the terminal input; onto an **editor** inserts its path into the document at the drop point. The path defaults to the OS-native absolute path, **quoted if it contains spaces** so it is usable on a command line. This is distinct from dropping onto an **empty** panel to *open* the file (#114/#115) — a drop onto an editor/terminal's **content** pastes the path; a drop onto an empty panel keeps the existing open/convert behaviour.

**Why this priority**: A natural gesture that removes copy-paste friction; must be reconciled with existing drop-to-open behaviour.

**Independent Test**: Drag a file onto a terminal → its path appears in the input; drag a folder onto an editor → its path inserts at the drop point; a path with spaces is quoted; a drop onto an empty panel still opens/converts (#114/#115).

**Acceptance Scenarios**:

1. **Given** a terminal, **When** a file or folder is dropped onto its content, **Then** the item's path is inserted into the terminal input.
2. **Given** an editor, **When** a file or folder is dropped onto its content, **Then** the item's path is inserted into the document at the drop point.
3. **Given** a path containing spaces, **When** it is inserted, **Then** it is quoted so it is usable on a command line.
4. **Given** an empty panel, **When** a file is dropped, **Then** the existing open/convert behaviour runs (#114/#115), not path-paste.

---

### User Story 3 - Undo/redo file operations in the File Explorer (#85, Priority: P3)

With the File Explorer focused, `Ctrl+Z` undoes the last file-system operation performed **from the tree** — a **move** (cut+paste or drag-move), a **rename**, or a **delete** — and `Ctrl+Y` / `Ctrl+Shift+Z` redoes it. A move/rename returns the item to its previous path; a **delete is undone by restoring** the removed item (from the **OS recycle bin**, via the platform seam) to its original path — deletes from the tree therefore route to the system trash, not an unrecoverable hard delete. The chord resolves by **scope** (`{explorer}` vs `{editor}`), so `Ctrl+Z` in an editor still undoes text. Every entry is **validated before it is applied** and **refused with an explanation, changing nothing**, when the world no longer matches (path renamed/deleted/replaced, or a deleted item's content can no longer be recovered). An open editor on the affected file **follows the change** (one-document-one-state, #68). The stack is **bounded and per-project**. All operations go through the file-system seam (Principle II).

**Why this priority**: The most complex enhancement — a destructive-operation undo (including delete-restore) that must never clobber; deliberately last, and the most likely to split into linked issues.

**Independent Test**: Cut/paste, rename, and delete an item from the tree; `Ctrl+Z` (tree focused) reverses each — the moved/renamed item returns to its previous path and the deleted item is restored; `Ctrl+Y` re-applies; `Ctrl+Z` with an editor focused undoes text, not a file op; an entry whose world changed (or an unrecoverable delete) is refused and changes nothing; an open editor follows the reversal without going dirty.

**Acceptance Scenarios**:

1. **Given** a file cut and pasted into another folder, **When** `Ctrl+Z` is pressed with the tree focused, **Then** the file is back at its origin on disk and in the tree.
2. **Given** a drag-move or a **rename**, **When** `Ctrl+Z` (tree focused), **Then** it is undone (the item returns to its previous path); **and** `Ctrl+Y` re-applies it.
3. **Given** a **delete** performed from the tree, **When** `Ctrl+Z` (tree focused), **Then** the item is **restored** to its original path (from the OS recycle bin); **and** `Ctrl+Y` deletes it again.
4. **Given** an editor has focus, **When** `Ctrl+Z` is pressed, **Then** text is undone — never a file operation (scope table).
5. **Given** an undo entry whose world has changed (path taken by something else, or a deleted item's content unrecoverable), **When** it is applied, **Then** it is **refused with an explanation** and **nothing changes** (never overwrites).
6. **Given** an open editor on the affected file, **When** the operation is undone, **Then** the editor follows it and does not go dirty or warn.
7. **Given** the undo stack, **When** it grows, **Then** it is bounded and per-project (an operation in one project is not undoable from another).

---

### Edge Cases

- **US1**: A terminal that never had a status bar gains one — the new surface must not disturb the terminal's existing layout, sizing, or reflow when wrap is toggled; a pathological toggle spam must not desync the instance's in-memory state from the visible glyph.
- **US2**: A drop that lands ambiguously between an empty region and content, or onto a panel type that is neither editor nor terminal — resolve deterministically to either path-paste (content) or the existing open/convert (empty), never both.
- **US3**: On a platform whose file-system/recycle-bin seam is not implemented, the undo path degrades cleanly (the action is unavailable or reports it), never a hard-coded Windows call in shared code.
- **US3**: Concurrent/rapid ops, a move/rename/delete whose source project is closed before undo, and a **delete whose content can no longer be recovered** (the item was purged from the recycle bin) — the per-project bounded stack refuses cleanly with an explanation rather than acting across projects, on a vanished context, or restoring content it no longer has.

## Requirements *(mandatory)*

### Functional Requirements

**US1 — per-instance word-wrap toggle (#152)**

- **FR-001**: Each **editor** panel's status bar and each **terminal** panel (via a **new** terminal status bar) MUST carry a word-wrap toggle that turns wrapping on/off for **that instance only** (editor: Monaco wrap; terminal: xterm reflow).
- **FR-002**: Two **persisted preferences** MUST set the starting word-wrap state — **"Editor default word wrap"** and **"Terminal default word wrap"**, each defaulting to **On**. A new editor/terminal instance MUST start at its **type's** preference.
- **FR-003**: The per-instance toggle MUST override in-memory only — toggling one instance MUST NOT affect any other, and a killed-and-reopened instance MUST return to its type's default-wrap **preference** (not the last toggled value).

**US2 — drag & drop to paste a path (#155)**

- **FR-004**: Dropping a file/folder onto a **terminal's** content MUST insert its path into the terminal input; dropping onto an **editor's** content MUST insert its path into the document at the drop point.
- **FR-005**: The inserted path defaults to the OS-native absolute path and MUST be **quoted when it contains spaces**; a drop onto an **empty** panel MUST keep the existing open/convert behaviour (#114/#115), not path-paste.

**US3 — undo a file move / rename / delete (#85)**

- **FR-006**: With the File Explorer focused, `Ctrl+Z` MUST undo the last tree operation — a **move** (cut+paste or drag-move), a **rename**, or a **delete** — and `Ctrl+Y` / `Ctrl+Shift+Z` MUST redo it; the chord MUST resolve by **scope** so `Ctrl+Z` in an editor still undoes text.
- **FR-007**: Tree deletes MUST route to the **OS recycle bin** (not an unrecoverable hard delete), and a **delete** MUST be undone by **restoring** the removed item from the recycle bin to its original path **through the file-system seam**; a move/rename is undone by returning the item to its previous path.
- **FR-008**: Every undo entry MUST be **validated before it is applied** and **refused with an explanation, changing nothing**, when the world no longer matches what it describes (path renamed/deleted/replaced, or a deleted item's content no longer recoverable) — it MUST never overwrite.
- **FR-009**: An undone operation MUST **re-point any open editor** on the affected file so it follows the change without going dirty or warning (one-document-one-state, #68); all operations MUST go through the file-system seam (Principle II).
- **FR-010**: The undo stack MUST be **bounded and per-project**. Rename and delete are **in scope** (delete via restore); no other file-system operation is undoable by this story.

**Cross-cutting**

- **FR-011**: No change in this feature may regress existing behaviour; each user story MUST be independently verifiable, and surfaces it does not touch MUST behave identically to today. Every user-facing story MUST ship passing E2E coverage (constitution Principle V), and OS-specific behaviour (US3) MUST go through the platform seam with contract tests (Principle II).

### Key Entities

- **Word-wrap state**: a per-instance, in-memory on/off flag for an editor or terminal (US1) that overrides — and on reopen resets to — its type's **default-wrap preference** ("Editor default word wrap" / "Terminal default word wrap", each defaulting On).
- **File-op-undo entry**: a per-project, bounded record of a tree **move, rename, or delete** that US3 can reverse — a move/rename by returning the item to its previous path, a delete by restoring it from the **OS recycle bin** — but only after validating the world still matches (and the content is still recoverable); otherwise refused.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001** (US1): A new editor/terminal starts at its type's default-wrap preference (On by default); toggling word wrap on one editor or terminal affects only that instance; a reopened instance is back at its type's default preference; both editor and terminal expose the toggle on a status bar.
- **SC-002** (US2): Dropping a file/folder onto a terminal or editor's content inserts its (space-quoted where needed) path at the drop point; dropping onto an empty panel still opens/converts (#114/#115).
- **SC-003** (US3): A tree **move, rename, and delete** are each undone and redone from the tree (delete via restore); `Ctrl+Z` in an editor never touches a file op; an entry whose world changed — or an unrecoverable delete — is refused with an explanation and changes nothing; an open editor follows an undone op without going dirty; the stack is bounded and per-project.

## Assumptions

- Scope is the three `v1.0.0` `enhancement`s split out of spec 023 (v1 tweaks) so the other ten stories could ship first (PR #151): #152 (US1), #155 (US2), #85 (US3). All are treated as agreed by virtue of that instruction; all are assigned.
- These are **independently shippable** — the bundle exists to plan and track together, not to merge as one PR. Each is one of the three largest v1.0.0 enhancements (**US1** #152 new terminal status bar, **US2** #155 drag-drop reconciliation, **US3** #85 undo-with-validation) and MAY be split into its own linked issues/branches during planning if too large for one PR; the spec notes this rather than forcing one implementation shape.
- Cross-cutting constitutional rules apply and are called out per story: the platform seam for OS reveals/moves (Principle II — US3), one-document-one-state (#68 — US3), and scope-based keybinding dispatch (US3).
