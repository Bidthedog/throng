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

export interface IDirectoryLock {
  /** Lock `absPath`; throws if it does not exist or cannot be locked. */
  acquire(absPath: string): LockHandle;
  /** Release a held lock; idempotent, and a no-op for an unknown handle. */
  release(handle: LockHandle): void;
}
