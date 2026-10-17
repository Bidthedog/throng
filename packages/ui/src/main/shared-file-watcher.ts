/**
 * SharedFileWatcher — one underlying watch per directory, however many readers want it (#272, #482).
 *
 * Every consumer in UI main used to construct its own `NodeFileWatcher`, so the active project's
 * root was recursively watched once for the tree, once (or twice, per exclusion state) for the file
 * index, and again by every editor and preview open on a file directly under it. Each of those is a
 * separate set of OS handles and a separate debounce reacting to the SAME events, and each report
 * then triggered its reader's own re-read.
 *
 * This decorator keeps the {@link IFileWatcher} seam exactly as it is and shares the watch behind it:
 * the first reader of a directory opens the watch, later readers join it, and the last one to leave
 * closes it. Directories are keyed in their comparable form, because the same root reaches this layer
 * spelled both `C:/x/y` and `C:\x\y` (#229).
 *
 * A failure is the directory's, not a reader's: every reader is told, and the dead watch is forgotten
 * so the next reader to ask opens a fresh one rather than joining a corpse.
 */
import { normaliseForCompare, type Disposable, type IFileWatcher, type WatchBatch, type WatchOptions } from '@throng/core';

/**
 * True when a report's paths name `target` (#482). Compared in comparable form, since the watcher
 * spells paths as the disk does and a document keeps the spelling it was opened with.
 */
export function namesPath(paths: readonly string[], target: string): boolean {
  const key = normaliseForCompare(target);
  return paths.some((p) => normaliseForCompare(p) === key);
}

interface Reader {
  onChange: (path: string, batch?: WatchBatch) => void;
  onFailed?: (reason: string) => void;
}

interface SharedWatch {
  handle: Disposable | null;
  readers: Set<Reader>;
}

export class SharedFileWatcher implements IFileWatcher {
  private readonly watches = new Map<string, SharedWatch>();

  constructor(private readonly inner: IFileWatcher) {}

  /** How many underlying watches are open — one per watched directory. */
  get openWatches(): number {
    return this.watches.size;
  }

  watch(
    dir: string,
    onChange: (path: string, batch?: WatchBatch) => void,
    options?: WatchOptions,
  ): Disposable {
    const key = normaliseForCompare(dir);
    const reader: Reader = { onChange, onFailed: options?.onFailed };
    let shared = this.watches.get(key);
    if (!shared) {
      const created: SharedWatch = { handle: null, readers: new Set([reader]) };
      shared = created;
      this.watches.set(key, created);
      created.handle = this.inner.watch(
        dir,
        (path, batch) => {
          // A snapshot: a reader may dispose itself, or another, from inside its own callback.
          for (const r of [...created.readers]) r.onChange(path, batch);
        },
        {
          onFailed: (reason) => {
            if (this.watches.get(key) === created) this.watches.delete(key);
            created.handle = null;
            for (const r of [...created.readers]) r.onFailed?.(reason);
            created.readers.clear();
          },
        },
      );
    } else {
      shared.readers.add(reader);
    }
    const owner = shared;
    let disposed = false;
    return {
      dispose: () => {
        if (disposed) return;
        disposed = true;
        owner.readers.delete(reader);
        if (owner.readers.size > 0) return;
        owner.handle?.dispose();
        owner.handle = null;
        if (this.watches.get(key) === owner) this.watches.delete(key);
      },
    };
  }
}
