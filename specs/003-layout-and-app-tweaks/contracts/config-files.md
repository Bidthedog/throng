# Contract — User Config Files (`%USERPROFILE%\.throng\`)

Human-editable JSON, owned by UI main, hot-reloaded. Missing → created from defaults; malformed →
last-good/defaults (never crash). All three are validated by pure schema code in `@throng/core`.

## Files

```
%USERPROFILE%\.throng\
├── settings.json          # AppSettings (data-model §2)
├── keybindings.json       # Keybindings (data-model §3)
└── themes\
    └── throng.json        # default Theme (data-model §4)
```

## settings.json (shape & defaults)

```json
{
  "version": 1,
  "appearance": { "theme": "throng" },
  "confirmations": { "destroyProject": "double", "destroyTab": "single", "destroyPanel": "single" },
  "panes": {
    "sidebar":      { "visible": true,  "width": 260 },
    "fileExplorer": { "visible": false, "width": 320 }
  }
}
```
- `confirmations.*` ∈ {`none`,`single`,`double`} (Tab/Panel treat `double` as `single`).
- `panes.*.width` positive; clamped to the pane minimum on use.
- Unknown keys preserved on rewrite where feasible; absent keys defaulted.

## keybindings.json (shape & defaults)

```json
{
  "version": 1,
  "bindings": {
    "zoom.in":         ["Ctrl+=", "Ctrl++", "Ctrl+WheelUp"],
    "zoom.out":        ["Ctrl+-", "Ctrl+WheelDown"],
    "zoom.reset":      ["Ctrl+0", "Ctrl+MiddleClick"],
    "view.fullscreen": ["F11"]
  }
}
```
- Keyboard chords use `Ctrl/Shift/Alt + <key>`; mouse-zoom gestures are the named tokens
  `Ctrl+WheelUp`, `Ctrl+WheelDown`, `Ctrl+MiddleClick`. Unknown action ids ignored.

## themes/throng.json (shape)

```json
{
  "name": "throng",
  "colours": { "surface": "...", "surfaceActive": "...", "text": "...", "accent": "...",
               "danger": "...", "railBg": "...", "border": "..." },
  "fonts":   { "family": "...", "baseSizePx": 13, "weights": { "normal": 400, "bold": 600 } },
  "icons":   { "destroy": "...", "collapse": "...", "expand": "..." }
}
```
- Renderer maps colours/fonts → CSS custom properties (`--throng-*`); missing tokens fall back to
  throng defaults. `surfaceActive` = active-panel highlight; `danger` = destroy buttons.

## Hot-reload contract

- On any change under `%USERPROFILE%\.throng\`, UI main re-reads + validates the changed document
  and pushes it to all renderer windows; the renderer re-applies (theme/keybindings/settings)
  **without a restart**, within ~500 ms.
- A malformed save keeps the previously-applied config and surfaces a non-fatal notice.
