/**
 * ProjectFileIndexService — the project file index's lifetime, its watch and its debounce
 * (033 US1, contracts/file-index.md §2, S1–S11).
 *
 * Quick Open is seeded from every file beneath a project root. Building that set is pure and lives
 * in `@throng/core` (`walkFiles`, `diffPaths`, `compileExcluder`); OWNING it is not, and this is
 * where it is owned. UI-main was chosen over the renderer (sandboxed, single-threaded — a 50,000
 * entry walk there is exactly the stall FR-015 forbids) and over the daemon (which walks nothing,
 * reads its settings once at startup, and has no reason to outlive a cache of the filesystem) —
 * research R1.
 *
 * TWO MECHANISMS KEEP IT CURRENT, and both are load-bearing (research R5):
 *
 *  1. a TARGETED RESCAN of the directory a watch signal named — the fast path, and what meets
 *     SC-005's two seconds for the ordinary create/rename/delete; and
 *  2. a TRAILING FULL RECONCILE, debounced by `quietMs` and FORCED after `reconcileMaxWaitMs`.
 *
 * The first exists because `IFileWatcher` reports ONE COALESCED PATH PER BURST, which is enough to
 * repair one directory and nowhere near enough to repair a `git checkout` that touched fifty. The
 * second exists because of that same limit — and its ceiling exists because a debounce with only a
 * quiet period NEVER FIRES under sustained churn. That is not a hypothetical: it is #186, measured
 * at 180 events over 3 s producing zero reports, and it is written into `NodeFileWatcher`'s own
 * comments. The tree survived that bug because a stale row is visible; a stale search index is not.
 *
 * Everything it collaborates with arrives by constructor and nothing is `new`-ed here (Principle
 * IX); both timings are settings with documented defaults (Principle X). It is constructed once,
 * in `main.ts`, beside `FilesService` and `ExplorerWatcher`.
 */
import { dirname, relative, sep } from 'node:path';
import {
  compileExcluder,
  diffPaths,
  hiddenPathGlobs,
  normaliseForCompare,
  toAbsPath,
  walkFiles,
  type Disposable,
  type IFileSystem,
  type IFileWatcher,
} from '@throng/core';

/** What a subscriber is told, on the wire (contracts/file-index.md §3). */
export interface FileIndexUpdate {
  root: string;
  /**
   * Which of the root's two indices this push is about (033 FR-069, plan D2).
   *
   * The exclusion state joins the SUBSCRIPTION KEY, so one window may hold two subscriptions to one
   * root — the standing one at the setting's value and a short-lived one at the opposite. Echoing
   * the flag is what lets each of them recognise its own pushes; without it a renderer holding both
   * would fold one index's deltas into the other's set and end up with neither.
   */
  includeHidden: boolean;
  status: 'building' | 'ready';
  /** The whole set. Sent AT MOST ONCE per root per subscription (I2). */
  paths?: string[];
  added?: string[];
  removed?: string[];
}

/** What `subscribe` answers immediately, before any push. */
export interface FileIndexSnapshot {
  status: 'building' | 'ready';
  paths?: string[];
}

export interface ProjectFileIndexOptions {
  /** Quiet period before the trailing full reconcile. Default 750 ms. */
  quietMs?: number;
  /** Ceiling on postponing that reconcile under sustained churn. Default 10_000 ms. */
  reconcileMaxWaitMs?: number;
}

interface Subscriber {
  /**
   * The spelling of the root THIS window used.
   *
   * Echoed back on every push so a renderer can key its own state off the string it supplied.
   * Roots reach this layer as both `C:/x/y` and `C:\x\y` (#229), so the registry is keyed by the
   * comparable form while each subscriber keeps its own spelling.
   */
  root: string;
  /**
   * The snapshot this subscriber was last SENT, or null when it has been sent nothing yet (S8).
   *
   * Deltas are computed against THIS, never against the snapshot last built. A subscriber that
   * joined late was handed a different starting point, and diffing against the wrong one leaves it
   * with a view that quietly disagrees with the disk — silently, and forever.
   */
  sent: readonly string[] | null;
}

