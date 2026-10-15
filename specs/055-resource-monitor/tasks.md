# Tasks: 055 Resource Monitor — throng's Own Task Manager

**Input**: `specs/055-resource-monitor/` — spec.md, plan.md, research.md (R1–R13), data-model.md,
contracts/ (collector-protocol, resources-ipc-055, menus-commands-controls-055), quickstart.md.

**Tests**: required — Principle V (test-first, NON-NEGOTIABLE). Every behaviour task is preceded by a
failing test at the layer research R13 names. Test paths follow the repo's projects: `tests/unit`,
`tests/component`, `tests/integration`, `tests/contract`, `tests/e2e` under each package.

**Ownership** (for parallel work):
- **core** = `packages/core/**`
- **backend** = `packages/platform-windows/**`, `packages/ipc-contract/**`, `packages/daemon/**`
- **host** = `packages/ui/src/collector/**`, `packages/ui/src/main/**`, `packages/ui/src/preload/**`,
  `packages/ui/src/renderer/global.d.ts`, and the `packages/ui/tests/{unit,integration,contract}` files
  this list names for them
- **renderer** = `packages/ui/src/renderer/**` (except `global.d.ts`), `packages/ui/tests/component/**`,
  `packages/ui/tests/e2e/**`, and the `packages/ui/tests/unit` files this list names for it

Shared files with one owner: `packages/ui/package.json`, `package-lock.json`, `packages/ui/vite.config.ts`
(renderer); `packages/ui/tsconfig*.json` and `eslint.config.js` (host); `docs/**`, `README.md`,
`CHANGELOG.md` (main orchestrator).

## Phase 1: Setup

