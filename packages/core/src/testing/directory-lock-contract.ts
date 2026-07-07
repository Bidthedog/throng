import type { IDirectoryLock } from '../abstractions/directory-lock.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`IDirectoryLock contract violation: ${message}`);
  }
}

/**
 * OS-specific operations the caller supplies so this pure suite can verify a real
 * lock without importing `node:fs` (keeps `@throng/core` OS-free). Each `try*`
 * returns whether the operation succeeded.
 */
export interface DirectoryLockContractEnv {
  make(): IDirectoryLock;
  /** Create a fresh temp directory and return its absolute path. */
  makeDir(): string;
  /** A path that does not exist (for the acquire-throws obligation). */
  nonExistentPath(): string;
  /** Attempt to delete `dir`; return true on success. */
  tryDelete(dir: string): boolean;
  /** Attempt to rename/move `dir`; return true on success. */
  tryRename(dir: string): boolean;
  /** Write a file inside `dir`; return true on success. */
  tryWriteInside(dir: string): boolean;
  /** Best-effort cleanup. */
  cleanup(dir: string): void;
}

/**
 * Reusable contract suite for any `IDirectoryLock` implementation (005 Phase C,
 * FR-022). Verifies, against real temp directories, that a held lock blocks
 * delete/rename but not writes inside, that release re-permits them, that
 * acquiring a missing path throws, that release is idempotent, and that the
 * directory stays locked until every handle is released. Throws on first
 * violation.
 */
export function runDirectoryLockContract(env: DirectoryLockContractEnv): void {
  const lock = env.make();

  // 1. Held lock blocks delete + rename, but not writes inside; release re-permits.
  const dirA = env.makeDir();
  try {
    const handle = lock.acquire(dirA);
    assert(handle.path === dirA, `acquire().path must echo the locked path; got ${handle.path}`);
    assert(env.tryWriteInside(dirA) === true, 'writes to files inside a locked dir must still succeed');
    assert(env.tryDelete(dirA) === false, 'deleting a locked dir must fail');
    assert(env.tryRename(dirA) === false, 'renaming/moving a locked dir must fail');
    lock.release(handle);
    assert(env.tryDelete(dirA) === true, 'deleting must succeed after release');
  } finally {
    env.cleanup(dirA);
  }

  // 2. acquire on a non-existent path throws.
  let threw = false;
  try {
    lock.acquire(env.nonExistentPath());
  } catch {
    threw = true;
  }
  assert(threw, 'acquire() on a non-existent path must throw');

  // 3. release is idempotent; releasing an unknown handle is a safe no-op.
  const dirC = env.makeDir();
  try {
    const handle = lock.acquire(dirC);
    lock.release(handle);
    lock.release(handle); // double release — must not throw
    lock.release({ path: dirC }); // never-acquired handle — must not throw
    assert(env.tryDelete(dirC) === true, 'dir must be deletable after release');
  } finally {
    env.cleanup(dirC);
  }

  // 4. Re-entrancy: stays locked until all handles release.
  const dirD = env.makeDir();
  try {
    const h1 = lock.acquire(dirD);
    const h2 = lock.acquire(dirD);
    assert(env.tryDelete(dirD) === false, 'dir must be locked while any handle is held');
    lock.release(h1);
    assert(env.tryDelete(dirD) === false, 'dir must stay locked while a second handle is held');
    lock.release(h2);
    assert(env.tryDelete(dirD) === true, 'dir must be deletable once all handles release');
  } finally {
    env.cleanup(dirD);
  }
}
