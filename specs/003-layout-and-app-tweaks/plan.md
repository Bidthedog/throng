# Implementation Plan: Layout and app tweaks

**Branch**: `003-layout-and-app-tweaks` | **Date**: 2026-06-27 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/003-layout-and-app-tweaks/spec.md`

## Summary

A broad tranche of layout and application-level improvements on top of the 002 docking
workspace. It introduces three pieces of **foundational infrastructure** — user-scoped JSON
**settings**, **keybindings**, and a swappable **theme** (default "throng"), all under
`%USERPROFILE%\.throng\` and **hot-reloaded** live — and uses them across the UX work:

- **Drag ghost** (cursor-attached translucent snapshot, in addition to drop indicators; visible
  through window-detach) and a **highlighted active panel** (per-tab; the focused tab's active
  panel is globally active).
- **Whole-app theming** — every colour, icon, and font across existing 002 surfaces + new UI
  resolves from the active theme (CSS custom properties + theme-provided icon/font tokens).
- **Per-window status bar** (main: project / tab / panel; sub-workspace: sub-workspace
  name+colour then active panel's origin project / tab / panel).
- **Collapsible side panes** — a right **File Explorer Pane** shipped as an empty placeholder
  (tree deferred), collapse-to-rail for both panes, left sidebar shown by default with no project.
- **First-class sub-workspaces** — detach-created windows that are named/coloured, listed and
  managed in a new sidebar Sub-workspaces panel; close=keep, delete=destroy; reopened lazily;
  resizeable/minimisable/closeable; multi-tab reusing the workspace code.
- **Destroy dialogs** — "Destroy Tab/Panel/Project/other tabs" wording, a `none|single|double`
  confirmation enum, the wry project double-confirm, a shared panel-close flow (context menu +
  header ×), and **emulated** panel "active process" so the warning logic runs now.
- **Project rules** — folder exclusivity (no shared/ancestor/descendant roots; create+edit) and
  creation polish (name auto-selected, unused colour, label, inline validation).
- **App lifecycle** — single-instance and lazy project loading.

**Technical approach** — keep the constitutional boundaries from 001/002 intact:

- Domain stays pure in **`@throng/core`**: extend the workspace model with `Tab.activePanelId`
  and a first-class `SubWorkspace` (name + colour); add destroy/active-panel operations and
  folder-exclusivity validation; add typed settings/keybindings/theme interfaces. Zero OS/DOM
  imports (guarded).
- **Config (settings/keybindings/theme) is UI-main-owned files**, not daemon/SQLite: the
  renderer is sandboxed, the files are human-edited, and hot-reload is a UI concern. UI main
  reads/validates/writes them behind a new `IConfigStore` + `IFileWatcher` seam (chokidar) and
  pushes changes to every renderer window over the preload bridge.
- **Theming** is delivered via **CSS custom properties** set at the document root from the active
  theme document, so a theme swap (or hot-reload) re-paints the whole app with no rebuild.
- **Persistence stays daemon-owned**: **migration v4** adds `name`/`colour` to `sub_workspaces`;
  the per-project layout JSON bumps to **schema v2** (adds `activePanelId` per Tab), migrated in
  code on load.
- **Multi-window** (detach, sub-workspace windows, single focus/raise group, single-instance)
  lands in **UI main** via a new `window-manager`; this is the live slice deferred from 002.
- Panel **active-process** state is **emulated** in the existing `subprocess.ts` seam (flip the
  stub to "active") — a deliberate, clearly-marked temporary stand-in removed when terminals land.

## Technical Context

**Language/Version**: TypeScript 5.x on Node.js 20 LTS (ESM); React 18 (renderer).

**Primary Dependencies**: Electron (UI shell, `BrowserWindow`/`screen`, `app` single-instance
lock); React 18 + Vite; `@dnd-kit/core` (in-window DnD, existing); **chokidar v4** (config-file
watching — new this feature, already named in the stack); InversifyJS + reflect-metadata (DI);
better-sqlite3 (daemon store); Vitest (unit/integration/contract); Playwright-Electron (E2E,
incl. multi-window). No new heavy UI libs — theming uses native CSS custom properties; icons via
a small theme-driven map (e.g. `@iconify/react`, optional, behind the theme seam). xterm.js/
node-pty remain out of scope (panel processes emulated).

**Storage**:
- **Daemon-owned SQLite** (existing, single writer): **migration v4** adds `name TEXT` and
  `colour TEXT` to `sub_workspaces`. Per-project layout JSON document bumps to **schema v2**
  (`Tab.activePanelId`), migrated in code on load (default = first panel).
- **UI-main-owned JSON config** under `%USERPROFILE%\.throng\`: `settings.json` (sectioned),
  `keybindings.json`, and `themes\throng.json`. Created from defaults if missing; malformed →
  last-good/defaults; watched for live hot-reload.

**Testing**: Vitest unit (core: active-panel + destroy operations, folder-exclusivity validation,
config schema parse/merge/validate, keybinding resolution, theme token resolution); Vitest
integration (migration v4 + sub-workspace repo round-trip; daemon `subworkspace.*` IPC;
config-file read/write/watch in UI main); contract (new `IConfigStore`/`IFileWatcher` seams,
new IPC method shapes); Playwright-Electron E2E (theme applies app-wide, hot-reload, drag ghost,
active-panel highlight, destroy dialogs + enum, folder-exclusivity rejection, status bars,
collapse rails, detach → sub-workspace → close-keeps/delete-destroys, single-instance, lazy
startup). Red-Green-Refactor mandatory (Principle V).

**Target Platform**: Windows 11 desktop (first supported); OS seam keeps macOS/Linux open.

**Project Type**: Desktop application (Electron UI client + headless daemon), npm-workspaces
monorepo (extends 001/002).

**Performance Goals**: Active project's workspace visible within the 5 s launch budget (inherited);
drag drop-target feedback < 100 ms; config hot-reload applied < 500 ms after file save; lazy
project open paints the workspace within **1 s**; project switch within **200 ms**.

**Constraints**: No Docker; npm scripts only. `@throng/core` keeps zero OS/DOM/process imports
(guarded). Configuration injected via typed settings (Principle X). One IoC composition root per
process (daemon, UI main, UI renderer = 3). Main workspace MUST NOT mix projects. Single
application instance.

**Scale/Scope**: Single user, single machine, local-only. Tens of tabs / low-hundreds of panels
per project; a handful of sub-workspace windows. ~7 existing packages extended; the largest
deltas are the renderer (theming retrofit, status bar, panes, sub-workspace list, destroy/active
UI) and UI main (config store + watcher, window-manager, single-instance).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Evaluated against all eleven principles of constitution **v3.3.0** (project folder exclusivity in
Principle I; sidebar-shown-when-no-project + first-class sub-workspaces in Principle XI;
single-instance + lazy-loading + user-scoped config-files architecture constraints; Incremental
Delivery rule).

| # | Principle | Verdict | How this plan satisfies it |
|---|-----------|---------|----------------------------|
| I | Project-First Context Isolation | ✅ PASS | Adds **folder exclusivity** (identical/ancestor/descendant rejected, create+edit) — strengthening project-first. File Explorer Pane ships as an **empty shell**; its tree + Markdown preview are a **staged deferral** under the Incremental Delivery rule (see Complexity Tracking). Lazy project loading preserves isolation (only the opened project is active). |
| II | Platform-Abstracted Core | ✅ PASS | New seams `IConfigStore` (read/write user config) and `IFileWatcher` (hot-reload) are interfaces in `@throng/core`; Node/chokidar/Electron impls live in UI main / platform packages with contract tests. Theme/keybinding/active-panel logic is pure core. no-os-imports guard extended. |
| III | Detached/Persistent Terminals | ✅ PASS (emulated, temporary) | No real terminals. Panel "active process" is an explicit emulated stub (`subprocess.ts`) marked temporary; app-close does **not** warn (real subprocess persistence/reconnect deferred with terminals). |
| IV | Native Terminal Support | ✅ PASS (deferred) | No shells this iteration. |
| V | Test-First Quality Discipline | ✅ PASS | Unit/integration/contract/E2E layers as above; RGR per task. |
| VI | Simple, Modern, Discoverable UX | ✅ PASS | Themeable app, status bar, collapsible panes, active-panel highlight, drag ghost, managed sub-workspaces — all discoverable in-pane (no native menu). Dominant project/sub-workspace colour reinforced. |
| VII | Change Review & Approval | ✅ PASS (deferred) | Out of scope. |
| VIII | SOLID/DRY/YAGNI | ✅ PASS | Config behind one `IConfigStore`; one shared panel-close flow; sub-workspaces **reuse** the workspace tab/panel code (DRY); theme via CSS vars rather than a CSS-in-JS framework (YAGNI); emulated subprocess avoids speculative terminal work. |
| IX | DI & Composition Root | ✅ PASS | Still three roots (daemon, UI main, UI renderer); new services (config store, watcher, window-manager, theme/keybinding providers) constructor-injected at their process root. |
| X | Externalised Configuration | ✅ PASS | The feature **is** externalised config: typed settings/keybindings/theme interfaces in core, bound at each root, sourced from documented-default JSON files, overridable, never read ad hoc. |
| XI | Dockable Workspace: Panes, Tabs & Panels | ✅ PASS (to v3.3.0) | Sidebar shown when no project; File Explorer collapsible; **Sub-workspaces panel**; sub-workspaces first-class (named/coloured/listed/managed, close=keep/delete=destroy, lazy reopen); focus/raise group with independent minimise; main close closes all; panels reattach only to origin project. |

**Architecture constraints**: daemon single SQLite writer ✅; per-user local storage + **user-scoped
JSON config files** under the profile ✅; **single instance** ✅; **lazy project loading** ✅;
Electron+TS baseline ✅; reuse-not-fork ✅; agents future ✅.

**Gate result: PASS — no violations.** Deliberate, compliant choices recorded under
[Complexity Tracking](#complexity-tracking): UI-main-owned config files (vs daemon), CSS-variable
theming, emulated panel active-process, and the File-Explorer-content staged deferral.

## Project Structure

### Documentation (this feature)

```text
specs/003-layout-and-app-tweaks/
├── plan.md              # This file (/speckit-plan output)
├── research.md          # Phase 0 — decisions D1–D12
├── data-model.md        # Phase 1 — entities, migration v4, layout schema v2, config schemas
├── quickstart.md        # Phase 1 — validation/run guide
├── contracts/           # Phase 1
│   ├── config-files.md            # settings.json / keybindings.json / themes/*.json schemas
│   ├── os-config-store.md         # IConfigStore + IFileWatcher seam contracts
│   └── ipc-subworkspaces.md       # subworkspace.* JSON-RPC (list/rename/recolour/delete) + workspace schema v2
├── checklists/
│   └── requirements.md  # Created by /speckit-specify (16/16)
└── tasks.md             # Phase 2 output (/speckit-tasks)
```

### Source Code (repository root)

Extends the existing monorepo. **New** files marked `(new)`; **extended** marked `(ext)`.

```text
packages/
├── core/
│   ├── src/
│   │   ├── abstractions/
│   │   │   ├── config-store.ts            # (new) IConfigStore — read/write user config docs
│   │   │   └── file-watcher.ts            # (new) IFileWatcher — watch config dir for hot-reload
│   │   ├── config/
│   │   │   ├── settings.ts                # (ext) add AppSettings sections (theme, confirmations, panes)
│   │   │   ├── app-settings.ts            # (new) AppSettings schema + defaults + merge/validate (pure)
│   │   │   ├── keybindings.ts             # (new) keybinding action ids, defaults, resolver (pure)
│   │   │   └── theme.ts                    # (new) Theme document type, "throng" default, token resolver
│   │   ├── projects/
│   │   │   ├── project.ts                 # (ext) folder-exclusivity validation (path normalise/compare)
│   │   │   └── project-service.ts         # (ext) enforce exclusivity on create+edit
│   │   ├── workspace/
│   │   │   ├── model.ts                   # (ext) Tab.activePanelId; SubWorkspace + name/colour; schema v2
│   │   │   ├── operations.ts              # (ext) setActivePanel; destroy tab/panel; sub-workspace ops
│   │   │   ├── invariants.ts              # (ext) sub-ws ≥1 tab/panel; delete-last → remove sub-ws
│   │   │   ├── sub-workspace.ts           # (ext) first-class entity (name, colour, rename, recolour)
│   │   │   └── destroy.ts                 # (new) shared destroy/confirmation-level logic (pure)
│   │   ├── ports/
│   │   │   └── subworkspace-store.ts      # (new) ISubWorkspaceStore (name/colour/list/delete)
│   │   └── testing/
│   │       ├── config-store-contract.ts   # (new)
│   │       └── file-watcher-contract.ts   # (new)
│   └── tests/unit/                        # (ext) active-panel, destroy, exclusivity, config, theme, keys
│
├── platform-windows/
│   ├── src/node-file-watcher.ts           # (new) IFileWatcher via chokidar
│   └── tests/contract/                    # (new) file-watcher contract vs impl
│
├── persistence/
│   ├── src/
│   │   ├── migration-runner.ts            # (ext) register migration v4
│   │   ├── migrations/v4-subworkspace-identity.ts  # (new) name/colour on sub_workspaces
│   │   ├── workspace-repository.ts        # (ext) layout schema v1→v2 on load (activePanelId)
│   │   └── subworkspace-repository.ts     # (new) implements ISubWorkspaceStore
│   └── tests/integration/                 # (new) migration v4 + sub-workspace repo round-trip
│
├── ipc-contract/
│   └── src/
│       ├── workspace.ts                   # (ext) layout schema v2 in payloads
│       └── subworkspaces.ts               # (new) subworkspace.list/rename/recolour/delete
│
├── daemon/
│   ├── src/
│   │   ├── composition-root.ts            # (ext) bind sub-workspace service + repo
│   │   ├── subworkspace-service.ts        # (new) handler → core + ISubWorkspaceStore
│   │   └── rpc-router.ts                  # (ext) register subworkspace.* handlers
│   └── tests/integration/                 # (new) subworkspace.* round-trips
│
└── ui/
    ├── src/
    │   ├── main/
    │   │   ├── composition-root.ts        # (ext) bind config store, file watcher, window-manager
    │   │   ├── config-store.ts            # (new) IConfigStore impl (read/write %USERPROFILE%\.throng JSON)
    │   │   ├── config-watcher.ts          # (new) wire IFileWatcher → re-read + push to renderers
    │   │   ├── window-manager.ts          # (new) main + sub-workspace windows, focus/raise group,
    │   │   │                              #       sub-window bounds persistence + off-display clamp (IDisplayInfo, 002)
    │   │   ├── single-instance.ts         # (new) app.requestSingleInstanceLock → silent exit
    │   │   ├── keybindings-main.ts        # (new) main-process accelerators (zoom/F11) from keybindings
    │   │   └── main.ts                     # (ext) single-instance gate; window-manager; config bootstrap
    │   ├── preload/preload.cts            # (ext) bridge: config get/onChange, subworkspace.*, detach
    │   └── renderer/
    │       ├── theme/                      # (new) ThemeProvider — apply CSS vars + icon/font tokens
    │       │   ├── theme-provider.tsx
    │       │   └── tokens.css              #   var(--throng-*) declarations consumed app-wide
    │       ├── config/                     # (new) renderer config store (mirrors pushed config)
    │       ├── keybindings/                # (new) renderer keybinding registry (gestures + actions)
    │       ├── statusbar/                  # (new) per-window status bar
    │       ├── panes/                      # (new) collapsible side-pane shell + rails; File Explorer placeholder
    │       ├── sidebar/
    │       │   ├── projects-panel.tsx     # (ext) name auto-select, exclusivity error, theme tokens
    │       │   └── subworkspaces-panel.tsx# (new) list + rename/recolour/delete
    │       ├── workspace/
    │       │   ├── drag-state.ts          # (ext) cursor-attached ghost state
    │       │   ├── drag-ghost.tsx         # (new) translucent snapshot following the cursor
    │       │   ├── panel-placeholder.tsx  # (ext) active highlight + header × (Destroy Panel)
    │       │   ├── context-menu.tsx       # (ext) "Destroy Panel" item
    │       │   ├── subprocess.ts          # (ext) EMULATE active process (temporary) — flip stub to true
    │       │   ├── destroy-dialogs.tsx    # (new) Destroy Tab/Panel/Project + wry + enum-driven
    │       │   └── confirm-dialog.tsx     # (ext) red confirm button, shared closure flow
    │       ├── state/workspace-store.tsx  # (ext, existing 002) wire setActivePanel command
    │       ├── util/use-resize.ts         # (ext, existing 002) reposition left/middle handle to boundary
    │       └── app.tsx                     # (ext) ThemeProvider, status bar, three-pane shell, sub-ws windows
    ├── tests/unit/                         # (ext) renderer state/command/theme/keybinding tests
    └── tests/e2e/                          # (ext) theming, hot-reload, ghost, destroy, panes, sub-ws, lazy
