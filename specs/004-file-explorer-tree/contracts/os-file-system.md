# Contract — `IFileSystem` (OS seam) + reused `IFileWatcher`

New abstraction in `@throng/core/abstractions` (Principle II). Concrete `NodeFileSystem` lives in **UI
main**; a reusable **contract test suite** (`core/testing/file-system-contract.ts`) is run against it
as a temp-dir integration test. All paths are **absolute, OS-form**. The renderer never calls this
directly — it goes through the preload bridge (contracts/files-bridge.md).

## IFileSystem

```
interface DirEntry {
  name: string;                 // leaf name
  kind: "file" | "folder";
  isSymlink: boolean;           // shown with an indicator; never followed out of root
  hasChildren?: boolean;        // folders only — cheap hint for the chevron (may be approximate)
}

interface IFileSystem {
  // List immediate children of dir (folders + files). Does NOT recurse. Sort is the caller's job (core).
  list(dir: string): Promise<DirEntry[]>;

  // Lightweight stat (kind + isSymlink + size/mtime optional). Throws/ rejects if path is gone.
  stat(path: string): Promise<{ kind: "file" | "folder"; isSymlink: boolean }>;

  // Resolve the real (canonical) path, following symlinks — used for root-confinement checks.
  realpath(path: string): Promise<string>;

  // Rename a leaf in place (same parent). Rejects on collision (caller pre-validates via core naming).
  rename(path: string, newName: string): Promise<string>;          // returns new absolute path

  // Move src INTO destDir (keeps name). Caller guarantees confinement + de-dup.
  move(src: string, destDir: string): Promise<string>;

  // Copy src INTO destDir, optionally under newName (de-duped by caller). Recursive for folders.
  copy(src: string, destDir: string, newName?: string): Promise<string>;

  // Permanent, irreversible delete (fs.rm recursive). Used only in deleteMode = "permanent".
  delete(path: string): Promise<void>;

  // Move to the OS Recycle Bin / Trash (recoverable). Used in deleteMode = "recycle" (default).
  // Surfaces a non-fatal error (rejects) if the OS refuses (e.g. some network paths) — caller leaves the item.
  trash(path: string): Promise<void>;

  exists(path: string): Promise<boolean>;
}
```

**Contract tests** (temp dir): `list` returns entries with correct `kind`/`isSymlink` (incl. a created
symlink) and excludes nothing (filtering is core's job); `stat`/`realpath` resolve a symlink to its
target; `rename`/`move`/`copy` produce the expected on-disk result and reject a collision/out-of-root
target; `copy` of a folder is recursive; `delete` removes permanently; `trash` removes from the live
folder (and, where assertable, is recoverable) and rejects non-fatally when trashing is impossible;
`exists` reflects reality. Filesystem-touching tests run as **integration**, not pure unit.

## IFileWatcher (003, reused unchanged)

```
interface IFileWatcher {
  watch(dir: string, onChange: (path: string) => void): Disposable;   // debounced create/modify/delete
}
```

UI main's `explorer-watcher` calls `watch(activeProjectRoot, …)`, re-points it on project switch, and
pushes a debounced `files.changed` event to renderers (contracts/files-bridge.md). The existing
`file-watcher-contract.ts` suite already covers it.

## Wiring

UI-main composition root binds `IFileSystem` → `NodeFileSystem` (uses `fs.promises` +
`shell.trashItem`) and reuses the bound `IFileWatcher`. The renderer reaches these only via the
`files.*` bridge. Confinement is enforced in UI main by resolving `realpath` for every source/target
and checking it against the project root's real path with the pure `path-rules` functions before any
mutation.
