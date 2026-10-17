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
