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


## R15 — Responsiveness, selection and guidance (Session 2026-10-15, second feedback)

**Measured** (a 536-node synthetic tree, ~450 processes, 150 history points per node; JavaScript work only):
`formatGrouped` costs 28 µs a call against 0.9 µs with a cached `Intl.NumberFormat`; a filter expands the
Projects subtree under Components *and* under Projects, giving 1,040 rows for 536 nodes and ~150 ms of
formatting per render; the row and tile memos never hold, because the drill callback is recreated every
render; every capture renders the breakdown twice (urgent + deferred); a new subject destroys and rebuilds
all four uPlot charts inside the click; sparklines read `getComputedStyle` and remap 150 points per row
per capture; Hide idle copies every node's full history per build though the rule reads three points.

**Defects** (labels used in tasks.md Phase 12): **D1** the filter repeats subtrees and renders
synchronously per keystroke; **D2** `formatGrouped` builds a formatter per call; **D3** memos never hold
and each capture renders twice; **D4** charts are rebuilt inside a click; **D5** sparkline, Hide idle,
chunk-loading and first-layout costs; **D6** the marked tile is not the selected node; **D7** banded tiles
lose hover and selection, and controls have no visible focus ring.

**Decisions.**
- **Cost first**: cache one `Intl.NumberFormat` per locale in core's `formatGrouped` (the constitution's
  rule is unchanged — same output, same parser); emit each node once in the filtered model; defer the
  filter's model build (`useDeferredValue` on the filter text) so the field keeps up with typing; stable
  callbacks so `Row` and `Treemap` memos hold; the shell subscribes to `frame === null` and staleness only;
  update uPlot in place (`setData`) and rebuild only when the band count changes, with bands kept in a
  stable order by id; sparklines read their colour once per capture and draw only rows in view; idle reads
  the last three points; the body chunk is imported on mount; the treemap and charts measure their box
  before their first layout; the view is saved at most every 250 ms.
- **Click model (FR-088)**: `onClick` selects (tile and row alike); a drill-down `IconButton` on the
  existing `chevron` (▸) token, Back on the existing `navigateBack`, on every tile and row with children; Enter/Right and row double-click open.
- **Order hold (FR-090)**: the model keeps the last rendered order while `pointerover` is inside the
  breakdown or a node is selected, and re-ranks on leave; tiles and rows move with a FLIP transform
  (`Element.animate`, 200 ms), skipped under `prefers-reduced-motion`.
- **Heat scale (FR-094)**: a pure core function `heatFor(metric, value, thresholds, machine, ioPeak)` →
  `0..1` plus the stop it falls between; the renderer mixes the theme's `success`, `warning` and `danger`
  with `color-mix()` in CSS from a `--heat` custom property per tile, so no literal colour exists and no
  new token is added. I/O's peak is session state in `monitor-session.ts`.
- **Guidance (FR-091 – FR-093)**: a header row (breadcrumb, Back, "Tile size: <metric>"), sticky column
  headers, a `?` icon button — one new icon token, `help`, in every default theme, with its descriptor, and
  a shipped-defaults bump (24 → 25), the additive case — opening a popover built on the shared
  floating-surface rules; the "Updated"
  line pulses with a CSS animation keyed on the tick, off under reduced motion.

**Alternatives.** Virtualising the rows list was set aside: with each node emitted once and the formatter
cached, a filtered 536-node list renders well inside SC-010, and virtualisation would break the
keyboard's roving focus and the FLIP moves. A new theme token per heat stop was set aside for
`color-mix()` over existing tokens, which keeps every theme correct without a shipped-defaults bump.


## R16 — Two columns (Session 2026-10-15, third feedback; supersedes R10's charts and treemap)

**Cause of the flashing titles.** Every row and tile carried a native `title` holding its live figures
(`valueText`, `cellTitle`); a capture changed the attribute every couple of seconds, and Chromium closes a
native tooltip whose text changes. FR-090's hold froze only the order.

**Decisions.**
- **Hold the list, not just its order (FR-095)**: on `pointerenter` the left list renders from the frame it
  had then, and adopts the latest on `pointerleave`; titles name things and never hold figures (a unit
  guard keeps it so). The right column renders from the live frame.
- **Layout (FR-096, FR-097)**: a CSS grid of two columns — the left about 45% (min 360 px), the right the
  rest — each scrolling on its own. The left column owns the breadcrumb, Back, filter, list controls and
  rows; the right column is the detail pane, extended.
- **Share bars**: plain HTML rows with a bar whose width is the child's share of the selected item for the
  chosen metric and whose fill is FR-094's `--heat` mix (the same CSS the tiles used); ranked, and held
  while pointed at like the left list.
- **Line graphs**: one per metric, the item's own series only, drawn on a small canvas the way the
  sparklines are (no axes but the current value); uPlot is no longer needed, and the treemap took
  d3-hierarchy with it — both leave the dependency list if nothing else uses them.

**Alternatives.** Keeping the treemap in the right column for the selected item's children was offered and
the user chose bars; keeping smaller stacked charts was offered and the user chose none.


## R17 — The left list, finalised (Session 2026-10-23)

