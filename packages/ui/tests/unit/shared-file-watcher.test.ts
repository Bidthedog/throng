/**
 * #272 / #482 — `SharedFileWatcher` opens ONE underlying watch per directory, however many readers
 * ask for it, and keeps each reader's contract (reports, failure, dispose) exactly as if it were alone.
 */
import { describe, expect, it, vi } from 'vitest';
import type { Disposable, IFileWatcher, WatchBatch, WatchOptions } from '@throng/core';
import { SharedFileWatcher } from '../../src/main/shared-file-watcher.js';

class FakeWatcher implements IFileWatcher {
  readonly opened: Array<{
    dir: string;
    onChange: (path: string, batch?: WatchBatch) => void;
    options?: WatchOptions;
    disposed: boolean;
  }> = [];

  watch(dir: string, onChange: (path: string, batch?: WatchBatch) => void, options?: WatchOptions): Disposable {
    const entry = { dir, onChange, options, disposed: false };
    this.opened.push(entry);
    return { dispose: () => (entry.disposed = true) };
  }

  live(): number {
    return this.opened.filter((o) => !o.disposed).length;
  }
}

describe('SharedFileWatcher', () => {
  it('two readers of one root share one underlying watch, whatever the spelling', () => {
    const inner = new FakeWatcher();
    const shared = new SharedFileWatcher(inner);
    const a = vi.fn();
    const b = vi.fn();
    shared.watch('C:/projects/x', a);
    shared.watch('C:\\projects\\x', b);

    expect(inner.live(), 'the root was watched more than once').toBe(1);
    const batch = { paths: ['C:\\projects\\x\\f.txt'], complete: true };
    inner.opened[0]!.onChange('C:\\projects\\x\\f.txt', batch);
    expect(a).toHaveBeenCalledWith('C:\\projects\\x\\f.txt', batch);
    expect(b).toHaveBeenCalledWith('C:\\projects\\x\\f.txt', batch);
  });

  it('a different directory gets its own watch', () => {
    const inner = new FakeWatcher();
    const shared = new SharedFileWatcher(inner);
    shared.watch('C:/projects/x', vi.fn());
    shared.watch('C:/projects/y', vi.fn());
    expect(inner.live()).toBe(2);
  });

  it('closes the underlying watch only when the last reader leaves, and stops reporting to a reader that left', () => {
    const inner = new FakeWatcher();
    const shared = new SharedFileWatcher(inner);
    const a = vi.fn();
    const b = vi.fn();
    const ha = shared.watch('C:/p', a);
    const hb = shared.watch('C:/p', b);

    ha.dispose();
    ha.dispose(); // idempotent — must not take the other reader's share with it
    expect(inner.live()).toBe(1);
    inner.opened[0]!.onChange('C:/p/f');
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledTimes(1);

    hb.dispose();
    expect(inner.live()).toBe(0);
    expect(shared.openWatches).toBe(0);
  });

  it('tells every reader a watch failed, and the next reader opens a fresh one', () => {
    const inner = new FakeWatcher();
    const shared = new SharedFileWatcher(inner);
    const failedA = vi.fn();
    const failedB = vi.fn();
    shared.watch('C:/p', vi.fn(), { onFailed: failedA });
    shared.watch('C:/p', vi.fn(), { onFailed: failedB });

    inner.opened[0]!.options?.onFailed?.('EPERM');
    expect(failedA).toHaveBeenCalledWith('EPERM');
    expect(failedB).toHaveBeenCalledWith('EPERM');

    shared.watch('C:/p', vi.fn());
    expect(inner.opened, 'a reader joined the dead watch instead of opening a new one').toHaveLength(2);
  });
});

/**
 * #306 — one watch per project root serves everything under it. A watch is recursive, so a reader
 * of a folder INSIDE an already-watched one is served by that watch, filtered to its own subtree,
 * rather than opening a second recursive watch over part of the same tree.
 */
