# Contract: Config & Theme Additions (Phases B/C)

Extends the 003/004 user-config schemas (`core/config/app-settings.ts`, `theme.ts`), hot-reloaded by the
existing config watcher (`ui/src/main/config-watcher.ts` → `webContents.send('throng:config', …)` →
renderer `config-store`). Tolerant parsing: bad values fall back to defaults, never throw.

## `settings.json` → `terminals` (Phase B)

```jsonc
{
  "terminals": {
    "flavours": [                       // user-defined flavours (default [])
      { "id": "my-wsl", "label": "WSL: Ubuntu", "file": "wsl.exe", "args": ["-d","Ubuntu"], "defaultParams": "" }
    ],
    "disabledBuiltins": [],             // built-in ids to hide (default [])
    "defaultParams": {                  // per-flavour-id Startup Params override (default {})
      "pwsh": "-NoLogo"
    }
  }
}
```

**Obligations**
- New validator `terminalSettings(raw)` added to `parseAppSettings` (pattern of `explorerSettings`).
- `DEFAULT_APP_SETTINGS.terminals = { flavours: [], disabledBuiltins: [], defaultParams: {} }`.
- A malformed `flavours` entry (missing `id`/`file`) is dropped; the rest survive.
- Renderer reads via `useAppSettings().terminals`; UI main's `shell-detection-service` reads it to merge
  with detected built-ins (research D4/D5).

## Theme tokens (Phase C)

Added to `THRONG_THEME` defaults (`core/config/theme.ts`), emitted as CSS vars by `toCssVariables`:

| Token | Kind | Default intent |
|-------|------|----------------|
| `colours.terminalBg` | colour | terminal surface background |
| `colours.terminalFg` | colour | default foreground text |
| `colours.terminalCursor` | colour | cursor |
| `colours.terminalSelection` | colour | selection highlight |
| `icons.terminal` | icon | terminal/type glyph |

**Obligations**
- Missing tokens fall back to defaults via `resolveColour`/`resolveIcon` (existing). xterm.js theme is
  built from these `var(--throng-colour-terminal*)` values so theme hot-reload repaints the terminal.

## Keybindings
None required for the slice (terminal focus/typing is native to the xterm view). Future `terminal.*`
actions (clear, copy, new) would extend `keybindings.json` like 004's `file.*` — **out of scope here**.

## Tests
- Unit (core): `terminalSettings` parser — defaults, tolerant drop of bad entries, override merge.
- E2E: user-added flavour appears in the dropdown (B); theme change repaints the terminal (C).
