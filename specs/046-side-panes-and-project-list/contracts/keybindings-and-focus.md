# Contract: Commands, Chords and Focus

Covers FR-010 – FR-027 and FR-070. The reasoning is in [research.md](../research.md) R1 – R6.

## 1. Commands

| ActionId | Scope | Windows default | Menu route | Effect |
|---|---|---|---|---|
| `project.next` | EVERYWHERE | Ctrl+Alt+PageDown | Cog → Navigate → Next Project | `switchProject(stepProject(reachable, active, +1))`. Does nothing when the result is `null` |
| `project.previous` | EVERYWHERE | Ctrl+Alt+PageUp | Cog → Navigate → Previous Project | as above, with `-1` |
| `focus.explorer` | EVERYWHERE | Ctrl+Alt+F | Cog → Navigate → Focus File Explorer | Reveals the right pane, sets `ActivePane = files`, and focuses the tree's selected node, or its first node, or the empty placeholder when no project is open |
| `focus.projects` | EVERYWHERE | Ctrl+Alt+P | Cog → Navigate → Focus Projects | Reveals the left pane, sets `ActivePane = projects`, and focuses the active project row, or the first row, or the create control when there are no projects |
| `zoom.reset` | EVERYWHERE | Ctrl+0, **Ctrl+Shift+0**, Ctrl+MiddleClick | unchanged | unchanged |

**Every command MUST**

- be consumed in capture phase and never reach xterm, CodeMirror or a find input (FR-010, FR-027);
- raise no notice when it does nothing (FR-011);
- leave the Projects pane's visibility unchanged when it cycles (FR-013);
- apply a rebinding without a restart (FR-022). The handler already reads the live keybindings.

**Guards a unit test MUST assert** (FR-020)

- None of the new default chords is in `RESERVED` or `SHADOWABLE`
  (`packages/core/tests/unit/terminal-reserved-keys.test.ts`).
- `SHADOWABLE_EXCEPTIONS` in `packages/core/tests/unit/keybindings.test.ts:132` still has exactly four
  entries.
- No chord resolves to two commands in one scope (`keybindings-collision.test.ts`).

## 2. Chord matching (FR-026)

`chordCandidates(e): Token[]` (`packages/ui/src/renderer/config/chord-key.ts`):

1. If `/^Digit[0-9]$/.test(e.code)`, `e.ctrlKey` is true and `e.altKey` is false, emit
   `Ctrl[+Shift]+<digit>`. Shift is kept.
2. Always emit the produced token, built exactly as today: `chordKey(e)`, with the existing Shift
   rule.
3. Duplicates are removed. The resolver takes the **first** candidate that names a command live in
   the current scope.

**Example cases** (the unit table asserts at least these):

| Layout | Keys | `e.key` / `e.code` | Candidates | Resolves to |
|---|---|---|---|---|
| US | Ctrl+Shift+0 | `)` / Digit0 | `Ctrl+Shift+0`, `Ctrl+)` | zoom.reset |
| US | Ctrl+0 | `0` / Digit0 | `Ctrl+0` | zoom.reset |
| US | Ctrl+Shift+= | `+` / Equal | `Ctrl++` | zoom.in (unchanged) |
| Swiss DE | Ctrl+Shift+1 (`+`) | `+` / Digit1 | `Ctrl+Shift+1`, `Ctrl++` | zoom.in (unchanged) |
| Czech | Ctrl+Digit1 (`+`) | `+` / Digit1 | `Ctrl+1`, `Ctrl++` | zoom.in (unchanged) |
| German | Ctrl+ß (Minus code) | `ß` / Minus | `Ctrl+ß` | nothing (unchanged; the Minus key is not a digit) |
| German | AltGr+0 (`}`) | `}` / Digit0, ctrl+alt | `Ctrl+Alt+}` | nothing. `}` is typed (Alt exclusion) |
| AZERTY | AltGr+à (`@`) | `@` / Digit0, ctrl+alt | `Ctrl+Alt+@` | nothing. `@` is typed |
| US | Ctrl+Alt+0 | `0` / Digit0 | `Ctrl+Alt+0` | panel.zoomReset (unchanged) |
| US-Intl | Ctrl+Alt+P (`ö`) | `ö` / KeyP | `Ctrl+Alt+ö` | nothing. `ö` is typed (FR-021) |

