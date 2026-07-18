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

> **Windows only today** (Windows 11 is the first-class target). **macOS
> ([#22](https://github.com/Bidthedog/throng/issues/22)) and Linux
> ([#23](https://github.com/Bidthedog/throng/issues/23)) are planned.** The OS boundary is
> abstracted so they can be added without reworking the core, but no macOS/Linux build ships yet.

## Highlights

- **Projects** — isolated per-project contexts with exclusive root folders and a dominant
  colour; create / edit / switch / reorder, stored locally per user.
- **Dockable workspace** — three panes (projects & sub-workspaces, workspace, and files & folders —
  the side panes collapse to a labelled rail, by keyboard or chevron, and auto-collapse when the
  window gets too narrow), unlimited tabs, and drag-to-split panels; the full per-project layout is
  saved and restored every session.
- **Multi-window sub-workspaces** — tear tabs or panels off into separate OS windows that
  stay in sync and move as one focus group.
- **Focus contexts & per-panel zoom** — every window has one visible *active panel*, drawn
  from theme tokens (a foreground treatment, dimmed to a distinct inactive treatment when the
  window is in the background) and movable from the keyboard (directional and layout-order
  cycle, carrying real input focus into and out of terminals and editors); each panel zooms
  its text **independently** — from the keyboard or its right-click menu — composing on top of
  the app-wide zoom and persisted with the layout. Each panel shows a small type icon, and a
  terminal shows its **live working directory** in its header (even when a full-screen program
  hides the prompt).
- **In-panel search** — one find bar that adapts to whichever panel is active: an editor gets
  find **and replace** (replace-all is a single undoable step that leaves the file's encoding
  and line endings untouched); a terminal gets a **read-only** find over its retained
  scrollback that never types at the shell, and parking on a match holds the view there while
  output keeps streaming. Matches highlight as you type with a running count, case and
  whole-word toggles, and highlight colours drawn from theme tokens. Terminals are also
  navigable from the keyboard alone — page, line, top, bottom, and jump between matches.
- **File explorer** — a live, project-scoped file tree with full operations (rename, move,
  copy, Recycle-Bin delete, per-project hide, editable exclude globs). Hiding is **reversible**:
  a project-settings dialog on the pane header lists everything the project hides and lets you
  un-hide it, marking any path a global exclusion glob *also* excludes — because removing that
  one will not bring the file back.
- **Terminal panels** — PowerShell, Git Bash, CMD, and custom shell flavours run inline via
  xterm.js on **detached, daemon-owned PTYs**: they survive UI restarts and reattach with
  scrollback, with safe close/exit handling, a project root lock, optional run-as-admin, and
  no orphaned processes.
- **Editor panels** — open and edit a project's text files inline via a **CodeMirror** editor:
  encoding and line endings are detected and preserved, saves are confined to the project (Ctrl+S /
  scoped Ctrl+Shift+S Save-All), a dirty file is locked against external changes, one buffer is
  shared per file across all windows, unsaved changes show a shared dot, and in-progress edits —
  **and their undo history** — survive a crash via recovery files. Files open from the tree into the
  last active editor; a synced editor mirrors one document across windows, sharing **one undo
  stack**, so Ctrl+Z in either window reverts an edit made in the other. Files can also be
  **dragged in from the operating system** — onto an editor, or onto an empty panel, which becomes
  an editor showing the file. **What can be opened is exactly what can be saved**: symlinks are
  resolved first, and a file an editor could not write back is refused up front, visibly, rather
  than opened into a buffer with nowhere to go.
- **Code editing** — **syntax highlighting** for 31 languages, detected by extension and correctable
  from a **language picker** in the status strip (the choice is remembered per file). A right-click
  **content menu** puts cut/copy/paste, Select All, Undo/Redo and "Set Language…" under the cursor,
  so the editor is usable with the mouse alone. **Ctrl+X with no selection cuts the whole line**, and
  paste remembers the *shape* of what was cut: a cut line comes back as a line, above the caret.
  **Rectangular (column) selection** by Alt+drag or `Shift+Alt+Arrow` — type, delete, cut and paste
  operate on every row of the block at once. Indentation follows **the file's own style** wherever it
  has one, falling back to a per-language default and then a global one, so throng never quietly
  converts a tab-indented file to spaces.
- **Custom title bar** — an application-drawn, full-width title bar replaces the OS window
  chrome on every window: the **throng mark** + window identity, minimise/maximise/close, and
  (main window only) a **cog** that opens the preferences window. Sub-workspace windows carry
  the same bar without the cog. The mark is drawn in the active theme's own colours, so it
  reads on light and dark themes alike; the taskbar and Alt-Tab show the same icon, with
  artwork drawn for the size being rendered.
- **Preferences editor** — a single preferences window (floating above throng's own windows,
  minimising and restoring with the main window) with visual **Settings**, **Key Bindings**, and
  **Themes** editors: type-matched controls, a **typeahead search** over Settings that matches any
  typed word against a setting's name, description or current value (with an inline reset); a
  press-to-capture shortcut binder that **adds** multiple chords per action (any single non-reserved
  key allowed), each chord a deletable pill; colour / size / icon pickers and a **multi-select
  font-family pill** editor; a **global UI⇄JSON toggle** (edit the raw file in the built-in code
  editor) and **immediate-apply** (no Save). Editing a file's raw JSON while it changes on disk
  surfaces a reload / keep-editing choice rather than silently discarding either version.
  **Terminal flavours** are edited as a **structured table** — one row per flavour, a typed cell per
  field — rather than hand-written JSON, and **hidden built-in shells** are a **multi-select that
  still offers the ones you have already hidden**, so un-hiding is the same control as hiding. A
  flavour's `id` is fixed once created (it keys that flavour's default startup parameters); to
  rename one, delete it and add it back.
- **One way to be told things** — the application has exactly **two** notice models: a
  *confirmation* (modal, blocking, text-labelled buttons, because the label is the statement of
  what you are consenting to) and a *notification* (transient, non-blocking, dismissable, where
  severity governs persistence — an error waits for you, a success clears itself). Nothing else.
- **Themed everywhere** — the colour picker is drawn from theme tokens rather than the operating
  system's dialog; menus, inputs, hovers, dialogs and scrollbars each have their own theme token
  instead of sharing one; numeric settings with a sensible range get sliders; and switching theme
  repaints every surface with nothing left behind.
- **Reset controls** — four clearly separated scopes, all reading the same shipped-defaults record,
  so there is exactly one answer to "what did this ship as":
  - **Per item** — a setting or a key binding shows a reset icon **only while it differs from its
    shipped value**, so the icon doubles as the "modified" cue. Clicking it restores that one item
    (for a binding, its **full** shipped chord set) immediately, leaving every other item alone.
  - **Per editor** — restores the whole Settings or Key Bindings editor to its shipped defaults.
  - **Reset All Preferences** — settings, key bindings and every **built-in** theme, in one atomic
    all-or-nothing operation. Your **projects, window layout, workspace state and custom themes are
    not touched**, and the confirmation says so. If it cannot complete, nothing changes at all.
  - **Revert All Preferences** — a **session undo**: back to how the window looked when you opened
    it. Not a reset to defaults.

  A reset that cannot be written never fails quietly: a dismissable message names the operation and
  states that nothing was changed.
- **Themes & icon packs** — user-scoped, human-editable, hot-reloading settings, keybindings and
  themes, plus **14 bundled default themes**, dedicated **button style tokens** (colours + font),
  a themeable **editor gutter** (its own background and line-number colours), and **icon packs**
  (a glyph or image per token, with per-token overrides). Two packs ship built in — a `throng`
  glyph pack (default) and an SVG image pack — alongside user-supplyable packs. A selected pack
  re-skins the **whole application** — the file explorer, panel and tab chrome, menus, toolbars and
  buttons — live, with no restart. Image icons are **inlined**, so they take their colour from the
  active theme rather than rendering as fixed black, and they are decorative to assistive
  technology (the control around them carries the name). A pack that cannot be read never breaks
  the app: its icons fall back to the theme's, and the Icons picker shows it as unavailable with
  the reason. Every theme token
  carries a plain-language label and description in the theme editor, and the bundled themes are
  guarded automatically for pairwise visual distinctness and (for the redesigned Bash, SUBNET and
  Cyberpunk themes) WCAG AA contrast. **Code stays legible on every theme**: each syntax colour is
  measured against the editor background and must clear **6:1** — a house standard stricter than
  WCAG AA's 4.5:1, because the search-match highlight can only be as strong as the weakest syntax
  hue allows — on every bundled theme but the three that are deliberately low-contrast (Matrix,
  VI-VIM, Gothic). The checked pairings are derived from the token set, so a syntax colour cannot be
  added without being measured.
- **Theme restore & creation** — the Themes editor pairs a theme dropdown with one set of actions that
  apply to the selected theme (restore, clone, rename, delete), plus a separate **Restore All Themes to
  Default**. Restore All (behind a confirmation) returns every edited built-in to its shipped values and
  recreates any you deleted, atomically, leaving your custom themes untouched — and it is the only way
  to bring back a deleted built-in, so no built-in is ever lost for good. A single built-in can also be
  restored on its own (confirmed). **Clone** is how you create a theme: it duplicates the selected theme
  and opens a name dialog prefilled `"<source> - Clone"`, and renaming uses that same dialog. A theme can
  never take the name of a built-in — including one you have deleted. Each preferences tab keeps its own
  scroll position.

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

- Using throng: [`docs/quick-start.md`](docs/quick-start.md) · all guides: [`docs/`](docs/).
- How to contribute (process, toolchain, testing bar): [`CONTRIBUTING.md`](CONTRIBUTING.md).
- Copyright © 2026 Christopher Sebok, licensed **AGPL-3.0** — see [`LICENSE`](LICENSE) and
  [`COPYRIGHT.md`](COPYRIGHT.md).
