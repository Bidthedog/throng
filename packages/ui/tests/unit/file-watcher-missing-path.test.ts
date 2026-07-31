/**
 * 027 / #161 — a watch on a path that does not exist must WAIT for it, not give up on it.
 *
 * The whole of #161 is one behaviour: open a project whose folder has been renamed away and every
 * watch bound underneath it — the file tree's, and each open editor's — exhausts its five retries
 * in under four seconds and is abandoned for the session. Rename the folder back and nothing
 * happens, because there is nobody left watching to notice that it did.
 *
 * An absent path is not a failing watch, and the two must not share a budget. The contract:
 *
 *   • ENOENT on arming → watch the nearest EXISTING ancestor and keep waiting, indefinitely,
 *     without consuming the retry budget or reaching `onFailed`.
 *   • The path reappears → the real watch is armed AND a change is reported at once. Without that
 *     report the watch is live again but every reader stays stale until something else happens to
 *     touch the folder — which, for a folder that has just been restored, may be never.
 *   • A genuine failure (EPERM) is unaffected: bounded retries, then `onFailed`.
 *   • Disposal ends the wait, exactly as it ends a retry.
 *
 * The seam is mocked because the behaviour under test is `fs.watch`'s ERROR handling, and a real
 * filesystem cannot be made to produce ENOENT-then-recovery on demand and in order.
 */
import { EventEmitter } from 'node:events';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

class FakeWatcher extends EventEmitter {
  closed = false;

  close(): void {
    this.closed = true;
  }
}

interface Watch {
  dir: string;
  recursive: boolean;
  watcher: FakeWatcher;
  listener: (event: string, filename: string | null) => void;
}

const watches: Watch[] = [];
/** Paths `existsSync` should report as present. */
const present = new Set<string>();
/** Directories whose `watch()` call should throw ENOENT. */
const absent = new Set<string>();

vi.mock('node:fs', () => ({
  watch: (
    dir: string,
    opts: { recursive?: boolean },
    listener: (event: string, filename: string | null) => void,
  ) => {
    if (absent.has(dir)) {
      throw Object.assign(new Error(`ENOENT: no such file or directory, watch '${dir}'`), {
        code: 'ENOENT',
      });
    }
    const watcher = new FakeWatcher();
    watches.push({ dir, recursive: opts?.recursive === true, watcher, listener });
    return watcher;
  },
  existsSync: (p: string) => present.has(p),
}));

const { NodeFileWatcher } = await import('../../src/main/node-file-watcher.js');

const liveWatch = (): Watch | undefined => [...watches].reverse().find((w) => !w.watcher.closed);
const watchOn = (dir: string): Watch | undefined =>
  [...watches].reverse().find((w) => w.dir === dir && !w.watcher.closed);

/** The project root, its parent, and the drive — the shape every real case has. */
const ROOT = 'C:\\code\\project';
const PARENT = 'C:\\code';

