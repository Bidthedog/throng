/**
 * SharedFileWatcher — one underlying watch per directory tree, however many readers want it
 * (#272, #482, #306).
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
 * **A folder inside a watched one joins that watch (#306).** Every watch is recursive, so a reader
 * of `root/src` — an editor on a nested file, a terminal waiting for its folder to come back — is
 * already covered by a watch on `root`. It joins it, filtered to its own subtree, instead of opening
 * a second recursive watch over part of the same tree: one watch per project root serves the tree,
 * the file index, every editor and preview, and terminal reconnect. (A watch opened first on a
 * folder and later on one above it stays two watches; folding the first into the second would mean
 * handing its readers across mid-flight, for a case project activation order makes rare.)
 *
 * A failure is the watch's, not a reader's: every reader is told, and the dead watch is forgotten
 * so the next reader to ask opens a fresh one rather than joining a corpse.
 *
 * **A folder is left out only when every reader can do without it (062 FR-051).** Each reader may say which folders it
 * ignores; the shared watch leaves out a folder only when all of them ignore it, and never a folder on the way to a
 * reader's own, or inside it. A reader joining or leaving re-asks the watch in place (`rescopeWatch`) rather than
 * opening a second one — so Quick Open's "show hidden" widens the project's one watch and narrowing it again costs
 * nothing (033 FR-069, #274), and an editor on a file inside `node_modules` is told when its file changes.
 */
import { statSync } from 'node:fs';
import {
  logExpected,
  normaliseForCompare,
  rescopeWatch,
  type Disposable,
  type IFileWatcher,
  type RescopableWatch,
  type WatchBatch,
  type WatchOptions,
} from '@throng/core';

/**
 * Is `dir` there, as a folder? The default probe for a reader below a shared watch. A missing
 * folder is an ordinary answer, not an error; anything else is recorded and read as "not there",
 * which leaves the reader waiting exactly as a watch of its own would.
 */
const folderExists = (dir: string): boolean => {
  try {
    return statSync(dir, { throwIfNoEntry: false })?.isDirectory() ?? false;
  } catch (error) {
    logExpected('shared-file-watcher: probe', 'an unreadable folder is treated as absent until it can be read', error);
    return false;
  }
};

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
  /** The folder this reader asked for, when it is BELOW the watched one; null for the watched folder itself. */
  below: string | null;
  /** That folder as the reader spelled it, for asking the disk whether it is there. */
  dir: string;
  /** `below` relative to the watched folder, comparable form; `''` for the watched folder itself. */
  belowRel: string;
  /** The folders this reader ignores, relative to ITS folder (062 FR-051); absent when it states nothing. */
  excluded?: (relPath: string) => boolean;
}

interface SharedWatch {
  key: string;
  handle: Disposable | null;
  readers: Set<Reader>;
}

/** True when `relPath` or a folder above it is one `excluded` names: a folder left out takes its subtree with it. */
function excludedOrUnder(relPath: string, excluded: (relPath: string) => boolean): boolean {
  const segments = relPath.split('/');
  for (let i = 1; i <= segments.length; i += 1) {
    if (excluded(segments.slice(0, i).join('/'))) return true;
  }
  return false;
}

/**
 * Can `reader` do without the folder `rel` (relative to the watched folder; `relKey` its comparable form)?
 *
 * Never a folder on the way to the reader's own, nor one inside it unless the reader says it ignores it. A folder
 * elsewhere is none of the reader's business — a reader that states nothing still hears about its own folder's
 * entries, which is what an editor or a preview watches a folder for.
 */
function canDoWithout(reader: Reader, rel: string, relKey: string): boolean {
  const own = reader.belowRel;
  if (own !== '' && within(own, relKey)) return false; // on the way to the reader's folder, or the folder itself
  if (own !== '' && !within(relKey, own)) return true; // elsewhere
  if (!reader.excluded) return own === ''; // a reader of the whole folder that states nothing needs only its entries
  return excludedOrUnder(own === '' ? rel : rel.slice(own.length + 1), reader.excluded);
}

/** Is `key` the folder `under`, or inside it? Both in comparable form. */
const within = (key: string, under: string): boolean => key === under || key.startsWith(`${under}/`);

/**
 * The part of a report a reader of the folder `below` should see.
 *
 * Paths inside its folder pass. A path naming the folder itself, or one ABOVE it, means the whole
 * folder may have changed in a way no path describes — a folder renamed away and back is reported,
 * on Windows, as the folder alone — so the reader is told the report is incomplete and re-reads. A
 * report that was already incomplete reaches every reader for the same reason. Anything else is
 * none of this reader's business.
 *
 * Except when the folder is GONE. A watch of the reader's own would say nothing then: it waits for
 * the folder and speaks once it is back. So a reader served by a wider watch hears nothing about
 * its folder's absence either — only the paths inside it that were reported going, as its own
 * watch would have reported them. Told sooner, an open editor marks its document deleted and dirty,
 * where 027 has a folder that went while nothing was looking found `unloadable` and clean.
 */
