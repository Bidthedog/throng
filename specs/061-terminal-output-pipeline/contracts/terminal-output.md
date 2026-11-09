# Contract: Terminal Output

Changes to `packages/ipc-contract/src/terminal.ts`. The daemon and UI ship together and a daemon is reused only when
its build id matches, so these fields are required rather than optional.

## `terminal.subscribe` (main → daemon, on every events-socket connect)

```ts
interface TerminalSubscribeParams {
  /** Every view main is routing now. Replaces each session's set of output views. */
  views: { panelId: string; viewId?: string }[];
}
```

## `terminal.attach` result

```ts
interface TerminalAttachResult {
  // existing fields unchanged
  /** The session's output position at the moment `scrollback` was taken. */
  replayEnd: number;
}
```

`scrollback` holds up to 10,000 lines and 8 MB, and is `''` on the alternate screen, where `replayEnd` still reports the
current position. Any pending batch is flushed before the snapshot.

## `terminal.output` notification (daemon → main)

Sent only while the session has an output view.

```ts
interface TerminalOutputNotification {
  panelId: string;
  sessionId: number;
  /** All chunks in this delivery, concatenated. */
  data: string;
  /** Output position after the last character of `data`. Start is `end - data.length`. */
  end: number;
  /** Original chunk lengths, present only when the delivery holds more than one chunk. Sums to `data.length`. */
  lengths?: number[];
}
```

Guarantees:

- At most one notification per 17 ms per panel, except when a batch reaches 1 MB.
- For one session, `start` of each delivery equals `end` of the previous one, unless no view was attached between them.
- Output pending in a batch precedes any later `grid`, `exit`, `cwd`, `command` or `attention` for the panel.

## `throng:terminal:output` (main → window)

The notification's payload, unchanged, sent only to windows with a route for `panelId`, once per window however many views
it has.

## Preload

`terminal.onOutput` keeps its name and takes the payload above. It is called once per window, by the output router.
