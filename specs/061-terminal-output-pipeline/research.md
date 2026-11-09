# Research: Terminal Output Pipeline

Findings read from the code on the rebased branch (2026-11-08). Paths are project-relative.

## R1. What counts as "shown"

- **Decision**: A terminal is shown by a window exactly when that window has a mounted view of it.
- **Rationale**: `tab-group` renders only the active tab's tree (028), so a mounted view means an active tab
  or a sub-workspace. Focus Mode (054) leaves a maximised panel in the split tree and lifts it with CSS
  (`maximise-layer.tsx`), so its siblings stay mounted, which is what FR-001 asks for.
- **Alternatives**: A separate visibility signal from the renderer. Rejected: a second source of truth that
  attach and detach already provide (FR-003).

## R2. Gating output in the daemon, and surviving a dropped socket

- **Decision**: Each session gets `outputViews`, a set of view ids, kept apart from the grid's `views` map.
  `terminal.attach` adds to it, `terminal.detach` removes from it, and output is published only while it is
  non-empty. `terminal.subscribe`, sent on every events-socket connect, now carries the views main is routing
  and replaces every session's `outputViews`.
- **Rationale**: `session.views` cannot be the gate. `forgetViews()` clears it whenever the last events socket
  closes, and main's `DaemonEvents` reconnects 500 ms later with its windows still mounted and no re-attach.
  Output flows today only because it is unconditional; gating on `views` would silence every open terminal
  after one socket blip (FR-005a). Clearing `views` stays correct for the grid.
- **Ordering**: Main records a route before it sends `terminal.attach`, so any attach already sent appears in
  the list a later `terminal.subscribe` carries. A subscribe cannot erase a view it did not know about.
- **Alternatives**: A boolean "keep publishing" flag set on reconnect. Rejected: with two windows, the first
  detach would clear it and silence the second. Re-attaching every view on reconnect. Rejected: it rebuilds
  and repaints every terminal for a blip the user never noticed.

## R3. Routing in main and in the window

- **Decision**: Main holds `panelId → webContents` routes and sends output only to those windows. `grid`, `exit`,
  `cwd` and `command` stay broadcast. In the window, one `bridge.onOutput` listener feeds a
  `panelId → view callbacks` router (FR-007).
- **Rationale**: Routes must exist before the attach RPC (R2), so `trackView`, which runs after it resolves, is
  moved ahead of it and is released if the attach fails outright. A `stillStarting` result keeps the route:
  the view is still mounted and will detach when it unmounts. `trackView`'s `destroyed` backstop then also
  releases routes (FR-004).

## R4. Positions, and replay without gap or duplicate

- **Decision**: Each session counts UTF-16 code units of output from zero. Every delivery carries `sessionId`
  and `end`, its position after its last character; `start` is `end - data.length`. `terminal.attach` returns
  `replayEnd`. A view drops deliveries from any other session, drops those ending at or before `replayEnd`, and
  writes the rest. The batch is flushed before the snapshot is taken, so a delivery cannot straddle `replayEnd`.
- **Rationale**: Replay and live output travel on different sockets (`output-gate.ts`), so order alone cannot
  separate them. A delivery's `sessionId` is needed because a panel id outlives its sessions (051 MT-01).
- **Gap handling (FR-013)**: A delivery whose `start` is past the last written position is logged and written.
  The only known trigger is a socket blip, where the same loss happens today. Rebuilding a view for it would add
  a recovery path with no other caller (Principle VIII).

## R5. What is kept: lines, with a character ceiling

- **Decision**: A new `RetainedOutput` in `packages/core/src/terminal` holds a list of chunks with their line
  counts, evicting from the front, trimming to a line boundary. Limits are 10,000 lines and 8 MB of characters
  (`TERMINAL_RETAINED_LINES`, `TERMINAL_RETAINED_CHARS`). The string is joined only when a view attaches.
- **Rationale**: `appendScrollback` concatenates, slices and scans the whole tail on every chunk. That is fine at
  64 KB and is an O(tail) copy per chunk at 10,000 lines, in the process hosting every terminal. A line limit alone
  is not a bound: a progress bar rewriting one line with `\r` never adds a line, hence the ceiling. 8 MB leaves
  about 800 characters a line for 10,000 lines of styled output.
- **Kept**: the existing rule that a retained window with no line break is dropped to empty rather than replayed
  from an arbitrary offset (`scrollback-tail.test.ts`), and alt-screen replay staying empty (FR-014).
