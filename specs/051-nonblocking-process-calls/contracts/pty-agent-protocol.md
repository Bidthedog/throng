# Contract: pty-agent protocol (daemon ⇄ de-elevated agent)

Changes to `packages/daemon/src/pty-agent-protocol.ts`. Existing ops (`start`, `write`, `resize`, `childpids`,
`childprocs`, …) are unchanged.

## `end` (replaces `kill`)

- Request: `{ op: 'end', key, reqId, timeoutMs }`.
- Reply: `{ op: 'ended', reqId, ok: true }` or `{ op: 'ended', reqId, ok: false, reason }`.
- The agent runs `NodePtyHost.end` in its own process; the daemon's `PtyAgentHost.end` resolves or rejects on the
  reply, and rejects itself if no reply arrives within `timeoutMs` plus 1 s (the agent's own limit fires first).

## `forceEnd`

- Request: `{ op: 'forceEnd', key, reqId, timeoutMs }` → reply `{ op: 'forceEnded', reqId, survivors: [{ pid, name }] }`.
- No reply within `timeoutMs` plus 1 s resolves with an empty `survivors` and a logged warning.

## Agent shutdown

- On pipe close the agent awaits its own `NodePtyHost` shutdown (end all, escalate failures, log survivors), then
  exits. Its daemon-liveness check is unchanged.