describe('SharedFileWatcher — a folder inside a watched one (#306)', () => {
  it('opens no second watch, and hands the reader only reports about its own subtree', () => {
    const inner = new FakeWatcher();
    const shared = new SharedFileWatcher(inner);
    const root = vi.fn();
    const sub = vi.fn();
    shared.watch('C:/p', root);
    shared.watch('C:\\p\\src', sub);
    expect(inner.live(), 'the sub-folder opened its own watch').toBe(1);

    inner.opened[0]!.onChange('C:/p/README.md', { paths: ['C:/p/README.md'], complete: true });
    expect(sub).not.toHaveBeenCalled();

    inner.opened[0]!.onChange('C:/p/src/a.ts', {
      paths: ['C:/p/README.md', 'C:/p/src/a.ts'],
      complete: true,
    });
    expect(sub).toHaveBeenCalledWith('C:/p/src/a.ts', { paths: ['C:/p/src/a.ts'], complete: true });
    expect(root).toHaveBeenCalledTimes(2);
  });

  it('does not take a sibling whose name merely starts the same for a sub-folder', () => {
    const inner = new FakeWatcher();
    const shared = new SharedFileWatcher(inner);
    shared.watch('C:/p', vi.fn());
    shared.watch('C:/p2', vi.fn());
    expect(inner.live()).toBe(2);
  });

  it('says nothing to a reader whose folder went away, as a watch of its own would not', () => {
    // A watch on a folder that disappears waits for it, silently, and speaks when it returns. A
    // reader served by the root's watch must see the same: told now, an open editor marks its
    // document deleted and DIRTY, where 027 has it found `unloadable` and clean on its next mount.
    const inner = new FakeWatcher();
    const shared = new SharedFileWatcher(inner, () => false); // the folder is not there
    const sub = vi.fn();
    shared.watch('C:/p', vi.fn());
    shared.watch('C:/p/src', sub);

    inner.opened[0]!.onChange('C:/p/src', { paths: ['C:/p/src', 'C:/p/src-moved'], complete: true });
    inner.opened[0]!.onChange('C:/p', { paths: ['C:/p/other'], complete: false });
    expect(sub).not.toHaveBeenCalled();
  });

  it('tells the reader its whole folder may have changed when the folder or one above it is reported', () => {
    // A folder renamed away and back is reported, on Windows, as the folder alone — nothing names
    // the files inside it. A reader that only looked for its own paths would never re-check.
    const inner = new FakeWatcher();
    const shared = new SharedFileWatcher(inner, () => true);
    const sub = vi.fn();
    shared.watch('C:/p', vi.fn());
    shared.watch('C:/p/src/deep', sub);

    inner.opened[0]!.onChange('C:/p/src', { paths: ['C:/p/src'], complete: true });
    expect(sub).toHaveBeenCalledWith('C:/p/src', { paths: [], complete: false });
  });

  it('passes an incomplete report to every reader under the watch', () => {
    const inner = new FakeWatcher();
    const shared = new SharedFileWatcher(inner, () => true);
    const sub = vi.fn();
    shared.watch('C:/p', vi.fn());
    shared.watch('C:/p/src', sub);

    inner.opened[0]!.onChange('C:/p/other', { paths: ['C:/p/other'], complete: false });
    expect(sub).toHaveBeenCalledWith('C:/p/other', { paths: [], complete: false });
  });

  it('keeps the watch open while a reader under it remains, and closes it with the last', () => {
    const inner = new FakeWatcher();
    const shared = new SharedFileWatcher(inner);
    const sub = vi.fn();
    const rootHandle = shared.watch('C:/p', vi.fn());
    const subHandle = shared.watch('C:/p/src', sub);

    rootHandle.dispose();
    expect(inner.live(), 'the root reader leaving closed the watch its sub-folder still needs').toBe(1);
    inner.opened[0]!.onChange('C:/p/src/a.ts', { paths: ['C:/p/src/a.ts'], complete: true });
    expect(sub).toHaveBeenCalledTimes(1);

    subHandle.dispose();
    expect(inner.live()).toBe(0);
    expect(shared.openWatches).toBe(0);
  });

  it('tells a reader under the watch when it fails', () => {
    const inner = new FakeWatcher();
    const shared = new SharedFileWatcher(inner);
    const failed = vi.fn();
    shared.watch('C:/p', vi.fn());
    shared.watch('C:/p/src', vi.fn(), { onFailed: failed });

    inner.opened[0]!.options?.onFailed?.('EPERM');
    expect(failed).toHaveBeenCalledWith('EPERM');
  });
});
