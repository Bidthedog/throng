# Contract: Silencing a terminal panel's attention signals (076)

A panel whose Terminal notifications resolve off is "ignored" in the daemon and IPC names below (`ignoredOf`,
`terminal.attentionIgnored`, `panelIgnored`); those internal names were kept when the toggle was inverted
(spec Clarifications Q6).

Extends 057's `contracts/daemon-attention.md` and `contracts/app-attention.md`. Only the deltas are listed here.

## Daemon ← main: `terminal.attentionConfig` (existing method, params extended)

```ts
interface AttentionProducerConfig {
  enabled: boolean;
  signals: Record<AttentionSignalName, boolean>;
  quietMs: number;
  /** 076 FR-025: the value a panel with no `notifications` of its own resolves to; main pushes
   *  `terminals.defaultNotifications` here. */
  notifyByDefault: boolean;
}
```

The method stays idempotent. A missing or non-boolean `notifyByDefault` keeps the value already held, which is the
shipped `true` until main first pushes.

## Daemon: the publish gate (behaviour)

A signal about panel P is dropped at publish when `stored(P) ?? notifyByDefault` is `false`. `stored(P)` is P's own
`config.notifications` boolean in the saved layout (the `storedNotifications` option): the project's layout first,
then the sub-workspaces.
- A dropped signal is neither published as `terminal.attention` nor recorded in the ledger (FR-021).
- `terminal.attentionLedger` omits entries whose panel's notifications are off now.

## Daemon ← main: `terminal.attentionIgnored` (new method)

```ts
// params
interface TerminalAttentionIgnoredParams { panels: { panelId: string; projectId: string }[] }
// result
interface TerminalAttentionIgnoredResult { ignored: string[] }
```

The result holds the ids of the given panels whose notifications resolve off under the current config. Each mark
knows its project, so the daemon reads the right layout first. A `panels` that is not an array raises `-32602`, and
malformed entries are skipped. Main calls it after pushing a config whose `notifyByDefault` went true → false (the
preference `terminals.defaultNotifications` turned off), with every panel holding a terminal-producer mark, and
withdraws each returned id (FR-022).

## Renderer → main: `throng:attention:panelIgnored` (new IPC, one-way)

```ts
window.throng.attention.panelIgnored(panelId: string): void
// payload { panelId: string }
```

The renderer sends it once a toggle, menu item or command has turned the panel's notifications off and the layout save
carrying that value has resolved successfully. Main withdraws the panel's terminal-producer mark, if any. A user Flag
is left alone (057 FR-128). Clearing dismisses the toast and the OS notification (057 FR-036) and updates the ledger
mirror.
