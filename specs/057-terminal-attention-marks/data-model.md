# Data Model: Panel Attention Marks and Terminal Attention Signals

**Feature**: [spec.md](./spec.md) · **Research**: [research.md](./research.md)

All types below live in `@throng/core` unless stated. Nothing is stored in SQLite. The only durable
copy is the daemon's in-memory attention ledger (R9), which lives as long as the daemon does.

## AttentionSignal (terminal producer → main)

What the daemon reports. One per recognised event, after the 250 ms per-panel-per-signal rate limit.

| Field | Type | Notes |
|---|---|---|
| `panelId` | string | |
| `projectId` | string | from the daemon session |
| `signal` | `'processExited' \| 'commandFinished' \| 'bell' \| 'notification' \| 'progressEnded' \| 'unseenOutput' \| 'outputQuiet'` | the setting keys' names |
| `kind` | `'attention' \| 'failed'` | Failed for a non-zero exit or a progress error |
| `detail` | string \| null | exit code, command name, or sanitised notification message (FR-068) |
| `startup` | boolean | `commandFinished` of a startup command (R8) |
| `panelTitle` | string | resolved by the daemon from the panel's layout through core's `panelDisplayTitle` over its stored layout, falling back to "Terminal" (FR-015, FR-033) |
| `projectName` | string | resolved by the daemon from its project store |
| `at` | number | epoch ms |

## AttentionMark (main's state, broadcast to renderers)

At most one per panel (FR-002).

| Field | Type | Notes |
|---|---|---|
| `panelId` | string | key |
| `projectId` | string | moves with the panel (edge case "panel moved"): a FocusReport hosting the panel under another project updates it |
| `panelTitle`, `projectName` | string | from the signal; a FocusReport hosting the panel updates them to the live title |
| `producer` | `'terminal'` | FR-008 withdraw is per producer |
| `kind` | `'attention' \| 'failed'` | sticky Failed: `failed` if either the old or new raise is failed |
| `reason` | `{ signal, detail }` | the most recent raise |
| `raisedAt` | number | the most recent raise |
| ~~`armed`~~ | ~~boolean~~ | **Retired by FR-095.** Was: true when the mark existed as its panel became active (R6); only an armed mark cleared on the dwell |
| `dwellStartedAt` | number \| null | set while its panel is attended (focused panel, workspace pane, focused window — FR-004); null otherwise (FR-095) |

**Transitions**

```
raise(signal):
  if panel is attended (focused panel in a focused window) → ignored (FR-004)
  else if no mark → create { kind, reason, armed: false }
  else → reason := signal's; kind := failed if either is failed; armed unchanged

panelBecameActive(panel):          mark.armed := true; dwell starts if its window is focused
panelLostActive(panel):            dwellStartedAt := null (armed stays; re-armed on next activation)
windowFocusChanged(window, f):     dwell pauses (f=false) or resumes counting from 0 (f=true) for armed marks only
panelFocused(panel):               clear (FR-005)
tick(now): armed && dwell ≥ clearDelay → clear (FR-006)
withdraw(producer):                clear every mark that producer raised (FR-063)
restore(entries):                  reinstate ledger marks; a mark on the attended panel starts its dwell at once
```

**Superseded by FR-095** (2026-10-19, round 2): being active no longer arms or clears a mark, and
focusing the panel no longer clears it at once. The transitions above that name `armed`,
`panelBecameActive`, `panelLostActive` and `panelFocused` are kept as history. They are replaced by:

```
settle(now): for each mark — attended → dwellStartedAt := dwellStartedAt ?? now; else dwellStartedAt := null
tick(now):   dwellStartedAt !== null && now − dwellStartedAt ≥ clearDelay → clear (FR-095)
panelDestroyed / projectDeleted:   clear, no notification (FR-007)
```

`clear` dismisses the panel's toast and closes its OS notification (FR-036).

## Holder state (derived, never stored)