interface RootIndex {
  /** The comparable form PLUS the exclusion flag — this index's key in `roots` (FR-069, D2). */
  key: string;
  /** The first spelling seen, used for every filesystem call. */
  root: string;
  /** True for the index that applies NO exclusions at all — "show hidden" (FR-069c). */
  includeHidden: boolean;
  subscribers: Map<number, Subscriber>;
  status: 'building' | 'ready';
  /** The snapshot last BUILT. Replaced wholesale, never mutated, so subscribers may share it. */
  paths: string[];
  watch: Disposable | null;
  /** Bumped whenever work in flight must be abandoned; a stale result discards itself. */
  generation: number;
  walking: boolean;
  /** Serialises the walks and rescans for this root — they read and replace the same array. */
  queue: Promise<void>;
  /** Root-relative directories a watch signal named, awaiting their targeted rescan. */
  pending: Set<string>;
  quietTimer: ReturnType<typeof setTimeout> | null;
  /** When the current reconcile-deferral burst began, or null between bursts. */
  burstStartedAt: number | null;
  disposed: boolean;
}

export class ProjectFileIndexService {
  private readonly roots = new Map<string, RootIndex>();

  private readonly quietMs: number;

  private readonly reconcileMaxWaitMs: number;

  private disposed = false;

  constructor(
    private readonly fs: IFileSystem,
    private readonly watcher: IFileWatcher,
    /**
     * Read AT WALK TIME and AT EVERY RESCAN, never captured (S10).
     *
     * Reading the exclusion list once at startup is precisely the habit that disqualified the
     * daemon from owning this index (research R1); repeating it here would import the bug.
     */
    private readonly excludeGlobs: () => readonly string[],
    /**
     * The project's OWN hidden set — "Hide in this project" (004) — for `root` (033 FR-069a).
     *
     * Symmetrical with `excludeGlobs` in every respect that matters: a function, read at walk time
     * and at every rescan, never captured. That symmetry IS the requirement. The user experiences
     * the two mechanisms as one, so a design where one is live and the other is a startup snapshot
     * would make FR-069c false at exactly the moment somebody changed the stale one.
     *
     * Keyed by ROOT rather than by project id, which is legitimate because no two projects may share
     * a root (project root exclusivity) — so the id→root map the composition root builds is total
     * and unambiguous.
     */
    private readonly hiddenPaths: (root: string) => readonly string[],
    /** Deliver to ONE webContents. Never a broadcast — two windows on two roots (I1, FR-017). */
    private readonly push: (webContentsId: number, payload: FileIndexUpdate) => void,
    options: ProjectFileIndexOptions = {},
  ) {
    this.quietMs = options.quietMs ?? 750;
    this.reconcileMaxWaitMs = options.reconcileMaxWaitMs ?? 10_000;
  }

  /**
   * Subscribe `webContentsId` to `root`, starting the walk and the watch on the first subscriber
   * (S1, S2). Answers immediately: `building` with NO paths while the walk is in flight, so the
   * modal can say so rather than show a partial list as though it were whole (S3).
   *
   * `includeHidden` joins the KEY rather than changing an existing index (FR-069, plan D2). Every
   * guarantee this service makes is stated PER INDEX — the refcount, the dispose-on-last-unsubscribe
   * (S9), the snapshot-then-delta protocol (I2, S7, S8), the read-at-walk-time rule (S10) — so
   * widening the key ADDS an index and leaves each of those exactly as it was. Re-pointing one index
   * would not: a root's index is shared by every subscriber of that root, so one window's toggle
   * would silently change another window's candidate set.
   */
  subscribe(webContentsId: number, root: string, includeHidden = false): FileIndexSnapshot {
    if (this.disposed) return { status: 'building' };
    const key = indexKey(root, includeHidden);
    let index = this.roots.get(key);
    if (!index) {
      index = {
        key,
        root,
        includeHidden,
        subscribers: new Map(),
        status: 'building',
        paths: [],
        watch: null,
        generation: 0,
        walking: false,
        queue: Promise.resolve(),
        pending: new Set(),
        quietTimer: null,
        burstStartedAt: null,
        disposed: false,
      };
      this.roots.set(key, index);
    }
    index.subscribers.set(webContentsId, { root, sent: null });
    // S1 — a second window on the same root joins the existing walk and the existing watch.
    if (!index.watch) this.arm(index);
    if (index.status === 'ready') {
      const paths = index.paths;
      const subscriber = index.subscribers.get(webContentsId);
      if (subscriber) subscriber.sent = paths;
      return { status: 'ready', paths: [...paths] };
    }
    if (!index.walking) this.startWalk(index);
    return { status: 'building' };
  }

