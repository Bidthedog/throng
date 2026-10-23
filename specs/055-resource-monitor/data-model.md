# Data Model: Resource Monitor (055)

All types live in `packages/core/src/resources/` (pure) unless marked. Nothing here is persisted: every
value is recomputed each tick, and the modal's view state lives until throng restarts (FR-057).

## Raw readings (collector, per tick)

**ProcessReading** — one row of the native snapshot (R2).

| Field | Type | Notes |
|---|---|---|
| `pid` | number | |
| `ppid` | number | parent at creation; may be stale |
| `createTime` | number | exact integer (whole ms since 1601 on Windows — raw 100-ns ticks exceed 2^53); with `pid`, the **process identity** (`ProcessKey = "pid:createTime"`) |
| `imageName` | string | e.g. `node.exe` |
| `cpuTime` | number | user + kernel, 100-ns ticks, cumulative |
| `privateWorkingSet` | number | bytes |
| `ioReadBytes`, `ioWriteBytes` | number | cumulative transfer counts (R3) |

**MachineReading** — `logicalProcessors`, `installedRamBytes`, `wallTime`.

**GpuReading** — `Map<pid, percent>` (largest per-engine-type sum, R4), or `unavailable`.

**ProcessDescription** — `commandLine`, `executablePath`; read once per `ProcessKey` (R2), or
`unavailable` with a reason.

## Roster (R5) — `packages/ipc-contract/src/resources.ts`

```
ResourceRoster {
  daemonPid: number | null                // null = daemon down (FR-044)
  agentPid: number | null
  terminals: RosterTerminal[]
  locks: RosterLock[]
  ui: RosterUiProcess[]                   // from UI main
  collectorPid: number
}
RosterTerminal { panelId, projectId | null, osPid | null, conhostPid | null, attached: { pid, startedAt }[] }
RosterLock     { path, projectId, pid | null, panelIds: string[] }
RosterUiProcess { pid, role: 'main' | 'window' | 'gpu' | 'utility', label }   // label e.g. "Main window", "Preferences"
```

`osPid: null` is a terminal whose OS pid cannot be learned (agent not yet reported) — shown as a
**Limitation** (FR-080), never dropped.

## Workspace context (renderer → main → collector, R7)

```
WorkspaceContext {
  projects: { id, name, state: 'active' | 'loaded' | 'unloaded', listOrder }[]   // every project added (FR-020c)
  tabs:     { id, projectId, name, subWorkspaceName | null, mounted: boolean }[]
  panels:   { id, tabId, projectId, name, kind: 'terminal' | 'editor' | 'preview' | ..., mounted: boolean }[]
}
PanelEstimate { panelId, process: 'main' | 'renderer' | 'daemon', pid, memoryBytes, sharedWith?: panelId }
```

Sent only while a detail subscription exists, and on change — not per tick.

## The hierarchy (collector → UI)

**ResourceNode** — one node at any level.

| Field | Type | Notes |
|---|---|---|
| `id` | string | stable across ticks: `c:<component>`, `p:<projectId>`, `t:<tabId>`, `n:<panelId>`, `b:<panelId>` (Terminal buffers), `x:<ProcessKey>`, `l:<reason>` (limitation) |
| `kind` | `'root' \| 'component' \| 'project' \| 'tab' \| 'panel' \| 'buffers' \| 'process' \| 'limitation'` | |
| `label` | string | friendly name (FR-023) or the entity's name |
| `own` | `Metrics` | this node's own figures (zero for UI elements) |
| `rolled` | `Metrics` | own + every descendant's (FR-022) |
| `children` | `ResourceNode[]` | |
| `state` | `'live' \| 'ended'` | `ended` only inside a modal session (FR-065a), see below |
| `estimated` | boolean | true for panel and buffer estimates (FR-024, FR-024b) |
| `owner` | `{ component, projectId?, tabId?, panelId? }` | for detail and confirmations |
| `process?` | `{ pid, createTime, imageName, commandLine?, executablePath?, startedAt }` | process nodes |
| `projectState?` | `'active' \| 'loaded' \| 'unloaded'` | project nodes (FR-020c styling) |
| `actions` | `NodeAction[]` | computed by `actionsFor(node)`, below |

**Metrics** — each value is a number or `Unavailable { reason }` or `NotMeasured`:

| Metric | Unit | Source |
|---|---|---|
| `cpu` | % of machine | Δ`cpuTime` / (Δwall × logicalProcessors) |
| `memory` | bytes | `privateWorkingSet`, or an estimate |
| `ioRead`, `ioWrite` | bytes/s | Δ transfer counts / Δwall |
| `gpu` | % | GpuReading |

Roll-up: numbers add; `Unavailable` children contribute nothing and mark the parent's figure **partial**
(shown with its reason in the hover title, never as zero — FR-044, Edge Cases). `NotMeasured` contributes
nothing and does not mark partial (it was never part of the OS total).

**Moved, not copied (FR-024, FR-024b).** For each `PanelEstimate`, its `memoryBytes` is subtracted from
the source process node's `own.memory` (floor 0) and becomes the panel's (or buffers node's) `own.memory`.
The grand total is unchanged by the move (SC-006).

**Components** (FR-020): `UI`, `Daemon`, `Helpers` (console hosts, lock helpers, agent, resource
collector), `Projects`. Every roster process belongs to exactly one.

## Ended entries (FR-065a)

Kept in the renderer's **modal session**, not in the collector: when a process node present in the
previous detail payload is absent from the next, the session re-inserts it at its last place with
`state: 'ended'`, last figures cleared to "ended", history retained, no actions, and excluded from every
roll-up. Cleared when the modal closes. Never shown for a process the session never saw live.

## Lineage (R6)

`LineageMap: Map<ProcessKey, panelId>` in the collector. Added when a process is attributed through a
panel's tree or console; removed when its `ProcessKey` disappears from the snapshot.

## Actions (FR-062 – FR-063b)

`actionsFor(node, context)` returns, in menu order:

| Node | Actions |
|---|---|
| UI / Daemon / Helpers subtree | none |
| project | Unload Project (default row and the other-terminal-action row, 046), Kill All Below |
| tab | Destroy Tab, Kill All Below |
| terminal panel | Destroy Panel, Kill All Below |
| editor / preview panel | Destroy Panel |
| buffers | none |
| process | Kill Process, Kill All Below |

Each action carries `enabled` and a `reason` when disabled (not mounted, R12). Kill All Below is present
only when its subtree holds a live process (FR-063a). Ended nodes have none.

## Usage bands (FR-046)

`bandFor(metric, value, thresholds) → 'normal' | 'warning' | 'critical'`; CPU on % of machine, memory on
% of `installedRamBytes`, banded on the node's `rolled` figure. Colours: theme tokens `warning` and
`danger`.

## Idle (FR-061a)

A process is idle when, over its last up-to-3 samples in the modal session, own CPU < 0.1% and own I/O
= 0 in each, unless its memory is at or above the memory warning threshold. Hiding keeps an idle
ancestor of any visible node.

## Capture settings (R11)

`resolveResourceMonitorSettings(raw) → { intervalSeconds, historyMinutes, intervalRaised: boolean,
thresholds }` — the FR-004b band table; warning ≥ critical lowers warning to critical − 1. History buffer
length = `ceil(historyMinutes × 60 / intervalSeconds)` ≤ 150 points per node.

## Modal view state (FR-057), renderer module state

`{ maximised, metric, filterText, narrowTo: componentId | projectId | null, hideIdle, focusPath:
nodeId[] }` — restored on reopen; if `focusPath`'s last node is gone, the nearest surviving ancestor.

## Collector protocol messages — see `contracts/collector-protocol.md`.


## Session 2026-10-23 changes

- **Metrics** (core `hierarchy.ts`): gains `network` — bytes per second sent plus received — as a
  `Figure` like `gpu`: a number, or `Unavailable` with reason `elevation-required` or `trace-failed`.
  Rolled up like the others.
- **Monitor view state** (FR-057, FR-087): `narrowTo` removed (FR-100); `hideEnded: boolean`, default
  `true` (FR-105); `splitRatio: number` in 0.25 – 0.75, default 0.45 (FR-111). The chosen metric's
  values gain `network` (FR-099).
- **RoutedAction**: gains `{ kind: 'activate'; projectId; tabId?; panelId? }` (FR-110).
- **Component and role descriptions** (FR-102): a frozen map from component id (`ui`, `daemon`,
  `helpers`, `projects`) and role (`main`, `window`, `gpu`, `utility`, `conhost`, `lock-helper`,
  `collector`, `deelevation-agent`, `daemon`) to one or two sentences.
