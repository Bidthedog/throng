# Data Model: Terminal Render & Input Fidelity (028)

No persisted schema changes. Everything below is in-memory session or view state.

## Session (daemon, existing — `terminal-service.ts`)

| Field | Change | Notes |
|---|---|---|
| `views: Map<viewId, {cols, rows}>` | unchanged | the agreed grid is the minimum across these |
| `grid: {cols, rows}` | unchanged | single authority; a view never sets its own |
| `scrollback: string` | **behaviour change** | still a bounded ~64 KB tail, but cut at a **safe boundary** so a replay never begins mid-escape-sequence |
| `status` | unchanged | a repaint on a non-running session is a no-op |

### Safe scrollback cut

`appendScrollback(tail, chunk, max)` → `string`

- Appends, then trims to at most `max` bytes.
- When trimming, advances the cut forward to the first byte **after** the next `\n`, so the retained
  tail never starts inside a CSI/OSC/DCS sequence. If no newline exists in the retained window, the
  tail is dropped to empty rather than replayed from an arbitrary offset — an incoherent replay is
  worse than none.
- Pure function in `@throng/core`; unit-tested against sequences straddling the boundary.

## Repaint (daemon, new)

A **repaint** is a grid nudge, not a state change:

```
repaint(panelId):
  session = sessions[panelId]
  if !session or session.status != 'running' → { ok: true }   # no-op, never an error
  { cols, rows } = session.grid
  host.resize(handle, cols, max(MIN_GRID, rows - 1))
  host.resize(handle, cols, rows)
```

- `session.grid` is **not** modified — the value the views hold stays true throughout.
- No `publishGrid` is emitted: the views' size never actually changed, and telling them it did would
  make each xterm resize twice for nothing.
- Rows are nudged rather than columns: a column change makes a shell reflow wrapped lines (visible
  churn); a row change does not, and a full-screen program repaints wholesale either way.

## View state (renderer, existing — `use-terminal.ts`)

| State | Change |
|---|---|
| `viewId` | unchanged — per mount, identifies this view in the session's grid set |
| mouse-reporting modes | **new** — DEC private modes 1000/1002/1003/1006 tracked at the existing `CSI ? … h/l` snoop that already drives the win32-input gate |
| buffer type | existing (`term.buffer.active.type`), now also read by the wheel decision |

## Wheel decision (pure, new — `@throng/core`)

`decideWheel({ altBuffer, mouseReporting, ctrlKey })` → `'zoom' | 'program' | 'arrows' | 'viewport'`

| altBuffer | mouseReporting | ctrl | → |
|---|---|---|---|
| any | any | yes | `zoom` (unchanged behaviour, FR-033) |
| any | yes | no | `program` — the program owns the wheel (FR-032) |
| yes | no | no | `arrows` — 3 arrow presses per notch (FR-035) |
| no | no | no | `viewport` — xterm scrolls scrollback (FR-030) |

## Diagnostics counters (renderer, new — FR-009)

One plain object per panel, integers only, no allocation per keystroke:

| Counter | Incremented when |
|---|---|
| `reconcile.attach` | a repaint is requested because a view attached |
| `reconcile.manual` | the redraw action or `Ctrl+F5` requested one |
| `reconcile.resize` / `.reattach` / `.altExit` | the corresponding trigger fired |
| `reconcile.backstop` | the periodic backstop fired |
| `input.written` / `input.acked` | a write left the renderer / the bridge acknowledged it |

Exposed on `window.__throngTerminalDiagnostics` for tests only; never rendered. FR-014b is enforced by
asserting `reconcile.backstop` did not advance during a reproduction.
