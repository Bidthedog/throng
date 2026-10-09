# Contract: terminal RPCs (daemon `TerminalService`)

Only the methods whose behaviour changes. Shapes live in `packages/core` beside the existing `Terminal*Params`.

## `terminal.kill { panelId }` → `{ ok: true }`

- Returns **at once** (FR-003); the end runs in the background.
- On success the exit is published as user-initiated (005 FR-017). On failure or timeout the session becomes an
  ordinary running terminal again (FR-005); nothing is published.

## `terminal.killAll { projectId?, exceptPanelIds?, escalate? }` → `{ killed: string[]; failed: { panelId; reason }[] }`

- Starts every end in scope concurrently and resolves when all have settled — within one end limit, or two with
  `escalate`. The daemon serves every other request meanwhile (FR-001, FR-010).
- `failed` lists the ends that did not complete (FR-002, FR-005). With `escalate: true` (app-close Terminate all) a
  failed end is escalated per FR-015a before it is reported, and `failed` lists only survivors of the escalation.
- Unload passes no `escalate`. UI main's Terminate all passes `escalate: true`.
- Caller timeout: UI main uses `UNLOAD_RPC_TIMEOUT_MS` (10 s) for both callers; it must exceed two end limits.

## `terminal.closeIdle { projectId? }` → `{ closed: string[] }`

- Busy decision for every candidate from one OS read (FR-011); a failed probe counts as busy (FR-012).
- Ends idle candidates as `terminal.kill` does; returns without waiting for them.

## `terminal.list { includeBusy? }`

- `includeBusy` probes all listed sessions together (FR-011). An **ending** session reports `busy: false` and is not
  probed.

## `terminal.attach { panelId, … }`

- A panel whose session is **ending** gets a fresh session; the ending one is not reattached (FR-004).

## Daemon shutdown (not an RPC)

- `TerminalService.shutdown(): Promise<void>` — ends every session, escalates every failure (FR-015a), logs
  survivors, disposes both hosts. `main.ts` awaits it before closing the server.
