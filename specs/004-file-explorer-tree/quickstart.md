# Quickstart — File & Folder Tree in the File Explorer Pane

A validation/run guide that proves feature 004 end-to-end. Details live in
[plan.md](./plan.md), [data-model.md](./data-model.md), and [contracts/](./contracts/); this file is
how to run and what to expect. Follows the 001/002/003 monorepo conventions (npm scripts, no Docker).

## Prerequisites

- Node 20 LTS; repo bootstrapped (`npm install` at the root installs the workspaces).
- New dependencies installed: **`react-arborist`** (in `@throng/ui`) and **`picomatch`** (in
  `@throng/core`).
- A project created (002) whose **root folder** contains nested folders/files plus a `.git` folder and
  at least one symlink (to exercise excludes + symlink handling).

## Build & test (Red-Green-Refactor)

```bash
# Unit (pure core: path-rules, target, naming, drag, exclude, open-intent, sort)
npm run test -w @throng/core

# Integration (UI main: NodeFileSystem + ElectronShellIntegration + explorer watcher, temp dir)
npm run test -w @throng/ui

# Contract suites (IFileSystem, IShellIntegration) run with the UI-main integration tests
# E2E (Playwright-Electron)
npm run test:e2e -w @throng/ui
```

Each task is written **test-first** (failing test → minimal impl → refactor). UI changes are not
"done" until their **E2E** assertions pass (constitution v3.4.0 Principle V).

## Run the app

```bash
npm run dev        # or the project's existing Electron dev script (see 001/002 quickstarts)
```

## Validation scenarios (map to spec Success Criteria)

1. **Tree renders, scoped + sorted (SC-001, SC-013; FR-001/004/005/036)**
   Select a project → the File Explorer Pane shows a **non-collapsible root row** (root folder name)
   with subfolders **collapsed**; entries are **folders-first, A–Z**; each row has one **uniform
   themed icon**. Expand a subfolder → its children appear; the folder icon flips to its open state.

2. **Project switch swaps the tree (SC-002; FR-002)**
   Switch to another project → the pane replaces the tree with the new root (only that project's
   files), within ~200 ms perceived. With **no project** → the empty placeholder (FR-003).

3. **Excludes hide noise, editable + live (SC-010; FR-005a)**
   `.git` (and the other default globs) are hidden. Remove `**/.git` from `settings.json` `explorer.
   excludeGlobs` → on hot-reload `.git` appears, no restart.

4. **Live sync, external + in-app (SC-003; FR-009/010/011/013)**
   With a folder expanded, create/rename/delete a file **externally** → the tree updates within ~1 s,
   preserving your expansion/selection elsewhere. Collapse a folder, change it externally, re-expand →
   fresh contents (no stale).

5. **Operations: keyboard, mouse, menu (SC-004; FR-015–020)**
   Rename via **F2**; **Ctrl+X**/**Ctrl+V** move; **Ctrl+C**/**Ctrl+V** copy (non-clobbering name on
   collision); **drag** to move, **Ctrl+drag** to copy; multi-select with Shift/Ctrl. Paste/drop onto
   a **file** lands in its **parent**; with nothing selected, in the **root** (FR-017/019).
   Right-click → context menu offers every op (paste disabled when clipboard empty).

6. **Delete modes (SC-009; FR-018)**
   Default: **Del** sends to the **Recycle Bin** (recoverable). Set `explorer.deleteMode =
   "permanent"` → **Del** now shows a **confirmation**, then permanently deletes (not in the Recycle
   Bin).

7. **Toolbar (SC-011; FR-031/032/033)**
   **Collapse all** → subfolders collapse, root stays open. **Expand all** → already-loaded folders
   expand without freezing (no eager deep reads). **New folder** → creates a folder in the selected
   folder / selected file's parent / root, with a non-clobbering default name, entering **inline
   rename**.

8. **Open in file explorer (SC-012; FR-035)**
   Right-click a **file** → **Open in file explorer** opens the OS manager with the file **selected**
   in its parent. On a **folder** or the **root** → opens that folder's **contents**.

9. **Symlink confinement (SC-014; FR-022/037)**
   A symlink/junction shows with its indicator and is not traversed out of root; attempt to move/copy
   such that the resolved target leaves the root → **rejected** with a clear message.

10. **Open-on-click mode (SC-006; FR-026/027/028)**
    Default **single-click** a file → exactly one **open-file intent** (observe via the intent event /
    log; no editor yet). Set `explorer.openMode = "double"` → single-click only selects; double-click
    raises one intent. Clicking a folder toggles expansion (never opens).

11. **Theming hot-reload (SC-005; FR-006)**
    Edit `themes/throng.json` (or swap theme) → tree + toolbar colours/fonts/icons re-paint with no
    restart; all icons stay identically sized.

12. **Keybinding remap (SC-007; FR-021)**
    Change `file.rename` in `keybindings.json` → after hot-reload the new key triggers inline rename.

13. **Large folder responsiveness (SC-008; FR-008)**
    Open a folder with thousands of entries → scrolling/expansion stay responsive (virtualised); no
    freeze.

## Notes

- No SQLite migration and no daemon RPC are involved (the tree is live; FS/shell are UI-main-owned).
- "Open file" raises an **intent** only; the editor/preview that consumes it is a **future feature**
  (tracked deferral).
