# The dockable workspace — constitution detail

Binding: constitution Principle XI (`.specify/memory/constitution.md`, *XI. Dockable Workspace: Panes, Tabs & Panels*). The
constitution keeps a one-line MUST for each rule below and points here for its detail, which was
moved verbatim from v7.4.0 at v7.4.1. This file is part of the constitution: change it only through
a constitution amendment (`throng-spec-governance`), and keep the constitution's one-line MUST in
step with it. "Above" and "below" in the text refer to this file, or to the constitution where the
rule named is not here.

## The default layout

- The default layout MUST provide at least two top-level Panes. When a project is
  active, the layout is three Panes: a **Sidebar Pane** hosting the **Projects**
  Panel and a **Sub-workspaces** Panel **stacked** (non-tabbed), with the
  **Sub-workspaces Panel pinned to the bottom** of the pane; a **Workspace Pane**
  showing the **active project's** workspace; and a **File Explorer Pane** on the
  right showing the active project's file and folder hierarchy. When no project is active, the **Sidebar Pane MUST remain shown by default**
  (so the user can select a project) unless the user has explicitly hidden it, while
  the **File Explorer Pane defaults to collapsed** but remains expandable to an empty
  placeholder. Each pane's visibility and width are user-controlled and persisted.
  The Workspace Pane (showing a project-selection prompt) remains visible.

## Sub-workspaces and the focus/raise group

- A **Tab** (with all its Panels) or a single **Panel** MUST be detachable
  ("disconnected") into a separate OS window — a **sub-workspace**. A sub-workspace
  MUST contain one or more Tabs (each with at least one Panel) and MAY hold
  Tabs/Panels from **multiple projects**; it cannot exist empty.
- A **sub-workspace is a first-class entity**: created at runtime by detach, it has
  an independent friendly name and dominant colour (no project folder), is listed and
  managed (rename / recolour / delete) in the Sidebar Pane's Sub-workspaces Panel,
  and is persisted. **Closing** a sub-workspace window retains it (reopenable);
  **deleting** it from the list destroys it. Sub-workspaces, like projects, are
  reopened **lazily** (listed at startup, opened on demand).
- The main window and every sub-workspace window MUST behave as a single
  **focus/raise group**: focusing any one of them MUST bring them all to the
  foreground together (they share one effective OS Z-order). **Minimise/restore MAY
  be independent** per window. Closing the main window (application exit) MUST close
  all sub-workspace windows.

## Focus follows the active Panel; a loaded Panel keeps its state

- **Focus follows the active Panel.** Every Panel type MUST have a keyboard focus target.
  When a Panel becomes the active Panel by a keyboard route (a focus.* chord, focus.workspace,
  a tab switch), DOM focus MUST move into it: to the control inside it that last held focus,
  else its first focusable control (an untyped Panel: its type picker; Find in Files: its
  search box). Focus MUST NOT stay behind in a Panel that is no longer active. A new Panel
  type is not done until it meets this. A switch made from the Projects list is the
  exception: focus stays on the list (046 FR-082).
- **A loaded Panel keeps its state.** A Panel's state — its view state (caret, selection, scroll
  position, folds, per-panel zoom, a terminal's viewport) and its transient UI state (an open find
  bar's query, options, current match and highlights) — MUST NOT change when the Panel is hidden
  by a tab switch, dragged, resized, split, moved to another Tab, synced into a sub-workspace or
  moved to another window, **including where the move rebuilds the Panel's view or hands it to
  another window's renderer**. That state survives everything while the Panel is **loaded**, and
  is lost only when the Panel is **unloaded**: closed or destroyed, its project unloaded, or the
  application quit. A new Panel type, or new state on an existing one, is not done until it meets
  this. Content state is governed by *One document, one state* above, not by this rule.
