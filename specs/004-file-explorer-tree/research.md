# Phase 0 Research — File & Folder Tree in the File Explorer Pane

All Technical Context unknowns are resolved below. Each decision is **Decision / Rationale /
Alternatives**. Inputs: the 004 spec (incl. the four 2026-06-29 clarification passes), the 003
plan/research (theming, config, panes, keybindings, context menu), and the codebase survey of the
daemon/IPC/persistence and renderer architecture (2026-06-29). Nothing here re-opens a settled
clarification.

## D1 — Filesystem & OS-shell ownership: UI main vs daemon

**Decision**: The tree's OS access — **reading** directory entries, **watching** the project root,
performing **file operations** (rename/move/copy/delete/trash), and **OS-shell actions** (reveal /
open folder) — is **owned by the UI main process**, behind `@throng/core` seams **`IFileSystem`**,
**`IShellIntegration`**, and the existing **`IFileWatcher`**. The renderer stays sandboxed and reaches
the OS only through the preload bridge (`window.throng.files.*`) → UI main. The **daemon and SQLite
are not involved**.

**Rationale**: The codebase survey confirmed the daemon's named-pipe transport is **per-call
request/response with no server-initiated notifications** (explicitly a future extension point); the
live-sync requirement (FR-009/010) needs **push** from the OS owner to the renderer. UI main already
does exactly this shape of work: it owns user config files (003 D1), runs a recursive
`NodeFileWatcher`, and **pushes** changes to renderers over the preload bridge. Reusing that pattern
adds **zero transport rework** and keeps the sandbox intact. Electron's `shell` module (trash/reveal)
is **only available in UI main**, not the headless daemon.

**Alternatives**: **Daemon-owned** (new `files.*` JSON-RPC + a persistent subscription transport) —
rejected: large speculative transport rework (YAGNI), real justification is future terminal scrollback;
`shell` unavailable in the daemon. **Renderer-direct `fs`/`shell`** — rejected: breaks the sandbox
(Principle II/security).

**Consequence**: No `ipc-contract` change and no daemon change. The tree's "contract" is the
preload-bridge `files.*` API (contracts/files-bridge.md), like the existing
`config`/`subWorkspace`/`panel` channels.

## D2 — OSS tree component

**Decision**: Use **`react-arborist`** for the tree **view**: virtualised rows (react-window),
built-in drag-and-drop, inline rename, single + multi-select, keyboard nav, and a **node render-prop**
so we render each row ourselves (theme colours/fonts/icons, fixed-size icon box). The component is
**only the view**; the data source (lazy reads), all decisions, and IO live in core + UI main.

**Rationale**: Closest-fit popular OSS package for a *file* tree — DnD + rename + virtualization +
custom rows in one library — covering FR-005/008/015/016/019 with minimal glue and satisfying "use a
popular OSS file-browser package". Render-prop rows make theming (D3) and uniform themed icons
straightforward; the non-collapsible root (FR-004) is enforced by disabling the root's toggle.

