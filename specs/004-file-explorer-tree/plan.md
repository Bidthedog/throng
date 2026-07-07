# Implementation Plan: File & Folder Tree in the File Explorer Pane

**Branch**: `004-file-explorer-tree` | **Date**: 2026-06-29 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/004-file-explorer-tree/spec.md`

## Summary

Fill the **File Explorer Pane** — shipped empty by 003 — with a live, themed, project-scoped
**file/folder tree**, delivering the navigable workspace folder structure the constitution
(Principle I, Principle XI) recorded as a staged deferral. The pane always reflects the **active
project's root folder**; switching projects swaps the tree. Delivered behaviour (all clarified, see
spec Clarifications 2026-06-29):

- A non-collapsible **root row** labelled with the root folder name; subfolders start **collapsed**;
  entries sorted **folders-first, case-insensitive A–Z**; a **uniform themed icon** per entry
  (chevron for subfolders by state; file-type icon for files); entries matching an **editable exclude
  glob list** (default = VS Code `files.exclude`) are hidden.
- **Live sync** with the folder for **in-app** and **external** changes (no manual refresh), with
  **reconcile on expand/focus**; **symlinks** are shown but never followed out of the root.
- **Select / multi-select / rename / move / cut / copy / paste / delete** via **keyboard** (F2,
  Ctrl+X/C/V, Del — re-mappable `file.*` actions in `keybindings.json`), **mouse** (drag = move,
  Ctrl+drag = copy, Shift/Ctrl-click selection), and an **extensible right-click context menu**.
  **Paste/drop targets** resolve onto folder→that folder, onto file→its parent, none→root. **Delete**
  defaults to the **OS Recycle Bin** (recoverable); a setting switches to **permanent** (confirmed).
  All operations are **confined to the project root on resolved real paths** (no symlink escape); the
  root is immutable.
- A pane **toolbar**: **Expand all** (already-loaded levels only), **Collapse all**, **New folder**
  (smart target + inline rename). A context-menu **Open in file explorer** on every node (file →
  reveal-and-select in parent; folder/root → open its contents).
- **Open file** via a **settings-toggled** single-click (default) or double-click, emitting an
  **open-file intent** whose editor destination is deferred to a later feature.

**Technical approach** — keep the 001/002/003 constitutional boundaries intact:

- **Filesystem & OS-shell access are UI-main-owned**, behind three `@throng/core` seams: a new
  **`IFileSystem`** (list/stat/realpath/rename/move/copy/delete/trash/exists), a new
  **`IShellIntegration`** (reveal-in-file-manager / open-folder), and the existing **`IFileWatcher`**
  (003). This mirrors 003's decision to put user **config files** in UI main (renderer is sandboxed;
  UI main already does file I/O and pushes changes to renderers) and deliberately **avoids reworking
  the daemon's per-call request/response pipe into a persistent push channel** (YAGNI — that channel
  is only truly needed when real terminals/scrollback land). See [research.md](./research.md) D1.
- **Recycle Bin + reveal use Electron's built-in `shell`** (`shell.trashItem`,
  `shell.showItemInFolder`, `shell.openPath`) in UI main — **no new native dependency**.
- **Live sync** reuses the **config-watcher pattern**: UI main watches the active project's root via
  `IFileWatcher` and **pushes** debounced `files.changed` events to the renderer over a new
  preload-bridge channel; the renderer re-reads the affected directory via `files.list`. The same
  path serves in-app operations (no divergent update).
- **Domain logic stays pure in `@throng/core`** (`explorer/`): root-confinement on **resolved real
  paths**, ancestor/descendant rejection (reusing 003's project path-normalise), **target resolution**
  (paste/drop/new-folder), **collision / non-clobbering copy naming**, drag **copy-vs-move**, the
  **open-intent decision**, **sort**, and **exclude-glob matching** (via `picomatch`, a pure-JS glob
  matcher). Zero OS/DOM imports (guarded).
- **The view layer uses an OSS React tree** — **react-arborist** (virtualised rows, drag-and-drop,
  inline rename, multi-select, keyboard nav) — rendered through its node render-prop so **every
  colour/font/icon comes from the active theme** (`var(--throng-*)` + the themed icon map, extended
  with file-type + toolbar tokens) and all icons share fixed dimensions. The component is the *view*;
  all decisions/IO live in core + UI main.
- **No persistence change**: the tree is live (read on demand), `projects.root_folder` already holds
  the root, and expansion/selection are **session-only**. **No SQLite migration** is added.
- New **`explorer` settings section** (open mode, delete mode, exclude globs) and new **`file.*`
  keybinding actions** extend the existing 003 config schemas, hot-reloaded like the rest.

## Technical Context

**Language/Version**: TypeScript 5.x on Node.js 20 LTS (ESM); React 18 (renderer).

**Primary Dependencies**: Electron (UI shell; UI-main `fs`/`fs.promises`, `fs.watch`, and the built-in
**`shell`** module for Recycle Bin + reveal); React 18 + Vite; **react-arborist** (OSS virtualised
tree — **new**: drag-drop, inline rename, multi-select, keyboard, render-prop rows); **picomatch**
(pure-JS glob matcher for the exclude list — **new**, used in `@throng/core`); InversifyJS +
reflect-metadata (DI); better-sqlite3 (daemon store, **unchanged**); Vitest
(unit/integration/contract); Playwright-Electron (E2E). The project-root watcher reuses the existing
**`NodeFileWatcher`** (`fs.watch` recursive) seam impl. No editor/preview libraries (deferred). Note:
react-arborist brings its own DnD; it does **not** use the workspace's `@dnd-kit` (kept pane-scoped).

**Storage**:
- **No schema change.** The active project's `root_folder` (projects table, 002) is the tree root.
  Directory contents are read **live** via `IFileSystem`; nothing about the tree is persisted.
  Expansion + selection are **session-only** renderer state.
- User config (003, UI-main-owned JSON under `%USERPROFILE%\.throng\`) gains an **`explorer`** section
  in `settings.json` (`openMode: "single"|"double"` default `single`; `deleteMode:
  "recycle"|"permanent"` default `recycle`; `excludeGlobs: string[]` default = VS Code `files.exclude`
  defaults), new **`file.*`** entries in `keybindings.json`, and **file-type + toolbar icon tokens**
  in theme documents. All hot-reloaded.

**Testing**: Vitest unit (core: real-path confinement + ancestor/descendant + symlink-escape
rejection, target resolution, collision/copy de-dup naming, drag copy/move, open-intent, sort,
exclude-glob matching); Vitest integration (UI-main `NodeFileSystem` vs a temp dir —
list(+symlink/withFileTypes)/rename/move/copy/delete/trash/realpath; `ElectronShellIntegration`
reveal/open; project-root watcher pushes a change on fs mutation; reconcile-on-expand); contract
(`IFileSystem` + `IShellIntegration` contract suites vs the impls; `IFileWatcher` suite already
exists); Playwright-Electron **E2E** (tree renders for active project; root row non-collapsible +
subfolders collapsed; folders-first sort; project switch swaps tree; uniform themed icons + theme
hot-reload re-paint; excluded entries hidden + reveal-on-edit; external create/rename/delete
reflected; rename/cut/copy/paste/delete via keyboard + context menu; drag move + Ctrl-copy; paste/drop
target resolution; recycle vs permanent delete; toolbar expand-all/collapse-all/new-folder; open in
file explorer; single-vs-double-click open intent; keybinding remap; large-folder responsiveness).
**Every user-facing UI change ships with E2E coverage** (constitution v3.4.0 Principle V). RGR
mandatory.

**Target Platform**: Windows 11 desktop (first supported); OS seams (`IFileSystem`,
`IShellIntegration`) keep macOS/Linux open.

**Project Type**: Desktop application (Electron UI client + headless daemon), npm-workspaces monorepo
(extends 001/002/003).

**Performance Goals**: Tree first paint on project open within the inherited workspace budget; project
switch swaps the tree within **~200 ms** (perceived); external change reflected in a visible folder
within **~1 s** (watcher debounce + re-read); expanding a folder of thousands of entries stays
responsive via **virtualised** rendering; **Expand all** is bounded (already-loaded levels only) so it
cannot hang on a huge repo.

**Constraints**: No Docker; npm scripts only. `@throng/core` keeps **zero OS/DOM imports** (guarded) —
all FS/shell work is behind `IFileSystem`/`IShellIntegration`/`IFileWatcher`. Renderer is **sandboxed**
(no `fs`/`shell`); it reaches the OS only through the preload bridge → UI main. One IoC composition
root per process (daemon, UI main, UI renderer = 3). Operations **confined to the project root on
resolved real paths**; the root row is not renamable/movable/deletable/collapsible. Configuration
injected via typed settings (Principle X).

**Scale/Scope**: Single user, single machine, local-only. Project roots from a handful to many
thousands of entries; large directories handled via virtualization + lazy (on-expand) reads.
Packages touched: `core` (new `explorer/` + `IFileSystem`/`IShellIntegration`), `ui` (main:
file-system + shell impls + watcher + bridge; renderer: tree, toolbar, icons, keybindings, settings,
context menu), config schemas. **No** new daemon RPC, **no** persistence migration.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Evaluated against all eleven principles of constitution **v3.4.0** (note the v3.4.0 Principle V rule:
**every user-facing UI change MUST ship with passing E2E coverage** — honoured below).

| # | Principle | Verdict | How this plan satisfies it |
|---|-----------|---------|----------------------------|
| I | Project-First Context Isolation | ✅ PASS | **Delivers** the deferred navigable workspace folder structure: the pane shows the **active project's root** as a tree scoped to that project; switching projects fully swaps it. Operations are **confined to the root on resolved real paths** (no symlink escape); the root row is immutable + non-collapsible (the project's exclusively-bound folder). Reduces one tracked deferral. |
| II | Platform-Abstracted Core | ✅ PASS | All OS access behind seams: **`IFileSystem`** + **`IShellIntegration`** (new) and the existing **`IFileWatcher`**; concrete impls (`NodeFileSystem`, `ElectronShellIntegration`) live in UI main with **contract tests**. Core has no OS/DOM imports. |
| III | Detached/Persistent Terminals | ✅ PASS (N/A) | No terminals. "Open file" raises an **intent** only; the editor is deferred. |
| IV | Native Terminal Support | ✅ PASS (N/A) | Out of scope this feature. |
| V | Test-First Quality Discipline | ✅ PASS | Unit/integration/contract + **E2E for every UI change** (render, sort, sync, ops, delete modes, exclude, toolbar, reveal, click-mode, keybindings); RGR per task; new seams carry contract suites. |
| VI | Simple, Modern, Discoverable UX | ✅ PASS | Familiar VS-Code-style tree + toolbar: chevrons, drag-drop, inline rename, right-click menu, well-known shortcuts, reveal-in-OS — discoverable without instruction; fully themed; respects the dominant project colour. |
| VII | Change Review & Approval | ✅ PASS (deferred) | The edit list is out of scope. The project-root **filesystem watch** introduced here is the same OS-abstraction seam (Principle II) a future edit-list feature can build on; this feature does not implement review. |
| VIII | SOLID/DRY/YAGNI | ✅ PASS | **Reuse** an OSS tree + Electron `shell` (no native trash/reveal dep) + 003's config-push bridge + project path-normalise; segregated seams (ISP); pure decisions in core (SRP/testable). **YAGNI**: UI-main ownership avoids a speculative daemon push-transport; no persistence for live data. |
| IX | DI & Composition Root | ✅ PASS | Still three roots. New `IFileSystem`, `IShellIntegration`, the explorer watcher, and bridge handlers are **constructor-injected** in the **UI-main** composition root; the renderer tree gets data via the preload bridge, not by `new`-ing IO. |
| X | Externalised Configuration | ✅ PASS | Open mode, delete mode, and exclude globs are injected **typed settings** (new `explorer` section); shortcuts are config-driven `file.*` actions; theme tokens (file-type + toolbar icons) come from the theme document. Nothing hardcoded. |
| XI | Dockable Workspace: Panes, Tabs & Panels | ✅ PASS | **Advances** Principle XI: the **File Explorer Pane** now shows "the active project's file and folder hierarchy" (with a toolbar) instead of the empty placeholder, within the existing collapsible-pane shell. |

**Architecture constraints**: daemon single SQLite writer **unchanged** ✅ (no migration); per-user
local storage ✅; renderer sandbox preserved (FS/shell via bridge → UI main) ✅; single instance / lazy
loading unaffected ✅; Electron+TS baseline ✅; **reuse-not-fork** (OSS tree + Electron shell, not a
forked IDE) ✅; agents future ✅.

**Gate result: PASS — no violations.** Deliberate, compliant decisions recorded under
[Complexity Tracking](#complexity-tracking): UI-main-owned FS/shell seams (vs daemon + new push
transport), the new `react-arborist` + `picomatch` runtime dependencies, and the still-deferred
Markdown/document preview + editor.

## Project Structure

### Documentation (this feature)

```text
specs/004-file-explorer-tree/
├── plan.md              # This file (/speckit-plan output)
├── research.md          # Phase 0 — decisions D1–D12
├── data-model.md        # Phase 1 — entities, seams, config/theme additions (no SQL)
├── quickstart.md        # Phase 1 — validation/run guide
├── contracts/           # Phase 1
│   ├── os-file-system.md          # IFileSystem seam contract (+ reused IFileWatcher)
│   ├── os-shell-integration.md    # IShellIntegration seam contract (reveal / open folder / trash)
│   ├── files-bridge.md            # preload-bridge files.* API (renderer ↔ UI main) + push events
│   └── config-additions.md        # settings.explorer + file.* keybindings + theme icon tokens
└── tasks.md             # Phase 2 output (/speckit-tasks — NOT created here)
```

### Source Code (repository root)

Extends the existing monorepo. **New** files marked `(new)`; **extended** marked `(ext)`.

```text
packages/
├── core/
│   ├── src/
│   │   ├── abstractions/
│   │   │   ├── file-system.ts           # (new) IFileSystem — list/stat/realpath/rename/move/copy/delete/trash/exists
│   │   │   └── shell-integration.ts      # (new) IShellIntegration — revealInFileManager / openFolder
│   │   ├── explorer/                      # (new) pure file-explorer domain
│   │   │   ├── node.ts                   #   FileNode/FolderNode types + relative-path helpers + sort (folders-first, A–Z)
│   │   │   ├── path-rules.ts             #   confine-to-root on REAL paths, ancestor/descendant + symlink-escape reject
│   │   │   ├── target.ts                 #   resolve paste/drop/new-folder target (folder→self, file→parent, none→root)
│   │   │   ├── naming.ts                 #   rename validation + non-clobbering copy/new-folder name
│   │   │   ├── drag.ts                   #   resolve copy-vs-move from modifiers; validate drop target
│   │   │   ├── exclude.ts                #   glob exclude matching (picomatch) + VS Code default list
│   │   │   └── open-intent.ts            #   decide open vs select vs toggle (single/double × file/folder)
│   │   ├── config/
│   │   │   ├── app-settings.ts           # (ext) add `explorer` { openMode, deleteMode, excludeGlobs } + defaults
│   │   │   ├── keybindings.ts            # (ext) add ActionIds file.rename/cut/copy/paste/delete + defaults
│   │   │   └── theme.ts                  # (ext) icon tokens: folder/folderOpen/chevron/file + by-type + toolbar (expandAll/collapseAll/newFolder) + defaults
│   │   └── testing/
│   │       ├── file-system-contract.ts   # (new) reusable IFileSystem contract suite
│   │       └── shell-integration-contract.ts # (new) reusable IShellIntegration contract suite
│   └── tests/unit/                        # (ext) path-rules, target, naming, drag, exclude, open-intent, sort
│
├── ui/
│   ├── src/
│   │   ├── main/
│   │   │   ├── composition-root.ts        # (ext) bind IFileSystem + IShellIntegration + explorer watcher + files bridge
│   │   │   ├── node-file-system.ts        # (new) IFileSystem via fs.promises (readdir withFileTypes, realpath, rename, cp, rm) + shell.trashItem
│   │   │   ├── electron-shell-integration.ts # (new) IShellIntegration via Electron shell (showItemInFolder / openPath)
│   │   │   ├── explorer-watcher.ts        # (new) watch active project root (IFileWatcher) → push files.changed to renderer
│   │   │   └── files-ipc.ts               # (new) ipcMain handlers: files.list/rename/move/copy/delete/newFolder/reveal (+ real-path guard)
│   │   ├── preload/preload.cts            # (ext) bridge: window.throng.files.{list,rename,move,copy,delete,newFolder,reveal,onChange,setRoot}
│   │   └── renderer/
│   │       ├── panes/
│   │       │   └── file-explorer-pane.tsx # (ext) replace placeholder body with <ExplorerToolbar/> + <FileTree/> when a project is active
│   │       ├── explorer/                   # (new) the tree view + glue
│   │       │   ├── toolbar.tsx            #   Expand all / Collapse all / New folder (themed icon buttons)
│   │       │   ├── file-tree.tsx          #   react-arborist <Tree>; data via files.list; render-prop rows; non-collapsible root
│   │       │   ├── tree-node.tsx          #   themed row: uniform icon (resolveIcon by type) + name + inline rename input
│   │       │   ├── tree-icons.ts          #   map FileNode → theme icon token (extension → token)
│   │       │   ├── use-explorer-data.ts   #   load root/children, subscribe files.onChange, reconcile, preserve expand/selection
│   │       │   ├── file-ops.ts            #   call bridge ops; apply core target/naming/path rules; pick delete mode; surface errors
│   │       │   ├── explorer-keybindings.ts#   pane-scoped key handling (resolveAction → file.* when pane focused)
│   │       │   ├── context-menu-items.ts  #   build MenuItem[] (rename/cut/copy/paste/delete/open-in-explorer; paste gated by clipboard)
│   │       │   ├── open-intent.ts         #   emit open-file intent (consumed by future editor); honour openMode
│   │       │   └── explorer.css           #   tree + toolbar styling via var(--throng-*); fixed icon box
│   │       └── config/config-store.tsx    # (ext) expose settings.explorer + file.* bindings to the tree
│   ├── tests/unit/                         # (ext) tree-icons map, context-menu items, use-explorer-data reducer, toolbar
│   └── tests/e2e/                          # (ext) explorer.spec.ts — render/sort/sync/ops/delete-modes/exclude/toolbar/reveal/click-mode/keys
│
└── (daemon, persistence, ipc-contract, platform-windows: UNCHANGED — no new RPC, no migration)
```

**Structure Decision**: Extend the 001/002/003 monorepo. **All decision logic is pure in
`@throng/core`** (`explorer/` + the `IFileSystem`/`IShellIntegration` abstractions). **Filesystem and
OS-shell IO are owned by UI main** (`NodeFileSystem`, `ElectronShellIntegration`, the project-root
watcher, and `files.*` ipc handlers), mirroring 003's UI-main ownership of user config files and
reusing its watch-and-push bridge for live sync. The **renderer stays sandboxed**, reaching the OS
only through the preload bridge, and renders the tree with the **react-arborist** OSS component themed
entirely through `var(--throng-*)` tokens and the themed icon map. The **daemon, persistence
(SQLite), and `ipc-contract` packages are untouched** — no new JSON-RPC method and no migration,
because the tree is live and the project root path already exists in the projects table.

## Complexity Tracking

> No Constitution Check violations. Rows below are deliberate, compliant decisions recorded for
> reviewer scrutiny (Dev Workflow gate) and one tracked staged deferral.

| Decision | Why needed | Alternative rejected because |
|----------|------------|------------------------------|
| **FS + shell seams owned by UI main** (not the daemon) | The live tree needs **server→client push** for external changes; UI main already watches files and pushes to renderers (003 config), already does file I/O, and keeps the renderer sandboxed. Recycle Bin + reveal use Electron's built-in `shell` (UI-main only). Reuses proven infrastructure with zero transport change. | **Daemon-owned** — rejected: the daemon pipe is **per-call request/response with no push channel**; adding a persistent subscription transport is a large, speculative rework (YAGNI) justified only when real terminals/scrollback land. Electron `shell` isn't available in the headless daemon anyway. **Renderer-direct fs/shell** — rejected: breaks the sandbox (Principle II/security). |
| **New runtime dependency `react-arborist`** | Virtualised rows (large folders), built-in drag-drop, inline rename, multi-select, keyboard nav, render-prop theming — the spec's mouse/keyboard/icon/selection surface ready-made. | **Custom tree** — rejected (reinvents virtualization/DnD/a11y; more code/bugs; violates reuse/YAGNI). **rc-tree / react-complex-tree** — viable (research D2); react-arborist is the closest file-tree fit and is the recorded choice. |
| **New runtime dependency `picomatch`** (pure-JS glob) | The exclude list accepts **arbitrary user globs**; a battle-tested matcher avoids hand-rolling glob→regex (correctness/security). Pure JS, no OS calls → usable in `@throng/core`. | **Hand-rolled matcher** — rejected (glob edge cases are error-prone; only the simple defaults would be safe). **minimatch** — equivalent; picomatch chosen for speed/zero-deps. |
| **Electron `shell` for trash + reveal** (no native module) | `shell.trashItem` (Recycle Bin), `shell.showItemInFolder` (reveal+select), `shell.openPath` (open folder) cover FR-018/FR-035 with **no extra native dependency**. | A native `trash`/`node-windows` module — rejected (extra binary dep, build complexity) when Electron already provides it. |
| **No persistence / no migration; expansion session-only** | The tree is a **live view** of disk; `projects.root_folder` already exists; persisting a file index would duplicate the source of truth and risk staleness (DRY). | **Cache the tree in SQLite** — rejected (duplication/invalidation, no requirement). **Persist expansion across sessions** — not required; deferred (cheap to add later). |
| **Staged deferral: Markdown/document preview + editor** | Incremental Delivery rule: this feature lands the tree; the `.md`/document **preview** (Principle I) and the **editor** that consumes the open-file intent remain a separate later increment. | Building preview/editor now — rejected by scope (spec defers). **End-state requirement remains**: a future feature MUST deliver document preview + the editor consuming the open-file intent emitted here. |
