# Research: Terminal Status-Bar Toggles (076)

The spec carries no open questions after the 2026-11-18 and 2026-11-19 clarification sessions. This file records the design decisions
the plan rests on, each against the code it was read from.

## R1 — One toggle shape, declared once in core

**Decision**: A frozen table `TERMINAL_PANEL_TOGGLES` in `packages/core/src/terminal/panel-toggles.ts`, one row per
toggle, in FR-001's order: the stored key on `TerminalPanelConfig`, the global preference it resolves to, the icon key,
the command id and the label. A pure `resolveTerminalToggles(config, defaults)` returns each toggle's effective value,
and `terminalToggleTitle(label, on, chord?)` builds the title and accessible name ("Remember the last running command:
enabled", or "Terminal notifications: disabled (Ctrl+Alt+I)" with a chord bound).

**Rationale**: The status bar, the content menu, the key-binding dispatch and the setup form all need the same three
rows in the same order. One table makes FR-001's order and FR-002's naming one fact, and a unit test over it covers
every consumer. `readTerminalPanelConfig` already resolves `rememberCommand` and `rememberDirectory` against
`TerminalPanelDefaults` (039 FR-005a). It gains `notifications` the same way, so read-side resolution
(Clarifications Q4) stays in one function.

**Alternatives considered**: Hard-coding three buttons in `terminal-status-bar.tsx`. Rejected because the menu, the
commands and the form would then each restate the order and the labels.

## R2 — The global default: `terminals.defaultNotifications`

**Decision**: The new preference lives at `terminals.defaultNotifications`, label "Terminal notifications by default",
in the Terminal group directly after `terminals.defaultRememberDirectory`, in no subgroup, as a toggle shipped `true`.
It is not gated by `terminals.attention.enabled`: the edge case "The toggle and the attention master switch" says the
value is still shown and stored while attention is off. `TerminalPanelDefaults` gains `notifications`, seeded from it
in `panel-type-form.tsx` beside the existing three seeds, and `SHIPPED_TERMINAL_PANEL_DEFAULTS` gains the shipped
value. `panel-type-defaults-match-settings.test.ts` already pins the two together.

**Rationale**: It is a New Panel seed like `defaultRememberCommand` and `defaultRememberDirectory`, so it sits with
them and is named like them (Clarifications Q6). Main maps it onto the producer config's `notifyByDefault` in
`pushConfig`, and `AttentionService.onSettingsChanged` pushes when it changes as well as when `terminals.attention`
does, so the daemon learns a new default with one added comparison.

**Alternatives considered**: A negative "ignore" preference under `terminals.attention`, shipped off in the
Attention subgroup, as first specified. It travelled with the existing `terminals.attention` push for free, but a negative toggle read the opposite
way to its two neighbours on the status bar; the maintainer inverted it on 2026-11-19 (Clarifications Q6).

## R3 — Where the silencing decision is taken: the daemon's `publish`

**Decision**: `TerminalAttention` gains an option `storedNotifications(subject) => boolean | undefined`. It returns
the panel's own `notifications` from the saved layout, or `undefined` when the panel holds none or cannot be found.
`AttentionProducerConfig` gains `notifyByDefault`. In `publish()`, the one choke point every signal passes through
after rate limiting, a signal whose panel's notifications resolve off (`!(stored ?? notifyByDefault)`; internally
"ignored") is dropped. The drop applies both to live delivery and to the detached ledger (FR-021, 057 FR-066).
`readLedger` also drops entries for panels whose notifications are off now. The composition root wires
`storedNotifications` with the same layout lookup `resolveNames` already uses: the project's layout, then the
sub-workspaces.

**Rationale**:
- FR-021 requires the decision "where 057 decides a mark". That is the daemon, the only process that sees a signal when
  no window is open.
- The daemon already holds every layout. `resolveNames` reads one per published signal, so checking at `publish`
  rather than at `raise` adds no layout read per bell in a storm: `limit()` coalesces those first.
- Checking at publish also covers a signal pending in a rate window when the panel's notifications turn off.

**Alternatives considered**:
- (a) The renderer pushes each panel's value to the daemon on attach and on toggle. Rejected: a panel in a project no
  window shows never mounts, so the preference changing could not reach it.
- (b) An in-daemon index of every panel's value, rebuilt on each `workspace.save`. Rejected: it adds a cache and a
  second copy of layout state to keep coherent, and it saves nothing measurable over the existing per-publish lookup.
- (c) Deciding in main's `AttentionService.onSignal`. Rejected: main never sees a detached signal, and FR-021 forbids
  that split.

## R4 — Freshness: the toggle saves at once

**Decision**: The workspace store gains `commitPanelConfig(panelId, patch): Promise<boolean>`. It applies the patch
exactly as `updatePanelConfig` does, then saves the resulting layout immediately rather than after the autosave
debounce (400 ms), and resolves to whether `workspace.save` succeeded. The toggles, the menu items and the commands all
write through it.

**Rationale**: R3 reads the saved layout, so a value still waiting out the debounce would not yet govern the daemon.
Saving at once closes that window to one IPC round trip. It also gives FR-004 something to observe: the save's outcome.
Today's `trackLayoutSave` swallows every error by design (019 FR-010), so no existing route could report a failed write.

**Known bound**: A panel confirmed from the setup form with Terminal notifications unticked is saved by the ordinary
debounce. A signal in
its first 400 ms resolves by the preference. A shell's first output is never a signal: Unseen output skips the first
chunk (057 R4). Only a startup command that exits or rings within 400 ms could slip through. It is recorded here rather
than special-cased.

