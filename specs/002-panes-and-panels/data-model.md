# Phase 1 Data Model: Panes & Panels Workspace

**Feature**: 002-panes-and-panels | **Date**: 2026-06-26 | **Source**: [spec.md](./spec.md), [research.md](./research.md)

Two layers are modelled: the **domain model** (pure types + invariants in `@throng/core`,
process-independent) and the **persistence schema** (migration v2 in `@throng/persistence`,
daemon-owned). The renderer mirrors the domain model; the daemon stores it.

---

## 1. Domain entities (`@throng/core`)

### Project (`projects/project.ts`)
| Field | Type | Notes |
|-------|------|-------|
| `id` | string (uuid) | stable identity |
| `ownerUser` | string | OS user id (from `IUserContext`); see [research D6] |
| `name` | string | required, non-empty, ≤ 120 chars |
| `colour` | string | dominant colour (hex, e.g. `#6aa3ff`); applied as active accent |
| `rootFolder` | string | absolute path (Principle I); not browsed this iteration |
| `createdAt` / `updatedAt` | ISO-8601 string | bookkeeping |

**Validation**: `name` non-empty after trim; `colour` a valid hex; `rootFolder` a non-empty path.
**Relationships**: a Project owns exactly one **WorkspaceLayout** and one **Terminals list**
(placeholder, empty this iteration).

### WorkspaceLayout (`workspace/model.ts`)
The active project's Workspace Pane. A **tab group**.
| Field | Type | Notes |
|-------|------|-------|
| `projectId` | string | owner project |
| `tabs` | `Tab[]` | ordered; length ≥ 1 |
| `activeTabId` | string | references one of `tabs` |
| `schemaVersion` | number | layout-document version (for forward migration) |

### Tab (`workspace/model.ts`)
| Field | Type | Notes |
|-------|------|-------|
| `id` | string | stable |
| `title` | string | user-visible (default e.g. "Tab 1") |
| `root` | `SplitNode \| PanelRef` | the Tab's split tree (≥ 1 Panel) |

### SplitNode (recursive) (`workspace/model.ts`)
| Field | Type | Notes |
|-------|------|-------|
| `orientation` | `'row' \| 'column'` | tiling direction |
| `children` | `Array<SplitNode \| PanelRef>` | ≥ 2 children |
| `sizes` | `number[]` | fractional sizes, sum ≈ 1, aligns with `children` |

A leaf is a `PanelRef` (`{ panelId }`); the tree nests to arbitrary depth.

### Panel (`workspace/model.ts`)
| Field | Type | Notes |
|-------|------|-------|
| `id` | string | stable |
| `originProjectId` | string | the Panel's **original project** (drives merge-back, FR-023/024) |
| `title` | string | placeholder label (e.g. "Panel 3") |
| `kind` | — | **absent this iteration** (untyped placeholder, FR-015); future: `'editor' \| 'terminal'` |

