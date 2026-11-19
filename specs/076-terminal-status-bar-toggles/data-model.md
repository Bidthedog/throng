# Data Model: Terminal Status-Bar Toggles (076)

## TerminalPanelConfig (existing, `packages/core/src/terminal/panel-type.ts`)

Persisted in `Panel.config` inside the saved layout (project layout or sub-workspace record).

| Field | Type | Absent means | Change |
|---|---|---|---|
| `rememberCommand` | `boolean?` | `terminals.defaultRememberCommand` (039 FR-005a) | Now also written by the toggle, menu item and command |
| `rememberDirectory` | `boolean?` | `terminals.defaultRememberDirectory` (039 FR-005a) | As above |
| `notifications` | `boolean?` | `terminals.defaultNotifications` | **New** (FR-020). `true` lets the terminal raise marks, toasts and OS notifications; `false` silences it. Absent for every panel created before 076 (Clarifications Q4) |

Validation: only a real boolean counts as the panel's own value. Any other value resolves to the preference, the same
rule `readTerminalPanelConfig` applies to the other two. Nothing is written back on read (039 FR-006).

## Terminal memory (existing, `Panel.terminalMemory`)

When a terminal ends, `end()` copies the three flags' resolved values into memory, so the setup form shown afterwards
(025 FR-007a) pre-fills them. `notifications` joins `rememberCommand` and `rememberDirectory` there.

## TerminalPanelDefaults (existing, `packages/core/src/panel-type/descriptor.ts`)

Gains `notifications: boolean`. It is seeded from `terminals.defaultNotifications`.
`SHIPPED_TERMINAL_PANEL_DEFAULTS.notifications = true`.

## TerminalPanelToggle (new, `packages/core/src/terminal/panel-toggles.ts`)

| Field | Type | Notes |
|---|---|---|
| `id` | `'rememberCommand' \| 'rememberDirectory' \| 'notifications'` | Also the `TerminalPanelConfig` key it stores |
| `command` | `ActionId` | `terminal.toggleRememberCommand` / `terminal.toggleRememberDirectory` / `terminal.toggleNotifications` |
| `icon` | `IconKey` | `rememberCommand` / `rememberDirectory` / `terminalNotifications` |
| `label` | `string` | "Remember the last running command" / "Reopen in the last directory" / "Terminal notifications" |

`TERMINAL_PANEL_TOGGLES` lists the three in FR-001's order and is frozen.

## Settings (existing model, `packages/core/src/config/app-settings.ts`)

| Key | Type | Shipped | Group / subgroup | Control |
|---|---|---|---|---|
| `terminals.defaultNotifications` | `boolean` | `true` | Terminal / none — directly after `terminals.defaultRememberDirectory` | toggle |

It is parsed tolerantly like its siblings: a non-boolean keeps the fallback. It is not gated on
`terminals.attention.enabled`.

## AttentionProducerConfig (existing, `packages/core/src/attention/attention-types.ts`)

Gains `notifyByDefault: boolean`. Main pushes it with the rest of the producer config, from
`terminals.defaultNotifications`. `mergeAttentionConfig` keeps
the held value for a malformed leaf.

## Key bindings

| Action | Scope | Default (all platforms) | Group |
|---|---|---|---|
| `terminal.toggleRememberCommand` | `TERMINAL_ONLY` | none | Terminal |
| `terminal.toggleRememberDirectory` | `TERMINAL_ONLY` | none | Terminal |
| `terminal.toggleNotifications` | `TERMINAL_ONLY` | none | Terminal |

All three are members of `WINDOW_HANDLED_ACTIONS`.

## Icon keys

`rememberCommand`, `rememberDirectory`, `terminalNotifications`: new members of `ICON_KEYS`, each with default-set
art (drawn plain; the off state's struck-through line is CSS) and a description.

## State transitions: one toggle on one panel

```text
resolved = stored ?? preference
flip:    stored := !resolved          (commitPanelConfig; saved at once)
  save ok   -> toggle shows the new value; notifications→off also withdraws the panel's terminal mark
  save fails -> stored := previous (absent stays absent); toggle shows it; failure notice raised (030)
```
