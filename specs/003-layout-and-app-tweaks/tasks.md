---
description: "Task list for Layout and app tweaks"
---

# Tasks: Layout and app tweaks

**Input**: Design documents from `/specs/003-layout-and-app-tweaks/`
**Prerequisites**: plan.md, spec.md, research.md (D1–D12), data-model.md, contracts/
**Tests**: Included — Test-First (Red-Green-Refactor) is mandatory (Constitution Principle V). Every
story begins with a RED test task that MUST fail before its implementation tasks; the trailing E2E
is the story's green checkpoint.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no incomplete dependency)
- **[Story]**: US1–US10 (Setup/Foundational/Polish carry no story label)
- Paths follow the monorepo layout in plan.md (`packages/<pkg>/src/...`).

## Phasing note

Per plan.md Complexity Tracking, the config/theme/keybindings/model infrastructure is shared by
many stories, so it lands in **Phase 2 (Foundational)** even though the user-facing infrastructure
story (US8) is priority P3. User-story phases (P1 → P3) build on that foundation.

---

## Phase 1: Setup (Shared Infrastructure)

- [x] T001 **Superseded — no new deps needed.** Config watching uses Node's built-in `fs.watch` (`main/node-file-watcher.ts`) rather than `chokidar`; theme icons are plain Unicode glyphs in the theme document (`core/config/theme.ts` `icons`) resolved via `resolveIcon`, rather than `@iconify/react`. `npm run build` green with no added runtime dependencies (YAGNI).
- [x] T002 [P] Extend `vitest.config.ts` and `playwright.config.ts` to include the new core/ui/persistence dirs introduced by this feature.
- [x] T003 [P] Extend the no-os-imports guard in `packages/core/tests/unit/no-os-imports.test.ts` to cover `core/src/abstractions/config-store.ts`, `file-watcher.ts`, and `core/src/config/*`.
- [x] T004 [P] Scaffold renderer theme variable sheet `packages/ui/src/renderer/theme/tokens.css` with empty `:root { --throng-* }` declarations consumed app-wide.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Config/theme/keybinding infrastructure, domain-model extensions, persistence v4, and
multi-window scaffolding that the user stories depend on. No story is independently testable until
this phase is complete.

### Core abstractions & schemas (pure)

- [x] T005 [P] Add `IConfigStore` abstraction in `packages/core/src/abstractions/config-store.ts` (per contracts/os-config-store.md).
- [x] T006 [P] Add `IFileWatcher` abstraction in `packages/core/src/abstractions/file-watcher.ts`.
- [x] T007 [P] Add config-store + file-watcher contract helpers in `packages/core/src/testing/config-store-contract.ts` and `file-watcher-contract.ts`; export from `testing/index.ts`.
- [x] T008 Write unit tests (RED) for AppSettings parse/default-merge/validate/malformed-fallback in `packages/core/tests/unit/app-settings.test.ts`.
- [x] T009 Implement `packages/core/src/config/app-settings.ts` (AppSettings schema, defaults, merge, validate) to green T008 (data-model §2).
- [x] T010 Write unit tests (RED) for keybinding event→action resolution + defaults in `packages/core/tests/unit/keybindings.test.ts`.
- [x] T011 Implement `packages/core/src/config/keybindings.ts` (action ids, defaults, resolver) to green T010 (data-model §3).
- [x] T012 Write unit tests (RED) for Theme token→value resolution + missing-token fallback in `packages/core/tests/unit/theme.test.ts`.
- [x] T013 Implement `packages/core/src/config/theme.ts` (Theme type, "throng" default, token resolver) to green T012 (data-model §4).
- [x] T014 [P] Extend `packages/core/src/config/settings.ts` to expose the config-root path + AppSettings sections via the typed settings interfaces (Principle X).

### Domain model & operations (pure)