  /**
   * Drop a subscriber from one INDEX of `root`, or — with no root — from EVERY index, which is what
   * a destroyed `webContents` needs (S9). The last subscriber to leave disposes the watch and drops
   * the array.
   *
   * The flag is part of the identity being left, not a hint: a window that opened a second
   * subscription at the opposite flag must be able to give up exactly that one and keep the standing
   * one, which is the whole reason D2 refuses to re-point a single index.
   */
  unsubscribe(webContentsId: number, root?: string, includeHidden = false): void {
    if (root === undefined) {
      for (const index of [...this.roots.values()]) this.drop(index, webContentsId);
      return;
    }
    const index = this.roots.get(indexKey(root, includeHidden));
    if (index) this.drop(index, webContentsId);
  }

  /**
   * Re-walk now, because an INPUT changed rather than the disk (033 FR-069a, plan D3.6/D3.7).
   *
   * Both of the walk's inputs live outside this service and neither produces a filesystem event when
   * it changes: `explorer.excludeGlobs` is a setting, and the per-project hidden set is a column in
   * the daemon's database. Before this, a change to either took effect only when something else
   * happened to signal the watch — so a quiescent project served the stale candidate set
   * indefinitely, while the tree re-filtered immediately. One input live and the other stale is
   * precisely the divergence FR-069c denies.
   *
   * `root` omitted means every root, which is what a settings change needs; a hidden-set change
   * names the one root it touched. Either way this is a RECONCILE, not a re-subscribe: a ready index
   * stays ready and its subscribers get a delta, so nobody sees "Still listing…" because somebody
   * edited a glob.
   */
  refresh(root?: string): void {
    if (this.disposed) return;
    const target = root === undefined ? null : normaliseForCompare(root);
    for (const index of [...this.roots.values()]) {
      if (index.disposed) continue;
      if (target !== null && normaliseForCompare(index.root) !== target) continue;
      // An index still building captured its excluder when the walk began, so it is abandoned and
      // restarted; a ready one takes the ordinary reconcile path and publishes the difference.
      if (index.status === 'ready') this.runReconcile(index);
      else if (index.watch) this.startWalk(index);
    }
  }

  dispose(): void {
    this.disposed = true;
    for (const index of this.roots.values()) this.teardown(index);
    this.roots.clear();
  }

  // ---------------------------------------------------------------------------------------------

  private drop(index: RootIndex, webContentsId: number): void {
    if (!index.subscribers.delete(webContentsId)) return;
    if (index.subscribers.size > 0) return;
    this.teardown(index);
    this.roots.delete(index.key);
  }

  private teardown(index: RootIndex): void {
    index.disposed = true;
    index.generation += 1; // anything in flight now discards its own result
    index.watch?.dispose();
    index.watch = null;
    if (index.quietTimer) clearTimeout(index.quietTimer);
    index.quietTimer = null;
    index.burstStartedAt = null;
    index.pending.clear();
    index.subscribers.clear();
  }

  private arm(index: RootIndex): void {
    index.watch = this.watcher.watch(
      index.root,
      (changedPath) => this.onSignal(index, changedPath),
      { onFailed: (reason) => this.onWatchFailed(index, reason) },
    );
  }

  /** Run `task` after everything already queued for this root, and never reject the chain. */
  private enqueue(index: RootIndex, task: () => Promise<void>): void {
    index.queue = index.queue.then(task).catch(() => {
      /* a failed read is an ordinary event here — the next reconcile settles it */
    });
  }

  private stale(index: RootIndex, generation: number): boolean {
    return this.disposed || index.disposed || index.generation !== generation;
  }

  /**
   * The ONE exclusion predicate this index walks with (S10, FR-069c).
   *
   * There is exactly one excluder in the system, over the same two inputs the tree obeys, and the
   * flag chooses whether to build it or to build the empty one — which `compileExcluder([])` already
   * returns as `() => false`. That is what makes FR-069c true by construction: there is no second
   * rule set to drift from the first, because there is no second rule set. "Show hidden" therefore
   * means EVERYTHING the project hides, `.git` and `node_modules` included.
   *
   * Both inputs are read HERE, at every call, and never captured — the habit that disqualified the
   * daemon from owning this index (research R1) would otherwise arrive through the hidden set.
   */
  private excluderFor(index: RootIndex): (relPath: string) => boolean {
    if (index.includeHidden) return compileExcluder([]);
    return compileExcluder([
      ...this.excludeGlobs(),
      ...hiddenPathGlobs(this.hiddenPaths(index.root)),
    ]);
  }

