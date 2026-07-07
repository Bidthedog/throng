import type { IDirectoryLock, LockHandle } from '@throng/core';

/**
 * Ref-counted project-root lock (005 Phase C, FR-022). While a project has one or
 * more open terminals, the daemon holds an `IDirectoryLock` on its root folder so
 * the OS refuses to delete or move it. The lock is acquired on the project's
 * **first** terminal and released on its **last**. `hasOpenTerminals` backs the
 * root-edit guard (a project's root path can't change while terminals are open).
 */
export class TerminalLockManager {
  private readonly locks = new Map<string, { handle: LockHandle; count: number }>();

  constructor(private readonly directoryLock: IDirectoryLock) {}

  /** Register an opened terminal for `projectId`, locking `rootPath` if it's the first. */
  acquire(projectId: string, rootPath: string): void {
    const existing = this.locks.get(projectId);
    if (existing) {
      existing.count += 1;
      return;
    }
    const handle = this.directoryLock.acquire(rootPath);
    this.locks.set(projectId, { handle, count: 1 });
  }

  /** Register a closed terminal for `projectId`, releasing the lock if it was the last. */
  release(projectId: string): void {
    const existing = this.locks.get(projectId);
    if (!existing) return;
    existing.count -= 1;
    if (existing.count <= 0) {
      this.directoryLock.release(existing.handle);
      this.locks.delete(projectId);
    }
  }

  /** Whether `projectId` currently has any open terminal. */
  hasOpenTerminals(projectId: string): boolean {
    return this.locks.has(projectId);
  }
}
