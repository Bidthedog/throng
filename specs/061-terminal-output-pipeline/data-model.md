# Data Model: Terminal Output Pipeline

All state is in memory and lives no longer than its owner. Nothing is persisted.

## Daemon: session additions

| Field | Type | Rule |
|---|---|---|
| `retained` | `RetainedOutput` | Replaces `scrollback: string`. Fed every chunk, whether or not anything is shown (FR-002). |
| `outputPosition` | `number` | Code units produced since the session started. Only increases. |
| `outputViews` | `Set<viewId>` | Views wanting output. Output is published only while non-empty (FR-001a). |

`outputViews` transitions:

| Event | Effect |
|---|---|
| `terminal.attach` (reuse or cold start) | add the view |
| `terminal.detach` | remove the view |
| `terminal.subscribe` with `views` | every session's set is replaced by the views listed for its panel |
| Last events socket closes | unchanged. `views` is cleared for the grid; this set is not |

## `RetainedOutput` (`packages/core/src/terminal`)

Chunks in order, each with its line-feed count, plus running totals.

- `append(chunk)`: add the chunk, then evict from the front until at most `TERMINAL_RETAINED_LINES` lines and
  `TERMINAL_RETAINED_CHARS` characters remain. A partly evicted chunk is trimmed to just after a line feed.
- If what remains has no line feed at the cut, it is dropped to empty.
- `snapshot()`: the joined string. Called only on attach.
- `length`: characters held, for `resource-roster-service`.

## `TerminalEvents` batch, per panel

| Field | Rule |
|---|---|
| `chunks`, `chars` | Pending output. Sent at 1 MB. |
| `end`, `sessionId` | Position and session of the last pending chunk. |
| `lastSentAt`, `timer` | Quiet for 17 ms: send at once. Otherwise send when 17 ms has passed since the last send. |

Flushed before any other notification for the panel and before a replay snapshot. Removed when empty, so an idle
terminal holds no batch or timer.

## Main: `TerminalOutputRoutes`

`panelId → webContentsId → { contents, viewIds }`

- `add` before the attach RPC; `remove` on detach, on a failed attach (not `stillStarting`), and on `destroyed`.
- `viewsForSubscribe()` lists every routed `{ panelId, viewId }` for `terminal.subscribe`.

## Window: delivery ordering

`TerminalOutputGate` holds deliveries until the replay is written, then applies:

| Delivery | Action |
|---|---|
| Different `sessionId` from the attached one | drop |
| `end <= replayEnd` | drop (FR-012) |
| `start` equals the last written position | write, one `writeChunk` per entry in `lengths` |
| `start` past the last written position | log the gap, then write (FR-013) |

## Constants (`packages/core/src/terminal`)

| Name | Value |
|---|---|
| `TERMINAL_RETAINED_LINES` | 10,000 |
| `TERMINAL_RETAINED_CHARS` | 8,388,608 |
| `TERMINAL_BATCH_INTERVAL_MS` | 17 |
| `TERMINAL_BATCH_MAX_CHARS` | 1,048,576 |
| `TERMINAL_REPLAY_SLICE_CHARS` | 65,536 |
