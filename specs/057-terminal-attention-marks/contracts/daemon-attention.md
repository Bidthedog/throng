# Contract: daemon ↔ main (attention)

Added to `packages/ipc-contract/src/terminal.ts`. JSON-RPC over the existing daemon pipe. Types per
[data-model.md](../data-model.md).

## Notification `terminal.attention`

`TERMINAL_ATTENTION_NOTIFICATION = 'terminal.attention'`, params `AttentionSignal`.

- Written to every subscribed events sink, like `terminal.exit`.
- At most one per `(panelId, signal)` per 250 ms. Within that window the last signal wins, and
  `failed` is sticky.
- Never emitted while `AttentionProducerConfig.enabled` is false, or for a signal switched off.
- `processExited` only when the exit is `unexpected` (R7). `terminal.exit` is unchanged.
- `commandFinished` only on a command→null transition (FR-065), with `startup` per R8.
- Never emitted while no sink is attached. The signal goes to the ledger with `whileDetached: true`
  instead (FR-066).

## Request `terminal.attentionConfig`

`TERMINAL_ATTENTION_CONFIG_METHOD`. Params `AttentionProducerConfig`, result `{ ok: true }`.
Idempotent. Main sends it once after `terminal.subscribe` and again on every settings change that
touches `terminals.attention.*`. Until the first call the daemon uses the shipped defaults.

## Request `terminal.attentionLedger`

`TERMINAL_ATTENTION_LEDGER_METHOD`. No params. Result `{ entries: AttentionLedgerEntry[] }`. Clears
the `whileDetached` flag on every entry it returns.

## Request `terminal.attentionSync`

`TERMINAL_ATTENTION_SYNC_METHOD`. Params `{ entries: AttentionLedgerEntry[] }`, the full set main
holds for the terminal producer. Replaces the ledger, except `whileDetached` entries main has not
read yet. Debounced by main to at most one call per 250 ms.

## Request `terminal.attentionFocus`

`TERMINAL_ATTENTION_FOCUS_METHOD` (FR-099). Params `{ attended: string[] }`, the whole set of panel
ids main judges attended (FR-004). Result `{ ok: true }`. Main sends it whenever the set changes and
on every (re)connect, whatever the attention settings say, with at most one call in flight; changes
made meanwhile go out as the latest set once it is answered.

The daemon writes `CSI O` to each session whose program has focus reporting on (DEC 1004) when its
panel leaves the set, and `CSI I` when it returns, never repeating the state it last wrote. A program
that turns 1004 on is assumed to believe it is focused, so if its panel is not attended it is told
`CSI O` at once. When the last events socket goes, the set is treated as empty. These writes go
straight to the PTY and never clear `startupPending`.

## Behaviour on existing calls

- `terminal.kill`, `terminal.killAll` and `killForProject` drop the affected panels' ledger entries.
- `terminal.write` clears the session's `startupPending` flag (R8).

## Contract tests

`packages/ui/tests/contract/daemon-attention.contract.test.ts` (or the daemon package's integration
suite, whichever owns the RPC round-trip today). It covers each method's shape, the rate limit, the
ledger across a detach and reattach, and the absence of emission when disabled.
