# Feature Specification: Layout and app tweaks

**Feature Branch**: `003-layout-and-app-tweaks`

**Created**: 2026-06-26

**Status**: Draft

**Input**: User description: "A tranche of layout and application tweaks on top of the 002 docking
workspace: a cursor-attached drag ghost, an active/highlighted panel, themeable colours/icons/fonts,
user-scoped JSON settings + keybindings, a bottom status bar, collapsible side panes, first-class
manageable sub-workspaces, destructive-action dialogs with 'Destroy' wording, project folder
exclusivity, single-instance + lazy project loading, and assorted polish."

## Overview

This feature is a broad set of layout and application-level improvements built on the 002 docking
workspace (Panes / Tabs / split Panels / sub-workspaces). It introduces foundational
infrastructure — user-scoped settings, keybindings, and theming — and uses it across a number of
UX features:

- **Drag & activation polish**: a cursor-attached translucent ghost during drags (in addition to
  the existing drop indicators), and a visibly highlighted **active panel**.
- **Theming**: all colours, icons, and fonts sourced from a swappable theme; the default theme is
  **"throng"**.
- **User-scoped configuration**: a sectioned JSON **settings** file, a separate **keybindings**
  JSON file, and swappable **theme** files, all stored under the user's profile.
- **Status bar**: a bottom bar in every window showing the active context.
- **Side panes**: a right **File Explorer Pane** (empty placeholder this iteration), with
  collapse/show-hide for both side panes.
- **Sub-workspaces as first-class entities**: created by detach, managed (rename / recolour /
  delete) from a new sidebar list, persisted and reopened lazily.
- **Destructive-action dialogs**: "Destroy Tab / Panel / Project" wording, a wry double-confirm for
  projects, and per-type confirmation settings; every panel emulates an "active process" so the
  warning logic can be exercised now.
- **Project rules**: project folder exclusivity (no nested project paths), plus creation
  quality-of-life.
- **App lifecycle**: single-instance, and lazy loading of projects.

The actual file/folder tree and the in-panel content (terminals, agents, editors) are **out of
scope** (see Out of Scope); the File Explorer Pane ships as an empty shell and panel "active
process" state is **emulated** as a clearly-temporary stand-in.

## Clarifications

### Session 2026-06-27

- Q: How do lazy-loading and "sub-workspaces reopen on restart" reconcile at startup? → A: Fully
  lazy. No project is selected/loaded at startup; the sidebar lists projects and sub-workspaces but
  opens nothing until the user clicks. Opening a project (or a sub-workspace) loads it and keeps it
  in memory.
- Q: When the user closes a sub-workspace window, what happens to its tabs/panels? → A: The window
  just closes; the sub-workspace persists in the sidebar list and reopens later with its tabs and
  panels intact. (Permanent removal is a separate "Delete" action — see below.)
- Q: How do "linked" sub-workspace windows behave for minimise/restore? → A: Focus/raise is grouped
  (focusing any window brings the group forward); minimise/restore is **independent** per window.
- Q: What happens on a second app launch while an instance is running? → A: The second launch
  **silently exits**; the app is single-instance.
- Q: Panel close labels (Destroy vs Close)? → A: The panel context-menu item and the header close
  affordance both read/confirm **"Destroy Panel"**.
- Q: What close entry points does a panel have? → A: A right-click **"Destroy Panel"** menu item
  **and** a small **×** affordance on the panel header, both routing through one shared closure flow.
- Q: With panels emulating an active process, which flows warn? → A: **Destroy Tab / Destroy Panel
  / Destroy Project / sub-workspace Delete** show warnings. **App close does not warn** — panel
  subprocesses (terminals/agents/editors, deferred) will persist in the background and reconnect on
  next project activation.
- Q: Confirmation model? → A: A **none | single | double** enum applies to all three destroy types
  (Tab/Panel treat "double" as "single"). Defaults: **Project = double, Tab = single, Panel =
  single**; the Panel dialog only appears when the panel has an active subprocess (emulated → always
  true for now).
- Q: How much theming this iteration? → A: Introduce the theming abstraction and ship the default
  **"throng"** theme as a swappable theme file (colours, icon set, fonts), selected by name in
  settings. No alternate themes and no theme-editor UI yet.