## R5 — Withdrawing marks when a panel's notifications turn off (FR-022, SC-004)

**Decision**: Two triggers, one model operation, `AttentionModel.withdrawPanel(panelId)`. It clears only a `terminal`
producer mark on that panel and leaves a user Flag (057 FR-128). Clearing goes through `removeWhere`, so the existing
`onCleared` path dismisses the toast and the OS notification (057 FR-036), and the ledger sync follows.

1. **Toggle or menu or command turning Terminal notifications off.** Once `commitPanelConfig` resolves `true`, the
   renderer sends `attention.panelIgnored(panelId)` (preload → `throng:attention:panelIgnored`). Main calls
   `AttentionService.panelIgnored(panelId)`, which withdraws.
2. **The preference turning off.** `onSettingsChanged` sees `terminals.defaultNotifications` go true → false. It
   awaits `pushConfig`, then asks the daemon `terminal.attentionIgnored { panels }` for every panel holding a terminal
   mark, and withdraws each id the daemon returns (the panels whose notifications now resolve off). Only the daemon can say which panels hold no value of their own (Clarifications Q4).

**Rationale**: In case 1 the renderer knows the answer, so no round trip is needed. In case 2 only the daemon does.
Sending the message after the save lands means any mark raised before the daemon saw the new value is withdrawn rather
than racing it.

**Alternatives considered**: The daemon pushes a "now silenced" notification after every layout save. Rejected: the
daemon would have to diff every saved layout against the last to find the panels that changed.

## R6 — Commands with no default chord

**Decision**: Three new action ids: `terminal.toggleRememberCommand`, `terminal.toggleRememberDirectory` and
`terminal.toggleNotifications`.
- Each is `TERMINAL_ONLY` in `COMMAND_SCOPES` and has an empty default binding on every platform.
- Each has a descriptor in `keybindings-metadata.ts` (group Terminal, "Unbound by default.").
- Each joins `WINDOW_HANDLED_ACTIONS`, so the window dispatcher takes a user's chord in the capture phase, ahead of
  xterm. A multi-stroke rebind then works too: `WINDOW_MULTI_STROKE_ACTIONS` is that same set.
- `runAction` resolves the focused panel the way `panel.destroy` does and runs that panel's toggle through a per-panel
  registry (`terminal/terminal-toggle-registry.ts`). It reports `'unavailable'` when the panel is not a terminal or has
  no live toggles.
- The Key Bindings editor's existing validation keeps reserved terminal keys out (constitution IV).

**Rationale**: FR-006 asks for exactly this, and `editor.toggleWhitespace` (059) is the precedent for an unbound
toggle. Window handling is the existing route by which a chord a user binds never reaches the shell.

## R7 — Icons

**Decision**: Three new icon keys from Lucide (069's default set, `lucideVersion` in `SOURCES.json`):

| Key | Lucide glyph |
|---|---|
| `rememberCommand` | `history` |
| `rememberDirectory` | `folder-clock` |
| `terminalNotifications` | `bell`, plain (the off state's struck-through line is CSS, FR-002) |

Each gets its art in `default-set/`, its `SOURCES.json` entry, its row and description in `icon-keys.ts` and the
README, and a regenerated `default-icon-set.generated.ts` (`npm run generate:icons`). Pressed state uses the existing
`IconButton` `ariaPressed` styling (as `whitespace` does), with the on glyph in the full-contrast text colour and the
off glyph muted and struck through by CSS (FR-002), so a user's icon set needs no crossed variant. No theme colour
token is added, so `SHIPPED_DEFAULTS_VERSION` does not move: icon art has not been a theme leaf since 069.

## R8 — The setup form

**Decision**: `terminalPanelType` gains a `notifications` checkbox input, labelled "Terminal notifications" (testid
`terminal-notifications`), ticked by default, after Reopen in the last directory.
- Its seed follows the existing two: remembered memory wins, else the preference.
- `buildConfig` writes it as an explicit boolean.
- `end()` carries it into `terminalMemory` beside the other two flags, so the empty state shows it (025 FR-007a).

## R9 — Effect on a running terminal (FR-011)

**Decision**: `terminal-panel.tsx` already recomputes `terminalConfig` from `panel.config` on every render. The capture
in `end()` and the two persistence effects read it, and `end` is rebuilt when it changes. `onExit` reaches `end`
through a callback that `useTerminal` holds, so the plan reads the current config through a ref at the moment of the
decision rather than trusting the callback identity. A unit test drives a flip between mount and end.

## R10 — Test altitude

- **Unit**: the toggle table and resolution; settings descriptor and default; keybinding descriptors and scopes; the
  daemon's publish gate and ledger filter; `AttentionModel.withdrawPanel`; `AttentionService.panelIgnored` and the
  default-off path; the content-menu builder; the form descriptor's seed and build.
- **Component**: the status bar's toggles (order, pressed state, title, accessible name, keyboard, narrow width); the
  terminal panel wiring a flip to `commitPanelConfig` and to `panelIgnored`; the failed-write revert and its notice;
  the setup form's checkbox.
- **Integration**: none. Two real sessions through the real `TerminalService` and RPC router, one of them silenced,
  are a unit test over the shared attention harness (tasks.md, T022 note).
- **E2E**: none. Restart persistence is the layout's ordinary save and load, already proven for every
  panel-config field. The new write is component-tested, so no assertion needs a real window (tasks.md, T031 note).