  /** The initial walk for a root: off the renderer's thread, and abandonable (S2, W5). */
  private startWalk(index: RootIndex): void {
    index.walking = true;
    index.generation += 1;
    const generation = index.generation;
    this.enqueue(index, async () => {
      if (this.stale(index, generation)) return;
      const excluded = this.excluderFor(index); // S10 — both inputs read at walk time
      const paths = await walkFiles(this.fs, index.root, {
        cancelled: () => this.stale(index, generation),
        excluded,
      });
      if (this.stale(index, generation)) return;
      index.walking = false;
      index.status = 'ready';
      index.paths = paths;
      this.publish(index); // S4 — every subscriber of this root, not only the one that asked
    });
  }

  /**
   * Tell every subscriber what changed, each against what IT was last sent (S8).
   *
   * A subscriber that has been sent nothing gets the whole set once (I2); everyone else gets a
   * delta, and a delta with nothing in it is not sent at all — a quiescent project costs no
   * messages (S7).
   */
  private publish(index: RootIndex): void {
    for (const [webContentsId, subscriber] of index.subscribers) {
      if (subscriber.sent === null) {
        subscriber.sent = index.paths;
        this.push(webContentsId, {
          root: subscriber.root,
          includeHidden: index.includeHidden,
          status: 'ready',
          paths: [...index.paths],
        });
        continue;
      }
      const { added, removed } = diffPaths(subscriber.sent, index.paths);
      subscriber.sent = index.paths;
      if (added.length === 0 && removed.length === 0) continue; // S7
      this.push(webContentsId, {
        root: subscriber.root,
        includeHidden: index.includeHidden,
        status: 'ready',
        added: [...added],
        removed: [...removed],
      });
    }
  }

  private onSignal(index: RootIndex, changedPath: string): void {
    if (index.disposed || this.disposed) return;
    index.pending.add(toRelDir(index.root, changedPath));
    // Both mechanisms, on every signal: the rescan repairs the directory that was named, and the
    // reconcile eventually repairs everything the coalescing hid (R5).
    this.enqueue(index, () => this.drainRescans(index));
    this.scheduleReconcile(index);
  }

  /** S5 — re-list each signalled directory and push the difference. */
  private async drainRescans(index: RootIndex): Promise<void> {
    if (index.disposed || index.status !== 'ready') {
      index.pending.clear();
      return;
    }
    const dirs = [...index.pending];
    index.pending.clear();
    if (dirs.length === 0) return;
    const excluded = this.excluderFor(index); // S10 — re-read at EVERY rescan
    let next = index.paths;
    // Sequential on purpose: each listing is applied to the result of the last, so they cannot be
    // read concurrently without one overwriting the other's directory.
    for (const relDir of dirs) {
      next = await this.rescanDir(index, relDir, next, excluded);
    }
    if (index.disposed || next === index.paths) return;
    index.paths = next;
    this.publish(index);
  }

  /**
   * The set as it would be with `relDir` re-read: its direct file children replaced, everything
   * else left alone.
   *
   * Only the named directory is listed — that is what makes this the FAST path. A change deeper in
   * a subtree the signal did not name is the full reconcile's job, which is why there is one.
   */
  private async rescanDir(
    index: RootIndex,
    relDir: string,
    current: string[],
    excluded: (relPath: string) => boolean,
  ): Promise<string[]> {
    if (relDir !== '' && excluded(relDir)) return current;
    let entries;
    try {
      entries = await this.fs.list(toAbsPath(index.root, relDir));
    } catch {
      return current; // it has gone since the signal — the reconcile settles what that means
    }
    const prefix = relDir === '' ? '' : `${relDir}/`;
    const inDir: string[] = [];
    for (const entry of entries) {
      const relPath = `${prefix}${entry.name}`;
      if (excluded(relPath)) continue;
      if (entry.kind === 'file') inDir.push(relPath);
    }
    const isDirectChild = (p: string): boolean =>
      p.startsWith(prefix) && !p.slice(prefix.length).includes('/');
    // `.sort()` — UTF-16 code-unit order, the SAME order `walkFiles` produces and `diffPaths`
    // merges with. Two orders that disagree corrupt every delta while every test still passes.
    const next = [...current.filter((p) => !isDirectChild(p)), ...inDir].sort();
    return same(current, next) ? current : next;
  }