function forReader(
  below: string,
  path: string,
  batch: WatchBatch | undefined,
  folderThere: () => boolean,
): { path: string; batch?: WatchBatch } | null {
  const paths = batch?.paths ?? [path];
  const inside = paths.filter((p) => {
    const key = normaliseForCompare(p);
    return key !== below && key.startsWith(`${below}/`);
  });
  const touchesFolder = paths.some((p) => within(below, normaliseForCompare(p)));
  let complete = (batch?.complete ?? true) && !touchesFolder;
  if (!complete && !folderThere()) complete = true; // gone: only what was reported inside it
  if (inside.length === 0 && complete) return null;
  const shown = inside.includes(path) || inside.length === 0 ? path : inside[0]!;
  return { path: shown, batch: { paths: inside, complete } };
}

export class SharedFileWatcher implements IFileWatcher {
  private readonly watches = new Map<string, SharedWatch>();

  constructor(
    private readonly inner: IFileWatcher,
    /** Whether a folder is there; injected so the rule for a reader whose folder went is testable. */
    private readonly exists: (dir: string) => boolean = folderExists,
  ) {}

  /** How many underlying watches are open — one per watched directory tree. */
  get openWatches(): number {
    return this.watches.size;
  }

  /** The nearest open watch on a folder strictly above `key`, if any. */
  private coveringWatch(key: string): SharedWatch | undefined {
    let best: { key: string; watch: SharedWatch } | undefined;
    for (const [watched, shared] of this.watches) {
      if (key.startsWith(`${watched}/`) && (!best || watched.length > best.key.length)) {
        best = { key: watched, watch: shared };
      }
    }
    return best?.watch;
  }

  /**
   * Does the shared watch leave the folder `rel` out (062 FR-051)? Only when some reader says what it ignores, and
   * every reader can do without the folder. A watch nobody has said anything about leaves nothing out, as before.
   */
  private leavesOut(shared: SharedWatch, rel: string): boolean {
    const relKey = normaliseForCompare(rel);
    let stated = false;
    for (const reader of shared.readers) {
      if (!canDoWithout(reader, rel, relKey)) return false;
      if (reader.excluded) stated = true;
    }
    return stated;
  }

  /**
   * Re-ask the watch, when `reader` joining or leaving can change what it leaves out: a reader that says what it
   * ignores, or one whose folder is (or was) left out. A reader of the whole folder that states nothing changes
   * nothing, so opening an editor costs no re-ask.
   */
  private rescopeFor(shared: SharedWatch, reader: Reader): void {
    if (!shared.handle) return;
    if (!reader.excluded && reader.belowRel === '') return;
    if (!reader.excluded) {
      // A reader below that states nothing matters only if its folder is cut off without it.
      const present = shared.readers.delete(reader);
      const segments = reader.belowRel.split("/");
      let cut = false;
      for (let i = 1; i <= segments.length && !cut; i += 1) cut = this.leavesOut(shared, segments.slice(0, i).join("/"));
      if (present) shared.readers.add(reader);
      if (!cut) return;
    }
    rescopeWatch(shared.handle);
  }

  watch(
    dir: string,
    onChange: (path: string, batch?: WatchBatch) => void,
    options?: WatchOptions,
  ): RescopableWatch {
    const key = normaliseForCompare(dir);
    let shared = this.watches.get(key);
    let reader: Reader;
    const excluded = options?.excluded;
    if (shared) {
      reader = { onChange, onFailed: options?.onFailed, below: null, dir, belowRel: '', excluded };
      shared.readers.add(reader);
      this.rescopeFor(shared, reader);
    } else {
      const covering = this.coveringWatch(key);
      if (covering) {
        shared = covering;
        reader = { onChange, onFailed: options?.onFailed, below: key, dir, belowRel: key.slice(covering.key.length + 1), excluded };
        covering.readers.add(reader);
        this.rescopeFor(covering, reader);
      } else {
        reader = { onChange, onFailed: options?.onFailed, below: null, dir, belowRel: '', excluded };
        shared = this.open(dir, key, reader);
      }
    }
    const owner = shared;
    let disposed = false;
    return {
      rescope: () => {
        // The reader's own answer changed (a setting, a hidden set): the watch re-asks every reader.
        if (!disposed && owner.readers.has(reader)) rescopeWatch(owner.handle);
      },
      dispose: () => {
        if (disposed) return;
        disposed = true;
        if (!owner.readers.delete(reader)) return;
        if (owner.readers.size > 0) {
          this.rescopeFor(owner, reader);
          return;
        }
        owner.handle?.dispose();
        owner.handle = null;
        for (const [k, w] of this.watches) if (w === owner) this.watches.delete(k);
      },
    };
  }

  private open(dir: string, key: string, first: Reader): SharedWatch {
    const created: SharedWatch = { key, handle: null, readers: new Set([first]) };
    this.watches.set(key, created);
    created.handle = this.inner.watch(
      dir,
      (path, batch) => {
        // A snapshot: a reader may dispose itself, or another, from inside its own callback.
        for (const r of [...created.readers]) {
          if (r.below === null) {
            r.onChange(path, batch);
            continue;
          }
          const view = forReader(r.below, path, batch, () => this.exists(r.dir));
          if (view) r.onChange(view.path, view.batch);
        }
      },
      {
        onFailed: (reason) => {
          if (this.watches.get(key) === created) this.watches.delete(key);
          created.handle = null;
          for (const r of [...created.readers]) r.onFailed?.(reason);
          created.readers.clear();
        },
        excluded: (rel) => this.leavesOut(created, rel),
      },
    );
    return created;
  }
}
