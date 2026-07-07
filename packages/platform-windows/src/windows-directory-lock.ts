import { spawn, type ChildProcess } from 'node:child_process';
import { renameSync, statSync } from 'node:fs';
import process from 'node:process';

/** Block the current thread for `ms` (used to bound-wait for process teardown). */
function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
import type { IDirectoryLock, LockHandle } from '@throng/core';

/**
 * Windows `IDirectoryLock` (005 Phase C, FR-022). Holds a folder so the OS refuses
 * to delete or move it, without blocking reads/writes of files inside.
 *
 * Mechanism: a tiny helper process is spawned with its **current directory set to
 * the locked folder**. Windows refuses to delete or rename a directory that is a
 * running process's working directory, so the folder is held for the helper's
 * lifetime — yet files inside remain freely writable. Pure Node (no native addon /
 * no FFI), which `fs.open`'s share flags can't achieve. The helper exits when its
 * parent (the daemon) is gone, so an unexpected daemon death releases every lock.
 */
const HELPER_SCRIPT =
  // chdir explicitly into the folder (more robust than relying solely on the spawn
  // `cwd` option, which some host environments override), then stay alive until the
  // parent process disappears.
  'process.chdir(process.env.THRONG_LOCK_DIR);' +
  'const p=process.ppid;' +
  'setInterval(()=>{try{process.kill(p,0)}catch{process.exit(0)}},1000);' +
  'setInterval(()=>{},1e9);';

export class WindowsDirectoryLock implements IDirectoryLock {
  private readonly held = new Map<LockHandle, ChildProcess>();

  acquire(absPath: string): LockHandle {
    let isDir = false;
    try {
      isDir = statSync(absPath).isDirectory();
    } catch {
      throw new Error(`Cannot lock "${absPath}": the path does not exist`);
    }
    if (!isDir) throw new Error(`Cannot lock "${absPath}": not a directory`);

    const child = spawn(process.execPath, ['-e', HELPER_SCRIPT], {
      cwd: absPath,
      env: { ...process.env, THRONG_LOCK_DIR: absPath },
      windowsHide: true,
      stdio: 'ignore',
    });
    // Let the OS finish creating the process so its cwd lock is in effect before
    // this returns (the holder is established at process creation).
    sleepSync(30);
    if (typeof child.pid !== 'number') {
      throw new Error(`Cannot lock "${absPath}": failed to start the lock holder`);
    }
    const handle: LockHandle = { path: absPath };
    this.held.set(handle, child);
    return handle;
  }

  release(handle: LockHandle): void {
    const child = this.held.get(handle);
    if (!child) return; // idempotent / unknown handle → no-op
    this.held.delete(handle);
    try {
      child.kill(); // SIGTERM → TerminateProcess on Windows (forceful)
    } catch {
      /* already gone */
    }
    // The folder is the holder's cwd, so it stays locked until the OS reclaims the
    // handle. `kill` is async, and — critically — Windows keeps the cwd handle for
    // a short moment *after* the process is already dead, so waiting on process
    // liveness returns too early. Instead poll the folder itself with a
    // non-destructive rename-to-self: it fails (EBUSY/EPERM) while the handle is
    // held and succeeds once released, so on return the directory is genuinely
    // free to delete/move. Bounded so a stuck handle can't hang the caller.
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      try {
        renameSync(handle.path, handle.path);
        return; // rename-to-self succeeded → the OS has released the directory
      } catch (error) {
        // ENOENT → the folder is already gone, so it is certainly not locked.
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      }
      sleepSync(15);
    }
  }
}
