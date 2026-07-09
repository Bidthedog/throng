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
- [ ] **Live Notifications** — in-app and OS notifications when a terminal needs your attention
- [ ] **Resource monitor** — keep an eye on throng's own resource usage (CPU, memory, processes) across the UI, daemon and terminals

## Files & editors

- [x] Project-scoped file explorer — live tree, full file operations, Recycle-Bin delete, per-project hide, editable exclude globs
- [ ] **Enhanced file explorer** — search and richer project management
- [ ] **Copy & Paste Files Between Projects** — convenience feature to reduce friction
- [ ] **OS File Operations** — treat throng's File & Folder list as a native OS folder view, with drag-and-drop and copy/paste support
- [x] **Editor panels (plain text)** — open and edit a project's text files inline (CodeMirror): encoding/line-ending fidelity, confined save + scoped Save-All, dirty-file lock, app-wide one buffer per file, unsaved indicators, auto-save, crash recovery, and cross-window sync
- [ ] **Rich code editors** — syntax highlighting and language features on the editor panels above
- [ ] **`.editorconfig` support** — honour a project's `.editorconfig`, cascading over the user's per-language indentation settings
- [ ] **Markdown & document preview** — rendered preview alongside the raw file view
- [ ] **Native OS folder-view panels** — panels that embed the operating system's own folder view with project-based memory

## Terminals

- [x] Terminal panels — live xterm.js shells on detached daemon-owned PTYs, reattach with scrollback, idle-close/cold-respawn
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
- [x] **Additional out-of-the-box themes** — 14 bundled default themes (Light, Snake, Gothic, Windows Terminal, Bash, SUBNET *(placeholder)*, VSCode, VI-VIM, English Garden, Matrix, Cyberpunk, Claude, Debian, Ubuntu) alongside the built-in `throng`; brand-derived themes are best-effort approximations
