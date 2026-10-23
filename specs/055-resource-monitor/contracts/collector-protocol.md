# Contract: resource collector protocol and the daemon roster (055)

## 1. Daemon RPC — `resources.roster`

Constant `RESOURCES_ROSTER_METHOD = 'resources.roster'` in `packages/ipc-contract/src/resources.ts`,
registered by a `ResourceRosterService` in the daemon (`router.register`), called by UI main through
`DaemonClient.call`.

- **Params**: `{}`
- **Result**: `DaemonRoster`

```
DaemonRoster {
  daemonPid: number
  agentPid: number | null                       // null when no agent is running
  terminals: { panelId, projectId: string | null, osPid: number | null, conhostPid: number | null,
               attached: { pid, startedAt }[], scrollbackChars: number }[]
  locks: { path: string, projectId: string, pid: number | null, panelIds: string[] }[]
}
```

- Pure in-memory read: MUST NOT query the operating system (no process-table read, no spawn).
- `attached` is the command poller's latest result for that panel (`[]` before the first poll), each with its epoch-ms start time (0 when unknown). The collector attributes one only when the reading's start time matches within 1 ms; an unknown time never matches, so a reused pid is never attributed or killable.
- A terminal hosted by the agent reports the OS pid the agent sent in its `started` event; `null` until
  then.
- Errors: none expected; a daemon that is down is a transport failure, which UI main turns into
  `daemonPid: null` in the merged roster.

Contract test: `packages/daemon/tests/contract/resources-roster.contract.test.ts` — shape, and
that a fake host's entries round-trip.

## 2. UI main ↔ collector — Node IPC channel

Messages are JSON objects with a `type`. The collector is started with `fork(entry, [], { execPath:
<runtime node>, serialization: 'json' })` and exits on `disconnect`.

### main → collector

| `type` | Payload | When |
|---|---|---|
| `configure` | `{ intervalSeconds, historyMinutes }` (resolved, R11) | at start and on settings change |
| `roster` | `ResourceRoster` (data-model) | before each tick: the collector asks with `needRoster` |
| `context` | `WorkspaceContext` | on change, while a detail subscription exists |
| `estimates` | `PanelEstimate[]` | each tick, while a detail subscription exists |
| `detail` | `{ on: boolean }` | when the first subscriber arrives / the last leaves |
| `kill` | `{ requestId, mode: 'process' \| 'below', nodeId, targets: ProcessKey[] }` | on a confirmed kill |

### collector → main

| `type` | Payload | When |
|---|---|---|
| `needRoster` | `{}` | at the start of each tick |
| `summary` | `ResourceSummary` | every tick |
| `detailFrame` | `{ tick, hierarchy: ResourceNode, held: HeldFolder[] }` | every tick while detail is on |
| `killResult` | `{ requestId, results: { key: ProcessKey, outcome: 'ended' \| 'gone' \| 'denied' \| 'failed', cause? }[] }` | after a kill |
| `error` | `{ cause }` | a tick that failed (`timedOut` when an OS call exceeded its limit); the previous summary — and, while detail is on, the previous frame — are re-sent with `stale: true` and `staleSince` (Edge Cases) |

```
ResourceSummary {
  tick: number, at: number, stale: boolean,
  staleSince?: number                                    // with stale: epoch ms the figures are from
  total:      { cpu, memory, gpu, ioRead, ioWrite }      // Metrics values, data-model
  components: { id: 'ui' | 'daemon' | 'helpers' | 'projects', rolled: Metrics }[]
  machine:    { logicalProcessors, installedRamBytes }
}
HeldFolder { path, projectId, panels: { panelId, tabName, panelName }[] }
```

### Rules

- **Kill authorisation (FR-062).** The collector honours a `kill` only for `targets` it finds under the
  `Projects` component in its latest hierarchy and still alive with the same `ProcessKey`; anything else
  returns `denied` without touching the process. `below` kills leaves first (R8).
- **Cadence.** One tick at a time: a tick that overruns the interval delays the next one; ticks never
  overlap. `detail {on}` runs a tick at once, and every mode keeps each process's previous reading, so
  the first detail frame already has rates (SC-002).
- **Liveness.** The collector exits within 1 s of `disconnect`. UI main restarts a collector that exits
  unexpectedly, at most once per minute, and reports a stopped collector as stale figures (FR-044).
  UI main renumbers ticks so they keep increasing across a restart, and fails a kill still pending
  when the collector exits as `collectorUnavailable`.
- **Bounded OS calls.** Every snapshot, GPU read, describe and terminate has a time limit (5 s). A
  timed-out snapshot fails the tick (stale, as above); a timed-out GPU read is unavailable; a timed-out
  describe is remembered with its reason; a timed-out terminate is `failed`, cause `timedOut`.
- **Daemon unreachable.** UI main keeps the last good daemon roster and sends it with
  `daemonStaleSince`; the collector marks its figures `stale` from that time rather than detaching
  every terminal (FR-021, FR-044).
- **Estimates in every mode.** UI main sends its own and the daemon's estimates every tick, and the
  renderers' while a monitor is open; the collector moves only an estimate whose panel it places, so
  the grand total never changes (FR-024, FR-042).

Contract test: `packages/ui/tests/contract/collector-protocol.contract.test.ts` — every message type
validates against the shapes above, both directions.


## Session 2026-10-23 changes

- Each detail and summary tick reads `IProcessMetrics.network()` alongside `gpu()`; per-process
  `network` joins the snapshot row and rolls up in core. The summary sent to the status bar ignores it
  (FR-113: the status bar is unchanged).
- The collector owns the ETW session's lifetime (R20): started at its first detail tick when elevated,
  stopped on disconnect or exit, stale `throng-net-*` sessions stopped at start.