**Decisions.**
- **Top level (FR-103)**: `monitor-model.ts` builds one section at the root — the components — instead of
  Components plus a pre-expanded Projects section. `share-bars.tsx`'s "is the child listed on the left"
  test and `toolbar.tsx`'s `pathTo` (used by the removed narrowing) go with it.
- **Selection (FR-098, D1)**: the selected row's rule moves after the hover rule at equal specificity
  (`.breakdown-row--selected, .breakdown-row--selected:hover`), so hovering it changes nothing; a unit
  guard on `theme.css` keeps the order. Up/Down call `setSelection` rather than moving a separate focus
  row; the right column follows.
- **Ordering (FR-099)**: each metric header is a `<button>` that sets the session's metric; the header
  line reads "Ordered by <metric>"; the toolbar group's label becomes "Order by".
- **Totals (FR-104)**: the Total row reads the listed node's own rolled-up figures — already computed —
  and counts the rows the filter, Hide idle or Hide ended removed ("includes N hidden").
- **Ended processes (FR-105)**: `hideEnded` in the session's view state, default `true`; the model drops
  ended nodes before ordering when it is on.
- **Columns (FR-106)**: a `ResizeObserver` on the list measures its width; a pure function in core
  (`fitColumns(width, columns, orderBy)`) returns the columns that fit — name always, then figures in
  order, the Order-by column kept to last — and the rest feed the header marker's title. The grid's
  template is built from the visible set, so no row can overflow; `overflow-x: hidden` is the backstop.
- **Wording (FR-107)**: `format.ts` renders `"-"` for not-measured and unavailable figures (reason in
  `cellTitle`) and `"~"` before estimates; the "estimated" tag spans go.
- **Descriptions (FR-102)**: a frozen copy table in `packages/core/src/resources/descriptions.ts`, keyed by
  component and by UI/helper role, read by the row title and the help panel.

**Alternatives.** Hiding columns by CSS container queries was set aside: the Order-by column must drop
last, which depends on state, and the header marker needs the list of what is hidden.

## R18 — Right column, Activate and layout (Session 2026-10-23)

**Decisions.**
- **Read-only children (FR-108, FR-109)**: `share-bars.tsx` loses its click handler and renders every
  figure per child (CPU, Memory, GPU, I/O, Network); the bar still follows the Order-by metric and the
  FR-095 hold stays.
- **Action bar (FR-110)**: `NodeActionBar` moves into the right column's header beside the name; it gains
  **Activate**. `RoutedAction` gains `{ kind: 'activate', projectId, tabId?, panelId? }` (a process
  resolves to its panel in the renderer); main routes it as it routes Destroy (R14): to the window holding
  the tab, else the main window for a project. The receiving window switches project, selects the tab and
  focuses the panel, and is brought forward; the monitor window's focus-scoped layering (R14) keeps it
  above. A target no window holds is disabled with FR-086's reason.
- **Divider (FR-111)**: a `role="separator"` element with `aria-valuenow`, dragged by pointer capture and
  moved by Left/Right in 5% steps; the ratio clamps so each column keeps its minimum; saved in view state.
- **Header (FR-112)**: the monitor body becomes a grid of two rows — a full-width header (filter,
  toolbar, breadcrumb) with a bottom border, and the two-column area — so the header never scrolls.

## R19 — Panel names (defect D2)

**Cause.** `estimates-sources.ts` builds each panel's name with `panelDisplayTitle(panel)` and no title
sources, so `resolveTitle` skips the 053 template and the live terminal title and falls back to the
shell's flavour label — the omission #294 fixed for panel headers. The reporter re-reports only on layout,
project and active changes.

**Decision.** Resolve with `panelTitleSources(panel)` (`use-panel-display-names.ts`), exactly as a
panel's header does, and re-report when the title, command or working-folder stores change. A component
test renames a terminal's title and asserts the reported context changes.

## R20 — Network (Session 2026-10-23, FR-113, SC-011)

**Constraint.** Windows keeps no per-process network byte counter an unelevated process can read. The
counters R3 reads (`Read/WriteTransferCount`) see file, pipe and SMB traffic; socket traffic lands in
`OtherTransferCount`, mixed with device I/O, and cannot be separated.

**Decision.** `IProcessMetrics.network(): Promise<ReadonlyMap<number, number> | Unavailable>` — bytes per
second sent plus received per pid since the last call. The Windows implementation:
- runs only when the collector is elevated (token elevation check); otherwise returns `Unavailable` with
  reason `elevation-required`, rendered "-" titled "Elevate to show";
- starts a real-time ETW session `throng-net-<collector pid>` (`StartTraceW` with
  `EVENT_TRACE_REAL_TIME_MODE`) and enables **Microsoft-Windows-Kernel-Network**
  ({7DD42A49-5329-4832-8DFD-43D979153A88}) for its TCP and UDP send/receive keywords (`EnableTraceEx2`);
- consumes it in a `worker_thread` that calls `OpenTraceW` + `ProcessTrace` synchronously; the
  `EventRecordCallback` reads the event's `PID` and `size` fields (IPv4 and IPv6 event ids 10/11,
  26/27 for TCP send/receive, 42/43, 58/59 for UDP) and adds bytes to a per-pid counter;