*Superseded (Session 2026-09-25, FR-114): the `Ctrl+Alt+0` row above is stale. `panel.zoomReset`
no longer resolves from the main-row `0` at all — it binds to **Ctrl+Alt+Numpad0**
(`e.code === 'Numpad0'`), plus `Ctrl+MiddleClick` unchanged. A `Ctrl+Alt+0` press (main-row) now
resolves to nothing, the same as any other command a user has not bound to `0`.*

**The capture modal** records `candidates[0]`, so Ctrl+Shift+0 is recorded as `Ctrl+Shift+0`.
`packages/ui/tests/shared/window-chords.ts` mirrors the same function. It does not re-derive it.

## 3. Focus model (FR-015 – FR-018, FR-024)

- `ActivePane ∈ {files, workspace, projects}`. It becomes `projects` on `pointerdown` or `focusin`
  inside the Projects panel, and `files` on the same two events inside the File Explorer.
- **Outline**: the active pane's body carries `--active`, drawn as the `panes.css` `::after`
  overlay in the project colour. There is exactly one outlined pane at a time.
- **Scope**: `projects` gives the scope `projects`, and only `EVERYWHERE` commands are live there.
  `file.*`, `editor.*` and `search.*` are all dead in it.
- `focus.left`, `focus.right`, `focus.up`, `focus.down` and `focus.cycle` are unchanged. They move
  between panels of the active tab only, and from a side pane they land in the workspace as they do
  today (FR-024).
  *Superseded for the four directional commands by FR-122 (iterate round 4, 2026-09-26):* they act
  only while the workspace holds the active pane; from a side pane the chord is consumed and does
  nothing. `focus.cycle` is unchanged. **Outline** above now also means FR-121: while a side pane
  holds the active pane, no workspace panel carries the active-panel outline.

**Projects tree keys** are handled by the component and are not rebindable (R4):

| Key | On a project row | On a non-default category header | On the default header |
|---|---|---|---|
| ArrowUp / ArrowDown | move focus one row | move focus one row | move focus one row |
| Home / End | first / last row | same | same |
| Enter | `switchProject(id)` | toggle minimise | nothing |
| Space | nothing | toggle minimise | nothing |
| Shift+F10 / ContextMenu | row menu ([menus.md](./menus.md)) | header menu | header menu (Rename only) |
| Escape (menu open) | close the menu and return focus to the row | same | same |

Moving focus never switches project (FR-018). A minimised category's hidden projects are not rows,
so no key can reach them (SC-007).

## 4. Iterate round 1 (checkpoint 2026-09-24; spec FR-082, FR-087, FR-101 – FR-110)

Supersedes §1's default column and menu-route column, and extends §2. The defaults themselves are in
[data-model.md](../data-model.md) §4 ("Defaults superseded at the iterate round 1 checkpoint").

**§1, menu routes.** None of the four commands has a menu route (FR-074). They stay in the Key
Bindings editor; `focus.explorer` and `focus.projects` are listed in **Focus & Zoom** (FR-087).

**§2, tier-1 physical matching (FR-104).** `chordCandidates(e)` gains a first rule, ahead of the
digit rule:

1. If `e.ctrlKey && e.shiftKey && e.altKey && !e.metaKey`, emit exactly one physical token,
   `Ctrl+Shift+Alt+<k>`, where `<k>` comes from `e.code`: `KeyA`–`KeyZ` → the letter,
   `Digit0`–`Digit9` → the digit, `Equal` / `NumpadAdd` → `+`, `Minus` / `NumpadSubtract` → `-`,
   `Numpad0` → `0`, and a named key (`ArrowLeft`, `PageDown`, …) → its name. The produced token is
   **not** emitted for a tier-1 event.
   *Superseded (Session 2026-09-25, FR-114, further amended by convergence T168): `Numpad0` no
   longer maps to `0` here. A tier-1 `Ctrl+Shift+Alt+Numpad0` press emits its own
   `Ctrl+Shift+Alt+Numpad0` token, distinct from `Ctrl+Shift+Alt+0`, for every command — not folded
   into the digit rule.*
