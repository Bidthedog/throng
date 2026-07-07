<!-- SPECKIT START -->
For additional context about technologies, structure, and approach, read the current plan at
`specs/006-editor-panel-type/plan.md` (feature: **Typed Panels — Editor Panel Type**); supporting
artifacts: `research.md`, `data-model.md`, `contracts/`, `quickstart.md`. The prior plans
(`specs/005-terminal-panel-type/plan.md`, `specs/004-file-explorer-tree/plan.md`,
`specs/003-layout-and-app-tweaks/plan.md`, `specs/002-panes-and-panels/plan.md`,
`specs/001-app-bootstrap/plan.md`) document the terminal panel type + persistent daemon, the file tree,
the theming/config/panes layer, the docking workspace, and the foundational monorepo it builds on.

006 scope (Editor panel type): ship the **second concrete Panel type — Editor** on the 005 typed-panel
system — a **CodeMirror 6** inline code editor, **plain text this pass** (encoding, line endings, save,
save-all, panel movement, sub-workspace sync, crash recovery — the cross-platform fundamentals before any
syntax highlighting). **Headline: the editor is UI-main + renderer, NOT daemon-backed** (unlike terminals):
file I/O via the existing **`IFileSystem`**, plus a UI-main **editor coordinator** owning the app-wide
**open-document registry** (one buffer per file, FR-011a), **soft external-change detection** (revised
FR-028 — the original `IFileLock`/`WindowsFileLock` dirty-file lock was **removed 2026-07-06e** as it broke
external tooling; a folder watch now live-reloads a clean editor and warns a dirty one), **recovery temp
files** (`%APPDATA%\throng\recovery`, FR-041/042), confinement enforcement, and the cross-window editor
**sync mirror** (FR-034) — all via a new
**`editor.*` preload bridge** (peer of `files.*`). **No daemon, no `ipc-contract`, no SQLite migration**
(`user_version` stays 6; `Panel.config` rides the layout blob). Pure logic (the `editorPanelType`
descriptor, encoding/line-ending model, confinement/save-scope/one-buffer/overlap/indicators) lives in
`@throng/core`. Editor & Panel are **inseparable** (no revert-to-form); destroying a **dirty** editor/tab/
project **prompts** save/discard/cancel (FR-006a). New **active-pane** focus model gates panel shortcuts
(Ctrl+S/Ctrl+Shift+S); files open from the tree into the **last active editor** (`editor.openOnClick`
single/double/none; **Enter opens, never renames**). New **`editor` settings** (openOnClick, autoSave,
saveAllScope, defaultLineEnding) + editor theme tokens (incl. shared **unsavedDot**). **Delivered in five
verify-as-you-go phases A–E** (type+editing+save → open-from-tree+one-buffer+rename-fix → indicators+
autosave → menus+destroy-prompt → sub-workspace mirror+ownership+recovery). Also fixes the **rename-no-op**
bug (FR-070). Out of scope: syntax highlighting/language features/Markdown preview (deferred "Rich code
editors" ROADMAP item — CodeMirror keeps them open).

005 scope (typed panels + Terminal type): give a **Panel** an **assignable, immutable-once-confirmed
type** via an extensible **type-selection form** (replaces the "Empty Panel" body: Panel-Type dropdown
with per-type dynamic inputs, **Confirm/Clear**, validation, **lock-on-confirm**), and ship the first
type — **Terminal** — as a live inline shell. **Delivered in three verify-as-you-go phases**: **A** panel
type UI (core `Panel.kind`+`config`, `PanelBody` dispatcher, the form; persists in the existing layout
blob — no daemon, no launch); **B** settings + detection (`settings.terminals` = user **flavours** array
+ `disabledBuiltins` + default-params; built-in **flavour catalogue**; **`IShellDetection`** OS seam,
**UI-main-owned** like 004's FS seams; `terminal.listFlavours` bridge → real **Flavour** dropdown +
per-flavour **default Startup Params** — still no launch); **C** terminal + **persistent detached
daemon** (UI **spawns-if-absent** + single-instance via the pipe + reconnect; **new daemon→UI streaming
channel** = JSON-RPC **notifications** over one long-lived events socket — the transport 004 deferred;
**`IPtyHost`**/**node-pty** PTYs owned by the daemon; **xterm.js** view via `terminal.*` bridge;
**reattach by panelId** from an in-memory registry with replayed scrollback; **idle-close/cold-respawn**;
**app-close three-choice** warning; **root confinement**; **unexpected-exit surfacing**; real
`panelHasRunningSubprocess`). **Clarified (2026-06-30):** a Panel's type is **fixed only while content is
live** — a closed/failed terminal **reverts the Panel to the type-selection form** (re-typeable; new
`clearPanelType` op, FR-020); a **synced** Terminal Panel (same panelId) **mirrors one session in many
views** (subscriber fan-out, FR-021); while a project has open terminals the **daemon locks the project
root** (new **`IDirectoryLock`** seam, ref-counted per project) so it can't be deleted/moved and its root
path can't be edited (FR-022). Out of scope: terminal **presets**, the editor/Markdown preview (004
deferral), agents.

Active stack: TypeScript 5.x on Node 20 LTS (ESM); Electron UI (renderer **React 18 + Vite**; terminal
view via **xterm.js** — new; file tree **react-arborist**; workspace DnD **@dnd-kit**, pane-scoped) +
**persistent detached headless Node daemon** (owns terminals); **node-pty/ConPTY** in
`@throng/platform-windows`, consumed by the **plain-Node daemon** so it builds against host Node 20 —
**no electron-rebuild** (better-sqlite3 model); InversifyJS DI — **one container per process: daemon, UI
main, UI renderer** (3 roots). better-sqlite3 (daemon-owned, single writer), migration runner stays at
**user_version 6** — **005 adds NO migration** (Panel `kind`+`config` ride the existing
`workspace_layout.layout_json` blob; the daemon's terminal session registry is **in-memory**, keyed by
`panelId`). **005 adds new core seams** **`IShellDetection`** (detect installed shells; contract-tested)
and **`IPtyHost`** (start/write/resize/kill + output/exit; contract-tested), and **new daemon
`terminal.*` RPC + notification frames** in `ipc-contract`. Pure logic (panel-type **registry**, per-type
validation/lock, flavour merge/defaults, launch-spec, root-confinement, idle/busy) lives in
`@throng/core`; renderer (sandboxed) reaches detection/terminals only via the preload **`terminal.*`**
bridge (invoke + `onOutput`/`onExit` push). New `settings.terminals` + terminal theme tokens extend the
003/004 config. Vitest (unit/integration/contract) + Playwright-Electron (E2E). Governed by the project
constitution at `.specify/memory/constitution.md` — **every user-facing UI change ships passing E2E, and
each phase lands green before the next begins**. npm-workspaces monorepo, no Docker, run via npm scripts.
Test-first (Red-Green-Refactor) is mandatory.
<!-- SPECKIT END -->