- each tick the main thread asks the worker for the counters and divides by the elapsed time;
- on collector exit stops its session (`ControlTraceW` STOP); on start, stops any `throng-net-*`
  session whose owner pid is no longer running (`QueryAllTracesW`), so a crash cannot leak sessions
  against the system's limit of 64.

Network rolls up like every figure (FR-022) and scales on the heat bar against the peak since the window
opened, as I/O does. A session that fails to start, or stops, makes `network()` `Unavailable` with
reason `trace-failed` ("Network unavailable").

**Validation (SC-011).** An elevated-only integration test sends a known 20 MB over loopback between two
child processes and asserts the sender's and receiver's summed bytes are within 10%. MT-14 compares a
live download with Resource Monitor. SC-004's cost benchmark runs with the session active.

**Alternatives.** `GetPerTcpConnectionEStats` needs elevation too, counts TCP only and must be enabled per
connection; `OtherTransferCount` mixes device I/O into the figure, failing FR-012; the NT Kernel Logger
would take the system's single kernel session from anything else using it.

## R21 — Panel memory against live heap (Session 2026-10-25, SC-009 amended)

**Decision.** Each panel kind's estimate is a model of what the panel retains, calibrated against the change
in live heap after a forced collection: UI main's `heapUsed + external` (two collections 250 ms apart — one
leaves a freed copy of the file in `external`), the renderer's used JS, embedder and backing-store heap over
CDP, and the daemon's `heapUsed + external` through the Node inspector (test-only; no RPC).

- **Editor**: characters, lines, Lezer `Tree` objects (~309 B) and packed buffer nodes (~69 B), and the lines
  on screen. The tree is counted by a bounded sample (≤ 100,000 nodes, scaled to the length; ~2 ms on 50 MB),
  cached by root identity, read through `ensureSyntaxTree(state, len, 0)` so a forced full parse is seen.
  Calibrated 0.95–1.02 across plain lines, paragraphs and mixed Markdown at 1, 10 and 50 MB.
- **Terminal buffers**: cells computed exactly (`lines·cols·12`, which the backing store grew by in every
  case), plus ~280 B a line, ~870 B a styled line (a 64-line sample), ~1.4 MB a terminal, and the daemon
  scrollback at ≤ 2 B a character. Calibrated 0.86–1.04 (medians of three).
- **Preview**: elements ~3.6 KB, spans ~2.6 KB, ~22 B a source character in the renderer (about 90% Blink),
  and main's copy of the text sent. Calibrated 0.87–1.10 up to 10 MB. A 10 MB preview takes 50–64 s and
  ~840 MB; 50 MB extrapolates to the renderer heap cage, so 10 MB is the stated limit — previews are refused
  over `editor.maxOpenFileBytes` (10 MiB shipped) already.

**Benchmark (three runs, every kind open together, sizes off the calibration points).** Rank agreement
(Spearman ρ) 0.89 / 0.98 / 0.96; total estimated ÷ live 0.92 / 0.94 / 0.95; per-kind shares of the total
within ~5 points (previews ~88% estimated and measured in every run). Representative relative to each
other, not exact: panels of ~2 MB (terminals, small editors) order by noise of ±0.5 MB.

**Known misses.** Mixed-Markdown editors read 1.3–1.8× in the benchmark (11.7 MB live against 22.5 MB in
calibration for the same file and node count; unexplained). A Markdown file of single-newline lines in a
narrow editor reads 0.3–0.7×. A ~2 MB terminal reads 0.7–1.4× (its constant varies ±0.5 MB). A preview under
~100 px wide costs ~2× (width is not modelled). A styled terminal at its scrollback limit moved 3.17–3.85 MB of
live heap between four runs' medians of five against one fixed estimate (Session 2026-10-29): the spread is
the bound's own size, so `kStyledLine` is centred on those runs (610 B a line) and the gate asserts the plain
and the wide terminal at the limit, logging the styled ones.

**Alternatives.** Process private bytes (the original SC-009): mostly heap headroom and parse churn — the
same 1 MB file read 19 MB or 43 MB by shape alone, terminals 13× what they hold. A characters-only editor
model: off by 2.2× between document shapes. Heap snapshots per tick: far too slow for a collector tick.

## R22 — Popover, layout and help (Session 2026-10-29)

**Decision.** Reuse `.attention-popover`'s look for the status-bar popover and the help panel and helpers:
it is the app's existing anchored popover, and the help panel's glow was the one style that matched
nothing else. The help copy and helper copy share one table. Held folders and the list share the left
column as a flex column, the list holding a floor of its fixed rows (or 10 for a growing list) and the Total
row outside its scroll. The status-bar graphs keep a bounded ring of the main window's totals since it
opened.

**Alternatives.** A native `title` (today's): it closes and reopens on every capture, which is the
complaint. A second popover style for help: two looks for one kind of surface. Measuring the left column
in script to decide heights: CSS flex expresses "yield first" directly and costs nothing per frame.