- [x] T015 Write unit tests (RED) for `Tab.activePanelId` invariant + active reset on panel removal, and `SubWorkspace` name/colour, in `packages/core/tests/unit/workspace-operations.test.ts` (extend).
- [x] T016 Extend `packages/core/src/workspace/model.ts`: add `Tab.activePanelId`, `SubWorkspace.name`/`colour`, bump `LAYOUT_SCHEMA_VERSION` to 2.
- [x] T017 Add `setActivePanel` + active-reset logic in `packages/core/src/workspace/operations.ts` to green T015.
- [x] T018 Extend `packages/core/src/workspace/invariants.ts`: sub-workspace ≥1 tab/≥1 panel; deleting last panel/tab removes the sub-workspace (with unit tests in `workspace-invariants.test.ts`).
- [x] T019 Promote sub-workspace to first-class in `packages/core/src/workspace/sub-workspace.ts` (rename/recolour helpers; auto-name "Sub-workspace N"; unused-colour pick from shared palette) + tests in `sub-workspace.test.ts`.
- [x] T020 Write unit tests (RED) for the `none|single|double` destroy-confirmation resolver (per type; panel active-gating; project-blocked-when-panels-in-subworkspaces) in `packages/core/tests/unit/destroy.test.ts`.
- [x] T021 Implement `packages/core/src/workspace/destroy.ts` (pure confirmation/relocation-decision logic) to green T020 (research D10).
- [x] T022 Write unit tests (RED) for project folder exclusivity (identical/ancestor/descendant; normalise; create+edit) in `packages/core/tests/unit/project.test.ts` (extend).
- [x] T023 Implement folder-exclusivity validation in `packages/core/src/projects/project.ts` + enforce in `project-service.ts` (create+edit) to green T022 (research D11).
- [x] T024 [P] Add `ISubWorkspaceStore` port in `packages/core/src/ports/subworkspace-store.ts`.

### Persistence (daemon-owned)

- [x] T025 Migration v4 integration test (sub_workspaces name/colour + idempotency) — migration-v4.integration.test.ts.
- [x] T026 `packages/persistence/src/migrations/v4-subworkspace-identity.ts` (adds name/colour) registered in migration-runner (user_version→4).
- [x] T027 `packages/persistence/src/subworkspace-repository.ts` (ISubWorkspaceStore: list/get/rename/recolour/delete) + integration round-trip test; WorkspaceRepository now reads/writes name/colour.
- [x] T028 WorkspaceRepository migrates layout v1→v2 on load (default activePanelId = first panel) + integration test.

### Platform / OS impls

- [x] T029 [P] Implement `packages/ui/src/main/node-file-watcher.ts` (`NodeFileWatcher`, fs.watch recursive + debounce) + contract test `packages/ui/tests/contract/node-file-watcher.contract.test.ts` (2 green).

### IPC contract & daemon

- [x] T030 [P] `packages/ipc-contract/src/subworkspaces.ts` (subworkspace.list/rename/recolour/delete types) exported from index.
- [x] T031 [P] workspace.* payloads carry layout schema v2 (reuse core WorkspaceLayout incl. Tab.activePanelId; repo migrates v1→v2).
- [x] T032 `packages/daemon/src/subworkspace-service.ts` bound in composition-root + registered in router; integration test subworkspaces-ipc (2 green).

### UI main (config, watcher, multi-window scaffold)

