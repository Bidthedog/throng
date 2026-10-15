# Implementation Plan: Resource Monitor — throng's Own Task Manager

**Branch**: `feature/S055-I5-I133-resource-monitor` | **Date**: 2026-10-14 | **Spec**: [spec.md](./spec.md)

**Input**: `specs/055-resource-monitor/spec.md` — 5 user stories, one clarification session (27 answers).
Refs #5, #133.

## Summary

A throng-specific task manager in four parts:

- **A resource collector process** (R1) that reads every process's CPU, private memory and I/O counters in
  one native call per tick (R2, R3) and GPU from the GPU Engine counters (R4), learns which processes are
  throng's from a new daemon roster RPC and UI main's own facts (R5), attributes them to component,
  project, tab and panel with lineage memory (R6), and caches summary and detail frames for the UI (R7).
- **Kills** in the collector, guarded by process identity and by the Projects-only rule (R8).
- **Estimates** for editors, previews and terminal buffers, calibrated against measured process memory and
  moved — not copied — out of the processes that hold them (R9).
- **The UI**: an always-present status-bar item, an exclusive maximisable modal with time-series charts
  (uPlot), a treemap (d3-hierarchy layout, React SVG), sparklines, filters and keyboard navigation, the
  standard Unload/Destroy actions and Kill Process / Kill All Below (R10, R12); seven settings with a
  cross-field resolution (R11); one command, one cog-menu item, eight icon tokens.

## Technical Context

**Language/Version**: TypeScript (repo toolchain, ES2022), Node 24 (host runtime for daemon and collector),
Electron 44.

**Primary Dependencies**: React 18, InversifyJS, koffi (existing), node-pty (existing), Vitest, Playwright.
**New runtime dependencies: `uplot` 1.6.x and `d3-hierarchy` 3.x (MIT)** in `packages/ui`, loaded in the
modal's lazy chunk (R10).

**Storage**: none new. Settings — six `resourceMonitor.*` leaves and `confirmations.killProcesses`.
`SHIPPED_DEFAULTS_VERSION` 22 → 23 for eight icon tokens. Modal view state is module state until restart
(FR-057); chart history is renderer memory for the modal session (FR-033).

**Testing**: unit (core resources), integration (real Windows calls, daemon roster, collector), contract
(roster, collector protocol, resources IPC), component (status bar, modal), **three new E2E specs and one extended** (R13).

**Target Platform**: Windows 11 desktop. Linux/macOS get the `IProcessMetrics` seam only (FR-010).

**Project Type**: Desktop application, npm-workspaces monorepo.

**Performance Goals**: SC-004 — collector < 1% of one core in summary mode (benchmarked over 60 s).
SC-002 — modal visible in < 100 ms, first full hierarchy < 2 s at 10 terminals × 20 processes. SC-003 —
≤ 5% keystroke/frame regression with the modal open, no input delayed > 50 ms (long-task measurement on a
200-process hierarchy).

**Constraints**: no OS query on any UI process or the daemon's loop for this feature (the roster is a
memory read); every native call through koffi `.async`; a kill only by (pid, create time); nothing
persisted; every figure validated against the OS or shown as "not measured" (FR-012).

**Scale/Scope**: `packages/core`, `platform-windows`, `ipc-contract`, `daemon`, `ui` (main, preload,
renderer, new collector entry). `persistence` untouched.

## Constitution Check

*GATE: evaluated before Phase 0 and re-evaluated after Phase 1.* Constitution v5.10.0. No amendment.

