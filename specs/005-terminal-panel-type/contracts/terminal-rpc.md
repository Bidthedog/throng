# Contract: Terminal Daemon RPC + Streaming Notifications (Phase C)

Extends the existing newline-delimited JSON-RPC 2.0 over the named pipe (`daemon/src/ipc-server.ts`,
`rpc-router.ts`; `ipc-contract`). **Commands** = request/response (existing per-call sockets).
**Streaming** = JSON-RPC **notifications** (no `id`) pushed over **one long-lived "events" socket** the UI
main holds (research D10).

## Commands (request → response; method names in `ipc-contract/src/terminal.ts`)

| Method | Params | Result | Notes |
|--------|--------|--------|-------|
| `terminal.attach` | `{ panelId, projectId, launch: LaunchSpec, cols, rows }` | `{ status:'running'\|'exited', scrollback: string, exit? }` | Reattach if the registry has a live session for `panelId` (replay `scrollback`); else cold-start a PTY from `launch`. Idempotent per `panelId`: the caller's events socket is **added as a subscriber** (FR-021 mirror — many views, one session). Cold-starting the **first** terminal in a project **acquires the project-root lock** (FR-022). |
| `terminal.write` | `{ panelId, data }` | `{ ok: true }` | Write user input to the PTY. |
| `terminal.resize` | `{ panelId, cols, rows }` | `{ ok: true }` | Resize PTY to fit the panel. |
| `terminal.kill` | `{ panelId }` | `{ ok: true }` | Kill the PTY + drop the session (Panel destroy / explicit close, FR-018). Closing the **last** terminal in a project **releases the project-root lock** (FR-022). |
| `terminal.list` | `{ projectId? }` | `{ sessions: { panelId, status, busy }[] }` | Backs `panelHasRunningSubprocess` + app-close prompt. |
| `terminal.subscribe` | `{}` (sent on the events socket) | — | Marks this socket to receive notifications. |

`LaunchSpec = { file, args, cwd }` (cwd = project root). Errors use the existing JSON-RPC error envelope
(`DaemonRpcError` codes), e.g. launch failure (FR-019), unknown panel.

## Notifications (daemon → UI, no `id`, on subscribed events socket)

| Method | Params | Meaning |
|--------|--------|---------|
| `terminal.output` | `{ panelId, data }` | PTY output chunk, emitted per PTY data event (output coalescing/debounce was **deliberately not implemented** — see spec Release Status / T132). **Fans out to all subscribers** of `panelId` (FR-021). |
| `terminal.exit` | `{ panelId, code, signal?, unexpected }` | Process exited; `unexpected=true` → surface code+output (FR-017). The renderer reverts the Panel to the type-selection form (FR-020). Fans out to all subscribers. |
| `terminal.flavourMissing` | `{ panelId, flavourId }` | Persisted flavour unavailable at (re)start (FR-019 / edge case). |

## Persistent daemon & single-instance (research D9)
- The pipe name (`\\.\pipe\throng.daemon`) is the **single-instance lock**; binding fails if a daemon
  already runs. The daemon **keeps running after UI close** while any session exists.
- `health.ping` (existing) is the readiness probe the UI retries after spawning the daemon.

## Contract / integration tests (over the real pipe)
- `attach` cold-starts → `terminal.output` notifications arrive on the events socket → marker echo seen.
- Second `attach` for the same `panelId` **replays scrollback** and resumes streaming (reattach).
- `kill` → `terminal.exit`; `list` reflects removal.
- Self-exiting process → `terminal.exit { unexpected:true, code }`.
- A second daemon bind attempt fails (single-instance); `health.ping` succeeds against the first.
