/**
 * A recursive directory watch built from one non-recursive watch per directory (#585).
 *
 * WHY THIS EXISTS. On Linux, Node's `fs.watch(dir, { recursive: true })` is not native: it is a
 * JavaScript emulation (`internal/fs/recursive_watch`) that opens one inotify watch and one `stat`
 * for EVERY FILE under the root, and on every deletion scans its whole map of watched paths for
 * children of the deleted one. Deleting N entries from a tree of N therefore costs O(N²) on the
 * thread hosting the watch — measured at 1.6 s of event-loop stall for a 12,000-entry tree and
 * minutes for a 40,000-entry `node_modules`, during which the whole UI is frozen. It also spends an
 * inotify watch per file, so two watches over one `node_modules` approach the per-user limit.
 *
 * This watch keeps the same observable contract — `(event, filename-relative-to-root)` for every
 * change anywhere under the root — but:
 *
 * - **watches directories only.** inotify on a directory already reports creates, deletes and
 *   writes of its direct children, so a file needs no watch of its own;
 * - **indexes its watches as a tree.** A directory knows its watched child directories, so removing
 *   one costs the size of the subtree removed — never a scan of everything watched.
 *
 * Each event costs at most one `lstat`, and only for a `rename` of a name not already known to be a
 * watched directory (to learn whether a directory appeared).
 */
import { lstatSync, readdirSync, watch, type FSWatcher } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { logExpected } from '@throng/core';

/** What a watch over a tree reports: the event and the changed path, relative to the root. */
export type TreeWatchListener = (event: string, filename: string | null) => void;

/** A live recursive watch. Closing it is idempotent. */
export interface TreeWatch {
  close(): void;
}

interface WatchedDir {
  watcher: FSWatcher;
  /** Names of the child directories that are themselves watched. */
  children: Set<string>;
}

const errnoOf = (error: unknown): string | undefined => (error as NodeJS.ErrnoException)?.code;

/**
 * Watches `root` and everything below it.
 *
 * Throws synchronously, as `fs.watch` does, when the root itself cannot be watched (an `ENOENT`
 * for a root that is not there). A failure that happens later — the root removed, the machine's
 * watch limit reached while following a new directory — is reported once through `onError`, after
 * which the watch reports nothing more and should be closed.
 */
