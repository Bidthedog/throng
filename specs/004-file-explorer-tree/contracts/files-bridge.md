# Contract — `files.*` preload bridge (renderer ↔ UI main)

The tree's IPC is the **preload bridge**, not daemon JSON-RPC (research D1). It mirrors the existing
`config` / `subWorkspace` / `panel` bridge channels: invoke methods (renderer → UI main) plus a push
subscription (UI main → renderer). UI main validates every request, **resolves real paths**, and
enforces **project-root confinement** before touching disk. Shapes are plain JSON over the sandboxed
`contextBridge`.

## `window.throng.files`

```
interface FilesBridge {
  // Point the explorer watcher + reads at a project's root (called on project switch). Null = no project.
  setRoot(projectId: string | null): void;

  // List immediate children of a directory (root-relative ""; subfolder rel path otherwise).
  // Excludes are applied by the renderer/core (not here) so the raw listing is returned.
  list(relDir: string): Promise<{ entries: FileEntry[] } | { error: string }>;

  rename(relPath: string, newName: string): Promise<OkOrError>;
  move(srcRelPaths: string[], destRelDir: string): Promise<OkOrError>;   // cut+paste / drag-move
  copy(srcRelPaths: string[], destRelDir: string): Promise<OkOrError>;   // copy+paste / drag-copy (de-dup names)
  delete(relPaths: string[], mode: "recycle" | "permanent"): Promise<OkOrError>;
  newFolder(destRelDir: string): Promise<{ relPath: string } | { error: string }>;  // creates de-duped "New folder"
  reveal(relPath: string): Promise<OkOrError>;   // file → reveal+select in parent; folder/root → open contents

  // Push: fires (debounced) when the watched root changes (external or in-app). `relDir` = affected dir (or "" = root).
  onChange(cb: (evt: { relDir: string }) => void): () => void;  // returns unsubscribe
}

type FileEntry = { name: string; kind: "file" | "folder"; isSymlink: boolean; hasChildren?: boolean };
type OkOrError = { ok: true } | { error: string };
```

## Rules enforced in UI main (server side of the bridge)

- **Confinement**: every `relPath`/`relDir` is joined to the active project root and **real-path
  resolved**; any source or target whose real path is outside the root, or a move/copy into a node's
  own descendant, is **rejected** with `{ error }` (FR-022/FR-037). The **root itself** cannot be
  renamed/moved/deleted (`rename`/`move`/`delete` on `""` → error) (FR-023). `reveal` is allowed on
  the root.
- **Target resolution** is done in the renderer via core `target.ts` before calling `move`/`copy`/
  `newFolder` (the bridge receives an explicit `destRelDir`).
- **Naming**: `copy`/`newFolder` de-dup names via core `naming.ts` (UI main applies the final name);
  `rename` collisions are rejected.
- **Delete**: `mode` comes from `settings.explorer.deleteMode`; `recycle` → `IFileSystem.trash`,
  `permanent` → `IFileSystem.delete` (the renderer shows the confirm dialog before calling permanent).
- **Errors** are returned as `{ error }` (non-fatal); the renderer surfaces a notice and re-reads to
  stay consistent (FR-025).

## Notes

- No `ipc-contract` package change and **no daemon RPC** — the daemon is uninvolved (research D1).
- The bridge is additive to the existing preload surface; types live with the other renderer bridge
  declarations (`global.d.ts`) and the preload (`preload.cts`).
- **Contract coverage**: bridge behaviour is exercised by UI-main integration tests (handlers over a
  temp dir) and E2E; the pure decision logic it calls (target/naming/path-rules/exclude) is unit-tested
  in core.