  /**
   * S6 — schedule the trailing full reconcile, and FORCE it once the burst has run past its
   * ceiling.
   *
   * Deliberately the same shape as `NodeFileWatcher`'s own coalescing, for the same reason:
   * clearing and re-arming a quiet-period timer on every signal means that while signals keep
   * arriving closer together than the quiet period, the reconcile never happens at all.
   */
  private scheduleReconcile(index: RootIndex): void {
    const now = Date.now();
    if (index.burstStartedAt === null) index.burstStartedAt = now;
    if (index.quietTimer) clearTimeout(index.quietTimer);
    index.quietTimer = null;
    if (now - index.burstStartedAt >= this.reconcileMaxWaitMs) {
      index.burstStartedAt = null;
      this.runReconcile(index);
      return;
    }
    index.quietTimer = setTimeout(() => {
      index.quietTimer = null;
      index.burstStartedAt = null;
      this.runReconcile(index);
    }, this.quietMs);
  }

  private runReconcile(index: RootIndex): void {
    if (this.disposed || index.disposed || index.status !== 'ready') return;
    const generation = index.generation;
    this.enqueue(index, async () => {
      if (this.stale(index, generation) || index.status !== 'ready') return;
      const excluded = this.excluderFor(index); // S10
      const next = await walkFiles(this.fs, index.root, {
        cancelled: () => this.stale(index, generation),
        excluded,
      });
      if (this.stale(index, generation)) return;
      /*
       * `walkFiles` resolves to `[]` for an EMPTY project and for a root that has GONE alike — the
       * walk records that decision explicitly, and it gives this layer no signal to tell them
       * apart. The difference matters exactly here: emptying a live index because a folder was
       * renamed away for a moment would tell every subscriber that every file it holds was
       * deleted. So the one case where it could matter asks the seam directly, and otherwise
       * changes nothing. A root that is genuinely gone stays as it was until the watch reports a
       * failure (S11) or the user leaves the project.
       */
      if (next.length === 0 && index.paths.length > 0 && !(await this.fs.exists(index.root))) return;
      index.paths = next;
      this.publish(index);
    });
  }

  /**
   * S11 — the watch is gone for good, so the set can no longer be maintained.
   *
   * Serving it anyway is the worst of the options: it looks current and is not. The root goes back
   * to `building`, every subscriber is told so, and the next subscribe re-walks from scratch.
   */
  private onWatchFailed(index: RootIndex, _reason: string): void {
    if (this.disposed || index.disposed) return;
    index.watch?.dispose();
    index.watch = null;
    index.generation += 1;
    index.walking = false;
    index.status = 'building';
    index.paths = [];
    index.pending.clear();
    if (index.quietTimer) clearTimeout(index.quietTimer);
    index.quietTimer = null;
    index.burstStartedAt = null;
    for (const [webContentsId, subscriber] of index.subscribers) {
      subscriber.sent = null;
      this.push(webContentsId, {
        root: subscriber.root,
        includeHidden: index.includeHidden,
        status: 'building',
      });
    }
  }
}

/**
 * This index's key: the comparable root form, plus the exclusion flag (FR-069, plan D2).
 *
 * A NUL separator rather than a colon or a slash, because a root is a path and every printable
 * separator is a character a path may legitimately contain — `C:/a` at one flag and `C:` at another
 * must not be able to collide.
 */
function indexKey(root: string, includeHidden: boolean): string {
  return `${normaliseForCompare(root)}\u0000${includeHidden ? 'hidden' : 'excluded'}`;
}

/** Root-relative POSIX path of the directory containing the changed entry — `''` at the root. */
function toRelDir(root: string, changedPath: string): string {
  const rel = relative(root, dirname(changedPath)).split(sep).join('/');
  // A signal naming the root itself resolves ABOVE it; the root's own directory is `''`.
  return rel === '' || rel.startsWith('..') ? '' : rel;
}

function same(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
  return true;
}
