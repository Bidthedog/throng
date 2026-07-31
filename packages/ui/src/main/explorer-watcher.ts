/**
 * ExplorerWatcher — watches the active project's root folder via the IFileWatcher
 * seam and emits a debounced `files.changed` signal so the renderer re-reads the
 * affected tree (004, US2, T031/T033, research D4). Re-points on project switch.
 * The renderer is sandboxed, so the watch + push live in UI main.
 */
import { dirname, relative, sep } from 'node:path';
import type { Disposable, IFileWatcher } from '@throng/core';

export class ExplorerWatcher {
  private current: Disposable | null = null;

  constructor(
    private readonly watcher: IFileWatcher,
    private readonly emit: (evt: { relDir: string }) => void,
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
      (changedPath) => {
        this.emit({ relDir: toRelDir(absRoot, changedPath) });
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

/** Root-relative POSIX path of the directory containing the changed entry. */
function toRelDir(root: string, changedPath: string): string {
  const rel = relative(root, dirname(changedPath));
  return rel.split(sep).join('/'); // '' when the change is directly under the root
}
