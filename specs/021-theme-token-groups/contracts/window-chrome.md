# Contract — Window titles & Preferences chrome (US9, FR-033/034)

## Export (renderer `common/window-title.ts`)
- `windowTitle(middle: string): string` → `` `${middle} — throng` ``.

## Titles (suffix form; every OS `setTitle` + in-app titlebar identity routes through `windowTitle`)
| Window | Composed title |
|---|---|
| Main | `windowTitle(<project · context>[ + ' [ADMIN]' when elevated])` → `<project · context> [ADMIN] — throng` (ADMIN folded into the middle, so the title still ends ` — throng`) |
| Preferences | `windowTitle('Preferences')` → `Preferences — throng` |
| Sub-workspace | `windowTitle(`${name} · ${tabs} tabs · ${panels} panels`)`; pre-content `windowTitle('Sub-workspace')` |

## Preferences minimise removal
- `WindowControls` gains `showMinimise?: boolean` (default `true`); `TitleBar` threads it.
- `preferences-app.tsx` passes `showMinimise={false}`.
- `preferences-window.ts` `BrowserWindow` gets `minimizable: false`.
- Maximise/Restore + Close remain on all windows; Main & Sub-workspace keep minimise.

## Assertions
- Each window's composed OS title and UI identity **ends with** ` — throng` (unit on `windowTitle` + E2E per window) — including the elevated Main window, whose `[ADMIN]` marker sits before the suffix.
- Preferences titlebar renders **no** `window-min` control; the window is non-minimizable (E2E: control absent; `BrowserWindow.isMinimizable()===false`).
- Main & Sub-workspace still render `window-min`.