export function watchDirectoryTree(
  rootPath: string,
  listener: TreeWatchListener,
  onError: (error: NodeJS.ErrnoException) => void,
): TreeWatch {
  /** Resolved once: children are keyed by `join`, which would not match a root spelled with a trailing separator. */
  const root = resolve(rootPath);
  const dirs = new Map<string, WatchedDir>();
  let closed = false;

  const fail = (error: NodeJS.ErrnoException): void => {
    if (closed) return;
    close();
    onError(error);
  };

  /** Stops watching `dir` and every directory under it. Costs the size of that subtree. */
  const unwatch = (dir: string): void => {
    const node = dirs.get(dir);
    if (!node) return;
    for (const child of node.children) unwatch(join(dir, child));
    node.watcher.close();
    dirs.delete(dir);
    dirs.get(dirname(dir))?.children.delete(basename(dir));
  };

  /**
   * Is `path` a directory right now? lstat, so a symlinked directory is not followed.
   *
   * A missing path is the ordinary answer here — a bulk delete asks about thousands of them — so
   * it comes back as `undefined` rather than as a thrown error, and costs no exception and no log
   * line. Anything else (a permission refusal, say) is recorded once per call and read as "no".
   */
  const isDirectory = (path: string): boolean => {
    try {
      return lstatSync(path, { throwIfNoEntry: false })?.isDirectory() ?? false;
    } catch (error) {
      logExpected('directory-tree-watch: probe', 'an unreadable entry cannot be watched into, so it is treated as not a folder', error);
      return false;
    }
  };

  /**
   * Renamed names that may be directories needing a watch, by the directory they were renamed in.
   *
   * Checked once per turn of the event loop rather than per event. A bulk delete delivers its
   * events in large batches, and by the time the batch has been handed out most of the directories
   * it touched are already gone and unwatched — so their names cost nothing, where checking each
   * name as it arrived would cost a syscall per deleted file.
   */
  const pending = new Map<string, Set<string>>();
  let flushScheduled = false;

  const flush = (): void => {
    flushScheduled = false;
    const batch = [...pending];
    pending.clear();
    for (const [dir, names] of batch) {
      if (closed) return;
      if (!dirs.has(dir)) continue; // removed since: nothing under it can need watching
      for (const name of names) {
        const child = join(dir, name);
        if (dirs.has(child)) {
          // A watched directory was renamed or deleted (or replaced). Drop its branch if so.
          if (!isDirectory(child)) unwatch(child);
        } else if (isDirectory(child)) {
          addDir(child, true); // a directory appeared
        }
      }
    }
  };

  const queue = (dir: string, name: string): void => {
    let names = pending.get(dir);
    if (!names) {
      names = new Set();
      pending.set(dir, names);
    }
    names.add(name);
    if (!flushScheduled) {
      flushScheduled = true;
      setImmediate(flush);
    }
  };

  const onDirEvent = (dir: string, event: string, name: string | Buffer | null): void => {
    if (closed) return;
    if (name === null || name === undefined) {
      listener(event, relative(root, dir) || null);
      return;
    }
    const entry = name.toString();
    if (dir !== root && event === 'rename' && entry === basename(dir) && !isDirectory(dir)) {
      // The directory's OWN removal: inotify reports it on the directory's watch, named by the
      // directory's basename, which reads as `<dir>/<dir-name>` — a path that never existed. Its
      // parent's watch reports the real path; this one only ends the branch. (A real child of the
      // same name is told apart by asking whether the directory is still there.)
      unwatch(dir);
      return;
    }
    const child = join(dir, entry);
    if (dir === root && event === 'rename' && !isDirectory(root)) {
      // The root itself went away. inotify reports that on the root's own watch as a `rename`
      // naming the root's basename, which a child may share, so the disk is asked rather than the
      // name trusted. It is an absence, reported as one, so the caller can wait for it to return.
      fail(
        Object.assign(new Error(`ENOENT: watched directory removed, ${root}`), {
          code: 'ENOENT',
        }) as NodeJS.ErrnoException,
      );
      return;
    }
    listener(event, relative(root, child));
    if (event === 'rename') queue(dir, entry);
  };

  /**
   * Starts watching `dir` and walks into its subdirectories.
   *
   * `announce` reports every entry found by the walk. A directory created after the watch began
   * (`mkdir -p a/b && touch a/b/x`) may already hold entries by the time its watch is armed; no
   * event will ever describe them, so the walk does.
   */
  function addDir(dir: string, announce: boolean): void {
    if (closed || dirs.has(dir)) return;
    let watcher: FSWatcher;
    try {
      watcher = watch(dir, { persistent: true }, (event, name) => onDirEvent(dir, event, name));
    } catch (error) {
      if (dir === root) throw error;
      // The machine's watch limit is a failure of the whole watch, never a silent gap in it.
      if (errnoOf(error) === 'ENOSPC') {
        fail(error as NodeJS.ErrnoException);
        return;
      }
      return; // gone again already, or unreadable: nothing under it can be watched
    }
    const node: WatchedDir = { watcher, children: new Set() };
    dirs.set(dir, node);
    if (dir !== root) dirs.get(dirname(dir))?.children.add(basename(dir));
    watcher.on('error', (error: NodeJS.ErrnoException) => {
      if (dir === root) {
        fail(error);
        return;
      }
      unwatch(dir); // a subdirectory's watch failing (usually: it was removed) ends that branch only
    });

    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch (error) {
      if (dir === root) {
        fail(error as NodeJS.ErrnoException);
        return;
      }
      logExpected('directory-tree-watch: read folder', 'a folder removed or locked as it was reached ends only its own branch', error);
      unwatch(dir);
      return;
    }
    for (const entry of entries) {
      if (closed) return;
      const child = join(dir, entry.name);
      if (announce) listener('rename', relative(root, child));
      if (entry.isDirectory()) addDir(child, announce);
    }
  }

  function close(): void {
    if (closed) return;
    closed = true;
    for (const node of dirs.values()) node.watcher.close();
    dirs.clear();
  }

  addDir(root, false);
  return { close };
}
