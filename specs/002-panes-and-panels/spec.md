# Feature Specification: Panes & Panels Workspace

**Feature Branch**: `002-panes-and-panels`

**Created**: 2026-06-26

**Status**: Draft (substantially revised by clarification 2026-06-26)

**Input**: User description: "Let's build the Panes and Panels feature based on the requirements set out in the constitution."

## Overview

This feature replaces the placeholder "Hello World" landing page from the bootstrap
(001) with throng's real workspace: a project-scoped, VS Code-style docking surface that
the user can shape by dragging, grouping, splitting, tabbing, and tearing off content.

Two things are built for real in this iteration:

1. **Projects** — the user can **create, edit, delete, and switch** projects. Projects are
   **user-specific**: there is no login; the application runs as the logged-in operating-system
   user and stores all data in that user's local profile. Switching the active project swaps the
   whole workspace (and the sidebar's terminal list) to that project's saved arrangement.
2. **The docking workspace** — its **structure and interaction behaviour** (Panes, Tabs, split
   Panels, drag-and-drop grouping, tear-off sub-workspaces, and durable per-project persistence).

What is **not** built yet is the *content inside Panels*. A Panel will eventually be a **file
editor** (with edit/preview modes, e.g. for `.md`) or a **terminal**, but in this iteration every
Panel is a deliberately **empty placeholder**. That is intentional: the goal is to see the
projects, drag-and-drop, grouping, splitting, tabbing, and detaching all working before any real
editor or terminal exists.

### The workspace model (as clarified)

- The main window has **two top-level Panes** by default:
  - a **Left Pane (sidebar)** holding two **stacked** (non-tabbed) Panels — **Projects** (top:
    the project list + create/edit/delete/switch controls) and **Terminals** (bottom: the active
    project's terminal list, a placeholder in this iteration).
  - a **Right Pane (workspace)** showing the **active project's** workspace.
- The **Right Pane is a tab group**: it holds **one or more Tabs**, with one active.
- Each **Tab** contains a **split tree of Panels** — one or more Panels split into rows/columns to
  arbitrary depth. (Example: in a "SUBNET VAULT" project the workspace has three Tabs — Tab 1 split
  into five terminal Panels running npm commands, Tab 2 split into three agent Panels, Tab 3 a set
  of document Panels.)
- A **Panel** is the atomic content unit; in this iteration it is an empty placeholder.

### Detaching into sub-workspaces

- A whole **Tab** (with all its Panels) or a single **Panel** can be torn off into a separate
  operating-system window — a **sub-workspace**. Detaching a single Panel starts a new Tab group in
  the sub-workspace.
- A sub-workspace holds **one or more Tabs** and **may mix** Tabs/Panels from **several projects**.
- The main window and every sub-workspace window form **one focus/stacking group**.
- **Merging back**: only **Panels** can be reattached to the main workspace, and only into **their
  original project's** workspace. The **main workspace never mixes Panels from different projects**;
  cross-project mixing exists only inside sub-workspaces.

> **Constitution alignment (Principle XI) — applied in v3.0.0**: This model — two default Panes
> (sidebar + workspace), a workspace that is a tab group, Tabs that contain split trees of Panels,
> Panels that are editors/terminals, and tear-off sub-workspaces with cross-project mixing and
> merge-to-original-project rules — **superseded** the three-Pane / Middle-tabbed model and was
> landed in **Constitution v3.0.0** (2026-06-26) by renaming/redefining Principle XI (with
> Principle I "Projects" now directly built here). `/speckit-plan`'s Constitution Check gate is
> therefore consistent with this spec. See the Clarifications note.

## Clarifications

### Session 2026-06-26

> Note: the workspace model was **substantially revised mid-session**. Where a later answer
> supersedes an earlier one, both are recorded and the superseded item is marked.

- Q: How should the saved workspace layout be scoped? → A: **Per-project**, under a project-keyed
  persistence schema; this iteration builds real projects (see below), so layouts are genuinely
  per-project (not a single default workspace).
- Q: ~~How are Panes arranged; which Panes are tabbed?~~ *(superseded)* → A (earlier): three Panes
  (Left/Right/Middle), only the Middle tabbed. **Superseded by the two-Pane model below.**
- Q: What is the final top-level layout? → A: **Two Panes** — a **Left sidebar** with stacked
  **Projects** and **Terminals** Panels, and a **Right workspace** Pane. The workspace is a **tab
  group**; each **Tab** is a **split tree of Panels**; each **Panel** is a placeholder now (a file
  editor or terminal later).
- Q: Can tabs / Panels be reordered? → A: **Yes** — workspace Tabs can be reordered, and Panels can
  be rearranged/split within and between Tabs by dragging. Order is persisted.
- Q: Must docking be operable without a mouse? → A: **No — drag-and-drop only** this iteration;
  keyboard-/command-driven docking is deferred.
- Q: What can a detached window contain? → A: **Sub-workspaces.** A whole **Tab** (with all its
  Panels) or a single **Panel** can be detached; a detached Panel forms a new Tab group. A
  sub-workspace has **≥1 Tab** and **may mix several projects**.
- Q: Where do detached items return on merge / close? → A: Once detached, a Tab/Panel becomes its
  own group. **Only Panels** can be reattached to the main workspace, and only **onto a Panel
  inside their original project**. The **main workspace never mixes projects' Panels**.
- Q: How much real "projects" capability does this iteration build? → A: **Real projects** — the
  user can **create, edit, delete, and switch** projects — but **Panel content stays placeholder**
  (empty Panels) so drag-and-drop and grouping can be tested.
- Q: What does "user-specific" mean (login/data model)? → A: **No login.** The user is logged in to
  their OS; all data is stored in their **local user profile**. (Future, not now: **import/export**
  of project setup data.)
- Q: How to reconcile this with the constitution? → A: **Amend Principle XI again** — done. The
  two-Pane workspace/tab/split-Panel model superseded the v2.0.0 Middle-tabbed model and was landed
  in **Constitution v3.0.0** (2026-06-26), with Principle I "Projects" now directly engaged.
- Q: How are placeholder Panels created/typed this iteration? → A: **Generic untyped empty
  placeholders.** Adding a Tab starts it with one empty placeholder Panel; an "add panel" affordance
  (and splitting) adds more. Panels carry **no editor/terminal kind** yet — the Panel type is
  introduced with the real editor/terminal feature.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Create, switch, edit, and delete projects (Priority: P1)

A person launches throng. The Left sidebar shows a **Projects** Panel. They create a new project
(giving it at least a name and a dominant colour), and the Right workspace opens that project's
(initially empty) workspace. They create a second project and switch between them; switching swaps
the whole workspace and the sidebar's terminal list, and the active project's colour is visibly
dominant. They can rename/recolour a project and delete one they no longer want. All of this is
stored in their local user profile and survives restarts.

**Why this priority**: The workspace is project-scoped, so a real project is the foundation
everything else hangs off. Being able to create and switch projects, and see the workspace swap, is
the first demonstrable proof the new model works.

**Independent Test**: Create two projects, switch between them, confirm the workspace and sidebar
swap per project and the active colour changes; rename and delete a project; restart and confirm the
project list and active project are restored from the local profile.

**Acceptance Scenarios**:

1. **Given** no projects exist, **When** the user creates a project with a name and colour, **Then**
   it appears in the Projects Panel, becomes active, and the Right workspace shows that project's
   (empty) workspace.
2. **Given** two or more projects, **When** the user switches the active project, **Then** the Right
   workspace and the sidebar's Terminals list swap to the selected project's, only that project's
   content is visible, and the project's dominant colour is applied as the active accent.
3. **Given** an existing project, **When** the user edits its name or colour, **Then** the change is
   reflected immediately and persisted.
4. **Given** an existing project, **When** the user deletes it, **Then** it is removed from the list
   along with its saved workspace, and the application selects another project (or an empty state if
   none remain).
5. **Given** projects were created earlier, **When** the application is restarted, **Then** the
   project list and the previously-active project are restored from the local user profile.

---

### User Story 2 - Build a project workspace with Tabs and split placeholder Panels (Priority: P1)

Inside the active project, the user works in the Right workspace. They add Tabs (unlimited), and
within a Tab they split the area into multiple **placeholder** Panels by dragging — for example one
Tab split into four Panels arranged as quadrants. They drag Panels between split positions and
between Tabs to regroup them, reorder the Tabs, and collapse a split when its Panel is removed. The
Panels are empty placeholders; the point is that the docking, grouping, splitting, and tabbing all
work.

**Why this priority**: Drag-and-drop grouping/splitting/tabbing of Panels is the core capability the
user wants to see working. With placeholder Panels it is fully demonstrable and testable without any
real editor or terminal.

**Independent Test**: In a project, create several Tabs, split a Tab into multiple placeholder
Panels, drag Panels to regroup/split them and reorder Tabs, remove a Panel and watch its split slot
collapse — confirming no Panel is lost and the workspace never becomes empty.

**Acceptance Scenarios**:

1. **Given** a project's workspace, **When** the user adds a Tab, **Then** a new Tab appears in the
   tab strip (unlimited Tabs allowed), starting with exactly one empty placeholder Panel, and can be
   made active.
1a. **Given** the active Tab, **When** the user adds a placeholder Panel, **Then** a new empty,
   **untyped** placeholder Panel appears in the Tab (no editor/terminal type is chosen or shown).
2. **Given** a Tab with one Panel, **When** the user drags a Panel onto the edge (top/bottom/left/
   right) of that Panel, **Then** the Tab splits into a row/column arrangement hosting both Panels,
   and splitting can nest to arbitrary depth.
3. **Given** Panels across Tabs, **When** the user drags a Panel into another split position or
   another Tab, **Then** the Panel moves there and no Panel is duplicated or lost.
4. **Given** a Tab strip with multiple Tabs, **When** the user drags a Tab to a new position, **Then**
   the Tab order updates and is persisted.
5. **Given** a split Panel, **When** its content is removed (the Panel is dragged out or closed),
   **Then** the emptied split slot collapses and neighbouring Panels reclaim the space.
6. **Given** the active project's workspace, **When** the last Panel of the last Tab would be
   removed, **Then** the workspace retains at least one Tab with one (placeholder) Panel rather than
   becoming empty.
7. **Given** any docking action, **When** the user performs it, **Then** it works via mouse
   drag-and-drop only (no keyboard-/command-driven docking in this iteration).

---

### User Story 3 - The per-project workspace is remembered across restarts (Priority: P2)

After arranging a project's Tabs and split Panels, the user closes and reopens throng. Each project's
workspace is restored exactly — its Tabs, tab order, active Tab, the split tree within each Tab, and
the Pane/split sizes — from the local user profile. Switching projects always shows each project's
own saved arrangement.

**Why this priority**: A layout the user must rebuild every launch is worthless; per-project
persistence is what makes the workspace theirs. It builds on US1 and US2.

**Independent Test**: Arrange two projects' workspaces differently, restart, and confirm each project
restores its own arrangement; switch between them and confirm no cross-contamination.

**Acceptance Scenarios**:

1. **Given** customised per-project workspaces, **When** the application is closed and reopened,
   **Then** each project's Tabs, tab order, active Tab, split trees, and sizes are restored from the
   local user profile.
2. **Given** a project with no saved workspace (just created), **When** it is opened, **Then** it
   shows a default empty workspace (one Tab containing one placeholder Panel).
3. **Given** a saved workspace that is missing or unreadable/corrupted, **When** the project is
   opened, **Then** it falls back to the default empty workspace without crashing and surfaces that
   the prior layout could not be restored.

---

### User Story 4 - Detach Tabs/Panels into sub-workspaces that travel together (Priority: P3)

The user tears off a Tab — or a single Panel — into its own separate window (a sub-workspace) to
spread work across monitors. A sub-workspace can hold several Tabs and may even mix Tabs/Panels from
different projects. The main window and all sub-workspace windows behave as one focus group: focusing
any one brings them all forward. The user reattaches a Panel back into the main workspace, where it
returns to **its original project's** workspace; the main workspace never ends up mixing projects.

**Why this priority**: Multi-window tear-off plus the cross-project sub-workspace and
merge-to-original-project rules are the most novel and highest-risk part of the model, and the
single-window workspace (US1–US3) is fully usable without them. This is the cleanest slice to split
into a follow-up feature if needed.

**Independent Test**: Detach a Tab and a Panel into sub-workspace windows; confirm they are separate
windows that share focus with the main window; place Panels from two projects in one sub-workspace;
reattach a Panel and confirm it returns to its original project's workspace and the main workspace
stays single-project; restart and confirm sub-workspaces are restored.

**Acceptance Scenarios**:

1. **Given** a Tab in the main workspace, **When** the user detaches it, **Then** it opens in a
   separate sub-workspace window with all its Panels and is removed from the main workspace.
2. **Given** a Panel in a Tab, **When** the user detaches just that Panel, **Then** it opens in a
   sub-workspace as a new Tab group, and its split slot in the source Tab collapses.
3. **Given** the main window and one or more sub-workspace windows, **When** the user focuses any one,
   **Then** all windows in the group are brought to the foreground together.
4. **Given** a sub-workspace, **When** the user moves Tabs/Panels from different projects into it,
   **Then** it may hold a mix of projects' content.
5. **Given** a Panel in a sub-workspace, **When** the user reattaches it to the main workspace,
   **Then** it returns into **its original project's** workspace only, and the main workspace never
   shows Panels from more than one project.
6. **Given** a layout that includes sub-workspaces, **When** the application is closed and reopened,
   **Then** the sub-workspaces are restored onto a visible display as part of the saved layout.
7. **Given** a sub-workspace window closed by the OS (or whose last Panel is removed), **When** that
   happens, **Then** its Panels are not lost — they return to their original project's workspace.

---

### Edge Cases

- **Drop outside any valid target**: A drag released over empty space / a non-droppable region is
  cancelled and the Tab/Panel stays where it was.
- **Collapsing splits**: Removing a Panel collapses its split slot; a Tab with no Panels is removed;
  the active project's workspace always keeps at least one Tab with one Panel.
- **Deleting the active project**: The application selects another project, or shows an empty
  "no projects" state if none remain (with a way to create one).
- **Corrupted/missing per-project layout**: Falls back to the default empty workspace (one Tab, one
  placeholder Panel) and reports that the prior layout could not be restored.
- **Sub-workspace on a now-absent monitor**: A saved sub-workspace position on a disconnected monitor
  is repositioned onto a currently visible display rather than opened off-screen.
- **Reattaching a cross-project sub-workspace**: A sub-workspace Tab containing Panels from multiple
  projects cannot be merged into the main workspace as a unit; only individual Panels reattach, each
  to its own original project.
- **Reattaching to a deleted project**: If a Panel's original project no longer exists, the Panel
  cannot be merged into the main workspace; it remains in the sub-workspace (and the limitation is
  surfaced).
- **Very small Pane/split sizes**: Resizing cannot shrink a Pane or split below a sensible minimum
  that would hide its tab strip or content.

## Requirements *(mandatory)*

### Functional Requirements

#### Projects (user-specific, no login)

- **FR-001**: The application MUST run as the logged-in operating-system user with **no in-app login
  or account system**, and MUST store all of its data in that user's **local user profile**.
- **FR-002**: The user MUST be able to **create, edit, delete, and switch** projects.
- **FR-003**: A project MUST carry at least a friendly **name**, a **dominant colour**, and a **root
  folder path** (per Constitution Principle I); the project file explorer / Markdown preview /
  edit-list behaviours remain out of scope for this iteration.
- **FR-004**: The **active project's dominant colour** MUST be visibly applied as the active-context
  accent so the current project is unambiguous at a glance.
- **FR-005**: Switching the active project MUST swap the **Right-pane workspace** and the **Left-pane
  Terminals list** to the selected project's, and MUST hide all other projects' content; only the
  active project's workspace is visible.
- **FR-006**: Deleting a project MUST remove its project record and its saved workspace, and MUST
  leave the application in a valid state (another project active, or an empty "no projects" state).
- **FR-007**: The persistence schema MUST be shaped to support **future import/export of project
  setup data** (no import/export UI is built in this iteration).

#### Workspace shell (two Panes)

- **FR-008**: The main window's default layout MUST be **two top-level Panes**: a **Left Pane
  (sidebar)** and a **Right Pane (workspace)**, replacing the bootstrap landing placeholder.
- **FR-009**: The Left Pane MUST host two **stacked** (non-tabbed) Panels — **Projects** (project
  list + create/edit/delete/switch controls) and **Terminals** (the active project's terminal list,
  a placeholder in this iteration).
- **FR-010**: The Right Pane MUST present the **active project's workspace** as a **tab group** with
  one or more Tabs and exactly one active Tab.
- **FR-011**: The boundary between the Left and Right Panes (and any split boundary) MUST be
  resizable via drag handles, and MUST NOT be resizable below a minimum that hides a tab strip or
  content.

#### Tabs and split Panels (the workspace)

- **FR-012**: The workspace MUST support an unlimited number of **Tabs**; Tabs MUST be **reorderable**
  by dragging and the order MUST be persisted.
- **FR-012a**: The user MUST be able to **add a new Tab** (which starts with exactly one empty
  placeholder Panel) and **add a new empty placeholder Panel** into the active Tab; additional Panels
  MAY also arise from splitting (FR-014).
- **FR-013**: Each **Tab** MUST contain a **split tree** of one or more **Panels** — Panels arranged
  in rows/columns that can nest to arbitrary depth.
- **FR-014**: The user MUST be able to **split** a Panel by dragging a Panel onto its edge
  (top/bottom/left/right), creating a new row/column split that hosts the dragged Panel.
- **FR-015**: In this iteration every **Panel** MUST be a generic, **untyped** empty **placeholder**
  — it MUST NOT carry an editor/terminal kind, and its future content (a file editor with edit/preview
  modes, or a terminal) MUST NOT be implemented here. (The Panel kind/type is introduced with the real
  editor/terminal feature.)
- **FR-016**: Dragging the last Panel out of a split slot MUST collapse that slot; a Tab whose last
  Panel is removed MUST be removed; the active project's workspace MUST always retain at least one Tab
  containing at least one Panel.
- **FR-017**: All workspace docking — moving, grouping, splitting, tab reordering, and detaching —
  MUST be operable via **mouse drag-and-drop only** in this iteration; keyboard-/command-driven
  docking is out of scope.
- **FR-018**: While a Tab/Panel is being dragged, the workspace MUST show clear visual feedback of the
  valid drop target and the resulting placement (move vs split vs new tab).
- **FR-019**: Dropping outside any valid target MUST cancel the operation and leave the Tab/Panel in
  its original position.

#### Detaching into sub-workspaces

- **FR-020**: A whole **Tab** (with all its Panels) or a single **Panel** MUST be detachable into a
  separate operating-system window (a **sub-workspace**); detaching a single Panel MUST start a new
  Tab group in the sub-workspace.
- **FR-021**: A sub-workspace MUST contain **at least one Tab** and MAY contain Tabs/Panels from
  **multiple projects**.
- **FR-022**: The main window and every sub-workspace window MUST behave as a **single focus/stacking
  group** — focusing any one MUST bring all of them to the foreground together.
- **FR-023**: Only **Panels** MUST be reattachable to the main workspace, and only into **their
  original project's** workspace; whole Tabs MUST NOT be draggable back into the main workspace as a
  unit.
- **FR-024**: The **main workspace MUST NOT mix Panels from different projects**; each project's
  workspace shows only its own Panels. (Cross-project mixing is permitted only inside sub-workspaces.)
- **FR-025**: Closing a sub-workspace window, or removing its last Panel, MUST NOT lose Panels — each
  Panel MUST be returned to its original project's workspace (recreated if necessary); a Panel whose
  original project no longer exists MUST be retained rather than discarded, and the limitation
  surfaced.

#### Persistence

- **FR-026**: Each project's workspace arrangement — its Tab group, tab order, active Tab, each Tab's
  split tree, the placement/identity of placeholder Panels, and split/Pane sizes — MUST be persisted
  durably in the local user profile, keyed by project (and owner/user), and restored on reopen.
- **FR-027**: The project list and the active project MUST be persisted and restored on reopen.
- **FR-028**: Sub-workspace windows and their on-screen positions MUST be persisted and restored;
  a restored window whose saved position is no longer available MUST be repositioned onto a currently
  visible display.
- **FR-029**: When a project's saved workspace is missing or unreadable, the workspace MUST fall back
  to a default empty workspace (one Tab, one placeholder Panel) without crashing and MUST surface that
  the prior layout could not be restored.

#### Scope guard & UX

- **FR-030**: No real product behaviour beyond projects and the docking shell MUST be implemented:
  file editing, Markdown preview, terminals, shell detection, the change/edit list, agents, and
  import/export are all out of scope; Panels are placeholders.
- **FR-031**: A default visual theme MUST be applied and the docking affordances (resize handles,
  drag-and-drop, tabs) MUST NOT obscure the core flows.

#### UX refinements (clarification 2026-06-26b)

> Added after US1–US3 landed, refining the projects bar, tabs, panels, resizing, and chrome.
> These tighten the existing single-window experience; they do not introduce US4 multi-window scope.

- **FR-032**: The Projects Panel MUST show each project's **root-folder path** in a de-emphasised
  (grey) line beneath its name. When the path is too long to fit, hovering the entry MUST start a
  horizontal **marquee scroll** of the path after a ~200 ms delay (and stop/reset when the pointer
  leaves).
- **FR-033**: The Sidebar (Projects/Terminals) MUST be **resizable both horizontally** (the
  sidebar↔workspace boundary) **and vertically** (the Projects↔Terminals split), each with a sensible
  **default size** and a minimum that keeps content usable (FR-011).
- **FR-034**: Choosing a project's root folder MUST use a native **folder path picker** (OS open-folder
  dialog) rather than free-text entry; the chosen absolute path populates the field.
- **FR-035**: While reordering Tabs by dragging, the workspace MUST show an **insertion indicator
  between Tabs** marking where the dragged Tab will land — not merely highlight the Tab under the
  pointer (refines FR-018 for the tab strip).
- **FR-036**: A Tab MUST offer a **right-click context menu** on the Tab itself providing at least:
  **Rename**, **Close**, and **Close other tabs**. Renaming updates the Tab title (persisted). Close
  removes the Tab (subject to the never-empty rule, FR-016). "Close other tabs" removes every Tab
  except the target (the target's Panels are retained).
- **FR-037**: A Panel MUST be **renameable** via a **right-click context menu on its header**; the new
  title is persisted with the layout.
- **FR-038**: **Panel/split resizing MUST function**: dragging a split divider MUST resize the
  adjacent cells (updating the split sizes) and MUST persist, honouring the minimum-size rule (FR-011).
- **FR-039**: Mouse-driven **zoom** (Ctrl+wheel to zoom, Ctrl+middle-click to reset) MUST work in the
  workspace renderer (regression guard — it was lost when the bootstrap landing renderer was replaced).
- **FR-040**: The application **window title** MUST show the active context at a glance, updating live as
  the active project / tab / panel change. *(REVISED 2026-07-04 (005): the title now shows the **active
  project name**, the **active Tab · Panel** (the same `activeContextLabel` the status bar uses, so the two
  never drift), and a trailing **`[ADMIN]`** marker when throng runs elevated (FR-025e) — e.g.
  "throng — Titler · Tab 1 · Panel 1 [ADMIN]". The earlier form — the project's root **path** and the
  **projects/tabs/panels totals** — is removed. "No project" when nothing is open.)*
- **FR-041**: **Tabs, Panels, and projects MUST also be renameable by double-clicking** them (a Tab
  chip, a Panel header, or a project entry), starting the same inline rename as the right-click menu
  (FR-036/FR-037) / project edit. The committed name is persisted.

#### Destructive-action confirmations & chrome (clarification 2026-06-26c)

> A second refinement pass adding delete confirmations, tab panel counts, window-state persistence,
> and project reordering. Subprocess/terminal awareness is stubbed (Panels are still placeholders).

- **FR-042**: Deleting a **project** MUST require an explicit confirmation ("are you sure?") before the
  project and its saved workspace are removed.
- **FR-043**: Closing a **Tab** that contains Panels MUST require confirmation, stating how many Panels
  it holds and how many of those have a **running subprocess** (e.g. "There are X panels and Y active
  panels with subprocesses currently running."). The same applies to "Close other tabs" (totalled
  across the affected Tabs). Subprocesses do not exist yet, so Y is currently always 0 (placeholder).
- **FR-044**: Closing a **Panel** that hosts a **running subprocess** MUST require confirmation. As
  terminals are not implemented, this is **placeholder** behaviour: the check exists but never prompts
  yet (no Panel hosts a subprocess), and will gain effect when terminals land — with no caller change.
- **FR-045**: Each **Tab** MUST indicate how many Panels it contains (e.g. "Tab Name [4]"). (This is
  intended to later also surface Panels awaiting input.)
- **FR-046**: The user MUST be able to **reorder projects by dragging** them in the Projects Panel; the
  order MUST be persisted per user and restored.
- **FR-047**: The main window's **size and position MUST be saved when the application closes** and
  restored on next launch; a restored position on a now-absent display MUST be clamped onto a visible
  one (reusing the `IDisplayInfo` seam, FR-028).
- **FR-048**: The **minimum window size MUST be 640 × 480**.

### Non-Functional Requirements

- **NFR-001**: A drag-and-drop docking operation MUST feel immediate, with drop-target feedback
  presented within 100 ms of the pointer reaching a valid target on a typical modern Windows machine.
- **NFR-002**: The workspace MUST restore the active project's layout on launch within the
  application's existing startup budget (landing surface visible within 5 seconds of launch,
  inherited from 001 / SC-001 of the bootstrap).

## Key Entities

- **User / profile (implicit)**: The logged-in OS user. Not an authenticated account; their **local
  user profile directory** is where all throng data is stored. All persisted records carry an
  owner/user key so true multi-user and import/export can be added later.
- **Project**: A first-class entity with at least a name, a dominant colour, and a root folder path.
  Owns one **Workspace** and one **Terminals list** (placeholder). The unit the user creates, edits,
  deletes, and switches between.
- **Workspace**: A project's Right-Pane content — a **Tab group** (ordered Tabs + one active Tab).
- **Tab**: Belongs to a project's workspace; contains a **split tree** of Panels; has an order and an
  active/visible state.
- **Split node**: An internal row/column container arranging child Panels and/or nested split nodes —
  the recursive structure inside a Tab, with sizes.
- **Panel**: The atomic, draggable content unit. In this iteration a generic **untyped** empty
  **placeholder** (no editor/terminal kind yet); future kind = file editor (edit/preview) or terminal.
  Carries the identity of its **original project**.
- **Sub-workspace (detached window)**: A separate OS window holding one or more Tabs; may mix
  projects; part of the single focus/stacking group; records its on-screen position for restoration.
- **Focus group**: The main window plus all sub-workspace windows, sharing one effective OS Z-order.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user can create a project, and a second, and switch between them; the Right workspace
  and the sidebar Terminals list swap per project and the active project's colour is visibly dominant.
- **SC-002**: A user can edit a project's name/colour and delete a project, leaving the application in
  a valid state; both are persisted.
- **SC-003**: Within a project, a user can add multiple Tabs and split a Tab into multiple placeholder
  Panels (e.g. four quadrants) entirely by drag-and-drop, with no Panel lost or duplicated — verified
  by an automated test.
- **SC-004**: Tabs can be reordered by dragging, and Panels can be moved between split positions and
  between Tabs by dragging; the results persist.
- **SC-005**: Removing a Panel collapses its split slot, removing the last Panel of a Tab removes the
  Tab, and the workspace never reaches an empty state — verified by an automated test.
- **SC-006**: After restart, each project restores its own Tabs, tab order, active Tab, split trees,
  and sizes from the local user profile, with no cross-project contamination.
- **SC-007**: A Tab or a Panel can be detached into a sub-workspace window; a sub-workspace can hold
  Tabs/Panels from more than one project.
- **SC-008**: Focusing any one window in the group (main or sub-workspace) brings every window in the
  group to the foreground together.
- **SC-009**: A reattached Panel returns to its original project's workspace, and the main workspace
  never shows Panels from more than one project — verified by an automated test.
- **SC-010**: Sub-workspaces are restored onto a visible display after restart; closing one returns
  its Panels to their original projects without loss.
- **SC-011**: A missing or corrupted per-project layout yields the default empty workspace without a
  crash, and the user is informed the prior layout could not be restored.
- **SC-012**: All docking (move/group/split/tab-reorder/detach) is achievable with the mouse alone;
  drop-target feedback appears within 100 ms of reaching a valid target.
- **SC-013**: No real editor, terminal, file-browsing, or import/export behaviour is present; Panels
  are empty, **untyped** placeholders (no editor/terminal kind is selectable or shown).
- **SC-014**: A user can add a new Tab (which starts with one empty placeholder Panel) and add
  further empty placeholder Panels into a Tab, then drag/split/group them — all without any Panel
  exposing an editor or terminal type.

## Assumptions

- **Real projects, placeholder Panels** *(Clarification 2026-06-26)*: This iteration implements real
  project create/edit/delete/switch, but Panel **content** is an empty placeholder so drag-and-drop,
  grouping, splitting, tabbing, and detaching can be exercised before editors/terminals exist.
- **No login; local user profile** *(Clarification 2026-06-26)*: There is no authentication; the app
  runs as the logged-in OS user and stores data in that user's local profile. Records carry an
  owner/user key. **Import/export of project setup data is future scope**, designed for but not built.
- **Project attributes** *(Constitution Principle I)*: A project carries name, dominant colour, and
  root folder path; the workspace folder explorer, Markdown preview, and edit list are NOT built here.
- **Panel future types** *(Clarification 2026-06-26)*: A Panel will later be a file editor
  (edit/preview modes, e.g. `.md`) or a terminal; only **generic untyped** placeholders are built now
  (no Panel kind/type field yet). New Tabs/Panels are created via explicit "add Tab" / "add Panel"
  affordances and by splitting.
- **Constitution re-amendment applied** *(Clarification 2026-06-26)*: The two-Pane workspace/tab/
  split-Panel model superseded the Middle-tabbed model and was landed in **Constitution v3.0.0**
  (2026-06-26) by renaming/redefining Principle XI (now "Dockable Workspace: Panes, Tabs & Panels")
  and adding a per-user local-storage constraint; Principle I "Projects" is now actively built. So
  `/speckit-plan`'s Constitution Check gate is aligned with this spec.
- **Platform**: Windows is the target for this iteration (consistent with 001); docking and
  multi-window behaviour sit behind the OS abstraction so other platforms can follow.
- **Persistence mechanism**: Layouts and project records are stored in the embedded persistence store
  established in 001, within the local user profile; concrete schema/storage choices are pinned during
  planning.
- **Detachment may be sliced off**: US4 (sub-workspaces + cross-project merge rules) is the
  highest-risk slice and is intentionally P3, so it can be split into a follow-up feature at plan time
  without blocking the single-window project workspace.

## Out of Scope (this feature)

- Real **Panel content**: file editing, Markdown preview, terminals, shell detection, and agents —
  Panels are placeholders.
- The project **file explorer / workspace folder navigation**, Markdown document preview, and the
  combined **change/edit list** (separate features).
- **Import/export** of project setup data (schema is designed for it; no UI/behaviour built).
- In-app **user accounts / login / multi-user** (single logged-in OS user; data in the local profile).
- **Keyboard-/command-driven docking** (docking is mouse drag-and-drop only this iteration).
- Final visual design, branding, and theming beyond a default theme, the docking affordances, and the
  active-project colour accent.
- Operating systems other than Windows; packaging, installers, auto-update, and distribution.