**Alternatives** (recorded for awareness): **`react-complex-tree`** (excellent a11y, controlled),
**`rc-tree`** (Ant's tree), **`@headless-tree/react`**, **MUI X Tree View** — all viable; react-arborist
chosen for the least file-tree glue. **Build custom** — rejected (reinvents virtualization/DnD/a11y).

## D3 — Theming the tree & toolbar (colours, fonts, uniform icons)

**Decision**: Style with the existing **CSS custom properties** (`var(--throng-*)`) and the theme
**icon map**. Reuse colour tokens (`surface`, `surfaceActive` for selection, `text`, `textMuted`,
`accent`, `border`) and per-role fonts; add **file-type icon tokens** and **toolbar icon tokens** to
`Theme.icons`, resolved via the existing `resolveIcon(theme, token)`. Every icon renders in a
**fixed-dimension box** (e.g. 16×16 `.tree-icon`) so all icons share identical dimensions.

**Icon tokens to add** (defaults in `THRONG_THEME.icons`): `folder`, `folderOpen`, `chevron`, `file`
(default), by-type (`fileCode`, `fileJson`, `fileMarkdown`, `fileImage`, `fileText`, …), `symlink`
indicator, and toolbar `expandAll`, `collapseAll`, `newFolder`. The extension→token mapping lives in
renderer `tree-icons.ts`; glyphs live in the theme document. Unknown extension → `file`; missing
theme token → throng default (existing `resolveIcon` fallback).

**Rationale**: Matches 003 whole-app theming (zero new machinery; hot-reload for free; theme swap
re-paints). Keeps "icons follow the theme" true while the type→token mapping stays testable code.

**Alternatives**: A dedicated icon-pack dependency (`vscode-icons`/`material-icon-theme`) — rejected
(heavier; bypasses the theme). Inline hardcoded SVGs — rejected (not themeable/hot-swappable).

## D4 — Live synchronisation & reconciliation

**Decision**: UI main's **`explorer-watcher`** watches the **active project root** via `IFileWatcher`
(debounced). On change it pushes a `files.changed` event (affected directory path, or coarse
"root-changed") to the renderer; `use-explorer-data` **re-reads the affected + currently-expanded
directories** via `files.list` and merges, **preserving expansion + selection** for surviving nodes
(FR-013). The watcher is re-pointed on **active-project change**. **In-app operations** complete via
`files.*` then rely on the **same** watcher refresh (single source of truth), with an **optimistic
local re-read** of the touched directory for snappiness. **Reconciliation**: collapsed subtrees are
read **on expand**; the visible tree re-reads on **pane focus** — so a missed `fs.watch` event cannot
leave the tree permanently wrong (FR-011/013/014).

**Rationale**: Reuses the 003 watch-and-push pattern; lazy on-expand reads keep large trees cheap (D6)
and double as reconciliation. Debounce coalesces noisy writes (build output).

**Alternatives**: Renderer-side watching — rejected (sandbox). Full-tree re-read per event — rejected
(cost; loses expansion/selection). Polling — rejected (latency/cost).

## D5 — File operations, confinement (real paths) & collision rules

**Decision**: Pure core computes operations; UI main executes them via `IFileSystem`.
- **Confinement on REAL paths** (`path-rules.ts`): UI main resolves source/target with
  `fs.realpath` and core checks they lie **within the project root's real path**; a target that is
  the root's ancestor/outside, a **descendant of the moved node itself**, or that **resolves (via a
  symlink/junction) outside the root**, is **rejected** (FR-022/FR-037). Reuse 003's path-normalise
  (resolve, Windows case-fold, trailing-sep insensitive).
- **Target resolution** (`target.ts`): paste/drop/new-folder target = onto a **folder** → that
  folder; onto a **file** → its **parent**; **nothing selected** → the **root** (FR-017/019/033).
- **Root immutability**: the root row cannot be renamed/moved/deleted/collapsed (Principle I).
- **Collision / copy naming** (`naming.ts`): rename onto an existing sibling is **rejected**;
  copy/paste & new-folder default names are **de-duplicated** (`name`, `name copy`, `name copy 2` /
  `New folder`, `New folder (2)`). **No silent overwrite** (FR-024).
- **Drag semantics** (`drag.ts`): plain drag = **move**; **Ctrl+drag = copy**; Shift/Ctrl-click =
  selection (FR-019).
- **Delete** (D11): default **Recycle Bin**; permanent is a confirmed setting.
- **Errors**: a failed op surfaces a **non-fatal** message; the tree re-reads to stay consistent
  (FR-025).

**Rationale**: Keeping the riskiest rules (real-path traversal, symlink escape, data-losing
overwrites) as pure functions makes them unit-testable and OS-independent; UI main is a thin executor.