- [x] T001 Add `uplot` 1.6.x, `d3-hierarchy` 3.x and `@types/d3-hierarchy` to `packages/ui/package.json` and install (lockfile updated); route both into a lazy `resources` chunk in `packages/ui/vite.config.ts` and extend the existing eager-import guard plugin so an eager import of that chunk fails the build (research R10)
- [x] T002 [P] Add eight icon tokens `resourceMonitor`, `resourceCpu`, `resourceMemory`, `resourceGpu`, `resourceIo`, `resourceHideIdle`, `resourceKill`, `resourceKillBelow` to `packages/core/src/config/theme.ts` with copy in `packages/core/src/config/theme-copy.ts`; bump `SHIPPED_DEFAULTS_VERSION` 22 → 23 in `packages/core/src/config/shipped-defaults.ts` — test first: `EXPECTED_ICON_TOKEN_COUNT` 81 → 89 in `packages/core/tests/unit/default-themes.test.ts` and a version-23 additive case in `packages/ui/tests/integration/shipped-defaults-seed-upgrade.test.ts`
- [x] T003 [P] Add the collector entry to the UI main build so `packages/ui/src/collector/**` compiles to `packages/ui/dist/collector/` (`packages/ui/tsconfig.main.json` or the main build's include), and add `packages/ui/src/collector/**` to the sync-child-process ban in `eslint.config.js` (051 FR-020)

## Phase 2: Foundational (blocks every story)

### Pure core

- [x] T004 [P] Test: `descendantsOf` lives in core and keeps its guards — a child that started before its parent is not its child, no pid visited twice — in `packages/core/tests/unit/process-tree.test.ts`; the existing `packages/platform-windows/tests/unit` process-tree tests still pass through the re-export
- [x] T005 Move `descendantsOf` to `packages/core/src/process/process-tree.ts` (export from `packages/core/src/index.ts`); `packages/platform-windows/src/process-tree.ts` re-exports it
- [x] T006 [P] Test: metrics arithmetic — CPU = Δ(user+kernel) / (Δwall × logicalProcessors) as % of machine; I/O rates = Δ bytes / Δwall; first sample of a process has no rate (`NotMeasured` until two readings); roll-up adds numbers, `Unavailable` children contribute nothing and mark the parent **partial** with the reason, `NotMeasured` contributes nothing and does not mark partial — in `packages/core/tests/unit/resources/metrics.test.ts`
- [x] T007 Implement `ProcessReading`, `ProcessKey`, `Metrics`, `Unavailable`, `NotMeasured`, `ResourceNode` and the rate/roll-up functions in `packages/core/src/resources/types.ts` and `packages/core/src/resources/metrics.ts` (data-model *Raw readings*, *The hierarchy*)
- [x] T008 [P] Test: hierarchy build from snapshot + roster + workspace context — four components and nothing else from the machine; every roster process in exactly one component (UI by role, Daemon, Helpers = console hosts labelled with their panel + lock helpers labelled with their project + agent + "Resource collector", Projects); a shell's descendants under its panel; console-attached pids join their panel; projects ordered active → loaded → unloaded, ties by `listOrder`, **every** project present even with nothing measured (zero figures); tabs labelled `"<sub-workspace> › <tab>"` when in one; rootless terminals under "No project"; `osPid: null` becomes a limitation node with its reason (FR-080); node ids stable across ticks (`c:`, `p:`, `t:`, `n:`, `b:`, `x:`, `l:`) — in `packages/core/tests/unit/resources/hierarchy.test.ts`
- [x] T009 [P] Test: lineage — a re-parented descendant keeps its panel while its `ProcessKey` lives; a reused pid with a different create time never inherits; entries are dropped when the key disappears — in `packages/core/tests/unit/resources/lineage.test.ts`
- [x] T010 [P] Test: roll-up and estimates — every node's `rolled` = `own` + children's `rolled` (SC-006); a `PanelEstimate` is **moved**: subtracted from its source process node (floor 0) and becomes the panel's / buffers node's `own.memory`, marked `estimated`, grand total unchanged; a linked panel shows 0 with `sharedWith`; editor CPU, disk and GPU are `NotMeasured` — in `packages/core/tests/unit/resources/rollup-estimates.test.ts`
- [x] T011 Implement `buildHierarchy`, `LineageMap`, roll-up and estimate moving in `packages/core/src/resources/hierarchy.ts`, `lineage.ts`, `rollup.ts` (research R6, data-model)
- [x] T012 [P] Test: friendly names — `bash.exe`/`pwsh.exe`/`powershell.exe`/`cmd.exe` shells, `node.exe` "Node", a `node.exe` whose command line runs Claude Code "Claude Code", `git.exe` "Git", `python.exe` "Python", `conhost.exe --headless` "Console host"; unknown → image name — in `packages/core/tests/unit/resources/friendly-names.test.ts`
- [x] T013 Implement `friendlyName(reading, description)` in `packages/core/src/resources/friendly-names.ts` (FR-023)
- [x] T014 [P] Test: `resolveResourceMonitorSettings` — FR-004b band table (window 1–5 → min 2 s, 6–10 → 5, 11–20 → 15, 21–30 → 30); interval below the band's minimum is raised and `intervalRaised` set; interval max 60; a warning ≥ its critical is lowered to critical − 1; history length `ceil(minutes × 60 / interval)` never exceeds 150 — in `packages/core/tests/unit/resources/settings-resolution.test.ts`
- [x] T015 Implement `resolveResourceMonitorSettings` and `allowedIntervals(historyMinutes)` in `packages/core/src/resources/settings-resolution.ts` (research R11)

### Settings

- [x] T016 [P] Test: six `resourceMonitor.*` leaves and `confirmations.killProcesses` — defaults (interval 2, history 5, CPU 50/80, memory 50/80, killProcesses `double`), parse and clone, each with exactly one descriptor (`settings-metadata.test.ts` completeness), sliders with `min`/`max`/`step: 1` (`captureIntervalSeconds` 2–60, `historyMinutes` 1–30, thresholds 1–100) passing `slider-descriptors.test.ts`, out-of-range hand-edited values **clamped** by `applyDeclaredBounds` (`bounds-guard.test.ts`), the confirmation labelled "Kill processes" in the Confirmations vocabulary; a new `settings-inertness-055.test.ts` naming each key's production reader — in `packages/core/tests/unit/settings-metadata.test.ts`, `slider-descriptors.test.ts`, `bounds-guard.test.ts` and `settings-inertness-055.test.ts`
- [x] T017 Implement the leaves in `packages/core/src/config/app-settings.ts` (type, defaults, `parseAppSettings`, `structuredCloneSettings`, section parser), descriptors in a **Resource Monitor** group in `packages/core/src/config/settings-metadata.ts`, and `confirmDescriptor('confirmations.killProcesses', 'Kill processes', …)`; add `note?: (settings: AppSettings) => string | undefined` to `FieldDescriptor` in `packages/core/src/config/metadata.ts`, set on the interval descriptor from `resolveResourceMonitorSettings` ("Raised to N s: the minimum for a M-minute history")

### Platform seam and Windows implementation

- [x] T018 [P] Test: shared `IProcessMetrics` contract (`packages/core/src/testing/process-metrics-contract.ts`) run against a fake — snapshot contains the caller's own pid with a create time; `describe` of an unknown key resolves `Unavailable`; `terminate` of a key whose create time no longer matches resolves `gone` without terminating; a metric the platform lacks is `Unavailable` (FR-011) — in `packages/core/tests/unit/resources/process-metrics-fake.test.ts`
- [x] T019 Implement `IProcessMetrics` (`snapshot()`, `gpu()`, `describe(key)`, `terminate(key)`, `machine()`) in `packages/core/src/abstractions/process-metrics.ts`, the fake and the contract in `packages/core/src/testing/` (FR-010, research R2–R4, R8)
- [x] T020 [P] Integration test (real Windows): `WindowsProcessMetrics` passes the shared contract; a spawned busy child's CPU over 2 s agrees with an independent `GetProcessTimes` read within 2 percentage points; a child that allocates 200 MB shows private working set within 5% of `K32GetProcessMemoryInfo`'s `PrivateUsage`; a child writing 10 MB raises `ioWriteBytes` by ≥ 10 MB; `describe` returns its command line and path; a snapshot call does not delay a 10 ms `setInterval` on the caller's loop by more than 20 ms (off-loop) — in `packages/platform-windows/tests/integration/process-metrics.integration.test.ts` (FR-012)
- [x] T021 Implement `WindowsProcessMetrics` in `packages/platform-windows/src/windows-process-metrics.ts` — `NtQuerySystemInformation(SystemProcessInformation)` via koffi `.async` with x64 offsets read from a `Buffer` (the `windows-process-cwd.ts` pattern), `NtQueryInformationProcess(ProcessCommandLineInformation)` + `QueryFullProcessImageNameW` for `describe` (cached per key), `OpenProcess` → `GetProcessTimes` create-time check → `TerminateProcess` for `terminate`; export from `packages/platform-windows/src/index.ts`
- [x] T022 [P] Integration test (real Windows): `WindowsGpuCounters.read()` returns a pid → percent map or `Unavailable` with a reason; a process's value is the largest per-engine-type sum; agreement with an independent PDH query of the same counter within 2 points — in `packages/platform-windows/tests/integration/gpu-counters.integration.test.ts` (FR-012, research R4)
- [x] T023 Implement `WindowsGpuCounters` (PDH `\GPU Engine(*)\Utilization Percentage` through koffi `.async`, one open query for the collector's life) in `packages/platform-windows/src/windows-gpu-counters.ts`; `WindowsProcessMetrics.gpu()` delegates to it

### Roster (daemon)

- [x] T024 [P] Contract: `resources.roster` result shape and the collector protocol messages (both directions, `detailFrame` including `held`) per `contracts/collector-protocol.md` — in `packages/daemon/tests/contract/resources-roster.contract.test.ts` and `packages/ui/tests/contract/collector-protocol.contract.test.ts`
- [x] T025 Implement `RESOURCES_ROSTER_METHOD`, `DaemonRoster`, `ResourceRoster`, `RosterTerminal`, `RosterLock`, `RosterUiProcess`, `WorkspaceContext`, `PanelEstimate`, `ResourceSummary`, `HeldFolder` and the collector message types in `packages/ipc-contract/src/resources.ts`; export from `packages/ipc-contract/src/index.ts`
- [x] T026 [P] Test: roster plumbing — `NodePtyHost.rosterEntries()` returns `{handlePid, osPid, conhostPid}` per session; `PtyAgentHost` keeps the OS pid from `started` and the agent's own pid from its hello (`pty-agent-entry.ts` sends `process.pid`); `WindowsDirectoryLock.heldPids()` returns `{path, pid}`; `TerminalService` keeps the last attached pids per panel from `pollCommands`; `ResourceRosterService` merges them with lock panels from `TerminalLockManager` and **makes no OS query** (spy on the host's snapshot functions and `execFileOffLoop`) — in `packages/daemon/tests/unit/resource-roster-service.test.ts` and `packages/platform-windows/tests/unit/roster-entries.test.ts`
- [x] T027 Implement the optional `IPtyHost.rosterEntries?()` and `IDirectoryLock.heldPids?()` in `packages/core/src/abstractions/pty-host.ts` and `directory-lock.ts`; `rosterEntries` in `packages/platform-windows/src/node-pty-host.ts`; pid retention in `packages/daemon/src/pty-agent-host.ts` and `packages/daemon/src/pty-agent-entry.ts`; `heldPids` in `packages/platform-windows/src/windows-directory-lock.ts`; held-lock panels in `packages/daemon/src/terminal-lock-manager.ts`; last attached pids in `packages/daemon/src/terminal-service.ts`; `ResourceRosterService` in `packages/daemon/src/resource-roster-service.ts`, registered in `packages/daemon/src/composition-root.ts`
- [x] T028 [P] Integration test: a real daemon with two terminals (one in a project with a lock) answers `resources.roster` with both shells' OS pids, their conhost pids and the lock's helper pid and panels — in `packages/daemon/tests/integration/resource-roster.integration.test.ts`
- [x] T029 [P] Test: the startup sweep recognises a node process whose command line contains `resource-collector-entry` as throng-owned — in `packages/daemon/tests/unit/reap-orphans.test.ts`
- [x] T030 Recognise the collector marker in `isThrongOwned` in `packages/daemon/src/reap-orphans.ts`

### Collector and host

- [x] T031 [P] Integration test: the collector (real process, fake `IProcessMetrics` injected through its composition root by an env switch used only by tests) asks `needRoster`, emits `summary` each tick at the configured interval; ticks never overlap and an overrunning tick delays the next; `detail {on}` adds `detailFrame`s and `{on:false}` stops them; a failing snapshot emits `error` and the next `summary` keeps the previous figures with `stale: true`; it exits within 1 s of `disconnect`; `detail {on}` runs a tick **immediately** rather than waiting for the interval, and because summary mode keeps every process's previous reading, that first `detailFrame` already carries rates; with a 10-terminal × 20-process fake it arrives within 2 s of `detail {on}` (SC-002); a descendant that appears in the fake snapshot is in the next frame's hierarchy (SC-008) — in `packages/ui/tests/integration/resource-collector.integration.test.ts`
- [x] T032 Implement the collector in `packages/ui/src/collector/collector-entry.ts` (process entry; marker in its file name), `collector.ts` (tick loop with previous readings kept per `ProcessKey` across modes, an immediate tick on `detail {on}`, roster, summary/detail, lineage, description cache) and `composition-root.ts` (constructs `WindowsProcessMetrics`)
- [x] T033 [P] Test: `ResourceMonitorHost` — forks the collector with the bundled runtime from `resolveDaemonNodeExe`; merges the daemon roster with UI processes (`process.pid` as `main`, `webContents.getOSProcessId()` per window with its kind as label, `app.getAppMetrics()` GPU/utility types) read on window create/close and `child-process-gone`, never per tick; a daemon call failure yields `daemonPid: null`; sends `configure` on start and on settings change with resolved values; restarts an exited collector at most once per minute; relays `summary` to the main window only and `detailFrame` only to subscribing windows; a subscription is released when its window closes; while detail is on, it adds UI main's per-document estimate (from `EditorCoordinator`) and the daemon's per-terminal scrollback estimate (from the roster) to the renderer's `PanelEstimate[]` before sending `estimates` — in `packages/ui/tests/unit/resource-monitor-host.test.ts`
- [x] T034 Implement `ResourceMonitorHost` in `packages/ui/src/main/resource-monitor-host.ts` (including the main-side estimate merge, with a `documentEstimates()` read added to `packages/ui/src/main/editor-coordinator.ts` and the scrollback length in the daemon roster's terminals), constructed in `packages/ui/src/main/main.ts` (composition); IPC per `contracts/resources-ipc-055.md` in `packages/ui/src/main/resources-ipc.ts`; `window.throng.resources` in `packages/ui/src/preload/preload.cts`; types in `packages/ui/src/renderer/global.d.ts`; `packages/ui/tests/unit/ipc-bridge-parity.test.ts` updated
- [x] T035 [P] Contract: every `window.throng.resources` channel and payload per `contracts/resources-ipc-055.md`; invokes resolve with causes, never reject — in `packages/ui/tests/contract/resources-ipc.contract.test.ts`

## Phase 3: User Story 1 — throng's total load at a glance (P1) 🎯 MVP

**Goal**: FR-040 – FR-046, SC-001, SC-004. **Independent test**: a busy loop in a terminal raises the
status-bar CPU figure within two intervals; typing latency unchanged.

- [x] T036 [P] [US1] Test: `bandFor(metric, value, thresholds)` — CPU on % of machine, memory on % of `installedRamBytes`, `normal`/`warning`/`critical` at the configured thresholds, banded on the rolled figure — in `packages/core/tests/unit/resources/bands.test.ts`
- [x] T037 [US1] Implement `bandFor` in `packages/core/src/resources/bands.ts` (FR-046)
- [x] T038 [P] [US1] Component test: the status-bar item — before the first summary a loading state; then CPU, memory, GPU and I/O, each icon + digit-grouped value with units via `formatGrouped` (FR-032); `Unavailable`/stale shown as such, never 0 (FR-044); `daemonPid: null` marks daemon totals unavailable while the daemon indicator still renders; hover shows UI/Daemon/Helpers/Projects for all four metrics whatever is visible (FR-042); CPU and memory carry the `warning`/`danger` band colour and the band in their title (FR-046); narrowing the bar drops GPU, then I/O, then memory, then CPU, leaving the `resourceMonitor` icon, and widening restores in reverse (FR-045); click calls the monitor opener (FR-043) — in `packages/ui/tests/component/resources/status-resources.test.ts`
- [x] T039 [US1] Implement `packages/ui/src/renderer/resources/status-resources.tsx` and `use-resource-summary.ts` (`summary()` then `onSummary`), overflow by measured width with one `ResizeObserver` and read-then-write (XII); mount before `<DaemonIndicator/>` in `packages/ui/src/renderer/statusbar/status-bar.tsx`; styles in `packages/ui/src/renderer/theme.css`
- [x] T040 [P] [US1] Integration benchmark: the collector in summary mode over 60 s with a real `WindowsProcessMetrics` **and real `WindowsGpuCounters`** and 10 fake terminals costs < 1% of one core on average (SC-004), measured from its own CPU time — in `packages/ui/tests/integration/resource-collector-cost.integration.test.ts`
- [x] T041 [US1] E2E (`@core @window`): launch with a project and a terminal; the status-bar item shows numeric CPU and memory within 5 s; `node -e "for(;;){}"` in the terminal raises CPU within two intervals — in `packages/ui/tests/e2e/resource-monitor.e2e.ts`; re-seed `packages/ui/tests/e2e/e2e-budget.json` and list the spec in `packages/ui/tests/e2e/parallel-plan.json` under CPU (it drives a busy real shell), so `tier-plan.test.ts` stays green

## Phase 4: User Story 2 — drill into where the load comes from (P1)

**Goal**: FR-020 – FR-024b, FR-033, FR-033a, FR-050 – FR-053, FR-056, FR-057, FR-060, FR-061, FR-061a,
FR-065a, FR-067, FR-068, SC-002, SC-003, SC-005, SC-006, SC-008, SC-009. **Independent test**: two projects
× two tabs × nested trees; drill project → tab → panel → deepest process; every level sums.

### Core

- [x] T042 [P] [US2] Test: filter and narrowing — text matches name, command line or pid, case-insensitive; matches keep their ancestors; narrowing to a component or a project; ordering by the chosen metric with ties in a stable order — in `packages/core/tests/unit/resources/filter.test.ts`
- [x] T043 [P] [US2] Test: idle (FR-061a) — "own CPU under 0.1% and own I/O zero in each of the last 3 samples (fewer while fewer exist)"; memory at or above the memory warning threshold is never idle; hiding keeps an idle ancestor of any visible node — in `packages/core/tests/unit/resources/idle.test.ts`
- [x] T044 [US2] Implement `filterHierarchy`, `orderChildren` and `isIdle` in `packages/core/src/resources/filter.ts` and `idle.ts`

### Command, menu and the exclusive modal

- [x] T045 [P] [US2] Test: `view.resourceMonitor` — in `ActionId`, `COMMAND_SCOPES` (`EVERYWHERE`), `WINDOW_BINDINGS` `Ctrl+Shift+Alt+R`, `WINDOW_HANDLED_ACTIONS` (one literal), `KEYBINDINGS_METADATA`; Tier 1 in `keybindings-tiers.test.ts` `ACTION_TIER`; no collision in `keybindings-collision.test.ts` — in `packages/core/tests/unit/keybindings-tiers.test.ts`, `keybindings-collision.test.ts` and `keybindings-metadata.test.ts`
- [x] T046 [US2] Implement the action in `packages/core/src/config/keybindings.ts` and `keybindings-metadata.ts`; list it in `packages/ui/tests/shared/window-chords.ts` coverage (the E2E in T069 covers it)
- [x] T047 [P] [US2] Component test: the cog menu's application section lists Resource Monitor (icon `resourceMonitor`, testId `cog-resource-monitor`) after Open Logs Folder and before About, still one section; choosing it opens the monitor — update `packages/ui/tests/unit/menu-sections.test.ts` and add `packages/ui/tests/component/resources/cog-resource-monitor.test.ts`
- [x] T048 [US2] Add the item and `openResourceMonitor` to `packages/ui/src/renderer/title-bar/cog-menu-items.ts` and `cog-menu.tsx`; `runAction('view.resourceMonitor')` in `packages/ui/src/renderer/keybindings/window-dispatcher.tsx`; from a sub-workspace window it calls `window.throng.resources.open()` and the main window opens on `onOpenRequest`
- [x] T049 [P] [US2] Component test: the modal shell — opens at once with a loading state — the dialog is in the DOM within 100 ms of the open call (SC-002) — and renders the first frame asynchronously (FR-051); exclusive: the workspace behind is `inert` and every window chord except `view.resourceMonitor` is suppressed while open (FR-050); Esc and the top-right X (`dismiss` token, titled) close it (FR-052); opening subscribes to detail and closing unsubscribes — in `packages/ui/tests/component/resources/monitor-modal.test.ts`
- [x] T050 [US2] Implement `packages/ui/src/renderer/resources/monitor-modal.tsx` (shell, `role="dialog"`, `aria-modal`, focus trap), `monitor-store.ts` (open state) and the exclusive-modal gate in `packages/ui/src/renderer/keybindings/window-dispatcher.tsx`; mount in `packages/ui/src/renderer/app.tsx`

### Session, history and view state

- [x] T051 [P] [US2] Test: the modal session store — a rolling history per node of `ceil(historyMinutes × 60 / interval)` points (≤ 150), oldest dropped, discarded on close (FR-033, FR-033a); a process present in the previous frame and absent from the next is re-inserted at its last place as `ended`, greyed, struck through, no actions, its history kept and **excluded from every roll-up** (FR-065a); ended entries cleared on close and never restored; a process never seen live is never shown as ended; view state (maximised, metric, filter, narrowing, hide idle, focus path) survives close/reopen until restart and falls back to the nearest surviving ancestor (FR-057) — in `packages/ui/tests/unit/resources/monitor-session.test.ts`
- [x] T052 [US2] Implement `packages/ui/src/renderer/resources/monitor-session.ts` (module state + `useSyncExternalStore`, the `maximise-store.ts` pattern)

### Visualisation and navigation

- [x] T053 [P] [US2] Component test: the breakdown — the first view shows usage per component **and** per project (FR-020b); a treemap of the focused node's children by the chosen metric (d3-hierarchy squarify) with small contributors grouped into one "N others" tile; clicking a tile drills in; breadcrumb segments return to their level; rows with sparklines; unloaded projects greyed and italic (FR-020c); estimated figures marked; partial figures carry their reason; every node's CPU and memory carry their usage band colour and band title (FR-046) and every figure is digit-grouped with units (FR-032); a limitation node renders in place with its reason, including the agent-hosted terminal whose OS pid is not yet known (FR-080); colours from theme variables only (FR-067) — charts stubbed at the `resources/charts` module seam — in `packages/ui/tests/component/resources/breakdown.test.ts`
- [x] T054 [US2] Implement `packages/ui/src/renderer/resources/breakdown.tsx`, `treemap.tsx` (layout via `d3-hierarchy`, React SVG, focusable tiles), `breadcrumb.tsx`, `sparkline.tsx`; treemap layout recomputed only when the focused node's children or the metric change (XII)
- [x] T055 [P] [US2] Component test: the time-series chart wrapper — creates one uPlot per metric for the focused node stacked by children, appends points per frame without re-creating the chart, reads series colours from CSS variables and re-reads them on theme change, destroys on unmount — with uPlot mocked — in `packages/ui/tests/component/resources/timeseries.test.ts`
- [x] T056 [US2] Implement `packages/ui/src/renderer/resources/charts/timeseries.tsx` in the lazy `resources` chunk (T001)
- [x] T057 [P] [US2] Component test: the detail pane — process name, pid, full command line, executable path, start time, running time, owning project/tab/panel or component, and its chart since the modal opened (US2 scenario 8); an editor panel shows memory "estimated" and CPU "not measured"; figures digit-grouped with units (FR-032) and banded (FR-046) — in `packages/ui/tests/component/resources/detail-pane.test.ts`
- [x] T058 [US2] Implement `packages/ui/src/renderer/resources/detail-pane.tsx`
- [x] T059 [P] [US2] Component test: the toolbar — filter field (FR-061), component/project narrowing, metric choice (`resourceCpu`/`resourceMemory`/`resourceGpu`/`resourceIo`), hide idle (`resourceHideIdle`), and a capture-interval control offering only `allowedIntervals(historyMinutes)` that writes `resourceMonitor.captureIntervalSeconds` through the settings API (FR-004a); every control a themeable icon control with a hover title (FR-055) — in `packages/ui/tests/component/resources/toolbar.test.ts`
- [x] T060 [US2] Implement `packages/ui/src/renderer/resources/toolbar.tsx`
- [x] T061 [P] [US2] Component test: keyboard (FR-068) — in the breakdown Up/Down move between nodes at the current level, Right or Enter drills in, Left or Backspace goes up; Tab cycles filter → breakdown → chart → detail → controls; a focused node shows its hover values; in the filter field the arrows edit text — in `packages/ui/tests/component/resources/keyboard.test.ts`
- [x] T062 [US2] Implement keyboard handling in `packages/ui/src/renderer/resources/use-breakdown-keys.ts`, wired into `breakdown.tsx` and `monitor-modal.tsx`
- [x] T063 [P] [US2] Component test (XII, SC-003): with a 200-process hierarchy, a frame update produces no long task over 50 ms and no forced layout read per row, measured in the test — in `packages/ui/tests/component/resources/monitor-performance.test.ts`

### Estimates

- [x] T064 [P] [US2] Test: panel estimate models — editor main part = UTF-16 bytes × `k_doc` + constant, counted once per document and 0 with `sharedWith` for linked panels; renderer part = UTF-16 bytes × `k_view` + constant; preview = node count × `k_dom` + content bytes; terminal buffers = retained lines × cols × 12 + line overhead in the renderer and scrollback length × 2 in the daemon — in `packages/core/tests/unit/resources/estimate-models.test.ts`
- [x] T065 [US2] Implement the models and calibration constants in `packages/core/src/resources/estimate-models.ts`
- [x] T066 [P] [US2] Test: the renderer estimates reporter sends `WorkspaceContext` on change and `PanelEstimate[]` each tick only while a detail subscription exists (none otherwise) — in `packages/ui/tests/unit/resources/estimates-reporter.test.ts`
- [x] T067 [US2] Implement `packages/ui/src/renderer/resources/estimates-reporter.ts` (editor views from `editor/editor-views.ts`, preview DOM size, xterm buffer length × cols); the main and daemon parts are merged by the host (T033/T034)
- [x] T068 [US2] E2E (`@extended`): calibration — open and close 1, 10 and 50 MB files in an editor and a Markdown preview, and fill a terminal to its 1,000-line scrollback, measuring main and renderer private bytes with `--js-flags=--expose-gc`; each estimate within 10% (SC-009); tune `estimate-models.ts` constants from the measurement; a panel kind that cannot meet 10% is switched to `NotMeasured` (FR-012) — in `packages/ui/tests/e2e/resource-estimates-calibration.e2e.ts`; budget re-seeded; listed in `parallel-plan.json` under CPU and TIMING (real shell, memory measured under contention)
- [x] T069 [US2] Extend `resource-monitor.e2e.ts`: `Ctrl+Shift+Alt+R` opens the modal; drill Projects → project → tab → panel → `node.exe` from the busy loop; each level's figure equals its children plus its own (SC-006), reached in at most four clicks from the status bar (SC-005); with the modal open, keystroke-to-echo latency in a second terminal is within 5% of the closed-modal median and no keystroke waits over 50 ms (SC-003); Esc closes; budget re-seeded; the spec stays in `parallel-plan.json` and gains TIMING (it asserts SC-003's latency)

## Phase 5: User Story 3 — act on what is costing too much (P2)

**Goal**: FR-062 – FR-066, SC-007. **Independent test**: kill a child under a shell; it shows ended, leaves
the totals, and the shell runs on.

- [x] T070 [P] [US3] Test: `actionsFor(node, context)` per data-model *Actions* — none under UI/Daemon/Helpers; project → Unload Project (both rows) + Kill All Below; tab → Destroy Tab + Kill All Below; terminal panel → Destroy Panel + Kill All Below; editor/preview panel → Destroy Panel; buffers → none; process → Kill Process + Kill All Below; Kill All Below absent with no live process below; Destroy disabled with a reason when the tab/panel is not mounted; ended nodes have none — in `packages/core/tests/unit/resources/actions.test.ts`
- [x] T071 [P] [US3] Test: `killOrder(node)` returns the subtree's live `ProcessKey`s leaves first, the node itself last for a process node, and nothing outside Projects; `planConfirmations` accepts the `killProcesses` target and maps none/single/double exactly as `destroyPanel` — in `packages/core/tests/unit/resources/kill-order.test.ts` and `packages/core/tests/unit/destroy.test.ts`
- [x] T072 [US3] Implement `actionsFor`, `killOrder` in `packages/core/src/resources/actions.ts`; the `killProcesses` target in `packages/core/src/workspace/destroy.ts`
- [x] T073 [P] [US3] Integration test: the collector's `kill` — a real three-level tree under a fake roster's terminal: `below` ends all, leaves first; `process` ends only the target and its parent lives; a target outside Projects returns `denied` and the process lives; a key whose pid was reused (fake) returns `gone` and nothing is terminated; results map to failure causes — in `packages/ui/tests/integration/resource-collector-kill.integration.test.ts`
- [x] T074 [US3] Implement kill handling in `packages/ui/src/collector/collector.ts` (authorisation against the latest hierarchy, identity check, leaves-first) and `killResult` relay in `resource-monitor-host.ts` / `resources-ipc.ts`
- [x] T075 [P] [US3] Test: `requestTabDestroy(tabId)` runs the same confirmation flow as the tab strip's Destroy Tab (`confirmations.destroyTab`, wry final dialog) and refuses an unmounted tab; `useUnloadProject()` gives the project list and the monitor the same `unloadProject` collaborators — in `packages/ui/tests/component/workspace/tab-destroy-command.test.ts` and `packages/ui/tests/component/sidebar/use-unload-project.test.ts`
- [x] T076 [US3] Extract `confirmCloseTab` from `packages/ui/src/renderer/workspace/tab-group.tsx` into `requestTabDestroy` (registered like `requestPanelDestroy` in `workspace/panel-destroy.ts`), behaviour unchanged; extract `runUnloadProject`'s collaborators from `packages/ui/src/renderer/sidebar/projects-panel.tsx` into `packages/ui/src/renderer/sidebar/use-unload-project.ts`; route a sub-workspace tab's Destroy Tab to its own window through main (the `openPreferences` route)
- [x] T077 [P] [US3] Component test: node actions — context menu and detail action row show `actionsFor`'s rows with their icon tokens and section divider; Kill Process / Kill All Below run `confirmations.killProcesses`' dialogs and the dialog names the node and lists the processes ending, collapsing to "and N more" (FR-063b), Esc cancels; Destroy Panel / Destroy Tab / Unload Project call the shared commands; disabled rows show their reason; a failed kill raises **one** inline notice in the modal with a plain cause (FR-064); throng's own nodes have no menu rows — in `packages/ui/tests/component/resources/node-actions.test.ts`
- [x] T078 [US3] Implement `packages/ui/src/renderer/resources/node-actions.tsx` (menu + detail row) and `kill-confirm.tsx` (details slot of `ConfirmProvider`)
- [x] T079 [US3] E2E (`@extended @terminal`): a terminal running a parent `node` that spawns two children; Kill All Below on the parent ends all three, they show ended and leave the totals, the shell keeps running; Kill All Below on the panel ends the shell too and the panel stays in its shell-exited state (FR-066) — in `packages/ui/tests/e2e/resource-monitor-kill.e2e.ts`; budget re-seeded; listed in `parallel-plan.json` under FOCUS and CPU (context menu, real shells)

## Phase 6: User Story 4 — which folders throng is holding (P3)

**Goal**: FR-070 – FR-072. **Independent test**: two terminals in a project → its root listed with both;
close both → gone.

- [x] T080 [P] [US4] Test: `heldFolders(roster, context)` lists each lock with its project and every holding panel by tab and panel name; a lock with no live panel is absent — in `packages/core/tests/unit/resources/held-folders.test.ts`
- [x] T081 [US4] Implement `heldFolders` in `packages/core/src/resources/held-folders.ts`; the collector includes `held` in `detailFrame`
- [x] T082 [P] [US4] Component test: the Held folders section lists each folder with its project and terminals; choosing a terminal drills the breakdown to that panel (FR-071) — in `packages/ui/tests/component/resources/held-folders.test.ts`
- [x] T083 [US4] Implement `packages/ui/src/renderer/resources/held-folders.tsx`

## Phase 7: User Story 5 — keep the monitor in view (P3)

**Goal**: FR-053, FR-054. **Independent test**: maximise, restore, minimise into the status-bar item.

- [x] T084 [P] [US5] Component test: Maximise fills the window and Restore returns the previous size (`panelMaximise`/`panelRestore`); Minimise (`windowMinimise`) runs one `Element.animate` toward the status-bar item's rectangle and closes when it finishes; under `prefers-reduced-motion` it closes with no animation — in `packages/ui/tests/component/resources/monitor-window-controls.test.ts`
- [x] T085 [US5] Implement maximise/restore and the minimise FLIP animation in `packages/ui/src/renderer/resources/monitor-modal.tsx` and `theme.css`

## Phase 8: Polish & cross-cutting

- [x] T086 [P] Preferences shows the interval descriptor's `note` beside the field when the interval was raised (R11) — component test in `packages/ui/tests/component/preferences/field-note.test.ts`, implementation in `packages/ui/src/renderer/preferences/form-controls.tsx`
- [x] T087 [P] Extend the process-level E2E (Principle III): after the app closes, no `resource-collector-entry` process survives — in `packages/ui/tests/e2e/terminal-no-orphans.e2e.ts`; budget re-seeded
- [x] T088 Documentation: `docs/preferences.md` (Resource Monitor group, every key in backticks; Kill processes in Confirmations), `docs/key-bindings.md` (`view.resourceMonitor`), `docs/quick-start.md` (status bar and monitor), `docs/architecture.md` (the collector process and roster), `README.md` (one Highlights line), `CHANGELOG.md` (unreleased); `packages/ui/tests/unit/docs-currency.test.ts` green
- [x] T089 File follow-up issues through `github-issues`: per-panel CPU for editors and previews (FR-024), and Linux/macOS `IProcessMetrics` implementations (FR-010) — both in vNext, linked from plan Complexity Tracking

## Dependencies

- Phase 1 → Phase 2 → stories. Inside Phase 2: T004–T017 (core) are independent of T018–T035 except
  T019 before T021/T023, T025 before T027/T031/T033, T032 before T031 passes, T034 after T032.
- **US1** needs Phase 2. **US2** needs Phase 2 (and T050's modal shell before T053–T063). **US3** needs
  US2's modal (T050) and T032; T072 before T074. **US4** needs T032 and T050. **US5** needs T050.
- Parallel by boundary: core (T004–T017, T036–T037, T042–T044, T064–T065, T070–T072, T080–T081),
  backend (T018–T030), host (T031–T035, T040, T066–T067 main half, T073–T074), renderer (T001, T038–T039,
  T041, T045–T063, T068–T069, T075–T079, T082–T087).

## Parallel examples

- Phase 2: T006, T008, T009, T010, T012, T014, T016 (core tests) alongside T018, T020, T022, T024, T026,
  T029 (backend tests).
- US2: T053, T055, T057, T059, T061 (separate component test files).

## Implementation strategy

MVP = Phase 1, Phase 2 and US1: the status-bar totals, proven by T040 and T041. US2 makes it a monitor;
US3 makes it actionable; US4 and US5 finish it. Every phase leaves `npm run gate` green.

## Phase 9: Convergence

- [x] T090 Give every sub-workspace tab its origin project in the reported context, so its panels, shells and descendants are placed under that project; test with the context exactly as `estimates-sources.ts` builds it, in `packages/ui/src/renderer/resources/estimates-sources.ts` and `packages/ui/tests/unit/resources/` per Edge Case "Sub-workspace windows", FR-020, SC-006 (contradicts)
- [x] T091 Bound every collector OS call (`snapshot`, `gpu`, `describe`, `terminate`) with a time limit; a timed-out tick marks the figures stale and the loop carries on, in `packages/ui/src/collector/collector.ts` per FR-001, Edge Case "Sampling fails" (partial)
- [x] T092 Report the tabs and panels of every loaded project, and of unloaded projects with kept terminals, with `mounted: false` where they are not mounted in that window, in `packages/ui/src/renderer/resources/estimates-sources.ts` per US2/AC3, FR-020, FR-063 (partial)
- [x] T093 List every roster lock as a held folder whatever the context holds, naming a panel the context does not know by a fallback, in `packages/core/src/resources/held-folders.ts` per FR-070, US4/AC1 (partial)
- [x] T094 Keep the last good daemon roster and its lineage when a roster call fails, and mark the daemon-derived figures stale with their age, in `packages/ui/src/main/resource-monitor-host.ts` and `packages/ui/src/collector/collector.ts` per FR-021, FR-044, Edge Case "daemon stops" (partial)
- [x] T095 Send a stale detail frame that keeps the last good `at` on a failed tick; the modal shows "stale" with the age and recovers without reopening, in `packages/ui/src/collector/collector.ts` and `packages/ui/src/renderer/resources/` per FR-044, Edge Case "Sampling fails" (partial)
- [x] T096 Keep tick numbers increasing across collector restarts, so the status bar and chart history never freeze after a restart, in `packages/ui/src/main/resource-monitor-host.ts` per FR-044, SC-001 (partial)
- [x] T097 Report a target that was already gone in the kill notice, in `packages/ui/src/renderer/resources/kill-confirm.tsx` and `kill-cause.ts` per US3/AC9, FR-064 (contradicts)
- [x] T098 Make the Preferences interval minimum follow `minimumIntervalFor(historyMinutes)`, so a value below the window's minimum cannot be chosen, in `packages/core/src/config/settings-metadata.ts` and `packages/ui/src/renderer/preferences/` per FR-004 (partial)
- [x] T099 Put rootless terminals under "No project" in their own tab node, and offer no Unload on that group, in `packages/ui/src/renderer/resources/estimates-sources.ts` and `packages/core/src/resources/actions.ts` per Edge Case "Rootless terminals", Principle VI (partial)
- [x] T100 Report GPU as unavailable rather than 0 when the counters cannot be read, and keep a failed `describe`'s reason for the detail pane, in `packages/platform-windows/src/windows-gpu-counters.ts` and `packages/ui/src/collector/collector.ts` per FR-011, FR-012, FR-080 (partial)
- [x] T101 Report the console host pid of each agent-hosted terminal, in `packages/daemon/src/pty-agent-host.ts` per FR-020 Helpers (partial)
- [x] T102 Apply the last panel estimates in summary mode too, so the status-bar hover splits UI and Daemon as the modal does, in `packages/ui/src/collector/collector.ts` per FR-024, FR-042 (partial)
- [x] T103 Polish: group small series as "N others" in the stacked chart; order by read + write I/O; keep warning ≥ 1 when critical is 1; drop the self-owner from the kill dialog's wording; fail pending kills as `collectorUnavailable` when the collector exits; platform-neutral kill-failure wording, per Edge Case "very large trees", FR-046, FR-061, FR-064 (partial)

## Phase 10: The monitor window (Session 2026-10-15, FR-081 – FR-087, research R14)

Supersedes the exclusive modal (FR-050, FR-053, FR-054). UI main tasks are T104–T110; renderer tasks are T111–T117.

- [ ] T104 Test: the shared floating-window layering helper holds `alwaysOnTop` only while a throng window has focus, and drops it when the window closes, in `packages/ui/tests/unit/floating-window-layering.test.ts` per FR-083
- [ ] T105 Extract Preferences' focus-scoped layering (`syncTopmost`, `wirePreferencesLayering`, and their reasoning comment) into `packages/ui/src/main/floating-window-layering.ts`, used by `preferences-window.ts` with its behaviour unchanged, per FR-083 and Principle VIII
- [ ] T106 Test: the monitor window's lifecycle — one instance, focused when opened again; parented to the main window, frameless, movable, resizable, OS-minimise off; bounds and maximised state remembered on close and restored on open, clamped onto a visible display; view state held until restart — in `packages/ui/tests/unit/resource-monitor-window.test.ts`, with Electron behind a fake seam, per FR-081, FR-083, FR-086, FR-087
- [ ] T107 Implement `packages/ui/src/main/resource-monitor-window.ts`: `openResourceMonitor(deps)` creates or focuses the window, loading the renderer entry with `?monitor`; it uses the T105 layering, `revealWhenPainted`, `denyRendererWindows` and `wireWindowMaximizeEvents`, remembers its bounds and maximised state, and releases its detail subscription on close; wire it in `main.ts` in place of `openInMainWindow`, per FR-081 – FR-084, FR-086, FR-087
- [ ] T108 Test: minimise asks the main window for the status-bar rectangle, shrinks the monitor's bounds toward its screen position in steps, then closes the window; with `reducedMotion` (or no rectangle) it closes at once, in `packages/ui/tests/unit/resource-monitor-window.test.ts` per FR-085
- [ ] T109 Implement minimise in `resource-monitor-window.ts`, plus the `throng:resources:minimise`, `throng:resources:status-rect`, `throng:resources:view:get` and `throng:resources:view:set` channels in `resources-ipc.ts`, `preload.cts` and `global.d.ts`; retire `throng:resources:open-request`; update `packages/ui/tests/contract/resources-ipc.contract.test.ts` and `specs/055-resource-monitor/contracts/resources-ipc-055.md`, per FR-085, FR-087
- [ ] T110 Extend `routeAction` with `{ action: 'unloadProject', id, variant }`, always delivered to the main window and bringing it forward; contract test first, in `resources-ipc.ts` and its contract test, per FR-086
- [ ] T111 Component test: the monitor app shows the Preferences title bar titled "Resource Monitor", with Minimise, Maximise/Restore and X; Minimise calls `resources.minimise` with the reduced-motion preference; Esc and X close the window; the view state is read on mount and saved on change, in `packages/ui/tests/component/resources/monitor-app.test.ts` per FR-081, FR-084, FR-085, FR-087
- [ ] T112 Implement `packages/ui/src/renderer/resources/monitor-app.tsx`, mounted by `main.tsx` for `?monitor`, with the providers Preferences' app uses (theme, icon packs, settings, context menus, notices) around the existing monitor body; the monitor session restores from and saves to UI main's view state, per FR-081, FR-087
- [ ] T113 The main window no longer mounts the modal: `app.tsx` loses `MonitorModal`; the status bar, the cog item and `view.resourceMonitor` call `resources.open()` from every window; the window dispatcher's monitor-open gate and `inert` handling go; a component test proves a click opens no in-window dialog, per FR-086 (superseding FR-050)
- [ ] T114 Every Destroy goes through `routeAction` from the monitor window; Unload Project routes to the main window, where an `onAction` handler runs `useUnloadProject` with the variant; component tests cover both, per FR-086
- [ ] T115 Each window answers `throng:resources:status-rect` — the main window with its status-bar figures' rectangle, others with `null` — component test first, per FR-085
- [ ] T116 Update the E2E specs that open the monitor (`resource-monitor.e2e.ts`, `resource-monitor-kill.e2e.ts`, `resource-estimates-calibration.e2e.ts`) to find it as its own window; add one `@extended @window` test proving that throng's terminal accepts typing while the monitor is open, that the monitor is above the main window, that Minimise closes it, and that it reopens at its last bounds; re-seed `e2e-budget.json` and place it in `parallel-plan.json`, per FR-081 – FR-087
- [ ] T117 Documentation: `docs/quick-start.md` (the monitor is a window beside throng), `docs/architecture.md` (the monitor window), `CHANGELOG.md` entry wording; `docs-currency.test.ts` green, per the documentation rule