- Q: How are config files organised and where? → A: Under **`%USERPROFILE%\.throng\`**: a sectioned
  **`settings.json`**, a separate **`keybindings.json`**, and theme definitions as separate files in
  a **`themes\`** folder (e.g. `themes\throng.json`); `settings.json` selects the active theme by
  name.
- Q: What does the drag ghost look like? → A: A **faithful translucent snapshot** of the dragged
  tab/panel, pinned under the cursor (must also follow the cursor during window-detach; mechanism
  resolved at plan time).
- Q: Right pane behaviour when no project is active (left sidebar now stays shown)? → A: The right
  File Explorer Pane defaults to **collapsed** when no project is active, but the user can expand it
  to its empty placeholder; its active-project visibility preference persists.
- Q: Scope of the no-nested-project-paths rule? → A: Enforced on **create and edit**; reject a
  folder **identical to**, an **ancestor (parent) of**, or a **descendant (subfolder) of** any
  existing project's root. A fundamental restriction.
- Q: How far does the "Layout and app tweaks" rename go? → A: Rename the spec title **and** the
  feature directory (`specs/003-layout-and-app-tweaks`) and branch field.
- Q: What goes in the keybindings file this iteration? → A: Map the existing keyboard shortcuts —
  zoom in (Ctrl+= / Ctrl++), zoom out (Ctrl+-), reset zoom (Ctrl+0), fullscreen (F11) — **and** the
  Ctrl+wheel / Ctrl+middle-click zoom gestures, all as configurable bindings.
- Q: How do confirmation settings gate the Destroy Project sequence? → A: The Project enum value
  drives it — **double** = summary dialog then the wry "Yes, I'm absolutely sure / No, I concede"
  dialog; **single** = summary dialog only; **none** = destroy with no dialogs.
- Q: Scope of the active panel? → A: **Each tab has its own active panel**; the active panel of the
  currently focused tab/window is the single **globally active** panel (the one the user is
  interacting with). Applies to sub-workspaces too.
- Q: Where does the status bar appear? → A: **Every window** has its own status bar.
- Q: New sidebar entity? → A: Add a **Sub-workspaces** list panel to the left sidebar **below
  Projects**. Sub-workspaces are first-class, runtime-created, independently **named, coloured,
  edited, and deleted** like projects, but have **no project folder**.
- Q: Closing vs deleting a sub-workspace? → A: **Close = keep** (window closes, entry persists,
  reopenable); **Delete = destroy** (explicit action in the list; shows the relocation warning and
  removes it).
- Q: When do sub-workspaces reopen? → A: **Lazily** — listed at startup, opened on click; opening
  one lazy-loads the projects of its panels.
- Q: How is a sub-workspace created? → A: **By detach only** (dragging a tab/panel outside the main
  window). An empty sub-workspace cannot exist (≥1 tab / ≥1 panel).
- Q: What does a sub-workspace's status bar left side show? → A: **Both** — the sub-workspace's own
  name and colour first, followed by the currently active panel's **origin project** name.

### Session 2026-06-27 (round 2)

- Q: How much of the app must draw from the theme this iteration? → A: **The whole app** — all
  existing UI surfaces (project list, tabs, panels, dialogs, status bar, panes) and new UI MUST
  resolve every colour, icon, and font from the active theme.
- Q: How do edits to the settings / keybindings / theme files take effect? → A: **Live
  (hot-reload)** — the app watches the config files and applies changes without a restart.
- Q: When a project is destroyed, what happens to its panels that live inside sub-workspaces? → A:
  **Block the destroy** while any of the project's panels exist in a sub-workspace; the message MUST
  list **which sub-workspaces and tabs** contain them so the user can find and relocate/close them
  first.
- Q: Are pane width and visibility remembered globally or per project? → A: **Global (user-level)** —
  one width + visibility per pane across all projects.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Cursor-Attached Drag Ghost (Priority: P1)

While dragging a tab or panel, the user sees a faithful, semi-transparent snapshot of the dragged
item pinned under the cursor — as if physically holding it and moving it across the screen — **in
addition to** the existing in-place drop indicators. The ghost is present whether the user is
dragging within the app or dragging beyond the main window to detach into a new window.

**Why this priority**: The ghost makes drag-and-drop tangible and reduces placement errors; it is
a visible polish item delivered in the first tranche.

**Independent Test**: Begin dragging a panel; confirm a same-sized translucent snapshot follows the
cursor alongside the normal drop indicators. Drag a tab beyond the window edge; confirm the ghost
keeps following the cursor up to the detach drop.

**Acceptance Scenarios**:

1. **Given** the user starts dragging a tab or panel, **When** the drag begins, **Then** a faithful
   translucent snapshot of the item appears pinned to the cursor and follows it, in addition to the
   existing drop indicators.
2. **Given** a drag in progress, **When** the user releases at any drop target, **Then** the ghost
   disappears with no residual artefact.
3. **Given** a drag toward and beyond the main window boundary, **When** the pointer leaves the
   window to detach, **Then** the ghost continues to follow the cursor through the detach.

---

### User Story 2 — Active (Highlighted) Panel (Priority: P1)

Selecting a panel **activates** it, and the active panel is visibly highlighted in a slightly
different (theme-defined) colour. Each tab remembers its own active panel; the active panel of the
currently focused tab/window is the single globally-active panel (the one the user is interacting
with). This applies in the main window and in sub-workspaces.

**Why this priority**: A clear active-panel indicator orients the user and underpins the status
bar's "active panel" display.

**Independent Test**: Click a panel; confirm it gains the active highlight and any previously active
panel in that tab loses it. Switch tabs and back; confirm each tab restores its own active panel.
Focus a sub-workspace; confirm its active panel becomes the globally-active one.

**Acceptance Scenarios**:

1. **Given** a tab with multiple panels, **When** the user selects a panel, **Then** that panel
   becomes active and is highlighted, and any other panel in the tab is no longer highlighted.
2. **Given** two tabs each with their own active panel, **When** the user switches between them,
   **Then** each tab shows its own remembered active panel as highlighted.
3. **Given** the main window and a sub-workspace each have an active panel, **When** the user
   focuses one window, **Then** that window's active panel is the globally-active panel.

---

### User Story 3 — Destroy Dialogs, Panel Close & Emulated Active-Process Warnings (Priority: P1)

Destructive actions use consistent **"Destroy"** wording — **Destroy Tab**, **Destroy Panel**,
**Destroy Project**, **Destroy other tabs** — with the confirm button in a warning (red) colour.
A panel can be destroyed from a right-click **"Destroy Panel"** menu item or a header **×**, both
sharing one closure flow. Because every panel emulates an active process this iteration, these
flows surface warning dialogs. Destroying a project ends with a wry double-confirmation. The number
of confirmations per destroy type is user-configurable.

**Why this priority**: Correct, consistent destructive-action language and confirmations prevent
accidental loss; this is core polish delivered first.

**Independent Test**: Right-click a panel → "Destroy Panel"; confirm the dialog and red button.
Close a panel via the header ×; confirm the identical flow/dialog. Destroy a tab; confirm the
dialog lists the active panels and their states. Destroy a project; confirm the summary dialog then
the wry "Yes, I'm absolutely sure / No, I concede" dialog. Set Project confirmation to "single" and
confirm only the summary dialog appears; set "none" and confirm immediate destruction.

**Acceptance Scenarios**:

1. **Given** a panel, **When** the user opens its right-click menu, **Then** a **"Destroy Panel"**
   item is present; selecting it (or the header **×**) runs the same closure flow.
2. **Given** the user destroys a tab, **When** the confirmation appears, **Then** it is titled
   **"Destroy Tab"** with a red confirm button and states how many panels are in the tab and their
   (emulated) active states.
3. **Given** the user destroys a project, **When** Project confirmation is **double** (default),
   **Then** a summary dialog (active panels per tab) appears, followed by a wry confirmation whose
   confirm button reads **"Yes, I'm absolutely sure"** and whose cancel button reads **"No, I
   concede"**.
4. **Given** a panel with no active subprocess, **When** the Panel confirmation is enabled, **Then**
   no Destroy Panel dialog is shown (the panel closes directly); **and** because active state is
   emulated as always-true this iteration, the dialog is shown in practice for now.
5. **Given** any destroy confirmation, **When** the user cancels, **Then** no destructive action
   occurs.
6. **Given** the "Destroy other tabs" action, **When** its confirmation appears, **Then** it uses
   "Destroy" wording and a red button and totals the panels/active states across all affected tabs.
7. **Given** a project with panels currently inside one or more sub-workspaces, **When** the user
   tries to destroy the project, **Then** the destroy is refused and a message lists the
   sub-workspaces and tabs holding those panels so the user can relocate/close them first.

---

### User Story 4 — Project Creation & Folder Exclusivity (Priority: P1)

When the project creation dialog opens after a folder is selected, the auto-filled name is
**highlighted (selected)** so the user can type over it. The colour picker opens on an unused
colour with an explanatory label, and the form stays open with highlighted errors on invalid
submit. A project's root folder is **exclusively bound**: no project may be created or edited to a
folder that is identical to, a parent of, or a subfolder of another project's root.

**Why this priority**: Reduces friction and prevents an invalid project graph; folder exclusivity
is a fundamental application restriction.

**Independent Test**: Open Create Project, select a folder; confirm the name auto-fills and is
selected. Confirm the colour is unused and labelled. Submit invalid; confirm the form stays open.
Attempt to create a project at a subfolder (or parent) of an existing project; confirm rejection
with an explanatory error. Repeat on edit.

**Acceptance Scenarios**:

1. **Given** the creation form with an empty name, **When** the user selects a folder, **Then** the
   name field is populated with the folder's name **and the text is selected/highlighted** for
   immediate overtyping.
2. **Given** the name field already has text, **When** a folder is selected, **Then** the name is
   not overwritten.
3. **Given** existing projects with colours, **When** the form opens, **Then** the colour picker is
   set to an unused colour (LRU fallback if all used) with an adjacent purpose label.
4. **Given** an invalid/missing field, **When** the user submits, **Then** the form remains open
   with the invalid fields highlighted until submission succeeds.
5. **Given** an existing project rooted at `D:\test`, **When** the user tries to create or edit a
   project rooted at `D:\test`, `D:\test\sub`, or a parent of `D:\test`, **Then** the form remains
   open with the folder field highlighted and an explanatory exclusivity error.

---

### User Story 5 — Status Bar in Every Window (Priority: P2)

Every window shows a thin fixed-height status bar at the bottom. In the **main window** the left
side shows the active project's name (or a "No project" placeholder) and the right side shows the
active tab and active panel names. In a **sub-workspace** window the left side shows the
sub-workspace's own name and colour followed by the active panel's origin project name; the right
side shows the active tab and panel. All update immediately on change.

**Why this priority**: Instant orientation in any window; non-intrusive.

**Independent Test**: In the main window, switch project/tab/panel and confirm both sides update; with
no project, confirm "No project". In a sub-workspace, confirm the left shows its name+colour then the
focused panel's origin project, and updates as focus moves between panels of different projects.

**Acceptance Scenarios**:

1. **Given** the main window with a project active, **Then** the status bar left shows the project
   name and the right shows the active tab and panel names.
2. **Given** the main window with no project active, **Then** the left shows a "No project"
   placeholder and the right is empty.
3. **Given** a sub-workspace window, **Then** the left shows the sub-workspace name and colour
   followed by the active panel's origin project name, and the right shows the active tab and panel.
4. **Given** any window, **When** the user changes the active project / tab / panel, **Then** the
   relevant status-bar sides update immediately.

---

### User Story 6 — Collapsible Side Panes (Priority: P2)

The application has a right-hand **File Explorer Pane** (an empty placeholder this iteration),
resizeable with persisted width. Both the left **Sidebar Pane** and the right **File Explorer
Pane** can be collapsed/expanded: an expanded pane shows a **Hide** control at its inner-top corner
(Sidebar top-right, File Explorer top-left); a collapsed pane becomes a **fixed-width rail** with a
**Show** control and a rotated vertical label ("Projects & Terminals" / "Files & Folders"; the
Sidebar rail label became "Projects & Sub-workspaces" once the Terminals sidebar panel was removed —
**superseded by feature 005 FR-023**). The
left Sidebar stays shown by default even when no project is active (so the user can pick a project),
unless the user hides it; the right pane defaults to collapsed when no project is active but can be
expanded to its placeholder. Each pane's width and visibility persist across restarts.

**Why this priority**: Establishes the workspace's side structure and gives the user control of
screen space.

**Independent Test**: Resize the File Explorer Pane, restart, confirm width restored. Hide/Show each
pane via its controls; confirm the rail + rotated label. With no project active, confirm the left
sidebar is shown and the right pane is collapsed; expand the right pane to its placeholder. Restart;
confirm visibility preferences restored.

**Acceptance Scenarios**:

1. **Given** the File Explorer Pane visible, **When** the user drags its inner (left) edge, **Then**
   it resizes (min-width enforced); **and** after restart its width is restored (sub-minimum widths
   clamped).
2. **Given** an expanded pane, **When** the user activates its Hide control (Sidebar top-right /
   File Explorer top-left), **Then** it collapses to a fixed-width rail with a Show control and the
   correct rotated label.
3. **Given** a collapsed rail, **When** the user activates Show, **Then** the pane re-expands to its
   persisted width.
4. **Given** no project is active, **Then** the left Sidebar is shown by default (unless previously
   hidden) and the right File Explorer Pane is collapsed (expandable to its placeholder).
5. **Given** the user has set each pane's visibility, **When** the app restarts, **Then** each
   pane's visibility and width are restored.

---

### User Story 7 — Sub-Workspaces as First-Class Entities (Priority: P3)

Detaching a tab or panel outside the main window creates a **sub-workspace** window. Sub-workspaces
are first-class: they appear in a new **Sub-workspaces** list in the left sidebar (below Projects)
and can be renamed, recoloured, and deleted like projects (but have no project folder). A
sub-workspace window is resizeable, minimisable, and closeable; it contains one or more tabs (each
identical to a main-workspace tab, ≥1 panel), reusing the same workspace code, and may hold panels
from multiple projects. Closing a sub-workspace window keeps it (reopenable from the list); deleting
it from the list destroys it. Sub-workspaces are reopened lazily. All windows share one focus/raise
group; closing the main window (app exit) closes all sub-workspace windows.

**Why this priority**: A complete, manageable multi-window model; builds on the detach capability.

**Independent Test**: Detach a panel to create a sub-workspace; confirm it appears in the sidebar
list with an auto name+colour. Rename/recolour it. Add tabs/panels (multi-project). Close the window;
confirm it stays in the list and reopens with contents intact. Delete it from the list; confirm the
relocation warning then removal. Restart the app; confirm sub-workspaces are listed but not opened
until clicked. Close the main window; confirm all sub-workspace windows close.

**Acceptance Scenarios**:

1. **Given** a tab/panel dragged outside the main window, **When** dropped, **Then** a new
   sub-workspace window opens with the item and a new entry (auto name + unused colour) appears in
   the sidebar Sub-workspaces list.
2. **Given** a sub-workspace, **When** the user renames/recolours/deletes it from the list, **Then**
   it behaves as project management does (delete shows the relocation warning and removes it).
3. **Given** a sub-workspace window, **When** the user closes it, **Then** the window closes but the
   sub-workspace persists in the list and reopens later with its tabs/panels intact.
4. **Given** the app is restarted, **When** it launches, **Then** sub-workspaces are listed but no
   sub-workspace window opens until the user clicks one (which lazy-loads its panels' projects).
5. **Given** a sub-workspace with panels from multiple projects, **When** the user drags a panel
   toward the main window, **Then** it can reattach only into its origin project's main workspace
   (and only if that project is active there); the main workspace never mixes projects.
6. **Given** the main window is closed (app exit), **When** the app closes, **Then** all
   sub-workspace windows close too.
7. **Given** multiple windows, **When** the user focuses any one, **Then** all come to the
   foreground together; minimise/restore is independent per window.

---

### User Story 8 — Theming, Settings & Keybindings Infrastructure (Priority: P3)

All colours, icons, and fonts are sourced from a swappable **theme**; the default is **"throng"**.
User configuration lives under the user's profile in JSON: a sectioned **settings** file (theme
selection, confirmation levels, pane visibility/width, etc.), a separate **keybindings** file
(mapping the existing shortcuts and zoom gestures), and theme files in a themes folder. Existing
keyboard shortcuts and mouse-zoom gestures are mapped into the keybindings file so they can be
changed later. No settings/theme/keybindings editor UI is included this iteration; files are edited
directly.

**Why this priority**: Foundational configuration capability that the other stories read from;
delivered as infrastructure with a single shipped theme.

**Independent Test**: Confirm app colours/icons/fonts (across all surfaces) resolve from the throng
theme file. Confirm `settings.json`, `keybindings.json`, and `themes\throng.json` exist under the
config directory and are sectioned/structured as specified. Edit a keybinding in the file and
confirm it takes effect **live** (no restart). Change the theme selection to a copied theme file and
confirm the swap applies live.

**Acceptance Scenarios**:

1. **Given** the app starts with no config present, **Then** default `settings.json`,
   `keybindings.json`, and the `throng` theme are created under `%USERPROFILE%\.throng\` with
   sensible defaults.
2. **Given** the throng theme, **When** the app renders, **Then** colours, icons, and fonts resolve
   from the theme across **all** application UI (no hardcoded values anywhere in the app).
3. **Given** `keybindings.json`, **Then** it contains the zoom in/out/reset and fullscreen keyboard
   bindings and the Ctrl+wheel / Ctrl+middle-click zoom gestures as editable entries.
4. **Given** the user edits any config file (settings, keybindings, or a theme) while the app runs,
   **When** the file is saved, **Then** the change is applied **live (hot-reload)** without a
   restart.

---

### User Story 9 — Single Instance & Lazy Project Loading (Priority: P3)

The application runs as a single instance: launching it again while running silently exits. Projects
are loaded lazily — at startup no project is selected and nothing is loaded; clicking a project (or
opening a sub-workspace) loads it (and its tabs/panels), which then stays in memory for the session.

**Why this priority**: Avoids the complications of multiple instances for terminal/project
management and keeps startup fast.

**Independent Test**: Launch the app twice; confirm the second launch exits without opening a window.
Start the app; confirm no project is selected and the sidebar lists projects/sub-workspaces. Click a
project; confirm it loads. Switch away and back; confirm it stayed in memory (no reload cost).

**Acceptance Scenarios**:

1. **Given** an instance is already running, **When** the app is launched again, **Then** the second
   launch silently exits (no new window, no focus change).
2. **Given** the app starts, **Then** no project is selected/loaded; the sidebar lists projects and
   sub-workspaces; the main workspace shows a project-selection prompt.
3. **Given** the user clicks a project, **When** it opens, **Then** it loads and remains in memory
   for the rest of the session even after switching to another project.

---

### User Story 10 — Left Pane Resize Handle Position (Priority: P3)

The resize handle between the left Sidebar Pane and the central workspace sits on the boundary
between them (at the right edge of the sidebar), not inside the sidebar.

**Why this priority**: Small visual correction; low risk, high tidiness.

**Independent Test**: Inspect the boundary between the left and middle panes; confirm the resize
handle is on the boundary and dragging it resizes the sidebar cleanly.

**Acceptance Scenarios**:

1. **Given** the left/middle boundary, **Then** the resize handle is positioned on the boundary
   (right edge of the sidebar), not inset within the sidebar.

---

### Edge Cases

- **Ghost on very small panels**: rendered at a minimum visible size.
- **Drag released inside the main window when detach was intended**: no detach; the item stays put.
- **Reattach to the wrong project**: a panel dragged toward the main window only reattaches into its
  origin project's main workspace, and only when that project is the active one; otherwise the drop
  is rejected and the panel returns.
- **Last panel/tab in a sub-workspace destroyed**: the sub-workspace cannot exist empty (≥1 tab / ≥1
  panel); destroying its last panel/tab deletes the sub-workspace and removes it from the list (the
  relocation warning applies).
- **Last panel/tab in the main workspace**: the never-empty invariant holds (≥1 Tab, ≥1 Panel per
  active project) — the destroy is refused (consistent with 002 FR-016).
- **All colours in use** (projects + sub-workspaces share the palette/registry): the picker falls
  back to the least-recently-used colour.
- **Project folder conflicts on create or edit** (identical / parent / child): rejected with an
  explanatory error; the form stays open.
- **Second app launch**: silently exits.
- **No project at startup**: left Sidebar shown (Projects + Sub-workspaces lists), right pane
  collapsed, central prompt shown; nothing loaded until clicked.
- **Pane width restored below minimum**: clamped to minimum.
- **Config file missing or unreadable**: defaults are (re)created; a malformed file falls back to
  defaults rather than crashing. A malformed **live edit** keeps the last good config applied rather
  than crashing.
- **Destroy Project while its panels are in sub-workspaces**: the destroy is refused; the user is
  shown which sub-workspaces and tabs hold the project's panels so they can relocate/close them
  first (FR-025a).
- **Closing the main window with open sub-workspaces**: all sub-workspace windows close (app exit);
  sub-workspaces persist for next launch (listed, not auto-opened).
- **Sub-workspace reopened on an unavailable display**: the saved position is off-screen (display
  removed/changed) → the window is clamped back onto a visible display (FR-017a).

## Requirements *(mandatory)*

### Functional Requirements

#### Drag Ghost & Active Panel

- **FR-001**: While dragging a tab or panel, the app MUST display a **faithful translucent snapshot**
  of the dragged item pinned to the cursor, **in addition to** the existing drop indicators. The
  ghost MUST follow the cursor for the whole drag, including when the pointer moves beyond the main
  window to detach, and MUST disappear on drop. It MUST be rendered at a **minimum visible size of
  at least 160×120 px** so it stays perceptible for tiny items.
- **FR-002**: Selecting a panel MUST **activate** it and display a visible **active highlight** in a
  theme-defined colour. Each tab MUST retain its own active panel; the active panel of the focused
  tab/window is the single globally-active panel. This applies in the main window and sub-workspaces.

#### Status Bar

- **FR-003**: Every window MUST display a single-line, fixed-height **status bar** at its bottom
  (its height is a theme-driven token, per FR-030).
- **FR-004**: In the **main window**, the status bar left side MUST show the active project's name
  (or a **"No project"** placeholder) and the right side MUST show the active tab and active panel
  names; all MUST update immediately on change.
- **FR-005**: In a **sub-workspace** window, the status bar left side MUST show the sub-workspace's
  **name and colour** followed by the active panel's **origin project** name; the right side MUST
  show the active tab and panel names; all MUST update immediately.

#### Side Panes

- **FR-006**: The app MUST display a right-hand **File Explorer Pane**; its content this iteration
  MUST be a **neutral empty-state placeholder** (the file tree is out of scope). It MUST be
  resizeable by its inner (left) edge with a minimum width, and MUST persist its width across
  restarts; sub-minimum persisted widths MUST be clamped.
- **FR-007**: Each side pane MUST be collapsible/expandable. An **expanded** pane MUST present a
  **Hide** control at its inner-top corner — Sidebar top-right, File Explorer top-left. A
  **collapsed** pane MUST become a **fixed-width rail** with a **Show** control and **rotated
  vertical text**: "Projects & Terminals" (Sidebar) / "Files & Folders" (File Explorer). Show
  re-expands to the persisted width.
- **FR-008**: Each pane's **width and visibility** MUST persist across restarts, stored **globally
  (user-level)** — one width + visibility per pane across all projects, not per project.
- **FR-009**: When **no project is active**, the left **Sidebar Pane MUST be shown by default**
  (unless the user has hidden it; that preference persists), and the right **File Explorer Pane MUST
  default to collapsed** but remain expandable to its empty placeholder.
- **FR-010**: The resize handle between the left Sidebar Pane and the central workspace MUST sit on
  the boundary (right edge of the sidebar), not inset within the sidebar.

#### Sub-Workspaces

- **FR-011**: A **sub-workspace** MUST be creatable **only by detaching** a tab or panel outside the
  main window (it always contains ≥1 tab and ≥1 panel; an empty sub-workspace MUST NOT exist).
- **FR-012**: Sub-workspaces MUST be **first-class entities** listed in a **Sub-workspaces** panel in
  the left sidebar **below Projects**. Each MUST have an independent **name** and **colour** and MUST
  be **renameable, recolourable, and deletable** in the same manner as projects, but MUST NOT have a
  project folder. On creation, a sub-workspace MUST be auto-named and assigned an unused colour from
  the shared palette.
- **FR-013**: A sub-workspace window MUST be **resizeable, minimisable, and closeable**, and MUST
  support **multiple tabs** (≥1), each behaving identically to a main-workspace tab (multi-panel
  split trees), **reusing the same workspace code**. A sub-workspace MAY hold panels from multiple
  projects.
- **FR-014**: **Closing** a sub-workspace window MUST keep the sub-workspace (it persists in the list
  and reopens later with tabs/panels intact). **Deleting** a sub-workspace from the list MUST destroy
  it — showing the relocation warning (advising the user to cancel and move panels back to their
  projects' main workspaces) before removing it.
- **FR-015**: Sub-workspaces MUST reopen **lazily**: at startup they are listed but not opened;
  opening one (by click) opens its window and lazy-loads the projects of its panels.
- **FR-016**: A panel MUST be reattachable only into its **origin project's** main workspace, and
  only when that project is the active project there; the main workspace MUST NOT mix projects.
- **FR-017**: All windows (main + sub-workspaces) MUST share one **focus/raise group** (focusing any
  brings all forward); **minimise/restore MUST be independent** per window. Closing the **main
  window** (app exit) MUST close all sub-workspace windows.
- **FR-017a**: A sub-workspace window's **on-screen position and size MUST be persisted** and
  restored when the sub-workspace is reopened. A window whose saved position falls on an
  **unavailable display** MUST be brought back onto a visible display (reusing the 002 `IDisplayInfo`
  seam), consistent with Constitution Principle XI.
- **FR-018**: Destroying the **last** panel/tab of a sub-workspace MUST delete the sub-workspace
  (it cannot exist empty).

#### Destroy Dialogs, Panel Close & Emulated Active Process

- **FR-019**: Destructive actions MUST use **"Destroy"** wording: **Destroy Tab**, **Destroy
  Panel**, **Destroy Project**, **Destroy other tabs**, each with a confirm button in a warning
  (red) colour.
- **FR-020**: A panel MUST be destroyable from a right-click **"Destroy Panel"** context-menu item
  **and** a **×** affordance on the panel header; both MUST route through **one shared closure flow**
  (and the same confirmation), subject to the main-workspace never-empty invariant.
- **FR-021**: Every panel MUST **emulate an "active process"** this iteration so the active-process
  warning logic can be exercised. This emulation MUST be clearly marked in code as temporary,
  to be removed when terminals/agents/editors are implemented. **App close MUST NOT warn** (panel
  subprocesses will persist in the background and reconnect on next project activation — deferred).
- **FR-022**: Destroy confirmations MUST surface for **Destroy Tab / Destroy Panel / Destroy Project
  / sub-workspace Delete**. The **Tab** dialog MUST list how many panels are in the tab and their
  (emulated) active states; the **Project** dialog MUST summarise the active panels per tab; the
  **Panel** dialog MUST appear only when the panel has an active subprocess (emulated → always true
  now).
- **FR-023**: The number of confirmations per destroy type MUST be a user setting using a **none |
  single | double** enum. Defaults (revised during implementation): **Project = double, Tab =
  double, Panel = double** — every destroy ends with the wry second confirmation by default. For
  **Destroy Project**: **double** = summary dialog then the wry
  confirmation; **single** = summary dialog only; **none** = immediate destruction.
- **FR-024**: The Destroy Project wry confirmation MUST label its confirm button **"Yes, I'm
  absolutely sure"** and its cancel button **"No, I concede"**.
- **FR-025**: Cancelling any destroy confirmation MUST perform no destructive action.
- **FR-025a**: **Destroy Project MUST be refused** while any of that project's panels exist in a
  sub-workspace. Instead of the destroy confirmation, the app MUST show a message that **lists the
  specific sub-workspaces and tabs** containing the project's panels, so the user can locate them
  and relocate or close them first. Once none of the project's panels remain in any sub-workspace,
  Destroy Project proceeds normally (FR-023/FR-024).

#### Project Creation & Folder Exclusivity

- **FR-026**: When the project creation form auto-populates the name from a selected folder (empty
  name only; existing text not overwritten), the name text MUST be **selected/highlighted** for
  immediate overtyping.
- **FR-027**: The colour picker MUST open on a colour **not in use** by any existing **project or
  sub-workspace** (LRU fallback if all used), with an adjacent **purpose label**.
- **FR-028**: Invalid submit MUST keep the form open with invalid fields highlighted until success.
- **FR-029**: A project's root folder MUST be **exclusively bound**: the app MUST reject, on
  **create and edit**, any folder that is **identical to**, an **ancestor (parent) of**, or a
  **descendant (subfolder) of** any existing project's root, keeping the form open with the folder
  field highlighted and an explanatory error. This is a fundamental restriction.

#### Theming, Settings & Keybindings

- **FR-030**: All **colours, icons, and fonts** across **all application UI** — both the existing
  002 surfaces (project list, tabs, panels, dialogs, status bar, panes) and the new UI in this
  feature — MUST resolve from a **theme** abstraction (no hardcoded values). The default theme MUST
  be named **"throng"** and MUST be a swappable theme definition; the active theme MUST be
  selectable by name in settings.
- **FR-031**: User configuration MUST be stored under **`%USERPROFILE%\.throng\`** as: a sectioned
  **`settings.json`**, a separate **`keybindings.json`**, and theme files in a **`themes\`** folder
  (default `themes\throng.json`). Missing/malformed config MUST fall back to created defaults rather
  than failing.
- **FR-031a**: Edits to any of these config files (settings, keybindings, theme) MUST be detected
  and applied **live (hot-reload)** — the running app re-reads and re-applies them without requiring
  a restart.
- **FR-032**: Settings MUST be organised into **sections** and MUST include at least: active theme,
  the three destroy-confirmation levels (FR-023), and per-pane visibility/width (FR-008). Values MUST
  be consumed through the typed settings abstraction (Constitution Principle X).
- **FR-033**: All existing keyboard shortcuts — zoom in (Ctrl+= / Ctrl++), zoom out (Ctrl+-), reset
  zoom (Ctrl+0), fullscreen (F11) — **and** the Ctrl+wheel / Ctrl+middle-click zoom gestures MUST be
  mapped into **`keybindings.json`** as editable bindings, so they can be changed in the future. No
  remapping UI is required this iteration.

#### App Lifecycle

- **FR-034**: The application MUST be **single-instance**: launching it while an instance is running
  MUST cause the second launch to **silently exit** (no new window, no focus change).
- **FR-035**: Projects MUST load **lazily**: at startup no project is selected/loaded; the sidebar
  lists projects and sub-workspaces and the main workspace shows a selection prompt. Opening a
  project (or a sub-workspace) loads it and its tabs/panels, which MUST then remain in memory for the
  session.

### Key Entities

- **Settings**: A versioned, user-scoped JSON file (`%USERPROFILE%\.throng\settings.json`) organised
  into sections; holds active theme, destroy-confirmation levels, per-pane visibility/width, and
  future keys. Consumed via the typed settings abstraction.
- **Keybindings**: A user-scoped JSON file (`keybindings.json`) mapping action identifiers to
  keyboard shortcuts and configurable mouse-zoom gestures.
- **Theme**: A swappable definition (file in `themes\`) of colours, icon set, and fonts. Default is
  **throng**; selected by name in settings.
- **Status Bar**: A per-window, read-only single-line bar; main window shows active project + tab +
  panel; sub-workspace shows sub-workspace name/colour + active panel's origin project + tab + panel.
- **Side Pane**: A docking zone with persisted **width** and **visibility** (expanded / collapsed
  rail). Applies to the left Sidebar Pane and the right File Explorer Pane.
- **File Explorer Pane**: The right side pane; an empty placeholder this iteration (tree deferred).
- **Sub-workspace**: A first-class, runtime-created window entity with an independent name and
  colour and no project folder; contains ≥1 tab (each ≥1 panel) and may mix projects' panels; listed
  and managed in the sidebar; persisted and reopened lazily.
- **Panel (active state)**: Each panel carries an **emulated** "active process" flag (temporary
  stand-in for future terminals/agents/editors) used by destroy/warning logic and the active-panel
  highlight.
- **Colour Palette Registry**: Colours in use across **projects and sub-workspaces**, used to pick
  an unused starting colour.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: During any tab/panel drag a faithful translucent ghost follows the cursor (alongside
  drop indicators) and persists through window-detach, disappearing cleanly on drop.
- **SC-002**: Selecting a panel highlights it as active; each tab restores its own active panel; the
  focused window's active panel is the globally-active one — verified by automated test.
- **SC-003**: Every window shows a status bar with the specified left/right content (main vs
  sub-workspace) that updates immediately on project/tab/panel change.
- **SC-004**: Each side pane collapses to a rail (correct rotated label) and re-expands; widths and
  visibility persist across restart; with no project the left sidebar is shown and the right pane is
  collapsed-but-expandable — verified by automated test.
- **SC-005**: Destroy actions use "Destroy" wording with red confirm buttons; Project destroy
  honours the none/single/double setting (double ends with "Yes, I'm absolutely sure" / "No, I
  concede"); panel destroy works identically from the context menu and the header ×.
- **SC-006**: A project cannot be created or edited to a folder identical to, a parent of, or a
  subfolder of another project's root — verified by automated test.
- **SC-007**: Detaching creates a sub-workspace listed in the sidebar; closing keeps it (reopens
  with contents **and restored window position/size**, with off-display windows brought onto a
  visible display); deleting destroys it (with relocation warning); at restart sub-workspaces are
  listed but not opened until clicked; closing the main window closes all sub-workspaces.
- **SC-008**: App colours/icons/fonts resolve from the throng theme across **all** application UI;
  `settings.json`, `keybindings.json`, and `themes\throng.json` exist under `%USERPROFILE%\.throng\`
  with the specified structure; an edit to any config file takes effect **live (hot-reload)** with no
  restart.
- **SC-009**: A second app launch silently exits; at startup no project is loaded; clicking a
  project loads it and it remains in memory for the session.
- **SC-010**: The left/middle resize handle sits on the pane boundary and resizes the sidebar
  cleanly.

## Assumptions

- **Foundational infrastructure ordering**: Settings, keybindings, and theming are foundational and
  are read by several other stories (confirmation levels, pane persistence, active-panel colour).
  Although grouped as later-priority user stories, the plan MUST sequence the settings/theme
  infrastructure early enough to support the features that depend on it.
- **Emulated active process is temporary**: Every panel's "active process" state is a deliberate,
  clearly-marked stand-in to be removed when terminals/agents/editors land. App-close persistence of
  real subprocesses (Constitution III's leave-running / reconnect behaviour) is therefore deferred
  with terminals; no app-close warning is shown this iteration.
- **File Explorer Pane content is deferred**: The pane ships as an empty shell; the file/folder
  hierarchy and Markdown preview are a staged delivery under the Constitution's Incremental Delivery
  rule (v3.2.0+), to be recorded in the plan's Complexity Tracking naming the future feature.
- **Sub-workspace creation UX**: Because creation is by detach (a drag gesture), a sub-workspace is
  auto-named (e.g. "Sub-workspace N") with an auto-assigned unused colour and renamed/recoloured
  later via the sidebar list; no name prompt occurs mid-drag.
- **Theme scope**: The theme defines app-chrome colours, the icon set, and fonts (family, base size,
  weights), and **all existing application UI is retrofitted** this iteration to resolve from it
  (whole-app theming). In-panel content fonts (future editor/terminal) are out of scope. Config
  files (settings/keybindings/theme) are **hot-reloaded** — applied live without a restart; a
  malformed live edit retains the last good config.
- **Pane state scope**: Side-pane width and visibility are stored **globally (user-level)**, not per
  project.
- **Config location supersedes prior notes**: User configuration lives in `%USERPROFILE%\.throng\`
  as JSON (superseding any earlier `%APPDATA%\throng` / YAML references); the daemon-owned SQLite
  store for projects/layout is unchanged.
- **Subprocess counts/states in dialogs are emulated**: Panel "active" states shown in destroy
  dialogs are emulated placeholders until terminals are implemented.
- **Status bar is read-only this iteration**: It displays context names/colours only.
- **Constitution alignment**: This feature requires constitution updates (left sidebar shown when no
  project; sub-workspaces as named/managed entities; single-instance; lazy loading; project folder
  exclusivity as fundamental). These are tracked alongside this spec.

## Out of Scope (this feature)

The following are intentionally out of scope and planned for later features:

- **The file/folder tree** and explorer toolbar, real-time file-system sync, and file-type icons.
- **Opening files and the embedded code editor**, syntax highlighting, line numbers, gutters,
  undo/redo, and save.
- **Recovery buffer**, file encoding/line-endings, and file-panel clean/dirty/deleted states.
- **Terminals and agents** (real subprocesses) — panel "active process" is emulated only.
- **Settings / theme / keybindings editor UI** — files are edited directly this iteration; only one
  theme ("throng") ships.
- **Markdown preview**, find/replace, multi-cursor, minimap.
- File rename/move/delete from the explorer, multi-selection, and drag-reorder.
- Import/export of project data.
- Operating systems other than Windows.
