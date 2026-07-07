import { describe, it, expect } from 'vitest';
import type { IDirectoryLock, LockHandle } from '@throng/core';
import { TerminalLockManager } from '../../src/terminal-lock-manager.js';

class FakeLock implements IDirectoryLock {
  acquired: string[] = [];
  released: string[] = [];
  acquire(absPath: string): LockHandle {
    this.acquired.push(absPath);
    return { path: absPath };
  }
  release(handle: LockHandle): void {
    this.released.push(handle.path);
  }
}

describe('TerminalLockManager (ref-counted per project, FR-022)', () => {
  it('acquires the root lock on the first terminal and not on subsequent ones', () => {
    const lock = new FakeLock();
    const mgr = new TerminalLockManager(lock);
    mgr.acquire('proj', 'C:/root');
    mgr.acquire('proj', 'C:/root');
    expect(lock.acquired).toEqual(['C:/root']); // once
    expect(mgr.hasOpenTerminals('proj')).toBe(true);
  });

  it('releases only when the last terminal closes', () => {
    const lock = new FakeLock();
    const mgr = new TerminalLockManager(lock);
    mgr.acquire('proj', 'C:/root');
    mgr.acquire('proj', 'C:/root');
    mgr.release('proj');
    expect(lock.released).toEqual([]); // still one open
    expect(mgr.hasOpenTerminals('proj')).toBe(true);
    mgr.release('proj');
    expect(lock.released).toEqual(['C:/root']); // now released
    expect(mgr.hasOpenTerminals('proj')).toBe(false);
  });

  it('tracks projects independently', () => {
    const lock = new FakeLock();
    const mgr = new TerminalLockManager(lock);
    mgr.acquire('a', 'C:/a');
    mgr.acquire('b', 'C:/b');
    expect(lock.acquired.sort()).toEqual(['C:/a', 'C:/b']);
    mgr.release('a');
    expect(lock.released).toEqual(['C:/a']);
    expect(mgr.hasOpenTerminals('b')).toBe(true);
  });

  it('release on an unknown project is a safe no-op', () => {
    const lock = new FakeLock();
    const mgr = new TerminalLockManager(lock);
    expect(() => mgr.release('nope')).not.toThrow();
    expect(lock.released).toEqual([]);
  });
});
