/**
 * IFileSystem (Principle II) — reads, mutates, and resolves filesystem entries
 * for the File Explorer tree (004). The abstract contract only; the concrete
 * fs.promises-backed implementation lives in the UI main process (research D1/D9).
 * Paths are absolute, OS-form. No OS calls here.
 */

/** One immediate child of a directory. */
export interface DirEntry {
  /** Leaf name (no separators). */
  name: string;
  kind: 'file' | 'folder';
  /** Shown with an indicator; never followed out of the project root (FR-037). */
  isSymlink: boolean;
  /** Folders only — cheap hint so a chevron can show without reading grandchildren. */
  hasChildren?: boolean;
}

export interface IFileSystem {
  /** Immediate children of `dir` (no recursion; sorting is the caller's job). */
  list(dir: string): Promise<DirEntry[]>;
  /** Create a directory at `path` (its parent must exist). */
  mkdir(path: string): Promise<void>;
  /** Lightweight stat; rejects if the path is gone. */
  stat(path: string): Promise<{ kind: 'file' | 'folder'; isSymlink: boolean }>;
  /** Canonical real path (follows symlinks) — used for root-confinement checks. */
  realpath(path: string): Promise<string>;
  /** Rename a leaf in place (same parent); returns the new absolute path. */
  rename(path: string, newName: string): Promise<string>;
  /** Move `src` INTO `destDir` (keeps name); returns the new absolute path. */
  move(src: string, destDir: string): Promise<string>;
  /** Copy `src` INTO `destDir`, optionally under `newName`; recursive for folders. */
  copy(src: string, destDir: string, newName?: string): Promise<string>;
  /** Permanent, irreversible delete (deleteMode = "permanent" only). */
  delete(path: string): Promise<void>;
  /** Move to the OS Recycle Bin / Trash (deleteMode = "recycle", default). */
  trash(path: string): Promise<void>;
  /**
   * Restore a previously-trashed item back to its original path (024 US3, #85 — undo of a delete).
   * `deletedAt` (epoch-ms) disambiguates when the recycle bin holds several entries with the same
   * original path — the closest match at or before that time is restored. Rejects when the item can
   * no longer be recovered (purged) or the platform seam is unimplemented, so the caller turns it
   * into the FR-008 refusal and changes nothing.
   */
  restoreFromTrash(originalPath: string, deletedAt: number): Promise<void>;
  exists(path: string): Promise<boolean>;
  /** Raw bytes of a file (editor load, 006). Rejects if the path is gone. */
  readBytes(path: string): Promise<Uint8Array>;
  /** Overwrite `path` with raw bytes (editor save, 006); creates it if absent. */
  writeBytes(path: string, bytes: Uint8Array): Promise<void>;
  /** File size in bytes (editor large-file guard, 006 FR-062). */
  size(path: string): Promise<number>;
  /**
   * Last-write time (epoch ms) AND size, from one stat. Rejects if the path is gone.
   *
   * 043 FR-045a — a per-file "has this changed since I read it" stamp. Both halves, deliberately:
   * an edit that swaps one word for another of the same length moves only the time, and a coarse
   * filesystem clock can leave two writes inside the same tick, where only the size differs. Either
   * alone lets a real change look like no change.
   *
   * Distinct from {@link size} rather than folded into {@link stat}, because the two answer
   * different questions: `stat` says WHAT an entry is (and follows the tree's symlink rules), this
   * says WHEN its content last moved. One call rather than two so the pair cannot be read either
   * side of a write.
   */
  modifiedAt(path: string): Promise<{ mtimeMs: number; size: number }>;
}