- [x] T033 Implement `packages/ui/src/main/config-store.ts` (`FileConfigStore`: `IConfigStore` over `%USERPROFILE%\.throng\` JSON; create-on-missing; malformed→defaults left intact; atomic write) + integration test `packages/ui/tests/integration/config-store.integration.test.ts` (shared contract suite + first-run/layout, 7 green).
- [x] T034 Implement `packages/ui/src/main/config-watcher.ts` (re-read settings+active theme via `IConfigStore` → broadcast to all windows; hot-reload, D3).
- [x] T035 Bind `IConfigStore`, `IFileWatcher` (NodeFileWatcher), and config-root setting in `packages/ui/src/main/composition-root.ts`; `ensureDefaultConfig` creates defaults on first run; watcher broadcasts changes.
- [x] T036 [US7] `packages/ui/src/main/window-manager.ts` focus/raise group (focused window raised last) + independent minimise + close-children-with-main, unit-tested (6); wired into `main.ts` (registerMain + child registration + bounds persistence on sub-workspace open).
- [x] T037 [P] Extend `packages/ui/src/preload/preload.cts` bridge: `config.get`/`config.onChange` (+ global.d.ts typings) and **`subWorkspace.open(id)`** (lazy reopen). Detach + sub-workspace mutations (rename/recolour/delete/reorder/updateBounds) go through the existing generic `invoke` JSON-RPC bridge, so no extra preload surface is needed.

### Renderer foundation (theme/config/keybindings)

- [x] T038 `packages/ui/src/renderer/theme/theme-provider.tsx` applies the active Theme to `--throng-*` and re-applies on hot-reload push (theme fed from the config store). *(E2E config-hotreload.e2e.ts asserts live accent change.)*
- [x] T039 [P] Implement `packages/ui/src/renderer/config/config-store.tsx` mirroring pushed AppSettings (+active theme); components read submenu/hover delays + confirmation levels live. *(E2E asserts startup + hot-reload.)*
- [x] T040 [P] Renderer gestures/actions resolve from the mirrored Keybindings via core `resolveAction` (pure, unit-tested in `core/tests/unit/keybindings.test.ts`), consumed by `app.tsx` KeybindingsHandler (zoom/fullscreen/pane toggles) on live DOM keydown — the resolver lives in core rather than a separate `renderer/keybindings/` dir. *(E2E keybindings.e2e + pane-shortcuts.e2e.)*
- [x] T041 Default theme document `themes\throng.json` is written on first run by `ensureDefaultConfig` from `THRONG_THEME` (all colour/font/icon tokens). *(E2E config-files.e2e.ts asserts creation.)*

**Checkpoint**: infrastructure ready — user stories can proceed.

---

## Phase 3: User Story 1 — Cursor-Attached Drag Ghost (P1)

**Goal**: A faithful translucent snapshot follows the cursor during drags, including through detach.
**Independent test**: Drag a panel/tab → snapshot follows the cursor alongside drop indicators; past the window edge it keeps following; drop → gone.

- [x] T042 [P] [US1] **RED**: drag-state ghost-source coverage. *(Behaviour confirmed working in-app by user 2026-06-28; the dedicated drag-ghost E2E backfill is a tracked deferral under Constitution V — see T046.)*
- [x] T043 [US1] Extend drag-state to carry the cursor-attached ghost source (snapshot of the dragged tab/panel). *(Implemented inline in `workspace/tab-group.tsx` + `workspace/drag-state.ts` + main `ghost-window.ts`.)*
- [x] T044 [US1] Translucent snapshot overlay (min visible size ≥160×120 px) pinned to the pointer. *(Lives inline in `workspace/tab-group.tsx`; content reused by `main/ghost-window.ts` for the detach follower.)*
- [x] T045 [US1] Transparent always-on-top follower window in `main/ghost-window.ts` for the detach phase; renderer reuses ghost content (research D9).
- [x] T046 [P] [US1] E2E `drag-ghost.e2e.ts` green: the cursor-following ghost (a frameless/transparent OS window loaded from a `data:` URL) is **visible during a drag and hidden on drop** (SC-001).

---

## Phase 4: User Story 2 — Active (Highlighted) Panel (P1)

**Goal**: Selecting a panel activates+highlights it; per-tab memory; focused tab's active panel is global.
**Independent test**: Click panels, switch tabs, focus a sub-workspace; highlight + per-tab memory behave per spec.

- [x] T047 [P] [US2] **RED** — backfilled impl-first (constitution v3.4.0); active-panel highlight + per-tab restore covered green by `active-panel.e2e`.
- [x] T048 [US2] Wire panel selection → `setActivePanel` (core op) through the renderer workspace store in `packages/ui/src/renderer/state/workspace-store.tsx`.
- [x] T049 [US2] Apply the active highlight (theme `surfaceActive`) in `packages/ui/src/renderer/workspace/panel-placeholder.tsx`.
- [x] T050 [P] [US2] Complete E2E `packages/ui/tests/e2e/active-panel.e2e.ts` to GREEN: highlight, per-tab restore (global-active on window focus deferred to T080/US7, needs a sub-workspace) (SC-002). *(Backfilled impl-first per constitution v3.4.0; 2/2 green.)*

---

## Phase 5: User Story 3 — Destroy Dialogs, Panel Close & Emulated Active Process (P1)

**Goal**: "Destroy" wording + red buttons; shared panel-close (menu + header ×); enum confirmations; emulated active process; project blocked when panels in sub-workspaces.
**Independent test**: Destroy panel via menu and × (same flow); tab dialog lists states; project double-confirm + enum; project-with-sub-workspace-panels refused.

- [x] T051 [P] [US3] **RED**: destroy-dialog coverage (enum none/single/double; wry project confirm; panel active-gating). *(Behaviour confirmed working in-app by user 2026-06-28; dedicated `destroy.e2e.ts` backfill tracked under Constitution V — see T058.)*
- [x] T052 [US3] Emulate active process in `packages/ui/src/renderer/workspace/subprocess.ts` (flip `panelHasRunningSubprocess` to true) with a clearly-marked TEMPORARY comment + TODO(terminals) + unit test asserting the emulation flag.
- [x] T053 [US3] Destroy Tab/Panel/Project + wry "Yes, I'm absolutely sure"/"No, I concede", driven by `core/destroy` + confirmation settings. *(Implemented inline across `workspace/tab-group.tsx`, `panel-placeholder.tsx`, `sidebar/projects-panel.tsx` via the shared `confirm-dialog.tsx` ConfirmProvider rather than a separate `destroy-dialogs.tsx`.)*
- [x] T054 [US3] Red (theme `danger`) confirm button + shared closure flow. *(In `renderer/confirm-dialog.tsx` — `danger` variant.)*
- [x] T055 [US3] Add the "Destroy Panel" item to `packages/ui/src/renderer/workspace/context-menu.tsx` and a header **×** to `panel-placeholder.tsx`, both routing through the one shared close flow.
- [x] T056 [US3] Rename existing destructive actions/labels to "Destroy Tab"/"Destroy other tabs"/"Destroy Project" across the renderer (tab-group, projects-panel) reading confirmation levels from settings.
- [x] T057 [US3] Destroy-Project block (FR-025a) — **superseded by the clone-and-sync model (T074)**. Detaching a project Panel now *clones* it (the original stays in the project), so destroying a project never strands a panel that only lived in a sub-workspace; there is no cross-project move to refuse. Core confirmation/relocation logic remains unit-covered (T020/T021).
- [x] T058 [P] [US3] E2E `destroy.e2e.ts` green: the Panel header × runs the shared double-confirm flow (summary → wry "absolutely sure") and removes the Panel, and **cancelling a Tab destroy leaves all state unchanged** (FR-025 / SC-005). *(Project-block case superseded by clone-and-sync — see T057.)*

---

## Phase 6: User Story 4 — Project Creation & Folder Exclusivity (P1)

**Goal**: Name auto-filled+selected, unused colour + label, inline validation; folder exclusivity on create+edit.
**Independent test**: Auto-select name; unused colour; invalid submit keeps form open; nested/parent/identical folder rejected.

- [x] T059 [P] [US4] **RED** — backfilled impl-first (constitution v3.4.0); name auto-select, unused colour, invalid-submit-keeps-open, and folder-exclusivity errors covered green by `project-creation.e2e`.
- [x] T060 [US4] In `packages/ui/src/renderer/sidebar/projects-panel.tsx`, select/highlight the auto-filled name on dialog open; keep the unused-colour + label + inline-validation behaviours.
- [x] T061 [US4] Surface the folder-exclusivity validation error (from core, T023) in the create/edit form (folder field highlighted, explanatory message).
- [x] T062 [P] [US4] Complete E2E `packages/ui/tests/e2e/project-creation.e2e.ts` to GREEN: name auto-fill from picked folder; unused colour + purpose label (FR-027); invalid submit keeps the form open (FR-028); folder exclusivity rejection on create and edit (SC-006). *(Backfilled impl-first per constitution v3.4.0; 2/2 green.)*

---

## Phase 7: User Story 5 — Status Bar in Every Window (P2)

**Goal**: Per-window status bar; main = project/tab/panel (+"No project"); sub-workspace = name+colour then active panel's origin project / tab / panel.
**Independent test**: Switch project/tab/panel in main and a sub-workspace; both bars update immediately.

- [x] T063 [P] [US5] **RED** — backfilled impl-first (constitution v3.4.0); main status-bar content (No project / project · tab · panel) covered green by `status-bar.e2e`.
- [x] T064 [US5] Implement `packages/ui/src/renderer/statusbar/` (main + sub-workspace variants), themed. The **sub-workspace** variant MUST render the sub-workspace **name + colour swatch first**, then the active panel's **origin project** name (FR-005); the **main** variant shows active project / tab / panel.
- [x] T065 [US5] Mount the status bar in `packages/ui/src/renderer/app.tsx` for every window; wire "No project" placeholder.
- [x] T066 [P] [US5] Complete E2E `packages/ui/tests/e2e/status-bar.e2e.ts` to GREEN: main content (No project / project + tab·panel) + immediate updates (sub-workspace status-bar variant deferred to T080/US7) (SC-003). *(Backfilled impl-first per constitution v3.4.0; 2/2 green.)*

---

## Phase 8: User Story 6 — Collapsible Side Panes (P2)

**Goal**: Right File Explorer Pane (empty placeholder, resizeable, persisted); collapse-to-rail for both panes; left shown when no project, right collapsed; resize handle on boundary.
**Independent test**: Resize+restart restores width; Hide/Show rails with rotated labels; no-project defaults; handle on boundary.

- [x] T067 [P] [US6] **RED** — backfilled impl-first (constitution v3.4.0). Panes covered by `panes.e2e`, `pane-auto-collapse.e2e`, `pane-shortcuts.e2e`, `side-pane-max.e2e`, `handles.e2e`, `workspace-min-width.e2e`.
- [x] T068 [US6] Implement `packages/ui/src/renderer/panes/` shell: left Sidebar + central workspace + right File Explorer Pane (neutral empty placeholder).
- [x] T069 [US6] Implement collapse-to-rail (Hide control at inner-top corner; rail Show control + rotated label "Projects & Terminals"/"Files & Folders").
- [x] T070 [US6] Pane **width** persists across restarts (`use-resize` storage) + the configurable per-pane **maxWidth** lives in `settings.json` (`panes.{projects,fileExplorer}.maxWidth`, hot-reloaded); sub-minimum width is clamped (workspace keeps its floor, panes auto-collapse). **Visibility is intentionally a live per-window preference** (documented in `app-settings.ts`: Projects shown by default, Files & Folders only inside a project) rather than global settings state — a deliberate design refinement of the original task. *(E2E: panes.e2e resize+restore, side-pane-max, pane-auto-collapse, workspace-min-width.)*
- [x] T071 [US6] Side-pane resize handles sit on each pane's boundary (`use-resize` + the panes shell; the Explorer handle is on its leading edge). *(E2E handles.e2e + ux-refinements resize.)*
- [x] T072 [P] [US6] E2E green: `panes.e2e` (resize+restore, rails+labels, fixed toggle button position), `pane-auto-collapse.e2e` (no-project + narrow-window defaults), `pane-shortcuts.e2e`, `side-pane-max.e2e`, `workspace-min-width.e2e` (SC-004, SC-010).

---

## Phase 9: User Story 7 — Sub-Workspaces as First-Class Entities (P3)

**Goal**: Detach creates a named/coloured sub-workspace listed in the sidebar; close=keep, delete=destroy (relocation warning); lazy reopen; resizeable/minimisable/closeable multi-tab windows reusing workspace code; focus/raise group; main close closes all; reattach only to origin project.
**Independent test**: Detach→list entry; rename/recolour; close keeps+reopens; delete destroys; restart lists-not-opens; main close closes all.

- [x] T073 [P] [US7] **RED** — backfilled impl-first per constitution v3.4.0. Sub-workspaces are covered E2E by `subworkspaces.e2e` (list/rename/recolour/delete, open+render, lazy-load dot, reorder+persist, bounds restore+clamp, main-close-closes-all) and `subworkspace-detach.e2e` (tab+panel clone-detach), plus unit (`window-identity`, `window-manager`, core `sub-workspace`) and integration (migration v4/v5, repo, IPC) layers.
- [x] T074 [US7] Detach flow (**clone-and-sync model, 003**). A `DetachProvider` (main window only) wires the core `detachTab`/`detachPanel` ops, which **clone** the Tab/Panel into a new sub-workspace (auto name "Sub-workspace N" + unused palette colour) — the original **stays in the main project** — persists it, lists it in the sidebar, and opens its window via `subWorkspace.open`. Triggers: a **context-menu "Detach to new window"** item on Tabs and Panels (E2E-covered), and a **drag that drops beyond the window edge** (`droppedOutside` in `tab-group.tsx`, reusing the US1 cursor ghost). *(E2E subworkspace-detach.e2e: tab + panel detach → new window renders content, main KEEPS its content, sidebar lists it. The literal drag-past-the-edge drop is not E2E'd — Playwright can't move the pointer outside the viewport.)*
- [x] T075 [US7] Render sub-workspace windows by **reusing** the existing workspace tab/panel renderer. A `?sw=<id>` window mounts `SubWorkspaceCompositionRoot` → `SubWorkspaceApp`, which renders the unchanged `TabGroup` against a `SubWorkspaceWorkspaceClient` (loads via `workspace.loadSubWorkspaces`, saves the whole set back). Window kind resolved by the pure `parseWindowIdentity` (unit-tested). *(E2E subworkspaces.e2e: open → renders seeded tab/panel.)*
- [x] T076 [US7] `packages/ui/src/renderer/sidebar/subworkspaces-panel.tsx` (list + rename/recolour/delete via subworkspace.*), placed below Projects; SubWorkspacesClient/Provider added. E2E subworkspaces.e2e.
- [x] T077 [US7] Close-keeps vs delete-destroys. **Window close keeps** the sub-workspace (it stays listed and reopenable — only bounds are persisted). **List delete** shows a destroy warning ("its tabs and panels are destroyed") then calls `subworkspace.delete`. *(E2E subworkspaces.e2e covers delete→list-empties; close-keep is exercised by reopen.)*
- [x] T078 [US7] Lazy reopen + lifecycle. List at startup (metadata only); **open via the Open button** (→ `subWorkspace.open` → window opens, or raises if already open — lazy guard E2E-verified); **main-window close closes all sub-workspaces** (E2E-verified). *Reattach-to-origin is **superseded by the clone-and-sync model (T074)**: a project Panel already lives in its project, so there is nothing to "move back" — dragging into the main window is no longer part of the model.*
- [x] T079 [US7] Persist sub-workspace **window bounds** on move/resize (debounced) + close via `subworkspace.updateBounds`; on reopen restore + **clamp onto a visible display** via `ElectronDisplayInfo.clampToVisible` (FR-017a; Constitution XI). *(E2E: resize → close → reopen restores size.)*
- [x] T080 [P] [US7] E2E green across `subworkspaces.e2e` + `subworkspace-detach.e2e`: detach(clone)→list, rename/recolour/delete, open+render, lazy-load dot, reorder+persist, **bounds restored + clamp**, **main-close-closes-all**. *Reattach + Destroy-Project-block are **superseded by clone-and-sync** (panels stay in their project; there is no cross-project "move" to block).*

---

## Phase 10: User Story 8 — Theming, Settings & Keybindings (whole-app) (P3)

**Goal**: Every existing surface draws from the theme; keybindings file maps existing shortcuts+gestures; live hot-reload; default config files created on first run.
**Independent test**: All UI themed; edit theme/keybindings/settings → applied live; malformed→last-good.

- [x] T081 [P] [US8] Theming/config behaviour covered by config-hotreload.e2e (theme + settings, live + startup) and config-files.e2e (first-run creation).
- [x] T082 [US8] Whole-app theming: the renderer's semantic CSS vars (--bg/--bg-raised/--bg-panel/--border/--text/--text-dim/--accent) now resolve from the active theme's `--throng-colour-*` tokens, so every component (old + new) re-themes and hot-reloads from themes/<name>.json (FR-030). Theme palette reconciled to the app colours (appBg/sidebarBg tokens added).
- [x] T083 [US8] Accelerators (zoom in/out/reset, fullscreen) + Ctrl+wheel / Ctrl+middle gestures run through the keybindings: the renderer resolves real DOM keydown events against the live `keybindings.json` via core `resolveAction` (`app.tsx` KeybindingsHandler) and relays the action to the main process over IPC (`registerZoomIpc`), so edits apply live + across sessions. Pane toggles (Ctrl+B/Ctrl+N) use the same path. *(Resolved in the renderer rather than a separate `keybindings-main.ts` — DOM events carry the real keys and edits hot-reload. E2E keybindings.e2e + pane-shortcuts.e2e.)*
- [x] T084 [US8] First-run creation of `settings.json`, `keybindings.json`, `themes\throng.json` from documented defaults via `ensureDefaultConfig` (`FileConfigStore.read` create-on-missing); a malformed file resolves to defaults without overwriting (`read` fallback). *(E2E config-files.e2e first-run; config-hotreload.e2e hand-edited-settings-on-startup.)*
- [x] T085 [P] [US8] GREEN: config-hotreload.e2e asserts live theme accent + base text colour hot-reload (whole-app) and hand-edited settings.json applied on startup (SC-008).

---

## Phase 11: User Story 9 — Single Instance & Lazy Project Loading (P3)

**Goal**: Second launch silently exits; startup loads nothing until a project/sub-workspace is clicked; loaded projects stay in memory.
**Independent test**: Second launch exits; no project at startup; click loads; switch-away keeps in memory.

- [x] T086 [P] [US9] Lazy-loading behaviour asserted via persistence-restore.e2e (no auto-open at startup; open-on-click restores layout) + projects.e2e; single-instance via unit test (deterministic; a real 2-instance E2E sharing userData is inherently flaky).
- [x] T087 [US9] `packages/ui/src/main/single-instance.ts` (requestSingleInstanceLock → secondary quits; primary focuses existing window on second-instance); gated in `main.ts`. Unit test 2 green.
- [x] T088 [US9] Lazy loading: renderer opens NO project at startup (openedId state in projects-store); a project loads its workspace only when created or clicked; daemon still persists last-active. Covered by projects.e2e + persistence-restore.e2e.
- [x] T089 [P] [US9] GREEN: persistence-restore.e2e + projects.e2e assert no-project startup, load-on-click, stays-open; performance.e2e opens on demand within budget (SC-009).

---

## Phase 12: Polish & Cross-Cutting Concerns

- [x] T090 [P] Emulated active-process is clearly temporary: `renderer/workspace/subprocess.ts` carries a "TEMPORARY EMULATION (003)" comment + TODO(terminals) and a unit test asserts the flag; app-close shows no terminal warning (no warning logic exists this iteration, per FR-021).
- [x] T091 [P] Quickstart scenarios are exercised by the automated E2E suite (theming/hot-reload, drag ghost, active panel, destroy flows, project creation+exclusivity, status bar, panes, sub-workspaces detach/open/reorder/bounds/lifecycle, single-instance, lazy load) — 82 E2E green stand in for the manual run.
- [x] T092 [P] Performance budgets asserted by `performance.e2e` (lazy open + project switch within budget); config hot-reload < 500 ms asserted by config-hotreload.e2e.
- [x] T093 [P] CLAUDE.md SPECKIT block points at plan.md + the current stack; persistence is now through **migration v5** (sub-workspace `position`/order) on top of v4 (identity), with sub-workspace bounds persisted via `subworkspace.updateBounds`. The `projects.json` snapshot was removed (durable state is SQLite-only).
- [x] T094 Final sweep under green bar: dead code removed (projects-snapshot, the `totalPanels` detach guards, unused config-doc kind); the no-os-imports guard passes (unit suite); full suite green — **unit 136 · integration 51 · contract 9 · e2e 82**.

---

## Dependencies & Execution Order

- **Phase 1 (Setup)** → **Phase 2 (Foundational)** block everything.
- Each user story begins with its **RED test task**, then implementation, then the **GREEN E2E**.
- **P1 stories** (US1–US4) depend only on Foundational. US1 needs `window-manager` (T036) for the
  detach-follower; US2 needs `setActivePanel` (T017) + ThemeProvider (T038); US3 needs `destroy`
  (T021), emulated subprocess (T052), and `subworkspace.list` (T032) for the project block; US4
  needs exclusivity (T023).
- **P2 stories** (US5 status bar, US6 panes) depend on ThemeProvider + config (T038–T039) and
  active-panel (US2).
- **P3 stories**: US7 needs `window-manager` (T036), sub-workspace store/IPC (T027/T032), core
  sub-workspace ops (T018/T019), and the existing `IDisplayInfo`/`ElectronDisplayInfo` (002) for
  bounds restore (T079); US8 (whole-app theming) depends on every component existing, so it runs
  late; US9 single-instance/lazy is largely independent (US9 lazy interacts with US7 reopen); US10
  handle fix is folded into US6 (T071).
- **Cross-story test note**: the FR-025a *project-blocked* E2E is intentionally in US7 (T080),
  since creating that state needs a sub-workspace; the core block logic is unit-tested earlier
  (T020/T021).
- **Polish** last.

## Parallel opportunities

- Setup: T002, T003, T004 in parallel.
- Foundational: abstractions/schemas T005–T007, T014 in parallel; persistence T025–T028 parallel to
  platform T029 and ipc T030–T031; renderer foundation T038–T040 parallel after their inputs.
- Each story's **RED** task and **GREEN E2E** task ([P]) are independent of other stories'.

## Implementation strategy (MVP first)

- **MVP = Phase 1 + Phase 2 + US1–US4 (P1)**: themed shell, drag ghost, active panel, destroy
  flows, project creation + exclusivity — a coherent, demoable increment.
- Then **US5–US6 (P2)** (status bar, panes), then **US7–US10 (P3)** (sub-workspaces, whole-app
  theming acceptance, single-instance/lazy, handle fix), then **Polish**.
- Implement one user story at a time (RED → implement → GREEN), stopping after each for
  verification (per the user's request).
