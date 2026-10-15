# Research: Resource Monitor (055)

Decisions R1–R13, each with its rationale and the alternatives rejected. Findings are from the codebase
as of `cddb0587` (master) unless stated.

## R1 — Where collection runs: a dedicated collector process

**Decision.** A new **resource collector**: a plain-Node child process started by UI main with the same
bundled runtime the daemon uses (`resolveDaemonNodeExe`, `packages/ui/src/main/daemon-lifecycle.ts:20-32`),
over a Node IPC channel (`child_process.fork` with `execPath` set to that runtime). It does every
operating-system query (R2–R4), builds the hierarchy (R6), keeps the cache the UI reads (FR-002), and
performs kills (R8). It exits when its IPC channel disconnects, and the daemon's startup orphan sweep
learns its command-line marker (`resource-collector-entry`) beside the existing ones
(`packages/daemon/src/reap-orphans.ts:31-39`), so Principle III's "a detached helper MUST self-terminate
when the process it serves is gone" holds both ways.

**Rationale.**
- FR-001 puts collection outside every process that renders UI or handles terminal input. The renderer
  renders; UI main relays terminal input; the daemon owns PTYs. A separate process is the only home that
  is none of those.
- The daemon can stop while the UI keeps running (US1 scenario 4, Edge Cases). A collector inside the
  daemon would take the UI's own figures down with it.
- Its own cost is measured like any other process and shown under **Helpers** as "Resource collector"
  (FR-007) — a `[derived]` addition to FR-020's Helpers list.

**Rejected.** Inside the daemon (dies with it; daemon is a terminal-input host). Electron
`utilityProcess` (never used in this codebase — `specs/001-app-bootstrap/research.md:41` rejected it —
and it loads Electron's Node ABI while koffi is built for the host-Node ABI, `electron-builder.yml:25`).
UI main on a worker thread (main still relays terminal input; FR-001).

## R2 — Process table and per-process CPU, memory and I/O: one native call

**Decision.** `NtQuerySystemInformation(SystemSessionProcessInformation)` — the same table, scoped to the
collector's own session (falling back to `SystemProcessInformation` for the whole machine if refused) — through **koffi**, called with
koffi's `.async` (a worker thread), the pattern `windows-process-cwd.ts:41-79` already uses, with structs
read from a `Buffer` at x64 offsets as that file does. One call returns every process's pid, parent pid,
create time, user and kernel time, **private working set** (`WorkingSetPrivateSize`) and I/O transfer
counts, in one buffer — typically 1–3 ms for a few hundred processes.

- **CPU** = Δ(user + kernel) / (Δwall × logical processors), so throng's total is a share of the whole
  machine (Assumptions) and a rate over the interval (FR-031).
- **Memory** = private working set — Task Manager's default column (Assumptions).
- **Command line and executable path** are read only for processes in throng's hierarchy, once per
  (pid, create time), via `NtQueryInformationProcess(ProcessCommandLineInformation)` and
  `QueryFullProcessImageNameW`, cached for the process's life.
- **Validation (FR-012).** An integration test spawns a known busy process and a known allocator and
  compares the collector's CPU and memory with `GetProcessTimes` / `K32GetProcessMemoryInfo` read
  independently for the same pid.

**Rationale.** The existing reads (`node-pty-host.ts:616-750`) are PowerShell CIM cold starts at
~0.55–0.7 s each and carry no counters at all; sampling with them every 2 s would cost a third of a core,
breaking SC-004 by thirty times. The native call costs milliseconds.

**Rejected.** Reusing `pidTableSnapshot`/`processSnapshot` (cost above, no counters). Per-process
`OpenProcess` + `GetProcessTimes` for each pid (hundreds of handle opens per tick, and needs a process
list from somewhere anyway). WMI perf classes (slow, same cold start).

## R3 — "Disk I/O" is the process I/O counter, labelled **I/O**

**Decision.** Per-process read and write rates come from the I/O transfer counts in the same call (R2).
Windows counts **all** file and device I/O there — local disk, network shares and pipes — not disk alone.
The UI labels the metric **I/O** (status bar, modal, settings copy), with a hover title saying what it
counts. FR-030's "disk read and write rates" is served by this counter; the label is the narrowing,
recorded here and in the spec at the analyze pass.

**Rationale.** FR-012 forbids showing a figure that does not measure what it says. Task Manager's
"Disk" column comes from kernel ETW tracing, which needs administrator rights; an unelevated throng
cannot read it. The I/O counter is exact for what it is, so calling it "I/O" is accurate and calling it
"disk" would not be.

**Rejected.** ETW disk tracing (admin only; constitution V elevation gating; heavy). Showing "disk" for
the I/O counter (fails FR-012).

## R4 — GPU per process: PDH GPU Engine counters

**Decision.** The PDH counter `\GPU Engine(*)\Utilization Percentage` through koffi (`pdh.dll`:
`PdhOpenQueryW`, `PdhAddEnglishCounterW`, `PdhCollectQueryData`, `PdhGetFormattedCounterArrayW`), the
same source Task Manager's per-process GPU column reads. Instance names carry `pid_<n>_…_engtype_<t>`.
A process's GPU = the **largest** per-engine-type sum over its instances (Task Manager's rule);
throng's GPU total = the largest per-engine-type sum over all throng processes, capped at 100%. The query
stays open for the collector's life; each tick is one collect plus one array read.

