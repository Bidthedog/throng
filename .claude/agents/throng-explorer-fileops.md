---
name: throng-explorer-fileops
description: Use for the project file explorer and every filesystem operation the app performs — the tree, watching, drag and drop, rename/move/copy/delete, the recycle bin and undo of file operations, path normalisation and exclusion rules, and the project root-exclusivity constraint. Triggers include a tree that does not refresh, a watcher that dies or misses a path, a move or delete that half-completes, drag-and-drop between panels or from the OS, mixed path separators, and "the same file appears twice".
---

# throng — file explorer, filesystem operations and undo

## Where the code is

- **Domain** — `packages/core/src/explorer/` (`node`, `expand`, `drag`, `tree-drag-payload`,
  `target`, `naming`, `exclude`, `path-rules`, `path-forms`, `open-intent`),
  `packages/core/src/fs/path-id.ts`, `packages/core/src/fileop-undo/undo-stack.ts`.
- **Main process** — `files-service.ts`, `files-ipc.ts`, `node-file-system.ts`,
  `node-file-watcher.ts`, `explorer-watcher.ts`, `recycle-bin-restore.ts`, `undo-service.ts`.
- **Renderer** — `renderer/explorer/` (`file-tree.tsx` on react-arborist, `tree-node.tsx`,
  `tree-icons.ts`, `tree-drag-store.ts`, `use-explorer-data.ts`, `explorer-commands.ts`,
  `explorer-keybindings.ts`, `context-menu-items.ts`, `error-boundary.tsx`).
- **Persistence** — `fileop-undo-repository.ts` (migration v8).

## Rules that bind

- **Project root exclusivity (Principle I).** No two projects share a root, and no project's root may
  be an ancestor or descendant of another's — enforced on both create and edit, so every file belongs
  to exactly one project. Any new path-accepting flow must uphold it.
- Each project exposes its root as a navigable workspace tree scoped to that project; nothing outside
  the root is reachable through it.
- File operations must be **undoable** where the user can trigger them destructively, through the
  fileop-undo stack, and deletes go to the recycle bin rather than vanishing.

## Traps this code has already hit

- **Mixed path separators.** Paths reach this layer as both `C:/x/y` and `C:\x\y`; comparisons and map
  keys must normalise first (`path-forms.ts`, `path-id.ts`). Issue #229 came from exactly this, with
  producers in `file-tree.tsx` and a trap in the editor's `language-override.ts`.
- **Watcher liveness.** A watcher can die silently or be handed a path that no longer exists — see
  `file-watcher-liveness`, `file-watcher-error-recovery` and `file-watcher-missing-path` tests. A dead
  watcher shows as a tree that simply stops updating, which reads as a UI bug.
- **react-arborist rows shift** under async updates: auto-reveal of the active file can move the
  selection out from under a click. Assert on selection state rather than position.
- **Partial failure.** A multi-file move or delete can half-complete; surface a cause per item rather
  than one aggregate success. See `files-delete-mixed`, `files-move-bracket`, `files-move-same-folder`
  and `files-service-cause` integration tests, and hand presentation to
  `throng-failure-notices`.

## Testing altitude

Integration is the natural layer — these tests run against a real temp filesystem and a real watcher,
single-fork. Add E2E only for what the user sees (context menu, drag ghost, tree state after an
operation).

## Not yours

Editor-side reaction to a moved or deleted open file → `throng-editor-documents`. Notice and banner
presentation → `throng-failure-notices`. Tree chrome and theming → `throng-renderer-ui`.
