# Feature Specification: Cross-Project Clipboard

**Feature Branch**: `feature/S050-I448-I7-cross-project-clipboard`

**Created**: 2026-10-02

**Status**: Draft

**Input**: User description: "Spec 050 — cut, copy and paste File Explorer files between projects (#7), carrying
the File Explorer root-collapse defect (#448). An application-level file clipboard holding absolute paths, owned
outside any one explorer, surviving a project switch and shared across throng windows. Copy→paste copies into the
target project; cut→paste moves and follows the within-project move rules for open documents. Pending cut state
stays visible across project switches. Collisions, locked files, read-only targets and partial failures follow the
existing paste rules, one notice per condition. A cross-project move is undoable from either project; a
cross-volume cut is copy-then-delete reported as a move; a source gone since it was cut or copied fails cleanly,
naming what is missing. Out of scope: the OS clipboard and OS drag (#8), which this design must not block; dragging
onto a project in the project list."

**Issues**: #7 (enhancement), #448 (defect).

**Governing requirements this spec builds on, and does not supersede**:

- 004 FR-004 — the root row is always expanded and never collapsible; only subfolders expand and collapse.
  #448 is a violation of it, restated here only to pin the keyboard route (FR-030).
- 004 FR-017 — Ctrl+X / Ctrl+C / Ctrl+V, the shared target-resolution rule, cut rows greyed until pasted, Escape
  cancels a cut and clears the clipboard.
- 004 FR-020 — the context menu offers cut / copy / paste, with Paste disabled when the clipboard is empty.
- 004 FR-023 — the project root itself is never cut, moved or deleted.
- 004 FR-024 — no silent overwrite without user consent (its non-clobbering-name half is superseded below).
- 019 FR-001 – FR-009 and 044 FR-013c — an in-app move re-points open editors, previews and navigation history
  without dirtying them or raising a notice; a move by another program still reads as a delete.
- 024 FR-006 – FR-010a — file-operation undo and redo, validated before applying, persisted per project, bounded
  to 50 entries per project; copy is not undoable.
- 029 FR-011 – FR-013b — the failure classes (held, missing, permission, not-empty, daemon) and naming the holder
  of a locked file.
- 046 FR-017 — focusing the File Explorer lands on the live selection, so the clipboard chords work without a
  click.

**Superseded, narrowly** (each stated again at the FR that replaces it):

- 004 FR-022 — *"File operations MUST be confined to the active project's root"*. A paste may now take its
  **sources** from another project's root. Every **target** stays confined to the active project's root, and every
  source must lie inside *some* project's root (FR-010). Real-path evaluation (FR-037) still applies to both.
- 004 FR-019's wording *"plain drag = move **within the project**"* and the Key Entities' *"identity is its path
  within the project root"* describe a per-project clipboard; the clipboard entity is redefined in Key Entities
  below. Drag behaviour is unchanged.
- 024 FR-010 — *"…per project and MUST NOT cross projects"*. A cross-project move is recorded in **both**
  projects' stacks as one shared operation (FR-020). Every other entry stays per project, and the bound of 50 per
  project is unchanged. Its *"no other file-system operation is undoable"* is also narrowed: a copy that
  replaced an existing item is undoable (FR-018b).
- 004 FR-017's clipboard-cleared-after-cut — a cut that did not fully land keeps its unmoved items on the clipboard
  (FR-006).
- 004 FR-024 and its edge case *"Rename/paste/move name collision: rejected … or de-duplicated with a
  non-clobbering name"* — for a **paste or a drag** into a folder, a name clash now asks the user (FR-017).
  A copy pasted back into the folder it came from is a duplicate, not a clash, and keeps the non-clobbering name
  (FR-018c). Rename collisions (004 FR-016, 026 FR-003) and new-file/new-folder default names are unchanged.
- 006 FR-084 — Save As *"subject to the same confinement as Save"*. An editor whose file a move took into another
  project may Save As into that project (FR-036). No other editor gains it.
- 030 FR-048 and FR-052 — the ORDER and wording of copied notice and banner text. Copy now reproduces what is
  shown, line for line, and then the parts that are never shown (FR-037). Every part 030 requires on the clipboard
  is still there; FR-034, FR-048a, FR-049 and FR-050 stand.

## Clarifications

### Session 2026-10-02

- Q: When a cut item is pasted into a folder that already holds that name, what happens? → A: **That item is
  refused** and named in the paste's one notice; the rest still move; nothing is overwritten. *Superseded on
  2026-10-03 by the clash prompt (FR-017).*

### Session 2026-10-03

- Q: When one paste moves some items but others fail, what does a single undo reverse? → A: **Exactly the items
  that moved**, as one entry; failed items never moved and have nothing to undo. Applies within a project too
  (FR-023).
- Q: Should a project's File Explorer show that items cut or copied elsewhere are waiting to be pasted? → A:
  **The Paste menu item says it**, naming what will land and, when it differs, the project it came from; nothing
  else is added (FR-025a).
- Q: What does the user see while a large paste runs? → A: **Progress, with a Cancel action** (FR-019).
- Q: What happens to work already done when a paste is cancelled? → A: **The user chooses**: keep what finished,
  or roll the whole paste back (FR-019a). And any name that already exists in the destination **asks the user**
  whether to overwrite it, rather than renaming or refusing it automatically — for every paste, so re-pasting the
  same set asks about each clash (FR-017).
- Q: Which choices does the clash prompt offer? → A: **Replace, Skip or Keep both**, with "apply to all remaining
  clashes" and Cancel. A replaced item goes to the Recycle Bin so undo can restore it; a folder clashing with a
  folder merges, asking about each clashing item inside (FR-018 – FR-018b).
- Q: Do the clash rules apply to a copy-paste within one project too? → A: **Yes**, identically — e.g. `README.md`
  copied from the root and pasted onto `test/`, which holds a `README.md`, gets the same prompt. A pasted folder
  keeps its directory structure at every depth (FR-017, FR-018e).
- Q: When the delete setting is permanent, what happens to an item a Replace overwrites? → A: **A new setting
  decides**, separate from the delete setting, defaulting to the Recycle Bin (FR-018f).
- Q: What happens when a second paste starts while one is still running? → A: **It is queued** and runs when the
  first finishes; it shows as queued and can be cancelled before it starts (FR-019d).
- Q: Should a pending paste follow a file renamed or moved inside throng before it is pasted? → A: **Yes**, as
  open editors do; a change made outside throng still fails at paste time (FR-009).
- Q: Should a drag get the same progress, Cancel and keep-or-roll-back choice as a paste? → A: **No, paste only**;
  a drag still gets the clash prompt (FR-019e).

### Session 2026-10-03 (third)

- Q: After a cut is pasted, do skipped or failed items stay cut so they can be pasted elsewhere? → A: **Yes** — the
  clipboard keeps exactly the items that did not move, still greyed (FR-006).
- Q: Where is a long paste's progress when the user switches project mid-paste? → A: **Visible everywhere** — in
  the window's notice area, whichever project is active (FR-019).
- Q: What happens when the user quits while a paste is running? → A: **Ask first**: wait for it, or cancel with
  the keep-finished or roll-back choice (FR-019f).

### Session 2026-10-03 (fourth)

- Q: Which choice does Enter pick in the clash prompt? → A: **Replace**; Escape is Cancel (FR-018).
- Q: Does the clash prompt show details to compare the two items? → A: **Yes** — size and modified time (item
  count for folders), with the newer one marked (FR-018).
- Q: What does the File Explorer select after a paste? → A: **The pasted items**, revealed and selected (FR-025b).

### Session 2026-10-03 (fifth) — after manual testing

- Q: Which pastes show progress? → A: **Only a paste of more than 5 MB**, once it has spent 1 second working; time
  a clash prompt or the cancel choice is open does not count (FR-031). Narrows the trigger of the earlier answer
  "Progress, with a Cancel action" (FR-019); the progress itself is unchanged. *(5 MB is the user's; keeping the
  1-second delay and not counting prompt time are derived from FR-019 and SC-008, not confirmed by the user.)*
- Q: How does the clash prompt lay out the two items? → A: **A box for each**, incoming and existing, with an
  arrow between them pointing the way the copy goes, the newer one highlighted, and clear space around the boxes
  and above the buttons (FR-032). *(Incoming box first, arrow towards the existing box, derived from "pointing in
  the direction of the copy".)*
- Q: Where do items selected from different folders land? → A: **In the same structure they had**, relative to
  the deepest folder holding them all: `/test/test.md` and `/test.md` pasted into `/test2/` land at
  `/test2/test/test.md` and `/test2/test.md`, within a project and across projects (FR-033). Reverses FR-018e's
  "each separately selected item lands directly in the target folder". *(Applying it to drag as well as paste,
  merging into an intermediate folder that already exists, and an item inside another selected folder travelling
  with that folder are derived from FR-018c and FR-018e, not confirmed by the user.)*
- Q: What cursor does a file drag show over something that cannot take it? → A: **The no-entry cursor**,
  everywhere a drop would do nothing — the Projects pane included (FR-034). *(Covering drags from outside throng and
  the gaps between panels is derived from "everywhere that a file drag is invalid".)*

### Session 2026-10-04 — after manual testing

- Q: When a file open in project A's editor or preview is cut and pasted into project B, what does A's panel do?
  → A: **It stays in A, read-only, with one inline notice**: "This file moved to another project, at <new path>.
  You can no longer work on it in this project." It lets go of the file, so B — or an undo back into A — opens it
  normally (FR-035). Reverses the earlier answer that such panels follow the file "exactly as after a move within a
  project" (FR-016, US2 scenario 3); within a project nothing changes. *(Applying it to a project's panels while
  that project is not on screen, to undo and redo, and to a preview as well as an editor is derived from the
  report — "Couldn't open … (missing)" on switching back, and the file that would not open after undo — not
  confirmed by the user.)*
- Q: What happens to unsaved changes in an editor whose file was moved to another project? → A: **They are kept**
  in the read-only panel, which offers Save As but not Save; Save As opens in the file's new folder and may save
  into the project the file moved to — the one exception to editor save confinement (FR-036). Reverses US2
  scenario 4 ("the editor follows the file").
- Q: What does a notice's or banner's Copy put on the clipboard? → A: **Every line shown, in the order and words
  shown, then a separate details block** with what is never shown: the full Project — Tab — Panel subject, each
  row's path and reason, and the raw system error (FR-037). *(The heading "Details" and a blank line before it
  are derived.)*
- Q: What happens when a file from the File Explorer is dropped on the tab strip's + button? → A: **A new tab
  opens with the file in an editor** (FR-038). *(Skipping the rename box a click on + opens, refusing a folder or
  several items with the no-entry cursor, and a file already open in an editor focusing that editor instead
  (006 FR-011a) are derived from the tab-chip drop and 005 FR-027, not confirmed by the user.)*
- The OS copy that stalled after a click on a file being written (MT-04) did not reproduce: throng's open path
  makes four metadata calls, checks the size before reading, and holds no handle — a writer filling a 1 GB file
  kept writing through five refused opens and then reopened it exclusively. No requirement changes.

### Session 2026-10-04 (second) — after manual testing

- Q: What does the paste progress notice show while it runs? → A: **A progress bar**, filled by the bytes copied
  of the paste's total, beside "N of M files" and the size done of the size in all; while the total is not yet
  known the bar is animated without a fill (FR-039). *(Filling by bytes rather than items — the user's "better"
  option — and the animated state while sizing are derived; a one-item paste would otherwise sit at 0% until it
  ends.)*
- Q: How does the progress notice offer Cancel? → A: **A dedicated themed cancel icon**, not the X that means
  dismiss, aligned to the right and set apart from the text, with the hover title "Cancel paste" (FR-039). The
  user chose this over a text button, which the constitution's icon-control rule forbids outside a dialog.
- Q: What does a file dropped on + open as? → A: **Whatever its default open action names** — a Markdown file
  with Preview as its default opens as a preview, exactly as a drop on an empty panel does (047 FR-077) — in the
  new tab's one panel (FR-038 as amended). Reverses the earlier answer "a new tab opens with the file in an
  editor". *(Applying 047 FR-077 is derived from "opened in editor mode rather than the default preview mode".)*

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Copy a file from one project into another (Priority: P1)

A user working in project A wants a config file they already have in project B. They select it in A's File
Explorer, press Ctrl+C, switch to project B, select a folder and press Ctrl+V. The file appears in that folder in
B, and A is untouched.

**Why this priority**: The single most common reason a user leaves throng for the OS file manager today. It is
also the smallest slice that proves the clipboard outlives a project switch.

**Independent Test**: Two projects on disk. Copy a file in A, switch to B, paste on a folder. The file exists in
B's folder with the same bytes, and A still holds it.

**Acceptance Scenarios**:

1. **Given** a file selected in project A, **When** the user copies it, switches to project B, selects a folder
   and pastes, **Then** a copy of the file exists in that folder and the original is unchanged in A.
2. **Given** several files and a folder copied together in A, **When** they are pasted in B, **Then** every item
   is copied, the folder with its whole contents.
3. **Given** a copy is pending, **When** the user pastes it in B and then pastes again in another B folder,
   **Then** both pastes succeed: a copy stays on the clipboard after it is pasted, as it does within a project.
4. **Given** a copied file whose name already exists in the B target folder, **When** the user pastes, **Then** the
   clash prompt asks whether to replace it, skip it or keep both, and nothing is overwritten until they choose
   (FR-017).
5. **Given** a copy is pending, **When** the user opens the File Explorer context menu in project B, **Then**
   Paste is enabled and reads `Paste "<file name>" from <project A's name>` (FR-025a).
6. **Given** `/test/test.md` and `/test.md` selected together in A and copied, **When** the user pastes on
   `/test2/` in B, **Then** they land at `/test2/test/test.md` and `/test2/test.md`; pasted on `/test2/` in A
   instead, they land at the same two paths in A (FR-033).
7. **Given** a single file dragged from the File Explorer, **When** it is dropped on the tab strip's + button,
   **Then** a new tab opens with the file in an editor, and no rename box appears; a folder or several items held
   over + show the no-entry cursor and a release changes nothing (FR-038).
8. **Given** Markdown's default open action is Preview, **When** a `.md` file is dropped on +, **Then** the new tab
   holds exactly one panel, showing the file's preview (FR-038 as amended, 047 FR-077).

---

### User Story 2 - Move a file from one project into another (Priority: P1)

The user cuts a file in project A, switches to project B and pastes. The file now lives in B and is gone from A.
Any editor or preview that had it open keeps showing it, at its new path, exactly as after a move within a
project.
*Superseded by FR-035 (Session 2026-10-04): across projects A's panels stay in A, read-only, with a moved notice.*

**Why this priority**: A move is the other half of the issue and the half with consequences: open documents,
history, undo.

**Independent Test**: Cut a file in A with an editor open on it, paste in B. The file exists only in B, the editor
shows the new path and is not dirty, and no notice appears.
*Superseded by FR-035 (Session 2026-10-04): the editor shows the moved notice and is read-only.*

**Acceptance Scenarios**:

1. **Given** a file cut in A, **When** the user pastes it on a folder in B, **Then** the file exists in that
   folder, no longer exists in A, and the clipboard is empty.
2. **Given** a file cut in A, **When** the user switches to B and back to A before pasting, **Then** the file's row
   in A is still greyed as cut.
3. **Given** an editor and a preview open on a file, **When** the file is cut in A and pasted in B, **Then** both
   panels show the file at its new path, neither is dirty, and no notice is raised — the 019 FR-001 – FR-009 and
   044 FR-013c behaviour, unchanged.
   *Superseded by scenario 8 (Session 2026-10-04) — across projects the panels stay in A, read-only, with a
   notice.*
4. **Given** an editor with unsaved changes open on a file that is cut in A and pasted in B, **Then** the unsaved
   changes are kept and the editor follows the file, as after a within-project move.
   *Superseded by scenario 9 (Session 2026-10-04).*
5. **Given** a file cut in A, **When** the user presses Escape in any project's File Explorer, **Then** the cut is
   cancelled, the clipboard is empty, and A's row is no longer greyed.
6. **Given** a cut file whose name already exists in the B target folder, **When** the user pastes, **Then**
   the clash prompt asks whether to replace, skip or keep both; the other items move as normal (FR-017).
7. **Given** a file dragged from the File Explorer, **When** it is held over a project in the Projects pane, or
   anywhere else that would not take it, **Then** the pointer shows the no-entry cursor, and releasing there
   changes nothing (FR-034).
8. **Given** an editor and a preview open on a file in A, **When** the file is cut in A and pasted in B, **Then**
   both panels stay in A, read-only, each showing "This file moved to another project, at <new path>. You can no
   longer work on it in this project.", neither is dirty, and opening the file in B opens it there normally
   (FR-035).
9. **Given** an editor with unsaved changes open on a file that is cut in A and pasted in B, **Then** A's panel
   keeps the unsaved text, Save is unavailable, and Save As opens in the file's new folder in B and saves there
   (FR-036).
10. **Given** a file moved from A to B while A was not on screen, or with A's editor not yet opened this session,
    **When** the user switches to A, **Then** its panel shows the moved notice of scenario 8, and no "Couldn't
    open" or "could not be read" notice appears (FR-035).
11. **Given** a Markdown preview in A showing a file, **When** the user switches to B, moves the file there and
    switches back to A, **Then** the preview shows the moved notice, not the file, and its "open the linked
    editor" actions are unavailable (FR-035 as amended).

---

### User Story 5 - Stay in control of clashes and long pastes (Priority: P2)

The user pastes a folder of 40 files into a project where 6 of the names already exist. throng asks about the
first clash; they choose Replace and tick "apply to all remaining clashes", and the paste finishes. Later they
start pasting a multi-gigabyte folder from another drive, see it will take a while, and cancel it. throng asks
whether to keep what already landed or roll the whole paste back.

**Why this priority**: Overwriting is the one thing a paste can do that loses data, and a long paste the user cannot
stop holds their files in an unknown state. Both decisions belong to the user, not to a default.

**Independent Test**: Paste a set of files into a folder holding some of the same names; the prompt appears once per
clash, or once in total with "apply to all". Start a large paste, cancel it, choose roll back: the target folder is
as it was and every source is intact.

**Acceptance Scenarios**:

1. **Given** a pasted file whose name exists in the target folder, **When** the paste reaches it, **Then** a prompt
   names the item and offers Replace, Skip, Keep both, an "apply to all remaining clashes" tick-box, and Cancel.
2. **Given** the user chooses Replace, **When** the paste finishes, **Then** the replaced item is in the Recycle Bin
   and one undo restores it and removes the pasted one.
3. **Given** the user chooses Keep both, **Then** the pasted item takes the non-clobbering name a copy has always
   taken (`name copy.ext`).
4. **Given** a pasted folder whose name exists in the target as a folder, **Then** the two merge: items with no
   clash land, and each clashing item inside is asked about.
5. **Given** `README.md` copied from a project's root, **When** it is pasted onto the `test` folder of the same
   project, which already holds a `README.md`, **Then** the same prompt appears with the same choices — a clash
   within one project is treated exactly like one across projects.
6. **Given** a folder `docs` containing `guide/intro.md` and `guide/img/logo.png` is pasted into a folder that
   already holds `docs/guide/intro.md`, **Then** `docs/guide/img/logo.png` lands at that same relative path, and only
   `intro.md` is asked about.
7. **Given** the same set is pasted into the same folder a second time, **Then** every item clashes and is asked
   about; nothing is renamed or refused without the user's choice.
8. **Given** a paste that is still running after a moment, **Then** its progress is shown with a Cancel action.
   *Narrowed by scenario 10 (Session 2026-10-03, fifth) — only a paste of more than 5 MB.*
9. **Given** the user cancels a paste partway, **When** asked, they choose **Keep finished** → items that landed
   stay, the half-copied item is removed and its source is untouched, and items not yet started are skipped; or
   **Roll back** → every item this paste placed is removed, every moved item returns to its source, and every
   replaced item is restored.
10. **Given** a small file (5 MB or less) pasted onto a folder that already holds its name, **When** the clash
    prompt stays open for several seconds before the user answers, **Then** no progress notice appears at any
    point — only the prompt. A paste of more than 5 MB still running after 1 second of work shows its progress
    with Cancel (FR-031).
11. **Given** the clash prompt is shown, **Then** the incoming item and the existing item each sit in their own
    box, an arrow between them points from the incoming box to the existing one, the newer box is highlighted,
    and the buttons stand clear of the text above them (FR-032).
12. **Given** a paste of more than 5 MB showing progress, **Then** the notice shows a bar that fills as bytes are
    copied, "N of M files" and the size done of the total, and a cancel icon on the right, apart from the text,
    titled "Cancel paste"; choosing it asks Keep finished or Roll back (FR-039, FR-019a).

---

### User Story 3 - Undo a move between projects (Priority: P2)

Having pasted a cut file from A into B, the user realises it was the wrong project. They press Ctrl+Z — in either
project's File Explorer — and the file returns to where it was in A.

**Why this priority**: A move that cannot be undone is more dangerous across projects than within one, because the
user is no longer looking at where the file came from.

**Independent Test**: Cut-paste a file from A to B, press Ctrl+Z in B: the file is back in A. Repeat, and press
Ctrl+Z in A instead: the same result. Redo puts it back in B.

**Acceptance Scenarios**:

1. **Given** a file moved from A to B, **When** the user presses Ctrl+Z in B's File Explorer, **Then** the file
   returns to its original path in A and any open editor follows it.
   *Narrowed by scenario 6 (Session 2026-10-04) — an editor the move took out of its project does not follow.*
2. **Given** a file moved from A to B, **When** the user switches to A and presses Ctrl+Z there, **Then** the same
   undo happens.
3. **Given** the move has been undone from one project, **When** the user opens the other project's Undo,
   **Then** the move is no longer offered there, and its Redo is.
4. **Given** the file was edited, renamed or deleted in B after the move, **When** the user tries to undo it,
   **Then** the 024 FR-008 validation refuses it with one error notice and changes nothing.
5. **Given** a move between A and B, **When** throng is restarted, **Then** the move can still be undone from
   either project.
6. **Given** a file moved from A to B and opened in an editor in B, **When** the move is undone, **Then** B's
   editor shows the moved notice (FR-035), and opening the file in A opens it in an editor there at once.

---

### User Story 4 - The root row survives the keyboard (Priority: P2)

A user navigating the File Explorer with the arrow keys reaches the root row and presses Left arrow. Nothing
happens to the tree: the project's files stay in view.

**Why this priority**: A one-key, every-time loss of the whole tree, with no mouse control to undo it. Small, but it
is a shipped requirement (004 FR-004) being broken.

**Independent Test**: Click the root row, press Left arrow. Every top-level item is still visible.

**Acceptance Scenarios**:

1. **Given** the root row has focus, **When** the user presses Left arrow, **Then** the root stays expanded and its
   children stay visible.
2. **Given** an open subfolder has focus, **When** the user presses Left arrow, **Then** that subfolder collapses,
   as today.

---

### Edge Cases

- **Source gone since it was cut or copied.** A pending item deleted, renamed or moved outside throng before the
  paste: that item fails with one notice naming it, and the rest of the paste proceeds (FR-013).
- **Source project removed, or its root changed.** The clipboard is emptied when any project holding one of its
  items is removed from throng or re-rooted (FR-011): its items no longer belong to a project, so they could not be
  pasted under FR-010.
- **Pasting back into the source project.** A cross-project clipboard pasted in its own project behaves exactly as
  a within-project paste. A cut pasted into the folder it is already in is a no-op (006's drop-onto-own-parent
  rule); a copy pasted there is a duplicate and takes the non-clobbering name without a prompt (FR-018c).
- **Clash with a different kind.** A file whose name matches a folder in the target, or the reverse, cannot merge;
  the prompt offers Replace (the existing one goes to the Recycle Bin), Skip, or Keep both.
- **Replacing an item that is open.** An editor or preview on a replaced file behaves as when another program
  replaces the file today; an editor with unsaved changes keeps them and is not overwritten.
- **Cancel during a clash prompt.** Cancel on the prompt is the same as cancelling the paste (FR-019a).
- **Roll back cannot finish.** Any item roll back cannot restore (locked, gone) is named in the paste's one notice;
  everything else is still rolled back.
- **Different drives.** A cut from a project on one volume pasted into a project on another is copied and then
  removed from the source, and reads to the user as a move (FR-014).
- **Copy succeeded, source removal failed.** In a cross-volume move, when the copy lands but the source cannot be
  removed (locked, permission): the copy stays, the source stays, and one notice names the source and its holder.
  No undo entry is recorded for that item (FR-015).
- **Locked source or read-only target.** That item fails with the 029 failure class and holder naming; the rest of
  the paste proceeds (FR-013).
- **A source inside the target.** Impossible across projects: Principle I forbids nested roots. Within a project the
  existing "into its own descendant" rejection is unchanged.
- **Language overrides.** A per-file language override set in A follows a moved file into B (FR-016).
- **Hidden paths in B.** A pasted item whose new path is hidden in B's explorer is pasted normally; hiding is a view
  rule, not a target rule.
- **Mixed clipboard.** Items cut from two different projects in one gesture cannot happen: a selection never spans
  projects. A later cut replaces the clipboard rather than adding to it.

## Requirements *(mandatory)*

### Functional Requirements

**The clipboard**

- **FR-001**: The File Explorer clipboard MUST be held by the application, not by one explorer instance, and MUST
  identify each pending item by its **absolute** path. It MUST survive a project switch, hiding and re-showing the
  File Explorer pane, and any window closing other than the application quitting.
- **FR-002**: There MUST be exactly one File Explorer clipboard per running application. Every File Explorer, in
  every throng window, MUST read and write the same clipboard.
- **FR-003**: A cut or copy MUST replace the clipboard's contents; it MUST NOT add to them.
- **FR-004**: Rows on the clipboard by **cut** MUST be greyed (004 FR-017) in any File Explorer showing them,
  including after the user switches away from their project and back.
- **FR-005**: Escape in any File Explorer MUST cancel a pending cut and empty the clipboard, wherever its items came
  from (004 FR-017, now application-wide).
- **FR-006**: A copy MUST stay on the clipboard after it is pasted. After a cut is pasted, the clipboard MUST hold
  exactly the items that did not move — skipped, failed or never reached — still greyed and pasteable; it is empty
  only when every item moved. *Changes 004 FR-017's empty-after-paste for a cut that did not fully land.*
- **FR-007**: The clipboard MUST NOT be persisted across an application restart.
- **FR-008**: The File Explorer clipboard MUST stay separate from the OS clipboard. Nothing in this feature writes
  file items to the OS clipboard or reads them from it (#8 owns that), and the absolute-path form of FR-001 is the
  form #8 would publish.
- **FR-009**: When a pending item, or a folder containing one, is renamed or moved inside throng, the clipboard
  MUST follow it to its new path, by the same rule open editors follow a move (019 FR-005). When a pending item
  is deleted inside throng, it MUST leave the clipboard. A change made outside throng is not followed; it fails at
  paste time (FR-013).

**Paste across projects**

- **FR-010**: A paste MUST accept sources from any project's root and MUST place items only inside the active
  project's root, chosen by the shared target-resolution rule (004 FR-017). A source not inside any project's root
  MUST be refused. Both checks MUST be made on resolved real paths (004 FR-037). *Supersedes 004 FR-022's
  source confinement only; target confinement is unchanged.*
- **FR-011**: When a project holding any clipboard item is removed from throng or has its root changed, the
  clipboard MUST be emptied.
- **FR-012**: A copy-paste across projects MUST produce the same result, item by item, as a within-project
  copy-paste into the same folder, including the clash prompt (FR-017).
- **FR-013**: A paste MUST attempt every item even when an earlier item fails, and MUST report the failures as
  **one** notice naming each failed item and its reason, classed by the 029 failure classes. A paste with no
  failures raises no notice. This applies to within-project pastes too.
- **FR-014**: A cut-paste whose source and target are on different volumes MUST copy each item and then remove the
  source, and MUST present the result exactly as a move: same notices, same path-following (FR-016), same undo
  entry (FR-020).
- **FR-015**: When a cross-volume item is copied but its source cannot then be removed, the copy MUST be kept, the
  source MUST be left in place, the item MUST be reported in the FR-013 notice naming the source and its holder,
  and no undo entry MUST be recorded for that item.
- **FR-016**: A cut-paste across projects MUST re-point open editors, previews, navigation history and per-file
  language overrides exactly as an in-app move within a project does (019 FR-001 – FR-009, 044 FR-013c), including
  for panels in other windows.
  *Narrowed by FR-035 (Session 2026-10-04) — editors and previews the move takes out of their project no longer
  follow; navigation history and language overrides still do.*
**Clashes**

- **FR-017**: When a pasted or dragged item's name already exists in the target folder, the user MUST be asked what
  to do before anything happens to either item. This applies to cut and copy, within a project and across projects,
  and to drag-and-drop; it replaces automatic renaming and automatic refusal for these operations. *Supersedes 004
  FR-024's non-clobbering name for paste and drag.* Nothing is ever overwritten without the user's choice.
- **FR-018**: The clash prompt MUST name the clashing item and the target folder, and MUST offer **Replace**,
  **Skip** and **Keep both**, an **"apply to all remaining clashes"** choice for the rest of this paste, and
  **Cancel**. **Replace** MUST be the default choice, taken by Enter; Escape MUST be Cancel. The prompt MUST show
  the existing and the incoming item side by side — size and last-modified time for a file, item count for a
  folder — and mark which is newer.
  *Extended by FR-032 (Session 2026-10-03, fifth) — how the two sides are laid out.*
- **FR-018a**: **Keep both** MUST give the pasted item the existing non-clobbering name (`name copy.ext`,
  `name copy 2.ext`). **Skip** MUST leave both items untouched and the source on the clipboard.
- **FR-018b**: **Replace** MUST dispose of the existing item by the replace setting (FR-018f) before the pasted one
  takes its place. With the default, it goes to the Recycle Bin and the paste's undo entry MUST restore it. A copy that replaced anything is therefore undoable: undo removes the
  pasted items and restores the replaced ones. *Narrows 024 FR-010's "no other operation is undoable".*
- **FR-018c**: A folder clashing with a folder MUST merge: non-clashing contents land, and each clashing item
  inside is asked about by FR-018. A copy pasted into the folder it came from is a duplicate, not a clash, and
  MUST take the non-clobbering name without a prompt; a cut pasted there MUST be a no-op.
- **FR-018d**: A paste that ran with no clash MUST NOT show the prompt.
- **FR-018f**: A new File Explorer setting MUST decide what Replace does with the item it overwrites: **Recycle Bin**
  (default) or **permanent**. It is independent of the delete setting (004 FR-018), and is shown in Preferences
  beside it. With **permanent**, the prompt's Replace choice MUST say it cannot be undone, the replaced item is
  deleted for good, and the paste's undo entry MUST NOT include the items that replaced something.
- **FR-018e**: A pasted or dragged folder MUST keep its whole directory structure: every file and subfolder lands at
  the same path relative to the folder, at every depth, including when it merges into an existing folder (FR-018c),
  where clashes are found and asked about at whatever depth they occur. Each separately selected item lands directly
  in the target folder, as today.
  *Last sentence superseded by FR-033 (Session 2026-10-03, fifth) — items selected from different folders keep
  their structure.*
- **FR-031**: A paste MUST show the FR-019 progress only when the items it pastes total **more than 5 MB** and it
  is still running after **1 second of its own work**; time during which a clash prompt (FR-017) or the cancel
  choice (FR-019a) is open does not count towards that second. A paste of 5 MB or less never shows progress; its
  failures still raise the one FR-013 notice. A queued paste is still shown at once (FR-019d). *Narrows FR-019's
  trigger; the progress itself is unchanged.*
- **FR-032**: The clash prompt MUST show the incoming item and the existing item each in **its own box**, side by
  side, with an **arrow** between them pointing from the incoming box to the existing box — the direction of the
  copy. The newer side MUST be **highlighted**, not only labelled. The prompt MUST leave clear space between its
  message, the two boxes, the "apply to all" choice and its buttons. *Extends FR-018.*
- **FR-033**: When the items pasted or dragged together sit in **different folders**, each MUST land under the
  target folder at its path relative to the **deepest folder that contains them all**, so their folder structure
  is kept: `/test/test.md` and `/test.md` pasted into `/test2/` land at `/test2/test/test.md` and
  `/test2/test.md`, within a project and across projects. A folder the structure needs is created; one that already
  exists is merged into (FR-018c), with clashes asked about where they occur. An item inside another selected
  folder travels with that folder, not separately. Items that share one folder land directly in the target, as
  before. A cut moves only the selected items; the folders they leave stay. Roll back (FR-019a) and undo (FR-020,
  FR-023) remove any folder the paste created. *Supersedes FR-018e's last sentence.*
- **FR-034**: During a file drag — from the File Explorer or from outside throng — every place that would not take
  the drop, including the Projects pane, MUST show the **no-entry** cursor, and releasing there MUST change nothing.
  Only a place that takes the drop shows the copy or move cursor (006 FR-092, FR-095). *Replaces the copy cursor a
  tree drag showed over anything that is not a drop target.*

**Progress and cancel**

- **FR-019**: A paste still running 1 second after it starts MUST show its progress — items done of total, and the
  item in progress — with a **Cancel** action. The progress MUST be shown in the window's notice area, inline and
  not as a toast, and MUST stay visible and cancellable whichever project is active, and it MUST be the same notice that then reports the paste's failures (FR-013), not a second one.
  *Extended by FR-039 (Session 2026-10-04, second) — a progress bar, and Cancel as its own icon on the right.*
  *Trigger narrowed by FR-031 (Session 2026-10-03, fifth) — only a paste of more than 5 MB, and prompt time does
  not count.*
- **FR-019a**: Cancelling a paste (from progress or from the clash prompt) MUST ask the user to choose:
  **Keep finished** — items that landed stay, the item in progress is removed in full and its source left intact,
  and items not yet started are skipped; or **Roll back** — every item the paste placed is removed, every moved
  item returns to its source, and every replaced item is restored from the Recycle Bin.
- **FR-019b**: After Keep finished, the undo entry MUST cover exactly the items that landed (FR-023). After Roll
  back, no undo entry is recorded. Items roll back could not restore MUST be named in the paste's one notice.
- **FR-019c**: A cancelled cut MUST leave the clipboard holding the items that did not move; a cancelled copy leaves
  the clipboard unchanged.
- **FR-019d**: A paste started while another is running MUST be queued and run, in order, once those before
  it finish. The progress MUST show queued pastes, and each MUST be cancellable before it starts, with nothing to
  keep or roll back. Each queued paste takes the clipboard's contents at the moment it was started.
- **FR-019e**: Progress, Cancel and the keep-or-roll-back choice (FR-019 – FR-019d) apply to **paste only**. A drag
  keeps today's behaviour: no progress and no cancel. It still gets the clash prompt (FR-017), and still waits behind
  a running paste, because file operations run one at a time.
- **FR-019f**: Quitting throng (or closing the window that holds the File Explorer) while a paste is running or
  queued MUST first ask the user to **Wait** — quit once the pastes finish — or **Cancel** them, with the FR-019a
  choice of Keep finished or Roll back. Dismissing the question abandons the quit and leaves the paste running.
  This question is asked before any unsaved-changes prompt, and is not asked when no paste is running.

**Undo**

- **FR-020**: A cross-project move MUST be recorded as **one** operation in both the source and the target
  project's undo stacks. Undoing or redoing it from either project MUST undo or redo it once and MUST update the
  other project's stacks to match. *Supersedes 024 FR-010's "MUST NOT cross projects" for this entry only.*
- **FR-021**: A cross-project entry MUST be validated (024 FR-008) against the real paths in both projects, and a
  refusal MUST be the 024 FR-008a error notice. It MUST persist and restore like any entry (024 FR-010a), and it
  counts towards the 50-entry bound of each stack it is in.
- **FR-022**: A copy across projects MUST NOT be undoable unless it replaced something (FR-018b), as a copy
  within a project is not (024 FR-010).
- **FR-023**: A cut-paste in which some items fail MUST record one undo entry covering exactly the items that
  moved; one undo returns all of them. A cut-paste in which every item fails records nothing. This applies to
  within-project pastes too, which today record nothing unless every item succeeds.

**Discoverability and keys**

- **FR-025**: Paste MUST be enabled in every File Explorer's context menu whenever the clipboard holds items,
  whichever project they came from (004 FR-020). The toolbar has no Paste control and none is added.
- **FR-025a**: The Paste context-menu item's label MUST name what will land: the item's name when there is one
  (`Paste "config.json"`), otherwise the count (`Paste 3 items`), followed by `from <project name>` when the items
  came from a project other than the active one. No other indicator of a pending clipboard is added.
- **FR-025b**: When a paste finishes, the File Explorer MUST reveal the items it placed — opening their folders —
  and select them, with the first focused. If the user switched project while it ran, this applies when they next
  show the target project, not by switching to it.
- **FR-026**: No new command or key binding is introduced, and the only new setting is FR-018f's; Cut, Copy, Paste, Undo and Redo keep their
  existing names and chords. The clash prompt and the cancel choice are keyboard-operable (Principle VI).

**Root row (#448)**

- **FR-030**: No keyboard gesture in the File Explorer may collapse the root row. Left arrow on the root row MUST
  leave the tree's expansion unchanged (004 FR-004).

**Panels a move takes out of their project** (Session 2026-10-04)

- **FR-035**: When a cut-paste, or the undo or redo of one, moves a file out of the project that owns an open
  editor or preview on it, that panel MUST stay where it is, show the file's new path in its header, become
  read-only, and show one inline notice: "This file moved to another project, at <new path>. You can no longer work
  on it in this project." The panel MUST let go of the file: it no longer counts as the file's editor (006
  FR-011a) and no longer watches or reads it, so the project the file moved to opens it normally. This applies to
  every panel of every project, on screen or not — a project shown later shows the notice, and raises no
  "Couldn't open" or "could not be read" notice for the file. Close and Copy are its actions. When an undo or redo
  brings the file back into the panel's own project, the panel becomes an ordinary editor or preview of it again,
  at that path, and the notice goes — unless another editor has opened the file meanwhile, in which case it keeps
  the notice. *(The return is derived from undo's purpose of restoring the state before the move; not confirmed by
  the user.)* *Narrows FR-016 for editors and previews; a move within a project is unchanged.*
  *Amended (Session 2026-10-04, second — MT-05): a moved-out preview MUST show the notice itself even when it
  rendered the file before it was last unmounted, and MUST refuse to open or focus its linked editor — every entry
  point for that action is unavailable while it is moved out, and invoking it shows the notice again. The notice
  goes only when main reports the file back in the panel's project (an undo or redo).*
- **FR-036**: An editor under FR-035 with unsaved changes MUST keep them. Save MUST be unavailable; Save As MUST be
  available, MUST open in the file's new folder, and MUST be allowed to save anywhere in the project the file moved
  to — the one exception to editor save confinement (006 FR-084). A Save As there makes the panel an ordinary
  editor of that project's file; anything else keeps FR-035.
  *Amended (analyze, Session 2026-10-04): after that Save As the panel stays under FR-035 — clean, read-only, its
  notice naming the path it saved to. It never becomes an editor of another project's file, which its own project's
  confinement would refuse on the next load. Closing such an editor with unsaved changes asks Save As, Discard or
  Cancel. (Both derived from FR-035 and 006 FR-084; not confirmed by the user.)*
- **FR-037**: Copy on a notice or a panel banner MUST place every line the notice shows on the clipboard, in the
  order and words shown, followed by a blank line, `Details`, and the parts that are never shown: the subject in
  the full form of 030 FR-022, each affected row's path and reason, and the raw system error. A shown line with no
  panel MUST be copied like any other. *Supersedes 030 FR-048's and FR-052's order; 030 FR-034, FR-048a, FR-049
  and FR-050 stand.*
- **FR-038**: A single file dragged from a File Explorer and dropped on the tab strip's + button MUST open a new tab
  with the file in an editor, without the rename box a click on + opens. A file already open in an editor focuses
  that editor instead (006 FR-011a). A folder, or several items, MUST show the no-entry cursor over + (FR-034).
  *Amended (Session 2026-10-04, second): the file opens as its default open action names (047 FR-077) — a preview
  when that is Preview — in the new tab's ONE panel; an editor already open on it is focused only when it opens as
  an editor (044 FR-053 governs a preview).*
- **FR-039**: The paste progress notice (FR-019) MUST show a progress bar filled by the bytes copied of the paste's
  total bytes, with "N of M files" and the size done of the total size beside it; until the total is known the bar
  MUST animate without a fill. Its Cancel MUST be a dedicated themed cancel icon — never the dismiss glyph —
  aligned to the right of the notice and set apart from its text, with the hover title "Cancel paste". The bar and
  icon take their colours from theme tokens, and the animation stops under reduced motion. The bar is part of every
  progress notice, which FR-031 already limits to pastes of more than 5 MB. A cross-volume cut counts its copy's
  bytes; the delete that follows adds none.

### Key Entities

- **File clipboard**: one per running application. Holds a mode (cut or copy) and an ordered list of pending items,
  each an absolute path with the project it was taken from. Empty, or holding items from exactly one project.
- **Cross-project move entry**: one undoable operation naming, for each item, its absolute path before and after,
  and the two projects it spans. Present in both projects' undo stacks at once; undoing it in one removes it from
  the other's undo stack and offers it in both redo stacks.
- **Clash decision**: the user's choice for one clashing item — Replace, Skip or Keep both — or for every remaining
  clash in the paste. Lives only for the paste it was made in.
- **Paste run**: one paste in progress: its items, which have landed, which replaced something, and which is in
  progress. It is what Cancel, Keep finished and Roll back act on, and what the undo entry is built from.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user moves or copies a file from one project into another without leaving throng, in at most four
  actions (cut or copy, switch project, select a folder, paste).
- **SC-002**: After a cross-project move, every editor and preview that had the file open shows it at its new path,
  with 0 notices and 0 panels marked dirty that were not dirty before.
  *Superseded by SC-012 (Session 2026-10-04) for panels the move takes out of their project.*
- **SC-003**: A cross-project move is undone from either project in one keystroke, and 100% of an undone move's
  items are back at their original paths.
- **SC-004**: A paste of N items in which K fail raises exactly one notice, names all K, and leaves the other N−K
  pasted.
- **SC-005**: Left arrow on the root row leaves 100% of the root's children visible, every time.
- **SC-006**: 0 items are overwritten, renamed or refused because of a name clash without the user choosing it.
- **SC-007**: After a cancelled paste rolled back, the target folder and every source match their state before the
  paste, for every item roll back could restore; any it could not are named.
- **SC-008**: A paste running longer than 1 second shows progress within 1 second of starting, and Cancel stops it
  before the next item begins.
  *Narrowed by SC-009 (Session 2026-10-03, fifth) — applies to a paste of more than 5 MB.*
- **SC-009**: A paste of 5 MB or less raises 0 progress notices, however long its clash prompt stays open.
- **SC-010**: Items selected from different folders land 100% at their source paths relative to the deepest folder
  holding them all, under the paste target.
- **SC-011**: Over every place a file drag cannot be dropped, the pointer shows the no-entry cursor, and a release
  there changes 0 files.
- **SC-012**: After a cross-project move, or its undo, every editor and preview left behind shows exactly 1 moved
  notice and 0 "Couldn't open" or "could not be read" notices, and the destination project opens the file on the
  first attempt.
- **SC-013**: For every notice and banner, 100% of the lines shown appear on the clipboard after Copy, in the order
  shown.
- **SC-014**: A paste showing progress has a bar whose fill matches the bytes copied to within one file, and a
  cancel control the user does not mistake for dismiss.

## Assumptions

- Only the main window hosts a File Explorer today (018 FR-062, 026). FR-002 holds for any window that hosts one,
  and costs nothing while there is one.
- Progress (FR-019) applies to every paste, within or across projects, and to no drag (FR-019e); the 1-second threshold keeps it off small
  pastes. Cancel takes effect between items and inside a large file's copy, never leaving a half-written item.
  *The threshold is superseded by FR-031 (Session 2026-10-03, fifth): 1 second of work AND more than 5 MB, because a
  clash prompt held a small paste open past 1 second and raised a second notice beside it.*
- The clash prompt reuses the application's existing confirmation dialog surface; no new modal kind is introduced.
- FR-013's continue-past-failure rule changes today's within-project behaviour, which stops at the first failure.
  No existing requirement asks for the stop: the 006 multi-item delete already carries on past a failure and
  reports once, and this aligns paste with it.
- A cross-project move entry exists only while both projects exist; removing either project drops the entry from
  the other's stacks.
- Dragging files onto another project in the project list, and anything involving the OS clipboard or OS drag
  (#8), are out of scope.
