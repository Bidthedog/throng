# Contract: App Lifecycle on macOS

## Start

1. `startPlatform()` selects `MACOS` and configures host traits.
2. `startupRefusal()`: running as root, or `process.execPath` contains `/AppTranslocation/` → `dialog.showErrorBox` with
   the refusal text, then `app.exit(1)`. Nothing else starts: no daemon, no collector, no window (FR-007, FR-019).
3. `app.on('open-file')` is registered before `ready`; directories queue into `OpenFolderQueue` (FR-024).
4. `commandLineInstall().status()`: `ours-broken` raises one notice with an **Install 'throng' command** action
   (FR-024a).

## Windows

`windowChrome()` options apply to every `BrowserWindow` throng creates (main, sub-workspace, Preferences, Resource Monitor,
About). The renderer hides `WindowControls` and reserves the traffic-light inset when `hostTraits().os === 'macos'`.

## Application menu (macOS)

| Menu | Items | Registered accelerators |
|---|---|---|
| throng | About throng · Settings… · Install 'throng' command / Uninstall 'throng' command · Hide throng · Hide Others · Show All · Quit throng | Cmd+H, Cmd+Option+H, Cmd+Q |
| Edit | Undo · Redo · Cut · Copy · Paste · Select All (roles) | the roles' own (Cmd+Z, Shift+Cmd+Z, Cmd+X, Cmd+C, Cmd+V, Cmd+A): macOS routes them to text fields only through a registered Edit menu, and the renderer still sees the keystroke first |
| Window | Minimise · Zoom · Bring All to Front (roles) | Cmd+M |
| Help | About throng | none |

Settings… opens Preferences. Its chord is throng's own binding, so a rebinding moves it.

## Close and quit (FR-028)

| Event | No quit in progress | Quit in progress |
|---|---|---|
| Main window `close` (red light, Cmd+W when bound to close window) | `preventDefault`, hide the window | allowed |
| `activate` (Dock click) | show the hidden main window | — |
| `before-quit` (Cmd+Q, menu, Dock Quit, logout) | `preventDefault`, run the shutdown driver (closing progress, terminals prompt, cancel) | allowed |
| Shutdown driver finishes | set `allowClose`, release the instance lock, `app.quit()` | — |
| Shutdown cancelled | clear the in-progress flag; app keeps running | — |

Windows and Linux keep today's flow, where closing the main window runs the shutdown.

## Install 'throng' command (FR-024a)

- The bundle carries `Contents/Resources/bin/throng`: a POSIX `sh` script that resolves each argument to an absolute path
  and starts `Contents/MacOS/throng` with them, detached from the terminal.
- Install: `/usr/local/bin/throng` → that script, via the system administrator prompt. `/usr/local/bin` is created when
  missing. Existing link to another target: confirm first.
- Outcomes raise one notice each: installed (with the path), declined, failed (with the reason).
- Uninstall removes only a link that points at a throng bundle.