**Alternatives**: Trusting the OSS component's built-in move/rename to touch disk — rejected (no
project-root concept, no collision policy, no sandbox boundary). Overwrite-on-collision — rejected
(data loss). Confinement on lexical (non-real) paths — rejected (symlink escape).

## D6 — Lazy, virtualised reads; sort; Expand-all bound

**Decision**: Read **one directory level at a time** (root children on open; a folder's children on
first expand); cache per-session; refresh via D4. Rows are **virtualised** by react-arborist.
`IFileSystem.list` returns each entry's name, kind, **isSymlink**, and a `hasChildren` hint. **Sort**
(`node.ts`): **folders first, then files**, each case-insensitive A–Z (FR-036). **Expand all**
(FR-032) expands only **already-loaded** levels — it never eagerly reads unread folders, so it stays
bounded on huge repos. **Collapse all** collapses subfolders (root stays expanded).

**Rationale**: Satisfies FR-008 (responsive on thousands of entries) and the clarified Expand-all
bound; lazy reads are also the reconciliation hook (D4).

**Alternatives**: Eager full-tree read / true recursive expand-all — rejected (freezes on large repos
e.g. `node_modules`). Non-virtualised rendering — rejected (DOM blowup).

## D7 — Open-on-click mode (setting) & deferred open destination

**Decision**: `settings.explorer.openMode: "single" | "double"`, **default `single`** (spec default).
Pure `open-intent.ts` decides from (openMode, kind, click count): **folder click → toggle**; **file
click → emit open-file intent** when the click matches the mode, else select. The **open-file intent**
is a renderer-level event carrying the file path; **where it opens (an editor) is out of scope** and
deferred — the intent is the seam a future editor/preview feature consumes.

**Rationale**: Encodes FR-026/027/028; default `single` honours the user; the intent lets this feature
ship + be E2E-tested without an editor.

**Alternatives**: Default double-click — rejected (contradicts the stated default). Wiring a concrete
editor now — rejected (future scope; would block this feature).

## D8 — Keybindings for tree operations

**Decision**: Add re-mappable **`file.*` action ids** + `keybindings.json` defaults: `file.rename`
`["F2"]`, `file.cut` `["Ctrl+X"]`, `file.copy` `["Ctrl+C"]`, `file.paste` `["Ctrl+V"]`, `file.delete`
`["Delete"]`. The renderer resolves them via the existing `resolveAction`, **scoped to File Explorer
Pane focus** (a pane-level handler, not the global window handler) so clipboard keys act on the tree
only when focused. Hot-reloaded.

**Rationale**: Matches 003's config-driven, re-mappable model and the spec's shortcut list;
focus-scoping avoids global Ctrl+C/X/V collisions.

**Alternatives**: Hardcoding shortcuts — rejected (spec). Reusing the global window handler for
clipboard keys — rejected (would hijack app-wide).

## D9 — `IFileSystem` seam shape

**Decision**: `core/abstractions/file-system.ts`, **async**: `list(dir)` (→ entries with name/kind/
isSymlink/hasChildren), `stat(path)`, `realpath(path)`, `rename(path,newName)`, `move(src,destDir)`,
`copy(src,destDir,newName?)`, `delete(path)` (permanent), `trash(path)` (Recycle Bin), `exists(path)`.
Paths are absolute (OS form). Impl `NodeFileSystem` (UI main) uses `fs.promises`
(`readdir({withFileTypes:true})`, `realpath`, `rename`, `cp`, `rm`) and **Electron `shell.trashItem`**
for `trash`. Ship a reusable **contract suite** (`core/testing/file-system-contract.ts`) run against
the impl (temp-dir integration). Reuse **`IFileWatcher`** unchanged for the project-root watch.

**Rationale**: One segregated seam (ISP) keeps core OS-agnostic and macOS/Linux open; the contract
suite keeps any future impl honest.

**Alternatives**: Synchronous seam — rejected (blocks the UI-main event loop). A broad "do-everything"
facade — rejected (YAGNI).