describe('a watch on a missing path waits for it (027 / #161)', () => {
  beforeEach(() => {
    watches.length = 0;
    present.clear();
    absent.clear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('waits on the nearest existing ancestor instead of giving up, and recovers when the path returns', async () => {
    // The project folder has been renamed away: its parent is there, it is not.
    present.add(PARENT);
    absent.add(ROOT);

    const changes: string[] = [];
    const failures: string[] = [];
    const handle = new NodeFileWatcher(50).watch(ROOT, (p) => changes.push(p), {
      onFailed: (reason) => failures.push(reason),
    });

    // Long past the five bounded retries the old code would have burnt (250ms × 1…5).
    await vi.advanceTimersByTimeAsync(30_000);

    // It did NOT give up: nothing was reported as failed, and it is watching the parent — the
    // nearest existing ancestor — waiting for the folder to come back.
    expect(failures, 'a path that does not exist yet was reported as a watch failure').toEqual([]);
    const sentinel = watchOn(PARENT);
    expect(sentinel, 'nothing is waiting for the missing path to reappear').toBeDefined();
    // Non-recursive: we only need to learn that one child appeared, and a recursive watch on a
    // parent directory could be the whole of `C:\` — an enormous cost for a single question.
    expect(sentinel?.recursive).toBe(false);

    // The user renames the folder back.
    present.add(ROOT);
    absent.delete(ROOT);
    sentinel!.listener('rename', 'project');
    await vi.advanceTimersByTimeAsync(100);

    // The real watch is armed again…
    const live = liveWatch();
    expect(live?.dir).toBe(ROOT);
    expect(live?.recursive).toBe(true);
    // …and the reappearance was REPORTED, without waiting for some later unrelated event: nobody
    // was watching while the folder was away, so everything in it is news.
    expect(changes.length, 'the folder came back and nobody was told').toBeGreaterThan(0);
    // The sentinel is closed — a wait that outlived its own success would watch the parent forever.
    expect(sentinel!.watcher.closed).toBe(true);

    // And the re-armed watch delivers ordinary changes.
    live!.listener('change', 'after.txt');
    await vi.advanceTimersByTimeAsync(60);
    expect(changes.at(-1)).toBe('C:\\code\\project\\after.txt');

    handle.dispose();
  });

  it('a GENUINE failure still gives up and reports — the budget is spent on faults, not on absence', async () => {
    // The regression fence for #186 (FR-010): EPERM is a fault, not an absence, and it must still
    // reach `onFailed` after its bounded retries rather than waiting forever for a path that is
    // sitting right there.
    present.add(ROOT);
    const failures: string[] = [];
    const handle = new NodeFileWatcher(50, { maxRetries: 2, retryBaseMs: 10 }).watch(
      ROOT,
      () => {},
      { onFailed: (reason) => failures.push(reason) },
    );

    for (let i = 0; i < 5; i += 1) {
      const live = liveWatch();
      if (!live) break;
      live.watcher.emit('error', Object.assign(new Error('EPERM'), { code: 'EPERM' }));
      await vi.advanceTimersByTimeAsync(200);
    }

    expect(failures).toEqual(['EPERM']);
    handle.dispose();
  });

  it('the watched directory going ENOENT underneath a live watch waits for it too', async () => {
    // The move-away-and-back case, from the other direction: the watch was healthy and the folder
    // was renamed out from under it. That is the same absence, and it must not consume the budget
    // either — it is exactly the case that has to recover by itself.
    present.add(PARENT);
    present.add(ROOT);
    const failures: string[] = [];
    const handle = new NodeFileWatcher(50).watch(ROOT, () => {}, {
      onFailed: (reason) => failures.push(reason),
    });

    const first = liveWatch();
    present.delete(ROOT);
    absent.add(ROOT);
    first!.watcher.emit('error', Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
    await vi.advanceTimersByTimeAsync(30_000);

    expect(failures).toEqual([]);
    expect(watchOn(PARENT), 'the vanished directory is not being waited for').toBeDefined();
    handle.dispose();
  });

  it('a REMOVED root is cut off instead of storming, and recovers when it is recreated (#201)', async () => {
    /**
     * Removing the root of a recursive `fs.watch` on Windows raises no error and does not end the
     * watch: it storms. Measured at 53,957 callbacks from one `rmSync`, still climbing, and
     * recreating the directory does not settle it — so the `'error'` handler never runs, and every
     * callback resets the debounce, which is what makes the tree go permanently silent.
     *
     * The watch cannot report its own death, so it is asked — periodically, not per event. What
     * this pins is that the storm is BOUNDED and that it lands in the same wait-for-the-path
     * recovery as a renamed directory.
     */
    present.add(PARENT);
    present.add(ROOT);
    const changes: string[] = [];
    const failures: string[] = [];
    const handle = new NodeFileWatcher(50).watch(ROOT, (p) => changes.push(p), {
      onFailed: (reason) => failures.push(reason),
    });

    const live = liveWatch();
    // The root is removed. No error is emitted — that is the whole problem — the events just keep
    // coming.
    present.delete(ROOT);
    absent.add(ROOT);
    let delivered = 0;
    for (let i = 0; i < 5000; i += 1) {
      if (live!.watcher.closed) break;
      live!.listener('rename', `ghost-${i}.tmp`);
      delivered += 1;
    }

    expect(live!.watcher.closed, 'the storming watch was never closed').toBe(true);
    expect(delivered, 'the storm was not bounded').toBeLessThan(200);
    // It is an absence, not a fault: nothing is reported as failed, and it is waiting for the
    // directory to come back.
    expect(failures).toEqual([]);
    await vi.advanceTimersByTimeAsync(100);
    expect(watchOn(PARENT), 'a removed root is not being waited for').toBeDefined();

    // Recreated — and it recovers by the same route a renamed directory does.
    present.add(ROOT);
    absent.delete(ROOT);
    watchOn(PARENT)!.listener('rename', 'project');
    await vi.advanceTimersByTimeAsync(100);
    expect(liveWatch()?.dir).toBe(ROOT);
    expect(changes.length, 'the root came back and nobody was told').toBeGreaterThan(0);

    handle.dispose();
  });

  it('stops waiting once disposed — a wait must not outlive the handle', async () => {
    // The same property `file-watcher-error-recovery` pins for the retry path: a project the user
    // has left must not be re-armed behind their back.
    present.add(PARENT);
    absent.add(ROOT);
    const changes: string[] = [];
    const handle = new NodeFileWatcher(50).watch(ROOT, (p) => changes.push(p));
    await vi.advanceTimersByTimeAsync(1000);

    const sentinel = watchOn(PARENT);
    expect(sentinel).toBeDefined();
    handle.dispose();
    expect(sentinel!.watcher.closed).toBe(true);

    // Even if the OS delivers one more event through the closed handle, nothing re-arms.
    present.add(ROOT);
    absent.delete(ROOT);
    sentinel!.listener('rename', 'project');
    await vi.advanceTimersByTimeAsync(1000);
    expect(watchOn(ROOT)).toBeUndefined();
    expect(changes).toEqual([]);
  });
});
