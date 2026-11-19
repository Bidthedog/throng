# Contract: Terminal status-bar toggles and their menu items (076)

## Status bar (`packages/ui/src/renderer/terminal/terminal-status-bar.tsx`)

```text
[ flavour label ][ link readout … ]                    [ ⟲ ][ 🗀 ][ 🔔 ]
```

- **Left group**: the flavour label and the link readout, unchanged in content. Under width pressure the readout
  shrinks and truncates first, then the flavour label (FR-007).
- **Right group** (`terminal-status-bar__toggles`): one `IconButton` per row of `TERMINAL_PANEL_TOGGLES`, in order,
  never shrinking.
  - `token`: the row's icon key.
  - `ariaPressed`: the resolved value.
  - Look (FR-002): on is the theme's full-contrast text colour on the pressed background; off is the muted text
    colour with a diagonal line struck through the glyph, drawn by CSS so any icon set gets it.
  - `title` and `ariaLabel`: `"<label>: enabled"` or `"<label>: disabled"`, plus `" (<chord>)"` when the command is
    bound — e.g. `"Terminal notifications: disabled (Ctrl+Alt+I)"`.
  - `testId`: `terminal-toggle-<id>-<panelId>`.
  - Activated by click, Space or Enter (a native button). Each flips the panel's value through `commitPanelConfig`.
- The bar is shown only when `terminals.showStatusBar` is on (024 FR-001b), as today.

## Content menu (`packages/ui/src/renderer/terminal/terminal-content-menu.ts`)

- Three checkable items in the `viewState` section, after *Refresh / redraw terminal*, in the same order, always
  present (FR-005).
  - Labels: the row labels.
  - `checked`: the resolved value.
  - `shortcut`: the bound chord, if any.
  - `testId`: `menu-item-<label>`.
  - Each runs the same flip as the toggle.

## Commands

`terminal.toggleRememberCommand`, `terminal.toggleRememberDirectory` and `terminal.toggleNotifications` run the
focused terminal panel's flip. If the focused panel is not a terminal with live toggles, the dispatcher reports the
command as unavailable (048 FR-092).

## Setup form (`terminalPanelType`)

A checkbox "Terminal notifications" (testid `terminal-notifications`) follows "Reopen in the last directory". It is
seeded from remembered memory, else from `terminals.defaultNotifications`, so it is ticked by default. `buildConfig`
writes it as `notifications: boolean`.

## Failure (FR-004)

If the immediate save fails, the stored value is reverted in the in-memory layout, so the toggle and the menu show what
is stored. A notice is raised through `notify` (030):
- severity `error`
- title "Setting not saved"
- subject: the panel
- message naming the setting
- testId `notice-terminal-toggle-failed`
