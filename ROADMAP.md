# throng roadmap

Where throng is headed. This is the single forward-looking list: **checked items ship
today**; **unchecked items are planned** and not yet built. The [README](README.md) describes
only what currently exists — anything future lives here. Items broadly track the project
constitution's end-state; delivery is sequenced, never dropped.

Planned items are goals, not commitments to a date or order.

## Workspace & projects

- [x] Project-first isolation — create / edit / delete / switch, exclusive root folders, dominant colour, local per-user persistence
- [x] Dockable workspace — two panes, unlimited tabs, drag-to-split panels, context menus, inline rename, persisted per-project layout
- [x] Live multi-window sub-workspaces — tear-off windows that stay in sync and travel as one focus group across as many projects as
      necessary
- [x] Lazy loading of projects and sub-workspaces
- [x] **Settings, Preferences & Themes Hot Reload** — live reflection of settings, themes and key bindings
- [ ] **Enhanced project list** — search and richer project management
- [x] **Settings, Preferences & Theme Editors** — a preferences window (opened from the title-bar cog, parented above throng's own windows) with visual Settings, Key Bindings and Themes editors, a debounced typeahead search over Settings (matching any typed word against a setting's name, description or value), a global UI⇄JSON toggle, immediate-apply (no Save), reset-to-default and reset-all; additive multi-chord key bindings (single-key allowed, deletable pills), a multi-select font-family pill editor, dedicated button style tokens, and two bundled icon packs (a `throng` glyph pack + an SVG image pack)
- [x] **Shipped defaults & restore foundation** — an immutable, versioned record of the application's defaults (built-in themes, settings, key bindings), generated from the app's own definitions and distributed with the build; the single source every restore-to-default reads from. First-run seeding and additive-only upgrades (never overwriting an existing value) are sourced from it, with a version marker recording what has been applied. Provides the restore API (restore all built-in themes, reset one key binding, reset one setting, reset everything) that the theme and settings editor controls build on
- [x] **Main-window affordances** — dismissable panel error surfaces (a themeable trailing-edge dismiss icon on the Projects, File Explorer, terminal-exit and sub-workspaces errors, each removed immediately and re-shown on recurrence); consistent removal terminology across every control, tooltip, menu and confirmation (exactly four verbs — **Close**, **Destroy**, **Remove**, **Delete** — with a project *Removed*, not "Destroyed", and its confirmation stating no files on disk are deleted); a file-changed-on-disk warning that names the affected tab, panel and full path; a continuously-pulsing unsaved-changes dot (synchronised across the projects list, tab chip and panel header, static under reduced motion); and a smarter new-project folder picker that opens at a configurable starting folder (User Profile / Last Viewed / Override) with a shared editable-path + themeable-browse component
- [x] **Focus contexts & per-panel zoom** — a first-class, per-window *active panel* focus context with a legible, theme-driven two-state indicator (a foreground treatment plus a dimmed inactive treatment when the window is in the background, each its own theme token, contrast-guaranteed on every bundled theme) that routes keyboard input and panel-scoped commands and re-homes to a deterministic neighbour when the active panel closes; **per-panel** text zoom (every terminal and every editor zooms independently), reachable from both rebindable Focus & Zoom key bindings and each panel's right-click menu, composing on top of the app-wide global zoom, persisted per panel, recomputing the terminal character grid and never altering editor file content; keyboard move-focus — directional (`Ctrl+Alt+Arrow`) and stable-layout-order cycle — that intercepts its chords ahead of a focused terminal/editor and carries real input focus with it; a small themeable panel-type icon at the head of each title; and each terminal's **live working directory shown in its panel title** (daemon-polled from the shell process)
- [x] **Theme editor — restore & creation controls** — the Themes editor lists themes as rows and completes the restore flows on top of the shipped-defaults record: **Restore All Themes to Default** (confirmed) resets every edited built-in to its shipped values and recreates any the user deleted, atomically, leaving custom themes untouched; a single built-in can be restored on its own (confirmed); and a **deleted built-in stays listed as a *deleted / restorable* row** with its own recreate control (additive, so no confirmation) — no built-in is ever permanently lost. **Clone** becomes the sole creation path (duplicate a theme → a modal name dialog prefilled `"<source> - Clone"` with "Clone" pre-selected), and rename moves to that same dialog; both refuse any name reserved by a built-in, **including a built-in the user has deleted**
- [ ] **Live Notifications** — in-app and OS notifications when a terminal needs your attention
- [ ] **Resource monitor** — keep an eye on throng's own resource usage (CPU, memory, processes) across the UI, daemon and terminals

