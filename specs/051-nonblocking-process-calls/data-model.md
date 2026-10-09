# Data Model: The Terminal Service Never Stops Answering

**Feature**: 051 | All state here is in daemon (and pty-agent) memory. Nothing is persisted.

## Session (daemon `TerminalService`) — changed

| Field | Type | Change | Meaning |
|---|---|---|---|
| `status` | `'running' \| 'exited'` | unchanged | |
| `userKilled` | `boolean` | semantics tightened | true only while an end throng asked for is in flight or has succeeded; reset when an end fails (FR-005) |
| `ending` | `Promise<void> \| null` | **new** | the in-flight end; non-null ⇔ the session is an **ending terminal** |
| `superseded` | `boolean` | **new** | the panel was given a fresh terminal while this one was ending (FR-004); its exit is not published |

### States

```text
running ──end requested──▶ ending ──exit observed──▶ exited (published: user-initiated)
                             │
                             ├─end fails / times out, not superseded, not shutdown──▶ running (FR-005; reattachable)
                             ├─end fails / times out, superseded──▶ escalated (R4) ──▶ exited (not published)
                             └─end fails / times out, shutdown or Terminate all──▶ escalated (FR-015a) ──▶ gone | logged survivor
running ──exits on its own──▶ exited (published: unexpected)
```

- An **ending** session is never returned to `attach` (FR-004). An attach for its panel moves it to the service's
  `endingSessions` set and starts a fresh session under the panel id.
- `list` reports an ending session's `status` as `running` until it settles; `busy` probes skip it (it is going).
- Shutdown ends `sessions` and `endingSessions` alike.

## EndOutcome (`terminal.killAll` result entry) — new

| Field | Type | Meaning |
|---|---|---|
| `panelId` | `string` | |
| `reason` | `string` | user-readable cause: `"did not end within 5 seconds"` or the `taskkill` failure text |

`TerminalKillAllResult` becomes `{ killed: string[]; failed: EndOutcome[] }`. `killed` keeps its meaning (ends
requested); `failed` ⊆ `killed`.

## Host session (`NodePtyHost`) — changed

| Field | Type | Change |
|---|---|---|
| `conhostPid` | `number \| null` | unchanged |
| `conhostReady` | `Promise<number \| null>` | **new** — resolves when attribution has run for this session (FR-014) |

## Pure rules (core) — new

- `assignConhosts(pending: {seq}[], conhostsInCreationOrder: number[], claimed: Set<number>) → Map<seq, pid>` —
  the newest N unclaimed hosts to the pending sessions in spawn order (moved, unchanged, from `attributeConhosts`).
- `escalationTargets(table: ProcessRow[], shellPid: number, conhostPid: number | null) → number[]` — the shell, every
  transitive descendant by ppid, and the conhost; deduplicated; never the daemon's own pid.

## Constant — new

- `TERMINAL_END_TIMEOUT_MS = 5000` (`packages/core/src/config/terminal-limits.ts`), injected as
  `TerminalServiceSettings.endTimeoutMs` (FR-013a).
