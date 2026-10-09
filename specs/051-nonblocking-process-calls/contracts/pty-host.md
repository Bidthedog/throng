# Contract: `IPtyHost` (packages/core/src/abstractions/pty-host.ts)

Changes only; every other member is unchanged.

## Removed

- `kill(handle): void` — replaced by `end`.
- `listChildPids(handle): number[]` — synchronous; replaced by the now-required `probeChildPids`.

## Changed

- `probeChildPids(handle): Promise<number[]>` — **required**. Concurrent calls share one OS read (FR-011). Rejects
  when the answer is unknown; the caller counts the terminal busy (FR-012).
- `dispose?(): Promise<void>` — async. Ends every live PTY it owns and sweeps unattributed hosts; never throws.

## Added

### `end(handle, timeoutMs): Promise<void>`

- Ends the shell's process tree and its per-terminal host process (conhost) — 005 FR-018, Principle III.
- Never blocks the caller's event loop (FR-010). Returns a promise immediately.
- Resolves once the shell's exit has been observed. A process already gone counts as ended.
- Rejects with an `Error` whose `message` is user-readable when the OS refuses the end, or when `timeoutMs` elapses
  before the exit is observed (FR-013). After a rejection the terminal may still be running.
- If the host process has not yet been identified, waits for its identification (bounded by `timeoutMs`) and ends it
  too (FR-014).
- Calling `end` twice for one handle returns the same promise.

### `forceEnd(handle, timeoutMs): Promise<{ survivors: { pid: number; name: string }[] }>`

- Escalation (FR-015a): reads one fresh process table, ends the shell, every transitive descendant by parent pid and
  the host process **individually and forcibly**, concurrently, then re-reads the table after at most `timeoutMs`.
- Resolves with whatever of those pids is still alive; never rejects (an unreadable table resolves with an empty list
  and a logged warning).

## Contract tests (`node-pty-host.contract.test.ts`, extended)

1. `end` on a shell running a long command resolves; the shell, the command and the conhost are gone.
2. `end` immediately after `start` (before attribution) leaves no conhost behind.
3. `end` on an already-exited shell resolves.
4. `end` with an injected `taskkill` that never returns rejects after `timeoutMs`, and the event loop stays free
   meanwhile (a 10 ms timer fires on schedule).
5. `forceEnd` on a tree whose middle process has exited still ends the orphaned grandchild.
6. `probeChildPids` for N handles issues one OS read.
