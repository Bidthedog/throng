# Phase 1 Data Model — File & Folder Tree

This feature adds **no database tables and no migration** (the tree is a live view of disk;
`projects.root_folder` already holds the root; expansion/selection are session-only). The "data
model" here is the **in-memory domain types** (pure, in `@throng/core`), the **OS seams**, and the
**config/theme additions**. Cross-references: [contracts/os-file-system.md](./contracts/os-file-system.md),
[contracts/os-shell-integration.md](./contracts/os-shell-integration.md),
[contracts/files-bridge.md](./contracts/files-bridge.md),
[contracts/config-additions.md](./contracts/config-additions.md).

## 1. Domain entities (pure, `@throng/core/explorer`)

### FileNode / FolderNode

One entry under a project root. Identity is its **path relative to the root**.

| Field | Type | Notes |
|-------|------|-------|
| `id` | `string` | Root-relative path (POSIX-normalised); stable identity for the tree/component. |
| `name` | `string` | Leaf name (no separators). |
| `kind` | `"file" \| "folder"` | Discriminator. |
| `relPath` | `string` | Path relative to the project root (`""` for the root node). |
| `isSymlink` | `boolean` | Shown with an indicator; never followed out of root (FR-037). |
| `hasChildren` | `boolean` | Folders only — hint so a chevron shows without reading grandchildren. |
| `children` | `Node[] \| undefined` | Loaded **lazily**; `undefined` = not yet read. |

- The **root node** (`relPath === ""`, `kind === "folder"`) is **immutable and non-collapsible**
  (FR-004/FR-023): no rename/move/delete; always expanded.
- Absolute paths are never stored on the node; derived as `join(projectRoot, relPath)` only at the IO
  boundary (UI main), keeping core OS-agnostic.
- **Sort** (FR-036): siblings ordered **folders first, then files**, each case-insensitive A–Z.

### TreeViewState (renderer, session-only)

| Field | Type | Notes |
|-------|------|-------|
| `expanded` | `Set<string>` (node ids) | Root always expanded (not user-collapsible); subfolders absent initially. |
| `selection` | `string[]` (node ids) | Single or multi (Shift/Ctrl); drives ops + context menu. |
| `scrollOffset` | `number` | Virtualisation scroll position. |

Not persisted across sessions. Preserved across live updates for surviving nodes (FR-013).

### Clipboard (renderer, session-only)

| Field | Type | Notes |
|-------|------|-------|
| `mode` | `"cut" \| "copy" \| null` | `null` = empty (paste disabled). |
| `nodeIds` | `string[]` | Source nodes captured at cut/copy time. |

`cut` + paste → **move**; `copy` + paste → **copy** (non-clobbering name on collision).

### OpenFileIntent (renderer event)

| Field | Type | Notes |
|-------|------|-------|
| `projectId` | `string` | Owning project. |
| `relPath` | `string` | File to open, relative to root. |
| `absPath` | `string` | Convenience absolute path (UI-main-resolved). |

Emitted by the tree; **consumer (editor) is out of scope** — a future feature subscribes.

## 2. Pure operations & rules (unit-tested)

| Module | Function (shape) | Rule |
|--------|------------------|------|
| `path-rules.ts` | `isWithinRoot(rootReal, candidateReal)` | Candidate's **resolved real path** must lie inside the root's real path (normalise: resolve, Windows case-fold, trailing-sep insensitive). |
| `path-rules.ts` | `isDropAllowed(srcReal, destDirReal, rootReal)` | Reject drop into self / a **descendant of self** / **outside the root** (incl. symlink escape) (FR-022/037). |
| `path-rules.ts` | `isRoot(node)` | Root immutable + non-collapsible. |
| `target.ts` | `resolveTarget(node \| null)` | folder → itself; file → parent; null → root (FR-017/019/033). |
| `naming.ts` | `validateRename(name, siblings)` | Non-empty, no separators/invalid chars, not an existing sibling → else reject (FR-016/024). |
| `naming.ts` | `dedupeName(base, siblings)` | First non-colliding: `base`, `base copy`, `base copy 2` (extension-aware); `New folder`, `New folder (2)` (FR-024/033). |
| `drag.ts` | `resolveDragEffect(modifiers)` | `Ctrl` → `copy`; else `move` (FR-019). |
| `exclude.ts` | `isExcluded(relPath, globs)` | `picomatch` match against the active exclude globs; `DEFAULT_EXCLUDE_GLOBS` = VS Code `files.exclude` (FR-005a/D12). |
| `open-intent.ts` | `decideClick(openMode, kind, clickCount)` | folder → `toggle`; file → `open` when click matches mode, else `select` (FR-026/027/028). |
| `node.ts` | `toNodes(entries, parentRelPath)` + `sortNodes` | Map `IFileSystem` entries → `Node[]`; sort folders-first then case-insensitive name (FR-036). |

