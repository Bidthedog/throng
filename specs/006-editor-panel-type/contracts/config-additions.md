# Contract: Config & Theme Additions (Phase A/C)

Extends the user-config schemas (`core/config/app-settings.ts`, `theme.ts`), hot-reloaded by the existing
config watcher (`ui/src/main/config-watcher.ts` → `webContents.send('throng:config', …)` → renderer
`config-store`). Tolerant parsing: bad values fall back to defaults, never throw (mirrors
`terminalSettings`).

## `settings.json` → `editor` (Phase A)

```jsonc
{
  "editor": {
    "openOnClick": "single",     // 'single' | 'double' | 'none'  (default 'single')
    "autoSave": false,           // boolean                        (default false)
    "autoSaveDebounceMs": 500,   // number ms                      (default 500, FR-060)
    "saveAllScope": "project",   // 'tab' | 'project' | 'all'      (default 'project')
    "defaultLineEnding": "lf",   // 'lf' | 'crlf' | 'cr'           (default 'lf')
    "maxOpenFileBytes": 10485760 // number bytes                   (default 10 MiB, FR-062)
  }
}
```

**Obligations**
- New validator `editorSettings(raw)` added to `parseAppSettings` (pattern of `terminalSettings`), and
  `DEFAULT_APP_SETTINGS.editor = { openOnClick:'single', autoSave:false, autoSaveDebounceMs:500,
  saveAllScope:'project', defaultLineEnding:'lf', maxOpenFileBytes:10485760 }`; also added to
  `structuredCloneSettings`.
- The **auto-save debounce** is the injected **`autoSaveDebounceMs`** setting (documented default **500 ms**;
  FR-060) and the **large-file open threshold** is the injected **`maxOpenFileBytes`** setting (documented
  default **10 MiB**; FR-062) — both sourced from config, never hardcoded in logic (Principle X).
- Unknown/invalid values fall back to the documented default per field (never throw).
- Renderer reads via `useAppSettings().editor`; the explorer honours `openOnClick`, the editor honours
  `autoSave`/`defaultLineEnding`, Save-All honours `saveAllScope`.

## Theme tokens (Phase A/C)

Added to `THRONG_THEME` defaults (`core/config/theme.ts`), emitted as CSS vars by `toCssVariables`:

| Token | Kind | Default intent |
|-------|------|----------------|
| `colours.editorBg` | colour | editor surface background |
| `colours.editorFg` | colour | default text |
| `colours.editorCursor` | colour | caret |
| `colours.editorSelection` | colour | selection highlight |
| `colours.unsavedDot` | colour | the shared unsaved dot (Panel/Tab/project) + used by the file/type pills |
| `colours.activePaneHighlight` | colour | the active-pane highlight (Files & Folders pane when active, FR-015/SC-006) |

**Obligations**
- Missing tokens fall back via `resolveColour` (existing). The CM6 theme is built from
  `var(--throng-colour-editor*)`; the shared unsaved dot uses `var(--throng-colour-unsavedDot)` so a theme
  change repaints editor + dots. The file pill reuses the existing terminal-flavour pill style/tokens.

## Keybindings (Phase A)
New `ActionId`s `editor.save` (**Ctrl+S**) and `editor.saveAll` (**Ctrl+Shift+S**) added to
`core/config/keybindings.ts` `DEFAULT_KEYBINDINGS`, dispatched in `app.tsx` **only when the active pane is
a workspace Panel** (not Files & Folders — research D7). User-overridable like other keybindings.

## Tests
- Unit (core): `editorSettings` parser — defaults, tolerant drop of bad values, per-field fallback;
  keybinding defaults present.
- E2E: changing `openOnClick`/`autoSave` takes effect (hot-reload); a theme change repaints the editor and
  the unsaved dot.
