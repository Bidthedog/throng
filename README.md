# throng

[![CI](https://github.com/Bidthedog/throng/actions/workflows/ci.yml/badge.svg?branch=master)](https://github.com/Bidthedog/throng/actions/workflows/ci.yml?query=branch%3Amaster)
[![Release](https://github.com/Bidthedog/throng/actions/workflows/release.yml/badge.svg)](https://github.com/Bidthedog/throng/actions/workflows/release.yml)
[![Latest release](https://img.shields.io/github/v/release/Bidthedog/throng?include_prereleases&sort=semver&label=release&color=blue)](https://github.com/Bidthedog/throng/releases/latest)
[![v1.0.0 progress](https://img.shields.io/github/milestones/progress-percent/Bidthedog/throng/1?label=v1.0.0)](https://github.com/Bidthedog/throng/milestone/1)
[![Platform](https://img.shields.io/badge/platform-Windows%2011-0078D4)](#platform-support)
[![License](https://img.shields.io/badge/license-AGPL--3.0-blue)](LICENSE)

throng is a modern **project-first, terminal-second, agent-third** desktop app for running many
independent command-line terminals across cleanly isolated projects. Each project binds to a
root folder and a colour; you lay its workspace out as a VS Code-style dock of tabs and split
panels, browse and edit its files in a live tree, and run real installed shells inline as **Terminal
panels** whose processes are owned by a detached background daemon — so they keep running when
the UI closes and reattach when you reopen.

throng was born out of a life-long frustration of having to manage dozens of windows during complex 
development workflows - IDEs, terminals (including multi-terminal emulators) and folders -
recently exacerbated by the adoption of modern, multi-tasking agentic workflows.

This project was made possible in an incredibly short amount of time by harnessing the power of AI.

## Who it's for

throng is built for **power users** — developers who want full command-line control of a
project *and* a visual representation of it, with everything in one place and easy to reach.
If you routinely run half a dozen terminals in different shells for a single project, alongside
a scatter of (often tabbed) folders, VS Code, and a handful of other apps, throng's
goal is to pull all of that into a single, simple customisable workspace.

## Platform support

> **Windows only today** (Windows 11 is the first-class target). **macOS
> ([#22](https://github.com/Bidthedog/throng/issues/22)) and Linux
> ([#23](https://github.com/Bidthedog/throng/issues/23)) are planned.** The OS boundary is
> abstracted so they can be added without reworking the core, but no macOS/Linux build ships yet.

## Highlights

- **Projects** — isolated per-project contexts, each bound to an exclusive root folder and a colour;
  create, edit, switch and reorder them, stored locally per user.
- **Dockable workspace** — three collapsible panes, unlimited tabs and drag-to-split panels; the full
  per-project layout is saved and restored every session.
- **Multi-window sub-workspaces** — tear tabs or panels off into separate OS windows that stay in
  sync and move as one focus group.
- **Terminal panels** — PowerShell, Git Bash, CMD and custom shell flavours run inline on **detached,
  daemon-owned PTYs**, so they survive a UI restart and reattach with their scrollback.
- **Editor panels** — a CodeMirror editor that preserves encoding and line endings, shares one buffer
  per file across every window, and recovers in-progress edits *and their undo history* after a crash.
- **Code editing** — syntax highlighting for 31 languages, rectangular selection, whole-line cut and
  paste, and indentation that follows the file's own style rather than a house one.
- **File explorer** — a live, project-scoped file tree with rename, move, copy, Recycle-Bin delete and
  per-project hiding, all undoable with Ctrl+Z and persisted across restarts.
- **In-panel search** — one find bar that adapts to the active panel: find and replace in an editor,
  and a read-only scrollback search in a terminal that never types at the shell.
- **Focus and zoom** — one visible active panel per window, movable from the keyboard, with text zoom
  set independently per panel and panel names that are unique across the whole application.
- **Preferences** — a single window with visual Settings, Key Bindings and Themes editors: typeahead
  search, immediate apply, a raw-JSON toggle that applies when you leave it, and reset scopes from
  one item up to everything.
- **Themes and icon packs** — 14 bundled themes plus hot-reloading, user-editable theme, keybinding
  and icon-pack files that re-skin the whole application live, with contrast guarded automatically.
- **Failures that name their cause** — errors say what is actually holding a locked file, raise one
  message per underlying problem, and leave a daemon-restart control in the status bar if it stops.

This list is throng as it exists today. **What's planned lives in the
[issue tracker](https://github.com/Bidthedog/throng/issues)**, grouped by
[milestone](https://github.com/Bidthedog/throng/milestones) — there is no separate roadmap
document to fall out of date.

## Architecture

An npm-workspaces monorepo whose packages map to the constitution's boundaries:

| Package | Role |
|---------|------|
| `@throng/core` | Platform & process-agnostic core: the OS-abstraction interfaces (shell detection, PTY host, directory lock, filesystem, platform/user/display info), typed settings, and the pure domain (projects, docking model, panel types, terminal logic). No OS/Electron/process calls. |
| `@throng/platform-windows` | Windows implementations of the core seams (shell detection, node-pty/ConPTY PTY host, directory lock, …), verified against `core`'s contract suites. |
| `@throng/persistence` | Embedded SQLite (better-sqlite3) with a `user_version` migration runner and drift repair — projects, per-project layouts, sub-workspaces. |
| `@throng/ipc-contract` | Shared JSON-RPC message types (`health.*`, `projects.*`, `workspace.*`, `subworkspaces.*`, `terminal.*`, `files.*`). |
| `@throng/daemon` | The headless, long-lived background process; single SQLite writer and owner of all terminal PTYs. Hosts the named-pipe JSON-RPC router and a streaming events socket. |
| `@throng/ui` | The Electron client. The renderer is a React 18 + Vite docking app (xterm.js, react-arborist, `@dnd-kit`); the main process owns windowing and bridges the renderer to the daemon. |

The renderer never touches SQLite or the OS directly: renderer → preload `contextBridge` → UI
main → daemon over a Windows named pipe (newline-delimited JSON-RPC 2.0), with terminal output
streamed back over the daemon's events socket. Terminals live in the daemon so closing the UI
never kills them.

## Prerequisites

- **Node.js 20 LTS.** `better-sqlite3` and `node-pty` ship prebuilt binaries (no native
  toolchain), and the daemon builds against host Node 20 — no `electron-rebuild`.
- **Windows 11** (see [Platform support](#platform-support)).

## Commands

Root npm scripts, run from the repository root:

| Goal | Command |
|------|---------|
| Install / build | `npm install` · `npm run build` |
| Run everything (daemon + UI) | `npm start` |
| Run daemon / UI alone | `npm run start:daemon` · `npm run start:ui` |
| All tests | `npm test` |
| One layer | `npm run test:unit` · `test:integration` · `test:contract` · `test:e2e` |

Quick start:

```bash
npm install && npm run build && npm start
```

The UI opens to the docking workspace in a few seconds. Create a project, add tabs, split
panels, browse the file tree, and confirm a **Terminal** panel to get a live shell at the
project root. Stop the daemon with `Ctrl+C` (graceful shutdown releases the pipe and reaps
its terminals).

**New to the app?** [`docs/quick-start.md`](docs/quick-start.md) walks through it properly —
first launch to a working project, with the default key bindings.

### Installing a packaged build

throng ships as a **self-contained per-user Windows installer** (no admin, no prerequisites) — see
[`docs/installation.md`](docs/installation.md) to download, verify the checksum, install, upgrade and
uninstall, and [`docs/releasing.md`](docs/releasing.md) for how a build becomes a versioned, verified,
published release. The running app shows its version, build id and licence in **Help → About throng**
(reached from the title-bar cog menu).

## Configuration

No value is hardcoded in business logic; all are injected typed settings with documented
defaults, overridable via environment variables:

| Setting | Env var | Default |
|---------|---------|---------|
| Daemon/UI pipe name | `THRONG_PIPE_NAME` | `\\.\pipe\throng.daemon` |
| Database path | `THRONG_DATABASE_PATH` | `%APPDATA%\throng\throng.db` |
| Window size | `THRONG_WINDOW_WIDTH` / `THRONG_WINDOW_HEIGHT` | `1280` × `800` |
| UI ping timeout (ms) | `THRONG_PING_TIMEOUT_MS` | `2000` |

User settings, keybindings, and themes are human-editable files under `%USERPROFILE%\.throng\`
(`settings.json`, `keybindings.json`, `themes\<name>.json`, and `icon-packs\<pack>\`) and
hot-reload. Everything is also editable from the visual **preferences window** (title-bar cog),
which writes those same files and applies changes immediately. The installed-font cache and the
bundled default-theme source live under `%APPDATA%\throng\`. The config directory is overridable
via `THRONG_CONFIG_ROOT`.

**Logs and crash reports** are written to a `logs` folder under the user-data directory (`throng`
when installed, `throng-dev` for a dev run), so a crash that closes the window leaves evidence
behind instead of vanishing. `diagnostics.logLevel`, `diagnostics.maxFileSizeKb` and
`diagnostics.keepFiles` control how much is kept and for how long; the **Logging** section of the
preferences window edits those same values.

### Running a dev build beside an installed throng

throng is developed on the same machine that runs it, so an **unpackaged** run (`npm start`,
`npm run start:ui`) is a *dev instance*: it keeps its own data and never touches the installed
app's. Nothing to configure — the app decides from `app.isPackaged`.

| | Installed (packaged) | Dev (`npm start`) |
|---|---|---|
| userData — window state, editor recovery, font cache | `%APPDATA%\throng` | `%APPDATA%\throng-dev` |
| Config — settings, keybindings, themes, icon packs | `%USERPROFILE%\.throng` | `%USERPROFILE%\.throng-dev` |
| Database | `%APPDATA%\throng\throng.db` | `%APPDATA%\throng-dev\throng.db` |
| Daemon pipe | `\\.\pipe\throng.<user>.<hash>.daemon` | …`.daemon.dev` |

The separate pipe is the load-bearing one: an instance that finds a daemon running a *different*
build **retires it**, killing every terminal that daemon owns — so a shared pipe would mean a
rebuild destroys the terminals in the throng you are working in. Distinct pipes also give each
instance its own single-instance lock, so both can run at once. Every override above
(`THRONG_CONFIG_ROOT`, `THRONG_DATABASE_PATH`, `THRONG_PIPE_NAME`, `--user-data-dir`) still wins
in both modes, and a dev launch prints the three locations it resolved.

Your **window and panel layout** is written back as you work, on a short (400ms) debounce, and is
flushed on every ordinary exit — closing a window, quitting the app, a sign-out or a restart. **A
known and accepted limit:** a termination the application cannot intercept — `SIGKILL`, *End task* in
Task Manager, a power loss — can lose **up to the last 400ms** of layout changes. This is a
deliberate trade, not a defect: dragging a panel emits a continuous stream of layout changes, and
writing each one straight through would amplify a single drag into hundreds of disk writes. The
debounce coalesces them. Removing it to close a 400ms window that only an uncatchable kill can open
would cost every user constant write churn for the entire time they are arranging panels — so please
do not "fix" it by lowering or deleting the debounce. Every exit path the OS lets us observe already
drains the pending write before the process goes.

The application ships an immutable, versioned record of its defaults (built-in themes, settings, key
bindings), generated from the application's own definitions and distributed with the build. It is the
single source every restore-to-default reads from: a first run seeds the config from it (without
clobbering any file already present), and an application upgrade only *adds* newly-shipped themes and
fills in newly-added theme properties — it never overwrites a value you already have. A version marker
(`defaults-state.json`) records which defaults have been applied. Adopting new shipped *values* on an
existing theme is a deliberate choice, made via the theme editor's restore controls — **Restore All
Themes to Default**, or a per-theme restore / recreate on a single built-in. Every restore is
whole-operation atomic: if a theme file cannot be written, nothing is changed.

## Testing

Four Vitest/Playwright layers — **unit, integration, contract, E2E** — run via the commands
above; every user-facing change ships passing E2E, and the elevation-gated `@admin` terminal
suite runs via `npm run test:e2e:admin`. See [`CONTRIBUTING.md`](CONTRIBUTING.md) for the full
testing bar.

## Contributing & licence

- Using throng: [`docs/quick-start.md`](docs/quick-start.md) · installing it: [`docs/installation.md`](docs/installation.md) · all guides: [`docs/`](docs/).
- How to contribute (process, toolchain, testing bar): [`CONTRIBUTING.md`](CONTRIBUTING.md); how releases are versioned, packaged and published: [`docs/releasing.md`](docs/releasing.md).
- Copyright © 2026 Christopher Sebok, licensed **AGPL-3.0** — see [`LICENSE`](LICENSE) and
  [`COPYRIGHT.md`](COPYRIGHT.md).