## 3. OS seams (new) — see contracts

- **`IFileSystem`** (`core/abstractions/file-system.ts`): `list / stat / realpath / rename / move /
  copy / delete / trash / exists`. Impl `NodeFileSystem` (UI main, `fs.promises` + `shell.trashItem`).
  [contracts/os-file-system.md](./contracts/os-file-system.md).
- **`IShellIntegration`** (`core/abstractions/shell-integration.ts`): `revealInFileManager /
  openFolder`. Impl `ElectronShellIntegration` (UI main, `shell.showItemInFolder` / `shell.openPath`).
  [contracts/os-shell-integration.md](./contracts/os-shell-integration.md).
- **`IFileWatcher`** (003, reused unchanged) watches the active project root.

## 4. Config & theme additions (003 schemas extended) — see contract

- **`settings.json` → `explorer`** section:
  `{ "openMode": "single"|"double" (def single), "deleteMode": "recycle"|"permanent" (def recycle),
  "excludeGlobs": string[] (def = VS Code files.exclude defaults) }`. Validated/merged by
  `app-settings.ts`.
- **`keybindings.json`**: `file.rename` `["F2"]`, `file.cut` `["Ctrl+X"]`, `file.copy` `["Ctrl+C"]`,
  `file.paste` `["Ctrl+V"]`, `file.delete` `["Delete"]`. New `ActionId`s in `keybindings.ts`.
- **`themes/*.json` `icons`**: `folder`, `folderOpen`, `chevron`, `file` (default), by-type
  (`fileCode`, `fileJson`, `fileMarkdown`, `fileImage`, `fileText`, …), `symlink`, and toolbar
  (`expandAll`, `collapseAll`, `newFolder`). Defaults in `THRONG_THEME`; unknown tokens fall back via
  `resolveIcon`.

Full shapes + defaults: [contracts/config-additions.md](./contracts/config-additions.md).

## 5. Persistence

**None.** No new table, no migration; `user_version` stays at **5**. Rationale (DRY / live source of
truth) in plan Complexity Tracking. The projects table's existing `root_folder` is the only persisted
input, read via the established `projects.*` path.

## 6. Entity relationships

```text
Project (002, has root_folder)
   └── (active project) ─→ FileExplorer (this feature)
                              ├── Root FolderNode (relPath "", immutable, non-collapsible)
                              │      └── children: Node[]  (lazy, live, folders-first A–Z, excludes applied)
                              │             └── FolderNode / FileNode (recursive; isSymlink shown not followed)
                              ├── Toolbar (Expand all / Collapse all / New folder)
                              ├── TreeViewState  (expanded, selection, scroll — session)
                              ├── Clipboard      (cut/copy buffer — session)
                              └── emits OpenFileIntent (→ future editor)

IFileSystem        (core seam) ──impl──▶ NodeFileSystem (UI main: fs.promises + shell.trashItem)
IShellIntegration  (core seam) ──impl──▶ ElectronShellIntegration (UI main: shell.showItemInFolder/openPath)
IFileWatcher (core seam, 003)  ──impl──▶ NodeFileWatcher (UI main) ──push──▶ renderer (files.onChange)
```