| Holder | Marked when | Kind |
|---|---|---|
| Panel header | the panel has a mark | the mark's |
| Tab chip | any panel in `collectPanels(tab.root)` is marked | failed if any is failed |
| Tab-strip overflow control (left/right) | any hidden tab on that side is marked | same rule |
| Project row | any mark with that `projectId` | same rule |
| Minimised category header | any project in the category is marked (visible row or not, FR-013) | same rule |
| Taskbar badge | count of marks across all projects (FR-039), "9+" above 9 | same rule |

Tooltip and accessible name (FR-015): one line per marked panel beneath the holder:
`<Panel title> — <project>: <reason label>[ '<detail>'] (<Kind>)`.

## FocusReport (renderer → main)

Sent on any change, coalesced to one per animation frame.

| Field | Type |
|---|---|
| `windowId` | number (webContents id) |
| `windowFocused` | boolean |
| `focusedPanelId` | string \| null (keyboard focus inside a panel in the workspace pane) |
| `hostedPanels` | `{ panelId, projectId, title }[]` (panels in the window's current layout, with their live title) |

## AttentionLedger (daemon)

`Map<panelId, AttentionLedgerEntry>`, bounded at 1,000 entries (oldest dropped).

| Field | Type | Notes |
|---|---|---|
| `panelId`, `projectId`, `kind`, `reason`, `raisedAt` | as AttentionMark | |
| `panelTitle?`, `projectName?` | string | so a restored mark keeps its names |
| `whileDetached` | boolean | the signal arrived while no events socket was attached (FR-066) |

Replaced in full by `terminal.attentionSync`; entries with `whileDetached` survive a sync until main
has read them once. Dropped on throng-initiated kill and project delete.

## AttentionProducerConfig (main → daemon)

| Field | Type |
|---|---|
| `enabled` | boolean |
| `signals` | `Record<Signal, boolean>` |
| `quietMs` | number |

## Settings

| Key | Type | Default | Bounds |
|---|---|---|---|
| `attention.clearDelayMs` | integer | 1000 | 0–10000, step 100 |
| `attention.taskbarBadge` | boolean | true | |
| `notifications.os` *(round 4, FR-109)* | boolean | true | |
| `notifications.<error\|warning\|info\|success>.os` *(FR-110)* | boolean | false | |
| `notifications.attention.mode` *(FR-111)* | `'never' \| 'timed' \| 'dismiss'` | `'timed'` | |
| `notifications.attention.timeoutMs` *(FR-111)* | integer | 10000 | 3000–30000, step 500 |
| `notifications.attention.os` *(FR-111)* | boolean | true | |

*Round 4 retired `attention.delivery.*`, `attention.toasts.*` (FR-103) and `attention.osNotifications`, none of which shipped.*
| `terminals.attention.enabled` | boolean | true | |
| `terminals.attention.signals.processExited` | boolean | true | |
| `terminals.attention.signals.commandFinished` | boolean | true | |
| `terminals.attention.signals.bell` | boolean | true | |
| `terminals.attention.signals.notification` | boolean | true | |
| `terminals.attention.signals.progressEnded` | boolean | true | |
| `terminals.attention.signals.unseenOutput` | boolean | false | |
| `terminals.attention.signals.outputQuiet` | boolean | false | |
| `terminals.attention.quietSeconds` | integer | 10 | 10–600, step 10 |

## Round 12 (2026-10-24)

- `AttentionMark.producer`: `'terminal' | 'user'` (FR-125). A user mark keeps `'user'` whatever raises on it later (R20).
- `AttentionMark.heldSinceRaise: boolean` — true from a manual flag until its panel is first unattended; no clear dwell while true (FR-127). Restored flags are unheld.
- `AttentionFlagEntry` = `{ panelId, projectId, panelTitle, tabTitle, projectName, raisedAt }`, one row per flagged panel in SQLite `attention_flag` (migration v11), keyed by `panelId`; deleted when the mark clears, the panel is destroyed or the project is deleted (FR-128, R19).
- Holder state gains `count`: the number of marked panels beneath it (FR-131).