- **Panel**: `new Terminal` gets `scrollback: TERMINAL_RETAINED_LINES` (xterm's default is 1,000). xterm allocates 12
  bytes a cell as lines arrive, so a full 120-column panel is about 14 MB and a short session costs far less.
- **Line meaning**: The daemon counts line feeds; xterm counts rows, and a wrapped line takes several. A panel holds
  the newest 10,000 rows of what is replayed, so heavily wrapped output shows slightly fewer logical lines.

## R6. Replay must be sliced in the window

- **Decision**: The replay is written to xterm in 64 KB slices, one `term.write` each. `replayingTail` stays true until
  the last slice's callback. `.xterm-screen` is held at `opacity: 0` until then.
- **Rationale**: xterm's `WriteBuffer` yields after 12 ms only *between* writes, and `InputHandler.parse` handles one
  string to the end. Today's single `term.write(res.scrollback)` is harmless at 64 KB and would block the window for
  the whole parse at megabytes (Principle XII). A parser is stateful across writes, so slicing anywhere is safe. Slicing
  is also the "in batches" the user asked for on return to a tab (FR-015).
- **Opacity, not visibility**: `focusIfActive` runs right after the writes are queued, and a `visibility: hidden`
  element cannot take focus. Without hiding it, a replay scrolls past visibly on each tab switch.
- **Alternatives**: Streaming the replay as many RPC messages. Rejected: reintroduces the ordering problem, and the
  blocking cost is in the parse.

## R7. Batching: where and how

- **Decision**: One coalescer, per panel, in `TerminalEvents` (daemon → main). The first chunk after a quiet window is
  sent at once. Later chunks gather until 17 ms have passed since the last send, or until 1 MB. Any other notification
  for that panel (`grid`, `exit`, `cwd`, `command`, `attention`) flushes first (FR-024), and so does taking a replay
  snapshot (R4).
- **Rationale**: This hop pays a `JSON.stringify`, a socket write and a parse per chunk, and every later hop inherits its
  message rate. Sending the first chunk at once means an echo gains nothing (SC-005). 17 ms is what keeps a stream at or
  under 60 messages a second (SC-004); at 16 ms it would be 62.5. Worst-case wait is therefore a little over 17 ms,
  which is why SC-005 was raised from 16 ms to 20 ms. The 1 MB cap reaches the message limit only above 60 MB/s.
- **Alternatives**: Batching in main as well. Rejected unless measurement shows need; one hop keeps FR-024 in one place.

## R8. Keeping screen-clear detection exact

- **Decision**: A batch keeps its chunk boundaries. A delivery has `data` plus `lengths` when it holds more than one
  chunk, and the view runs `writeChunk` once per original chunk.
- **Rationale**: `isScreenClear` counts erases in one chunk against the row count. Counted across a batch, several
  PSReadLine partial redraws add up to a false clear and wipe the scrollback. Keeping boundaries makes FR-022's "same
  result as chunk by chunk" true by construction, including the 600 ms resize suppression. FR-022's older hazard (a
  clear wiping output later in the batch) is already handled by `withScrollbackDrop`, which inserts the erase after
  the last clear.
- **Alternatives**: Detecting clears in the daemon. Rejected: it lacks `term.rows`, `resizedAt` and buffer type.

## R9. #162: proving the cause

- **Decision**: Reproduce first, in one Playwright spec launching Electron with `--force-device-scale-factor` at 1.25,
  1.5 and 1.75, maximised, comparing the last row's bounding box with the panel's. Then fix.
- **Rationale**: FR-040 needs real layout at a fractional scale, which jsdom does not have, and the switch does not depend
  on a monitor. The hypothesis is that `fit.proposeDimensions()` divides by a cell height the rendered rows do not match.
- **If confirmed**: `applyResize` clamps rows using the rendered row height (one batched read, FR-041) as a pure function,
  and a `matchMedia` resolution listener re-measures on a scale change (FR-042). Reported through the existing resize
  path, so 008's minimum-grid rules are untouched (FR-043).
- **If not confirmed**: FR-044 applies, and the real cause is added to the spec before any fix.

## R10. Measurement

- **Decision**: A Playwright script in `packages/ui/tests/measure/`, with its own config, outside the E2E lanes, tags and
  budget. It records what FR-060 lists, once before any change and after each landing (FR-061), on the maintainer's Linux
  workstation, and results go in the spec with the machine and load.
- **Rationale**: A measurement is not a pass/fail gate. SC-001 and FR-062 do not need it: they are proven by counting
  frames in a daemon integration test and sends in a unit test of main's routes.
- **Limit**: The Background figures came from Windows. The harness runs on either OS, but only Linux numbers are planned.

## R11. GPU renderer

- **Decision**: Evaluated last, on the workstation, with `@xterm/addon-webgl` at the version matching xterm 6. It is
  added as a dependency only if SC-006's 20% is met. The result is recorded in the spec either way.
- **Rationale**: Hosted runners have no GPU, so CI cannot answer this.
