# Feature Specification: File & Folder Tree in the File Explorer Pane

**Feature Branch**: `004-file-explorer-tree`

**Created**: 2026-06-29

**Status**: Planned (clarified; plan + tasks generated)

**Input**: User description: "I want to implement the file and folder list in the right-hand pane.
Whenever the project changes, the file list switches to the project folder. The pane is synchronised
with changes made to the folder (in-app or external); shows a tree of folders and files; starts with
all folders collapsed except the root; can use a popular OSS file-browser package; is styled and
themed; shows a same-sized themed icon next to each file/folder (expand/contract for folders,
file-type icon for files); supports select / rename / move / cut / copy / paste / delete with
well-known keyboard shortcuts mapped in keybindings.json (F2, Ctrl+X, Ctrl+C, Ctrl+V, Del) plus
mouse operations (drag, shift+drag, ctrl+drag); has an extensible right-click context menu covering
all file operations; and opens a file on either single or double click (a settings toggle, default
single click), with the open action deferred to a later feature."

## Context

This feature delivers the **navigable file tree** that fills the **File Explorer Pane**, which
feature 003 shipped as an empty placeholder. The constitution records this tree as an end-state
requirement (Principle I — "expose its root folder as a navigable workspace folder structure";
Principle XI — "a File Explorer Pane on the right showing the active project's file and folder
hierarchy") that was **staged-deferred** under the Incremental Delivery rule. Feature 004 lands the
tree content. The Markdown/document **preview** capability (Principle I) remains a separate later
increment and stays out of scope here.

The pane is **project-scoped**: it always reflects the **active project's root folder** and follows
the project-first isolation model. The pane's visibility/width and the collapsible-pane shell already
exist (003); this feature fills the pane body.

## Clarifications

### Session 2026-06-29

- Q: When the user deletes a file/folder from the tree, what should happen to it? → A: Configurable —
  send to the OS Recycle Bin by **default**, with a settings toggle for **permanent** delete
  (permanent deletes are confirmed).
- Q: What drag-and-drop modifier convention should the tree use for move vs copy? → A: Plain
  **drag = move** within the project; **Ctrl+drag = copy** (Windows Explorer / VS Code convention).
- Q: How should hidden files and noisy folders be shown by default? → A: Hide entries matching a
  **default exclude glob list** (use the **VS Code `files.exclude` defaults** — `**/.git`,
  `**/.svn`, `**/.hg`, `**/CVS`, `**/.DS_Store`, `**/Thumbs.db`); the list is **user-editable in
  settings**.
- Q: How should the project root appear at the top of the tree? → A: Show a single **root row labelled
  with the root folder name**, always expanded and **not collapsible** — only **subfolders** can be
  collapsed/expanded.
- Q: For the 'New folder' toolbar button, where is the folder created given the selection, and does it
  start an inline rename? → A: Target = selected folder (inside it) / selected file (its parent) /
  nothing selected (project root) / multiple selected (the anchor item's folder); the new folder is
  created with a default name and **immediately enters inline rename** (VS Code behaviour).
- Q: When 'Open in file explorer' is used on a folder (including the root), what should the OS file
  manager show? → A: **Open the folder's contents** (open the folder itself). For a **file**, reveal
  it **selected in its parent** folder.

> **New requirements added this session** (from the 2026-06-29 follow-up): a **pane toolbar**
> (Expand all / Collapse all / New folder) and an **"Open in file explorer"** context-menu action.
> Captured as FR-031–FR-035 below.

- Q: How should entries within a folder be sorted? → A: **Folders first, then files**, each group
  sorted **case-insensitive A–Z** (VS Code default).
- Q: How should symbolic links / junctions be handled when their target is outside the project root?
  → A: **Show** links (with an indicator) but **do not follow** them out of the root; never recurse
  cycles; any file operation that would resolve a link's target **outside the project root is
  rejected** (no confinement escape).
- Q: What should 'Expand all' do on a very large tree? → A: **Expand only already-loaded levels** —
  expand folders whose contents are already loaded/visible; do **not** eagerly read deeper, unread
  folders (keeps it fast and bounded).
- Q: When pasting or dropping onto a file (not a folder), or pasting with no selection, where do the
  items land? → A: **Into the target item's parent folder** — paste/drop onto a **file** → its
  **parent**; onto a **folder** → **that folder**; **nothing selected** → the **root** (consistent
  with the New-folder target rules, FR-033).

### Session 2026-06-30

> Folded in via `/speckit-converge` ("all changes into the spec"): additions and refinements made
> during implementation, all already built and E2E-verified.

- **Delete confirmation**: **every** delete (menu / Del / toolbar) now requires a **single
  confirmation** (not just permanent deletes) — FR-018, SC-009.
- **Cut affordance**: a cut item is **greyed** until pasted; **Escape** cancels the cut and clears the
  clipboard — FR-017, SC-015.
- **New folder UX**: creating into a **collapsed** target folder **expands** it first, and the default
  name is **fully selected** so typing overwrites it — FR-033, SC-015.
- **Toolbar Delete**: a **Delete** button is added to the pane toolbar (alongside Expand all /
  Collapse all / New folder) — FR-031.
- **Per-project Hide (new)**: a right-click **"Hide in this project"** hides a specific file/folder
  from the view (not disk), **project-scoped and persisted with the project** (durable store),
  combined additively with `excludeGlobs`. In-app un-hide/edit is deferred — FR-038/FR-039, SC-016.
  This is a **deliberate scope addition** beyond the original plan: it adds a small persistence change
  (a per-project hidden-paths field + a `setHidden` operation) to the otherwise migration-free 004.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - See the active project's files as a tree (Priority: P1)

A user with a selected project sees, in the right-hand File Explorer Pane, a tree of the folders and
files under the project's root folder. The root is shown expanded (its immediate children visible);
every subfolder starts collapsed. Each entry shows a same-sized, theme-styled icon — folders show an
expand/collapse chevron reflecting their state, files show an icon chosen by file type. When the user
switches the active project, the tree switches to that project's root. When no project is active, the
pane shows the existing empty placeholder.

**Why this priority**: This is the core deliverable and the smallest viable slice — a read-only,
themed, project-scoped tree is independently useful and unblocks every later capability (sync, file
ops, open-on-click). It directly satisfies the deferred constitution requirement.

**Independent Test**: Select a project whose root has nested folders/files; verify the pane renders
the root's children with the root expanded and subfolders collapsed; expand a subfolder and verify
its children appear; verify each row shows one fixed-size themed icon; switch projects and verify the
tree swaps to the new root; start with no project and verify the placeholder.

**Acceptance Scenarios**:

1. **Given** a project with a populated root folder is active, **When** the File Explorer Pane is
   shown, **Then** the tree lists the root folder's immediate children with the root expanded and all
   subfolders collapsed.
2. **Given** the tree is shown, **When** the user expands a collapsed folder, **Then** that folder's
   immediate children appear and the folder's icon changes to its expanded state.
3. **Given** project A's tree is shown, **When** the user switches the active project to B, **Then**
   the pane replaces A's tree with B's root tree (collapsed except B's root).
4. **Given** no project is active, **When** the File Explorer Pane is expanded, **Then** it shows the
   neutral empty placeholder (no tree).
5. **Given** the active theme defines tree colours, fonts and icons, **When** the tree renders,
   **Then** every colour, font and icon resolves from the active theme and all icons share identical
   dimensions; **When** the theme is swapped/hot-reloaded, **Then** the tree re-paints without a
   restart.

---

### User Story 2 - The tree stays in sync with the folder (Priority: P2)

While the tree is shown, any change to the project folder is reflected automatically — whether the
change is made inside the app (rename, move, delete, paste) or by an external process (another
program creates/renames/deletes a file, a build writes output, the user edits in another tool). The
user never has to manually refresh.

**Why this priority**: A stale tree is misleading and erodes trust; live sync is a defining
expectation of a file explorer and is required by the user. It builds directly on P1.

**Independent Test**: With the tree shown, create, rename, and delete a file in the project folder
using an external tool; verify each change appears in the tree within a short, bounded delay without
a manual refresh; perform the same operations through the app and verify the tree reflects them too.

**Acceptance Scenarios**:

1. **Given** the tree is shown, **When** a new file or folder is created in a currently-visible
   (expanded) folder by an external process, **Then** it appears in the tree automatically.
2. **Given** the tree is shown, **When** a visible file is deleted or renamed externally, **Then**
   the tree updates to reflect the deletion/rename automatically.
3. **Given** a folder is collapsed, **When** its contents change externally, **Then** the change is
   reflected when (or before) the user next expands it, with no stale contents shown.
4. **Given** the user performs a file operation through the app, **When** the operation completes,
   **Then** the tree reflects the result through the same sync path (no separate, divergent update).
5. **Given** the user's expansion and selection state, **When** an unrelated part of the tree changes,
   **Then** the user's current expanded folders and selection are preserved where the affected nodes
   still exist.

---

### User Story 3 - Operate on files and folders (Priority: P3)

The user manages files and folders directly from the tree: select (single and multi-select), rename,
move, cut, copy, paste, and delete. These are available through well-known keyboard shortcuts (F2 to
rename, Ctrl+X cut, Ctrl+C copy, Ctrl+V paste, Del delete), through mouse operations (drag to move,
Shift+drag and Ctrl+drag for range/additive selection or copy-move semantics), and through a
right-click context menu that lists every operation and can be extended with more items as the
feature grows. All shortcut bindings are defined in `keybindings.json` so they can be re-mapped.

**Why this priority**: Editing the workspace from the tree is the practical payoff, but it depends on
a working, synced tree (P1+P2). Delivering it after sync keeps each slice independently shippable.

**Independent Test**: With a synced tree, rename a file via F2, cut/paste it into another folder, copy
a folder and paste it, delete a file via Del, and drag a file into a folder; verify each operation
succeeds on disk and is reflected in the tree; open the context menu and verify it offers all
operations; re-map a shortcut in `keybindings.json` and verify the new binding takes effect.

**Acceptance Scenarios**:

1. **Given** a node is selected, **When** the user presses the rename shortcut (default F2), **Then**
   an inline rename begins; on commit the entry is renamed on disk and in the tree; an invalid or
   conflicting name is rejected with a clear message and the rename stays open.
2. **Given** one or more nodes are selected, **When** the user cuts (Ctrl+X) then pastes (Ctrl+V)
   into a target folder, **Then** the nodes are moved on disk into the target and the tree updates.
3. **Given** one or more nodes are selected, **When** the user copies (Ctrl+C) then pastes (Ctrl+V)
   into a target folder, **Then** copies are created in the target (with a non-clobbering name on
   collision) and the tree updates.
4. **Given** one or more nodes are selected, **When** the user deletes (default Del), **Then** the
   nodes are deleted (subject to the project's delete-confirmation behaviour) and removed from the
   tree.
5. **Given** the tree, **When** the user drags a node onto a folder, **Then** the node is moved into
   that folder; **When** modifier keys are used (e.g. Ctrl+drag), **Then** the copy/move semantics
   follow the documented convention.
6. **Given** any node, **When** the user right-clicks it, **Then** a context menu appears offering the
   actionable operations rename/cut/copy/paste/delete and "Open in file explorer" (paste enabled only
   when the clipboard holds items), and the menu is structured so new items can be added later.
   (Selection is performed by clicking the node before opening the menu; "move" is achieved via
   cut+paste or drag, so neither is a separate menu entry.)
7. **Given** a shortcut is changed in `keybindings.json`, **When** the config hot-reloads, **Then**
   the tree honours the new binding for that action.
8. **Given** the pane toolbar, **When** the user clicks **Collapse all**, **Then** every subfolder
   collapses while the root row stays expanded; **When** the user clicks **Expand all**, **Then** all
   **already-loaded** folders expand (excluded entries stay hidden) without eagerly reading unread
   subfolders or freezing.
9. **Given** a folder is selected, **When** the user clicks **New folder**, **Then** a new folder is
   created inside it with a default, non-clobbering name and immediately enters inline rename; **When**
   nothing is selected, **Then** the new folder is created in the project root.
10. **Given** any node (file, folder, or root), **When** the user chooses **Open in file explorer**,
    **Then** the OS file manager opens — a file is shown selected in its parent; a folder/root opens
    showing its own contents.

---

### User Story 4 - Choose how a click opens a file (Priority: P4)

The user can open a file from the tree. By default a **single click** on a file triggers "open"; the
user can switch to **double click** via a toggle in settings. The actual destination of "open" (which
editor, where it appears, how editing works) is **deferred** — for this feature, "open" raises a
well-defined open-file intent that a later feature will route to an editor.

**Why this priority**: Opening files is valuable but depends on the tree existing and is intentionally
shallow here (the editor is future work), so it is the lowest priority of the four and safe to land
last.

**Independent Test**: With single-click mode (default), single-click a file and verify exactly one
open-file intent is raised for that path (and a single click on a folder toggles its expansion, not
an open). Switch the setting to double-click; verify a single click no longer opens and a double
click raises exactly one open-file intent. Verify no editor is required for the test (the intent is
observable on its own).

**Acceptance Scenarios**:

1. **Given** open-on-single-click (default), **When** the user single-clicks a file, **Then** exactly
   one open-file intent is raised for that file's path.
2. **Given** open-on-double-click, **When** the user single-clicks a file, **Then** no open intent is
   raised (the file is only selected); **When** the user double-clicks the file, **Then** exactly one
   open intent is raised.
3. **Given** either mode, **When** the user clicks a folder, **Then** the folder toggles expansion and
   no open-file intent is raised.
4. **Given** the open-mode setting, **When** it is changed in settings and hot-reloaded, **Then** the
   tree honours the new mode without a restart.

---

### Edge Cases

- **No project active**: pane shows the empty placeholder; no tree, no file ops.
- **Empty project root**: tree shows the root with no children (an empty-folder affordance), not an
  error.
- **Permission denied / unreadable folder**: the folder is shown but its expansion surfaces a
  non-fatal "cannot read" state rather than crashing or silently appearing empty.
- **Very large folders** (thousands of entries): the tree remains responsive (virtualised rendering);
  expansion does not freeze the UI.
- **External change to a collapsed subtree**: no stale contents are shown; contents are (re)read on
  expand.
- **Rename/paste/move name collision**: rejected (rename) or de-duplicated with a non-clobbering name
  (copy), per documented rules; never silently overwrites without consent.
- **Move/paste into a descendant of itself**: rejected with a clear message.
- **Operating on the project root itself**: the root row cannot be renamed/moved/deleted **or
  collapsed** from the tree (it is the project's bound folder; see Principle I exclusivity).
- **Recycle Bin unavailable** (e.g. network path, OS refusal): in default (Recycle Bin) mode the tree
  surfaces a non-fatal error rather than silently deleting permanently; the item is left in place.
- **Excluded entry that the user needs**: hiding is driven by the editable exclude glob list; removing
  a pattern from settings reveals the matching entries on hot-reload.
- **Expand all on a large tree**: expands only already-loaded levels (no eager deep reads), so it
  stays bounded and responsive; excluded entries are not expanded/revealed.
- **New folder default-name collision**: the default name is de-duplicated (e.g. `New folder`,
  `New folder (2)`) before inline rename.
- **Open in file explorer on a deleted/missing path**: surfaces a non-fatal error instead of failing
  silently or crashing.
- **Path leaves the project root**: operations are confined to the project root; a target outside the
  root is rejected.
- **Symlinks / reparse points**: shown with an indicator but not followed out of the root; cycles are
  not expanded endlessly; operations resolving outside the root are rejected (FR-037).
- **Watcher gap / missed event**: the tree can reconcile (re-read on expand / on focus) so a missed
  filesystem event does not leave it permanently wrong.
- **Hidden/system files**: hidden when they match the active exclude glob list (default = VS Code
  `files.exclude` defaults); dotfiles **not** in the list are shown.
- **A file currently "open"** (future editor) that is deleted/renamed externally: the tree reflects
  the filesystem; coordinating the editor is future work.
- **Theme missing tree tokens**: falls back to the default "throng" theme tokens (consistent with 003
  theming).

## Requirements *(mandatory)*

### Functional Requirements

**Tree display & project scope**

- **FR-001**: The File Explorer Pane MUST render the **active project's root folder** as a tree of
  folders and files scoped to that root.
- **FR-002**: On project switch, the pane MUST replace the displayed tree with the newly-active
  project's root tree.
- **FR-003**: When no project is active, the pane MUST show the existing empty placeholder and no
  tree.
- **FR-004**: The tree MUST show a single **root row labelled with the root folder name** at the top.
  This root row MUST be **always expanded and NOT collapsible** by the user (its immediate children
  are always visible); only **subfolders** may be expanded/collapsed. The initial view MUST show
  **all subfolders collapsed**.
- **FR-005**: Each entry MUST display exactly one **icon** of **uniform dimensions**: subfolders show
  an expand/collapse (chevron) icon reflecting their expanded/collapsed state (the non-collapsible
  root shows an open-folder icon without a collapse affordance); files show an icon chosen by **file
  type**.
- **FR-005a**: The tree MUST **hide** entries whose path matches the active **exclude glob list**. The
  default list MUST be the **VS Code `files.exclude` defaults** (`**/.git`, `**/.svn`, `**/.hg`,
  `**/CVS`, `**/.DS_Store`, `**/Thumbs.db`). The list MUST be **user-editable** in `settings.json`
  and applied (hot-reloaded) without a restart.
- **FR-006**: All tree colours, fonts and icons MUST resolve from the **active theme**, and MUST
  re-paint on a theme swap/hot-reload without a restart (consistent with 003 theming).
- **FR-007**: Folders MUST be expandable/collapsible by the user; expanding a folder reveals its
  immediate children.
- **FR-008**: The tree MUST remain responsive for large folders (no UI freeze when listing or
  expanding folders with many entries).

**Live synchronisation**

- **FR-009**: The tree MUST stay synchronised with the project folder for changes made **externally**
  (by other processes/tools) and **in-app**, without requiring a manual refresh.
- **FR-010**: Creation, deletion, and rename/move of entries within currently-visible (expanded)
  parts of the tree MUST be reflected automatically within a short, bounded delay.
- **FR-011**: Changes within a **collapsed** subtree MUST NOT show stale contents; contents MUST be
  (re)read on expansion.
- **FR-012**: In-app file operations MUST be reflected through the **same** synchronisation path used
  for external changes (a single source of truth, no divergent update).
- **FR-013**: On a routine update, the user's current **expansion state** and **selection** MUST be
  preserved for nodes that still exist.
- **FR-014**: The tree MUST be able to **reconcile** after a missed/dropped filesystem event (e.g.
  re-read on expand or on pane focus) so it cannot remain permanently incorrect.

**File & folder operations**

- **FR-015**: The user MUST be able to **select** a single node and **multi-select** multiple nodes
  (range and additive selection via the conventional Shift / Ctrl modifiers).
- **FR-016**: The user MUST be able to **rename** a node (default **F2**), with inline editing;
  invalid or conflicting names MUST be rejected with a clear message and without losing the edit.
- **FR-017**: The user MUST be able to **cut** (default **Ctrl+X**), **copy** (default **Ctrl+C**),
  and **paste** (default **Ctrl+V**) nodes; cut+paste **moves**, copy+paste **copies**; paste is only
  available when the clipboard holds items. The **paste target folder** follows the **shared
  target-resolution rule** (the single canonical definition referenced by FR-019 and FR-033): target a
  **folder** → that folder; a **file** → its **parent** folder; **multiple items selected** → the
  **anchor** item's folder; **nothing selected** → the project **root**. A node placed on the clipboard
  by **cut** MUST be shown **greyed** until it is pasted; pressing **Escape** MUST cancel the cut and
  clear the clipboard.
- **FR-018**: The user MUST be able to **delete** nodes (default **Del**, the context menu, or the
  toolbar **Delete** button). **Every delete MUST be preceded by a single confirmation prompt**
  (reusing the app confirmation dialog); cancelling leaves the items untouched. Deletion mode is a
  **setting**: by **default** deleted nodes are sent to the **OS Recycle Bin** (recoverable); the user
  may switch to **permanent** deletion in settings. The confirmation wording reflects the active mode
  (recoverable vs. irreversible).
- **FR-019**: The user MUST be able to **move** nodes by **drag-and-drop** onto a target. Drop targets
  follow the **shared target-resolution rule** (FR-017). Modifier semantics MUST follow the Windows/VS
  Code convention:
  **plain drag = move** within the project; **Ctrl+drag = copy**. Shift/Ctrl modifiers on **click**
  MUST drive range/additive selection.
- **FR-020**: A **right-click context menu** MUST offer the actionable operations
  **rename / cut / copy / paste / delete** plus **"Open in file explorer"** (FR-035), MUST disable
  inapplicable items (e.g. paste with an empty clipboard), and MUST be structured so further items can
  be added as the feature grows. (Selection is performed by clicking; "move" is achieved via cut+paste
  or drag — neither is a literal menu entry.)
- **FR-021**: All keyboard shortcuts for tree operations MUST be defined as named actions in
  **`keybindings.json`** (re-mappable, hot-reloaded), consistent with the 003 keybindings model.
- **FR-022**: File operations MUST be **confined to the active project's root**; a source or target
  outside the root, or a move/paste into a node's own descendant, MUST be rejected with a clear
  message. Confinement MUST be evaluated against **resolved real paths**, so an operation whose source
  or target resolves (via a symlink/junction) **outside** the root MUST also be rejected (FR-037).
- **FR-023**: The **project root folder itself** MUST NOT be renamed, moved, or deleted from the tree
  (it is the project's exclusively-bound folder per Principle I).
- **FR-024**: Name collisions MUST be handled per documented rules: rename to an existing name is
  rejected; copy/paste onto an existing name produces a non-clobbering name; no silent overwrite
  without user consent.
- **FR-025**: A failed file operation (permission denied, missing target, I/O error) MUST surface a
  non-fatal error and leave the filesystem and tree in a consistent state.

**Open-on-click**

- **FR-026**: Clicking a **file** MUST raise a single, well-defined **open-file intent** carrying the
  file's path; the destination/editor of that intent is **out of scope** (deferred to a later
  feature).
- **FR-027**: The trigger for "open" MUST be a **settings toggle** between **single click**
  (default) and **double click**, hot-reloaded like other settings; in double-click mode a single
  click only selects.
- **FR-028** *(SUPERSEDED by feature 019, #121 — see `specs/019-v1-bug-sweep/spec.md` FR-032)*:
  ~~Clicking a **folder** MUST toggle its expansion~~ and MUST NOT raise an open-file intent.
  **Superseded for the toggle half:** as of feature 019 (#121) only the folder **chevron** toggles
  expansion — clicking the folder **name** or **glyph** selects only. The "MUST NOT raise an open-file
  intent" half is unchanged and still holds.

**Architecture & seams** (constitutional)

- **FR-029**: All filesystem access (reading directory entries, watching for changes, performing file
  operations) MUST sit behind **OS-abstraction seams** (Principle II); the renderer MUST NOT access
  the filesystem directly (it is sandboxed).
- **FR-030**: The active project's root folder path MUST be sourced from the existing project model
  (the bound root from Principle I), not re-derived or hardcoded.

**Pane toolbar & OS integration**

- **FR-031**: The File Explorer Pane MUST show a **toolbar** above the tree containing **icon
  buttons**, themed like the rest of the pane (icons resolved from the active theme, uniform
  dimensions). The toolbar is shown whenever the tree is shown (a project is active). The toolbar's
  actions are **Expand all** + **Collapse all** (FR-032), **New folder** (FR-033), and **Delete**
  (deletes the current selection via the confirmed delete of FR-018).
- **FR-032**: The toolbar MUST provide **Expand all** and **Collapse all** actions. **Collapse all**
  collapses every subfolder (the non-collapsible root row remains expanded; FR-004). **Expand all**
  expands only folders whose contents are **already loaded/visible**; it MUST NOT eagerly read deeper,
  not-yet-loaded folders (keeping it fast and bounded on large trees). Excluded entries (FR-005a) are
  not revealed.
- **FR-033**: The toolbar MUST provide a **New folder** action (button + icon). The target folder
  follows the **shared target-resolution rule** (FR-017): a **selected folder** → inside it; a
  **selected file** → its parent folder; **multiple selected** → the **anchor** item's folder;
  **nothing selected** → the project **root**. The new
  folder is created with a **default name**, de-duplicated to a non-clobbering name on collision
  (FR-024), and **immediately enters inline rename** (FR-016). If the target folder is **collapsed**,
  it MUST first be **expanded** so the new folder is visible; the default name MUST be **fully
  selected** so typing immediately overwrites it. Creation is confined to the project root (FR-022).
- **FR-034**: Toolbar actions MUST be discoverable (icon + accessible label/tooltip) and themed; they
  operate on the current tree/selection state and reflect their results through the same sync path
  (FR-012).
- **FR-035**: The context menu MUST offer **"Open in file explorer"** for **every** node — files,
  folders, **and the root**. For a **file**, it MUST open the OS file manager with the file
  **selected in its parent** folder; for a **folder** (including the root), it MUST open that
  **folder's contents**. This OS-specific action MUST sit behind an **OS-abstraction seam**
  (Principle II); a target that no longer exists MUST surface a non-fatal error.

**Ordering & links**

- **FR-036**: Within each folder, entries MUST be ordered **folders first, then files**, each group
  sorted **case-insensitive A–Z** by name.
- **FR-037**: Symbolic links / junctions MUST be **shown** (with a visual indicator) but **not
  followed out of the root**: the tree MUST NOT recurse link cycles, and any operation whose resolved
  target lies outside the project root MUST be rejected (FR-022). Links are not auto-expanded across
  the root boundary.

**Project-scoped hide**

- **FR-038**: The user MUST be able to **hide** a specific file or folder from the tree via a
  right-click **"Hide in this project"** action on any non-root node. A hidden entry is removed from
  the **view only** (never deleted from disk), applied **in addition to** the global exclude glob list
  (FR-005a). Hiding MUST take effect immediately and MUST preserve the rest of the tree's expansion.
- **FR-039**: The hidden set MUST be **project-scoped** and **persisted with the project** in the
  durable project store, so it is independent per project and survives restart. Hidden paths are
  combined **additively** with `excludeGlobs` when filtering. (In-app management — viewing/un-hiding
  and editing the list — is a later increment; for now entries are only added.)

### Key Entities *(include if feature involves data)*

- **File System Node**: a file or folder under a project root. Attributes (no implementation): name,
  path relative to the root, kind (file/folder), whether it is a **symlink/junction** (shown but not
  followed out of root), and for folders whether it has children. Identity is its path within the
  project root. Siblings are ordered folders-first then case-insensitive A–Z (FR-036).
- **Tree View State**: the user's current expansion set and selection for the active project's tree,
  plus scroll position; transient/session UI state (persistence of expansion across sessions is an
  open question — see Assumptions).
- **Clipboard (cut/copy buffer)**: the set of nodes marked for move (cut) or copy, and which mode,
  pending a paste.
- **Explorer Settings**: tree-related preferences stored in the existing user `settings.json` section
  model — the **open-on-click mode** (single/double, default single), the **delete mode**
  (recycle/permanent, default recycle), and the **exclude glob list** (default = VS Code
  `files.exclude` defaults, user-editable).
- **Open-File Intent**: a request to open a specific file path, emitted by the tree and consumed by a
  future editor feature.
- **Project Hidden Paths**: a per-project list of root-relative paths the user has hidden from the
  tree (FR-038/FR-039), **persisted with the project** in the durable project store, applied in
  addition to the exclude glob list. In-app management (view / un-hide / edit) is deferred.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: With a project active, a user can see and navigate the project's folder structure in the
  pane (expand/collapse folders, see files) without any instruction.
- **SC-002**: After switching the active project, the pane shows the new project's root tree (and only
  that project's files) within the project-switch budget inherited from 003 (≤ ~200 ms perceived).
- **SC-003**: An external create/delete/rename within a visible folder is reflected in the tree within
  a short bounded delay (target ≤ 1 s) with no manual refresh.
- **SC-004**: A user can rename, move (cut+paste and drag), copy, and delete files/folders entirely
  from the tree (keyboard, mouse, and context menu) and each change is correct on disk and in the
  tree.
- **SC-005**: Every tree colour, font and icon comes from the active theme; switching themes
  re-paints the tree with no restart and all icons remain identically sized.
- **SC-006**: With default settings, a single click on a file raises exactly one open-file intent;
  after toggling to double-click, a single click does not and a double click raises exactly one.
- **SC-007**: All tree keyboard shortcuts are present in `keybindings.json` and a user re-mapping one
  changes the in-app behaviour after hot-reload.
- **SC-008**: The tree remains responsive (no perceptible freeze) when expanding a folder containing
  thousands of entries.
- **SC-009**: **Every** delete is gated by a single confirmation; cancelling leaves the items in
  place. In default mode the deleted item is recoverable from the OS Recycle Bin; after switching to
  permanent mode it does not reach the Recycle Bin.
- **SC-010**: Entries matching the default exclude list (e.g. `.git`) are hidden; removing the
  pattern in settings reveals them after hot-reload without a restart.
- **SC-011**: From the pane toolbar a user can Collapse all / Expand all and create a New folder in
  the correct target (selected folder / selected file's parent / root) with an immediate inline
  rename.
- **SC-012**: "Open in file explorer" opens the OS file manager for any node — a file shown selected
  in its parent, a folder/root showing its own contents.
- **SC-013**: Within every folder, subfolders are listed before files and each group is in
  case-insensitive alphabetical order.
- **SC-014**: A symlink/junction is shown but not traversed out of the project root, and a move/copy
  whose resolved target is outside the root is rejected with a clear message (no confinement escape).
- **SC-015**: A cut item appears greyed until pasted; pressing Escape cancels the cut and the greying
  clears. A New folder created in a collapsed folder expands that folder and selects the whole default
  name so typing overwrites it.
- **SC-016**: "Hide in this project" removes the selected file/folder from the tree (it remains on
  disk), affects only that project, is combined with the exclude globs, and persists across a restart.

## Assumptions

- **Builds on 003**: the File Explorer Pane shell, the collapsible-pane mechanism, the theming system
  (CSS custom properties + themed icon map), the `settings.json` / `keybindings.json` config model
  with hot-reload, the context-menu component, and the active-project state all already exist and are
  reused; this feature fills the pane body.
- **Daemon-owned filesystem** (to be confirmed in the plan): because the renderer is sandboxed and the
  daemon already owns project state and project-root filesystem watching (Principle VII), filesystem
  read/watch/operations for the tree are expected to be daemon-owned and exposed over IPC. The plan
  will finalise daemon-vs-UI-main ownership.
- **OSS tree component**: a popular open-source React tree/file-browser component will be used for the
  view layer (candidates evaluated in the plan, e.g. react-arborist, react-complex-tree), styled to
  the theme rather than adopting its default skin; the domain/sync/file-op logic stays in the app's
  own layers, not the component.
- **Open destination deferred**: "open file" raises an intent only; the editor, its placement, and
  editing behaviour are a separate future feature (consistent with the constitution's incremental
  delivery of the Markdown preview / editor).
- **Markdown/document preview is out of scope** for 004 and remains a tracked deferral.
- **Hidden/system files** (resolved): hidden via the editable exclude glob list (default = VS Code
  `files.exclude` defaults); other dotfiles are shown.
- **Drag modifier convention** (resolved): plain drag = move within the project; Ctrl+drag = copy.
- **Delete mode** (resolved): default = OS Recycle Bin (recoverable); permanent delete is an
  opt-in setting and is confirmed.
- **Root row** (resolved): a single non-collapsible root row labelled with the root folder name;
  only subfolders collapse/expand.
- **Expansion persistence across sessions**: treated as session-only unless the plan decides
  otherwise; not a stated requirement.
- **Real terminals/agents remain out of scope**; this feature does not depend on them.

## Dependencies

- Feature 003 (File Explorer Pane shell, theming, settings/keybindings config + hot-reload, context
  menu, active-project state, destroy-confirmation behaviour).
- Feature 002 (docking workspace, projects with bound root folders, daemon + IPC, persistence).
- The existing `IFileWatcher` seam and the daemon/UI-main filesystem ownership decided in the plan.
