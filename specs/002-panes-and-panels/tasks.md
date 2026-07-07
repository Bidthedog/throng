---
description: "Task list for Panes & Panels Workspace implementation"
---

# Tasks: Panes & Panels Workspace

**Input**: Design documents from `/specs/002-panes-and-panels/`

**Prerequisites**: plan.md, spec.md, research.md (D1–D10), data-model.md, contracts/ (4 files), quickstart.md

**Tests**: REQUIRED. Constitution Principle V (Test-First, NON-NEGOTIABLE) mandates Red-Green-Refactor —
every behaviour gets a failing test before its implementation. Test tasks therefore precede their
implementation tasks within each phase.

**Organization**: Tasks are grouped by user story (US1–US4 from spec.md) for independent
implementation and testing. Constitution governing version: **v3.0.0**.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: US1–US4 (user-story phases only)
- Exact file paths are included. Paths are repo-relative under `D:\git\throng\`.

## Story → priority map

- **US1 (P1) 🎯 MVP** — Create/edit/delete/switch projects (user-specific, local profile)
- **US2 (P1)** — Workspace Tabs + split placeholder Panels (drag/group/split/collapse)
- **US3 (P2)** — Per-project layout persistence & restore across restarts
- **US4 (P3)** — Tear-off sub-workspaces (cross-project, focus group, merge-to-origin) — *separable as feature 002b*

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: New dependencies and the renderer build pipeline.

- [X] T001 Add renderer + DnD dependencies (`react`, `react-dom`, `vite`, `@vitejs/plugin-react`, `@dnd-kit/core`, `@types/react`, `@types/react-dom`) to `packages/ui/package.json`; update root `package.json` build/start scripts to bundle the renderer via Vite (main/preload/daemon stay on `tsc`)
- [X] T002 [P] Create `packages/ui/vite.config.ts` (React plugin, renderer entry, output to `dist/renderer`) and replace `packages/ui/src/renderer/index.html` with a React mount point
- [X] T003 [P] Extend `vitest.config.ts` to include `packages/core/{projects,workspace,ports}`, `packages/persistence`, `packages/daemon`, `packages/ui` test globs (already covered by the `packages/**/tests/**` globs); extend `playwright.config.ts` to allow multi-window E2E
- [X] T004 [P] Extend the no-os-imports guard `packages/core/tests/unit/no-os-imports.test.ts` to cover the new `src/projects`, `src/workspace`, `src/ports`, and new `src/abstractions` files (guard scans `core/src` recursively; explicit coverage assertion added in Phase 2)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core abstractions, ports, settings, the v2 migration, and the renderer shell that ALL
user stories build on.

**⚠️ CRITICAL**: No user-story work begins until this phase is complete.

- [X] T005 [P] Define `IUserContext` interface in `packages/core/src/abstractions/user-context.ts` and add contract helper `packages/core/src/testing/user-context-contract.ts` (per `contracts/os-user-context.md`)
- [X] T006 [P] Define core persistence ports `IProjectStore` in `packages/core/src/ports/project-store.ts` and `IWorkspaceStore` in `packages/core/src/ports/workspace-store.ts`
- [X] T007 [P] Extend `packages/core/src/config/settings.ts` with workspace settings (`workspace.autosaveDebounceMs`, `workspace.defaultSubWindow`); export from `packages/core/src/index.ts`
- [X] T008 [P] Write contract test `packages/platform-windows/tests/contract/node-user-context.contract.test.ts` against the shared `IUserContext` suite (RED)
- [X] T009 Implement `NodeUserContext` (via `os.userInfo()`) in `packages/platform-windows/src/node-user-context.ts` to pass T008 (GREEN)
- [X] T010 Write migration v2 integration test `packages/persistence/tests/integration/migration-v2.integration.test.ts` — asserts `projects`, `workspace_layout`, `sub_workspaces` tables created, `user_version` → 2, and idempotent re-run (RED)
- [X] T011 Implement migration v2 in `packages/persistence/src/migrations/v2-projects-workspace.ts` and register it in `packages/persistence/src/migration-runner.ts` (BASELINE→2) to pass T010 (GREEN)
- [X] T012 [P] Renderer shell: React app mount + renderer composition-root scaffold in `packages/ui/src/renderer/composition-root.tsx` and `app.tsx` (two-Pane shell skeleton: empty Sidebar Pane + empty Workspace Pane), with the default dark theme carried from 001
- [X] T013 [P] Preload bridge scaffold in `packages/ui/src/preload/preload.cts` and UI-main IPC bridge scaffold in `packages/ui/src/main/main.ts` (generic `invoke(method, params)` path so per-story methods plug in); extend `packages/ui/src/main/daemon-client.ts` with a reusable typed `call<TResult>(method, params)` helper

**Checkpoint**: Foundation ready — user-story implementation can begin.

---

## Phase 3: User Story 1 - Create/edit/delete/switch projects (Priority: P1) 🎯 MVP

**Goal**: Real, user-specific project management; switching swaps the workspace + sidebar terminal
list and applies the project's dominant colour.

**Independent Test**: Create two projects, switch between them (workspace + terminals list swap,
colour accent changes), edit and delete a project, restart → project list + active project restored.

### Tests for User Story 1 (write first, ensure they FAIL) ⚠️

- [X] T014 [P] [US1] Unit tests for the Project entity validation (name/colour/rootFolder) in `packages/core/tests/unit/project.test.ts` (RED)
- [X] T015 [P] [US1] Unit tests for `ProjectService` (create/edit/delete/switch, single-active invariant) against a fake `IProjectStore` in `packages/core/tests/unit/project-service.test.ts` (RED)
- [X] T016 [P] [US1] Contract + integration test for `projects.*` IPC round-trips over the named pipe in `packages/daemon/tests/integration/projects-ipc.integration.test.ts` (per `contracts/ipc-projects.md`) (RED)
- [X] T017 [P] [US1] E2E in `packages/ui/tests/e2e/projects.e2e.ts` — create/switch/edit/delete projects + restart restores project list & active project (RED)

### Implementation for User Story 1

- [X] T018 [P] [US1] Implement Project entity + validation in `packages/core/src/projects/project.ts`
- [X] T019 [US1] Implement `ProjectService` (create/edit/delete/switch using `IProjectStore`) in `packages/core/src/projects/project-service.ts` (depends on T018, T006)
- [X] T020 [P] [US1] Implement `ProjectRepository` (`IProjectStore` over better-sqlite3, scoped by `owner_user`, single-active flag) in `packages/persistence/src/project-repository.ts`
- [X] T021 [P] [US1] Define `projects.*` JSON-RPC message types in `packages/ipc-contract/src/projects.ts`
- [X] T022 [US1] Implement daemon `project-service.ts` handler in `packages/daemon/src/project-service.ts`, register `projects.*` in `packages/daemon/src/ipc-server.ts`, and bind `IProjectStore` + `IUserContext` in `packages/daemon/src/composition-root.ts` (depends on T019, T020, T021)
- [X] T023 [US1] Add `projects.*` calls to `packages/ui/src/main/daemon-client.ts`, expose a `projects` API via `packages/ui/src/preload/preload.cts`, and wire the main IPC bridge in `packages/ui/src/main/main.ts`
- [X] T024 [P] [US1] Build the Projects Panel (list + create/edit/delete/switch UI) in `packages/ui/src/renderer/sidebar/projects-panel.tsx`
- [X] T025 [P] [US1] Build the Terminals Panel placeholder (empty list that reflects the active project) in `packages/ui/src/renderer/sidebar/terminals-panel.tsx`
- [X] T026 [US1] Renderer projects state + commands (calls the preload bridge) in `packages/ui/src/renderer/state/projects-store.ts`; apply the active project's dominant colour as the accent and swap the Sidebar/Workspace on switch (depends on T023, T024, T012)

**Checkpoint**: US1 fully functional and independently testable (MVP).

---

## Phase 4: User Story 2 - Workspace Tabs & split placeholder Panels (Priority: P1)

**Goal**: Inside the active project, add Tabs (each starting with one untyped placeholder Panel),
add/split/move/group placeholder Panels by drag, reorder Tabs, and collapse emptied splits — never
reaching an empty workspace.

**Independent Test**: In a project, add Tabs, split a Tab into quadrants by dragging placeholder
Panels, drag Panels between split slots and Tabs, reorder Tabs, remove Panels and watch slots
collapse — no Panel lost, workspace never empty, no Panel shows a type.

### Tests for User Story 2 (write first, ensure they FAIL) ⚠️

- [X] T027 [P] [US2] Unit tests for workspace invariants (INV-1/2/3/7) in `packages/core/tests/unit/workspace-invariants.test.ts` (RED)
- [X] T028 [P] [US2] Unit tests for workspace operations (`addTab`, `addPanel`, `splitPanel`, `movePanel`, `reorderTab`, `removePanel`→collapse) in `packages/core/tests/unit/workspace-operations.test.ts` (RED)
- [X] T029 [P] [US2] Integration test for `workspace.load`/`save` round-trip + default-empty fallback in `packages/daemon/tests/integration/workspace-ipc.integration.test.ts` (per `contracts/ipc-workspace.md`) (RED)
- [X] T030 [US2] E2E in `packages/ui/tests/e2e/workspace-docking.e2e.ts` — add Tab (1 placeholder Panel), add Panel, split to quadrants, drag/group across Tabs, reorder Tabs, collapse, never-empty, untyped Panels (RED)

### Implementation for User Story 2

- [X] T031 [P] [US2] Define the workspace domain types (`Pane`, `Tab`, `SplitNode`, `PanelRef`, `Panel`, `WorkspaceLayout`) in `packages/core/src/workspace/model.ts`
- [X] T032 [P] [US2] Implement invariants (INV-1/2/3/7) in `packages/core/src/workspace/invariants.ts` (depends on T031)
- [X] T033 [US2] Implement operations (`addTab`/`addPanel`/`splitPanel`/`movePanel`/`reorderTab`/`removePanel`/collapse) in `packages/core/src/workspace/operations.ts` to pass T027/T028 (depends on T031, T032)
- [X] T034 [P] [US2] Implement `WorkspaceRepository` (`IWorkspaceStore`: load/save `layout_json` per project + default-empty fallback) in `packages/persistence/src/workspace-repository.ts`
- [X] T035 [P] [US2] Define `workspace.*` JSON-RPC message types in `packages/ipc-contract/src/workspace.ts`
- [X] T036 [US2] Implement daemon `workspace-service.ts` handler in `packages/daemon/src/workspace-service.ts`, register `workspace.*` in `packages/daemon/src/ipc-server.ts`, bind `IWorkspaceStore` in `packages/daemon/src/composition-root.ts` (incl. INV-4 defence-in-depth rejection) (depends on T033, T034, T035)
- [X] T037 [US2] Add `workspace.*` calls to `packages/ui/src/main/daemon-client.ts` and expose a `workspace` API via `packages/ui/src/preload/preload.cts`
- [X] T038 [P] [US2] Tab-group component (tab strip, add-Tab, reorder via DnD) in `packages/ui/src/renderer/workspace/tab-group.tsx`
- [X] T039 [P] [US2] Recursive split-tree renderer (SplitNode → rows/cols, resize handles) in `packages/ui/src/renderer/workspace/split-tree.tsx`
- [X] T040 [P] [US2] Untyped placeholder Panel component + add-Panel affordance in `packages/ui/src/renderer/workspace/panel-placeholder.tsx`
- [X] T041 [US2] DnD layer (`@dnd-kit` pointer sensors, edge-split drop zones, drop → core operation, ≤100 ms feedback) in `packages/ui/src/renderer/dnd/` (depends on T038, T039, T040)
- [X] T042 [US2] Renderer workspace store + command dispatcher (apply core ops to the mirror, debounced `workspace.save`) in `packages/ui/src/renderer/state/workspace-store.ts` (depends on T033, T037, T041)

**Checkpoint**: US1 + US2 both work; the single-window project workspace is fully usable.

---

## Phase 5: User Story 3 - Per-project layout persistence & restore (Priority: P2)

**Goal**: Each project's workspace (Tabs/splits/active-tab/sizes) is restored on relaunch and on
project switch, with a safe fallback on corrupt/missing layout. (Most save/load infra was built in
US1/US2; this story wires restore + isolation + fallback.)

**Independent Test**: Arrange two projects differently, restart → each restores its own arrangement
with no cross-project contamination; corrupt a layout → default empty workspace + "could not
restore" notice.

### Tests for User Story 3 (write first, ensure they FAIL) ⚠️

- [X] T043 [P] [US3] Integration test: save layouts for two projects, reload, assert per-project isolation + active-tab/sizes preserved + cascade-delete removes layout, in `packages/persistence/tests/integration/workspace-persistence.integration.test.ts` (RED)
- [X] T044 [US3] E2E in `packages/ui/tests/e2e/persistence-restore.e2e.ts` — arrange 2 projects, restart, each restores own layout; corrupt layout → default empty + notice (RED)

### Implementation for User Story 3

- [X] T045 [US3] On launch, load the active project + its workspace via `workspace.load` and render the restored layout in `packages/ui/src/renderer/state/workspace-store.ts` (extends T042)
- [X] T046 [US3] On project switch, load that project's saved layout in `packages/ui/src/renderer/state/projects-store.ts` (extends T026)
- [X] T047 [P] [US3] Corrupt/missing layout → render the default empty workspace and surface a "previous layout could not be restored" notice in `packages/ui/src/renderer/workspace/restore-notice.tsx`
- [X] T048 [US3] Confirm `ON DELETE CASCADE` removes `workspace_layout` on `projects.delete` (assert in T043; adjust `packages/persistence/src/project-repository.ts` if needed)

**Checkpoint**: US1–US3 complete; the full single-window, persistent, multi-project workspace works.

---

## Phase 6: User Story 4 - Tear-off sub-workspaces (Priority: P3) — *separable as feature 002b*

**Goal**: Detach a Tab/Panel into a separate window (a sub-workspace, may mix projects); all windows
share one focus group; only Panels merge back, into their original project; the main workspace never
mixes projects; sub-workspaces persist and restore onto a visible display.

> **Split note**: This entire phase can be lifted into feature **002b** without touching US1–US3.
> It depends only on the core `detach`/`reattach` operations and the UI-main `window-manager`.

**Independent Test**: Detach a Tab and a Panel; focus any window → all raise; mix two projects in one
sub-workspace; reattach a Panel → returns to its original project only; restart → sub-workspaces
restore on a visible display; close one → Panels return to their original projects.

### Tests for User Story 4 (write first, ensure they FAIL) ⚠️

- [X] T049 [P] [US4] Unit tests for sub-workspace operations + INV-4/5/6 (no cross-project mixing in main; sub-workspaces may mix; merge-to-origin only) in `packages/core/tests/unit/sub-workspace.test.ts` (RED)
- [X] T050 [P] [US4] Contract test for `IDisplayInfo` against the shared suite in `packages/ui/tests/contract/electron-display-info.contract.test.ts` (per `contracts/os-display-info.md`) (RED)
- [X] T051 [P] [US4] Integration test for `workspace.persistSubWorkspaces`/`loadSubWorkspaces` round-trip in `packages/daemon/tests/integration/sub-workspaces-ipc.integration.test.ts` (RED)
- [~] T052 [US4] **DEFERRED → 002b.** Multi-window E2E in `packages/ui/tests/e2e/sub-workspaces.e2e.ts` — detach, focus group, cross-project mix, reattach-to-origin, restart-restore-on-visible-display, close-returns-panels (RED)

### Implementation for User Story 4

- [X] T053 [P] [US4] Define `IDisplayInfo` interface in `packages/core/src/abstractions/display-info.ts` + contract helper `packages/core/src/testing/display-info-contract.ts` (per `contracts/os-display-info.md`)
- [X] T054 [P] [US4] Implement sub-workspace model + `detach`/`reattach` operations + INV-4/5/6 in `packages/core/src/workspace/sub-workspace.ts` to pass T049 (depends on T031, T033)
- [X] T055 [US4] Implement `ElectronDisplayInfo` (via Electron `screen`) in `packages/ui/src/main/electron-display-info.ts` to pass T050 (GREEN)
- [X] T056 [P] [US4] Add `workspace.persistSubWorkspaces`/`loadSubWorkspaces` types to `packages/ipc-contract/src/workspace.ts`, daemon handlers in `packages/daemon/src/workspace-service.ts`, and sub-workspace persistence in `packages/persistence/src/workspace-repository.ts`
- [~] T057 [US4] **DEFERRED → 002b.** Implement the UI-main `window-manager` (create sub-workspace `BrowserWindow`s from layout, focus-group propagation, bounds persist, restore via `IDisplayInfo.clampToVisible`) in `packages/ui/src/main/window-manager.ts` and bind it in `packages/ui/src/main/composition-root.ts` (depends on T054, T055, T056)
- [~] T058 [US4] **DEFERRED → 002b.** Renderer detach/reattach affordances + cross-window command handshake (tear-off a Tab/Panel; reattach a Panel to its origin project) in `packages/ui/src/renderer/workspace/detach-controls.tsx` and `packages/ui/src/renderer/state/workspace-store.ts` (depends on T057)

**Checkpoint**: US4 domain foundations done (T049–T051, T053–T056); the **live multi-window slice** (T052/T057/T058) is cleanly deferred to feature **002b** per the plan's recommended cut line.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Cross-story quality, performance, and validation.

- [X] T059 [P] Enforce minimum Pane/split sizes (FR-011) in `packages/ui/src/renderer/workspace/split-tree.tsx` with a unit test in `packages/ui/tests/unit/min-size.test.ts`
- [X] T060 [P] Default theme + dominant-colour accent polish across both Panes in `packages/ui/src/renderer/app.tsx` / theme CSS
- [X] T061 Reconcile the build pipeline (`scripts/copy-ui-assets.mjs` vs Vite) so `npm run build` produces a coherent `dist/` for main + preload + Vite renderer
- [X] T062 [P] Performance assertions: ≤100 ms drop-target feedback (SC-012) and workspace visible within the launch budget (NFR-002) as E2E checks in `packages/ui/tests/e2e/performance.e2e.ts`
- [X] T063 [P] Update `README.md` / quickstart run instructions for the new renderer build, deps, and IPC methods
- [X] T064 Run `quickstart.md` validation end-to-end and confirm all test layers green (`npm test`)

---

## Phase 8: UX Refinements & Fixes (clarification 2026-06-26b)

**Purpose**: Refine the single-window experience (projects bar, tabs, panels, resizing, chrome) and
fix two regressions. Runs before final review/finishing. US4 multi-window (T052/T057/T058) is
deferred to feature **002b** per the plan's recommended cut line.

### Core operations (RED→GREEN)

- [X] T065 [US2] Unit tests + impl for new layout operations `renameTab`, `closeTab` (never-empty),
  `closeOtherTabs`, `renamePanel`, `resizeSplit(path, sizes)` in
  `packages/core/src/workspace/operations.ts` (+ `packages/core/tests/unit/workspace-operations.test.ts`)

### Renderer features

- [X] T066 [US1] Projects Panel: show each project's path in grey under its name with a 200 ms
  hover-delayed marquee scroll when overflowing (FR-032) in `packages/ui/src/renderer/sidebar/projects-panel.tsx` + CSS
- [X] T067 [US1] Resizable Sidebar — horizontal (sidebar↔workspace) and vertical (Projects↔Terminals)
  with defaults + minimums (FR-033) in `packages/ui/src/renderer/app.tsx` / sidebar + a `useResizable` helper
- [X] T068 [US1] Native folder picker for the project root (FR-034): `dialog:pickFolder` IPC in
  `packages/ui/src/main/main.ts`, exposed via `packages/ui/src/preload/preload.cts`, used by the project form
- [X] T069 [US2] Tab reorder **insertion indicator** between tabs (FR-035) in `packages/ui/src/renderer/workspace/tab-group.tsx` + CSS
- [X] T070 [US2] Tab right-click context menu — Rename / Close / Close other tabs (FR-036) in `packages/ui/src/renderer/workspace/tab-group.tsx` (+ a reusable `context-menu.tsx`)
- [X] T071 [US2] Panel header right-click **Rename** menu (FR-037) in `packages/ui/src/renderer/workspace/panel-placeholder.tsx`
- [X] T072 [US2] **Fix** functional split resizing via divider drag, persisted, min-size honoured (FR-038) in `packages/ui/src/renderer/workspace/split-tree.tsx`
- [X] T073 [US1] **Fix** mouse-wheel zoom regression (Ctrl+wheel / Ctrl+middle-click) in the renderer (FR-039) in `packages/ui/src/renderer/main.tsx` (re-register the relay lost with the landing renderer)
- [X] T074 App **window title** summary — projects / total tabs / total panels (FR-040): daemon `projects.summary` (or aggregate) + renderer sets `document.title` in `packages/ui/src/renderer/...`

### Verification

- [X] T075 E2E coverage for the refinements (path display, sidebar resize, tab/panel context menus, split resize, title summary) in `packages/ui/tests/e2e/ux-refinements.e2e.ts`
- [X] T076 Double-click to rename Tabs, Panels, and projects (FR-041) — `onDoubleClick` inline rename in `tab-group.tsx`, `panel-placeholder.tsx`, and `sidebar/projects-panel.tsx`; E2E in `ux-refinements.e2e.ts`

---

## Phase 10: Confirmations, counts, window-state, project reorder (clarification 2026-06-26c)

**Purpose**: Destructive-action confirmations, tab panel counts, window geometry persistence, and
drag-to-reorder projects.

- [X] T077 Reusable promise-based `ConfirmProvider`/`useConfirm` (`packages/ui/src/renderer/confirm-dialog.tsx`); confirm before deleting a project (FR-042) in `sidebar/projects-panel.tsx`
- [X] T078 Tab close / "close other tabs" confirmation showing panel + running-subprocess counts (FR-043) in `workspace/tab-group.tsx`; subprocess placeholder (`workspace/subprocess.ts`) + panel-close confirmation (FR-044) in `workspace/panel-placeholder.tsx`
- [X] T079 Tab panel-count badge `[N]` (FR-045) in `workspace/tab-group.tsx` + CSS
- [X] T080 Migration v3 (`projects.position`) + `IProjectStore.reorder` + `ProjectRepository` (order by position, append on insert, reorder) + `ProjectService.reorder` + `projects.reorder` IPC (RGR) — `packages/persistence`, `packages/core`, `packages/ipc-contract`, `packages/daemon`
- [X] T081 Project drag-to-reorder UI with insertion indicator (FR-046) in `sidebar/projects-panel.tsx`; `ProjectsClient.reorder` + `reorderProjects` store action
- [X] T082 Window size/position persistence (`main/window-state.ts`) restored clamped to a visible display via `ElectronDisplayInfo` (FR-047) and minimum window size 640×480 (FR-048) in `main/main.ts`
- [X] T083 E2E for Phase 10 (delete confirm, tab count + close confirm, project reorder, min size, window-state restore) in `packages/ui/tests/e2e/phase9.e2e.ts`

---

## Dependencies & Execution Order

### Phase dependencies

- **Setup (P1)**: no dependencies.
- **Foundational (P2)**: depends on Setup; **blocks all user stories**.
- **US1 (P3)**: depends on Foundational. MVP.
- **US2 (P4)**: depends on Foundational; in practice consumes US1 (a project must exist to host a workspace) — sequence US1 → US2.
- **US3 (P5)**: depends on US1 + US2 (it restores their persisted state).
- **US4 (P6)**: depends on US2 (Tabs/Panels) + the OS seam; **separable as 002b**.
- **Polish (P7)**: depends on the desired stories being complete.

### User-story independence

- **US1** is independently testable and shippable as the MVP.
- **US2** is testable on top of US1 (one project present).
- **US3** validates persistence/restore of US1+US2 output.
- **US4** is the most isolated at the code boundary (core ops + window-manager) and is the clean cut line for a follow-up feature.

### Within each story

- Tests (RED) precede implementation (GREEN) — Principle V.
- Core model/invariants → core operations → persistence repo → IPC contract → daemon handler → UI-main client/preload → renderer components → renderer state/DnD.

---

## Parallel Opportunities

- **Setup**: T002, T003, T004 in parallel (T001 first — it edits root/ui package.json).
- **Foundational**: T005, T006, T007 in parallel; T008→T009 and T010→T011 are RED→GREEN pairs; T012, T013 in parallel.
- **US1 tests**: T014, T015, T016, T017 in parallel (different files).
- **US1 impl**: T018, T020, T021, T024, T025 in parallel; T019/T022/T023/T026 are sequential glue.
- **US2 tests**: T027, T028, T029 in parallel (T030 E2E after).
- **US2 impl**: T031, T034, T035 in parallel; T038, T039, T040 in parallel; T032/T033/T036/T037/T041/T042 sequential glue.
- **US4 tests**: T049, T050, T051 in parallel.
- **Polish**: T059, T060, T062, T063 in parallel.

### Parallel example — US1 tests

```bash
Task: "Unit tests for Project entity in packages/core/tests/unit/project.test.ts"
Task: "Unit tests for ProjectService in packages/core/tests/unit/project-service.test.ts"
Task: "projects.* IPC integration test in packages/daemon/tests/integration/projects-ipc.integration.test.ts"
Task: "Projects E2E in packages/ui/tests/e2e/projects.e2e.ts"
```

---

## Implementation Strategy

### MVP first (US1 only)

1. Phase 1 Setup → 2. Phase 2 Foundational → 3. Phase 3 US1 → **STOP & VALIDATE** (create/switch/edit/delete projects, restart-restore) → demo.

### Incremental delivery

1. Setup + Foundational → foundation ready.
2. US1 → projects work (MVP).
3. US2 → docking workspace with placeholder Tabs/Panels.
4. US3 → per-project persistence/restore.
5. US4 → sub-workspaces (or split to **002b** here).
6. Polish.

### Recommended cut line

If scope/risk needs trimming, **ship US1–US3 as 002 and lift US4 (Phase 6) into 002b** — Phase 6 is
authored to make that split free (no edits to US1–US3 artifacts). See plan.md Complexity Tracking and
research.md D7.

---

## Notes

- [P] = different files, no incomplete-task dependency.
- [Story] label maps each task to its user story for traceability.
- Verify each RED test fails before writing GREEN code (Principle V, NON-NEGOTIABLE).
- The renderer never imports `@throng/persistence` or opens SQLite — it goes renderer → preload → UI main → daemon (research D4).
- All docking/project rules live in `@throng/core` (research D1); UI and daemon never re-implement them.
- Commit after each task or logical RED→GREEN pair.