## Files & editors

- [x] Project-scoped file explorer — live tree, full file operations, Recycle-Bin delete, per-project hide, editable exclude globs
- [ ] **Enhanced file explorer** — search and richer project management
- [ ] **Copy & Paste Files Between Projects** — convenience feature to reduce friction
- [ ] **OS File Operations** — treat throng's File & Folder list as a native OS folder view, with drag-and-drop and copy/paste support
- [x] **Editor panels (plain text)** — open and edit a project's text files inline (CodeMirror): encoding/line-ending fidelity, confined save + scoped Save-All, dirty-file lock, app-wide one buffer per file, unsaved indicators, auto-save, crash recovery, and cross-window sync
- [x] In-panel find & replace — one adaptive find bar over the active panel: as-you-type highlighting with a running count, case/whole-word toggles, wrap, and an editor replace-all that is a single undoable step preserving encoding and line endings
- [ ] **Regular-expression search** — pattern matching in the find bar, alongside the case and whole-word toggles
- [ ] **Search results list** — a scrollable list of matches to click through, and project-wide (cross-file) search
- [ ] **Rich code editors** — syntax highlighting and language features on the editor panels above
- [ ] **Markdown & document preview** — rendered preview alongside the raw file view
- [ ] **Native OS folder-view panels** — panels that embed the operating system's own folder view with project-based memory

## Terminals

- [x] Terminal panels — live xterm.js shells on detached daemon-owned PTYs, reattach with scrollback, idle-close/cold-respawn
- [x] Scrollback search & keyboard navigation — read-only find over the retained scrollback (never typed at the shell), page/line/top/bottom movement, and jump-between-matches
- [x] Shell auto-detection & user flavours — PowerShell, Git Bash, CMD, custom flavours with default startup params
- [x] Safe lifecycle — three-choice app-close, unexpected-exit surfacing, root lock, run-as-admin/de-elevation, no orphaned processes
- [ ] **Terminal presets** — saved shell + working directory + startup-command sets, per project, to reconstitute a cold project
- [ ] **WSL support** — first-class WSL terminals: distro detection, per-distro flavours, and Linux-path root confinement
- [ ] **Additional terminal & shell integrations** — each delivered as required e.g. PuTTY, Tabby, Alacritty, Hyper, Contour etc

## Review & version control

- [ ] **Project-based diff tool** — review all changes to the project, covering changes from agents, terminals and external processes
- [ ] **Per-project git worktree support** — shift between git worktrees within a project

## Agents

- [ ] **AI coding agents** — the "agent-third" tier, layered above terminals - support for agentic CLI tooling
- [ ] **Multi-agent handoff workflows** — coordinate work handed between multiple agents

## Extensibility & data

- [ ] **Plugin system** — third-party extensions (new panel types, integrations, commands)
- [ ] **Backup & restore** — of projects, sub-workspaces, and settings
- [ ] **Application Packaging** — for release and distribution, including auto-update and versioning

## Platform

- [x] Windows 11
- [ ] **macOS**
- [ ] **Linux**

*(The OS boundary is already abstracted, so macOS/Linux need new platform implementations, not core changes.)*

## Configuration & theming

- [x] User-scoped settings and keybindings — human-editable, hot-reloaded, and editable from the visual preferences window
- [x] Theming — swappable, hot-reloaded theme files, with a visual theme editor (colour / size / icon pickers, a multi-select font-family pill editor, and dedicated button style tokens)
- [x] Custom application title bar — an application-drawn full-width bar replacing the OS chrome (window identity + controls + cog) on the main and sub-workspace windows
- [x] Icon packs — a glyph or image per token with per-token overrides, rendered at 24px; two bundled packs (a `throng` glyph pack + an SVG image pack) alongside user-supplyable packs
- [x] **Additional out-of-the-box themes** — 14 bundled default themes (Light, Snake, Gothic, Windows Terminal, Bash, SUBNET, VSCode, VI-VIM, English Garden, Matrix, Cyberpunk, Claude, Debian, Ubuntu) alongside the built-in `throng`; brand-derived themes are best-effort approximations. Bash is a multi-hue Git Bash palette (distinct from Matrix), SUBNET and Cyberpunk use their real brand/reference palettes, every token has a plain-language label and description, the editor gutter is independently themeable, and automated guards enforce pairwise distinctness (all themes) and WCAG AA contrast (Bash, SUBNET, Cyberpunk)