## D10 — `IShellIntegration` seam (open in file explorer)

**Decision**: New `core/abstractions/shell-integration.ts`: `revealInFileManager(path)` (open the OS
file manager with the item **selected in its parent** — for files) and `openFolder(path)` (open a
folder showing **its contents** — for folders/root). Impl `ElectronShellIntegration` (UI main) uses
**`shell.showItemInFolder(path)`** and **`shell.openPath(path)`** respectively (FR-035). Contract
suite asserts the impl invokes the right shell call per kind and surfaces a non-fatal error for a
missing path.

**Rationale**: Electron's built-in `shell` gives reveal + open with **no native dependency**; a
separate seam (ISP) keeps "open in OS" distinct from filesystem mutation and OS-agnostic in core.

**Alternatives**: A native `node-windows`/`trash`-style module — rejected (extra binary; Electron
already provides it). Folding reveal into `IFileSystem` — rejected (different responsibility; ISP).

## D11 — Delete mode (Recycle Bin vs permanent)

**Decision**: `settings.explorer.deleteMode: "recycle" | "permanent"`, **default `recycle`**. In
`recycle` mode `file-ops` calls `IFileSystem.trash` (→ `shell.trashItem`, recoverable) with **no hard
confirm**. In `permanent` mode it calls `IFileSystem.delete` (`fs.rm`) **after a confirmation dialog**
reusing the 003 confirmation-dialog style. If the Recycle Bin is unavailable (e.g. some network
paths), `trash` surfaces a **non-fatal** error and leaves the item in place (no silent permanent
delete) (FR-018, SC-009).

**Rationale**: Directly encodes the clarification; Electron `shell.trashItem` makes recoverable delete
trivial and cross-platform; the confirm gate protects the irreversible path.

**Alternatives**: Always permanent — rejected (data-loss risk). Always recycle — rejected (user wants
the opt-in permanent mode). A custom in-app trash — rejected (reinvents the OS Recycle Bin).

## D12 — Exclude globs (hidden/noisy entries)

**Decision**: `settings.explorer.excludeGlobs: string[]`, **default = the VS Code `files.exclude`
defaults** (`**/.git`, `**/.svn`, `**/.hg`, `**/CVS`, `**/.DS_Store`, `**/Thumbs.db`). Pure
`exclude.ts` matches an entry's **root-relative path** against the active globs using **`picomatch`**;
matches are hidden from the tree. The list is **user-editable** in `settings.json` and hot-reloaded
(removing a pattern reveals matching entries without a restart) (FR-005a, SC-010). Matching runs in
the renderer (or UI-main read) over each listed directory's entries.

**Rationale**: Mirrors VS Code's familiar behaviour and the clarification; `picomatch` is a small,
fast, pure-JS, well-tested glob matcher safe to use in `@throng/core`; keeping the default list and
matching pure makes it unit-testable.

**Alternatives**: Hand-rolled glob→regex — rejected (glob edge cases; correctness risk). `minimatch` —
equivalent; `picomatch` chosen for speed/zero-deps. Hiding all dotfiles by a hardcoded rule —
rejected (clarification chose an editable glob list, not a dotfile rule).

## Resolved unknowns

No `NEEDS CLARIFICATION` markers remain. **New runtime dependencies**: `react-arborist` (renderer tree
view) and `picomatch` (core glob matcher). **No** new persistence migration, **no** new daemon RPC,
**no** new `ipc-contract` namespace (the tree's contract is the preload bridge). **Reused**:
`IFileWatcher` + `NodeFileWatcher`, the config watch-and-push bridge, theming CSS-vars + icon map, the
context-menu component, the keybindings model, 003's project path-normalise, and **Electron's built-in
`shell`** for trash + reveal. **Deferred (tracked)**: the Markdown/document **preview** and the
**editor** that consumes the open-file intent.
