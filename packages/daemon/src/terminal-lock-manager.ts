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
  /**
   * `ready` is the lock being taken or held (051 R7: taking one waits on the OS). Kept as a promise
   * so terminals of one project that start together share ONE lock rather than racing for two.
   */
  private readonly locks = new Map<string, { ready: Promise<LockHandle>; count: number; held?: LockHandle }>();

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
  async acquire(projectId: string, cwd: string): Promise<void> {
    let entry = this.locks.get(projectId);
    if (entry) {
      entry.count += 1;
    } else {
      const created: { ready: Promise<LockHandle>; count: number; held?: LockHandle } = {
        ready: this.directoryLock.acquire(this.rootOf?.(projectId) ?? cwd),
        count: 1,
      };
      created.ready.then(
        (h) => (created.held = h),
        () => {},
      );
      entry = created;
      this.locks.set(projectId, entry);
    }
    try {
      await entry.ready;
    } catch (error) {
      // A lock that could not be taken counts for no terminal: the next start tries afresh.
      entry.count -= 1;
      if (entry.count <= 0 && this.locks.get(projectId) === entry) this.locks.delete(projectId);
      throw error;
    }
  }

  /**
   * Register a closed terminal for `projectId`, releasing the lock if it was the last. Settles once
   * the folder is free (051 R7), so a caller that reports the close afterwards reports a free folder.
   */
  async release(projectId: string): Promise<void> {
    const existing = this.locks.get(projectId);
    if (!existing) return;
    existing.count -= 1;
    if (existing.count <= 0) {
      this.locks.delete(projectId);
      const handle = await existing.ready.catch(() => null);
      if (handle) await this.directoryLock.release(handle);
    }
  }

  /** Whether `projectId` currently has any open terminal. */
  /**
   * 055 R5 — every folder held right now, by project, with the pid of the process holding it where
   * the lock can name one. A read of memory: no OS query.
   */
  heldLocks(): { projectId: string; path: string; pid: number | null }[] {
    const pids = new Map((this.directoryLock.heldPids?.() ?? []).map((e) => [e.path, e.pid]));
    return [...this.locks].flatMap(([projectId, e]) =>
      e.held === undefined ? [] : [{ projectId, path: e.held.path, pid: pids.get(e.held.path) ?? null }],
    );
  }

  hasOpenTerminals(projectId: string): boolean {
    return this.locks.has(projectId);
  }
}
