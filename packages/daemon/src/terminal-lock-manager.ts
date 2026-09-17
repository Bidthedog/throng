import type { IDirectoryLock, LockHandle } from '@throng/core';

/**
 * Ref-counted project-root lock (005 Phase C, FR-022). While a project has one or
 * more open terminals, the daemon holds an `IDirectoryLock` on its root folder so
 * the OS refuses to delete or move it. The lock is acquired on the project's
 * **first** terminal and released on its **last**. `hasOpenTerminals` backs the
 * root-edit guard (a project's root path can't change while terminals are open).
 *
 * #385 — the lock targets the project's ROOT, resolved from the project itself, never the opening
 * terminal's cwd. Locking the first terminal's cwd parked the lock in whatever sub-folder that
 * terminal started in (a git worktree, typically), and kept it there until the project's LAST
 * terminal closed — so the folder stayed undeletable long after its own terminal had gone.
 */
export class TerminalLockManager {
  private readonly locks = new Map<string, { handle: LockHandle; count: number }>();

  constructor(
    private readonly directoryLock: IDirectoryLock,
    /** The project's root folder, or `null` for a project the daemon does not know. */
    private readonly rootOf?: (projectId: string) => string | null,
  ) {}

  /**
   * Register an opened terminal for `projectId`, locking the project's root if it's the first.
   * `cwd` is the terminal's own start folder, locked only when the project's root cannot be
   * resolved — the behaviour before #385, kept for a project the store does not hold.
   */
  acquire(projectId: string, cwd: string): void {
    const existing = this.locks.get(projectId);
    if (existing) {
      existing.count += 1;
      return;
    }
    const handle = this.directoryLock.acquire(this.rootOf?.(projectId) ?? cwd);
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
