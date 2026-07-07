# Phase 1 Data Model — Layout and app tweaks

Entities, schema changes, and validation rules. Domain types live in `@throng/core` (pure).
Daemon-owned SQLite changes are **migration v4**; the per-project layout JSON document bumps to
**schema v2**; user config lives in UI-main-owned JSON files.

## 1. Core domain changes (`@throng/core`)

### 1.1 Tab (extended) — active panel

```
Tab {
  id: string
  title: string
  root: LayoutNode
  activePanelId: string   // NEW (schema v2) — references a Panel within `root`
}
```
- **Invariant**: `activePanelId` MUST reference an existing Panel in `root`. After any operation
  that removes the active panel, `activePanelId` MUST be reset to another panel in the tab
  (e.g. the nearest sibling), never dangling.
- **Migration (in code, v1→v2)**: if absent, default to the first Panel of the tab.

### 1.2 SubWorkspace (extended) — first-class identity

```
SubWorkspace {
  id: string
  ownerUser: string
  name: string          // NEW — friendly name (auto "Sub-workspace N" on create)
  colour: string        // NEW — dominant colour (auto unused from shared palette)
  tabs: Tab[]           // ≥1 tab, each ≥1 panel
  bounds: SubWorkspaceBounds
}
```
- **Invariants**: ≥1 tab; each tab ≥1 panel; MAY hold panels from multiple projects.
- **Lifecycle**: created by detach only; **close** keeps it (persisted, reopenable); **delete**
  removes it (after relocation warning). Destroying its **last** panel/tab deletes the
  sub-workspace.
- **Window bounds** (`SubWorkspaceBounds`: x/y/width/height/displayId — already in the model) are
  persisted and restored on reopen; a window whose `displayId`/position is unavailable is clamped
  onto a visible display via `IDisplayInfo` (FR-017a).

### 1.3 LayoutNode / Panel — unchanged shape
`Panel.originProjectId` already exists and drives reattach-to-origin and the status bar's origin
project. `LAYOUT_SCHEMA_VERSION` → **2**.

### 1.4 Project — validation (extended)
- **Folder exclusivity** (FR-029): on create and edit, reject a root folder that is identical to,
  an ancestor of, or a descendant of any other project's root (normalised: resolved, Windows
  case-fold, trailing-separator-insensitive). The edited project excludes itself from comparison.

## 2. Application settings (UI-main-owned JSON: `settings.json`)

Sectioned document; pure schema + defaults + merge/validate live in `core/config/app-settings.ts`.

```
AppSettings {
  version: number                 // schema version for forward migration
  appearance: {
    theme: string                 // active theme name; default "throng"
  }
  confirmations: {                // none | single | double
    destroyProject: "none"|"single"|"double"   // default "double"
    destroyTab:     "none"|"single"|"double"    // default "double" (wry second)
    destroyPanel:   "none"|"single"|"double"    // default "double" (wry second; gated on active)
  }
  panes: {                        // GLOBAL (user-level), not per-project
    sidebar:      { visible: boolean; width: number }   // default visible=true
    fileExplorer: { visible: boolean; width: number }   // default visible=false (collapsed)
  }
}
```
- **Defaults applied** when keys are missing; **unknown keys preserved** on rewrite where feasible.
- **Validation**: enum membership; positive widths (sub-minimum clamped on use, FR-006);
  malformed file → last-good/defaults (no crash).

## 3. Keybindings (UI-main-owned JSON: `keybindings.json`)

```
Keybindings {
  version: number
  bindings: {
    "zoom.in":        ["Ctrl+=", "Ctrl++", "Ctrl+WheelUp"]
    "zoom.out":       ["Ctrl+-", "Ctrl+WheelDown"]
    "zoom.reset":     ["Ctrl+0", "Ctrl+MiddleClick"]
    "view.fullscreen":["F11"]
  }
}
```
- Action ids are stable; values are editable binding lists (keyboard chords + the named mouse-zoom
  gestures). Pure resolver in `core/config/keybindings.ts` maps an input event → action id.
- Unknown action ids ignored; malformed → defaults.

## 4. Theme document (UI-main-owned JSON: `themes\<name>.json`, default `throng.json`)