```

**Structure Decision**: Extend the 001/002 monorepo. All new domain logic (active panel, destroy
rules, folder exclusivity, config/keybinding/theme schemas + resolvers) is **pure in
`@throng/core`**. **User config files are owned by UI main** (renderer is sandboxed) behind the
`IConfigStore`/`IFileWatcher` seams, pushed to renderers for live hot-reload. **Daemon stays the
single SQLite writer** (migration v4; sub-workspace identity; layout schema v2). The **multi-window
slice** (detach, sub-workspace windows, focus/raise group, single-instance) lands in UI main's new
`window-manager` — the live tear-off previously deferred from 002. Theming is CSS-custom-property
based for whole-app, zero-rebuild swaps.

## Complexity Tracking

> No Constitution Check violations. Rows below are deliberate, compliant decisions recorded for
> reviewer scrutiny (Dev Workflow gate) and one tracked staged deferral.

| Decision | Why needed | Alternative rejected because |
|----------|------------|------------------------------|
| **User config files owned by UI main** (settings/keybindings/themes), not the daemon | These are UI concerns (theming, key handling), human-edited, needing **live hot-reload** in the renderer; the renderer is sandboxed (no fs). UI main already does file I/O (window-state). | Daemon-owning them — rejected: adds IPC latency to every theme/key read, couples UI styling to the durable-state writer, and the daemon has no stake in UI config. SQLite — rejected: spec mandates human-editable JSON files. |
| **CSS custom properties** for whole-app theming | Enables a live, whole-app re-paint on theme swap / hot-reload with no rebuild and minimal coupling. | CSS-in-JS theme framework — rejected (YAGNI, bundle weight); per-component colour props — rejected (would not cover "all UI" cleanly and resists hot-swap). |
| **Emulated panel active-process** (`subprocess.ts` stub → active) | Lets the Destroy Tab/Panel/Project warning logic + counts/states be built and tested now, ahead of real terminals, with no caller changes when terminals land (Principle III honoured via the seam). | Waiting for terminals — rejected: blocks the destroy-dialog UX this feature delivers. Hardcoding "always confirm" — rejected: would not exercise the per-panel active gating the spec requires. |
| **Staged deferral: File Explorer Pane content** (tree + Markdown preview) | Incremental Delivery rule (constitution v3.2.0+): the pane shell ships now; the navigable file tree (Principle I) and `.md` preview land in a later feature. | Building the tree now — rejected by spec scope (explicitly out of scope this iteration). **End-state requirement remains**: a future feature MUST deliver the file tree + Markdown preview into this pane. |
