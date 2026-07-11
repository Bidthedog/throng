# throng

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

> **Windows only today** (Windows 11 is the first-class target). **macOS and Linux are
> planned** — see [`ROADMAP.md`](ROADMAP.md). The OS boundary is abstracted so they can be
> added without reworking the core, but no macOS/Linux build ships yet.

## Highlights

- **Projects** — isolated per-project contexts with exclusive root folders and a dominant
  colour; create / edit / switch / reorder, stored locally per user.
- **Dockable workspace** — three panes (project, workspace, and files & folders), unlimited tabs,
  and drag-to-split panels; the full per-project layout is saved and restored every session.
- **Multi-window sub-workspaces** — tear tabs or panels off into separate OS windows that
  stay in sync and move as one focus group.
- **File explorer** — a live, project-scoped file tree with full operations (rename, move,
  copy, Recycle-Bin delete, per-project hide, editable exclude globs).
- **Terminal panels** — PowerShell, Git Bash, CMD, and custom shell flavours run inline via
  xterm.js on **detached, daemon-owned PTYs**: they survive UI restarts and reattach with
  scrollback, with safe close/exit handling, a project root lock, optional run-as-admin, and
  no orphaned processes.
- **Editor panels** — open and edit a project's text files inline via a **CodeMirror** editor
  (plain text): encoding and line endings are detected and preserved, saves are confined to the
  project (Ctrl+S / scoped Ctrl+Shift+S Save-All), a dirty file is locked against external
  changes, one buffer is shared per file across all windows, unsaved changes show a shared dot,
  and in-progress edits survive a crash via recovery files. Files open from the tree into the
  last active editor; a synced editor mirrors one document across windows.
- **Custom title bar** — an application-drawn, full-width title bar replaces the OS window
  chrome on every window: window identity + minimise/maximise/close, and (main window only) a
  **cog** that opens the preferences window. Sub-workspace windows carry the same bar without
  the cog.
- **Preferences editor** — a single preferences window (floating above throng's own windows,
  minimising and restoring with the main window) with visual **Settings**, **Key Bindings**, and
  **Themes** editors: type-matched controls, a **typeahead search** over Settings that matches any
  typed word against a setting's name, description or current value (with an inline reset); a
  press-to-capture shortcut binder that **adds** multiple chords per action (any single non-reserved
  key allowed), each chord a deletable pill; colour / size / icon pickers and a **multi-select
  font-family pill** editor; a **global UI⇄JSON toggle** (edit the raw file in the built-in code
  editor), **immediate-apply** (no Save), and reset-to-default / reset-all. Editing a file's raw JSON
  while it changes on disk surfaces a reload / keep-editing choice rather than silently discarding
  either version.
- **Themes & icon packs** — user-scoped, human-editable, hot-reloading settings, keybindings and
  themes, plus **14 bundled default themes**, dedicated **button style tokens** (colours + font),
  a themeable **editor gutter** (its own background and line-number colours), and **icon packs**
  (a glyph or image per token, with per-token overrides). Two packs ship built in — a `throng`
  glyph pack (default) and an SVG image pack — alongside user-supplyable packs. Every theme token
  carries a plain-language label and description in the theme editor, and the bundled themes are
  guarded automatically for pairwise visual distinctness and (for the redesigned Bash, SUBNET and
  Cyberpunk themes) WCAG AA contrast.

What's planned next lives in [`ROADMAP.md`](ROADMAP.md).

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

The application ships an immutable, versioned record of its defaults (built-in themes, settings, key
bindings), generated from the application's own definitions and distributed with the build. It is the
single source every restore-to-default reads from: a first run seeds the config from it (without
clobbering any file already present), and an application upgrade only *adds* newly-shipped themes and
fills in newly-added theme properties — it never overwrites a value you already have. A version marker
(`defaults-state.json`) records which defaults have been applied. Adopting new shipped *values* on an
existing theme is a deliberate choice, made via the theme editor's restore control.

## Testing

Four Vitest/Playwright layers — **unit, integration, contract, E2E** — run via the commands
above; every user-facing change ships passing E2E, and the elevation-gated `@admin` terminal
suite runs via `npm run test:e2e:admin`. See [`CONTRIBUTING.md`](CONTRIBUTING.md) for the full
testing bar.

## Contributing & licence

- How to contribute (process, toolchain, testing bar): [`CONTRIBUTING.md`](CONTRIBUTING.md).
- Copyright © 2026 Christopher Sebok, licensed **AGPL-3.0** — see [`LICENSE`](LICENSE) and
  [`COPYRIGHT.md`](COPYRIGHT.md).