| Principle | Assessment |
|---|---|
| **I. Project-First Context Isolation** | **Engaged, satisfied.** The breakdown is organised by project; actions run against the node's own project, through the same commands the project's own surfaces use (R12). No cross-project leakage: a node's action never acts on another project's state. |
| **II. Platform-Abstracted Core** | **Engaged, satisfied.** `IProcessMetrics` (snapshot, GPU, describe, terminate, machine) in `packages/core/src/abstractions/`; the Windows implementation in `platform-windows`; hierarchy, roll-up, lineage, bands and estimates are pure core. A platform lacking a metric reports `Unavailable` (FR-011). |
| **III. Detached, Tagged & Persistent Terminals** | **Engaged — high-risk row.** *No orphaned OS processes*: the collector exits on IPC disconnect and the startup sweep recognises it; the process-level E2E is extended to assert no collector survives the app (R1). Kill All Below ends processes only; panels stay (FR-063a), and a killed shell takes the ordinary shell-exit path (FR-066). The daemon's roster read adds no OS work. |
| **IV. Native Terminal Support** | **Engaged lightly.** `Ctrl+Shift+Alt+R` is Tier 1, physical key, collision-free; terminals keep every key they had. |
| **V. Test-First (NON-NEGOTIABLE)** | **Engaged, satisfied.** Every task test-first at the lowest layer (R13). Three new E2E specs and one extended, each justified (real process tree or real window under test); `e2e-budget.json` re-seeded. Privilege: the GPU and I/O counters need no elevation; nothing here is `skipIfElevated`. |
| **VI. Simple, Modern, Discoverable UX** | **Engaged; see the rules table.** |
| **VII. Change Review & Approval** | **Not engaged** — no file edits. |
| **VIII. SOLID, DRY & YAGNI** | **Engaged.** DRY: one confirmation planner (`planConfirmations`) for kills; Destroy Tab/Panel and Unload Project extracted, not duplicated (R12); one reuse guard (`descendantsOf`) moved to core and shared. YAGNI: no persisted history, no network, no per-panel CPU attribution. |
| **IX. DI & Composition Root** | **Engaged.** `WindowsProcessMetrics` is constructed in the collector's own composition root; `ResourceRosterService` in the daemon's; `ResourceMonitorHost` in UI main's. |
| **X. Externalised Configuration** | **Engaged.** Seven settings with descriptors. Constants recorded in Complexity Tracking: tick overrun policy, collector restart back-off, calibration constants. |
| **XI. Dockable Workspace** | **Engaged.** Read-only over layout; the standard actions go through the existing Destroy/Unload flows unchanged. |
| **XII. Responsive UI (NON-NEGOTIABLE)** | **Engaged — high-risk row.** All collection off every UI process (R1); the modal renders from pushed frames with charts updating at the capture interval, never per input; treemap layout recomputed only when a frame's hierarchy changes; the charts' lazy chunk keeps startup unchanged; measured per SC-003. |

### Principle VI — its named rules

| Rule | Assessment |
|---|---|
| **Every panel action has a menu item** | The command is in the cog menu; the status bar is an accelerator. Node actions appear in the node's context menu and the detail pane's action row. |
| **A chord MAY stand without a menu item** | Not needed — the command has both. |
| **One section vocabulary for every menu** | Node menus: standard actions, divider, kill rows. |
| **Disabled when unavailable, absent when meaningless** | throng's own nodes: actions **absent**. Unmounted panel/tab: Destroy **disabled** with reason. Kill All Below **absent** with no live process below. |
| **Themeable icon controls (NON-NEGOTIABLE)** | Eight new tokens plus existing `dismiss`, `windowMinimise`, `panelMaximise`, `panelRestore`, `unload`, `destroy`; confirmation buttons keep text. |
| **One condition, one notice** | A kill failure raises one inline notice in the modal; a failed tick marks figures stale without a notice; a stopped collector is stale figures, not a second daemon-style notice. |

### Development Workflow & Quality Gates

| Gate | Assessment |
|---|---|
| **Incremental delivery** | Engaged: editor/preview CPU is "not measured" with a follow-up issue (FR-024); Linux/macOS implementations deferred behind the seam (FR-010) — both in Complexity Tracking and as issues. |
| **Static analysis** | Standing; `npm run gate` on the hosted runner. `eslint` already bans sync child-process calls in daemon/platform-windows; the collector entry is added to that rule's scope. |
| **Particular-scrutiny review** | Engaged: process termination (identity guard, Projects-only authorisation), a new long-lived process (orphan hygiene). |
| **Documentation currency** | Engaged: `docs/preferences.md` (Resource Monitor group, Kill processes), `docs/key-bindings.md` (`view.resourceMonitor`), `docs/quick-start.md` (status bar and monitor), `docs/architecture.md` (the collector process), `README.md` (one Highlights line), `CHANGELOG.md`. |
| **Configuration-editor completeness** | Engaged: one descriptor per leaf, `settings-inertness-055.test.ts`, slider step rule, confirmation label vocabulary, eight icon tokens with copy. |
| **Displayed quantities digit-grouped** | **Engaged**: every figure through `formatGrouped` with units (FR-032). |

**Result: PASS.**

### Re-evaluation after Phase 1

Re-checked against the data model and contracts; verdict unchanged. Four spec corrections fell out of
research and were applied at the analyze pass (spec last, smallest edit): FR-030's metric is labelled
**I/O** (R3); FR-033a and FR-046 clamp out-of-range values as every bounded setting does (R11); SC-009's
terminal case fills scrollback to its 1,000-line limit (R9); and FR-063a's Claude Code example is
narrowed to processes an ordinary end leaves behind (R6).

