import { describe, it, expect } from 'vitest';
import type { IDirectoryLock, LockHandle } from '@throng/core';
import { TerminalLockManager } from '../../src/terminal-lock-manager.js';

class FakeLock implements IDirectoryLock {
  acquired: string[] = [];
  released: string[] = [];
  /** When set, the next acquire rejects with it. */
  failNext?: Error;
  async acquire(absPath: string): Promise<LockHandle> {
    this.acquired.push(absPath);
    await Promise.resolve(); // taking a lock waits on the OS (051 R7)
    if (this.failNext) {
      const error = this.failNext;
      this.failNext = undefined;
      throw error;
    }
    return { path: absPath };
  }
  async release(handle: LockHandle): Promise<void> {
    await Promise.resolve();
    this.released.push(handle.path);
  }
}

describe('TerminalLockManager (ref-counted per project, FR-022)', () => {
  it('acquires the root lock on the first terminal and not on subsequent ones', async () => {
    const lock = new FakeLock();
    const mgr = new TerminalLockManager(lock);
    await mgr.acquire('proj', 'C:/root');
    await mgr.acquire('proj', 'C:/root');
    expect(lock.acquired).toEqual(['C:/root']); // once
    expect(mgr.hasOpenTerminals('proj')).toBe(true);
  });

  it('051 R7 — terminals of one project starting together share ONE lock', async () => {
    const lock = new FakeLock();
    const mgr = new TerminalLockManager(lock);
    await Promise.all([mgr.acquire('proj', 'C:/root'), mgr.acquire('proj', 'C:/root'), mgr.acquire('proj', 'C:/root')]);
    expect(lock.acquired).toEqual(['C:/root']);
  });

  it('051 R7 — a lock that cannot be taken fails every waiter and counts for none of them', async () => {
    const lock = new FakeLock();
    const mgr = new TerminalLockManager(lock);
    lock.failNext = new Error('gone');
    const both = await Promise.allSettled([mgr.acquire('proj', 'C:/root'), mgr.acquire('proj', 'C:/root')]);
    expect(both.map((r) => r.status)).toEqual(['rejected', 'rejected']);
    expect(mgr.hasOpenTerminals('proj')).toBe(false);
    await mgr.acquire('proj', 'C:/root'); // the next start tries afresh
    expect(lock.acquired).toEqual(['C:/root', 'C:/root']);
  });

  it('releases only when the last terminal closes, and settles once the folder is free', async () => {
    const lock = new FakeLock();
    const mgr = new TerminalLockManager(lock);
    await mgr.acquire('proj', 'C:/root');
    await mgr.acquire('proj', 'C:/root');
    await mgr.release('proj');
    expect(lock.released).toEqual([]); // still one open
    expect(mgr.hasOpenTerminals('proj')).toBe(true);
    await mgr.release('proj');
    expect(lock.released).toEqual(['C:/root']); // now released
    expect(mgr.hasOpenTerminals('proj')).toBe(false);
  });

  it('tracks projects independently', async () => {
    const lock = new FakeLock();
    const mgr = new TerminalLockManager(lock);
    await mgr.acquire('a', 'C:/a');
    await mgr.acquire('b', 'C:/b');
    expect(lock.acquired.sort()).toEqual(['C:/a', 'C:/b']);
    await mgr.release('a');
    expect(lock.released).toEqual(['C:/a']);
    expect(mgr.hasOpenTerminals('b')).toBe(true);
  });

  it('locks the project root, not the cwd of the terminal that opened first (#385)', async () => {
    const lock = new FakeLock();
    const mgr = new TerminalLockManager(lock, (id) => (id === 'proj' ? 'C:/root' : null));
    await mgr.acquire('proj', 'C:/root/.claude/worktrees/wt');
    await mgr.acquire('proj', 'C:/root');
    expect(lock.acquired).toEqual(['C:/root']);
    await mgr.release('proj');
    await mgr.release('proj');
    expect(lock.released).toEqual(['C:/root']);
  });

  it('falls back to the terminal cwd for a project whose root cannot be resolved', async () => {
    const lock = new FakeLock();
    const mgr = new TerminalLockManager(lock, () => null);
    await mgr.acquire('ghost', 'C:/somewhere');
    expect(lock.acquired).toEqual(['C:/somewhere']);
  });

  it('release on an unknown project is a safe no-op', async () => {
    const lock = new FakeLock();
    const mgr = new TerminalLockManager(lock);
    await expect(mgr.release('nope')).resolves.toBeUndefined();
    expect(lock.released).toEqual([]);
  });
});
