/**
 * 026 / #186 — an `fs.watch` runtime error must not kill the file tree for the session.
 *
 * `NodeFileWatcher` handles `fs.watch`'s `'error'` event by closing the watcher and setting it to
 * `null`, with no re-establish. Its own comment states the intent — Windows "commonly emits
 * EPERM/ENOENT when a watched directory is renamed or removed underneath a recursive watch
 * (churning temp dirs, heavy load)", and with no listener Node re-throws it as an uncaught
 * exception that crashes the main process. Swallowing it is right; **staying dead** is not. On a
 * project root containing `node_modules`, `.git` or build output the trigger is close to
 * inevitable, and once it fires the tree is stale for the rest of the session with nothing said.
 *
 * The seam is mocked deliberately. The error is an OS-timing artefact — it cannot be provoked on
 * demand (measured on this branch, removing a watched root emits no `'error'` at all; it produces a
 * runaway event storm instead), so a real-filesystem test of this path would be a test that
 * sometimes tests nothing.
 *
 * WHAT IS ASSERTED, and why it is the handle and not the callback. Once the error handler has run
 * `watcher.close()`, the OS delivers nothing more through that handle — so "changes still arrive"
 * is only true if a NEW watch exists. Reaching into the closed watcher's stored listener and
 * invoking it by hand would report a change and prove nothing, because in production nobody is
 * there to invoke it. The observable contract is therefore: after the error, the directory is
 * being watched again, and that new watch's events reach the caller.
 *
 * The alternative the acceptance criteria allow — surfacing the failure to the user instead of
 * re-establishing — would satisfy #186 too, but it is not a behaviour `IFileWatcher` can currently
 * express (its callback carries a changed path, and nothing else). If the fix goes that way, this
 * test is replaced by one asserting the new signal; it is not simply deleted.
 *
 * RED on master: the watch is never re-established, so nothing can arrive again.
 */
import { EventEmitter } from 'node:events';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/** A stand-in for the FSWatcher `fs.watch` returns: an emitter with `close()`. */
class FakeWatcher extends EventEmitter {
  closed = false;

  close(): void {
    this.closed = true;
  }
}

interface Watch {
  dir: string;
  watcher: FakeWatcher;
  listener: (event: string, filename: string) => void;
}

/** Every watch `fs.watch` handed out, newest last. */
const watches: Watch[] = [];

vi.mock('node:fs', () => ({
  watch: (dir: string, _opts: unknown, listener: (event: string, filename: string) => void) => {
    const watcher = new FakeWatcher();
    watches.push({ dir, watcher, listener });
    return watcher;
  },
}));

const { NodeFileWatcher } = await import('../../src/main/node-file-watcher.js');

/** The watch the OS would currently be delivering events through — i.e. the newest one still open. */
const liveWatch = (): Watch | undefined => [...watches].reverse().find((w) => !w.watcher.closed);

describe('watcher survives an fs.watch runtime error (026 / #186)', () => {
  beforeEach(() => {
    watches.length = 0;
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('re-establishes the watch after a runtime error, and changes keep arriving', async () => {
    const changes: string[] = [];
    const handle = new NodeFileWatcher(50).watch('C:/proj', (p) => changes.push(p));
    expect(watches).toHaveLength(1);

    // Baseline: while the watch is healthy, a change is reported. Without this a later silence
    // could just mean the harness never worked.
    watches[0].listener('change', 'before.txt');
    await vi.advanceTimersByTimeAsync(60);
    expect(changes).toEqual(['C:\\proj\\before.txt']);

    // The OS reports a runtime failure on the recursive watch (EPERM/ENOENT under churn).
    watches[0].watcher.emit(
      'error',
      Object.assign(new Error('EPERM: operation not permitted, watch'), { code: 'EPERM' }),
    );
    await vi.advanceTimersByTimeAsync(5000); // ample room for any backoff a fix chooses

    // The old handle is closed, so nothing can arrive through it. The ONLY way the tree can be
    // live again is a new watch on the same directory.
    expect(watches[0].watcher.closed).toBe(true);
    const live = liveWatch();
    expect(
      live,
      'no watch is open after the error — the tree is dead for the rest of the session',
    ).toBeDefined();
    expect(live?.dir).toBe('C:/proj');

    // And that new watch's events reach the caller.
    live!.listener('change', 'after.txt');
    await vi.advanceTimersByTimeAsync(60);
    expect(changes).toEqual(['C:\\proj\\before.txt', 'C:\\proj\\after.txt']);

    handle.dispose();
  });

  it('stops for good once disposed — recovery must not outlive the handle', async () => {
    // The regression fence for the fix. A re-establish that survives `dispose()` leaves a watcher
    // running on the OLD root after a project switch, for the rest of the session.
    const handle = new NodeFileWatcher(50).watch('C:/proj', () => {});
    handle.dispose();
    expect(watches.every((w) => w.watcher.closed)).toBe(true);

    const countAtDispose = watches.length;
    watches[watches.length - 1].watcher.emit('error', new Error('EPERM'));
    await vi.advanceTimersByTimeAsync(5000);
    expect(watches).toHaveLength(countAtDispose); // nothing re-armed behind the disposal
    expect(liveWatch()).toBeUndefined();
  });
});
