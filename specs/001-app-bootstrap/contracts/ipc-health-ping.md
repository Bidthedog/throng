# Contract: UI↔Daemon `health.ping`

The single inter-process method in the bootstrap iteration. Proves the UI (client) and the daemon
(server) are wired together over local IPC (FR-009, US3, SC-004). No terminal or other product
behaviour travels over the channel yet.

## Transport

- **Channel**: Windows named pipe. Name is injected configuration (`IDaemonSettings.pipeName` /
  `IUiSettings.pipeName`); default `\\.\pipe\throng.daemon`.
- **Framing**: newline-delimited (`\n`) UTF-8 JSON; one JSON-RPC 2.0 object per line.
- **Protocol**: JSON-RPC 2.0 (request/response with `id`).

## Request

```json
{ "jsonrpc": "2.0", "id": 1, "method": "health.ping", "params": {} }
```

## Success response

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": { "status": "ok", "daemonStartedAt": "2026-06-25T18:00:00.000Z", "pid": 12345 }
}
```

- `status` MUST be the string `"ok"`.
- `daemonStartedAt` MUST be an ISO-8601 UTC timestamp captured when the daemon started.
- `pid` MUST be the daemon process id.

## Error / unavailable behaviour (FR-010)

- If the daemon is **not running** (pipe cannot be connected) or does not respond within
  `IUiSettings.pingTimeoutMs`, the client MUST resolve to a **daemon-unavailable** outcome and the
  UI MUST report it rather than hanging or crashing:

  ```json
  { "available": false, "reason": "daemon-unreachable" }
  ```

- If the daemon **pipe name is already in use** at startup, the daemon MUST surface the conflict
  explicitly rather than failing silently (spec Edge Case).
- Protocol-level failures use standard JSON-RPC error objects:

  ```json
  { "jsonrpc": "2.0", "id": 1, "error": { "code": -32601, "message": "Method not found" } }
  ```

## Contract tests (Principle V)

- **Integration (daemon)**: start the real daemon, connect over the real pipe, send `health.ping`,
  assert a well-formed success response (`status === "ok"`, valid `daemonStartedAt`, numeric `pid`).
- **Integration (client, daemon down)**: with no daemon listening, assert the client resolves to
  `{ available: false }` within `pingTimeoutMs` and never throws/hangs (FR-010).
- **E2E (Playwright-Electron)**: launch the app; assert the landing page reflects a successful
  ping round-trip to the running daemon (SC-004).

Tests MUST be written first and observed failing before implementation (**[Gap D]**).
