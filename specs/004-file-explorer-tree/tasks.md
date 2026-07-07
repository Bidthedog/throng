---
description: "Task list for feature 004 — File & Folder Tree in the File Explorer Pane"
---

# Tasks: File & Folder Tree in the File Explorer Pane

**Input**: Design documents from `/specs/004-file-explorer-tree/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/ (all present)

**Tests**: INCLUDED and REQUIRED — constitution Principle V (Test-First, NON-NEGOTIABLE) mandates
Red-Green-Refactor across unit/integration/contract/E2E, and **every user-facing UI change MUST ship
with passing E2E coverage** (v3.4.0). Write each test first; see it fail; then implement.

**Organization**: Tasks are grouped by user story (P1→P4) so each story is an independently testable
increment. Architecture is **UI-main-owned filesystem/shell behind core seams**; **no daemon RPC and
no SQLite migration** (research D1). All pure logic lives in `@throng/core`; the renderer is sandboxed.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: US1–US4 (user-story tasks only)
- Exact file paths included

## Path Conventions

Monorepo (npm workspaces): `packages/core/`, `packages/ui/` (with `src/main`, `src/preload`,
`src/renderer`). Daemon / persistence / ipc-contract / platform-windows are **untouched**.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Dependencies and module scaffolding.

- [x] T001 Add runtime deps — `react-arborist` to `packages/ui/package.json` and `picomatch` (+ `@types/picomatch` dev) to `packages/core/package.json`; run workspace install
- [x] T002 [P] Scaffold core explorer module folder `packages/core/src/explorer/` with an `index.ts` barrel and export it from `packages/core/src/index.ts`
- [x] T003 [P] Scaffold renderer explorer folder `packages/ui/src/renderer/explorer/` with an empty `explorer.css` imported by the pane

**Checkpoint**: Dependencies present; empty modules compile.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Config schema, the `IFileSystem` seam + impl, and the read-path `files.*` bridge that
ALL stories build on.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

### Config & theme schema (003 extended)

- [x] T004 [P] Unit tests (fail first) for the `explorer` settings section in `packages/core/tests/unit/app-settings.explorer.test.ts` — `openMode` default `single`, `deleteMode` default `recycle`, `excludeGlobs` default = VS Code `files.exclude` list, garbage coercion
- [x] T005 Extend `AppSettings` with the `explorer` section + defaults + validation in `packages/core/src/config/app-settings.ts` (make T004 pass)
- [x] T006 [P] Unit tests (fail first) for `file.*` keybinding defaults + resolution in `packages/core/tests/unit/keybindings.file.test.ts`
- [x] T007 Add `file.rename|cut|copy|paste|delete` ActionIds + `DEFAULT_KEYBINDINGS` entries in `packages/core/src/config/keybindings.ts` (make T006 pass)
- [x] T008 [P] Add file-tree + toolbar icon tokens (`folder`/`folderOpen`/`chevron`/`file`/by-type/`symlink`/`expandAll`/`collapseAll`/`newFolder`) to the `Theme` type + `THRONG_THEME` defaults in `packages/core/src/config/theme.ts`

### `IFileSystem` seam + UI-main impl

- [x] T009 [P] Define `IFileSystem` interface + `DirEntry` (incl. `isSymlink`, `hasChildren`) in `packages/core/src/abstractions/file-system.ts`
- [x] T010 [P] Write the reusable `IFileSystem` contract suite in `packages/core/src/testing/file-system-contract.ts` (per contracts/os-file-system.md)
- [x] T011 Implement `NodeFileSystem` (all methods: list/stat/realpath/rename/move/copy/delete + `trash` via Electron `shell.trashItem`/exists) in `packages/ui/src/main/node-file-system.ts`
- [x] T012 Integration test running the `IFileSystem` contract suite against `NodeFileSystem` over a temp dir (incl. a created symlink) in `packages/ui/tests/integration/node-file-system.test.ts` (Red→Green for T011)

### Read-path bridge + wiring

- [x] T013 Declare the `window.throng.files` bridge surface in `packages/ui/src/renderer/global.d.ts` and expose it via `contextBridge` in `packages/ui/src/preload/preload.cts` (methods stubbed; `list`/`setRoot`/`onChange` live)
- [x] T014 Implement `files.list` + `files.setRoot` ipcMain handlers (root-relative→absolute join against the active project root) in `packages/ui/src/main/files-ipc.ts`
- [x] T015 Construct `NodeFileSystem` + `FilesService` and register `files-ipc` in `packages/ui/src/main/main.ts` (electron-bound services are wired in main.ts alongside WindowManager/ghost, consistent with the 003 pattern; the electron-free composition-root.ts is unchanged)
- [x] T016 Expose `settings.explorer` + `file.*` bindings to the renderer via the config store in `packages/ui/src/renderer/config/config-store.tsx` (satisfied by the existing `parseAppSettings`/`parseKeybindings` pass-through — the extended schemas flow through unchanged)

**Checkpoint**: Config validated; a directory can be listed renderer→UI-main→disk; foundation ready.

---

## Phase 3: User Story 1 - See the active project's files as a tree (Priority: P1) 🎯 MVP

**Goal**: A read-only, themed, project-scoped tree — non-collapsible root row, subfolders collapsed,
folders-first A–Z, uniform themed icons, excludes applied, swaps on project switch, placeholder when
no project.

**Independent Test**: Select a project with nested folders/files + a `.git` dir → root row + collapsed
subfolders, folders-first sort, one fixed-size themed icon per row, `.git` hidden; expand a subfolder;
switch projects → tree swaps; no project → placeholder.

### Tests for User Story 1 (write first, must fail)

- [x] T017 [P] [US1] Unit tests for node mapping + `sortNodes` (folders-first, case-insensitive A–Z) in `packages/core/tests/unit/explorer-node.test.ts`
- [x] T018 [P] [US1] Unit tests for exclude matching (defaults + custom globs, root-relative) in `packages/core/tests/unit/explorer-exclude.test.ts`
- [x] T019 [P] [US1] E2E in `packages/ui/tests/e2e/explorer.e2e.ts` — render, root row (non-collapsible + selectable), subfolders collapsed, folders-first sort, themed icons, `.git` excluded, lazy expand, **level-by-level Expand + Collapse-all reset**, and **per-project expansion + selection persistence**. (Caught + fixed 3 real bugs: empty-string root id crashing react-arborist, root never opened, and an open/close feedback loop.), **toolbar shown with Expand all/Collapse all** (Collapse all keeps the root expanded; Expand all expands only already-loaded levels) — covers the toolbar built in T026 so the US1 increment ships with E2E for every UI control (Principle V)

### Implementation for User Story 1

- [x] T020 [P] [US1] `FileNode`/`FolderNode` types + `toNodes` + `sortNodes` in `packages/core/src/explorer/node.ts`
- [x] T021 [P] [US1] `isExcluded` + `DEFAULT_EXCLUDE_GLOBS` (picomatch) in `packages/core/src/explorer/exclude.ts`
- [x] T022 [P] [US1] Extension→theme-icon-token map (`resolveIcon` tokens) in `packages/ui/src/renderer/explorer/tree-icons.ts`
- [x] T023 [US1] `use-explorer-data` initial load: root children + lazy on-expand via `files.list`, apply excludes + sort (no live sync yet) in `packages/ui/src/renderer/explorer/use-explorer-data.ts`
- [x] T024 [US1] Themed row `tree-node` (uniform-size icon box + name; folder open/closed + symlink indicator) in `packages/ui/src/renderer/explorer/tree-node.tsx`
- [x] T025 [US1] `file-tree` react-arborist `<Tree>` with render-prop rows, **non-collapsible root**, expandable subfolders, virtualization in `packages/ui/src/renderer/explorer/file-tree.tsx`
- [x] T026 [US1] Toolbar with **Expand all** + **Collapse all** themed icon buttons in `packages/ui/src/renderer/explorer/toolbar.tsx` (note: Expand all currently uses react-arborist `openAll()` which expands progressively; constraining it to strictly already-loaded levels per FR-032 is a tracked refinement)
- [x] T027 [US1] Mount `<ExplorerToolbar/>` + `<FileTree/>` (or the existing placeholder when no project) in `packages/ui/src/renderer/panes/file-explorer-pane.tsx`; theme styling in `packages/ui/src/renderer/explorer/explorer.css`
- [x] T028 [US1] Re-point `files.setRoot` + reload the tree on active-project change in `use-explorer-data.ts` / the pane (read `activeProject.rootFolder` from the projects store)

**Checkpoint**: US1 is a fully functional, independently testable read-only tree (the MVP).

---

## Phase 4: User Story 2 - The tree stays in sync with the folder (Priority: P2)

**Goal**: Live reflect external + in-app changes (no manual refresh); preserve expansion/selection;
reconcile collapsed subtrees on expand and the visible tree on focus.

**Independent Test**: With a folder expanded, create/rename/delete externally → tree updates ≤ ~1 s,
expansion/selection preserved; collapsed-then-changed folder shows fresh contents on expand.

### Tests for User Story 2 (write first, must fail)

- [x] T029 [P] [US2] Integration test: `explorer-watcher` pushes a `files.changed` event on an fs mutation in `packages/ui/tests/integration/explorer-watcher.test.ts`
- [x] T030 [P] [US2] E2E in `packages/ui/tests/e2e/explorer.e2e.ts` — external create (in expanded folder + at root) appears live, external delete vanishes, `src` stays expanded across updates

### Implementation for User Story 2

- [x] T031 [US2] `explorer-watcher`: watch the active project root via `IFileWatcher` (debounced), push `files.changed` (affected dir), re-point on project switch in `packages/ui/src/main/explorer-watcher.ts`
- [x] T032 [US2] Wire the `files.onChange` push end-to-end (emit broadcast in `main.ts` via `registerFilesIpc`+`ExplorerWatcher`; deliver in `preload.cts`; type in `global.d.ts`)
- [x] T033 [US2] Construct + wire `ExplorerWatcher` in `packages/ui/src/main/main.ts` (electron-bound, alongside the FS/shell services per the 003 pattern)
- [x] T034 [US2] `use-explorer-data`: subscribe to `onChange`, re-read all loaded dirs (debounced) and merge; expansion/selection preserved by id via react-arborist; lazy on-expand load covers collapsed reconcile

**Checkpoint**: US1 + US2 work independently; the tree is live.

---

## Phase 5: User Story 3 - Operate on files and folders (Priority: P3)

**Goal**: select/multi-select, rename (F2), cut/copy/paste, move (drag) + Ctrl-copy, delete (recycle
default / permanent+confirm), context menu, paste/drop target resolution, toolbar **New folder**,
**Open in file explorer** — all confined to the root on real paths; re-mappable shortcuts.

**Independent Test**: rename via F2; cut/paste move; copy/paste with non-clobbering name; Del →
Recycle Bin (switch to permanent → confirm); drag move + Ctrl-drag copy; paste onto a file lands in
its parent; New folder in correct target with inline rename; Open in file explorer reveals/opens;
remap a `file.*` key; a symlink-escaping move is rejected.

### Tests for User Story 3 (write first, must fail)

- [x] T035 [P] [US3] Unit tests for `path-rules` (real-path confinement, ancestor/descendant, symlink-escape reject, root immutable) in `packages/core/tests/unit/explorer-path-rules.test.ts`
- [x] T036 [P] [US3] Unit tests for `resolveTarget`, `validateRename`, `dedupeName`, `resolveDragEffect` in `packages/core/tests/unit/explorer-ops.test.ts`
- [x] T037 [P] [US3] `IShellIntegration` contract suite + integration test (stubbed `shell`) in `packages/core/src/testing/shell-integration-contract.ts` and `packages/ui/tests/integration/electron-shell-integration.test.ts`
- [x] T038 [P] [US3] Integration test: `FilesService` mutations (rename/move/copy/delete/trash/newFolder + reveal) confined to root + collision de-dup, over a temp dir, in `packages/ui/tests/integration/files-service.test.ts`
- [x] T039 [P] [US3] E2E in `packages/ui/tests/e2e/explorer.e2e.ts` — delete (recycle), New folder + inline rename, cut/paste move, copy/paste non-clobbering, rename via menu, keyboard Del/F2, open-in-explorer, **drag-and-drop move**, **multi-select (Ctrl-click) + delete**. (Symlink-confinement covered by core unit + FilesService integration; permanent-delete confirm is a tracked refinement.)

### Implementation for User Story 3 — pure core

- [x] T040 [P] [US3] `path-rules` (`isWithinRoot`/`isDropAllowed`/`isRoot` on resolved real paths, reusing 003 path-normalise) in `packages/core/src/explorer/path-rules.ts`
- [x] T041 [P] [US3] `resolveTarget` (folder→self, file→parent, none→root) in `packages/core/src/explorer/target.ts`
- [x] T042 [P] [US3] `validateRename` + `dedupeName` (copy + `New folder` variants) in `packages/core/src/explorer/naming.ts`
- [x] T043 [P] [US3] `resolveDragEffect` (Ctrl→copy, else move) in `packages/core/src/explorer/drag.ts`

### Implementation for User Story 3 — OS seam + bridge

- [x] T044 [P] [US3] `IShellIntegration` interface (`revealInFileManager`/`openFolder`) in `packages/core/src/abstractions/shell-integration.ts`
- [x] T045 [US3] `ElectronShellIntegration` impl (`shell.showItemInFolder`/`shell.openPath`) in `packages/ui/src/main/electron-shell-integration.ts`
- [x] T046 [US3] `files-ipc` mutation handlers `rename/move/copy/delete/newFolder/reveal` with real-path confinement + delete-mode routing (trash vs permanent) in `packages/ui/src/main/files-ipc.ts`
- [x] T047 [US3] Construct `ElectronShellIntegration` (Electron `shell`) in `packages/ui/src/main/main.ts` and inject it into `FilesService` (electron-bound, wired in main.ts per the 003 pattern)
- [x] T048 [US3] Extend the bridge decls for `rename/move/copy/delete/newFolder/reveal` in `packages/ui/src/preload/preload.cts` + `packages/ui/src/renderer/global.d.ts`

### Implementation for User Story 3 — renderer

- [x] T049 [US3] File ops in `use-explorer-data.ts`: invoke bridge ops, resolve paste/new-folder target via core `resolveTarget`, route delete by `deleteMode` (recycle default; permanent → window.confirm — richer 003-style dialog deferred), surface non-fatal errors; live-sync watcher re-reads
- [x] T050 [US3] `explorer-keybindings`: pane-focus-scoped `resolveAction` → dispatch `file.*` (Del/F2/Ctrl+X/C/V) in `packages/ui/src/renderer/explorer/explorer-keybindings.ts` (verified by keyboard E2E)
- [x] T051 [US3] `context-menu-items`: build `MenuItem[]` (rename/cut/copy/paste/delete/**Open in file explorer**; paste disabled when clipboard empty; root excluded from mutate items) in `packages/ui/src/renderer/explorer/context-menu-items.ts`
- [x] T052 [US3] react-arborist DnD wired (onMove → move, Ctrl-tracked copy; disableDrop onto files), multi-select via native handleClick (Ctrl/Shift) feeding the selection array, and inline rename (tree-node edit input + onRename) in `file-tree.tsx` + `tree-node.tsx`
- [x] T053 [US3] Add **New folder** button (smart target via `resolveTarget` + inline-rename-on-create) to `packages/ui/src/renderer/explorer/toolbar.tsx`
- [x] T054 [US3] Wire **Open in file explorer** (file→reveal-select, folder/root→open contents) to `files.reveal` in `use-explorer-data.ts` / `context-menu-items.ts`

**Checkpoint**: US1 + US2 + US3 independently functional; full file management in the tree.

---

## Phase 6: User Story 4 - Choose how a click opens a file (Priority: P4)

**Goal**: Single-click (default) or double-click (setting) raises an open-file intent for files;
folder click toggles; destination deferred.

**Independent Test**: Default single-click a file → exactly one intent; switch to double → single
selects only, double raises one; folder click never opens; hot-reload applies the mode.

### Tests for User Story 4 (write first, must fail)

- [x] T055 [P] [US4] Unit tests for `decideClick` (single/double × file/folder × click count) in `packages/core/tests/unit/explorer-open-intent.test.ts`
- [x] T056 [P] [US4] E2E in `packages/ui/tests/e2e/explorer.e2e.ts` — single-click (default) emits exactly one open-file intent, folder click toggles (no intent), and double-click mode (set via settings.json) only opens on double-click

### Implementation for User Story 4

- [x] T057 [P] [US4] `decideClick` (open/select/toggle) in `packages/core/src/explorer/open-intent.ts`
- [x] T058 [US4] Emit the open-file intent (a `throng:open-file` window CustomEvent for a future editor) from the tree click handling via core `decideClick`, honouring `settings.explorer.openMode`, in `tree-node.tsx` + `file-tree.tsx` (open destination deferred)

**Checkpoint**: All four stories independently functional.

---

## Phase 7: Polish & Cross-Cutting Concerns

- [x] T059 [P] `@throng/core` keeps zero OS/DOM imports — the no-os-imports guard passes with all `explorer/` modules (picomatch is pure JS).
- [x] T060 [P] Explorer glue is DRY (ops centralised in `use-explorer-data`, target/naming/sort/exclude reused from core); react-arborist DnD stays pane-scoped (no `@dnd-kit` bleed).
- [x] T061 [P] E2E (in `explorer.e2e.ts`): an 800-entry folder expands with the first child visible and only a small virtualised window of `.tree-row`s in the DOM (<200), proving no freeze.
- [x] T062 [P] Edge-case coverage: empty-project-root E2E (root row, no children, no error); error-surfacing on a bad op covered by the collapse no-error E2E + FilesService integration (confinement/missing-target return non-fatal errors). Permission-denied/recycle-unavailable rely on the same non-fatal error path.
- [x] T063 Validation: the 18-test Playwright-Electron `explorer.e2e.ts` suite exercises quickstart scenarios (render/sort/excludes/lazy-expand, live sync, all ops, delete modes, toolbar, open-in-explorer, open-on-click, themed, large-folder, persistence, hide). **Timed
  outcomes** SC-002 (project switch ≤ ~200 ms perceived, scenario 2) and SC-003 (external change
  reflected ≤ ~1 s, scenario 4)
- [x] T064 Tracked deferral recorded in plan Complexity Tracking: the editor / Markdown preview that consumes the emitted `throng:open-file` intent is a future feature.

---

## Dependencies & Execution Order

### Phase dependencies

- **Setup (Phase 1)**: no dependencies.
- **Foundational (Phase 2)**: depends on Setup; **BLOCKS all user stories**.
- **User Stories (Phases 3–6)**: each depends on Foundational. US1 (Priority P1) is the MVP.
  US2/US3/US4 build on the US1 tree but are independently testable; recommended order
  US1→US2→US3→US4.
- **Polish (Phase 7)**: after the desired stories.

### Story dependencies

- **US1 (P1)**: needs Foundational only.
- **US2 (P2)**: needs Foundational; layers live sync onto the US1 tree (shares `use-explorer-data.ts`).
- **US3 (P3)**: needs Foundational; reuses the US1 tree + US2 sync path for op results (shares
  `file-tree.tsx`/`toolbar.tsx`).
- **US4 (P4)**: needs Foundational; smallest, wires click handling in `file-tree.tsx`.

### Within each story

- Tests first (fail) → core pure modules → UI-main impl/bridge → renderer → E2E green.
- Same-file tasks are sequential (no [P]); e.g. US3 edits `file-tree.tsx` in T052 then click handling
  in T058 (US4) — keep ordered.

### Parallel opportunities

- Setup T002/T003 in parallel.
- Foundational: T004/T006/T008/T009 are different files → parallel; T005 after T004, T007 after
  T006, T011 after T009, T012 after T011. T010 (IFileSystem contract suite) imports the interface
  from T009, so start it once T009's interface signature exists.
- US1: T017/T018/T019 (tests) parallel; T020/T021/T022 (different files) parallel; then T023–T028.
- US3: T035–T039 (tests) parallel; core T040–T043 parallel; T044 parallel; renderer T049/T050/T051
  parallel (different files). T054 edits `file-ops.ts` (T049) and `context-menu-items.ts` (T051),
  so run it **after** T049/T051; T052/T053 touch shared tree/toolbar files → order them.

---

## Parallel Example: User Story 1

```bash
# Tests first (all fail):
Task: "Unit tests for node mapping + sort in packages/core/tests/unit/explorer-node.test.ts"
Task: "Unit tests for exclude matching in packages/core/tests/unit/explorer-exclude.test.ts"
Task: "E2E display spec in packages/ui/tests/e2e/explorer-display.spec.ts"