## Project Structure

### Documentation (this feature)

```text
specs/055-resource-monitor/
├── spec.md
├── plan.md
├── research.md          # R1–R13
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── collector-protocol.md
│   ├── resources-ipc-055.md
│   └── menus-commands-controls-055.md
├── checklists/requirements.md
└── tasks.md             # /speckit-tasks
```

### Source Code

```text
packages/core/src/
├── abstractions/process-metrics.ts          # NEW IProcessMetrics
├── resources/                                # NEW: types, hierarchy, roll-up, attribution (lineage, reuse guard),
│                                             #   estimates, bands, idle, settings resolution, friendly names,
│                                             #   actions-for, kill-order, ordering
├── process/process-tree.ts                   # descendantsOf moved here from platform-windows
├── config/app-settings.ts, settings-metadata.ts, metadata.ts (note slot), keybindings.ts,
│   keybindings-metadata.ts, theme.ts, theme-copy.ts, shipped-defaults.ts (23)
└── workspace/destroy.ts                      # + killProcesses target

packages/platform-windows/src/
├── windows-process-metrics.ts               # NEW NtQuerySystemInformation, describe, terminate
├── windows-gpu-counters.ts                  # NEW PDH GPU Engine
├── node-pty-host.ts                          # rosterEntries()
├── windows-directory-lock.ts                 # heldPids()
└── process-tree.ts                           # re-exports core

packages/ipc-contract/src/resources.ts        # NEW roster method + types, collector protocol types

packages/daemon/src/
├── resource-roster-service.ts               # NEW resources.roster
├── pty-agent-host.ts, pty-agent-entry.ts     # keep shell OS pid; agent reports its pid
├── terminal-service.ts                       # keep last attached pids per panel
├── terminal-lock-manager.ts                  # held locks with panels
├── reap-orphans.ts                           # recognise the collector
└── composition-root.ts

packages/ui/src/
├── collector/                                # NEW collector-entry.ts, collector.ts, composition-root.ts
├── main/resource-monitor-host.ts             # NEW spawn, roster merge, relay, restart
├── main/resources-ipc.ts                     # NEW
├── main/editor-coordinator.ts                # per-document estimate
├── preload/preload.cts                       # window.throng.resources
└── renderer/
    ├── resources/                            # NEW status item, modal shell, charts (lazy), treemap, breakdown,
    │                                         #   sparklines, detail, filters, keyboard, actions, session store,
    │                                         #   estimates reporter
    ├── statusbar/status-bar.tsx              # mount the item
    ├── title-bar/cog-menu-items.ts, cog-menu.tsx
    ├── keybindings/window-dispatcher.tsx     # command + exclusive-modal gate
    ├── workspace/tab-group.tsx, panel-destroy.ts   # requestTabDestroy extracted
    ├── sidebar/use-unload-project.ts         # NEW, extracted from projects-panel.tsx
    ├── preferences/form-controls.tsx         # note beside a field
    └── theme.css

docs/ preferences, key-bindings, quick-start, architecture; README; CHANGELOG
```

**Structure Decision**: the existing package layout plus one new entry point (`packages/ui/src/collector/`)
compiled with the UI main build and launched with the bundled Node runtime; no new package.

## Complexity Tracking

| Item | Why needed | Simpler alternative rejected because |
|---|---|---|
| A new long-lived helper process | FR-001 (outside every UI and terminal-input process) and the daemon-down scenario | Daemon or UI main hosting collection violates FR-001 / dies with the daemon (R1) |
| Two new dependencies (`uplot`, `d3-hierarchy`) | FR-060's visual requirement; streaming charts and treemap layout | ECharts too large; Recharts re-renders per point (XII); hand-written is a library's worth of code (R10) |
| Constants not settings: tick overrun = skip, collector restart ≤ 1/min, calibration constants `k_doc`/`k_view`/`k_dom`, 150-point history cap | Safety bounds and measured constants | Exposing them would be tunables nobody asked for (X allows limits) |
| Deferred: editor/preview CPU ("not measured") | No method meets FR-012 | A guessed figure is forbidden by FR-012; follow-up [#498](https://github.com/Bidthedog/throng/issues/498) |
| Deferred: Linux/macOS `IProcessMetrics` | FR-010 asks for the seam only | Out of scope; follow-up [#499](https://github.com/Bidthedog/throng/issues/499) |
| Three new E2E specs and one extended | A real process tree (kill, orphans), a real window (status bar), real process memory (calibration) | Component and integration tests cover everything else |
