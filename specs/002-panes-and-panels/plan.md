# Implementation Plan: Panes & Panels Workspace

**Branch**: `002-panes-and-panels` (work in place on `master`) | **Date**: 2026-06-26 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/002-panes-and-panels/spec.md`

## Summary

Replace the 001 "Hello World" landing page with throng's real, project-scoped docking
workspace, and stand up **real project management** (create / edit / delete / switch,
user-specific, stored in the local user profile). The workspace follows Constitution
Principle XI (v3.0.0): two top-level Panes — a stacked **Sidebar Pane** (Projects +
Terminals Panels) and a **Workspace Pane** that is a **tab group**, where each **Tab** is
a **split tree of Panels**. Panels are **generic untyped placeholders** this iteration
(editors/terminals arrive later). Tabs/Panels can be torn off into **sub-workspaces**
(separate windows that may mix projects, share one focus group, and merge Panels back only
into their original project). The full per-project arrangement persists and restores.

**Technical approach** — the docking is a *domain model*, not a UI trick:

- The entire workspace/projects model and its invariants (split/collapse, move/group,
  tab reorder, "main workspace never mixes projects", "Panels merge to original project
  only", "always ≥1 Tab with ≥1 Panel") live in **`@throng/core`** as pure, unit-tested
  logic with **zero OS/DOM/Electron imports**. Every mutation is a core operation.
- The **renderer** becomes a real **React + TypeScript** application (bundled with Vite)
  that renders core state and dispatches commands; drag-and-drop is custom pointer-based
  (with `@dnd-kit` for in-window interactions).
- **Persistence stays daemon-owned** (the daemon is the established single SQLite writer
  from 001). Projects and per-project layouts are read/written over **new JSON-RPC
  methods** (`projects.*`, `workspace.*`) added to the named-pipe channel; migration **v2**
  adds the domain tables. The renderer reaches them through the preload `contextBridge` →
  UI main → daemon.
- New **OS abstractions** (Principle II): `IUserContext` (current OS user → owner key) and
  `IDisplayInfo` (enumerate/validate displays for restoring sub-workspace windows), each
  with contract tests. Electron `screen`/window management stays in the UI main process.

**Scope flag (carried from clarification):** US4 (tear-off sub-workspaces + cross-project
merge rules + single focus group) is the highest-risk slice. This plan covers it as **P3**
and is structured so it can be **split into a follow-up feature** (002b) without disturbing
US1–US3. See [Complexity Tracking](#complexity-tracking) and `research.md` D7.

## Technical Context

**Language/Version**: TypeScript 5.x on Node.js 20 LTS (ESM); React 18 for the renderer.

**Primary Dependencies**: Electron (UI shell + `screen`/`BrowserWindow`); **React 18 + Vite**
(renderer UI + bundling — new this feature); **`@dnd-kit/core`** (in-window drag-and-drop —
new); InversifyJS + reflect-metadata (DI); better-sqlite3 (store, daemon-owned); Vitest
(unit/integration/contract); Playwright-Electron (E2E, incl. multi-window). xterm.js/node-pty
remain **out of scope** (Panels are placeholders) and are not added (YAGNI).

**Storage**: Embedded SQLite (better-sqlite3), single local file under the **per-user profile**
(`%APPDATA%/throng`), daemon-owned. **Migration v2** adds `projects`, `workspace_layout`
(per-project recursive tab/split/panel tree as a JSON document), and `sub_workspaces` (window
bounds) tables, each carrying an `owner_user` key. The layout tree is stored as a JSON document
(not normalized) — see `research.md` D5.

**Testing**: Vitest unit (core workspace/projects domain — the bulk of the value),
Vitest integration (persistence migration v2 + repositories; daemon IPC `projects.*`/
`workspace.*` round-trips), Vitest contract sub-suite (new OS abstractions + IPC method
contracts), Playwright-Electron E2E (project switch, add Tab, split/group Panels by drag,
restart-restore; multi-window detach for US4). Red-Green-Refactor mandatory (Principle V).

**Target Platform**: Windows 11 desktop (first supported). The OS seam (`IUserContext`,
`IDisplayInfo`, plus 001's `IPlatformInfo`) keeps macOS/Linux open.

**Project Type**: Desktop application (multi-process: Electron UI client + headless daemon),
npm-workspaces monorepo (extends the 001 layout).

**Performance Goals**: Active project's workspace visible within the 5 s launch budget
(NFR-002, inherited from 001 SC-001); drag drop-target feedback within **100 ms** of the
pointer reaching a valid target (NFR-001 / SC-012); project switch swaps the workspace
without perceptible stall.

**Constraints**: No Docker; everything via npm scripts. `@throng/core` contains zero OS/DOM/
process calls (guarded by the existing no-os-imports test, extended). Configuration injected
via typed settings. One IoC composition root per process (now **three** processes — daemon,
UI main, UI renderer; see Constitution Check IX). Main workspace MUST NOT mix projects.

**Scale/Scope**: Single user, single machine, local-only. Unbounded Tabs/Panels per project
in principle; practical target tens of Tabs and low-hundreds of Panels per project without
degradation. ~6 existing packages extended + a substantially larger `ui` renderer.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Evaluated against all eleven principles of constitution **v3.0.0** (Principle XI redefined to
the two-Pane / tab-group / split-Panel / sub-workspace model; Principle I "Projects" now built;
new "Per-user local storage" architecture constraint).

| # | Principle | Verdict | How this plan satisfies it |
|---|-----------|---------|----------------------------|
| I | Project-First Context Isolation | ✅ PASS (built) | Real Project entity (name, colour, root folder); switching swaps the Workspace Pane + Terminals Panel + dominant colour; only the active project is visible; main workspace never mixes projects. File-explorer / Markdown preview / edit-list remain deferred to later features (FR-003, Out of Scope). |
| II | Platform-Abstracted Core | ✅ PASS | Workspace + projects domain lives in `@throng/core` (no OS/DOM). New abstractions `IUserContext`, `IDisplayInfo` are interfaces in core; Electron-backed impls live in UI main; contract tests added (extends 001 [Gap A]). no-os-imports guard extended to new core dirs. |
| III | Detached/Persistent Terminals | ✅ PASS (backbone) | No terminals; terminal-hosting Panels are untyped placeholders. Daemon remains the detached owner of durable state. Terminal lifecycle deferred. |
| IV | Native Terminal Support | ✅ PASS (deferred) | No shells/terminals in this iteration (placeholders only). |
| V | Test-First Quality Discipline | ✅ PASS | Unit (core domain invariants), integration (persistence v2 + daemon IPC), contract (OS abstractions + IPC), E2E (Playwright-Electron incl. multi-window). RGR per task. |
| VI | Simple, Modern, Discoverable UX | ✅ PASS (built) | This feature *is* the Principle VI/XI workspace: tabs, split tiling, drag-and-drop grouping, resize handles, default theme, dominant project colour. |
| VII | Change Review & Approval | ✅ PASS (deferred) | Out of scope; not implemented. |
| VIII | SOLID/DRY/YAGNI | ✅ PASS | Domain logic isolated in core (SRP/DIP); renderer depends on core abstractions via the bridge; JSON layout document instead of speculative normalized tree (YAGNI); placeholders, not real editors/terminals. |
| IX | DI & Composition Root | ✅ PASS | One composition root **per independently-runnable process**. The Electron renderer is a *separate OS process realm* that cannot share the main container, so it gets exactly one **renderer composition root** — consistent with IX's rationale ("processes cannot share an in-memory container"). Total: `daemon`, `ui/main`, `ui/renderer` = 3 roots, one container each. Constructor injection only. |
| X | Externalised Configuration | ✅ PASS | New typed settings (e.g. layout autosave debounce, default sub-workspace window size) added to `core/config`, injected at each root; defaults documented and overridable. |
| XI | Dockable Workspace: Panes, Tabs & Panels | ✅ PASS (built to v3.0.0) | Two Panes (Sidebar + Workspace); Workspace is a tab group; each Tab a split tree of Panels; reorderable tabs; collapse rules; tear-off Tabs/Panels into sub-workspaces that may mix projects; single focus/stacking group; only Panels merge back to their original project; per-project persistence incl. sub-workspaces, restored onto a visible display. |

**Technology & Architecture constraints**: daemon owns durable state (SQLite) and is the single
writer ✅; **per-user local storage** with `owner_user` key for future multi-user + import/export
✅; Electron + TypeScript baseline ✅; reuse-not-fork (React, `@dnd-kit`, Vite — components, not the
VS Code editor) ✅; agents remain a future layer above terminals/Panels ✅.

**Gate result: PASS — no violations.** Two deliberate design choices are recorded under
[Complexity Tracking](#complexity-tracking) (not violations, but called out for review): the
third composition root for the renderer, and routing per-project layout persistence through the
daemon over IPC.

## Project Structure

### Documentation (this feature)

```text
specs/002-panes-and-panels/
├── plan.md              # This file (/speckit-plan output)
├── research.md          # Phase 0 output — decisions D1–D10
├── data-model.md        # Phase 1 output — entities, invariants, migration v2 schema, IPC shapes
├── quickstart.md        # Phase 1 output — validation/run guide
├── contracts/           # Phase 1 output
│   ├── ipc-projects.md           # JSON-RPC projects.* methods
│   ├── ipc-workspace.md          # JSON-RPC workspace.* (per-project layout load/save)
│   ├── os-user-context.md        # IUserContext OS abstraction contract
│   └── os-display-info.md        # IDisplayInfo OS abstraction contract
├── checklists/
│   └── requirements.md  # Created by /speckit-specify (16/16)
└── tasks.md             # Phase 2 output (/speckit-tasks — NOT created here)
```

### Source Code (repository root)

Extends the existing npm-workspaces monorepo. **New** dirs/files marked `(new)`; everything
else already exists from 001.

```text
packages/
├── core/                                   # Principle II/VIII/X — platform- & process-agnostic
│   ├── src/
│   │   ├── abstractions/
│   │   │   ├── platform-info.ts            #   (existing)
│   │   │   ├── user-context.ts             #   (new) IUserContext — current OS user → owner key
│   │   │   └── display-info.ts             #   (new) IDisplayInfo — enumerate/validate displays
│   │   ├── projects/                       #   (new) Project domain
│   │   │   ├── project.ts                  #     Project entity + validation (name, colour, root)
│   │   │   └── project-service.ts          #     create/edit/delete/switch (pure; persistence via port)
│   │   ├── workspace/                      #   (new) Docking domain — the heart of this feature
│   │   │   ├── model.ts                    #     Pane, Tab, SplitNode, Panel, WorkspaceLayout types
│   │   │   ├── operations.ts               #     addTab, addPanel, splitPanel, movePanel, reorderTab,
│   │   │   │                               #     collapse, detach, reattach — invariant-enforcing
│   │   │   ├── invariants.ts               #     ≥1 Tab/Panel; no cross-project mixing; merge-to-origin
│   │   │   └── sub-workspace.ts            #     sub-workspace model (may mix projects)
│   │   ├── config/settings.ts              #   (extended) add UI/workspace settings interfaces
│   │   ├── ports/                          #   (new) persistence ports (interfaces) the daemon implements
│   │   │   ├── project-store.ts            #     IProjectStore
│   │   │   └── workspace-store.ts          #     IWorkspaceStore
│   │   └── testing/                        #   (extended) contract helpers for new abstractions
│   │       ├── platform-info-contract.ts   #     (existing)
│   │       ├── user-context-contract.ts    #   (new)
│   │       └── display-info-contract.ts    #   (new)
│   └── tests/unit/                         #   workspace/projects domain unit tests (bulk of tests)
│
├── platform-windows/                       # Principle II — OS-specific impls (Node-level)
│   ├── src/windows-platform-info.ts        #   (existing)
│   ├── src/node-user-context.ts            #   (new) IUserContext via os.userInfo() (cross-platform Node)
│   └── tests/contract/                     #   (new) user-context contract vs impl
│
├── persistence/                            # daemon-owned durable store
│   ├── src/
│   │   ├── database.ts                     #   (existing)
│   │   ├── migration-runner.ts             #   (extended) register migration v2
│   │   ├── migrations/
│   │   │   └── v2-projects-workspace.ts    #   (new) projects, workspace_layout, sub_workspaces
│   │   ├── project-repository.ts           #   (new) implements IProjectStore (better-sqlite3)
│   │   └── workspace-repository.ts         #   (new) implements IWorkspaceStore (JSON doc per project)
│   └── tests/integration/                  #   (new) migration v2 + repo round-trip + idempotency
│
├── ipc-contract/                           # shared JSON-RPC message types
│   └── src/
│       ├── health-ping.ts                  #   (existing)
│       ├── projects.ts                     #   (new) projects.list/create/update/delete/setActive
│       └── workspace.ts                    #   (new) workspace.load/save (+ sub-workspace persist)
│
├── daemon/                                 # COMPOSITION ROOT #1
│   ├── src/
│   │   ├── composition-root.ts             #   (extended) bind project/workspace services + repos
│   │   ├── ipc-server.ts                   #   (extended) register projects.* / workspace.* handlers
│   │   ├── project-service.ts              #   (new) thin handler → core ProjectService + IProjectStore
│   │   ├── workspace-service.ts            #   (new) thin handler → core ops + IWorkspaceStore
│   │   └── main.ts                         #   (existing; runs migrations incl. v2)
│   └── tests/integration/                  #   (new) projects.* / workspace.* round-trips over the pipe
│
└── ui/                                     # COMPOSITION ROOT #2 (main) + #3 (renderer)
    ├── src/
    │   ├── main/
    │   │   ├── composition-root.ts         #   (extended) bind workspace IPC client, window mgr, display
    │   │   ├── daemon-client.ts            #   (extended) projects.* / workspace.* calls
    │   │   ├── window-manager.ts           #   (new) main + sub-workspace BrowserWindows, focus group (US4)
    │   │   ├── electron-display-info.ts    #   (new) IDisplayInfo via Electron `screen`
    │   │   └── main.ts                      #   (extended) create main window; IPC bridge for workspace API
    │   ├── preload/preload.cts             #   (extended) contextBridge: projects + workspace API
    │   └── renderer/                        #   (substantially new) React + Vite docking app
    │       ├── composition-root.tsx         #   (new) RENDERER composition root (#3) — wires services
    │       ├── app.tsx                      #   (new) two-Pane shell
    │       ├── sidebar/                      #   (new) Projects Panel (CRUD/switch) + Terminals Panel (placeholder)
    │       ├── workspace/                    #   (new) tab group, split-tree renderer, Panel placeholder
    │       ├── dnd/                          #   (new) pointer/@dnd-kit drag, edge-split drop zones
    │       ├── state/                        #   (new) renderer store mirroring core layout + commands
    │       └── index.html                    #   (replaced) React mount point
    ├── vite.config.ts                       #   (new) renderer bundling
    ├── tests/unit/                           #   (extended) renderer state/command unit tests
    └── tests/e2e/                            #   (extended) project switch, tabs/splits/DnD, restart; detach (US4)

