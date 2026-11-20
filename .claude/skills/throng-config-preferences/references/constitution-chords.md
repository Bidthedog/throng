# Default chords and the modifier tiers — constitution detail

Binding: constitution Principle IV (`.specify/memory/constitution.md`, *IV. Native Terminal Support & Auto-Detection › Three modifier tiers*). The
constitution keeps a one-line MUST for each rule below and points here for its detail, which was
moved verbatim from v7.4.0 at v7.4.1. This file is part of the constitution: change it only through
a constitution amendment (`throng-spec-governance`), and keep the constitution's one-line MUST in
step with it. "Above" and "below" in the text refer to this file, or to the constitution where the
rule named is not here.

## The three modifier tiers

**Three modifier tiers: `Ctrl+Shift+Alt` navigates, `Ctrl+Alt` and `Ctrl+Shift` act on the
active panel or pane, one modifier acts on the content.** A user who knows what a command does
should be able to guess its modifiers:

- **Tier 1, navigation and the application — `Ctrl+Shift+Alt+<key>`.** Moving between
  surfaces or activating one — panes, panels, tabs, projects and notices, including
  revealing or hiding a side pane — and commands that act on the whole window or the
  application, such as the window zoom.
- **Tier 2, the active panel or pane — `Ctrl+Alt+<key>` or `Ctrl+Shift+<key>`.** Commands
  that act on the panel or pane holding focus rather than on what it shows: a panel's zoom,
  its viewport.
- **Tier 3, content — one modifier (`Ctrl+`, `Alt+` or `Shift+`), or none.** Acting on the
  content a surface shows: editing, the clipboard, find and replace, save, scrollback,
  history, selection.
- The test is **what the command changes, not where it is live**.

## Tier 1 is matched on the physical key

- **Tier 1 is matched on the physical key.** Every `Ctrl+Shift+Alt` chord MUST be matched on
  the physical key (`KeyboardEvent.code`), never on the character the keypress produces, in
  every resolver and in the Key Bindings capture modal. On Windows `Ctrl+Alt` IS AltGr, and
  on some layouts (Polish among them) AltGr+Shift produces a character, so a
  produced-character match would fire on one layout and miss on the next.
  - What it costs: where AltGr+Shift types a character on a key that carries a tier-1
    default, the chord can take that character. The spec that ships a tier-1 default MUST
    name those losses on the seven common European layouts the AltGr check below names, as
    that check already requires for `Ctrl+Alt`.

## One chord per command, the keypad, and command groups

- **One keyboard chord per command, plus at most one mouse gesture.** A second keyboard chord
  for the same command is a second thing to learn and a second thing to collide. The one
  exception is `menu.open`, which keeps both `Shift+F10` and the dedicated Menu key
  (`ContextMenu`): the Menu key is a single-purpose hardware key, not a second chord.
- **The keypad `+` and `-` are the same binding as the main-row key**, never a second chord:
  every binding on `+` or `-` fires from the keypad key with the same modifiers. Every
  resolver, and the capture modal, MUST treat these keys identically wherever they sit, so a
  press is never recorded or matched differently by where the key is. They are written
  `Ctrl++`, `Ctrl+Alt++` and `Ctrl+Shift+Alt++` — the modifiers, plus the `+` key — and never
  `Ctrl+Num+` or `Ctrl+Plus`, in the docs and in the UI alike.
- **The keypad `0` is a key of its own.** `Numpad0` is a separate, physical-only match for
  every command, never folded into the main-row `0`, and is written with its name
  (`Ctrl+Alt+Numpad0`). `zoom.reset` ships `Ctrl+Shift+Alt+Numpad0` alone, so the main-row `0`
  resets no window zoom. `panel.zoomReset` ships `Ctrl+Alt+Numpad0` and the main-row
  `Ctrl+Alt+0` (046 FR-114, FR-127) — the one-chord rule's second exception after `menu.open` —
  the latter matched on the produced `0`, so an AltGr+0 that types a character never fires it.
- **A group of related commands uses one set of modifiers.** Zoom in, zoom out and zoom
  reset MUST share modifiers within each zoom, so that learning one teaches the other two.
  A group MUST NOT mix tiers.

## Outside the tiers

- **Outside the tiers:**
  - function keys (`F2`, `F3` / `Shift+F3`, `F11`, `Shift+F10`, `Ctrl+F5`), which carry
    OS and editor conventions of their own;
  - mouse gestures;
  - **multi-stroke chords** (a first stroke, then a second key, such as `Ctrl+E,W` or
    `Ctrl+M,M`), categorically: no multi-stroke chord is judged by these three tiers, and none
    needs a recorded exception for its modifiers. The terminal tiers above still apply.
    A multi-stroke chord's FIRST stroke is judged by the terminal tiers above as though it
    were the whole chord, because a pending prefix consumes that stroke. A multi-stroke
    chord whose first stroke is in the reserved tier (`Ctrl+E`, `Ctrl+K`, …) MUST NOT be
    live in any scope that includes a terminal.

## The AltGr check, and the end state

- **The AltGr check.** A `Ctrl+Alt+<letter>` or `Ctrl+Alt+<digit>` default MUST pass it: on
  Windows `Ctrl+Alt` IS AltGr, so on a layout where that key has an AltGr character, the
  character is typed and the chord never fires.
  - The spec that ships the default MUST name the common European layouts (UK, German,
    French, Spanish, Italian, Nordic, Polish) on which the chord is unreachable.
  - It MUST NOT choose a letter that is unreachable on UK or German when a free letter is
    reachable on all seven.
  - The keypad has no AltGr characters, so a tier-2 chord on `+` or `-` stays reachable
    from the keypad on a layout where the main-row key is lost.
- This is an **end-state requirement** under the Incremental Delivery rule, binding on new
  work immediately. A default that moves to meet it follows *Moving a shipped default* above.