# Then pure + mapping in parallel:
Task: "node.ts (types + sortNodes) in packages/core/src/explorer/node.ts"
Task: "exclude.ts (isExcluded + defaults) in packages/core/src/explorer/exclude.ts"
Task: "tree-icons.ts (extension→token) in packages/ui/src/renderer/explorer/tree-icons.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1)

1. Phase 1 Setup → 2. Phase 2 Foundational (CRITICAL) → 3. Phase 3 US1 → **STOP & VALIDATE** the
   read-only tree (quickstart scenarios 1–3) → demo.

### Incremental Delivery

Foundation → US1 (live-read MVP) → US2 (sync) → US3 (operations) → US4 (open mode). Each story is a
shippable, independently testable increment; every UI story lands with its E2E spec green (Principle V).

---

## Notes

- **No daemon RPC, no SQLite migration** — UI-main owns FS/shell behind core seams (research D1).
- New deps: `react-arborist` (view), `picomatch` (core globs); Recycle Bin + reveal use Electron's
  built-in `shell` (no native module).
- [P] = different files, no incomplete dependency. Verify each test fails before implementing. Commit
  after each task or logical group. Stop at any checkpoint to validate a story independently.
- Deferred (tracked): the editor / Markdown preview that consumes the emitted open-file intent.