### Sidebar (fixed) (`workspace/model.ts`)
Not user-editable structurally this iteration: the Sidebar Pane hosts two stacked Panels —
`projects` (list + CRUD/switch) and `terminals` (active project's list, placeholder).

### SubWorkspace (`workspace/sub-workspace.ts`)
| Field | Type | Notes |
|-------|------|-------|
| `id` | string | stable |
| `ownerUser` | string | owner |
| `tabs` | `Tab[]` | ≥ 1; Panels inside MAY reference different `originProjectId`s (cross-project allowed) |
| `bounds` | `{ x, y, width, height, displayId }` | for window restore (validated by `IDisplayInfo`) |

---

## 2. Invariants (`workspace/invariants.ts`) — unit-tested (Principle V)

| Inv | Rule | Spec ref |
|-----|------|----------|
| INV-1 | Every Tab's tree contains ≥ 1 Panel | FR-013/016 |
| INV-2 | The active project's WorkspaceLayout always has ≥ 1 Tab with ≥ 1 Panel (never empty) | FR-010/016, SC-005 |
| INV-3 | Removing a Panel collapses its split slot; a `SplitNode` with one remaining child is replaced by that child | FR-016, SC-005 |
| INV-4 | The **main** WorkspaceLayout contains only Panels whose `originProjectId === projectId` (no cross-project mixing) | FR-024, SC-009 |
| INV-5 | A SubWorkspace MAY contain Panels from multiple `originProjectId`s | FR-021, SC-007 |
| INV-6 | A Panel reattaches to the main workspace **only** into the layout of its `originProjectId`; if that project is gone, reattach is refused and the Panel retained | FR-023/025, SC-009 |
| INV-7 | `activeTabId` always references an existing Tab; `sizes` length matches `children` and sums ≈ 1 | rendering correctness |

**Operations** (`workspace/operations.ts`), each returns a new invariant-valid state or a typed
error: `addTab`, `addPanel`, `splitPanel(edge)`, `movePanel(target)`, `reorderTab`, `removePanel`
(→ collapse), `detachTab`, `detachPanel`, `reattachPanel`, `switchProject`.

---

## 3. Persistence schema — migration **v2** (`@throng/persistence`)

`PRAGMA user_version` advances `1 → 2` (idempotent; re-run is a no-op). Adds:

```sql
CREATE TABLE projects (
  id           TEXT PRIMARY KEY,
  owner_user   TEXT NOT NULL,
  name         TEXT NOT NULL,
  colour       TEXT NOT NULL,
  root_folder  TEXT NOT NULL,
  is_active    INTEGER NOT NULL DEFAULT 0,   -- one active per owner_user
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
CREATE INDEX idx_projects_owner ON projects(owner_user);

CREATE TABLE workspace_layout (
  owner_user     TEXT NOT NULL,
  project_id     TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  schema_version INTEGER NOT NULL,
  layout_json    TEXT NOT NULL,              -- the recursive Tab/split/Panel tree (research D5)
  updated_at     TEXT NOT NULL,
  PRIMARY KEY (owner_user, project_id)
);

CREATE TABLE sub_workspaces (
  id           TEXT PRIMARY KEY,
  owner_user   TEXT NOT NULL,
  bounds_json  TEXT NOT NULL,                -- {x,y,width,height,displayId}
  content_json TEXT NOT NULL,                -- tabs/panels (may reference multiple projects)
  updated_at   TEXT NOT NULL
);
CREATE INDEX idx_subws_owner ON sub_workspaces(owner_user);
```

**Repositories** (implement core ports): `ProjectRepository` (`IProjectStore`) — list/create/
update/delete/setActive/**reorder**, scoped by `owner_user`; `WorkspaceRepository` (`IWorkspaceStore`) —
load/save `layout_json` per project, and persist/load sub-workspaces. All writes go through the
**daemon** (single writer, research D4).

### Migration **v3** — project ordering (clarification 2026-06-26c)

`PRAGMA user_version` advances `2 → 3`. Adds a per-owner display order so the project list can be
reordered by dragging (FR-046):

```sql
ALTER TABLE projects ADD COLUMN position INTEGER NOT NULL DEFAULT 0;
-- backfill existing rows by created order (0-based, per owner; no window functions)
UPDATE projects SET position = (
  SELECT COUNT(*) FROM projects p2
   WHERE p2.owner_user = projects.owner_user
     AND (p2.created_at < projects.created_at
          OR (p2.created_at = projects.created_at AND p2.id < projects.id)));
```

`ProjectRepository.list` orders by `position ASC, created_at ASC, id ASC`; `insert` assigns the next
position (`MAX(position)+1`) so new projects append; `reorder(ownerUser, orderedIds)` rewrites
positions to the given sequence in a transaction. The core port gains
`IProjectStore.reorder` and `ProjectService.reorder`, surfaced over IPC as `projects.reorder`.

### Window state (UI main, not in the store)

The main window's geometry (x/y/width/height + maximized) is persisted by the **UI main process** to
`window-state.json` in the per-user profile (`app.getPath('userData')`) on window close, and restored
on launch — clamped onto a visible display via `IDisplayInfo.clampToVisible` (FR-047/028). Minimum
window size is **640 × 480** (FR-048). This is UI chrome, not domain/daemon state, so it lives outside
the SQLite store.

**Fallback** (FR-029): if `layout_json` is missing or unparseable, return the **default empty
workspace** (one Tab, one untyped placeholder Panel) and signal the caller that restore failed.

---

## 4. IPC message shapes (`@throng/ipc-contract`) — see `contracts/`

- `projects.*` → [contracts/ipc-projects.md](./contracts/ipc-projects.md)
- `workspace.*` → [contracts/ipc-workspace.md](./contracts/ipc-workspace.md)

Wire transport unchanged: newline-delimited JSON-RPC 2.0 over the named pipe; unknown method →
`-32601`; existing `health.ping` untouched.

---

## 5. Configuration additions (`@throng/core/config/settings.ts`, Principle X)

| Setting | Where injected | Default | Purpose |
|---------|----------------|---------|---------|
| `workspace.autosaveDebounceMs` | renderer + main | 500 | debounce `workspace.save` (research D4) |
| `workspace.defaultSubWindow` | UI main | `{width:900,height:700}` | new sub-workspace window size |
| `ui.window` (existing) | UI main | `1280×800` | main window |

All sourced from injected typed settings; overridable via env at the composition roots, never read
ad-hoc in components.
