# Contract: `terminal.repaint`

**Added by**: feature 028 (#162, #163) · **Transport**: daemon JSON-RPC, same router as
`terminal.attach` / `terminal.resize` / `terminal.detach`

Force the program running in a terminal to redraw its screen, without changing anything the user can
see about the terminal's size, contents, process or focus.

## Request

```jsonc
{ "method": "terminal.repaint", "params": { "panelId": "<string>" } }
```

`panelId` — the panel whose session should repaint. No `viewId`: a repaint is a property of the
session, not of one view, and every view of it benefits.

## Response

```jsonc
{ "ok": true }
```

Always `ok`. A repaint is a best-effort nudge, never a failure the user must act on.

## Behaviour

1. **Unknown panel** → `{ ok: true }`, nothing happens.
2. **Session not running** (exited, still starting) → `{ ok: true }`, nothing happens. A repaint must
   never resurrect, re-attach or cold-start anything (Principle III).
3. **Running session** → the PTY is resized to `{cols, rows - 1}` and then back to `{cols, rows}`,
   clamped at `MIN_GRID`. The program receives two window-change signals and redraws in full at its
   correct size.

## Invariants

- `session.grid` is **unchanged** on return — the authoritative grid the views hold stays true.
- **No `terminal.grid` event is published.** The views' size did not change; announcing one would
  make every xterm resize twice for nothing.
- **No input is written to the PTY.** A redraw is never `Ctrl+L` or any other keystroke (FR-044).
- **No scrollback is dropped, cleared or replayed**, and the session's stored tail is untouched.
- Idempotent and safe to repeat: a repaint of a healthy terminal changes nothing visible (FR-046).
- Safe under concurrent output: it neither reorders nor drops bytes, because it touches only the
  window size.

## Rows, not columns

A column change makes a shell reflow its wrapped lines — visible churn the user would notice on every
tab switch. A row change reflows nothing on the normal buffer, and a full-screen program repaints
wholesale on either. `rows - 1` is therefore the smallest change that reliably triggers a redraw.

## Callers

| Caller | Trigger | Requirement |
|---|---|---|
| renderer, on attach | a view mounted and attached to a running session | FR-017/017a — a rebuilt tab is correct on arrival |
| renderer, manual | "Refresh / redraw terminal" menu item or `Ctrl+F5` | FR-040/041/049a |

## Tests

- **contract**: unknown panel → ok; exited session → ok and `host.resize` never called; running
  session → exactly two resizes, second equal to the original grid, `session.grid` unchanged, no grid
  event published, no PTY write.
- **integration**: an attach to a running session issues exactly one repaint; a repaint carries no
  scrollback side effects.
- **e2e**: switching between two differently-sized tabs leaves both terminals correctly rendered.
