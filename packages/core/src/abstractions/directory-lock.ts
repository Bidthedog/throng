/**
 * IDirectoryLock (Principle II, 005 Phase C, FR-022) — holds a folder so the OS
 * refuses to delete or move it while held, without blocking reads/writes of files
 * inside it. The abstract contract only; the Windows impl `WindowsDirectoryLock`
 * (an open directory handle without delete/rename share) lives in
 * `@throng/platform-windows` and is owned by the **daemon**. No OS calls here.
 */

/** An opaque handle to a held directory lock. */
export interface LockHandle {
  readonly path: string;
}

/**
 * Both operations are async (051 R7): taking and letting go of a folder waits on the OS, and that
 * wait must never stop the daemon serving other terminals.
 */
export interface IDirectoryLock {
  /** Lock `absPath`; rejects if it does not exist or cannot be locked. */
  acquire(absPath: string): Promise<LockHandle>;
  /** Release a held lock, settling once the folder is free; idempotent, and a no-op for an unknown handle. */
  release(handle: LockHandle): Promise<void>;
}