```
Theme {
  name: string                    // "throng"
  colours: { [token: string]: string }   // e.g. surface, surfaceActive (active panel), text,
                                          //      accent, danger (destroy), railBg, border, ...
  fonts:   { family: string; baseSizePx: number; weights: {normal:number; bold:number} }
  icons:   { [name: string]: string }     // icon token → icon id/source
}
```
- Resolved to CSS custom properties (`--throng-colour-*`, `--throng-font-*`) by the renderer
  `ThemeProvider`. The **active-panel highlight** uses `surfaceActive`; **destroy** buttons use
  `danger`. Missing tokens fall back to the throng defaults (no unstyled UI).

## 5. Persistence — migrations v4 / v5 (daemon-owned SQLite)

`migration-runner` registers **v4** then **v5** (after v3). `user_version` → 5.

```
-- v4 (sub-workspace identity)
ALTER TABLE sub_workspaces ADD COLUMN name   TEXT NOT NULL DEFAULT 'Sub-workspace';
ALTER TABLE sub_workspaces ADD COLUMN colour TEXT NOT NULL DEFAULT '#8a8f98';
-- v5 (per-owner list order)
ALTER TABLE sub_workspaces ADD COLUMN position INTEGER NOT NULL DEFAULT 0;  -- + backfill by updated_at
```
- Backfill: existing rows get the column DEFAULTs (`Sub-workspace` / neutral grey); the renderer
  shows a generated `Sub-workspace N` name. New rows always set all columns.
- `ISubWorkspaceStore` (core port) + `subworkspace-repository` (impl): `list(ownerUser)`,
  `rename(id, name)`, `recolour(id, colour)`, `delete(id)`, plus the existing
  create/load/save-bounds paths.
- **Layout schema v2**: `workspace-repository` migrates the stored layout JSON on load
  (adds `activePanelId`); save always writes v2.

### 5.1 Migration strategy & the schema-drift safety net

The store is versioned by SQLite's `user_version` PRAGMA. The runner applies, in ascending
order, every registered migration whose version exceeds the stored `user_version`, each in its
own transaction, stamping the version after each step. This is the normal forward path.

**Rules (append-only history):**
1. Migrations are **append-only and immutable once released**. Never edit or renumber a migration
   that may have run on a real store — give the change a *new* version instead.
2. Every `ALTER TABLE … ADD COLUMN` MUST carry a `NOT NULL DEFAULT` (so existing rows backfill and
   the column is safe to add idempotently) and MUST be registered in `schema-guard.ts`
   (`ADDITIVE_COLUMNS`), applied via `addColumnsFor`. That list is the single source of truth — the
   migration and the safety net both drive off it, so there is one definition per column.

**Why a safety net (the bug this prevents):** a pure `user_version` runner *trusts* the stamped
version to reflect the real schema. During development a migration can be renumbered/re-purposed,
leaving a store stamped *ahead* of its actual columns — e.g. `user_version = 5` but
`sub_workspaces` missing the v4 `name`/`colour` columns. The runner then reports "up to date" and
heals nothing, and every write throws `no such column: name`. (Observed symptom: creating a
sub-workspace silently did nothing.)

**The safety net:** after the version loop, `runMigrations` always calls `reconcileSchema(db)`,
which re-asserts every registered additive column and adds any that are missing — *regardless of
`user_version`*. It is idempotent (a column already present is skipped) and non-destructive
(defaults backfill). Repairs are returned in `MigrationResult.repairs` and logged loudly by the
daemon (`schema-guard healed N drifted column(s): …`). A healthy store yields zero repairs. This
self-heals an existing drifted store on next launch with no manual SQL.

## 6. IPC additions (JSON-RPC over the named pipe)

- **`subworkspace.list`** → `{ subWorkspaces: SubWorkspaceMeta[] }` (id, name, colour, bounds)
- **`subworkspace.rename`** `{ id, name }` → `{ ok }`
- **`subworkspace.recolour`** `{ id, colour }` → `{ ok }`
- **`subworkspace.delete`** `{ id }` → `{ ok }`
- **`workspace.load` / `workspace.save`** (existing) carry layout **schema v2** payloads.

Config (settings/keybindings/theme) is **not** over the pipe — it flows renderer ⇄ UI main via the
preload bridge (`config.get`, `config.onChange`, `config.set` where applicable). See
`contracts/config-files.md` and `contracts/os-config-store.md`.

## 7. Entity relationships (summary)

- **Project** 1—* **Panel** (via `Panel.originProjectId`); a Panel lives in exactly one project.
- **SubWorkspace** *—* **Project** (indirect, through the panels it hosts; folderless itself).
- **AppSettings / Keybindings / Theme** are singletons per user (files); Theme selected by
  `AppSettings.appearance.theme`.
- **Pane state** is global (in AppSettings), not per project.