**Validation (FR-012).** An integration test reads the same counter for the collector's own GPU
process set through a second PDH query and asserts agreement; on a machine with no GPU counters the
metric is "unavailable" (FR-011), which is also asserted.

**Rejected.** D3DKMT queries (undocumented per-process accounting). `app.getGPUInfo` (no per-process
utilisation).

## R5 — The roster: who each OS process is

**Measured at implementation (SC-004).** The whole-machine read cost 6.2 ms of kernel CPU per call on a
~420-process machine and the collector averaged 1.02% of a core; scoping the read to the user's session
(4.7 ms — throng starts nothing outside it, and session 0's services hold most of the threads), taking
GPU every other summary tick (PDH already averages between collects) and computing figures only for the
processes the hierarchy places brought it to 0.52%.

The collector sees every process in its session; the roster tells it which are throng's and what they
are. **Decision:** a new daemon RPC `resources.roster` plus UI main's own facts, merged by UI main and
handed to the collector each tick.

| Process | Source today | Change |
|---|---|---|
| Daemon | `health.ping` → `pid` | roster carries `daemonPid` |
| Terminal shell | `NodePtyHost.sessions` keyed by shell pid (`node-pty-host.ts:117`); agent host drops the OS pid it is told (`pty-agent-host.ts:311-321`) | `IPtyHost.rosterEntries()` (optional, both hosts) returns `{handlePid → osPid, conhostPid}`; `PtyAgentHost` keeps `ev.pid` |
| Console host | `Session.conhostPid`, private (`node-pty-host.ts:67-72`) | exposed through `rosterEntries()` |
| Console-attached processes | the command poller already reads them per host (`terminal-service.ts:357-372`) | the last result is kept per panel and returned in the roster |
| Folder-lock helper | private `held` map (`windows-directory-lock.ts:36`) | `IDirectoryLock.heldPids()` (optional) returns `{path, pid}`; `TerminalLockManager` adds the projectId and the panels holding it |
| De-elevation agent | spawn pid discarded (`composition-root.ts:242`); de-elevated launcher returns void | the agent reports `process.pid` in its hello; `PtyAgentHost` keeps it |
| UI main, renderers, GPU, utility | not read anywhere | UI main: `process.pid`, `webContents.getOSProcessId()` per window (role = window kind), `app.getAppMetrics()` for GPU/utility types — read on window create/close and on `child-process-gone`, never per tick |
| Resource collector | its own `process.pid` | known to the collector |

`resources.roster` is a pure read of in-memory state in the daemon: no OS query, no measurable cost.

## R6 — Attribution and lineage

**Decision.** Pure core logic (`packages/core/src/resources/attribution.ts`) builds the hierarchy from one
snapshot plus the roster:

1. Each shell's descendants by parent links with the existing reuse guard — a child that started before
   its parent is not its child (`packages/platform-windows/src/process-tree.ts:34`, moved to core since it
   is pure).
2. Console-attached processes from the roster join their panel.
3. **Lineage memory.** Every (pid, create time) once attributed to a panel keeps that panel for as long as
   the same (pid, create time) is alive, so a re-parented or detached process stays put (Edge Cases,
   FR-021). Entries die with the process; a reused pid has a different create time and never inherits.
4. Everything left in the roster lands in its component; the rest of the machine is ignored.

**Finding that narrows the spec's example.** An ordinary terminal end already runs `taskkill /T /F` on the
shell **and** on every console-attached process (`node-pty-host.ts:355-379`), so a Claude Code session
started from the terminal normally ends with it. What survives an ordinary end is a process that was both
re-parented and detached from the console — exactly what lineage memory still attributes, and what Kill
All Below reaches (FR-063a). The spec's Claude Code example is corrected at the analyze pass.

## R7 — Data flow and cadence

- Collector tick at the effective capture interval (R11). **Summary mode** always; **detailed mode** only
  while some window has a detail subscription (FR-003). Summary = per-component totals plus the four
  status-bar totals; it still needs the attribution pass (the Projects total is the sum of every
  terminal's tree), which costs microseconds on top of the native read.
- Collector → UI main over IPC → **main window only** for the summary (`throng:resources:summary`); the
  detail stream goes only to the subscribing window (`throng:resources:detail`). Main does no OS query
  and no aggregation — it relays.
- Detail payloads carry the whole hierarchy for one tick; history is accumulated **in the renderer**, in a
  rolling buffer sized from the window (FR-033, FR-033a), and discarded when the modal closes.
- **Panel estimates** (R9) are reported by each renderer to main every tick while a detail subscription
  exists; main adds its own per-document figures and passes the combined list to the collector, which
  moves them out of their process nodes (FR-024, FR-024b).

## R8 — Killing

**Decision.** The collector terminates through `OpenProcess(PROCESS_TERMINATE | PROCESS_QUERY_LIMITED_INFORMATION)`,
re-checks the create time with `GetProcessTimes` against the (pid, create time) the request named, then
`TerminateProcess` — so a pid reused since the user clicked is never killed. **Kill All Below** kills the
subtree from the latest snapshot **leaves first**, each by (pid, create time).

**Authorisation lives in the collector**, not the renderer: a request is honoured only for nodes the
latest hierarchy places under **Projects** (FR-062), and only for processes still alive. Every result
returns per pid (`ended`, `gone`, `denied`, `failed`) and maps onto the failure-cause model for the single
inline notice (FR-064).

**Rejected.** `taskkill` (a process spawn per kill; `/T` follows parent links only and would miss lineage
members). Routing kills through the daemon (it does not own descendants, and the collector already holds
the authoritative tree).

## R9 — Estimates for editors, previews and terminal buffers

**Editor and preview memory (FR-024).** A panel's document text lives in UI main
(`EditorCoordinator.docs`, `editor-coordinator.ts:423`; linked panels share one) and its view state in
the renderer (`EditorView` per panel, `use-editor.ts:1564`). The estimate is a calibrated model, not a
heap measurement:

- **main part** — UTF-16 bytes of the document × `k_doc` + a per-document constant (counted once per
  document, attributed to the panel that owns it; linked panels show 0 with "shares <panel>'s document");
- **renderer part** — UTF-16 bytes × `k_view` (syntax tree, line index, rendered viewport) + a per-panel
  constant; for previews, rendered DOM size by node count × `k_dom` + content bytes.

The constants are fixed by a **calibration E2E** that opens and closes files of 1, 10 and 50 MB with
`--js-flags=--expose-gc` and measures the change in private bytes of main and the renderer
(`process.getProcessMemoryInfo()`); SC-009's 10% bound is the assertion. A model that cannot be brought
inside 10% ships with that panel kind showing "not measured" (FR-012) — the setting is not a switch, the
test result decides it at implementation.

**Editor CPU.** Not attributed: no per-panel CPU accounting exists inside a shared renderer, and no
method meets FR-012. Shown as "not measured"; a follow-up issue is filed at the end of implementation
(FR-024).

**Terminal buffers (FR-024b).** Renderer: xterm keeps its default **1,000** lines of scrollback (no
`scrollback` option is passed, `use-terminal.ts:562`) at 3 × 4 bytes per cell — lines × cols × 12 plus
the line objects. Daemon: the session's `scrollback` string, capped at 64 KiB characters
(`terminal-service.ts:59-60`) — length × 2. Both are moved out of their processes. Calibrated the same way
with a terminal filled to its scrollback limit; **SC-009's "10,000 and 100,000 lines" cannot be
reached** — scrollback stops at 1,000 — and is corrected to "filled to its limit" at the analyze pass.

## R10 — Charts and visualisation

**Decision.** Two small libraries, both MIT:

- **uPlot 1.6.x** (~50 KB) for time-series — canvas, built for streaming updates, stacked series by
  pre-summed bands. Colours read from the theme's CSS variables at mount and on theme change (FR-067).
- **d3-hierarchy 3.x** (~30 KB) for the treemap **layout only** (squarified); the rectangles render as
  React SVG so each is a focusable, themeable element (FR-068), with small contributors grouped into one
  "N others" tile (Edge Cases, *Very large trees*).
- Sparklines are tiny inline SVG paths — no library.

Both load in a lazy chunk with the modal, so nothing is added to startup (XII).

**Rejected.** ECharts (~1 MB, theming through its own system). Recharts (SVG per point re-renders whole
charts on each update — XII). Hand-written charts (time-series axes, scaling and hit-testing are a
library's worth of code; VIII).

## R11 — Settings and the cross-field rule

**Decision.** Six new leaves plus one confirmation:

| Key | Control | Default | Range |
|---|---|---|---|
| `resourceMonitor.captureIntervalSeconds` | slider, step 1 | 2 | 2 – 60 |
| `resourceMonitor.historyMinutes` | slider, step 1 | 5 | 1 – 30 |
| `resourceMonitor.cpuWarningPercent` | slider, step 1 | 50 | 1 – 100 |
| `resourceMonitor.cpuCriticalPercent` | slider, step 1 | 80 | 1 – 100 |
| `resourceMonitor.memoryWarningPercent` | slider, step 1 | 50 | 1 – 100 |
| `resourceMonitor.memoryCriticalPercent` | slider, step 1 | 80 | 1 – 100 |
| `confirmations.killProcesses` | select none/single/double | double | — |

- **Out-of-range values are clamped**, as every bounded setting already is (`bounds-guard.ts:122-129`,
  `docs/preferences.md:42-46`) — that is this repository's hard block. FR-033a's "the default used in its
  place" contradicts the established guard; the spec is aligned to clamping at the analyze pass rather
  than introducing a second rule for six keys.
- **The cross-field rules are resolved where they are read**, by one pure core function
  `resolveResourceMonitorSettings(raw)`: the effective interval is `max(interval, minimumFor(window))`
  (FR-004b table) and a warning at or above its critical is lowered to critical − 1. Preferences shows the
  resolved interval and why beside the field — a new, small `note` slot on `FieldDescriptor` (no generic
  slot exists today) — and the modal's interval control offers only allowed values (FR-004a).
- `confirmations.killProcesses` reuses `planConfirmations` (`packages/core/src/workspace/destroy.ts:43-59`)
  through a new `DestroyTarget` kind, so its dialogs and the wry final dialog behave exactly as Destroy
  Panel's.

## R12 — Commands, menus, bindings and the exclusive modal

- **Command** `view.resourceMonitor`, `EVERYWHERE`, default `Ctrl+Shift+Alt+R` (free — no collision in
  `packages/` or `docs/`); the `view.` prefix already exempts it from transient-input suppression
  (`keybindings/scope.ts:200-210`). From a sub-workspace window it asks main to open the modal in the main
  window and bring it forward (the `openPreferences` route, `preload.cts:266`).
- **Cog menu** item "Resource Monitor" in the `application` section (`cog-menu-items.ts:84-97`).
- **Exclusive modal.** The window dispatcher today suppresses only two chords inside `[role=dialog]`
  (`window-dispatcher.tsx:296`, `:630`, `:633`). A new gate: while the monitor is open, every window chord
  except the monitor's own toggle is suppressed, and the workspace behind is `inert` (FR-050).
- **Standard actions.** Destroy Panel runs only for a mounted panel (`panel-destroy.ts:27`); Destroy Tab
  is a closure inside `tab-group.tsx:1534-1587`. Both are extracted into callable commands
  (`requestTabDestroy(tabId)` beside `requestPanelDestroy`) without changing their behaviour or
  confirmations. A node whose panel or tab is **not mounted** — another loaded project, or an unloaded
  one — shows the action **disabled** with its reason ("Switch to <project> to destroy this panel");
  a sub-workspace tab's action is sent to its own window, which comes forward and runs its own flow.
  Unload Project calls `unloadProject` with the collaborators `projects-panel.tsx:659-684` assembles,
  extracted into one hook so both callers share it.
- **Minimise animation.** None exists; the modal animates with a FLIP transform toward the status-bar
  item's rectangle (`Element.animate`, 220 ms), skipped under `prefers-reduced-motion` (FR-054).

## R13 — Test layers

| What | Layer |
|---|---|
| Hierarchy build, roll-up, lineage, reuse guard, idle rule, bands, interval/window table, ordering, kill scope and order, friendly names, estimate arithmetic | **unit** (core, pure) |
| `NtQuerySystemInformation` parse and rates, PDH read, terminate with reuse guard, roster plumbing in the daemon, collector tick and self-exit | **integration** (real OS, real processes) |
| `resources.roster` and the collector protocol | **contract** |
| Status-bar item and overflow, modal (exclusivity, Esc/X, maximise, minimise, restore-on-reopen), keyboard navigation, filters, confirmations, ended entries, colour bands | **component** (jsdom; charts stubbed at the module seam) |
| Status bar shows real totals and the modal opens with a real terminal tree (`@core @window`); Kill All Below on a real tree (`@extended @terminal`); SC-009 calibration (`@extended`); collector leaves no orphan (`@extended @terminal`, extending `terminal-no-orphans.e2e.ts`) | **E2E** — four specs, each because a real process tree or a real window is what is under test |

SC-003 and SC-004 are measured: an integration benchmark of the collector's CPU over 60 s of summary mode
(SC-004) and a component-level long-task measurement of the modal updating a 200-process hierarchy (XII).

## R14 — The monitor window (Session 2026-10-15; supersedes R12's exclusive modal and its FLIP minimise)

**Decision.** The monitor moves out of the main window into its own `BrowserWindow`, built the way the
Preferences window is (`preferences-window.ts`) and loaded from the same renderer entry with `?monitor`:

- **Shape.** Frameless, movable, resizable, **parented to the main window** — so it minimises, restores and
  closes with it — and not modal: every throng window stays interactive (FR-081, FR-082). One instance:
  opening it again focuses it. `minimizable: false` at the OS level, as Preferences: the title bar's
  Minimise is the monitor's own (FR-085), not the OS's.
- **Layering.** Preferences' focus-scoped `alwaysOnTop` — held only while a throng window has focus —
  is extracted from `preferences-window.ts` into one shared helper both windows use, rather than copied
  (FR-083). The helper's reasoning comment moves with it.
- **Chrome.** The renderer mounts the same `TitleBar` Preferences uses, titled "Resource Monitor", with
  `showMinimise` on and its minimise click routed to the monitor's own minimise (FR-081). Maximise and
  Restore are the title bar's existing window controls — the screen, not the main window (FR-084).
- **Minimise animation.** In UI main: it asks the main window's renderer for the status-bar figures'
  rectangle, converts it to screen coordinates with the main window's content bounds and zoom factor, and
  shrinks the monitor window's bounds toward it over ~200 ms (`setBounds` steps, with `setOpacity`),
  then closes it. Under reduced motion the renderer asks for a plain close (FR-085). The renderer-side
  FLIP of R12 is retired with the modal.
- **Live data.** Unchanged in substance: detail demand is already broadcast to every window, each
  reports its own workspace, and the monitor window subscribes to detail frames as the modal did (R7).
  Changes made in throng reach it at the next capture (FR-082).
- **Remembered place and view.** The window's bounds and maximised state, and FR-057's view state, are
  held in UI main for the life of the process — the renderer is destroyed on close, so it cannot hold
  them. The view is an opaque JSON value the renderer reads on mount and writes on change; bounds are
  read on close and clamped back onto a visible display on open (FR-087).
- **Actions.** The monitor window holds no workspace, so every Destroy goes through `routeAction` to the
  window holding the tab or panel (which comes forward, R12), and **Unload Project** gains a route to the
  main window, whose renderer runs the shared `useUnloadProject` flow (FR-086). Kill is unchanged —
  confirmed in the monitor window, carried out by the collector.
- **Entry points.** The status bar, the cog item and `view.resourceMonitor` in any window call
  `resources.open()`, which opens or focuses the monitor window; the main window no longer mounts a
  modal, and `throng:resources:open-request` is retired.

**Alternatives considered.** *Keep the modal, make it non-exclusive*: still bound to the main window's
area, cannot be moved beside throng or onto another screen, and cannot stay above a sub-workspace — none
of what was asked. *Hide the window on close instead of destroying it*: keeps the view and bounds for
free and reopens instantly, but holds a whole renderer's memory for the rest of the session after one
glance, in a feature whose point is showing throng's memory; rejected.