2. The `AltGraph` decline (`e.getModifierState('AltGraph')`) is a **hypothesis** (research R22).
   It ships only after a test at the lowest layer that observes the real modifier state settles it;
   until then no decline is coded.
3. The FR-026 digit rule (Ctrl, no Alt) and the backtick rule are unchanged. Ctrl+Alt without Shift
   stays on the produced character, except the FR-105 same-binding rule below.

**Same binding for `+`, `-`, `0` (FR-105).** Every resolver treats `Equal`+Shift, `NumpadAdd`,
`Minus`, `NumpadSubtract`, `Digit0` and `Numpad0` as the `+`, `-` and `0` keys of the chord, so
`Ctrl+Alt++` also matches Ctrl+Alt on the `=` key without Shift. No `Numpad…` token is ever
emitted, recorded or shipped.

*Superseded (Session 2026-09-25, FR-114, further amended by convergence T168): `Numpad0` is
dropped from the `0` group above. Every resolver still treats `Equal`+Shift, `NumpadAdd`, `Minus`
and `NumpadSubtract` as the `+` and `-` keys of the chord, unchanged. `Digit0` alone is the
main-row `0` key; `Numpad0` is a separate physical token, emitted and recorded (never folded into
`0` / `Digit0`), for **every** command. `zoom.reset` and `panel.zoomReset` are the only commands
that SHIP a default written as `Numpad0` (`Ctrl+Shift+Alt+Numpad0`, `Ctrl+Alt+Numpad0`); any other
command a user binds to `Ctrl+Alt+0` fires only from the main-row key.*

**Every resolver** (FR-104): the window listener (`app.tsx`), `editor-chrome.tsx`,
`search-keybindings.tsx`, the preview dispatcher and the capture modal all take their tokens from
`chordCandidates`, so the rule is written once.

**Two-stroke chords (FR-091, FR-092).** A binding token may be `<stroke> <stroke>` (`Ctrl+E W`).
Parse, format, normalise, collisions (a first stroke that is also a whole single-stroke chord in an
intersecting scope), reset and upgrade treat it as one binding. It may only be bound to a command
whose scope contains no `terminal`. In an editor the pending prefix shows an indication, ends on
the second stroke, Escape (consumed, closes nothing), focus leaving, or 4 s; an unbound second
stroke is consumed and reported as unbound. `toCodeMirrorKey` bridges it to CodeMirror's native
prefix keymap (research R19).
*Superseded for the notation and the matching by FR-124 (iterate round 5, 2026-09-26):* the token
is `Mods+K1,K2` (`Ctrl+E,W`), one continuous press, the modifiers held through both keys and matched
exactly as pressed; releasing a first-stroke modifier ends the prefix silently. A legacy space-form
token normalises to the comma form; shipped-defaults version 15 moves an untouched `Ctrl+E W`. The
capture box records on the release of every key and has no two-stroke control. Scope, collisions,
the indication and the endings above stand. FR-125: every panel type registers a focus target.

