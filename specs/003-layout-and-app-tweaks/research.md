# Phase 0 Research — Layout and app tweaks

All Technical Context unknowns are resolved below. Each decision is **Decision / Rationale /
Alternatives**. Spec clarifications (2026-06-27 sessions) are the primary inputs; nothing here
re-opens a settled clarification.

## D1 — User config storage, format & ownership

**Decision**: Store user configuration as JSON files under **`%USERPROFILE%\.throng\`**:
`settings.json` (sectioned), `keybindings.json`, and theme documents in `themes\` (default
`themes\throng.json`). The files are **owned by the UI main process** behind a new `IConfigStore`
seam; the renderer never touches the filesystem. Defaults are created on first run; a missing or
malformed file falls back to last-good (or defaults) without crashing.

**Rationale**: Spec mandates human-editable JSON, sectioned, under the user profile. The renderer
is sandboxed (no `fs`); UI main already performs file I/O (`window-state.ts`). Theming/keybindings
are UI concerns with no durable-state stake, so they should not sit behind the daemon's SQLite.

**Alternatives**: Daemon-owned (rejected — IPC latency on every read, couples UI styling to the
durable-state writer); SQLite (rejected — spec requires editable files); `%APPDATA%\throng` /
YAML (rejected — superseded by the spec's `.throng` / JSON decision).

## D2 — Whole-app theming mechanism

**Decision**: Represent the active theme as a JSON document of **colour / font / icon tokens**;
apply it by setting **CSS custom properties** (`--throng-*`) on the document root via a
`ThemeProvider`. All existing 002 components are retrofitted to consume `var(--throng-*)` instead
of hardcoded values. Icons resolve through a theme-provided icon map; fonts through CSS vars.

**Rationale**: CSS variables give a whole-app, zero-rebuild re-paint on swap/hot-reload with
minimal coupling; trivially testable (assert computed custom properties). Matches "all colours,
icons, fonts" across existing + new UI.

**Alternatives**: CSS-in-JS theme framework (rejected — bundle weight, YAGNI); per-component colour
props (rejected — wouldn't cover "all UI" and resists live swap); SCSS recompilation (rejected —
no live swap).

## D3 — Live hot-reload of config

**Decision**: UI main watches `%USERPROFILE%\.throng\` via **chokidar** (behind `IFileWatcher`).
On change it re-reads + validates the affected document and **pushes** the new config to every
renderer window over the preload bridge; the renderer re-applies (theme → reset CSS vars;
keybindings → re-bind; settings → update stores). A malformed edit keeps the **last good** config
applied and is surfaced (non-fatal log/notice). Debounced to coalesce rapid saves.

**Rationale**: Spec requires live application without restart. Watching in main (single fs owner)
and pushing to renderers keeps the sandbox intact and all windows consistent.

**Alternatives**: Polling (rejected — latency/cost); restart-only (rejected — spec wants live);
renderer-side watching (rejected — sandbox).

## D4 — Keybindings model

**Decision**: A pure **keybinding registry** in core mapping stable **action ids** →
binding descriptors, with documented defaults serialised to `keybindings.json`. This iteration maps
the existing accelerators — `zoom.in` (Ctrl+= / Ctrl++), `zoom.out` (Ctrl+-), `zoom.reset`
(Ctrl+0), `view.fullscreen` (F11) — **and** the mouse-zoom gestures (`zoom.in/out` via Ctrl+wheel,
`zoom.reset` via Ctrl+middle-click) as editable entries. Main-process accelerators read from the
config (UI main); renderer gestures read the mirrored config. No remap UI this iteration.

**Rationale**: Centralising bindings makes them changeable later (spec) and keeps both the
main-process accelerators and renderer gestures in one source of truth.

**Alternatives**: Leaving accelerators hardcoded (rejected — spec); a full command palette (YAGNI).

## D5 — Sub-workspaces as first-class entities

**Decision**: Promote `SubWorkspace` to a first-class entity: add `name` and `colour` (it already
carries `id`, `ownerUser`, `tabs`, `bounds`). Persist via **migration v4** (`name`, `colour`
columns on the existing `sub_workspaces` table) and a new `ISubWorkspaceStore` /
`subworkspace-repository`. Manage via new **`subworkspace.*`** IPC (list/rename/recolour/delete).
The sidebar gains a **Sub-workspaces** panel (below Projects) reusing the project-list row UI.
Sub-workspace **windows reuse the existing workspace tab/panel renderer** (DRY). Created **only by
detach**; auto-named (`Sub-workspace N`) + auto unused colour from the shared palette.

**Rationale**: Spec makes sub-workspaces named/coloured/listed/managed like projects but
folderless; reusing the workspace code satisfies DRY and the "same as main workspace" requirement.

**Alternatives**: Keeping sub-workspaces anonymous/ephemeral (rejected — spec); a separate window
UI distinct from the main workspace (rejected — DRY/"same code").

## D6 — Single instance

**Decision**: Use Electron **`app.requestSingleInstanceLock()`** in UI main. If the lock is not
acquired, the second process **quits immediately** (`app.quit()`) with no window and no focus
change. The first instance's `second-instance` event is intentionally **ignored** (no focus), per
the spec's "silently exit".

**Rationale**: Native, race-free single-instance; matches the spec's silent-exit choice exactly.

**Alternatives**: Focus-existing-then-exit (rejected by clarification); PID/lock-file (rejected —
reinvents the Electron primitive).

## D7 — Lazy project & sub-workspace loading

**Decision**: At startup load only **metadata lists** (projects, sub-workspaces — names/colours);
**no project layout is loaded and no sub-workspace window is opened** until the user clicks one.
**No project is selected at startup**; the main workspace shows the selection prompt; the left
sidebar is shown. Opening a project calls `workspace.load` and caches it in memory for the session;
opening a sub-workspace from the list opens its window and lazy-loads its panels' projects.
Switching away does not unload.

**Rationale**: Spec (fully lazy; nothing loaded until clicked; stays in memory once loaded) and the
launch-budget goal.

**Alternatives**: Eager restore of last project / all sub-workspaces (rejected by clarification).

## D8 — Active panel

**Decision**: Add `activePanelId` to `Tab` (layout **schema v2**); add a pure `setActivePanel`
operation. The **globally active** panel is the active panel of the focused window's active tab.
On load, schema v1 documents are migrated in code (default `activePanelId` = first panel of each
tab). The active panel drives the theme-coloured highlight and the status bar's "active panel".

**Rationale**: Per-tab active panel with a single global focus matches the clarification; storing it
in the layout JSON keeps it persisted per project/tab with no SQL change.

**Alternatives**: A single global active panel only (rejected — loses per-tab memory); a separate
store (rejected — belongs with the layout).

## D9 — Drag ghost (in-window and during detach)

**Decision**: **In-window**: render a translucent **snapshot** of the dragged tab/panel as a DOM
overlay pinned to the cursor (clone the panel header + a faded body; min size enforced), alongside
the existing drop indicators. **During detach** (pointer leaves the main window): a frameless,
transparent, always-on-top **follower BrowserWindow** (managed by `window-manager`) renders the
same ghost and tracks the cursor across the desktop until drop. The ghost disappears on drop.

**Rationale**: A DOM overlay cannot paint outside its window; a small follower window provides the
"holding it across the screen" feel through detach. Both reuse one ghost component.

**Alternatives**: Native OS drag image (rejected — limited styling, no translucent snapshot);
`html2canvas` rasterisation (rejected — heavyweight; a styled clone suffices).

## D10 — Destroy terminology, shared close flow & confirmation enum

**Decision**: Rename destructive actions to **Destroy Tab / Destroy Panel / Destroy Project /
Destroy other tabs** with a red confirm button. One **shared panel-close flow** serves the
context-menu "Destroy Panel" item and the panel-header **×**. A pure `destroy` module computes the
confirmation requirement from a **`none|single|double`** enum per type (Tab/Panel treat `double` as
`single`; defaults Project=double, Tab=single, Panel=single) plus the panel's (emulated)
active-process state: **Panel** dialog only when active; **Tab** dialog lists panel count + states;
**Project** dialog summarises active panels per tab, then (double) the wry confirm
("Yes, I'm absolutely sure" / "No, I concede"). **Destroy Project is refused** while the project has
panels in any sub-workspace, naming the sub-workspaces/tabs that hold them.

**Rationale**: Directly encodes the clarifications; keeping the decision pure in core makes it
unit-testable and keeps the dialogs thin.

**Alternatives**: Per-call ad-hoc confirmation logic (rejected — duplication, DRY); booleans instead
of the enum (rejected — can't express double).

## D11 — Project folder exclusivity

**Decision**: Extend core project validation to **normalise** paths (resolve, case-fold on Windows,
trailing-separator-insensitive) and **reject** a candidate root that is identical to, an ancestor
of, or a descendant of any existing project's root — on both **create and edit** (excluding the
project being edited from the comparison). Surface a specific validation error; the dialog stays
open with the folder field highlighted.

**Rationale**: Spec marks this a fundamental restriction (now constitution Principle I); pure
path logic belongs in core and is easily unit-tested.

**Alternatives**: Create-only (rejected — clarification says create+edit); DB-level constraint
(rejected — can't express ancestor/descendant cleanly; validation belongs in the domain).

## D12 — Pane state scope & the empty File Explorer Pane

**Decision**: Side-pane **width + visibility** (collapsed/expanded) for both the left Sidebar Pane
and the right File Explorer Pane are stored **globally** in `settings.json` (user-level, not
per-project). The **File Explorer Pane ships empty** (neutral placeholder); the left Sidebar is
**shown by default** with no project, the right pane **defaults collapsed** with no project but is
expandable to the placeholder. The left/middle resize handle is repositioned onto the pane boundary.

**Rationale**: Panes aren't project-specific (clarification: global). The empty pane + sidebar-shown
behaviour matches the clarifications and constitution v3.3.0.

**Alternatives**: Per-project pane state (rejected — clarification); hiding the sidebar with no
project (rejected — you need it to pick a project).

## Resolved unknowns

No `NEEDS CLARIFICATION` markers remain in Technical Context. New dependency: **chokidar v4**
(config watching). No other new runtime dependencies (theming uses native CSS variables; icons via
the theme map). Deferred (tracked): File Explorer tree + Markdown preview (Incremental Delivery);
real terminal/agent/editor subprocesses (panel active-process emulated).
