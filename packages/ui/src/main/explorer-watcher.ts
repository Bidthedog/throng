/**
 * ExplorerWatcher — watches the active project's root folder via the IFileWatcher
 * seam and emits a debounced `files.changed` signal so the renderer re-reads the
 * affected tree (004, US2, T031/T033, research D4). Re-points on project switch.
 * The renderer is sandboxed, so the watch + push live in UI main.
 */
import { dirname, relative, sep } from 'node:path';
import type { Disposable, IFileWatcher, WatchBatch } from '@throng/core';

/**
 * What `throng:files:changed` carries.
 *
 * `relDir` is the directory of the report's last path, exactly as it always was. `relDirs` is every
 * directory the report touched (#482) — present only when the watcher could name them all, and only
 * when there are few enough to be worth sending. Its absence means "re-read whatever you hold",
 * which is what every signal used to mean.
 */
export interface FilesChangedEvent {
  relDir: string;
  relDirs?: string[];
}

/** Past this many directories a report goes out without `relDirs`, and readers re-read everything. */
const MAX_WIRE_DIRS = 1000;

export class ExplorerWatcher {
  private current: Disposable | null = null;

  constructor(
    private readonly watcher: IFileWatcher,
    /**
     * One directory changed under the watched root.
     *
     * `absRoot` rides beside the event rather than inside it, and that is 043 FR-045d's whole cost:
     * the Find in Files scan is a SECOND consumer of this one watch (research R6), and it holds
     * results per project, so a root-relative directory with no root is unattributable. Keeping it
     * out of the payload keeps `throng:files:changed` on the wire exactly as it was — the broadcast
     * site passes `evt` on unchanged and uses the root for itself.
     *
     * `relPaths` is every root-relative path the report named, or null when the watcher could not
     * name them all (#482). It stays off the wire too: only the Find in Files scan needs it.
     */
    private readonly emit: (
      evt: FilesChangedEvent,
      absRoot: string,
      relPaths: readonly string[] | null,
    ) => void,
    /**
     * The watch on the active root failed and could not be re-established (026 / #186, FR-010a).
     *
     * Optional so the two existing tests construct this unchanged. When absent the tree simply
     * stops updating — which is the behaviour this feature exists to stop being silent about, so
     * production must supply it.
     */
    private readonly onFailed?: (root: string, reason: string) => void,
  ) {}

  /** Watch `absRoot` (or stop watching when null). Replaces any prior watch. */
  setRoot(absRoot: string | null): void {
    this.current?.dispose();
    this.current = null;
    if (!absRoot) return;
    this.current = this.watcher.watch(
      absRoot,
      (changedPath, batch) => {
        const relDir = toRelDir(absRoot, changedPath);
        const relPaths = batch?.complete ? toRelPaths(absRoot, batch) : null;
        if (relPaths === null) {
          this.emit({ relDir }, absRoot, null);
          return;
        }
        const relDirs = [...new Set(batch!.paths.map((p) => toRelDir(absRoot, p)))];
        this.emit(relDirs.length <= MAX_WIRE_DIRS ? { relDir, relDirs } : { relDir }, absRoot, relPaths);
      },
      // Bound to THIS root by the closure. A failure arriving after `setRoot` moved on is
      // impossible: disposing the old handle latches it, so a stale root can never raise a notice
      // about a project the user has already left.
      { onFailed: (reason) => this.onFailed?.(absRoot, reason) },
    );
  }

  dispose(): void {
    this.current?.dispose();
    this.current = null;
  }
}

/** Every path a complete batch named, root-relative POSIX, or null if any lies outside the root. */
function toRelPaths(root: string, batch: WatchBatch): string[] | null {
  const out: string[] = [];
  for (const p of batch.paths) {
    const rel = relative(root, p).split(sep).join('/');
    if (rel === '' || rel.startsWith('..')) return null; // the root itself: everything is news
    out.push(rel);
  }
  return out;
}

/** Root-relative POSIX path of the directory containing the changed entry. */
function toRelDir(root: string, changedPath: string): string {
  const rel = relative(root, dirname(changedPath));
  return rel.split(sep).join('/'); // '' when the change is directly under the root
}