**Gestures (FR-106).** `Ctrl+WheelUp` / `Ctrl+WheelDown` / `Ctrl+MiddleClick` resolve to
`panel.zoomIn` / `zoomOut` / `zoomReset` for **the panel under the pointer** (its panel type's
zoom), are consumed everywhere (no scroll, no Chromium page zoom), and dispatch nothing over a
surface with no panel zoom, where they are still consumed *(derived: an unconsumed Ctrl+wheel there
would reach Chromium's page zoom)*. They never change the window zoom.

**`isPanelScoped` audit (FR-110).** Every EVERYWHERE `ActionId` is either exempt (a window command)
or on an explicit deliberately-panel-scoped list with its reason; `menu.open` is classified
explicitly by that test.

**§3, focus after a list switch (FR-082).** A click or Enter on a project row switches project and
leaves `ActivePane = projects`, with DOM focus on the chosen row. `PanelFocusSync` does not claim
the workspace for a list-initiated switch. `project.next` / `project.previous` leave the active
pane where it was. The workspace becomes active only on the existing routes into it (pointer-down,
`focus.*`), and the Ctrl+S reach fixed by `52d8f13d` still holds there.

## 5. Iterate round 3 (2026-09-25; spec FR-116 – FR-118, supersession S27)

Supersedes §1's default column again for `focus.explorer` and `focus.projects`, and §4's defaults
(via [data-model.md](../data-model.md) §4) for `focus.notice`, `view.toggleProjects` and
`view.toggleExplorer`. Adds one command. Nothing above is deleted; where a chord above disagrees with
this section, this section is current.

**§1, commands.** A fifth command joins the four:

| ActionId | Scope | Windows default | Menu route | Effect |
|---|---|---|---|---|
| `focus.workspace` | EVERYWHERE | Ctrl+Shift+Alt+N | none (keyboard-only) | Takes `activeFocus()`. When it returns null (no active project, no active tab, or a tab with no panel) it does nothing and raises no notice. Otherwise it calls `goToPanel(tabId, activeId)` **unconditionally**: `ActivePane = workspace`, the outline and keyboard scope move to that panel, and DOM focus goes to its input surface. It does not skip when the target is already the active panel, because that is the case it exists for. It switches no tab, panel or project, and changes neither side pane's visibility |

It is listed in the Key Bindings editor under **Focus & Zoom** as *Focus Workspace*, with a
description that names no chord (FR-119). Constitution v5.6.0 Principle VI's "a chord MAY stand
without a menu item" is what allows it no menu route.

**§1, defaults.** The Windows defaults are now (FR-117), all tier 1 and matched on the physical key
(§4, FR-104):

| ActionId | Before (v13) | Default |
|---|---|---|
| `focus.projects` | Ctrl+Shift+Alt+P | **Ctrl+Shift+Alt+B** |
| `focus.workspace` | — | **Ctrl+Shift+Alt+N** |
| `focus.explorer` | Ctrl+Shift+Alt+F | **Ctrl+Shift+Alt+M** |
| `view.toggleProjects` | Ctrl+Shift+Alt+B | **Ctrl+Shift+Alt+J** |
| `view.toggleExplorer` | Ctrl+Shift+Alt+N | **Ctrl+Shift+Alt+K** |
| `focus.notice` | Ctrl+Shift+Alt+M | **Ctrl+Shift+Alt+V** |

`Ctrl+Shift+Alt+F` and `Ctrl+Shift+Alt+P` are unbound. `project.next` / `project.previous`,
`tabs.openPicker`, the directional `focus.*` and the zoom commands keep their §4 / FR-114 chords.
§2's US-Intl `Ctrl+Alt+P` row is unaffected (it is a produced-character, non-tier-1 case); the
tier-1 `Ctrl+Shift+Alt+P` no longer takes US-International `Ö`, because nothing is bound to it.

**§1, guards.** The three guards above still hold for the new chords: none of `Ctrl+Shift+Alt+J`,
`+K`, `+V` is in `RESERVED` or `SHADOWABLE`, `SHADOWABLE_EXCEPTIONS` is unchanged, and no two
defaults share a chord, since B, N and M change owner in the same change (research R22's
iterate-round-3 check).

**§3, focus model.** FR-024 is unchanged: `focus.left/right/up/down/cycle` still never reach a side
pane and none is widened to leave one. `focus.workspace` is the keyboard route from a side pane back
to the workspace (FR-116). It is a window command for `isPanelScoped` through its `focus.` prefix,
and the §4 FR-110 audit classifies it, so it fires from a focused terminal or find bar and the chord
reaches neither the shell nor the editor (FR-010).

**Saved bindings (FR-118).** `SHIPPED_DEFAULTS_VERSION` 14 moves the five rows above only where the
saved array still equals a named earlier shipped value (version 11, 12 or the new `V13_KEYBINDINGS`),
under FR-108's collision guard unchanged, and writes `focus.workspace: []` where N would collide
with a binding that stays. The detail is in [data-model.md](../data-model.md) §4.
