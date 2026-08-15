/**
 * 033 T014 — `ProjectFileIndexService` over a REAL temp tree and a REAL `NodeFileWatcher`
 * (contracts/file-index.md §2, S1–S11, and SC-005's two-second currency).
 *
 * Why this layer and not a unit test with a fake watcher: the two mechanisms the index is built
 * from (research R5) only exist because of how the REAL watcher behaves. It reports ONE COALESCED
 * PATH PER BURST, so a targeted rescan repairs one directory and cannot repair a `git checkout`;
 * and a debounce with only a quiet period never fires at all under sustained churn (#186, measured
 * at 180 events over 3 s producing zero reports). A fake watcher would let both bugs pass.
 *
 * Nothing here sleeps for an outcome. Every assertion polls for the CONDITION and reports how long
 * it took, which is also how SC-005's ceiling is measured rather than assumed.
 */
import { mkdtemp, mkdir, rm, rename, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import type { Disposable, IFileWatcher, WatchOptions } from '@throng/core';
import { NodeFileSystem } from '../../src/main/node-file-system.js';
import { NodeFileWatcher } from '../../src/main/node-file-watcher.js';
import {
  ProjectFileIndexService,
  type FileIndexUpdate,
} from '../../src/main/project-file-index.js';

/** SC-005: a create, a rename or a delete is reflected within two seconds. */
const CURRENCY_BUDGET_MS = 2000;
/** Faster than the watcher's own debounce — the condition that starves a quiet-period-only wait. */
const CHURN_INTERVAL_MS = 50;

/** Poll for a condition rather than sleeping for it, and say how long it took. */
async function waitFor<T>(
  what: string,
  probe: () => T | undefined,
  budgetMs = CURRENCY_BUDGET_MS,
): Promise<{ value: T; elapsedMs: number }> {
  const started = Date.now();
  for (;;) {
    const value = probe();
    if (value !== undefined) return { value, elapsedMs: Date.now() - started };
    if (Date.now() - started > budgetMs) throw new Error(`timed out after ${budgetMs}ms: ${what}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

/** Churn a directory the way a build or an install does, until stopped. */
function startChurn(dir: string): () => void {
  let n = 0;
  const timer = setInterval(() => {
    void writeFile(join(dir, `churn-${n++ % 40}.tmp`), String(n)).catch(() => {
      /* the tree may be being torn down — churn is noise, never an assertion */
    });
  }, CHURN_INTERVAL_MS);
  return () => clearInterval(timer);
}

interface Sent {
  id: number;
  payload: FileIndexUpdate;
}

/** One temp project, one service, and a record of every push it made and to whom. */
class Harness {
  readonly sent: Sent[] = [];

  globs: string[] = [];

  /** Assigned immediately after construction — the service's `push` closes over this harness. */
  service!: ProjectFileIndexService;

  private constructor(readonly root: string) {}

  static async create(options?: {
    quietMs?: number;
    reconcileMaxWaitMs?: number;
    globs?: string[];
    watcher?: IFileWatcher;
  }): Promise<Harness> {
    const root = await mkdtemp(join(tmpdir(), 'throng-file-index-'));
    const harness = new Harness(root);
    harness.globs = [...(options?.globs ?? [])];
    harness.service = new ProjectFileIndexService(
      new NodeFileSystem(async () => {}),
      options?.watcher ?? new NodeFileWatcher(150),
      () => harness.globs,
      (id, payload) => harness.sent.push({ id, payload }),
      {
        quietMs: options?.quietMs ?? 750,
        reconcileMaxWaitMs: options?.reconcileMaxWaitMs ?? 10_000,
      },
    );
    return harness;
  }

  /** Everything pushed to `id` since (and including) index `from`. */
  to(id: number, from = 0): FileIndexUpdate[] {
    return this.sent.slice(from).filter((s) => s.id === id).map((s) => s.payload);
  }

  /** The set `id` believes in, rebuilt from what it was actually sent (S8's invariant). */
  view(id: number, seeded: readonly string[]): string[] {
    const set = new Set(seeded);
    for (const p of this.to(id)) {
      if (p.paths) {
        set.clear();
        for (const x of p.paths) set.add(x);
      }
      for (const x of p.removed ?? []) set.delete(x);
      for (const x of p.added ?? []) set.add(x);
    }
    return [...set].sort();
  }

  async destroy(): Promise<void> {
    this.service.dispose();
    await rm(this.root, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
  }
}

/** Wait until the initial walk for `root` has been delivered to `id`, and return its paths. */
async function waitForReady(h: Harness, id: number): Promise<string[]> {
  const { value } = await waitFor(
    `the initial walk to reach webContents ${id}`,
    () => h.to(id).find((p) => p.status === 'ready' && p.paths !== undefined),
    10_000,
  );
  return [...(value.paths ?? [])];
}

/**
 * Prove the recursive watch is LIVE before timing anything against it.
 *
 * `fs.watch({ recursive: true })` arms asynchronously and nothing reports when it has, so a timed
 * assertion started too early measures the arming rather than the index. This waits on the
 * CONDITION — a throwaway file's delta actually arriving — and then removes the evidence.
 */
async function armWatch(h: Harness, id: number): Promise<void> {
  const probe = 'watch-armed.probe';
  const mark = h.sent.length;
  await writeFile(join(h.root, probe), 'x');
  await waitFor(
    'the watch to report a probe file',
    () => h.to(id, mark).find((p) => (p.added ?? []).includes(probe)),
    10_000,
  );
  const mark2 = h.sent.length;
  await unlink(join(h.root, probe));
  await waitFor(
    'the watch to report the probe removed',
    () => h.to(id, mark2).find((p) => (p.removed ?? []).includes(probe)),
    10_000,
  );
}

async function seedProject(root: string): Promise<void> {
  await mkdir(join(root, 'src'));
  await mkdir(join(root, 'src', 'deep'));
  await mkdir(join(root, 'node_modules'));
  await mkdir(join(root, 'noise'));
  await writeFile(join(root, 'readme.md'), '#');
  await writeFile(join(root, 'src', 'a.ts'), 'a');
  await writeFile(join(root, 'src', 'deep', 'b.ts'), 'b');
  await writeFile(join(root, 'node_modules', 'junk.js'), 'j');
}

describe('ProjectFileIndexService over a real tree and a real watcher (033, §2)', () => {
  it('S2/S3/S4 — the walk starts on the first subscribe; both subscribers get building, then ready with paths', async () => {
    const h = await Harness.create();
    try {
      await seedProject(h.root);
      // Both subscribes happen in ONE synchronous turn, so the walk cannot have completed between
      // them: that is what makes the 'building' answer deterministic rather than a race.
      const first = h.service.subscribe(1, h.root);
      const second = h.service.subscribe(2, h.root);
      expect(first).toEqual({ status: 'building' });
      expect(first.paths, 'S3 — building must carry NO paths, or a partial list reads as whole')
        .toBeUndefined();
      expect(second).toEqual({ status: 'building' });

      const one = await waitForReady(h, 1);
      const two = await waitForReady(h, 2);
      expect(one).toEqual(['node_modules/junk.js', 'readme.md', 'src/a.ts', 'src/deep/b.ts']);
      expect(two).toEqual(one); // S4 — every subscriber of the root, not just the one that asked
    } finally {
      await h.destroy();
    }
  }, 30_000);

  it('S1 — two windows on one root share one walk and one watch, and a third root is separate', async () => {
    const h = await Harness.create();
    try {
      await seedProject(h.root);
      h.service.subscribe(1, h.root);
      h.service.subscribe(2, h.root);
      await waitForReady(h, 1);
      await waitForReady(h, 2);
      // One walk: the two subscribers were answered from the same array, so the second subscribe
      // produced no second 'ready' beyond its own delivery.
      expect(h.to(1).filter((p) => p.paths).length).toBe(1);
      expect(h.to(2).filter((p) => p.paths).length).toBe(1);

      // A SECOND root, subscribed by a third window, never reaches the first two (FR-017).
      const other = await mkdtemp(join(tmpdir(), 'throng-file-index-other-'));
      try {
        await writeFile(join(other, 'elsewhere.txt'), 'x');
        h.service.subscribe(3, other);
        const three = await waitForReady(h, 3);
        expect(three).toEqual(['elsewhere.txt']);
        expect(h.to(1).flatMap((p) => p.paths ?? [])).not.toContain('elsewhere.txt');
        expect(h.to(2).flatMap((p) => p.paths ?? [])).not.toContain('elsewhere.txt');
      } finally {
        await rm(other, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
      }
    } finally {
      await h.destroy();
    }
  }, 30_000);

  it('S5 + SC-005 — a create, a rename and a delete each reach the subscriber as a delta within two seconds', async () => {
    const h = await Harness.create();
    try {
      await seedProject(h.root);
      h.service.subscribe(1, h.root);
      await waitForReady(h, 1);
      await armWatch(h, 1);

      // CREATE
      let mark = h.sent.length;
      await writeFile(join(h.root, 'src', 'created.ts'), 'c');
      const created = await waitFor(
        'the created file to arrive as a delta',
        () => h.to(1, mark).find((p) => (p.added ?? []).includes('src/created.ts')),
      );
      expect(created.elapsedMs).toBeLessThan(CURRENCY_BUDGET_MS);
      expect(created.value.paths, 'I2 — after the first snapshot everything is a delta')
        .toBeUndefined();
      expect(created.value.status).toBe('ready');

      // RENAME — one removal and one addition, and they must arrive together or the view diverges.
      mark = h.sent.length;
      await rename(join(h.root, 'src', 'created.ts'), join(h.root, 'src', 'renamed.ts'));
      const renamed = await waitFor('the rename to arrive as a delta', () => {
        const added = h.to(1, mark).some((p) => (p.added ?? []).includes('src/renamed.ts'));
        const removed = h.to(1, mark).some((p) => (p.removed ?? []).includes('src/created.ts'));
        return added && removed ? true : undefined;
      });
      expect(renamed.elapsedMs).toBeLessThan(CURRENCY_BUDGET_MS);

      // DELETE
      mark = h.sent.length;
      await unlink(join(h.root, 'src', 'renamed.ts'));
      const deleted = await waitFor(
        'the delete to arrive as a delta',
        () => h.to(1, mark).find((p) => (p.removed ?? []).includes('src/renamed.ts')),
      );
      expect(deleted.elapsedMs).toBeLessThan(CURRENCY_BUDGET_MS);
    } finally {
      await h.destroy();
    }
  }, 40_000);

  it('S6 + S10 — a full reconcile is FORCED under sustained churn, and re-reads the exclude globs', async () => {
    /*
     * The assertion a targeted rescan cannot pass.
     *
     * `vendor/` is excluded when the walk runs, so its file is absent from the index. Nothing then
     * happens on disk inside `vendor/` — only the SETTING changes. The watcher's signals all name
     * `noise/`, so a targeted re-list of the signalled directory can never produce `vendor/lib.txt`:
     * the only route is the trailing full reconcile, re-reading `excludeGlobs()` (S10).
     *
     * And the QUIET PERIOD is deliberately set far longer than the interval at which a churned
     * watch actually signals (`NodeFileWatcher`'s own ceiling reports roughly once a second), so a
     * quiet-period-only debounce would be cleared and re-armed forever and would never fire at
     * all. The ONLY route left is the maximum wait — which is exactly #186's measured bug, here in
     * a component whose staleness nobody can see (R5).
     */
    const quietMs = 2500;
    const reconcileMaxWaitMs = 1000;
    const h = await Harness.create({ quietMs, reconcileMaxWaitMs, globs: ['**/vendor'] });
    let stopChurn = (): void => {};
    try {
      await seedProject(h.root);
      await mkdir(join(h.root, 'vendor'));
      await writeFile(join(h.root, 'vendor', 'lib.txt'), 'v');
      h.service.subscribe(1, h.root);
      const ready = await waitForReady(h, 1);
      expect(ready, 'the excluded folder is not walked into').not.toContain('vendor/lib.txt');
      await armWatch(h, 1);

      const mark = h.sent.length;
      stopChurn = startChurn(join(h.root, 'noise'));
      h.globs = []; // the setting changed; nothing on disk did
      const arrived = await waitFor(
        'the forced reconcile to bring the newly-included file in while the churn continues',
        () => h.to(1, mark).find((p) => (p.added ?? []).includes('vendor/lib.txt')),
        8000,
      );
      // The churn is STILL RUNNING at this point — that is the whole point of the ceiling, and
      // this budget is well inside the quiet period that a debounce-only implementation would be
      // waiting for and never reaching.
      expect(arrived.elapsedMs).toBeLessThan(5000);
    } finally {
      stopChurn();
      await h.destroy();
    }
  }, 40_000);

  it('S7 — a reconcile that finds no difference sends nothing at all', async () => {
    const h = await Harness.create({ quietMs: 200, reconcileMaxWaitMs: 800 });
    try {
      await seedProject(h.root);
      h.service.subscribe(1, h.root);
      await waitForReady(h, 1);
      await armWatch(h, 1);

      const mark = h.sent.length;
      // A CONTENT change: the watcher signals, both the rescan and the reconcile run, and the set
      // of files is identical. A quiescent project must cost no messages.
      await writeFile(join(h.root, 'src', 'a.ts'), 'a much longer body than before');
      await new Promise((r) => setTimeout(r, 2500)); // deliberately longer than both ceilings
      expect(h.sent.slice(mark), 'no path set changed, so nothing may be sent').toEqual([]);
    } finally {
      await h.destroy();
    }
  }, 30_000);

  it('S8 — deltas are computed against the snapshot each subscriber was SENT, so no view diverges', async () => {
    const h = await Harness.create();
    try {
      await seedProject(h.root);
      h.service.subscribe(1, h.root);
      const seededOne = await waitForReady(h, 1);
      await armWatch(h, 1);

      // A change that only subscriber 1 is present for.
      let mark = h.sent.length;
      await writeFile(join(h.root, 'src', 'early.ts'), 'e');
      await waitFor(
        'the early file to reach subscriber 1',
        () => h.to(1, mark).find((p) => (p.added ?? []).includes('src/early.ts')),
      );

      // Subscriber 2 arrives LATE and is handed the set as it stands now — a different starting
      // point from subscriber 1's. Everything after must be relative to each one's own.
      const late = h.service.subscribe(2, h.root);
      expect(late.status).toBe('ready');
      const seededTwo = [...(late.paths ?? [])];
      expect(seededTwo).toContain('src/early.ts');
      const twoFrom = h.sent.length;

      mark = h.sent.length;
      await unlink(join(h.root, 'src', 'early.ts'));
      await writeFile(join(h.root, 'src', 'later.ts'), 'l');
      await waitFor('both later changes to settle for both subscribers', () => {
        const ok = (id: number, from: number): boolean =>
          h
            .to(id, from)
            .some((p) => (p.added ?? []).includes('src/later.ts')) &&
          h.to(id, from).some((p) => (p.removed ?? []).includes('src/early.ts'));
        return ok(1, mark) && ok(2, twoFrom) ? true : undefined;
      }, 5000);

      const truth = ['node_modules/junk.js', 'readme.md', 'src/a.ts', 'src/deep/b.ts', 'src/later.ts'];
      expect(h.view(1, seededOne)).toEqual(truth);
      // Rebuilt from the LATE subscriber's own seed plus only what it was sent.
      const twoView = new Set(seededTwo);
      for (const p of h.to(2, twoFrom)) {
        for (const x of p.removed ?? []) twoView.delete(x);
        for (const x of p.added ?? []) twoView.add(x);
      }
      expect([...twoView].sort()).toEqual(truth);
    } finally {
      await h.destroy();
    }
  }, 40_000);

  it('S9 — the LAST unsubscribe disposes the watch; an unsubscribe with no root leaves every root', async () => {
    const h = await Harness.create();
    const other = await mkdtemp(join(tmpdir(), 'throng-file-index-second-'));
    try {
      await seedProject(h.root);
      await writeFile(join(other, 'elsewhere.txt'), 'x');
      h.service.subscribe(1, h.root);
      h.service.subscribe(2, h.root);
      h.service.subscribe(1, other);
      await waitForReady(h, 1);
      await waitForReady(h, 2);
      await armWatch(h, 2);

      // One of two goes away: the watch survives for the other.
      h.service.unsubscribe(1, h.root);
      let mark = h.sent.length;
      await writeFile(join(h.root, 'still-watched.txt'), 'x');
      await waitFor(
        'the surviving subscriber to still receive deltas',
        () => h.to(2, mark).find((p) => (p.added ?? []).includes('still-watched.txt')),
      );
      expect(h.to(1, mark), 'an unsubscribed window receives nothing').toEqual([]);

      // The LAST one goes away: the watch is disposed and nothing is sent to anyone.
      h.service.unsubscribe(2, h.root);
      mark = h.sent.length;
      await writeFile(join(h.root, 'after-dispose.txt'), 'x');
      await new Promise((r) => setTimeout(r, 2500));
      expect(h.sent.slice(mark)).toEqual([]);

      // A destroyed webContents unsubscribes from EVERY root (no root argument).
      h.service.unsubscribe(1);
      mark = h.sent.length;
      await writeFile(join(other, 'after-destroy.txt'), 'x');
      await new Promise((r) => setTimeout(r, 2500));
      expect(h.sent.slice(mark)).toEqual([]);
    } finally {
      await rm(other, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
      await h.destroy();
    }
  }, 40_000);

  it('S11 — a watch that fails permanently marks the root building again and re-walks on the next subscribe', async () => {
    /*
     * The ONE case a real `NodeFileWatcher` cannot be asked to produce on demand: it retries, and
     * it waits indefinitely for a path that is merely absent, so `onFailed` fires only after the
     * whole ancestor chain has gone. The tree is still real; only the failure is injected.
     */
    let fail: ((reason: string) => void) | undefined;
    const watcher: IFileWatcher = {
      watch(_dir: string, _onChange: (p: string) => void, options?: WatchOptions): Disposable {
        fail = (reason) => options?.onFailed?.(reason);
        return { dispose: () => {} };
      },
    };
    const h = await Harness.create({ watcher });
    try {
      await seedProject(h.root);
      h.service.subscribe(1, h.root);
      await waitForReady(h, 1);

      const mark = h.sent.length;
      expect(fail, 'the service must pass an onFailed to the watcher').toBeTypeOf('function');
      fail?.('EPERM');
      await waitFor(
        'the root to be marked building again',
        () => h.to(1, mark).find((p) => p.status === 'building'),
        5000,
      );
      expect(
        h.to(1, mark).at(-1)?.paths,
        'a set it can no longer maintain must not still be served',
      ).toBeUndefined();

      // The next subscribe re-walks rather than answering from the stale array.
      const again = h.service.subscribe(2, h.root);
      expect(again).toEqual({ status: 'building' });
      const rewalked = await waitForReady(h, 2);
      expect(rewalked).toContain('src/a.ts');
    } finally {
      await h.destroy();
    }
  }, 30_000);
});