scripts/copy-ui-assets.mjs                   # (revisit) renderer now built by Vite; adjust build pipeline
vitest.config.ts                             # (extended) include new packages/dirs
playwright.config.ts                         # (extended) multi-window E2E support
package.json                                 # (extended) React/Vite/@dnd-kit deps + updated build/run scripts
```

**Structure Decision**: Extend the 001 monorepo rather than restructure it. The constitutional
boundaries are preserved: **all docking and project logic is pure and lives in `@throng/core`**
(testable without Electron/DOM — the single most important decision, `research.md` D1); the
**daemon stays the single durable-state owner** and gains `projects.*`/`workspace.*` IPC methods
(D4); the **renderer grows into a real React/Vite app** with its own composition root (D2, D9);
new OS needs (`IUserContext`, `IDisplayInfo`) go through the abstraction seam with contract tests
(D8). The renderer never imports `@throng/persistence` or talks to SQLite directly — it goes
renderer → preload → UI main → daemon, keeping the sandbox and single-writer guarantees intact.

## Complexity Tracking

> No Constitution Check violations. The two rows below are **deliberate, compliant design
> decisions recorded for reviewer scrutiny** (Dev Workflow gate), not justifications for
> violations.

| Decision | Why needed | Alternative rejected because |
|----------|------------|------------------------------|
| Third composition root (Electron **renderer**) in addition to daemon + UI main | The renderer is a separate OS process realm (Electron sandbox) that cannot share the main process's in-memory container; a complex React app needs DI. IX requires one root *per process* — this satisfies it, it does not breach it. | Keeping the renderer container-free (001's approach) — rejected: the 002 renderer is a full application (tabs, splits, DnD, multi-window), and prop-drilling all services would violate SOLID/maintainability. |
| Per-project **layout persistence routed through the daemon** over new IPC methods | The daemon is the established single SQLite writer (001); two-writer SQLite from the UI risks corruption/locking, and future terminals (daemon-owned) will reference projects. | UI main opening the DB directly — rejected: dual writers to one file, split ownership of durable state, and divergence from the daemon/client architecture. |

> **US4 (sub-workspaces) split option**: If delivery risk needs trimming, US4 (tear-off
> windows, cross-project sub-workspaces, single focus group, merge-to-original-project) can be
> lifted into a follow-up feature **002b** with no change to US1–US3 artifacts. `/speckit-tasks`
> should phase US4 last so this split stays cheap. (`research.md` D7 details the multi-window risk.)
>
> **Decision (2026-06-26, applied):** the cut line was taken. US1–US3 plus the **US4 domain
> foundations** (pure detach/reattach + INV-5/6, `IDisplayInfo`/`ElectronDisplayInfo`, sub-workspace
> IPC + persistence — tasks T049–T051, T053–T056) ship as **002**. The **live multi-window slice**
> (T052 multi-window E2E, T057 UI-main `window-manager`, T058 renderer detach/reattach UI) is
> deferred to feature **002b**. A follow-up clarification (2026-06-26b) added single-window UX
> refinements + two regression fixes (FR-032–FR-040, Phase 8 tasks T065–T075), implemented before
> final review/finishing.
